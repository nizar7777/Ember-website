(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Wholesale enquiry popup.
  //
  // Opened by anything carrying [data-wholesale-open] (the nav button and
  // the mobile menu link). Sends the enquiry through the same EmailJS
  // account as checkout and the custom design tool — see SETUP-NEEDED.txt.
  //
  // Template variables used by the "Wholesale Enquiry" template:
  //   {{company}} {{from_name}} {{from_phone}} {{from_email}}
  //   {{product}} {{quantity}} {{notes}}
  // ---------------------------------------------------------------------
  var EMAILJS_PUBLIC_KEY = atob("azNKaUE1NXY4RktfWU9uVlU=");
  var EMAILJS_SERVICE_ID = atob("c2VydmljZV8ycXlpdHh3");
  var EMAILJS_TEMPLATE_ID = atob("dGVtcGxhdGVfMXA2aThobQ==");

  // The popup builds its own markup, so any page that loads this script
  // gets it — no HTML to copy around. Three ways in:
  //   1. anything with [data-wholesale-open]
  //   2. the URL ending in #wholesale  (what the Spline object links to)
  //   3. wholesale.html, a standalone page that opens it on load
  var MARKUP =
    '<div class="ws-backdrop" id="ws-backdrop" hidden></div>' +
    '<div class="ws-modal" id="ws-modal" role="dialog" aria-modal="true" aria-labelledby="ws-title" hidden>' +
      '<button type="button" class="ws-close" id="ws-close" aria-label="Close">' +
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6,6 L18,18 M18,6 L6,18"/></svg>' +
      "</button>" +
      '<div class="ws-body">' +
        '<div class="ws-eyebrow">/ / Wholesale &amp; corporate</div>' +
        '<h2 class="ws-title" id="ws-title">Order in bulk</h2>' +
        '<p class="ws-intro">Uniforms, team kits, event merch and staff wear — tell us what you need and we\'ll come back with a quote.</p>' +
        '<form id="ws-form" class="ws-form" novalidate>' +
          '<div class="ws-row">' +
            '<input type="text" id="ws-company" class="cd-input" placeholder="Company / organisation *" autocomplete="organization">' +
            '<input type="text" id="ws-name" class="cd-input" placeholder="Your name *" autocomplete="name">' +
          "</div>" +
          '<div class="ws-row">' +
            '<input type="tel" id="ws-phone" class="cd-input" placeholder="Phone number *" autocomplete="tel">' +
            '<input type="email" id="ws-email" class="cd-input" placeholder="Email *" autocomplete="email">' +
          "</div>" +
          '<div class="ws-row">' +
            '<select id="ws-product" class="cd-select" aria-label="What do you need">' +
              '<option value="">What do you need? *</option>' +
              "<option>Uniforms</option><option>T-shirts</option><option>Hoodies</option>" +
              "<option>Event merch</option><option>Mixed / not sure yet</option>" +
            "</select>" +
            '<select id="ws-qty" class="cd-select" aria-label="Estimated quantity">' +
              '<option value="">Estimated quantity *</option>' +
              "<option>Under 25</option><option>25 – 50</option><option>50 – 100</option>" +
              "<option>100 – 250</option><option>250+</option>" +
            "</select>" +
          "</div>" +
          '<textarea id="ws-notes" class="cd-input cd-textarea" placeholder="Anything else — deadline, colours, artwork, sizes (optional)"></textarea>' +
          '<button type="submit" id="ws-submit" class="cd-btn cd-btn-primary cd-btn-large">Request a quote</button>' +
          '<div id="ws-status" class="cd-form-status" role="status"></div>' +
        "</form>" +
      "</div>" +
    "</div>";

  var host = document.createElement("div");
  host.innerHTML = MARKUP;
  while (host.firstChild) document.body.appendChild(host.firstChild);

  var backdrop = document.getElementById("ws-backdrop");
  var modal = document.getElementById("ws-modal");
  var form = document.getElementById("ws-form");
  var statusEl = document.getElementById("ws-status");
  var submitBtn = document.getElementById("ws-submit");
  var closeBtn = document.getElementById("ws-close");

  if (!modal || !form) return;

  var lastFocused = null;

  function setStatus(msg, kind) {
    statusEl.textContent = msg || "";
    statusEl.className = "cd-form-status" + (kind ? " is-" + kind : "");
  }

  function openModal() {
    lastFocused = document.activeElement;
    backdrop.hidden = false;
    modal.hidden = false;
    document.body.classList.add("ws-open");
    // Focus the first field so keyboard users land inside the dialog.
    var first = modal.querySelector("input, select, textarea");
    if (first) first.focus();
  }

  function closeModal() {
    backdrop.hidden = true;
    modal.hidden = true;
    document.body.classList.remove("ws-open");
    // Drop the #wholesale hash so a refresh doesn't reopen it, and so the
    // Spline link can be clicked again.
    if (location.hash === "#wholesale") {
      history.replaceState(null, "", location.pathname + location.search);
    }
    if (lastFocused && lastFocused.focus) lastFocused.focus();
    // wholesale.html listens for this to send the visitor back home.
    document.dispatchEvent(new CustomEvent("ember:wholesale-closed"));
  }

  // Lets wholesale.html open it on load without duplicating the markup.
  window.EmberWholesale = { open: openModal, close: closeModal };

  document.addEventListener("click", function (e) {
    var opener = e.target.closest("[data-wholesale-open]");
    if (opener) {
      e.preventDefault();
      openModal();
    }
  });

  // #wholesale — the address a Spline object (or any plain link) points at.
  function openIfHash() {
    if (location.hash === "#wholesale") openModal();
  }
  window.addEventListener("hashchange", openIfHash);
  openIfHash();

  closeBtn.addEventListener("click", closeModal);
  backdrop.addEventListener("click", closeModal);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !modal.hidden) closeModal();
  });

  // Keep tabbing inside the dialog while it's open.
  modal.addEventListener("keydown", function (e) {
    if (e.key !== "Tab") return;
    var focusable = modal.querySelectorAll("button, input, select, textarea");
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  function val(id) {
    return document.getElementById(id).value.trim();
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var data = {
      company: val("ws-company"),
      from_name: val("ws-name"),
      from_phone: val("ws-phone"),
      from_email: val("ws-email"),
      product: val("ws-product"),
      quantity: val("ws-qty"),
      notes: val("ws-notes") || "—"
    };

    var missing = [];
    if (!data.company) missing.push("company");
    if (!data.from_name) missing.push("your name");
    if (!data.from_phone) missing.push("phone");
    if (!data.from_email) missing.push("email");
    if (!data.product) missing.push("what you need");
    if (!data.quantity) missing.push("quantity");

    if (missing.length) {
      setStatus("Please fill in: " + missing.join(", ") + ".", "error");
      return;
    }

    if (!window.emailjs) {
      // Reachable if the EmailJS CDN is blocked or offline, so this has to
      // read as customer copy rather than a setup note.
      console.error("EmailJS unavailable — CDN blocked/offline, or keys not set in js/wholesale.js.");
      setStatus("We can't send this right now. Please reach us on WhatsApp at 0790026860.", "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";
    setStatus("");

    emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, data, { publicKey: EMAILJS_PUBLIC_KEY })
      .then(function () {
        if (window.EmberPixel) window.EmberPixel.lead("wholesale-quote");
        setStatus("Thanks — we'll be in touch with a quote shortly.", "success");
        submitBtn.textContent = "Request a quote";
        submitBtn.disabled = false;
        form.reset();
      })
      .catch(function (err) {
        console.error(err);
        setStatus("Something went wrong. Please try again, or WhatsApp us on 0790026860.", "error");
        submitBtn.textContent = "Request a quote";
        submitBtn.disabled = false;
      });
  });
})();
