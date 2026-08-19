(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Google Sheet setup — required before real products will show up.
  //   1. Create a Google Sheet with one row of headers, then one row per
  //      product. Column names (case-insensitive, any order):
  //        Name | SKU | Price | Description | Category | Colors | Sizes |
  //        Image | InStock
  //      - SKU: short reference code (e.g. EMB-001) so you can tell orders
  //        apart when customers message you through the contact form.
  //      - Category: must match one of t-shirts, hoodies, uniform,
  //        keychains, posters, accessories. The store page groups these
  //        under four top-level filters (Clothing, Uniform, Merch,
  //        Accessories) — see CATEGORY_GROUPS below if you add a new
  //        category and need to place it in a group.
  //      - Colors / Sizes: comma-separated (e.g. "Black, White, Olive").
  //      - Image: one or more full AWS S3 URLs, comma-separated if you
  //        have more than one photo (e.g. front, back). The first one is
  //        used as the card thumbnail; all of them show in the "Buy This"
  //        popup gallery.
  //      - InStock: optional — put FALSE to hide a product without
  //        deleting its row.
  //      Optional extra column if you want it: BuyLink (where "Buy Now"
  //      goes; leave blank/omit to default to the contact form).
  //   2. File -> Share -> General access -> "Anyone with the link" (Viewer).
  //   3. Copy the Sheet ID from its URL:
  //        https://docs.google.com/spreadsheets/d/THIS_PART_HERE/edit
  //   4. Paste it below. If your product data isn't on the first tab,
  //      also set SHEET_NAME to that tab's exact name.
  //
  //   NOTE: the sheet ID/gid are base64-encoded below rather than left as
  //   plain text. This is NOT real security — anyone who opens DevTools
  //   and looks at the actual network request can still see the sheet ID
  //   (and the sheet's data is already shown on this page anyway). It
  //   just keeps the value from being plainly readable/searchable in the
  //   page source. See atob()/btoa() if you need to update these by hand.
  // ---------------------------------------------------------------------
  var SHEET_ID = atob("MXpfWEpwc0U5WVctS2V6cWdqc2pIZ3AxY19ZNHdrdDVYb2piTmJWZWNWdkU=");
  var SHEET_NAME = "";
  var SHEET_GID = atob("MTg0ODY4NTAzMQ==");

  // Column aliases, so the page keeps working if the sheet's headers get
  // renamed. The plain names below (name/sku/price/...) are what this
  // sheet uses; the extra spellings match a Shopify product export, which
  // is the other layout this catalogue has been kept in.
  var COLUMN_ALIASES = {
    name: ["name", "title", "producttitle"],
    sku: ["sku", "variantsku"],
    price: ["price", "variantprice"],
    description: ["description", "bodyhtml"],
    category: ["category", "type", "producttype", "productcategory"],
    colors: ["colors", "color", "option1value", "option2value"],
    sizes: ["sizes", "size"],
    // The design artwork itself — laid over a shirt mockup at display time.
    image: ["image", "design", "artwork", "productimageurl", "imagesrc", "variantimageurl"],
    // Real photographs of the finished product. Comma-separate several.
    // These don't replace the mockup on the card; they're extra thumbnails
    // in the "Buy This" popup.
    photos: ["photos", "photo", "gallery", "productphotos", "extraimages"],
    inStock: ["instock", "publishedononlinestore", "published", "status"],
    buyLink: ["buylink"]
  };

  // Categories are NOT defined here — the filter buttons are built from
  // whatever distinct values appear in the sheet's Category column. Add a
  // category by typing it on a product row; remove one by clearing it from
  // every row that used it and its button disappears on the next load.
  // Buttons appear in the order the categories are first met going down
  // the sheet, so row order controls button order.

  // Shown instead of real products only while SHEET_ID above is still the
  // placeholder value, so the page has something to design/preview against.
  // Delete this whole array once your real Google Sheet is connected.
  var PLACEHOLDER_PRODUCTS = [
    { name: "Amman Sight Tee", sku: "EMB-001", price: "18 JOD", category: "t-shirts", colors: "Black, White, Olive", sizes: "S, M, L, XL", image: "images/team-01.webp", description: "Amman Sight Tee", buyLink: "", inStock: true },
    { name: "Heavy Hoodie", sku: "EMB-002", price: "32 JOD", category: "hoodies", colors: "Black", sizes: "M, L, XL", image: "images/team-02.webp", description: "Heavy Hoodie", buyLink: "", inStock: true },
    { name: "Savage Tee", sku: "EMB-003", price: "18 JOD", category: "t-shirts", colors: "Black, Ash", sizes: "S, M, L, XL", image: "images/team-03.webp", description: "Savage Tee", buyLink: "", inStock: true },
    { name: "Ember Keychain", sku: "EMB-004", price: "6 JOD", category: "keychains", colors: "", sizes: "", image: "images/service-02.webp", description: "Ember Keychain", buyLink: "", inStock: true }
  ];

  var statusEl = document.getElementById("store-status");
  var gridEl = document.getElementById("product-grid");
  var filterBar = document.getElementById("store-filter-bar");
  var sortEl = document.getElementById("store-sort");
  var countEl = document.getElementById("store-count");

  // Skeleton cards while the sheet request is in flight. A single line of
  // "Loading products..." gave no sense of what was coming or how much;
  // placeholders the same shape as a real card mean the grid does not jump
  // when the data lands.
  var SKELETON_COUNT = 8;

  function renderSkeletons() {
    if (!gridEl) return;
    var card =
      '<div class="product-card product-card-skeleton" aria-hidden="true">' +
        '<div class="skeleton skeleton-thumb"></div>' +
        '<div class="skeleton skeleton-line skeleton-line-name"></div>' +
        '<div class="skeleton skeleton-line skeleton-line-price"></div>' +
        '<div class="skeleton skeleton-btn"></div>' +
      "</div>";
    gridEl.innerHTML = new Array(SKELETON_COUNT + 1).join(card);
    // Announced separately, because the skeletons themselves are hidden
    // from assistive tech — there is nothing useful in them to read out.
    gridEl.setAttribute("aria-busy", "true");
  }

  var allProducts = [];
  var visibleProducts = [];
  var categories = [];        // built from the sheet on load

  // ?category=uniform lets the nav's UNIFORM item land on a filtered store
  // rather than the same unfiltered grid as STORE. Falls back to "all" if
  // the sheet has no such category, so a stale link is never a dead end.
  var activeCategory = (function () {
    try {
      var q = new URLSearchParams(window.location.search).get("category");
      return q ? q.trim().toLowerCase() : "all";
    } catch (e) {
      return "all";
    }
  })();

  function sheetUrl() {
    var url = "https://docs.google.com/spreadsheets/d/" + SHEET_ID + "/gviz/tq?tqx=out:json";
    if (SHEET_GID) url += "&gid=" + encodeURIComponent(SHEET_GID);
    else if (SHEET_NAME) url += "&sheet=" + encodeURIComponent(SHEET_NAME);
    return url;
  }

  function normalizeKey(label) {
    return String(label || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  // Unlike normalizeKey (used for matching Sheet column headers), this
  // preserves hyphens — category values like "t-shirts" need to survive
  // intact to match the filter pills' data-group/data-subcategory values.
  function normalizeCategory(str) {
    return String(str || "").trim().toLowerCase();
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
      var obj = { __cols: cols };
      row.c.forEach(function (cell, i) {
        obj[cols[i]] = cell ? (cell.f !== undefined ? cell.f : cell.v) : "";
        // Keep a positional copy too. The product-name header in the sheet
        // has a pasted URL sitting in it instead of the word "Title", so
        // the name can only be found by position.
        obj["__col" + i] = obj[cols[i]];
      });
      return obj;
    });
  }

  // Returns the first alias that actually carries a value for this row.
  function pick(row, field) {
    var aliases = COLUMN_ALIASES[field] || [];
    for (var i = 0; i < aliases.length; i++) {
      var v = row[aliases[i]];
      if (v !== undefined && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  }

  // "11" -> "11 JOD". A price typed with its own currency is left alone.
  function formatPrice(raw) {
    if (!raw) return "";
    return /[a-z]/i.test(raw) ? raw : raw + " JOD";
  }

  // Lower-cased and trimmed only, so "T-Shirts" and "t-shirts" count as one
  // category — but otherwise whatever is typed in the sheet is respected.
  function toCategoryKey(raw) {
    return normalizeCategory(raw);
  }

  // "t-shirts" -> "T-SHIRTS" for the button face.
  function categoryLabel(key) {
    return String(key || "").toUpperCase();
  }

  // Distinct categories, in the order they're first met going down the
  // sheet — so row order decides button order.
  function collectCategories(products) {
    var found = [];
    products.forEach(function (p) {
      if (!p.inStock || !p.category) return;
      if (found.indexOf(p.category) === -1) found.push(p.category);
    });
    return found;
  }

  // A ?category= value that the sheet does not actually contain would
  // otherwise render an empty grid with no way back, since the filter bar
  // hides itself when there is nothing to filter between.
  function validateActiveCategory() {
    if (activeCategory !== "all" && categories.indexOf(activeCategory) === -1) {
      activeCategory = "all";
    }
  }

  function renderFilterBar() {
    if (!filterBar) return;

    // With one category (or none) there's nothing to filter between, so the
    // bar would just be noise.
    if (categories.length < 2) {
      filterBar.innerHTML = "";
      filterBar.hidden = true;
      return;
    }
    filterBar.hidden = false;

    var buttons = ['<button type="button" class="filter-btn w-button' +
      (activeCategory === "all" ? " is-active" : "") + '" data-category="all">ALL</button>'];

    categories.forEach(function (c) {
      buttons.push(
        '<button type="button" class="filter-btn w-button' +
          (activeCategory === c ? " is-active" : "") +
          '" data-category="' + escapeAttr(c) + '">' + escapeHtml(categoryLabel(c)) + "</button>"
      );
    });

    filterBar.innerHTML = buttons.join("");
  }

  function toProduct(row) {
    // Shopify writes TRUE/FALSE for "Published on online store" and
    // Active/Draft/Archived for "Status"; the older simple sheet used
    // an InStock column. Treat all the negative spellings as hidden.
    var stockRaw = pick(row, "inStock").toLowerCase();
    var hidden = ["false", "0", "no", "draft", "archived"].indexOf(stockRaw) !== -1;

    var images = splitList(pick(row, "image"));

    return {
      // Falls back to the first column, which holds the product names even
      // though its header cell doesn't say "Title".
      name: pick(row, "name") || String(row.__col0 || "").trim() || "Untitled",
      sku: pick(row, "sku"),
      price: formatPrice(pick(row, "price")),
      category: toCategoryKey(pick(row, "category")),
      colors: pick(row, "colors"),
      // Blank cell = the full S–5XL ladder.
      sizes: window.EmberShirts.sizesFor(pick(row, "sizes")),
      images: images,
      image: images[0] || "",
      description: pick(row, "description"),
      buyLink: pick(row, "buyLink"),
      inStock: !hidden,
      // Which shirt colours this design is offered in. Blank cell = all.
      availableColors: window.EmberShirts.availableFor(pick(row, "colors")),
      // Real product photography, shown alongside the generated mockup.
      photos: splitList(pick(row, "photos"))
    };
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function escapeAttr(str) {
    return escapeHtml(str);
  }

  // -----------------------------------------------------------------------
  // Grid
  // -----------------------------------------------------------------------
  // Prices arrive as free text ("12 JOD", "18.50 JOD"), so sorting has to
  // pull the number out rather than compare strings — otherwise "9 JOD"
  // sorts above "18 JOD".
  function sortProducts(list) {
    var mode = sortEl ? sortEl.value : "default";
    if (mode === "default") return list;

    var byName = function (a, b) { return a.name.localeCompare(b.name); };
    var byPrice = function (a, b) {
      return window.EmberCart.parsePrice(a.price) - window.EmberCart.parsePrice(b.price);
    };

    var sorted = list.slice();
    if (mode === "name-asc") sorted.sort(byName);
    else if (mode === "name-desc") sorted.sort(byName).reverse();
    else if (mode === "price-asc") sorted.sort(byPrice);
    else if (mode === "price-desc") sorted.sort(byPrice).reverse();
    return sorted;
  }

  function renderProducts() {
    visibleProducts = allProducts.filter(function (p) {
      if (!p.inStock) return false;
      if (activeCategory === "all") return true;
      return p.category === activeCategory;
    });
    visibleProducts = sortProducts(visibleProducts);

    gridEl.setAttribute("aria-busy", "false");

    if (!visibleProducts.length) {
      gridEl.innerHTML = "";
      if (countEl) countEl.hidden = true;
      statusEl.textContent = activeCategory === "all"
        ? "Nothing in the store just yet. Check back soon."
        : "No products in this category yet.";
      statusEl.hidden = false;
      return;
    }

    statusEl.hidden = true;

    if (countEl) {
      countEl.textContent = visibleProducts.length === 1
        ? "1 piece"
        : visibleProducts.length + " pieces";
      countEl.hidden = false;
    }
    gridEl.innerHTML = visibleProducts.map(function (p, i) {
      return (
        '<div class="product-card" data-product-index="' + i + '">' +
          productThumb(p, i) +
          '<div class="product-name">' + escapeHtml(p.name) + "</div>" +
          (p.price ? '<div class="product-price">' + escapeHtml(String(p.price)) + "</div>" : "") +
          '<div class="div-block-3">' +
            '<button type="button" class="buy-now w-button add-btn buy-this-btn" data-product-index="' + i + '">Buy This</button>' +
            '<button type="button" class="div-block-4 quick-add-btn" data-product-index="' + i + '" aria-label="Quick add to cart"><img src="images/cart.svg" loading="lazy" width="21" alt=""></button>' +
          "</div>" +
        "</div>"
      );
    }).join("");
  }

  var PLACEHOLDER_MARK = "images/Artboard-12_1.svg";

  function emptyThumbMarkup(name, index) {
    return (
      '<div class="product-image product-image-empty" data-product-index="' + index + '" role="img" aria-label="' +
        escapeAttr(name) + ' — photo coming soon">' +
        '<img src="' + PLACEHOLDER_MARK + '" alt="" aria-hidden="true">' +
        "<span>Photo coming soon</span>" +
      "</div>"
    );
  }

  // Builds the shirt-plus-artwork preview. The sheet's Image column holds
  // the design on its own, so the shirt underneath is a mockup chosen from
  // that row's Colors cell — meaning one artwork file covers every colour.
  function shirtShotMarkup(product, colorObj, opts) {
    opts = opts || {};
    var view = opts.view === "back" ? "back" : "front";
    var area = window.EmberShirts.printAreaFor(colorObj);
    var back = view === "back";

    // The artwork drops into a fixed box (see PRINT_AREA in shirt-colors.js)
    // rather than being sized from its own proportions — that's what lets
    // placement be controlled in the design file instead of here.
    // A back print sits a little lower and runs wider than a chest print.
    var designStyle =
      "left:" + area.centerX + "%;" +
      "top:" + (back ? area.centerY + 4 : area.centerY) + "%;" +
      "width:" + (back ? area.width * 1.35 : area.width) + "%;" +
      "aspect-ratio:" + (area.ratio || "3 / 4") + ";";

    // On the grid, a product that has real photography reveals its first
    // photo on hover — the mockup stays the resting state so the grid
    // reads consistently even before everything has been photographed.
    var hoverLayer = "";
    if (opts.hoverPhoto) {
      hoverLayer =
        '<img class="shirt-shot-hover" src="' + escapeAttr(opts.hoverPhoto) +
          '" alt="" aria-hidden="true" loading="lazy">';
    }

    return (
      '<div class="shirt-shot' + (opts.className ? " " + opts.className : "") + '"' +
        (opts.index !== undefined ? ' data-product-index="' + opts.index + '"' : "") + ">" +
        '<img class="shirt-shot-base" src="' + escapeAttr(window.EmberShirts.mockup(colorObj, view)) +
          '" alt="' + escapeAttr(colorObj.label) + ' t-shirt, ' + view +
          '" loading="lazy" style="object-fit:' + window.EmberShirts.fitFor(colorObj) + '">' +
        '<img class="shirt-shot-design" src="' + escapeAttr(product.image) +
          '" alt="' + escapeAttr(product.description || product.name) +
          '" loading="lazy" style="' + designStyle + '">' +
        hoverLayer +
      "</div>"
    );
  }

  // Products with no artwork in the sheet yet get a branded placeholder
  // rather than an empty <img>, which browsers draw as a broken icon.
  function productThumb(p, i) {
    if (!p.image) return emptyThumbMarkup(p.name, i);
    return shirtShotMarkup(p, p.availableColors[0], {
      className: "product-image",
      index: i,
      hoverPhoto: p.photos[0] || ""
    });
  }

  // A row can carry an image URL that doesn't resolve — a stale link, or the
  // sample your-bucket.s3 URLs still sitting in the sheet. Those only fail
  // after the grid has rendered, so they have to be handled on the error
  // event ('error' doesn't bubble, hence capture).
  //
  // This used to test for the class "product-image" on the <img>, but that
  // class sits on the wrapper div — shirtShotMarkup puts it there — so the
  // check never passed and broken artwork stayed on screen as a torn-image
  // icon. Match on what the images are actually called, and treat the two
  // layers differently:
  //
  //   artwork missing -> drop just that layer, leaving the plain shirt.
  //                      A blank tee reads as a design that hasn't been
  //                      photographed yet; a broken image reads as a broken
  //                      site.
  //   mockup missing   -> nothing recognisable left, so fall back to the
  //                      "photo coming soon" tile.
  if (gridEl) {
    gridEl.addEventListener("error", function (e) {
      var img = e.target;
      if (!img || img.tagName !== "IMG") return;

      if (img.classList.contains("shirt-shot-design") ||
          img.classList.contains("shirt-shot-hover")) {
        img.remove();
        return;
      }

      if (img.classList.contains("shirt-shot-base")) {
        var shot = img.closest(".shirt-shot");
        if (!shot) return;
        var index = shot.getAttribute("data-product-index");
        var product = visibleProducts[parseInt(index, 10)];
        shot.outerHTML = emptyThumbMarkup(product ? product.name : "", index);
      }
    }, true);
  }

  // The cart button used to add straight to the basket with the first size
  // and colour silently applied, which is how someone ends up receiving an
  // S in the wrong colour. It now opens the picker instead.
  function quickAdd(product) {
    openProductModal(product);
  }

  if (filterBar) {
    filterBar.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-category]");
      if (!btn) return;
      activeCategory = btn.getAttribute("data-category");
      filterBar.querySelectorAll(".filter-btn").forEach(function (b) {
        b.classList.toggle("is-active", b === btn);
      });
      renderProducts();
    });
  }

  if (sortEl) {
    sortEl.addEventListener("change", renderProducts);
  }

  if (gridEl) {
    gridEl.addEventListener("click", function (e) {
      var index;
      var quickBtn = e.target.closest(".quick-add-btn");
      if (quickBtn) {
        index = parseInt(quickBtn.getAttribute("data-product-index"), 10);
        if (visibleProducts[index]) quickAdd(visibleProducts[index]);
        return;
      }
      var buyBtn = e.target.closest(".buy-this-btn");
      if (buyBtn) {
        index = parseInt(buyBtn.getAttribute("data-product-index"), 10);
        if (visibleProducts[index]) openProductModal(visibleProducts[index]);
        return;
      }
      var image = e.target.closest(".product-image");
      if (image) {
        index = parseInt(image.getAttribute("data-product-index"), 10);
        if (visibleProducts[index]) openProductModal(visibleProducts[index]);
      }
    });
  }

  // -----------------------------------------------------------------------
  // Product detail popup — built once, reused for whichever product was
  // clicked via "Buy This".
  // -----------------------------------------------------------------------
  var modalEl, modalBackdropEl, modalStage, modalThumbs, modalSwatches, modalViewToggle,
    modalColorChosen, modalStatus, modalName, modalPrice, modalDescription,
    modalVariantRow, modalNotes, modalQtyInput, modalAddBtn;
  var modalProduct = null;
  var modalColor = null;       // what the shirt preview is showing
  var modalColorPicked = false; // whether the customer actually chose it
  var modalView = "front";     // front | back
  var modalPhotoIndex = null;  // null = mockup, otherwise index into product.photos

  function buildModal() {
    modalBackdropEl = document.createElement("div");
    modalBackdropEl.className = "pm-backdrop";
    modalBackdropEl.addEventListener("click", closeProductModal);

    modalEl = document.createElement("div");
    modalEl.className = "pm-modal";
    modalEl.setAttribute("role", "dialog");
    modalEl.setAttribute("aria-label", "Product details");
    modalEl.innerHTML =
      '<button type="button" class="pm-close-btn" aria-label="Close">' +
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6,6 L18,18 M18,6 L6,18"/></svg>' +
      "</button>" +
      '<div class="pm-body">' +
        '<div class="pm-gallery">' +
          '<div class="pm-stage"></div>' +
          '<div class="pm-view-toggle" role="tablist" aria-label="Shirt view">' +
            '<button type="button" class="pm-view-btn is-active" data-view="front" role="tab" aria-selected="true">Front</button>' +
            '<button type="button" class="pm-view-btn" data-view="back" role="tab" aria-selected="false">Back</button>' +
          "</div>" +
          '<div class="pm-thumbs"></div>' +
        "</div>" +
        '<div class="pm-info">' +
          '<div class="pm-name"></div>' +
          '<div class="pm-price"></div>' +
          '<div class="pm-description"></div>' +
          '<div class="pm-color-row">' +
            '<span class="pm-color-label">Colour</span>' +
            '<span class="pm-color-chosen"></span>' +
          "</div>" +
          '<div class="pm-swatches"></div>' +
          '<div class="pm-variant-row"></div>' +
          '<div class="pm-status" role="status"></div>' +
          '<textarea class="pm-notes" placeholder="Notes (optional) — size adjustments, custom requests, etc."></textarea>' +
          '<div class="pm-qty-row">' +
            '<span class="pm-qty-label">Quantity</span>' +
            '<div class="pm-qty-stepper">' +
              '<button type="button" class="pm-qty-btn" data-qty-step="-1" aria-label="Decrease quantity">–</button>' +
              '<input type="number" class="pm-qty-input" value="1" min="1" step="1" inputmode="numeric" aria-label="Quantity">' +
              '<button type="button" class="pm-qty-btn" data-qty-step="1" aria-label="Increase quantity">+</button>' +
            "</div>" +
          "</div>" +
          '<button type="button" class="pm-add-btn">Add to Cart</button>' +
        "</div>" +
      "</div>";

    document.body.appendChild(modalBackdropEl);
    document.body.appendChild(modalEl);

    modalStage = modalEl.querySelector(".pm-stage");
    modalThumbs = modalEl.querySelector(".pm-thumbs");
    modalSwatches = modalEl.querySelector(".pm-swatches");
    modalColorChosen = modalEl.querySelector(".pm-color-chosen");
    modalStatus = modalEl.querySelector(".pm-status");
    modalViewToggle = modalEl.querySelector(".pm-view-toggle");
    modalName = modalEl.querySelector(".pm-name");
    modalPrice = modalEl.querySelector(".pm-price");
    modalDescription = modalEl.querySelector(".pm-description");
    modalVariantRow = modalEl.querySelector(".pm-variant-row");
    modalNotes = modalEl.querySelector(".pm-notes");
    modalQtyInput = modalEl.querySelector(".pm-qty-input");
    modalAddBtn = modalEl.querySelector(".pm-add-btn");

    modalEl.querySelector(".pm-close-btn").addEventListener("click", closeProductModal);

    modalSwatches.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-color-key]");
      if (!btn) return;
      modalColor = window.EmberShirts.resolve(btn.getAttribute("data-color-key")) || modalColor;
      modalColorPicked = true;
      setModalStatus("");
      // Changing colour is only visible on the mockup, so come back to it.
      modalPhotoIndex = null;
      renderModalThumbs();
      renderModalStage();
    });

    modalThumbs.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-thumb]");
      if (!btn) return;
      var key = btn.getAttribute("data-thumb");
      modalPhotoIndex = key === "mockup" ? null : parseInt(key, 10);
      renderModalStage();
    });

    modalViewToggle.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-view]");
      if (!btn) return;
      modalView = btn.getAttribute("data-view");
      renderModalStage();
    });

    modalEl.querySelector(".pm-qty-stepper").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-qty-step]");
      if (!btn) return;
      var delta = parseInt(btn.getAttribute("data-qty-step"), 10);
      var next = Math.max(1, (parseInt(modalQtyInput.value, 10) || 1) + delta);
      modalQtyInput.value = next;
    });

    modalQtyInput.addEventListener("change", function () {
      var val = Math.max(1, parseInt(modalQtyInput.value, 10) || 1);
      modalQtyInput.value = val;
    });

    modalAddBtn.addEventListener("click", function () {
      if (!modalProduct || !window.EmberCart) return;

      // Both choices are required. The colour swatch starts unpicked even
      // though the shirt preview has to show something, so a customer can't
      // land a colour they never actually looked at.
      var sizeSelect = modalVariantRow.querySelector('[data-variant="size"]');
      var size = sizeSelect ? sizeSelect.value : "";
      var missing = [];
      if (sizeSelect && !size) missing.push("a size");
      if (!modalColorPicked) missing.push("a colour");

      if (missing.length) {
        setModalStatus("Please choose " + missing.join(" and ") + ".");
        if (missing.indexOf("a colour") !== -1) modalSwatches.classList.add("needs-pick");
        if (missing.indexOf("a size") !== -1 && sizeSelect) sizeSelect.classList.add("needs-pick");
        return;
      }

      window.EmberCart.addItem({
        sku: modalProduct.sku,
        name: modalProduct.name,
        price: modalProduct.price,
        image: modalProduct.image,
        size: size,
        color: modalColor ? modalColor.label : "",
        notes: modalNotes.value.trim(),
        qty: Math.max(1, parseInt(modalQtyInput.value, 10) || 1)
      });
      closeProductModal();
    });

    modalVariantRow.addEventListener("change", function (e) {
      if (e.target.value) {
        e.target.classList.remove("needs-pick");
        setModalStatus("");
      }
    });
  }

  // Leads with an empty option so the customer has to pick a size rather
  // than inheriting whatever happened to be first — a silent default here
  // is exactly how wrong-size orders get placed.
  function optionSelect(label, values) {
    if (!values.length) return "";
    var options = ['<option value="">Select ' + escapeHtml(label.toLowerCase()) + "…</option>"];
    values.forEach(function (v) {
      options.push('<option value="' + escapeAttr(v) + '">' + escapeHtml(v) + "</option>");
    });
    return (
      '<select class="product-variant-select" data-variant="' + escapeAttr(label.toLowerCase()) + '" aria-label="Choose ' + escapeAttr(label.toLowerCase()) + '">' +
        options.join("") +
      "</select>"
    );
  }

  function setModalStatus(msg) {
    modalStatus.textContent = msg || "";
    modalStatus.classList.toggle("is-error", !!msg);
    if (!msg) modalSwatches.classList.remove("needs-pick");
  }

  // Redraws the shirt preview for the current colour + front/back choice.
  // Only the artwork's back placement differs — the design sits lower and
  // larger on a back print, matching how these are actually printed.
  function renderModalStage() {
    if (!modalProduct) return;

    // modalPhotoIndex null = showing the generated mockup; a number = showing
    // that real photograph instead.
    var showingPhoto = modalPhotoIndex !== null && modalProduct.photos[modalPhotoIndex];

    if (showingPhoto) {
      modalStage.innerHTML =
        '<img class="pm-photo" src="' + escapeAttr(modalProduct.photos[modalPhotoIndex]) +
          '" alt="' + escapeAttr(modalProduct.name) + '">';
    } else if (!modalProduct.image) {
      modalStage.innerHTML =
        '<div class="pm-stage-empty"><img src="' + PLACEHOLDER_MARK + '" alt=""><span>Artwork coming soon</span></div>';
    } else {
      modalStage.innerHTML = shirtShotMarkup(modalProduct, modalColor, { view: modalView });
    }

    // Front/back only means anything for the generated mockup.
    modalViewToggle.hidden = !!showingPhoto || !modalProduct.image;

    // Only mark a swatch as chosen once it's actually been clicked — until
    // then the preview is just showing a default.
    Array.prototype.forEach.call(modalSwatches.querySelectorAll("[data-color-key]"), function (b) {
      b.classList.toggle("is-active", modalColorPicked && b.getAttribute("data-color-key") === modalColor.key);
    });
    modalColorChosen.textContent = modalColorPicked ? modalColor.label : "Choose one";
    modalColorChosen.classList.toggle("is-unset", !modalColorPicked);
    Array.prototype.forEach.call(modalViewToggle.querySelectorAll("[data-view]"), function (b) {
      var on = b.getAttribute("data-view") === modalView;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    Array.prototype.forEach.call(modalThumbs.querySelectorAll("[data-thumb]"), function (b) {
      var key = b.getAttribute("data-thumb");
      b.classList.toggle("is-active", key === (showingPhoto ? String(modalPhotoIndex) : "mockup"));
    });
  }

  // Thumb strip: the mockup first, then each real photo.
  function renderModalThumbs() {
    if (!modalProduct.photos.length) {
      modalThumbs.innerHTML = "";
      modalThumbs.hidden = true;
      return;
    }
    modalThumbs.hidden = false;

    var thumbs = [];
    if (modalProduct.image) {
      thumbs.push(
        '<button type="button" class="pm-thumb pm-thumb-mockup is-active" data-thumb="mockup" aria-label="Design on shirt">' +
          '<img src="' + escapeAttr(window.EmberShirts.mockup(modalColor, "front")) + '" alt="">' +
          '<img class="pm-thumb-design" src="' + escapeAttr(modalProduct.image) + '" alt="">' +
        "</button>"
      );
    }
    modalProduct.photos.forEach(function (src, i) {
      thumbs.push(
        '<button type="button" class="pm-thumb" data-thumb="' + i + '" aria-label="Photo ' + (i + 1) + '">' +
          '<img src="' + escapeAttr(src) + '" alt="" loading="lazy">' +
        "</button>"
      );
    });
    modalThumbs.innerHTML = thumbs.join("");
  }

  function openProductModal(product) {
    if (!modalEl) buildModal();
    modalProduct = product;
    modalColor = product.availableColors[0]; // preview default, not a choice
    modalColorPicked = false;
    modalView = "front";
    modalPhotoIndex = null;
    setModalStatus("");

    modalSwatches.innerHTML = product.availableColors.map(function (c) {
      return (
        '<button type="button" class="pm-swatch" data-color-key="' + escapeAttr(c.key) +
          '" style="background:' + escapeAttr(c.swatch) + '" title="' + escapeAttr(c.label) +
          '" aria-label="' + escapeAttr(c.label) + '"></button>'
      );
    }).join("");

    modalName.textContent = product.name;
    modalPrice.textContent = product.price;
    modalDescription.textContent = product.description || "";
    modalNotes.value = "";
    modalQtyInput.value = 1;

    // Colour is picked with the swatches now, so only size stays a dropdown.
    modalVariantRow.innerHTML = optionSelect("Size", product.sizes);

    renderModalThumbs();
    renderModalStage();

    document.body.classList.add("pm-open");
    modalBackdropEl.classList.add("is-open");
    modalEl.classList.add("is-open");
  }

  function closeProductModal() {
    if (!modalEl) return;
    document.body.classList.remove("pm-open");
    modalBackdropEl.classList.remove("is-open");
    modalEl.classList.remove("is-open");
  }

  // -----------------------------------------------------------------------
  if (SHEET_ID === "YOUR_GOOGLE_SHEET_ID") {
    allProducts = PLACEHOLDER_PRODUCTS.map(function (p) { return Object.assign({}, p, { images: splitList(p.image) }); });
    categories = collectCategories(allProducts);
    validateActiveCategory();
    renderFilterBar();
    renderProducts();
    statusEl.textContent = "Showing placeholder products — connect your Google Sheet (see js/store-products.js) to replace these with the real catalog.";
    statusEl.hidden = false;
    return;
  }

  renderSkeletons();

  fetch(sheetUrl())
    .then(function (res) {
      if (!res.ok) throw new Error("Sheet request failed (" + res.status + ")");
      return res.text();
    })
    .then(function (text) {
      allProducts = parseGvizResponse(text).map(toProduct);
      categories = collectCategories(allProducts);
      validateActiveCategory();
      renderFilterBar();
      renderProducts();
    })
    .catch(function (err) {
      console.error(err);
      gridEl.innerHTML = "";
      gridEl.setAttribute("aria-busy", "false");
      if (countEl) countEl.hidden = true;
      statusEl.textContent = "Couldn't load products right now. Please check back soon.";
      statusEl.hidden = false;
    });
})();
