/* Meta Pixel — Ember
 *
 * Loads the pixel once and exposes a safe tracking wrapper the rest of the
 * site calls. This lives in one file rather than being pasted into every
 * page's <head>, so the ID only exists in one place.
 *
 * Pixel ID 1355083486805338 ("Ember Website"), created 1 Aug 2026.
 * The ID is not a secret — it is visible in the page source of any site
 * running a pixel. Access tokens are a different matter and none live here.
 *
 * WHAT COUNTS AS A CONVERSION
 * Ember has no payment gateway: checkout emails the order and payment is
 * cash on delivery or CliQ over WhatsApp. So a completed checkout is a
 * Lead, NOT a Purchase — the money has not moved yet. Purchase is
 * deliberately never fired from the site. If paid-order tracking is wanted
 * later it has to come from the offline side, not from here.
 *
 * ADBLOCKERS
 * connect.facebook.net is blocked by most content blockers, so fbq may
 * never exist. Every call goes through EmberPixel.track(), which no-ops
 * instead of throwing. Nothing on this site should break because a tracker
 * was blocked.
 */
(function () {
  "use strict";

  var PIXEL_ID = "1355083486805338";

  /* Meta's standard base snippet. Left in its original shape so it stays
     easy to diff against what Events Manager hands you. */
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');

  fbq('init', PIXEL_ID);
  fbq('track', 'PageView');

  /* Safe wrapper. Call this, never fbq directly. */
  function track(eventName, params) {
    try {
      if (typeof window.fbq !== "function") return;
      if (params) fbq('track', eventName, params);
      else fbq('track', eventName);
    } catch (err) {
      /* A blocked or broken tracker must never take a page down with it. */
    }
  }

  /* Prices across the site are quoted in JOD. The ad account reports in
     USD, which is fine — event values are sent in the currency the
     customer actually pays and Meta converts for reporting. Sending a JOD
     figure labelled USD would overstate every order by roughly 40%. */
  var CURRENCY = "JOD";

  window.EmberPixel = {
    track: track,
    currency: CURRENCY,

    /* Someone started a WhatsApp or DM conversation. This is a real
       conversion for Ember — a large share of orders arrive this way and
       never touch checkout. */
    contact: function (source) {
      track('Contact', { content_name: source || 'unknown' });
    },

    /* A form that produces an order enquiry was submitted successfully:
       checkout, custom design, wholesale, or the contact form. */
    lead: function (source, value) {
      var params = { content_name: source || 'unknown' };
      if (typeof value === "number" && isFinite(value) && value > 0) {
        params.value = value;
        params.currency = CURRENCY;
      }
      track('Lead', params);
    },

    addToCart: function (name, value) {
      var params = { content_name: name || 'unknown' };
      if (typeof value === "number" && isFinite(value) && value > 0) {
        params.value = value;
        params.currency = CURRENCY;
      }
      track('AddToCart', params);
    }
  };

  /* WhatsApp links are scattered across the nav, contact section, checkout
     and the contact-form fallback, and store products can carry their own
     BuyLink. Delegation catches all of them, including markup added later
     by the store and blog renderers, without touching those files. */
  document.addEventListener('click', function (evt) {
    var link = evt.target && evt.target.closest ? evt.target.closest('a[href]') : null;
    if (!link) return;
    var href = link.getAttribute('href') || '';
    if (href.indexOf('wa.me') === -1 && href.indexOf('whatsapp') === -1) return;

    var label = (link.textContent || '').trim().slice(0, 60);
    window.EmberPixel.contact('whatsapp:' + (label || link.href));
  }, true);
})();
