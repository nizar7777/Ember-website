(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Internal order-entry tool. Not linked from the site nav — bookmark
  // order-entry.html directly. Everything here is saved to this browser's
  // localStorage only (no backend), so:
  //   - use the same browser/device each time you log an order
  //   - export CSV regularly as a backup, or after copying orders into
  //     your own bookkeeping
  //
  // Reads the same Google Sheet as js/store-products.js so the product
  // grid always matches your real catalog (name, SKU, price, colors,
  // sizes, photo) instead of you retyping them. If you change the Sheet
  // ID over there, update it here too.
  //
  // The design mockup (front/back canvas) reuses the same shirt photos
  // and fabric.js approach as js/custom-design.js — it's a quick way to
  // drop a customer's DM'd design photo onto a shirt for your own
  // production reference, not a pixel-precise print tool.
  // ---------------------------------------------------------------------
  var SHEET_ID = atob("MXpfWEpwc0U5WVctS2V6cWdqc2pIZ3AxY19ZNHdrdDVYb2piTmJWZWNWdkU=");
  var SHEET_GID = atob("MTg0ODY4NTAzMQ==");
  var SHEET_NAME = "";

  var DRAFT_KEY = "ember_order_draft_v1";
  var LOG_KEY = "ember_order_log_v1";
  var CUSTOM_VALUE = "__custom__";

  var els = {
    productSearch: document.getElementById("oe-product-search"),
    productGrid: document.getElementById("oe-product-grid"),
    variantRow: document.getElementById("oe-variant-row"),
    customFields: document.getElementById("oe-custom-fields"),
    customName: document.getElementById("oe-custom-name"),
    customPrice: document.getElementById("oe-custom-price"),
    customSize: document.getElementById("oe-custom-size"),
    qtyInput: document.getElementById("oe-qty-input"),
    itemNotes: document.getElementById("oe-item-notes"),
    addItemBtn: document.getElementById("oe-add-item-btn"),
    addItemStatus: document.getElementById("oe-add-item-status"),
    draftItems: document.getElementById("oe-draft-items"),
    subtotal: document.getElementById("oe-subtotal"),

    channel: document.getElementById("oe-channel"),
    customerName: document.getElementById("oe-customer-name"),
    customerPhone: document.getElementById("oe-customer-phone"),
    customerAddress: document.getElementById("oe-customer-address"),
    cliqConfirmedRow: document.getElementById("oe-cliq-confirmed-row"),
    cliqConfirmed: document.getElementById("oe-cliq-confirmed"),
    orderNotes: document.getElementById("oe-order-notes"),
    voiceRecordBtn: document.getElementById("oe-voice-record-btn"),
    voiceBtnLabel: document.getElementById("oe-voice-btn-label"),
    voiceTimer: document.getElementById("oe-voice-timer"),
    voicePlayback: document.getElementById("oe-voice-playback"),
    voiceAudio: document.getElementById("oe-voice-audio"),
    voiceDeleteBtn: document.getElementById("oe-voice-delete-btn"),
    voiceHint: document.getElementById("oe-voice-hint"),
    saveBtn: document.getElementById("oe-save-order-btn"),
    saveStatus: document.getElementById("oe-save-status"),

    logBody: document.getElementById("oe-log-body"),
    exportBtn: document.getElementById("oe-export-btn"),
    clearLogBtn: document.getElementById("oe-clear-log-btn")
  };

  var allProducts = [];
  var selectedProductIndex = null; // number index into allProducts, CUSTOM_VALUE, or null
  var productFilter = "";
  var draft = loadDraft();

  // -----------------------------------------------------------------------
  // Storage helpers
  // -----------------------------------------------------------------------
  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  // Voice notes and design images are stored inline as data URLs, so this
  // browser's storage quota (usually ~5MB) is a real ceiling. Failing
  // silently here would look like "my order just vanished", so it's
  // surfaced instead.
  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error("localStorage write failed", e);
      window.alert(
        "This browser's storage is full, so that couldn't be saved.\n\n" +
        "Export the order log to CSV, then use \"Clear Log\" to free up space. " +
        "Voice notes and design images take the most room."
      );
      return false;
    }
  }

  function loadDraft() {
    return loadJSON(DRAFT_KEY, {
      items: [],
      channel: "",
      customerName: "",
      customerPhone: "",
      customerAddress: "",
      payment: "Cash on Delivery",
      cliqConfirmed: false,
      notes: "",
      voiceNote: "",         // data URL of the recording
      voiceDuration: 0       // seconds, for the label
    });
  }

  function saveDraft() {
    saveJSON(DRAFT_KEY, draft);
  }

  function loadLog() {
    return loadJSON(LOG_KEY, []);
  }

  function saveLog(log) {
    saveJSON(LOG_KEY, log);
  }

  // -----------------------------------------------------------------------
  // Product sheet (subset of js/store-products.js — only what this form needs)
  // -----------------------------------------------------------------------
  function sheetUrl() {
    var url = "https://docs.google.com/spreadsheets/d/" + SHEET_ID + "/gviz/tq?tqx=out:json";
    if (SHEET_GID) url += "&gid=" + encodeURIComponent(SHEET_GID);
    else if (SHEET_NAME) url += "&sheet=" + encodeURIComponent(SHEET_NAME);
    return url;
  }

  function normalizeKey(label) {
    return String(label || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function splitList(str) {
    return String(str || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function parseGvizResponse(text) {
    var match = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
    if (!match) throw new Error("Unexpected response from Google Sheets.");
    var data = JSON.parse(match[1]);
    var cols = data.table.cols.map(function (c, i) {
      return normalizeKey(c.label) || normalizeKey(c.id) || ("col" + i);
    });

    return data.table.rows.map(function (row) {
      var obj = {};
      row.c.forEach(function (cell, i) {
        obj[cols[i]] = cell ? (cell.f !== undefined ? cell.f : cell.v) : "";
      });
      return obj;
    });
  }

  function toProduct(row) {
    var inStockRaw = String(row.instock === undefined ? "true" : row.instock).trim().toLowerCase();
    return {
      name: row.name || "Untitled",
      sku: row.sku || "",
      price: row.price || "",
      colors: row.colors || "",
      sizes: row.sizes || "",
      image: splitList(row.image)[0] || "",
      inStock: inStockRaw !== "false" && inStockRaw !== "0" && inStockRaw !== "no"
    };
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // -----------------------------------------------------------------------
  // Product grid
  // -----------------------------------------------------------------------
  function matchesFilter(product, filter) {
    if (!filter) return true;
    var haystack = (product.name + " " + product.sku).toLowerCase();
    return haystack.indexOf(filter) !== -1;
  }

  function renderProductGrid() {
    var filter = productFilter.trim().toLowerCase();
    var tiles = [];
    var anyMatched = false;

    allProducts.forEach(function (p, i) {
      if (!p.inStock) return;
      if (!matchesFilter(p, filter)) return;
      anyMatched = true;
      var isSelected = selectedProductIndex === i;
      tiles.push(
        '<button type="button" class="oe-product-tile' + (isSelected ? " is-selected" : "") + '" data-product-tile data-index="' + i + '">' +
          (p.image ? '<img src="' + escapeHtml(p.image) + '" alt="" loading="lazy">' : "") +
          '<div class="oe-product-tile-name">' + escapeHtml(p.name) + "</div>" +
          (p.price ? '<div class="oe-product-tile-price">' + escapeHtml(String(p.price)) + "</div>" : "") +
        "</button>"
      );
    });

    if (!allProducts.length) {
      els.productGrid.innerHTML = '<div class="oe-grid-empty">Loading products…</div>';
      return;
    }

    if (!anyMatched && filter) {
      tiles.unshift('<div class="oe-grid-empty">No products match "' + escapeHtml(productFilter) + '".</div>');
    }

    tiles.push(
      '<button type="button" class="oe-custom-tile' + (selectedProductIndex === CUSTOM_VALUE ? " is-selected" : "") + '" data-product-tile data-index="' + CUSTOM_VALUE + '">+<br>Custom</button>'
    );

    els.productGrid.innerHTML = tiles.join("");
  }

  els.productSearch.addEventListener("input", function () {
    productFilter = els.productSearch.value;
    renderProductGrid();
  });

  function optionSelect(variant, values) {
    if (!values.length) return "";
    var options = values.map(function (v) {
      return '<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + "</option>";
    }).join("");
    return (
      '<select class="cd-select oe-variant-select" data-variant="' + variant + '" aria-label="Choose ' + variant + '">' +
        options +
      "</select>"
    );
  }

  function selectProduct(value) {
    selectedProductIndex = value === CUSTOM_VALUE ? CUSTOM_VALUE : parseInt(value, 10);
    renderProductGrid();

    if (selectedProductIndex === CUSTOM_VALUE) {
      els.variantRow.innerHTML = "";
      els.customFields.hidden = false;
      return;
    }
    els.customFields.hidden = true;
    var product = allProducts[selectedProductIndex];
    if (!product) {
      els.variantRow.innerHTML = "";
      return;
    }
    els.variantRow.innerHTML =
      optionSelect("color", splitList(product.colors)) +
      optionSelect("size", splitList(product.sizes));
  }

  els.productGrid.addEventListener("click", function (e) {
    var tile = e.target.closest("[data-product-tile]");
    if (!tile) return;
    selectProduct(tile.getAttribute("data-index"));
  });

  // -----------------------------------------------------------------------
  // Design mockup — front/back shirt canvas with drag-drop / paste / upload
  // -----------------------------------------------------------------------
  var CANVAS_WIDTH = 200;
  var CANVAS_HEIGHT = 290;

  // Used to keep its own copy of the colour/mockup list, which is exactly
  // how it ended up stuck on stale local files (including a wrong filename
  // for stressed-light's back) while the store and custom design tool
  // moved to the S3 bucket. Now reads the same js/shirt-colors.js as both
  // of those, so a colour added there just works here too.
  function mockupUrl(color, view) {
    return window.EmberShirts.mockup(color, view);
  }

  var hasFabric = typeof window.fabric !== "undefined";
  var canvasFront, canvasBack, currentView = "front", currentShirtColor = "black";
  var mockupStage = document.getElementById("oe-mockup-stage");

  if (hasFabric) {
    canvasFront = new fabric.Canvas("oe-canvas-front", { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, preserveObjectStacking: true });
    canvasBack = new fabric.Canvas("oe-canvas-back", { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, preserveObjectStacking: true });
    canvasBack.wrapperEl.style.display = "none";
  }

  function activeCanvas() {
    return currentView === "front" ? canvasFront : canvasBack;
  }

  function loadShirtBg(canvas, color, view) {
    // crossOrigin: "anonymous" is required now that mockups are S3-hosted,
    // not local — without it the canvas reads as tainted regardless of the
    // bucket's own CORS config, and getDesignDataUrls' toDataURL() below
    // throws a SecurityError that would silently break saving any order
    // with a design attached.
    fabric.Image.fromURL(mockupUrl(color, view), function (img) {
      var scale = Math.min(CANVAS_WIDTH / img.width, CANVAS_HEIGHT / img.height);
      img.set({
        scaleX: scale,
        scaleY: scale,
        left: (CANVAS_WIDTH - img.width * scale) / 2,
        top: (CANVAS_HEIGHT - img.height * scale) / 2,
        originX: "left",
        originY: "top",
        selectable: false,
        evented: false
      });
      canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
    }, { crossOrigin: "anonymous" });
  }

  function setShirtColor(color) {
    currentShirtColor = color;
    loadShirtBg(canvasFront, color, "front");
    loadShirtBg(canvasBack, color, "back");
  }

  function addImageToCanvas(dataUrl) {
    var canvas = activeCanvas();
    fabric.Image.fromURL(dataUrl, function (img) {
      var maxDim = Math.min(CANVAS_WIDTH, CANVAS_HEIGHT) * 0.5;
      var scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
      img.set({
        left: CANVAS_WIDTH / 2,
        top: CANVAS_HEIGHT / 2,
        originX: "center",
        originY: "center",
        scaleX: scale,
        scaleY: scale
      });
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.renderAll();
    });
  }

  function handleImageFile(file) {
    if (!file || file.type.indexOf("image/") !== 0) return;
    var reader = new FileReader();
    reader.onload = function (evt) { addImageToCanvas(evt.target.result); };
    reader.readAsDataURL(file);
  }

  function resetMockup() {
    [canvasFront, canvasBack].forEach(function (canvas) {
      canvas.getObjects().slice().forEach(function (obj) { canvas.remove(obj); });
    });
  }

  function mockupHasDesign() {
    return canvasFront.getObjects().length > 0 || canvasBack.getObjects().length > 0;
  }

  function getDesignDataUrls() {
    var result = {};
    if (canvasFront.getObjects().length) result.designFront = canvasFront.toDataURL({ format: "png" });
    if (canvasBack.getObjects().length) result.designBack = canvasBack.toDataURL({ format: "png" });
    return result;
  }

  // Built from the shared colour list instead of hand-typed, so a colour
  // added in js/shirt-colors.js (like navy) shows up here without also
  // needing an HTML edit — same pattern as custom-design.js's swatches.
  function buildMockupSwatches() {
    var wrap = document.getElementById("oe-mockup-swatches");
    if (!wrap) return;
    var html = [];
    var washedStarted = false;
    window.EmberShirts.all.forEach(function (c) {
      if (c.washed && !washedStarted) {
        washedStarted = true;
        html.push('<span class="cd-swatch-divider" aria-hidden="true"></span>');
        html.push('<span class="cd-swatch-group-label">Washed</span>');
      }
      html.push(
        '<button type="button" class="cd-swatch' + (c.washed ? " is-washed" : "") +
          (c.key === currentShirtColor ? " is-active" : "") +
          '" data-color="' + c.key + '" style="background:' + c.swatch +
          '" aria-label="' + c.label + '"></button>'
      );
    });
    wrap.innerHTML = html.join("");
  }

  if (hasFabric) {
    buildMockupSwatches();
    setShirtColor(currentShirtColor);

    document.getElementById("oe-view-toggle").addEventListener("click", function (e) {
      var btn = e.target.closest(".cd-view-btn");
      if (!btn) return;
      var view = btn.getAttribute("data-view");
      if (view === currentView) return;
      currentView = view;
      document.querySelectorAll("#oe-view-toggle .cd-view-btn").forEach(function (b) {
        var isActive = b === btn;
        b.classList.toggle("is-active", isActive);
        b.setAttribute("aria-selected", isActive ? "true" : "false");
      });
      canvasFront.wrapperEl.style.display = view === "front" ? "" : "none";
      canvasBack.wrapperEl.style.display = view === "back" ? "" : "none";
    });

    document.getElementById("oe-mockup-swatches").addEventListener("click", function (e) {
      var btn = e.target.closest(".cd-swatch");
      if (!btn) return;
      document.querySelectorAll("#oe-mockup-swatches .cd-swatch").forEach(function (s) { s.classList.remove("is-active"); });
      btn.classList.add("is-active");
      setShirtColor(btn.getAttribute("data-color"));
    });

    document.getElementById("oe-image-upload").addEventListener("change", function (e) {
      handleImageFile(e.target.files[0]);
      e.target.value = "";
    });

    document.getElementById("oe-mockup-clear-btn").addEventListener("click", function () {
      var canvas = activeCanvas();
      canvas.getObjects().slice().forEach(function (obj) { canvas.remove(obj); });
      canvas.renderAll();
    });

    mockupStage.addEventListener("dragover", function (e) {
      e.preventDefault();
      mockupStage.classList.add("is-dragover");
    });
    mockupStage.addEventListener("dragleave", function () {
      mockupStage.classList.remove("is-dragover");
    });
    mockupStage.addEventListener("drop", function (e) {
      e.preventDefault();
      mockupStage.classList.remove("is-dragover");
      var file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleImageFile(file);
    });

    document.addEventListener("paste", function (e) {
      var items = (e.clipboardData || window.clipboardData).items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image/") === 0) {
          handleImageFile(items[i].getAsFile());
          break;
        }
      }
    });
  }

  // -----------------------------------------------------------------------
  // Draft items (the order currently being built)
  // -----------------------------------------------------------------------
  function parsePrice(str) {
    var match = String(str || "").match(/[\d.]+/);
    return match ? parseFloat(match[0]) : 0;
  }

  function draftSubtotal() {
    return draft.items.reduce(function (sum, i) { return sum + parsePrice(i.price) * i.qty; }, 0);
  }

  function setAddItemStatus(message, isError) {
    els.addItemStatus.textContent = message || "";
    els.addItemStatus.className = "cd-form-status" + (isError ? " is-error" : "");
  }

  function addItem() {
    var qty = Math.max(1, parseInt(els.qtyInput.value, 10) || 1);
    var notes = els.itemNotes.value.trim();
    var item;

    if (selectedProductIndex === null) {
      setAddItemStatus("Pick a product from the grid (or Custom) first.", true);
      return;
    }

    if (selectedProductIndex === CUSTOM_VALUE) {
      var name = els.customName.value.trim();
      var price = els.customPrice.value.trim();
      if (!name || !price) {
        setAddItemStatus("Enter both a name and a price for the custom item.", true);
        return;
      }
      item = { sku: "", name: name, price: price, color: "", size: els.customSize.value.trim(), notes: notes, qty: qty };
    } else {
      var product = allProducts[selectedProductIndex];
      if (!product) {
        setAddItemStatus("That product could not be found — try reselecting it.", true);
        return;
      }
      var colorSelect = els.variantRow.querySelector('[data-variant="color"]');
      var sizeSelect = els.variantRow.querySelector('[data-variant="size"]');
      item = {
        sku: product.sku,
        name: product.name,
        price: product.price,
        color: colorSelect ? colorSelect.value : "",
        size: sizeSelect ? sizeSelect.value : "",
        notes: notes,
        qty: qty
      };
    }

    if (hasFabric && mockupHasDesign()) {
      var design = getDesignDataUrls();
      if (design.designFront) item.designFront = design.designFront;
      if (design.designBack) item.designBack = design.designBack;
    }

    var existing = !item.designFront && !item.designBack && draft.items.find(function (i) {
      return i.sku === item.sku && i.name === item.name && i.color === item.color &&
        i.size === item.size && i.notes === item.notes && !i.designFront && !i.designBack;
    });
    if (existing) {
      existing.qty += item.qty;
    } else {
      draft.items.push(item);
    }

    saveDraft();
    renderDraftItems();
    setAddItemStatus("Added.", false);

    selectedProductIndex = null;
    productFilter = "";
    els.productSearch.value = "";
    renderProductGrid();
    els.variantRow.innerHTML = "";
    els.customFields.hidden = true;
    els.customName.value = "";
    els.customPrice.value = "";
    els.customSize.value = "";
    els.qtyInput.value = 1;
    els.itemNotes.value = "";
    if (hasFabric) resetMockup();
  }

  els.addItemBtn.addEventListener("click", addItem);

  document.querySelector(".oe-qty-stepper").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-qty-step]");
    if (!btn) return;
    var delta = parseInt(btn.getAttribute("data-qty-step"), 10);
    var next = Math.max(1, (parseInt(els.qtyInput.value, 10) || 1) + delta);
    els.qtyInput.value = next;
  });

  els.qtyInput.addEventListener("change", function () {
    els.qtyInput.value = Math.max(1, parseInt(els.qtyInput.value, 10) || 1);
  });

  function removeDraftItem(index) {
    draft.items.splice(index, 1);
    saveDraft();
    renderDraftItems();
  }

  function thumbRow(item) {
    var thumbs = [];
    if (item.designFront) thumbs.push('<img class="oe-thumb" src="' + item.designFront + '" alt="Front design" title="Front design">');
    if (item.designBack) thumbs.push('<img class="oe-thumb" src="' + item.designBack + '" alt="Back design" title="Back design">');
    return thumbs.length ? '<div class="oe-thumb-row">' + thumbs.join("") + "</div>" : "";
  }

  function renderDraftItems() {
    if (!draft.items.length) {
      els.draftItems.innerHTML = '<p class="oe-empty-note">No items added yet.</p>';
    } else {
      els.draftItems.innerHTML = draft.items.map(function (item, i) {
        var variant = [item.size, item.color].filter(Boolean).join(" / ");
        return (
          '<div class="oe-draft-item">' +
            '<div class="oe-draft-item-info">' +
              '<div class="oe-draft-item-name">' + item.qty + "x " + escapeHtml(item.name) +
                (item.sku ? " (" + escapeHtml(item.sku) + ")" : "") + " — " + escapeHtml(String(item.price)) + "</div>" +
              (variant ? '<div class="oe-draft-item-variant">' + escapeHtml(variant) + "</div>" : "") +
              (item.notes ? '<div class="oe-draft-item-notes">note: ' + escapeHtml(item.notes) + "</div>" : "") +
              thumbRow(item) +
            "</div>" +
            '<button type="button" class="oe-draft-item-remove" data-remove-index="' + i + '">Remove</button>' +
          "</div>"
        );
      }).join("");
    }
    els.subtotal.textContent = draftSubtotal().toFixed(2) + " JOD";
  }

  els.draftItems.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-remove-index]");
    if (!btn) return;
    removeDraftItem(parseInt(btn.getAttribute("data-remove-index"), 10));
  });

  // -----------------------------------------------------------------------
  // Customer / payment fields — mirrored into draft on every change so an
  // accidental reload doesn't lose what's been typed so far.
  // -----------------------------------------------------------------------
  function restoreCustomerFields() {
    els.channel.value = draft.channel || "Instagram DM";
    els.customerName.value = draft.customerName || "";
    els.customerPhone.value = draft.customerPhone || "";
    els.customerAddress.value = draft.customerAddress || "";
    els.orderNotes.value = draft.notes || "";
    var paymentRadio = document.querySelector('input[name="oe-payment"][value="' + (draft.payment || "Cash on Delivery") + '"]');
    if (paymentRadio) paymentRadio.checked = true;
    els.cliqConfirmed.checked = !!draft.cliqConfirmed;
    updateCliqRowVisibility();
  }

  function updateCliqRowVisibility() {
    var checked = document.querySelector('input[name="oe-payment"]:checked');
    els.cliqConfirmedRow.hidden = !checked || checked.value !== "CliQ";
  }

  els.channel.addEventListener("change", function () { draft.channel = els.channel.value; saveDraft(); });
  els.customerName.addEventListener("input", function () { draft.customerName = els.customerName.value; saveDraft(); });
  els.customerPhone.addEventListener("input", function () { draft.customerPhone = els.customerPhone.value; saveDraft(); });
  els.customerAddress.addEventListener("input", function () { draft.customerAddress = els.customerAddress.value; saveDraft(); });
  els.orderNotes.addEventListener("input", function () { draft.notes = els.orderNotes.value; saveDraft(); });
  els.cliqConfirmed.addEventListener("change", function () { draft.cliqConfirmed = els.cliqConfirmed.checked; saveDraft(); });
  document.querySelectorAll('input[name="oe-payment"]').forEach(function (radio) {
    radio.addEventListener("change", function () {
      draft.payment = radio.value;
      saveDraft();
      updateCliqRowVisibility();
    });
  });

  // -----------------------------------------------------------------------
  // Voice note — for when saying the order is faster than typing it.
  //
  // Recorded with MediaRecorder and kept as a data URL alongside the rest
  // of the order. Opus in a webm container is what Chrome gives us and it's
  // small (roughly 3KB per second), which matters because this all has to
  // fit in localStorage next to the design images.
  // -----------------------------------------------------------------------
  var mediaRecorder = null;
  var recordedChunks = [];
  var recordStartedAt = 0;
  var recordTimerId = null;
  var recordStream = null;

  var VOICE_SUPPORTED = !!(navigator.mediaDevices &&
    navigator.mediaDevices.getUserMedia && window.MediaRecorder);

  function formatDuration(seconds) {
    var s = Math.max(0, Math.round(seconds));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  function setVoiceHint(msg, isError) {
    els.voiceHint.textContent = msg || "";
    els.voiceHint.classList.toggle("is-error", !!isError);
  }

  function renderVoiceState() {
    var recording = mediaRecorder && mediaRecorder.state === "recording";

    els.voiceRecordBtn.classList.toggle("is-recording", !!recording);
    els.voiceBtnLabel.textContent = recording
      ? "Stop recording"
      : (draft.voiceNote ? "Re-record voice note" : "Record voice note");

    els.voiceTimer.hidden = !recording;
    els.voicePlayback.hidden = !draft.voiceNote || recording;

    if (draft.voiceNote && !recording) {
      if (els.voiceAudio.getAttribute("src") !== draft.voiceNote) {
        els.voiceAudio.src = draft.voiceNote;
      }
      setVoiceHint("Saved with this order — " + formatDuration(draft.voiceDuration) + " long.");
    } else if (!recording) {
      setVoiceHint("");
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
  }

  function startRecording() {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      recordStream = stream;
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.addEventListener("dataavailable", function (e) {
        if (e.data && e.data.size) recordedChunks.push(e.data);
      });

      mediaRecorder.addEventListener("stop", function () {
        clearInterval(recordTimerId);
        // Release the mic so the browser's recording indicator goes away.
        recordStream.getTracks().forEach(function (t) { t.stop(); });

        var seconds = (Date.now() - recordStartedAt) / 1000;
        var blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        var reader = new FileReader();
        reader.onload = function (evt) {
          draft.voiceNote = evt.target.result;
          draft.voiceDuration = seconds;
          if (saveJSON(DRAFT_KEY, draft)) {
            renderVoiceState();
          } else {
            // Storage refused it — don't pretend it was kept.
            draft.voiceNote = "";
            draft.voiceDuration = 0;
            renderVoiceState();
          }
        };
        reader.readAsDataURL(blob);
      });

      recordStartedAt = Date.now();
      mediaRecorder.start();
      renderVoiceState();
      setVoiceHint("Recording… speak the order, then press stop.");

      recordTimerId = setInterval(function () {
        els.voiceTimer.textContent = formatDuration((Date.now() - recordStartedAt) / 1000);
      }, 250);
    }).catch(function (err) {
      console.error(err);
      setVoiceHint(
        err && err.name === "NotAllowedError"
          ? "Microphone blocked. Allow mic access for this page in your browser, then try again."
          : "Couldn't start recording — no microphone found, or it's in use by another app.",
        true
      );
    });
  }

  if (!VOICE_SUPPORTED) {
    els.voiceRecordBtn.disabled = true;
    setVoiceHint("This browser can't record audio. Chrome or Edge on desktop works.", true);
  } else {
    els.voiceRecordBtn.addEventListener("click", function () {
      if (mediaRecorder && mediaRecorder.state === "recording") stopRecording();
      else startRecording();
    });
  }

  els.voiceDeleteBtn.addEventListener("click", function () {
    if (!window.confirm("Delete this voice note?")) return;
    draft.voiceNote = "";
    draft.voiceDuration = 0;
    els.voiceAudio.removeAttribute("src");
    saveDraft();
    renderVoiceState();
  });

  // -----------------------------------------------------------------------
  // Save order -> log
  // -----------------------------------------------------------------------
  function setSaveStatus(message, isError) {
    els.saveStatus.textContent = message || "";
    els.saveStatus.className = "cd-form-status" + (isError ? " is-error" : "");
  }

  function saveOrder() {
    if (!draft.items.length) {
      setSaveStatus("Add at least one item before saving.", true);
      return;
    }
    var name = els.customerName.value.trim();
    var phone = els.customerPhone.value.trim();
    if (!name || !phone) {
      setSaveStatus("Customer name and phone are required.", true);
      return;
    }

    var paymentMethod = (document.querySelector('input[name="oe-payment"]:checked') || {}).value || "Cash on Delivery";
    var order = {
      id: Date.now(),
      createdAt: new Date().toISOString(),
      channel: els.channel.value || "Other",
      customerName: name,
      customerPhone: phone,
      customerAddress: els.customerAddress.value.trim(),
      paymentMethod: paymentMethod,
      cliqConfirmed: paymentMethod === "CliQ" ? els.cliqConfirmed.checked : null,
      notes: els.orderNotes.value.trim(),
      voiceNote: draft.voiceNote || "",
      voiceDuration: draft.voiceDuration || 0,
      items: draft.items.slice(),
      subtotal: draftSubtotal()
    };

    var log = loadLog();
    log.push(order);
    // If storage is full the order isn't really saved, so don't clear the
    // form and let them think it was.
    if (!saveJSON(LOG_KEY, log)) {
      setSaveStatus("Couldn't save — this browser's storage is full. Export the log to CSV, then clear it.", true);
      return;
    }
    renderLog(log);

    draft = {
      items: [], channel: "", customerName: "", customerPhone: "", customerAddress: "",
      payment: "Cash on Delivery", cliqConfirmed: false, notes: "",
      voiceNote: "", voiceDuration: 0
    };
    saveDraft();
    renderDraftItems();
    restoreCustomerFields();
    els.voiceAudio.removeAttribute("src");
    renderVoiceState();
    setSaveStatus("Order saved to the log below.", false);
  }

  els.saveBtn.addEventListener("click", saveOrder);

  // -----------------------------------------------------------------------
  // Order log — table, copy-to-clipboard summary, CSV export
  // -----------------------------------------------------------------------
  function formatDateTime(iso) {
    var d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function itemsSummary(items) {
    return items.map(function (i) { return i.qty + "x " + i.name; }).join(", ");
  }

  function itemsDetailText(items) {
    return items.map(function (item) {
      var variant = [item.size, item.color].filter(Boolean).join(" / ");
      var line = "  " + item.qty + "x " + item.name + (item.sku ? " (" + item.sku + ")" : "") +
        (variant ? " — " + variant : "") + " — " + item.price;
      if (item.designFront || item.designBack) line += " [custom design attached]";
      return item.notes ? line + "\n    note: " + item.notes : line;
    }).join("\n");
  }

  function orderSummaryText(order) {
    var lines = [
      "Ember Order — " + new Date(order.createdAt).toLocaleString(),
      "Customer: " + order.customerName + " (" + order.customerPhone + ")",
      "Channel: " + order.channel,
      "Address: " + (order.customerAddress || "—"),
      "Payment: " + order.paymentMethod + (order.paymentMethod === "CliQ" ? (order.cliqConfirmed ? " (confirmed)" : " (awaiting screenshot)") : ""),
      "",
      "Items:",
      itemsDetailText(order.items),
      "",
      "Subtotal: " + order.subtotal.toFixed(2) + " JOD",
      "Notes: " + (order.notes || "—"),
      order.voiceNote
        ? "Voice note: " + formatDuration(order.voiceDuration) + " (play it in the order log)"
        : ""
    ].filter(Boolean);
    return lines.join("\n");
  }

  function copyOrderSummary(order) {
    var text = orderSummaryText(order);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try { document.execCommand("copy"); } catch (e) { /* no-op */ }
    document.body.removeChild(textarea);
  }

  function deleteLogEntry(id) {
    if (!window.confirm("Delete this order from the log? This can't be undone.")) return;
    var log = loadLog().filter(function (o) { return o.id !== id; });
    saveLog(log);
    renderLog(log);
  }

  function orderDesignThumbs(order) {
    var thumbs = [];
    order.items.forEach(function (item) {
      if (item.designFront) thumbs.push(item.designFront);
      if (item.designBack) thumbs.push(item.designBack);
    });
    if (!thumbs.length) return "";
    return '<div class="oe-thumb-row">' + thumbs.map(function (src) {
      return '<a href="' + src + '" target="_blank" rel="noopener"><img class="oe-thumb" src="' + src + '" alt="Design"></a>';
    }).join("") + "</div>";
  }

  function renderLog(log) {
    if (!log.length) {
      els.logBody.innerHTML = '<tr><td colspan="8" class="oe-empty-note">No orders logged yet.</td></tr>';
      return;
    }
    var rows = log.slice().reverse().map(function (order) {
      var paymentTag = "";
      if (order.paymentMethod === "CliQ") {
        paymentTag = order.cliqConfirmed
          ? '<span class="oe-log-tag">Confirmed</span>'
          : '<span class="oe-log-tag is-pending">Pending</span>';
      }
      return (
        "<tr>" +
          "<td>" + formatDateTime(order.createdAt) + "</td>" +
          "<td><div class=\"oe-log-customer-name\">" + escapeHtml(order.customerName) + "</div>" +
            "<div class=\"oe-log-customer-phone\">" + escapeHtml(order.customerPhone) + "</div></td>" +
          "<td>" + escapeHtml(order.channel) + "</td>" +
          "<td>" + escapeHtml(itemsSummary(order.items)) + "</td>" +
          "<td>" + orderDesignThumbs(order) +
            (order.voiceNote
              ? '<audio class="oe-log-audio" src="' + order.voiceNote + '" controls preload="none"></audio>'
              : "") +
          "</td>" +
          "<td>" + order.subtotal.toFixed(2) + " JOD</td>" +
          "<td>" + escapeHtml(order.paymentMethod) + paymentTag + "</td>" +
          "<td><div class=\"oe-log-row-actions\">" +
            "<button type=\"button\" class=\"oe-row-btn\" data-copy-id=\"" + order.id + "\">Copy</button>" +
            "<button type=\"button\" class=\"oe-row-btn\" data-delete-id=\"" + order.id + "\">Delete</button>" +
          "</div></td>" +
        "</tr>"
      );
    });
    els.logBody.innerHTML = rows.join("");
  }

  els.logBody.addEventListener("click", function (e) {
    var copyBtn = e.target.closest("[data-copy-id]");
    if (copyBtn) {
      var order = loadLog().find(function (o) { return o.id === parseInt(copyBtn.getAttribute("data-copy-id"), 10); });
      if (order) {
        copyOrderSummary(order);
        var original = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        setTimeout(function () { copyBtn.textContent = original; }, 1500);
      }
      return;
    }
    var deleteBtn = e.target.closest("[data-delete-id]");
    if (deleteBtn) {
      deleteLogEntry(parseInt(deleteBtn.getAttribute("data-delete-id"), 10));
    }
  });

  function csvField(value) {
    var str = String(value === undefined || value === null ? "" : value);
    if (/[",\n]/.test(str)) {
      str = '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function exportCsv() {
    var log = loadLog();
    var header = ["Date/Time", "Channel", "Customer Name", "Phone", "Address", "Payment Method", "CliQ Confirmed", "Items", "Design", "Voice Note", "Subtotal", "Notes"];
    var rows = log.map(function (order) {
      var itemsText = order.items.map(function (item) {
        var variant = [item.size, item.color].filter(Boolean).join(" / ");
        return item.qty + "x " + item.name + (item.sku ? " (" + item.sku + ")" : "") + (variant ? " - " + variant : "");
      }).join(" | ");
      var hasFront = order.items.some(function (i) { return i.designFront; });
      var hasBack = order.items.some(function (i) { return i.designBack; });
      var designNote = [hasFront ? "Front" : "", hasBack ? "Back" : ""].filter(Boolean).join("+");
      return [
        new Date(order.createdAt).toLocaleString(),
        order.channel,
        order.customerName,
        order.customerPhone,
        order.customerAddress,
        order.paymentMethod,
        order.paymentMethod === "CliQ" ? (order.cliqConfirmed ? "Yes" : "No") : "",
        itemsText,
        designNote,
        // Audio can't live in a CSV cell — this just flags that the order
        // log still holds one, playable in the table.
        order.voiceNote ? "Yes (" + Math.round(order.voiceDuration || 0) + "s)" : "",
        order.subtotal.toFixed(2),
        order.notes
      ].map(csvField).join(",");
    });
    var csv = [header.map(csvField).join(",")].concat(rows).join("\r\n");

    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "ember-orders-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  els.exportBtn.addEventListener("click", exportCsv);

  els.clearLogBtn.addEventListener("click", function () {
    if (!window.confirm("Clear the entire order log from this browser? Export CSV first if you want a backup — this can't be undone.")) return;
    saveLog([]);
    renderLog([]);
  });

  // -----------------------------------------------------------------------
  // Init
  // -----------------------------------------------------------------------
  restoreCustomerFields();
  renderDraftItems();
  renderVoiceState();
  renderLog(loadLog());
  renderProductGrid();

  fetch(sheetUrl())
    .then(function (res) {
      if (!res.ok) throw new Error("Sheet request failed (" + res.status + ")");
      return res.text();
    })
    .then(function (text) {
      allProducts = parseGvizResponse(text).map(toProduct);
      renderProductGrid();
    })
    .catch(function (err) {
      console.error(err);
      els.productGrid.innerHTML = '<div class="oe-grid-empty">Couldn\'t load products — check your connection.</div>';
    });
})();
