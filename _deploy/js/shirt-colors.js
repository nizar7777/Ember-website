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
  // front/back — files in mockup/, all .webp.
  //
  // The supplied mockups are 2402x3481 PNGs of 2-3.7 MB each and the store
  // loads one per product card, which put the store page over 3 MB on a
  // phone. They are 57% transparent so JPEG was not an option; WebP keeps
  // the alpha and the same set weighs 536 KB instead of 29.7 MB.
  //
  // The .webp files are generated from the PNGs by
  // tools/convert-mockups.html — run that after adding a new mockup, then
  // add its .webp path here. The PNGs stay in the project as the masters
  // but are excluded from the deploy (see build-deploy.ps1).
  var COLORS = [
    {
      key: "black", label: "Black", swatch: "#2f2f2f",
      front: "mockup/black front.webp", back: "mockup/black back.webp",
      aliases: ["black"]
    },
    {
      key: "white", label: "White", swatch: "#f2f2f2",
      front: "mockup/white front.webp", back: "mockup/white back.webp",
      aliases: ["white"]
    },
    {
      key: "silver-shine", label: "Silver Shine", swatch: "#bfc8ca",
      front: "mockup/silver front.webp", back: "mockup/silver back.webp",
      aliases: ["silver", "silvershine", "shinesilver"]
    },
    {
      key: "woody-green", label: "Woody Green", swatch: "#3c483a",
      front: "mockup/green front.webp", back: "mockup/green back.webp",
      aliases: ["green", "woodygreen", "greenwoody", "olive"]
    },
    {
      key: "glowing-peach", label: "Glowing Peach", swatch: "#fea991",
      front: "mockup/peach front.webp", back: "mockup/peach back.webp",
      aliases: ["peach", "glowingpeach", "peachglowing"]
    },
    // The two washed shirts were supplied as different crops and much
    // smaller files than the five above (square-ish, and the backs are only
    // ~400px). `fit: "contain"` stops them being cropped to fill the frame,
    // and their own printArea compensates for the different framing.
    // Re-exporting these at 2402x3481 like the others would let both
    // overrides go away — see PRINT_AREA below.
    {
      key: "stressed-dark", label: "Stressed Dark", swatch: "#3f3f3f",
      front: "mockup/stressed front.webp", back: "mockup/stressed back.webp",
      washed: true,
      fit: "contain",
      printArea: { centerX: 50, centerY: 47, width: 22, ratio: "3 / 4" },
      aliases: ["stressed", "stresseddark", "darkstressed", "washeddark"]
    },
    {
      key: "stressed-light", label: "Stressed Light", swatch: "#b9b7b4",
      front: "mockup/stressed light front.webp",
      back: "mockup/light washed shirt back.webp",
      washed: true,
      fit: "contain",
      printArea: { centerX: 50, centerY: 46, width: 24, ratio: "3 / 4" },
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
  // THE PRINT AREA — the fixed box your artwork drops into.
  //
  // Export every design as a transparent PNG at exactly:
  //
  //         1800 x 2400 px   (3:4, = a 12" x 16" print at 150dpi)
  //
  // Position and scale the artwork inside that canvas in your design app;
  // leave the rest transparent. The site drops the whole canvas onto this
  // box, so whatever you see in your file is what appears on the shirt —
  // no per-design tweaking here. Small design? Keep it small on the canvas
  // with transparent space around it.
  //
  // mockup/PRINT-AREA-GUIDE.png shows this box drawn on a real shirt.
  //
  // Numbers below are percentages of the mockup frame. Derived from the
  // shirt's actual geometry: the torso measures ~1330px across a 2402px
  // frame, so 31% width lands a true 12" print, starting just below the
  // collar and finishing well above the hem.
  // ---------------------------------------------------------------------
  var PRINT_AREA = {
    centerX: 50,
    centerY: 47,
    width: 31,
    ratio: "3 / 4",     // must match the export canvas above
    canvas: { w: 1800, h: 2400 }
  };

  function printAreaFor(color) {
    var c = typeof color === "string" ? resolve(color) : color;
    return (c && c.printArea) || PRINT_AREA;
  }

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
    printAreaFor: printAreaFor,
    fitFor: fitFor,
    PRINT_AREA: PRINT_AREA,
    SIZES: SIZES,
    sizesFor: sizesFor
  };
})();
