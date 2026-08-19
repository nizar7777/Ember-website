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
  //      - Image: usually leave this BLANK. The design artwork is loaded
  //        automatically from the S3 bucket at <SKU>/<SKU>.png, built from
  //        the SKU column (see defaultDesignUrl below) — nothing to paste
  //        in per row. Only fill this in to override that for a specific
  //        product (a different file extension, artwork that isn't in the
  //        bucket, an extra shot, etc.) — one or more full URLs,
  //        comma-separated; the first becomes the card thumbnail.
  //      - InStock: optional — put FALSE to hide a product without
  //        deleting its row.
  //      Optional extra columns:
  //        BuyLink — where "Buy Now" goes; leave blank to default to the
  //          contact form.
  //        PreferredSide — "Back" for a design meant to be worn as a back
  //          print, so the card thumbnail and the "Buy This" popup open
  //          on the back mockup instead of front. Anything else (or
  //          blank) means front.
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

  // Design artwork lives in this bucket under <SKU>/<SKU>.png — confirmed
  // 2 Aug 2026 against R-001, 7-001 and S-001. Built from the SKU column
  // directly so nobody has to paste a URL into the sheet's Image column by
  // hand; that column still works as an override for anything that
  // doesn't follow the convention (a different extension, an SKU whose
  // folder is named differently, etc).
  //
  // The bucket's folder casing turned out to be inconsistent — checked all
  // 57 SKUs on 6 Aug 2026: R-001, S-001 and every W7-xxx only resolve with
  // their sheet casing exactly as typed, while ~29 others (Ani-002..011,
  // JO-002..008, UH-001..008, Si-001, S-002/003) only resolve fully
  // lowercased. Rather than push everyone through a sheet-wide SKU rename,
  // the card tries the exact casing first and silently retries lowercase
  // on failure — see the shirt-shot-design fallback in the grid's error
  // handler below.
  //
  // Confirmed against a full bucket listing on 13 Aug 2026 (now that
  // ListBucket is allowed — see js/shirt-colors.js for the same story with
  // mockup colours): Ani-001 and JO-001 genuinely have no folder at all,
  // nothing to fall back to. MU-001..004 looked the same at first, but
  // they're not missing — they're filed under mu-1..mu-4, not zero-padded
  // like every other SKU. That's not a casing difference the lowercase
  // fallback can catch, so it's a direct override instead.
  var DESIGN_BUCKET = "https://ember-products.s3.eu-north-1.amazonaws.com/";

  var DESIGN_URL_OVERRIDES = {
    "MU-001": "mu-1/mu-1.png",
    "MU-002": "mu-2/mu-2.png",
    "MU-003": "mu-3/mu-3.png",
    "MU-004": "mu-4/mu-4.png"
  };

  function defaultDesignUrl(sku) {
    if (!sku) return "";
    if (DESIGN_URL_OVERRIDES[sku]) return DESIGN_BUCKET + DESIGN_URL_OVERRIDES[sku];
    return DESIGN_BUCKET + encodeURIComponent(sku) + "/" + encodeURIComponent(sku) + ".png";
  }

  function lowercaseDesignUrl(sku) {
    if (!sku || DESIGN_URL_OVERRIDES[sku]) return "";
    var lower = sku.toLowerCase();
    return DESIGN_BUCKET + encodeURIComponent(lower) + "/" + encodeURIComponent(lower) + ".png";
  }

  // ---------------------------------------------------------------------
  // Extra promotional photos, discovered from the bucket instead of typed
  // into a sheet column — whatever else is sitting in a SKU's folder,
  // under whatever name, shows up on hover automatically.
  //
  // This needs TWO bucket settings beyond what GetObject-per-file already
  // needed, and neither is a code problem if it's not working:
  //   1. Bucket policy: s3:ListBucket allowed for "*" (Resource is the
  //      BUCKET, arn:aws:s3:::ember-products — not .../* like GetObject).
  //   2. CORS config: GET allowed from this site's origin. <img> tags
  //      don't need this (that's why the design/mockup photos already
  //      work without it) but fetch() reading a response body does.
  // Until both are set, listing 403s and this quietly finds nothing —
  // see the .catch below.
  // ---------------------------------------------------------------------
  var folderPhotoCache = {}; // sku -> array of photo URLs (populated once, then reused)

  function keyToUrl(key) {
    return DESIGN_BUCKET + key.split("/").map(encodeURIComponent).join("/");
  }

  function extraPhotosFor(product) {
    var sku = product.sku;
    if (!sku) return Promise.resolve([]);
    if (folderPhotoCache[sku]) return Promise.resolve(folderPhotoCache[sku]);

    var listUrl = DESIGN_BUCKET + "?list-type=2&prefix=" + encodeURIComponent(sku + "/");
    // The design file itself (either casing) isn't an "extra" photo —
    // exclude whichever one this product actually resolved to, plus its
    // sibling casing, so a hover cycle never just repeats the mockup art.
    var designKeys = [sku + "/" + sku + ".png", sku.toLowerCase() + "/" + sku.toLowerCase() + ".png"]
      .map(function (k) { return k.toLowerCase(); });

    return fetch(listUrl)
      .then(function (res) {
        if (!res.ok) throw new Error("listing failed (" + res.status + ")");
        return res.text();
      })
      .then(function (xml) {
        var doc = new DOMParser().parseFromString(xml, "text/xml");
        var keys = Array.prototype.map.call(doc.getElementsByTagName("Key"), function (k) { return k.textContent; });
        var imageExt = /\.(png|jpe?g|webp)$/i;
        var extras = keys
          .filter(function (k) { return imageExt.test(k) && designKeys.indexOf(k.toLowerCase()) === -1; })
          .map(keyToUrl);
        folderPhotoCache[sku] = extras;
        return extras;
      })
      .catch(function () {
        // Listing not enabled yet (see comment above), or a genuine
        // network hiccup — either way, no extra photos, not an error the
        // customer needs to see.
        folderPhotoCache[sku] = [];
        return [];
      });
  }

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
    buyLink: ["buylink"],
    // Which mockup view (front or back) shows first — for a back-print
    // design. Anything other than "back"/"b" (blank included) means front.
    preferredSide: ["preferredside", "bestside", "side", "printside", "view"],
    // Which colour shows first, out of whatever's in the Colors cell —
    // separate from availableFor's ordering, which just follows however
    // the cell happened to be typed.
    preferredColor: ["preferredcolor", "bestcolor", "defaultcolor"],
    // A second-level filter WITHIN a Category — e.g. every T-Shirt is
    // still Category=t-shirts, but Subcategory splits them into Pride/
    // Gym/Anime/Special. Leave blank for anything that doesn't need the
    // extra level (hoodies, keychains, etc).
    subcategory: ["subcategory", "subcat", "theme", "subfilter"]
  };

  // Categories/subcategories are NOT defined here — the filter buttons are
  // built from whatever distinct values appear in the sheet's Category and
  // Subcategory columns. Add a category by typing it on a product row;
  // remove one by clearing it from every row that used it and its button
  // disappears on the next load. Buttons appear in the order they're first
  // met going down the sheet, so row order controls button order. A
  // category only gets a sub-filter row if at least 2 of its products have
  // different Subcategory values — one value (or none) is nothing to
  // filter between.

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
  var subfilterBar = document.getElementById("store-subfilter-bar");
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
  var subcategories = [];     // built for whichever category is active

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
  var activeSubcategory = "all";

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

  // The washed fabrics (Stressed Dark/Light) cost more to produce than a
  // standard tee, so they're priced flat at 14 JOD regardless of what the
  // sheet says for that product — not a surcharge added to the base price.
  var WASHED_PRICE = "14 JOD";

  function priceFor(product, colorObj) {
    return (colorObj && colorObj.washed) ? WASHED_PRICE : product.price;
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

  // The category actually driving subcategory filtering right now: the
  // explicit pick, or — since the top-level bar hides itself when there's
  // only one category site-wide (nothing to choose between) — that one
  // category by default. Without this, a catalog that's 100% t-shirts
  // (true here today) could never engage the Subcategory filter at all,
  // since there'd be no button to set activeCategory away from "all".
  function effectiveCategory() {
    if (activeCategory !== "all") return activeCategory;
    return categories.length === 1 ? categories[0] : null;
  }

  // Same idea, one level down: distinct Subcategory values among in-stock
  // products of ONE category. A product with no Subcategory just doesn't
  // contribute a button — it still shows up under that category's "All".
  function collectSubcategories(products, category) {
    var found = [];
    products.forEach(function (p) {
      if (!p.inStock || p.category !== category || !p.subcategory) return;
      if (found.indexOf(p.subcategory) === -1) found.push(p.subcategory);
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

  // Rebuilds for whatever category is currently active — call this any
  // time activeCategory changes, not just on load.
  function renderSubfilterBar() {
    if (!subfilterBar) return;

    var ec = effectiveCategory();
    subcategories = ec ? collectSubcategories(allProducts, ec) : [];

    if (subcategories.length < 2) {
      subfilterBar.innerHTML = "";
      subfilterBar.hidden = true;
      return;
    }
    subfilterBar.hidden = false;

    var buttons = ['<button type="button" class="subfilter-btn' +
      (activeSubcategory === "all" ? " is-active" : "") + '" data-subcategory="all">ALL</button>'];

    subcategories.forEach(function (sc) {
      buttons.push(
        '<button type="button" class="subfilter-btn' +
          (activeSubcategory === sc ? " is-active" : "") +
          '" data-subcategory="' + escapeAttr(sc) + '">' + escapeHtml(categoryLabel(sc)) + "</button>"
      );
    });

    subfilterBar.innerHTML = buttons.join("");
  }

  function toProduct(row) {
    // Shopify writes TRUE/FALSE for "Published on online store" and
    // Active/Draft/Archived for "Status"; the older simple sheet used
    // an InStock column. Treat all the negative spellings as hidden.
    var stockRaw = pick(row, "inStock").toLowerCase();
    var hidden = ["false", "0", "no", "draft", "archived"].indexOf(stockRaw) !== -1;

    var sku = pick(row, "sku");
    var images = splitList(pick(row, "image"));
    var hasOverride = images.length > 0;
    var image = images[0] || defaultDesignUrl(sku);
    // Only meaningful for the auto-derived URL — a sheet override is
    // whatever the seller explicitly typed, not ours to second-guess.
    var designFallback = !hasOverride && sku ? lowercaseDesignUrl(sku) : "";
    // Nothing to fall back to if the SKU was already all-lowercase.
    if (designFallback === image) designFallback = "";

    var availableColors = window.EmberShirts.availableFor(pick(row, "colors"));

    // Whichever colour the sheet names, as long as it's actually one of
    // this product's available colours — otherwise fall back to the first
    // one, same as before this column existed.
    var preferredColorRaw = pick(row, "preferredColor");
    var preferredColorResolved = preferredColorRaw ? window.EmberShirts.resolve(preferredColorRaw) : null;
    var defaultColor = (preferredColorResolved && availableColors.indexOf(preferredColorResolved) !== -1)
      ? preferredColorResolved
      : availableColors[0];

    var sideRaw = pick(row, "preferredSide").toLowerCase();

    return {
      // Falls back to the first column, which holds the product names even
      // though its header cell doesn't say "Title".
      name: pick(row, "name") || String(row.__col0 || "").trim() || "Untitled",
      sku: sku,
      price: formatPrice(pick(row, "price")),
      category: toCategoryKey(pick(row, "category")),
      subcategory: toCategoryKey(pick(row, "subcategory")),
      colors: pick(row, "colors"),
      // Blank cell = the full S–5XL ladder.
      sizes: window.EmberShirts.sizesFor(pick(row, "sizes")),
      images: images.length ? images : (image ? [image] : []),
      image: image,
      designFallback: designFallback,
      description: pick(row, "description"),
      buyLink: pick(row, "buyLink"),
      inStock: !hidden,
      // Which shirt colours this design is offered in. Blank cell = all.
      availableColors: availableColors,
      // Which of those shows first — the sheet's choice if it named a real
      // one, otherwise whatever was first anyway.
      defaultColor: defaultColor,
      // Real product photography, shown alongside the generated mockup.
      photos: splitList(pick(row, "photos")),
      // Front unless the sheet says otherwise — "Back"/"b" for a design
      // meant to be worn as a back print.
      preferredSide: (sideRaw === "back" || sideRaw === "b") ? "back" : "front"
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
    var ec = effectiveCategory();
    visibleProducts = allProducts.filter(function (p) {
      if (!p.inStock) return false;
      if (ec && p.category !== ec) return false;
      if (activeSubcategory === "all") return true;
      return p.subcategory === activeSubcategory;
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
          (function () {
            var cardPrice = priceFor(p, p.defaultColor);
            return cardPrice ? '<div class="product-price">' + escapeHtml(String(cardPrice)) + "</div>" : "";
          })() +
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

    // The design PNG is exported at the same frame/aspect ratio as the
    // mockup photo itself (not just a small print box), positioned exactly
    // where it should sit on the shirt by whoever made the artwork. So the
    // two layers just both fill the container edge-to-edge and line up —
    // no per-colour centring/sizing math needed here any more.
    //
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
          '"' + (product.designFallback ? ' data-design-fallback="' + escapeAttr(product.designFallback) + '"' : "") +
          ' loading="lazy">' +
        hoverLayer +
      "</div>"
    );
  }

  // Products with no artwork in the sheet yet get a branded placeholder
  // rather than an empty <img>, which browsers draw as a broken icon.
  function productThumb(p, i) {
    if (!p.image) return emptyThumbMarkup(p.name, i);
    return shirtShotMarkup(p, p.defaultColor, {
      className: "product-image",
      index: i,
      view: p.preferredSide,
      hoverPhoto: p.photos[0] || ""
    });
  }

  // A row can carry an image URL that doesn't resolve — a stale link, the
  // sample your-bucket.s3 URLs still sitting in the sheet, or (as of 6 Aug
  // 2026) a SKU whose bucket folder is cased differently than the sheet's
  // SKU column. Those only fail after render, so they have to be handled
  // on the error event ('error' doesn't bubble, hence capture). Shared
  // between the grid and the modal, since both render shirt-shot markup.
  //
  // This used to test for the class "product-image" on the <img>, but that
  // class sits on the wrapper div — shirtShotMarkup puts it there — so the
  // check never passed and broken artwork stayed on screen as a torn-image
  // icon. Match on what the images are actually called, and treat the
  // layers differently:
  //
  //   artwork missing  -> try the lowercase-SKU fallback URL once (see
  //                      designFallback in toProduct) before giving up and
  //                      dropping just that layer, leaving the plain shirt.
  //                      A blank tee reads as a design that hasn't been
  //                      photographed yet; a broken image reads as a
  //                      broken site.
  //   mockup missing   -> in the grid, nothing recognisable is left, so
  //                      fall back to the "photo coming soon" tile (needs
  //                      a product index, which only the grid has); in the
  //                      modal just drop the layer.
  function handleShirtShotError(e) {
    var img = e.target;
    if (!img || img.tagName !== "IMG") return;

    if (img.classList.contains("shirt-shot-design")) {
      var fallback = img.getAttribute("data-design-fallback");
      if (fallback) {
        img.removeAttribute("data-design-fallback");
        img.src = fallback;
      } else {
        img.remove();
      }
      return;
    }

    if (img.classList.contains("shirt-shot-hover")) {
      img.remove();
      return;
    }

    if (img.classList.contains("shirt-shot-base")) {
      var shot = img.closest(".shirt-shot");
      if (!shot) return;
      var index = shot.getAttribute("data-product-index");
      if (index === null) {
        shot.remove();
        return;
      }
      var product = visibleProducts[parseInt(index, 10)];
      shot.outerHTML = emptyThumbMarkup(product ? product.name : "", index);
    }
  }

  if (gridEl) gridEl.addEventListener("error", handleShirtShotError, true);

  // Hover cycle: while the pointer stays over a card, step through every
  // extra photo found for that SKU (sheet Photos column + whatever the
  // bucket listing turns up), looping, and hand back to the mockup on
  // mouseout. mouseover/mouseout are used instead of mouseenter/mouseleave
  // because only the former bubble, which is what makes delegating this to
  // gridEl (rather than binding 57 listeners) possible; relatedTarget is
  // how a move within the same card is told apart from actually leaving it.
  var HOVER_STEP_MS = 1200;
  var hoverIntervals = {}; // product-index -> intervalId

  function stopHoverCycle(index) {
    if (hoverIntervals[index] !== undefined) {
      clearInterval(hoverIntervals[index]);
      delete hoverIntervals[index];
    }
  }

  function startHoverCycle(shot) {
    var index = shot.getAttribute("data-product-index");
    if (index === null) return;
    var product = visibleProducts[parseInt(index, 10)];
    if (!product || !product.sku) return;

    extraPhotosFor(product).then(function (bucketPhotos) {
      // Slow fetch outlasting a quick mouse pass shouldn't start a cycle
      // for a card that isn't hovered any more.
      if (!shot.matches(":hover")) return;

      var photos = (product.photos || []).concat(bucketPhotos)
        .filter(function (src, i, all) { return src && all.indexOf(src) === i; });
      if (!photos.length) return;

      var hoverImg = shot.querySelector(".shirt-shot-hover");
      if (!hoverImg) {
        hoverImg = document.createElement("img");
        hoverImg.className = "shirt-shot-hover";
        hoverImg.alt = "";
        hoverImg.setAttribute("aria-hidden", "true");
        hoverImg.loading = "lazy";
        shot.appendChild(hoverImg);
      }

      var i = 0;
      hoverImg.src = photos[i];
      stopHoverCycle(index);
      if (photos.length > 1) {
        hoverIntervals[index] = setInterval(function () {
          i = (i + 1) % photos.length;
          hoverImg.src = photos[i];
        }, HOVER_STEP_MS);
      }
    });
  }

  if (gridEl) {
    gridEl.addEventListener("mouseover", function (e) {
      var shot = e.target.closest(".shirt-shot");
      if (!shot || shot.contains(e.relatedTarget)) return;
      startHoverCycle(shot);
    });
    gridEl.addEventListener("mouseout", function (e) {
      var shot = e.target.closest(".shirt-shot");
      if (!shot || shot.contains(e.relatedTarget)) return;
      stopHoverCycle(shot.getAttribute("data-product-index"));
    });
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
      activeSubcategory = "all"; // switching top-level category starts over
      filterBar.querySelectorAll(".filter-btn").forEach(function (b) {
        b.classList.toggle("is-active", b === btn);
      });
      renderSubfilterBar();
      renderProducts();
    });
  }

  if (subfilterBar) {
    subfilterBar.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-subcategory]");
      if (!btn) return;
      activeSubcategory = btn.getAttribute("data-subcategory");
      subfilterBar.querySelectorAll(".subfilter-btn").forEach(function (b) {
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

    // Same shirt-shot images as the grid (mockup + design layer), so the
    // same fallback/degradation handling applies — the modal isn't inside
    // gridEl, so it needs its own listener.
    modalEl.addEventListener("error", handleShirtShotError, true);

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
      modalPrice.textContent = priceFor(modalProduct, modalColor);
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

      var linePrice = priceFor(modalProduct, modalColor);

      window.EmberCart.addItem({
        sku: modalProduct.sku,
        name: modalProduct.name,
        price: linePrice,
        image: modalProduct.image,
        size: size,
        color: modalColor ? modalColor.label : "",
        notes: modalNotes.value.trim(),
        qty: Math.max(1, parseInt(modalQtyInput.value, 10) || 1)
      });
      if (window.EmberPixel) {
        // price is free text ("18 JOD" or the washed-fabric override), so
        // it has to go through parsePrice before any arithmetic touches it.
        var addedQty = Math.max(1, parseInt(modalQtyInput.value, 10) || 1);
        var unitPrice = window.EmberCart.parsePrice(linePrice);
        window.EmberPixel.addToCart(modalProduct.name, unitPrice * addedQty);
      }
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
    modalColor = product.defaultColor; // preview default, not a choice
    modalColorPicked = false;
    modalView = product.preferredSide;
    modalPhotoIndex = null;
    setModalStatus("");

    modalSwatches.innerHTML = (function () {
      var html = [];
      // Washed fabrics are a different product, not just another colour —
      // same split as the custom design tool and order entry. Partitioned
      // rather than grouped-while-iterating, because availableColors
      // follows whatever order the sheet's Colors cell happened to list
      // them in ("black, stressed dark, navy") — a non-washed colour
      // typed after a washed one would otherwise land visually inside the
      // "Washed" section it doesn't belong to.
      var plain = product.availableColors.filter(function (c) { return !c.washed; });
      var washed = product.availableColors.filter(function (c) { return c.washed; });
      var ordered = plain.concat(washed);
      ordered.forEach(function (c, i) {
        if (c.washed && (i === 0 || !ordered[i - 1].washed)) {
          html.push('<span class="pm-swatch-divider" aria-hidden="true"></span>');
          html.push('<span class="pm-swatch-group-label">Washed</span>');
        }
        html.push(
          '<button type="button" class="pm-swatch' + (c.washed ? " is-washed" : "") +
            '" data-color-key="' + escapeAttr(c.key) +
            '" style="background:' + escapeAttr(c.swatch) + '" title="' + escapeAttr(c.label) +
            '" aria-label="' + escapeAttr(c.label) + '"></button>'
        );
      });
      return html.join("");
    })();

    modalName.textContent = product.name;
    modalPrice.textContent = priceFor(product, modalColor);
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
    renderSubfilterBar();
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
      // A completely blank row (no name, no SKU, nothing) isn't a product
      // — just an empty row sitting in the sheet, e.g. from a stray paste
      // or extending the range by accident. Without this it turns into a
      // fake "Untitled" card with no price or image, since toProduct has
      // to invent something for every field.
      var rows = parseGvizResponse(text).filter(function (row) {
        return pick(row, "name") || pick(row, "sku") || String(row.__col0 || "").trim();
      });
      allProducts = rows.map(toProduct);
      categories = collectCategories(allProducts);
      validateActiveCategory();
      renderFilterBar();
      renderSubfilterBar();
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
