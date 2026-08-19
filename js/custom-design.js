(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // EmailJS setup — required before this form can actually send anything.
  // Create a free account at https://www.emailjs.com, then:
  //   1. Add an Email Service (e.g. Gmail) -> copy its Service ID below.
  //   2. Create an Email Template with these variables in the body:
  //        {{from_name}} {{from_email}} {{from_phone}} {{notes}} {{design_image}}
  //      For design_image, use an HTML template and insert:
  //        <img src="{{design_image}}" style="max-width:400px" />
  //   3. Copy the Template ID and your account's Public Key below.
  //
  //   NOTE: values are base64-wrapped (same pattern as js/store-products.js)
  //   so they're not plain-text in the page source. That's cosmetic, not
  //   real security — EmailJS's Public Key is meant to be client-side; the
  //   actual protection against abuse is the domain allowlist in your
  //   EmailJS dashboard (Account -> Security).
  //
  //   Template variables (this form sends both views now that we have
  //   real front/back mockup photos):
  //     {{from_name}} {{from_email}} {{from_phone}} {{notes}} {{shirt_color}}
  //     {{design_image_front}} {{design_image_back}}
  //   Connected 2026-07: template "Custom Design" in the EmailJS dashboard.
  // ---------------------------------------------------------------------
  var EMAILJS_PUBLIC_KEY = atob("azNKaUE1NXY4RktfWU9uVlU=");
  var EMAILJS_SERVICE_ID = atob("c2VydmljZV8ycXlpdHh3");
  var EMAILJS_TEMPLATE_ID = atob("dGVtcGxhdGVfZnl0bzlycw==");

  var SHIRT_WIDTH = 400;
  var SHIRT_HEIGHT = 580;

  // Colours, their labels and their mockup files all come from
  // js/shirt-colors.js so this page and the store can't drift apart — a
  // customer designing a "Woody Green" shirt has to mean the same thing
  // here as it does on a store order.
  function colorLabel(key) {
    var c = window.EmberShirts.resolve(key);
    return c ? c.label : key;
  }

  function mockupUrl(color, view) {
    return window.EmberShirts.mockup(color, view);
  }

  var canvasFront = new fabric.Canvas("design-canvas-front", {
    width: SHIRT_WIDTH,
    height: SHIRT_HEIGHT,
    preserveObjectStacking: true
  });
  var canvasBack = new fabric.Canvas("design-canvas-back", {
    width: SHIRT_WIDTH,
    height: SHIRT_HEIGHT,
    preserveObjectStacking: true
  });

  // White base under the shirt photo so JPEG export (which can't do
  // transparency) doesn't render letterbox edges as black.
  canvasFront.backgroundColor = "#ffffff";
  canvasBack.backgroundColor = "#ffffff";

  canvasBack.wrapperEl.style.display = "none";

  var currentShirtColor = "white";
  var currentView = "front";

  function activeCanvas() {
    return currentView === "front" ? canvasFront : canvasBack;
  }

  function loadShirtBg(canvas, color, view) {
    // crossOrigin: "anonymous" is required now that most mockups are
    // S3-hosted, not local. Without it, Fabric's <img> never requests CORS
    // mode, so the canvas reads as tainted regardless of the bucket's own
    // CORS config — and toDataURL() on submit throws a SecurityError that
    // silently kills "Send My Design" for every colour, not just one.
    fabric.Image.fromURL(mockupUrl(color, view), function (img) {
      // Contain-fit + center rather than stretch — mockup photos aren't all
      // the same aspect ratio (e.g. "stressed" is a different shoot than
      // the rest), so a uniform scale avoids squashing the shirt shape.
      var scale = Math.min(SHIRT_WIDTH / img.width, SHIRT_HEIGHT / img.height);
      img.set({
        scaleX: scale,
        scaleY: scale,
        left: (SHIRT_WIDTH - img.width * scale) / 2,
        top: (SHIRT_HEIGHT - img.height * scale) / 2,
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

  setShirtColor(currentShirtColor);

  // --- fit the stage to the viewport -------------------------------------
  // The canvas keeps its 400x580 internal resolution, so object coordinates,
  // the print area below, and the emailed export are all unaffected. Only
  // the CSS box shrinks. Fabric's getPointer divides by the ratio between
  // internal size and rendered size, so dragging still lands where the
  // customer touched.
  function fitCanvases() {
    var wrap = document.querySelector(".cd-stage-wrap");
    if (!wrap) return;

    var available = wrap.clientWidth;
    if (!available) return;

    var w = Math.min(available, SHIRT_WIDTH);
    var h = Math.round(w * (SHIRT_HEIGHT / SHIRT_WIDTH));

    [canvasFront, canvasBack].forEach(function (canvas) {
      canvas.setDimensions({ width: w + "px", height: h + "px" }, { cssOnly: true });
      // The hidden view has no layout box, so its offsets go stale; recompute
      // both so switching front/back does not need a resize to become
      // clickable again.
      canvas.calcOffset();
    });
  }

  fitCanvases();
  window.addEventListener("resize", fitCanvases);
  window.addEventListener("orientationchange", fitCanvases);

  document.getElementById("view-toggle").addEventListener("click", function (e) {
    var btn = e.target.closest(".cd-view-btn");
    if (!btn) return;
    var view = btn.getAttribute("data-view");
    if (view === currentView) return;
    currentView = view;
    document.querySelectorAll(".cd-view-btn").forEach(function (b) {
      var isActive = b === btn;
      b.classList.toggle("is-active", isActive);
      b.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    canvasFront.wrapperEl.style.display = view === "front" ? "" : "none";
    canvasBack.wrapperEl.style.display = view === "back" ? "" : "none";
    // The view that was hidden had no box to measure while it was off, so
    // its pointer offsets are stale until it is on screen again.
    fitCanvases();
  });

  // Print-safe area roughly matching the shirt's chest panel in the photo.
  var PRINT_AREA = { left: 141, top: 209, width: 112, height: 116 };

  // --- shirt colour swatches, built from the shared colour list ----------
  var swatchWrap = document.getElementById("shirt-swatches");
  var colorNameEl = document.getElementById("shirt-color-name");

  (function buildSwatches() {
    var html = [];
    var washedStarted = false;
    window.EmberShirts.all.forEach(function (c) {
      // The washed fabrics are a different product, not just another
      // colour, so they get split off behind a label.
      if (c.washed && !washedStarted) {
        washedStarted = true;
        html.push('<span class="cd-swatch-divider" aria-hidden="true"></span>');
        html.push('<span class="cd-swatch-group-label">Washed</span>');
      }
      html.push(
        '<button type="button" class="cd-swatch' + (c.washed ? " is-washed" : "") +
          (c.key === currentShirtColor ? " is-active" : "") +
          '" data-color="' + c.key + '" style="background:' + c.swatch +
          '" title="' + c.label + '" aria-label="' + c.label + '"></button>'
      );
    });
    swatchWrap.innerHTML = html.join("");
    colorNameEl.textContent = colorLabel(currentShirtColor);
  })();

  swatchWrap.addEventListener("click", function (e) {
    var btn = e.target.closest(".cd-swatch");
    if (!btn) return;
    swatchWrap.querySelectorAll(".cd-swatch").forEach(function (s) { s.classList.remove("is-active"); });
    btn.classList.add("is-active");
    setShirtColor(btn.getAttribute("data-color"));
    colorNameEl.textContent = colorLabel(currentShirtColor);
  });

  // --- size dropdown, same S–5XL ladder the store uses -------------------
  (function buildSizes() {
    var sel = document.getElementById("cust-size");
    if (!sel) return;
    var opts = ['<option value="">Select size…</option>'];
    window.EmberShirts.SIZES.forEach(function (s) {
      opts.push('<option value="' + s + '">' + s + "</option>");
    });
    sel.innerHTML = opts.join("");
  })();

  // --- add text ----------------------------------------------------------
  var textInput = document.getElementById("text-input");
  var addTextBtn = document.getElementById("add-text-btn");
  var addTextLabel = document.getElementById("add-text-label");
  var addTextTimer = null;

  // The button stays disabled until there's something to add, so it's
  // obvious that typing comes first rather than the click doing nothing.
  function syncAddTextBtn() {
    addTextBtn.disabled = !textInput.value.trim();
  }

  function addText() {
    var value = textInput.value.trim();
    if (!value) return;

    pushHistory();
    var canvas = activeCanvas();
    var text = new fabric.IText(value, {
      left: PRINT_AREA.left + PRINT_AREA.width / 2,
      top: PRINT_AREA.top + PRINT_AREA.height / 2,
      originX: "center",
      originY: "center",
      fontFamily: document.getElementById("font-select").value,
      fill: document.getElementById("text-color").value,
      fontSize: 28
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();

    textInput.value = "";
    syncAddTextBtn();

    // Confirm it landed — the shirt preview is off to the side, so without
    // this it isn't obvious the click did anything.
    clearTimeout(addTextTimer);
    addTextLabel.textContent = "Added — drag it on the shirt";
    addTextBtn.classList.add("is-done");
    addTextTimer = setTimeout(function () {
      addTextLabel.textContent = "Add text to shirt";
      addTextBtn.classList.remove("is-done");
    }, 2200);
  }

  textInput.addEventListener("input", syncAddTextBtn);
  textInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      addText();
    }
  });
  addTextBtn.addEventListener("click", addText);
  syncAddTextBtn();

  document.getElementById("text-color").addEventListener("input", function (e) {
    var active = activeCanvas().getActiveObject();
    if (active && active.type === "i-text") {
      active.set("fill", e.target.value);
      activeCanvas().renderAll();
    }
  });

  document.getElementById("font-select").addEventListener("change", function (e) {
    var active = activeCanvas().getActiveObject();
    if (active && active.type === "i-text") {
      active.set("fontFamily", e.target.value);
      activeCanvas().renderAll();
    }
  });

  document.getElementById("image-upload").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (evt) {
      fabric.Image.fromURL(evt.target.result, function (img) {
        pushHistory();
        var canvas = activeCanvas();
        var maxDim = 150;
        var scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
        img.set({
          left: PRINT_AREA.left + PRINT_AREA.width / 2,
          top: PRINT_AREA.top + PRINT_AREA.height / 2,
          originX: "center",
          originY: "center",
          scaleX: scale,
          scaleY: scale
        });
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.renderAll();
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  });

  document.getElementById("delete-btn").addEventListener("click", function () {
    var canvas = activeCanvas();
    var active = canvas.getActiveObject();
    if (!active) return;
    pushHistory();
    canvas.remove(active);
    canvas.renderAll();
  });

  document.getElementById("clear-btn").addEventListener("click", function () {
    var canvas = activeCanvas();
    if (!canvas.getObjects().length) return;
    pushHistory();
    canvas.getObjects().slice().forEach(function (obj) { canvas.remove(obj); });
    canvas.renderAll();
  });

  // ---------------------------------------------------------------------
  // Undo
  //
  // "Clear entire design" wiped both a customer's text and their uploaded
  // artwork with no way back, which is a lot of work to lose to one
  // mis-click. Snapshots are per view, because front and back are separate
  // canvases and undoing on one should not touch the other.
  //
  // Only the objects are serialised, not the shirt background — that is
  // reapplied from the colour, so keeping it would double the payload and
  // risk restoring a stale mockup after a colour change.
  // ---------------------------------------------------------------------
  var HISTORY_LIMIT = 25;
  var undoStacks = { front: [], back: [] };
  var undoBtn = document.getElementById("undo-btn");

  function snapshot(canvas) {
    return JSON.stringify(canvas.getObjects().map(function (o) { return o.toObject(); }));
  }

  function syncUndoBtn() {
    if (undoBtn) undoBtn.disabled = !undoStacks[currentView].length;
  }

  function pushHistory() {
    var stack = undoStacks[currentView];
    stack.push(snapshot(activeCanvas()));
    if (stack.length > HISTORY_LIMIT) stack.shift();
    syncUndoBtn();
  }

  function undo() {
    var stack = undoStacks[currentView];
    if (!stack.length) return;
    var canvas = activeCanvas();
    var state = stack.pop();
    canvas.getObjects().slice().forEach(function (obj) { canvas.remove(obj); });
    fabric.util.enlivenObjects(JSON.parse(state), function (objects) {
      objects.forEach(function (o) { canvas.add(o); });
      canvas.discardActiveObject();
      canvas.renderAll();
      syncUndoBtn();
    });
  }

  if (undoBtn) undoBtn.addEventListener("click", undo);

  document.addEventListener("keydown", function (e) {
    // Ignore it while someone is typing in the text field or the contact
    // form — there, Ctrl+Z belongs to the input.
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
    }
  });

  syncUndoBtn();

  // ---------------------------------------------------------------------
  // Submission
  // ---------------------------------------------------------------------
  if (window.emailjs && EMAILJS_PUBLIC_KEY !== "YOUR_PUBLIC_KEY") {
    emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
  }

  var form = document.getElementById("design-form");
  var statusEl = document.getElementById("form-status");
  var submitBtn = document.getElementById("submit-btn");

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var name = document.getElementById("cust-name").value.trim();
    var email = document.getElementById("cust-email").value.trim();
    var phone = document.getElementById("cust-phone").value.trim();
    var notes = document.getElementById("cust-notes").value.trim();
    var sizeEl = document.getElementById("cust-size");
    var size = sizeEl ? sizeEl.value : "";
    var qty = Math.max(1, parseInt(document.getElementById("cust-qty").value, 10) || 1);

    if (!name || !email || !phone) {
      statusEl.textContent = "Please fill in your name, email, and phone.";
      statusEl.className = "cd-form-status is-error";
      return;
    }

    // Size used to be buried in the optional notes box, so custom orders
    // could arrive with no size at all. It's now a required choice.
    if (!size) {
      statusEl.textContent = "Please choose a size.";
      statusEl.className = "cd-form-status is-error";
      if (sizeEl) sizeEl.focus();
      return;
    }

    // JPEG, not PNG: EmailJS free tier caps the whole request at ~50KB.
    // A PNG of the canvas is ~216KB per view; JPEG at 0.8 is ~17KB.
    var designImageFront = canvasFront.toDataURL({ format: "jpeg", quality: 0.8 });
    var designImageBack = canvasBack.toDataURL({ format: "jpeg", quality: 0.8 });

    if (!window.emailjs || EMAILJS_PUBLIC_KEY === "YOUR_PUBLIC_KEY") {
      // Reachable if the EmailJS CDN script fails to load, so this has to
      // read as customer copy, not a setup note.
      console.error("EmailJS unavailable — CDN blocked/offline, or keys not set in js/custom-design.js.");
      statusEl.textContent = "We can't send your design right now. Please try again, or reach us on WhatsApp at 0790026860.";
      statusEl.className = "cd-form-status is-error";
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";
    statusEl.textContent = "";
    statusEl.className = "cd-form-status";

    emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      from_name: name,
      from_email: email,
      from_phone: phone,
      notes: notes || "—",
      shirt_color: colorLabel(currentShirtColor),
      shirt_size: size,
      quantity: qty,
      design_image_front: designImageFront,
      design_image_back: designImageBack
    }).then(function () {
      if (window.EmberPixel) window.EmberPixel.lead("custom-design");
      statusEl.textContent = "Sent! We'll reach out to confirm your custom piece.";
      statusEl.className = "cd-form-status is-success";
      submitBtn.textContent = "Send My Design";
      submitBtn.disabled = false;
      form.reset();
    }).catch(function (err) {
      statusEl.textContent = "Something went wrong sending your design. Please try again.";
      statusEl.className = "cd-form-status is-error";
      submitBtn.textContent = "Send My Design";
      submitBtn.disabled = false;
      console.error(err);
    });
  });
})();
