(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // EmailJS setup — sends the order (items + delivery details) to you.
  // Uses the SAME EmailJS account as js/custom-design.js — copy the same
  // Public Key and Service ID you used there, then create a SECOND
  // template just for orders with these variables:
  //   {{customer_name}} {{customer_email}} {{customer_phone}}
  //   {{customer_address}} {{customer_city}} {{notes}} {{order_items}}
  //   {{order_subtotal}} {{payment_method}}
  // {{order_items}} arrives as plain text, one line per item — a template
  // like <pre>{{order_items}}</pre> keeps the line breaks.
  //
  // NOTE: values are base64-wrapped (same pattern as js/store-products.js)
  // so they're not plain-text in the page source. That's cosmetic, not
  // real security — EmailJS's Public Key is meant to be client-side; the
  // actual protection against abuse is the domain allowlist in your
  // EmailJS dashboard (Account -> Security).
  // Connected 2026-07: template "Store Order" in the EmailJS dashboard.
  // ---------------------------------------------------------------------
  var EMAILJS_PUBLIC_KEY = atob("azNKaUE1NXY4RktfWU9uVlU=");
  var EMAILJS_SERVICE_ID = atob("c2VydmljZV8ycXlpdHh3");
  var EMAILJS_ORDER_TEMPLATE_ID = atob("dGVtcGxhdGVfb3NxY2cyeA==");

  var emptyEl = document.getElementById("checkout-empty");
  var successEl = document.getElementById("checkout-success");
  var layoutEl = document.getElementById("checkout-layout");
  var itemsEl = document.getElementById("checkout-items");
  var subtotalEl = document.getElementById("checkout-subtotal");
  var form = document.getElementById("checkout-form");
  var statusEl = document.getElementById("checkout-status");
  var submitBtn = document.getElementById("checkout-submit-btn");

  var paymentRadios = document.querySelectorAll('input[name="payment-method"]');
  var cliqReminderEl = document.getElementById("cliq-reminder");
  var cliqReminderViewBtn = document.getElementById("cliq-reminder-view-btn");
  var cliqBackdropEl = document.getElementById("cliq-backdrop");
  var cliqModalEl = document.getElementById("cliq-modal");
  var cliqCloseBtn = document.getElementById("cliq-close-btn");
  var cliqGotItBtn = document.getElementById("cliq-got-it-btn");
  var cliqAmountEl = document.getElementById("cliq-amount");

  function selectedPaymentMethod() {
    var checked = document.querySelector('input[name="payment-method"]:checked');
    return checked ? checked.value : "Cash on Delivery";
  }

  function openCliqModal() {
    if (window.EmberCart) cliqAmountEl.textContent = EmberCart.getSubtotal().toFixed(2) + " JOD";
    document.body.classList.add("pm-open");
    cliqBackdropEl.classList.add("is-open");
    cliqModalEl.classList.add("is-open");
  }

  function closeCliqModal() {
    document.body.classList.remove("pm-open");
    cliqBackdropEl.classList.remove("is-open");
    cliqModalEl.classList.remove("is-open");
  }

  paymentRadios.forEach(function (radio) {
    radio.addEventListener("change", function () {
      if (selectedPaymentMethod() === "CliQ") {
        cliqReminderEl.hidden = false;
        openCliqModal();
      } else {
        cliqReminderEl.hidden = true;
        closeCliqModal();
      }
    });
  });

  cliqReminderViewBtn.addEventListener("click", openCliqModal);
  cliqCloseBtn.addEventListener("click", closeCliqModal);
  cliqGotItBtn.addEventListener("click", closeCliqModal);
  cliqBackdropEl.addEventListener("click", closeCliqModal);

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // item.image is just the design artwork on its own (a transparent PNG of
  // the print, nothing else) — the same thing the store lays over a shirt
  // mockup with CSS. Shown bare in a small thumbnail it reads as a broken
  // image, not a product. item.color is the label EmberShirts uses (set
  // when it was added to the cart), so it resolves back to the same
  // mockup photo the customer actually picked.
  function checkoutItemThumb(item) {
    var colorObj = (window.EmberShirts && item.color) ? window.EmberShirts.resolve(item.color) : null;
    if (!colorObj || !item.image) {
      return '<img class="checkout-item-image" src="' + escapeHtml(item.image) + '" alt="" loading="lazy">';
    }
    return (
      '<div class="checkout-item-image">' +
        '<img class="checkout-item-mockup" src="' + escapeHtml(window.EmberShirts.mockup(colorObj, "front")) + '" alt="" loading="lazy">' +
        '<img class="checkout-item-design" src="' + escapeHtml(item.image) + '" alt="" loading="lazy">' +
      "</div>"
    );
  }

  function render() {
    if (!window.EmberCart) return;
    var items = EmberCart.getItems();

    if (!items.length) {
      emptyEl.hidden = false;
      layoutEl.hidden = true;
      successEl.hidden = true;
      return;
    }

    emptyEl.hidden = true;
    layoutEl.hidden = false;

    itemsEl.innerHTML = items.map(function (item, i) {
      var variant = [item.size, item.color].filter(Boolean).join(" / ");
      return (
        '<div class="checkout-item">' +
          checkoutItemThumb(item) +
          '<div class="checkout-item-info">' +
            '<div class="checkout-item-name">' + escapeHtml(item.name) + "</div>" +
            (variant ? '<div class="checkout-item-variant">' + escapeHtml(variant) + "</div>" : "") +
            '<div class="checkout-item-price">' + escapeHtml(item.price) + "</div>" +
            (item.notes ? '<div class="checkout-item-notes">"' + escapeHtml(item.notes) + '"</div>' : "") +
            '<div class="checkout-item-controls">' +
              '<button type="button" class="cart-step-btn" data-step-index="' + i + '" data-step="-1" aria-label="Decrease quantity">–</button>' +
              '<span class="cart-item-qty">' + item.qty + "</span>" +
              '<button type="button" class="cart-step-btn" data-step-index="' + i + '" data-step="1" aria-label="Increase quantity">+</button>' +
              '<button type="button" class="cart-remove-btn" data-remove-index="' + i + '" aria-label="Remove item">Remove</button>' +
            "</div>" +
          "</div>" +
        "</div>"
      );
    }).join("");

    subtotalEl.textContent = EmberCart.getSubtotal().toFixed(2) + " JOD";
  }

  itemsEl.addEventListener("click", function (e) {
    var removeBtn = e.target.closest("[data-remove-index]");
    if (removeBtn) {
      EmberCart.removeItem(parseInt(removeBtn.getAttribute("data-remove-index"), 10));
      render();
      return;
    }
    var stepBtn = e.target.closest("[data-step-index]");
    if (stepBtn) {
      var idx = parseInt(stepBtn.getAttribute("data-step-index"), 10);
      var delta = parseInt(stepBtn.getAttribute("data-step"), 10);
      var items = EmberCart.getItems();
      if (items[idx]) EmberCart.setQty(idx, items[idx].qty + delta);
      render();
    }
  });

  function orderItemsText(items) {
    return items.map(function (item) {
      var variant = [item.size, item.color].filter(Boolean).join(" / ");
      var line = item.qty + "x " + item.name + (item.sku ? " (" + item.sku + ")" : "") + (variant ? " — " + variant : "") + " — " + item.price;
      return item.notes ? line + "\n  note: " + item.notes : line;
    }).join("\n");
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var items = EmberCart.getItems();
    if (!items.length) return;

    var name = document.getElementById("checkout-name").value.trim();
    var email = document.getElementById("checkout-email").value.trim();
    var phone = document.getElementById("checkout-phone").value.trim();
    var address = document.getElementById("checkout-address").value.trim();
    var city = document.getElementById("checkout-city").value.trim();
    var notes = document.getElementById("checkout-notes").value.trim();

    if (!name || !email || !phone || !address || !city) {
      statusEl.textContent = "Please fill in all required fields.";
      statusEl.className = "cd-form-status is-error";
      return;
    }

    if (!window.emailjs || EMAILJS_PUBLIC_KEY === "YOUR_PUBLIC_KEY") {
      // Reachable if the EmailJS CDN script fails to load, so this has to
      // read as customer copy, not a setup note.
      console.error("EmailJS unavailable — CDN blocked/offline, or keys not set in js/checkout.js.");
      statusEl.textContent = "We can't place your order right now. Please try again, or send us your order on WhatsApp at 0790026860.";
      statusEl.className = "cd-form-status is-error";
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Placing order...";
    statusEl.textContent = "";
    statusEl.className = "cd-form-status";

    var paymentMethod = selectedPaymentMethod();

    emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
    emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_ORDER_TEMPLATE_ID, {
      customer_name: name,
      customer_email: email,
      customer_phone: phone,
      customer_address: address,
      customer_city: city,
      notes: notes || "—",
      order_items: orderItemsText(items),
      order_subtotal: EmberCart.getSubtotal().toFixed(2) + " JOD",
      payment_method: paymentMethod
    }).then(function () {
      // Fires before clear(), while the subtotal still exists. This is a
      // Lead, not a Purchase — nothing has been paid at this point.
      if (window.EmberPixel) {
        window.EmberPixel.lead("checkout:" + paymentMethod, EmberCart.getSubtotal());
      }
      EmberCart.clear();
      layoutEl.hidden = true;
      successEl.hidden = false;
      successEl.querySelector(".checkout-success-note").textContent = paymentMethod === "CliQ"
        ? "Don't forget to send your CliQ payment screenshot on WhatsApp so we can confirm your order."
        : "Pay by cash when your order arrives.";
      submitBtn.textContent = "Place Order";
      submitBtn.disabled = false;
    }).catch(function (err) {
      statusEl.textContent = "Something went wrong placing your order. Please try again.";
      statusEl.className = "cd-form-status is-error";
      submitBtn.textContent = "Place Order";
      submitBtn.disabled = false;
      console.error(err);
    });
  });

  render();
})();
