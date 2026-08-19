(function () {
  "use strict";

  // Shared dialog behaviour for the product popup (store) and the CliQ
  // payment popup (checkout).
  //
  // js/wholesale.js already did this properly — aria-modal, a focus trap,
  // Escape to close, focus returned to whatever opened it. The other two
  // dialogs did none of it: opening the product modal left focus on
  // <body>, so a keyboard user carried on tabbing through the page behind
  // the overlay with no way to reach the close button. Rather than a
  // third copy of the logic, both now register here.
  //
  // Applied by observing the modal's own visibility, because each modal is
  // opened by its own script and there is no shared open/close call to
  // hook into.

  var FOCUSABLE = [
    "a[href]", "button:not([disabled])", "input:not([disabled])",
    "select:not([disabled])", "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])"
  ].join(",");

  function focusableIn(el) {
    return Array.prototype.filter.call(el.querySelectorAll(FOCUSABLE), function (n) {
      return n.offsetWidth > 0 || n.offsetHeight > 0 || n === document.activeElement;
    });
  }

  function register(modalSelector, closeSelector) {
    var modal = document.querySelector(modalSelector);
    if (!modal) return;

    var lastFocused = null;
    var wasOpen = false;

    modal.setAttribute("aria-modal", "true");
    if (!modal.getAttribute("role")) modal.setAttribute("role", "dialog");

    function isOpen() {
      // Each modal shows itself its own way. The wholesale one toggles the
      // `hidden` attribute; these two stay in the layout permanently and
      // fade in via an .is-open class driving opacity and pointer-events,
      // so display is always "block" and testing it would say "open" from
      // page load. Ask whether it is actually interactive.
      if (modal.hidden) return false;
      var cs = getComputedStyle(modal);
      // Deliberately not testing opacity: it is transitioned, so reading it
      // the instant the class lands gives 0 and the dialog looks shut.
      // pointer-events flips with the class and is never animated.
      return cs.display !== "none" &&
             cs.visibility !== "hidden" &&
             cs.pointerEvents !== "none";
    }

    function close() {
      var btn = modal.querySelector(closeSelector);
      if (btn) btn.click();
    }

    function onOpen() {
      lastFocused = document.activeElement;
      var targets = focusableIn(modal);
      var first = modal.querySelector(closeSelector) || targets[0];
      if (first) first.focus();
    }

    function onClose() {
      if (lastFocused && lastFocused.focus) lastFocused.focus();
      lastFocused = null;
    }

    function sync() {
      var open = isOpen();
      if (open === wasOpen) return;
      wasOpen = open;
      if (open) onOpen(); else onClose();
    }

    new MutationObserver(sync)
      .observe(modal, { attributes: true, attributeFilter: ["hidden", "class", "style"] });

    // The store builds its modal on the first "Buy This" click and inserts
    // it already open, so the opening happened before there was anything to
    // observe. Check the state we arrived at.
    sync();

    document.addEventListener("keydown", function (e) {
      if (!isOpen()) return;

      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }

      if (e.key !== "Tab") return;
      var targets = focusableIn(modal);
      if (!targets.length) return;
      var first = targets[0];
      var last = targets[targets.length - 1];

      // Focus can start outside the dialog if it opened without us seeing
      // it; pull it back in rather than letting Tab escape.
      if (!modal.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  // The product modal is built by store-products.js after its sheet fetch
  // resolves, so it does not exist yet when this file runs. Register the
  // ones already in the markup, and watch for the rest to arrive.
  function registerWhenReady(modalSelector, closeSelector) {
    if (document.querySelector(modalSelector)) {
      register(modalSelector, closeSelector);
      return;
    }
    var observer = new MutationObserver(function () {
      if (!document.querySelector(modalSelector)) return;
      observer.disconnect();
      register(modalSelector, closeSelector);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    registerWhenReady(".pm-modal:not(.cliq-modal)", ".pm-close-btn");  // product popup, store
    registerWhenReady(".cliq-modal", "#cliq-close-btn");               // CliQ payment, checkout
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
