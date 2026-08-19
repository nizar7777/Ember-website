(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Journal / blog setup — uses the SAME Google Sheet as the store
  // (js/store-products.js), just a different tab so you can manage both
  // in one place.
  //   1. In that same spreadsheet, add a new tab named exactly "Blog".
  //      Row 1 = headers, one row per post:
  //        Title | Date | Image | Excerpt
  //      - Date: shown as-is, so write it however you want it to read
  //        (e.g. "July 2026" or "12 Jul 2026").
  //      - Image: the AWS S3 URL for that post's photo.
  //      - Excerpt: a short paragraph — this is a summary feed, not full
  //        articles with their own pages.
  //   2. That's it — the tab just needs to be on the same sheet, which is
  //      already shared. If you used a different tab name, change
  //      SHEET_NAME below to match exactly.
  //
  //   NOTE: the sheet ID is base64-encoded below rather than left as
  //   plain text. This is NOT real security — anyone who opens DevTools
  //   and looks at the actual network request can still see it (and the
  //   sheet's data is already shown on this page anyway). It just keeps
  //   the value from being plainly readable/searchable in the page
  //   source. See atob()/btoa() if you need to update this by hand.
  // ---------------------------------------------------------------------
  var SHEET_ID = atob("MXpfWEpwc0U5WVctS2V6cWdqc2pIZ3AxY19ZNHdrdDVYb2piTmJWZWNWdkU=");
  var SHEET_NAME = "Blog";

  // Shown until the "Blog" tab exists and has at least one row, so the
  // section has something to preview/design against.
  var PLACEHOLDER_POSTS = [
    { title: "Something's coming", date: "2026", image: "images/Team-Img-01.png", excerpt: "The first Ember drop is in the works. Follow along here for real updates as soon as we have them — no filler, just the fire when it's lit." }
  ];

  var statusEl = document.getElementById("blog-status");
  var gridEl = document.getElementById("blog-grid");

  function sheetUrl() {
    return "https://docs.google.com/spreadsheets/d/" + SHEET_ID + "/gviz/tq?tqx=out:json&sheet=" + encodeURIComponent(SHEET_NAME);
  }

  function normalizeKey(label) {
    return String(label || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function parseGvizResponse(text) {
    var match = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
    if (!match) throw new Error("Unexpected response from Google Sheets.");
    var data = JSON.parse(match[1]);
    var cols = data.table.cols.map(function (c, i) {
      return normalizeKey(c.label) || normalizeKey(c.id) || ("col" + i);
    });

    // Google's gviz endpoint silently falls back to the spreadsheet's
    // first tab instead of erroring when the named "sheet=" tab doesn't
    // exist. Without this check, a missing "Blog" tab would render the
    // Products tab's rows as garbled fake blog posts instead of falling
    // back to the placeholder.
    if (cols.indexOf("title") === -1) {
      throw new Error('The "Blog" tab wasn\'t found — got a different sheet back instead.');
    }

    return data.table.rows.map(function (row) {
      var obj = {};
      row.c.forEach(function (cell, i) {
        obj[cols[i]] = cell ? (cell.f !== undefined ? cell.f : cell.v) : "";
      });
      return obj;
    });
  }

  function toPost(row) {
    return {
      title: row.title || "Untitled",
      date: row.date || "",
      image: row.image || "",
      excerpt: row.excerpt || ""
    };
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderPosts(posts, note) {
    if (!posts.length) {
      gridEl.innerHTML = "";
      statusEl.textContent = "No updates yet — check back soon.";
      statusEl.hidden = false;
      return;
    }

    statusEl.hidden = !note;
    if (note) statusEl.textContent = note;

    gridEl.innerHTML = posts.map(function (p) {
      return (
        '<div class="blog-card">' +
          (p.image ? '<img class="blog-card-image" src="' + escapeHtml(p.image) + '" alt="" loading="lazy">' : "") +
          '<div class="blog-card-body">' +
            (p.date ? '<div class="blog-card-date">' + escapeHtml(p.date) + "</div>" : "") +
            '<div class="blog-card-title">' + escapeHtml(p.title) + "</div>" +
            (p.excerpt ? '<p class="blog-card-excerpt">' + escapeHtml(p.excerpt) + "</p>" : "") +
          "</div>" +
        "</div>"
      );
    }).join("");
  }

  fetch(sheetUrl())
    .then(function (res) {
      if (!res.ok) throw new Error("Blog tab request failed (" + res.status + ")");
      return res.text();
    })
    .then(function (text) {
      var posts = parseGvizResponse(text).map(toPost);
      if (!posts.length) {
        // Note goes to the console, not the page — the placeholder post
        // reads as real copy to a visitor, but setup instructions on a
        // live site would not.
        console.info("Ember: \"Blog\" tab has no rows yet — showing the placeholder post.");
        renderPosts(PLACEHOLDER_POSTS);
      } else {
        renderPosts(posts);
      }
    })
    .catch(function (err) {
      console.error(err);
      console.info("Ember: no \"Blog\" tab on the Google Sheet yet — showing the placeholder post. See js/blog-posts.js.");
      renderPosts(PLACEHOLDER_POSTS);
    });
})();
