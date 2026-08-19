(function () {
  "use strict";

  // The nav pill starts out of the way so the first view belongs to the
  // page itself, then drops in once the visitor has scrolled away from it.
  //
  // The hidden state is visibility:hidden in CSS rather than an aria-hidden
  // attribute, so the links leave the tab order while off screen without
  // hiding focusable children from assistive tech — which aria-hidden on a
  // container full of links would do.

  var SHOW_AFTER = 0.6;  // fraction of the viewport scrolled before it appears
  var MIN_PX = 320;      // floor, so short viewports do not reveal it instantly
  var THROTTLE = 80;

  // --- Skip link ---------------------------------------------------------
  // Following a same-page anchor moves the scroll position but not always
  // the focus, so the next Tab press can drop the visitor back at the top
  // of the document. Webflow's link module also tags this link w--current
  // and swallows the activation, so handle it directly.
  function initSkipLink() {
    var link = document.querySelector(".skip-link");
    if (!link) return;

    // Capture at the document so this runs before Webflow's link handler,
    // which otherwise consumes the activation.
    document.addEventListener("click", function (e) {
      var hit = e.target.closest && e.target.closest(".skip-link");
      if (!hit) return;
      var target = document.querySelector(hit.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }, true);
  }

  function init() {
    initSkipLink();
    var nav = document.querySelector(".container-4");
    if (!nav) return;

    nav.classList.add("nav-autohide");

    var pending = false;

    function update() {
      pending = false;
      var past = window.pageYOffset > Math.max(window.innerHeight * SHOW_AFTER, MIN_PX);
      nav.classList.toggle("is-visible", past);
    }

    function onScroll() {
      if (pending) return;
      pending = true;
      window.setTimeout(update, THROTTLE);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    // Deep links and refreshes can land mid-page; decide from where we are
    // rather than assuming the top.
    update();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
