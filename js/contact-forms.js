(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Contact form + newsletter signup.
  //
  // Both of these shipped as Webflow forms with no action and no handler.
  // Off Webflow's own hosting that means every enquiry and every signup
  // was thrown away silently — the browser console logged "This page has
  // improperly configured forms" on every page load. This routes both
  // through the same EmailJS account already used for orders and custom
  // designs.
  //
  // ONE template covers both: the {{subject}} variable says which form it
  // came from, so there is no second template to create and keep in sync.
  //
  // >>> SETUP REQUIRED <<<
  // Create a template in the EmailJS dashboard using these variables:
  //   {{subject}} {{from_name}} {{from_email}} {{phone}} {{message}} {{page}}
  // then paste its ID below. Until that is filled in, the forms tell the
  // visitor to phone or email instead of failing silently — which is the
  // one thing the old behaviour got wrong.
  // ---------------------------------------------------------------------
  var EMAILJS_PUBLIC_KEY = atob("azNKaUE1NXY4RktfWU9uVlU=");
  var EMAILJS_SERVICE_ID = atob("c2VydmljZV8ycXlpdHh3");
  var EMAILJS_CONTACT_TEMPLATE_ID = ""; // <-- paste the template ID here

  // Shown when the template above has not been set up yet, so an enquiry
  // still has somewhere to go.
  var FALLBACK_HTML =
    'We could not send that just now. Please reach us on ' +
    '<a href="tel:+962799988777">+962 7 9998 8777</a> or ' +
    '<a href="https://wa.me/962790026860" target="_blank" rel="noopener">WhatsApp</a>.';

  function siblingByClass(form, cls) {
    // The done/fail panels sit next to the form inside its wrapper. That
    // wrapper is .ember-form rather than .w-form: Webflow's form module
    // claims every .w-form on the page and warns about them at load, and
    // these two are ours now.
    var wrap = form.closest(".ember-form") || form.closest(".w-form") || form.parentElement;
    return wrap ? wrap.querySelector(cls) : null;
  }

  function show(el, html) {
    if (!el) return;
    if (html) el.innerHTML = html;
    el.style.display = "block";
  }

  function hide(el) {
    if (el) el.style.display = "none";
  }

  function submitButton(form) {
    return form.querySelector('input[type="submit"], button[type="submit"]');
  }

  function send(form, params, onDone) {
    var done = siblingByClass(form, ".w-form-done");
    var fail = siblingByClass(form, ".w-form-fail");
    var btn = submitButton(form);
    var originalValue = btn ? (btn.value || btn.textContent) : "";
    var waitText = (btn && btn.getAttribute("data-wait")) || "Please wait...";

    hide(done);
    hide(fail);

    if (btn) {
      btn.disabled = true;
      if (btn.value !== undefined && btn.tagName === "INPUT") btn.value = waitText;
      else btn.textContent = waitText;
    }

    function restore() {
      if (!btn) return;
      btn.disabled = false;
      if (btn.tagName === "INPUT") btn.value = originalValue;
      else btn.textContent = originalValue;
    }

    if (!EMAILJS_CONTACT_TEMPLATE_ID || typeof window.emailjs === "undefined") {
      show(fail, FALLBACK_HTML);
      restore();
      return;
    }

    window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
    window.emailjs
      .send(EMAILJS_SERVICE_ID, EMAILJS_CONTACT_TEMPLATE_ID, params)
      .then(function () {
        if (window.EmberPixel) {
          window.EmberPixel.lead("contact-form:" + (params.subject || "unknown"));
        }
        form.reset();
        show(done);
        restore();
        if (onDone) onDone();
      })
      .catch(function (err) {
        show(fail, FALLBACK_HTML);
        restore();
        console.error("Ember contact form:", err);
      });
  }

  function handleContact(form) {
    var get = function (id) {
      var el = document.getElementById(id);
      return el ? el.value.trim() : "";
    };
    send(form, {
      subject: "Website enquiry",
      from_name: get("contact-name"),
      from_email: get("contact-email"),
      phone: get("contact-phone"),
      message: get("contact-comment"),
      page: window.location.pathname
    });
  }

  function handleNewsletter(form) {
    var input = form.querySelector('input[type="email"]');
    send(form, {
      subject: "Newsletter signup",
      from_name: "—",
      from_email: input ? input.value.trim() : "",
      phone: "—",
      message: "Signed up to the newsletter from " + window.location.pathname,
      page: window.location.pathname
    });
  }

  // Capture at the document, so this runs before the handler Webflow binds
  // to the form itself — otherwise Webflow's would still fire and log its
  // misconfiguration warning.
  document.addEventListener(
    "submit",
    function (e) {
      var form = e.target;
      if (!form || form.tagName !== "FORM") return;

      var isContact = form.id === "email-form";
      var isNewsletter = form.id === "email-form-2";
      if (!isContact && !isNewsletter) return;

      e.preventDefault();
      e.stopPropagation();

      if (form.checkValidity && !form.checkValidity()) {
        form.reportValidity();
        return;
      }

      if (isContact) handleContact(form);
      else handleNewsletter(form);
    },
    true
  );
})();
