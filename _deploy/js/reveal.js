(function () {
  "use strict";

  // Scroll reveal for [data-reveal] elements. See css/reveal.css for why
  // this exists instead of the Webflow interactions that shipped with the
  // export.

  var STEP_MS = 70;   // stagger between items revealing together
  var MAX_DELAY = 420; // so a long run never trails far behind the scroll

  function init() {
    var els = document.querySelectorAll("[data-reveal]");
    if (!els.length) return;

    // No observer support, or the visitor asked for less motion: leave
    // everything as it is. Without .has-reveal nothing is ever hidden.
    if (!("IntersectionObserver" in window)) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    document.documentElement.classList.add("has-reveal");

    var queue = [];
    var scheduled = false;

    function flush() {
      scheduled = false;
      // Top-down so a cascade reads in the direction the eye is already
      // travelling, rather than in DOM order.
      queue.sort(function (a, b) {
        return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
      });
      queue.forEach(function (el, i) {
        el.style.setProperty("--reveal-delay", Math.min(i * STEP_MS, MAX_DELAY) + "ms");
        el.classList.add("is-revealed");
      });
      queue = [];
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        queue.push(entry.target);
      });
      // A timer rather than requestAnimationFrame: rAF is suspended while
      // the page is not compositing (background tab, hidden window), which
      // would leave anything scrolled past in that state hidden for good.
      if (queue.length && !scheduled) {
        scheduled = true;
        window.setTimeout(flush, 0);
      }
    }, {
      // Start a little before the element is fully on screen so it has
      // finished arriving by the time it is worth reading.
      rootMargin: "0px 0px -8% 0px",
      threshold: 0
    });

    Array.prototype.forEach.call(els, function (el) {
      observer.observe(el);
    });

    // Catch-up net.
    //
    // IntersectionObserver callbacks are throttled, and a fast scroll — a
    // flick on a phone, or a jump to an anchor — can carry an element
    // through the viewport between two callbacks. It never reports as
    // intersecting, so it would stay at opacity 0 for good even though the
    // reader has already scrolled past where it should have been.
    //
    // So on every settled scroll, reveal anything that has reached the
    // viewport at all, whether or not the observer saw it happen. Elements
    // still below the fold are left to the observer for the stagger.
    var catchUpPending = false;

    function catchUp() {
      catchUpPending = false;
      Array.prototype.forEach.call(
        document.querySelectorAll("[data-reveal]:not(.is-revealed)"),
        function (el) {
          if (el.getBoundingClientRect().top < window.innerHeight) {
            observer.unobserve(el);
            el.classList.add("is-revealed");
          }
        }
      );
    }

    function onScroll() {
      if (catchUpPending) return;
      catchUpPending = true;
      window.setTimeout(catchUp, 200);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    // And once after load, for anything the first paint got wrong.
    window.setTimeout(catchUp, 2500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
