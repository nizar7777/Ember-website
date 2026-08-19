/* ---------------------------------------------------------------------
   Shared shirt colour + mockup definitions.

   The store doesn't hold photos of finished shirts. It holds your DESIGN
   artwork (one image per product, in the Google Sheet's Image column) and
   lays it over these shirt mockups at display time. That means one
   artwork file covers every colour — you never re-shoot or re-export a
   product photo per colour.

   Which colours a given design is offered in comes from that product's
   "Colors" cell in the sheet. Write them comma-separated, e.g.
       Black, White, Woody Green
   Matching is forgiving about case, spacing and word order, and a few
   older/shorter spellings still resolve (see `aliases`), so "green"
   and "Woody Green" both land on the same mockup.

   Load this file BEFORE js/store-products.js and js/order-entry.js.
--------------------------------------------------------------------- */
(function () {
  "use strict";

  // key      — canonical id used in code
  // label    — what customers see
  // swatch   — the dot shown in colour pickers
  // front/back — where the mockup photo actually lives.
  //
  // As of 2 Aug 2026, 6 of 7 colours are hosted on the public S3 bucket
  // (ember-products, eu-north-1, mockup/ prefix) instead of shipping in
  // this repo — confirmed live by fetching each URL directly. This also
  // fixes a real bug: build-deploy.ps1 only ships mockup/*.webp to
  // production, and black/green/peach never had .webp versions, so those
  // three colours were completely broken on any deployed build.
  //
  // CAVEAT: the bucket currently only has the original 2402x3481 PNG
  // masters (2-3.7 MB each), not the optimized .webp (~50KB each) that
  // tools/convert-mockups.html used to generate locally. This fixes
  // correctness but not load time — if you upload .webp versions at the
  // same path with a .webp extension, flip the extensions below and every
  // product card gets noticeably lighter.
  var MOCKUP_BASE = "https://ember-products.s3.eu-north-1.amazonaws.com/mockup/";
  var COLORS = [
    {
      key: "black", label: "Black", swatch: "#2f2f2f",
      front: MOCKUP_BASE + "black front.png", back: MOCKUP_BASE + "black back.png",
      aliases: ["black"]
    },
    {
      key: "white", label: "White", swatch: "#f2f2f2",
      front: MOCKUP_BASE + "white front.png", back: MOCKUP_BASE + "white back.png",
      aliases: ["white"]
    },
    {
      key: "silver-shine", label: "Silver Shine", swatch: "#bfc8ca",
      front: MOCKUP_BASE + "silver front.png", back: MOCKUP_BASE + "silver back.png",
      aliases: ["silver", "silvershine", "shinesilver"]
    },
    {
      key: "woody-green", label: "Woody Green", swatch: "#3c483a",
      front: MOCKUP_BASE + "green front.png", back: MOCKUP_BASE + "green back.png",
      aliases: ["green", "woodygreen", "greenwoody", "olive"]
    },
    {
      key: "glowing-peach", label: "Glowing Peach", swatch: "#fea991",
      front: MOCKUP_BASE + "peach front.png", back: MOCKUP_BASE + "peach back.png",
      aliases: ["peach", "glowingpeach", "peachglowing"]
    },
    {
      key: "navy", label: "Navy", swatch: "#070e1d",
      // Filenames as actually uploaded — capitalised, and inconsistently
      // so between front/back ("Navy Front" vs "Navy back"). Confirmed via
      // bucket listing 13 Aug 2026, not guessed.
      front: MOCKUP_BASE + "Navy Front.png", back: MOCKUP_BASE + "Navy back.png",
      aliases: ["navy"]
    },
    // `washed: true` groups this under its own "Washed" section in every
    // swatch picker (see buildSwatches in custom-design.js/order-entry.js
    // and the divider logic in store-products.js) — that's still wanted
    // even though it no longer needs its own fit/printArea override. It
    // used to have both a different crop AND a different framing than the
    // other four; now that it's hosted on the same bucket and confirmed to
    // follow the same near-full-bleed framing (verified 6 Aug 2026 by
    // measuring the actual shirt bounds in the file), it uses the shared
    // fit/printArea defaults like every other colour — just kept visually
    // separate, plus it's priced differently (see priceFor in
    // js/store-products.js).
    {
      key: "stressed-dark", label: "Stressed Dark", swatch: "#3f3f3f",
      front: MOCKUP_BASE + "stressed front.png", back: MOCKUP_BASE + "stressed back.png",
      washed: true,
      // "washed black" is what actually got typed into the sheet's Colors
      // column (used on ~30 rows) — squash() strips the space, so it needs
      // its own alias rather than relying on "washeddark" to catch it.
      aliases: ["stressed", "stresseddark", "darkstressed", "washeddark", "washedblack", "blackwashed"]
    },
    // Not fully on the bucket yet: only the back file exists there
    // ("light stressed back.png" — note it's not named "light washed
    // shirt back" the way the front is). The front still isn't uploaded
    // anywhere under any name/extension, so it stays on the local .webp
    // for now — swap it to the bucket once you've added it there too.
    {
      key: "stressed-light", label: "Stressed Light", swatch: "#b9b7b4",
      front: "mockup/stressed light front.webp",
      back: MOCKUP_BASE + "light stressed back.png",
      washed: true,
      fit: "contain",
      aliases: ["stressedlight", "lightstressed", "washedlight", "lightwashed"]
    }
  ];

  // ---------------------------------------------------------------------
  // Sizes. A product's "Sizes" cell in the sheet narrows this list; leave
  // the cell blank and the full ladder is offered. Whatever order the sheet
  // lists them in, they always display smallest-to-largest.
  // ---------------------------------------------------------------------
  var SIZES = ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];

  // Accepts the ways these get typed: "XXL", "2XL", "xx-large" -> "2XL".
  var SIZE_ALIASES = {
    s: "S", small: "S",
    m: "M", medium: "M",
    l: "L", large: "L",
    xl: "XL", xlarge: "XL", extralarge: "XL",
    xxl: "2XL", "2xl": "2XL", xxlarge: "2XL",
    xxxl: "3XL", "3xl": "3XL", xxxlarge: "3XL",
    xxxxl: "4XL", "4xl": "4XL",
    xxxxxl: "5XL", "5xl": "5XL"
  };

  function squash(str) {
    return String(str || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function resolveSize(name) {
    return SIZE_ALIASES[squash(name)] || null;
  }

  function sizesFor(cell) {
    var listed = [];
    String(cell || "").split(",").forEach(function (part) {
      var s = resolveSize(part);
      if (s && listed.indexOf(s) === -1) listed.push(s);
    });
    var chosen = listed.length ? listed : SIZES.slice();
    // Always smallest-to-largest, whatever order the sheet used.
    return SIZES.filter(function (s) { return chosen.indexOf(s) !== -1; });
  }

  var byToken = {};
  COLORS.forEach(function (c) {
    byToken[squash(c.key)] = c;
    byToken[squash(c.label)] = c;
    (c.aliases || []).forEach(function (a) { byToken[squash(a)] = c; });
  });

  // "Woody Green" / "green" / "WOODY-GREEN" -> the woody-green entry.
  function resolve(name) {
    return byToken[squash(name)] || null;
  }

  // Turns a sheet "Colors" cell into colour objects, dropping anything
  // that doesn't match a real mockup so a typo can't render a dead image.
  function parseList(cell) {
    var out = [];
    String(cell || "").split(",").forEach(function (part) {
      var c = resolve(part);
      if (c && out.indexOf(c) === -1) out.push(c);
    });
    return out;
  }

  // Colours to offer for a product: what the sheet says, or every colour
  // when that cell is blank.
  function availableFor(cell) {
    var listed = parseList(cell);
    return listed.length ? listed : COLORS.slice();
  }

  function mockup(color, view) {
    var c = typeof color === "string" ? resolve(color) : color;
    if (!c) c = COLORS[0];
    return encodeURI(view === "back" ? c.back : c.front);
  }

  // ---------------------------------------------------------------------
  // Design artwork sizing — as of 6 Aug 2026, no print-area box or per-
  // colour centring math any more. Export the design PNG at the SAME
  // frame/aspect ratio as the mockup photo it's paired with (transparent
  // everywhere except the actual print, positioned exactly where it should
  // sit on the shirt in your design app). The site just stacks the two
  // full-frame images and lets them both fill the same box — see
  // shirtShotMarkup in js/store-products.js. Whatever you see in your file
  // is what appears on the shirt; there's nothing left to calibrate here.
  //
  // mockup/PRINT-AREA-GUIDE.png is stale from the old fixed-box system —
  // not used any more, safe to ignore or delete.
  // ---------------------------------------------------------------------

  function fitFor(color) {
    var c = typeof color === "string" ? resolve(color) : color;
    return (c && c.fit) || "cover";
  }

  window.EmberShirts = {
    all: COLORS,
    resolve: resolve,
    parseList: parseList,
    availableFor: availableFor,
    mockup: mockup,
    fitFor: fitFor,
    SIZES: SIZES,
    sizesFor: sizesFor
  };
})();
