(function () {
  "use strict";

  var CART_KEY = "ember_cart_v1";

  function loadCart() {
    try {
      var raw = localStorage.getItem(CART_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveCart(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    renderBadge();
  }

  function parsePrice(str) {
    var match = String(str || "").match(/[\d.]+/);
    return match ? parseFloat(match[0]) : 0;
  }

  function sameVariant(a, b) {
    return a.sku === b.sku && a.color === b.color && a.size === b.size && a.notes === b.notes;
  }

  function addItem(item) {
    var items = loadCart();
    var existing = items.find(function (i) { return sameVariant(i, item); });
    if (existing) {
      existing.qty += item.qty || 1;
    } else {
      items.push({
        sku: item.sku || "",
        name: item.name || "Untitled",
        price: item.price || "",
        image: item.image || "",
        color: item.color || "",
        size: item.size || "",
        notes: item.notes || "",
        qty: item.qty || 1
      });
    }
    saveCart(items);
  }

  function removeItem(index) {
    var items = loadCart();
    items.splice(index, 1);
    saveCart(items);
  }

  function setQty(index, qty) {
    var items = loadCart();
    if (!items[index]) return;
    qty = Math.max(1, qty | 0);
    items[index].qty = qty;
    saveCart(items);
  }

  function clearCart() {
    saveCart([]);
  }

  function getSubtotal() {
    return loadCart().reduce(function (sum, i) { return sum + parsePrice(i.price) * i.qty; }, 0);
  }

  function itemCount() {
    return loadCart().reduce(function (sum, i) { return sum + i.qty; }, 0);
  }

  // -----------------------------------------------------------------------
  // Badge — injected into every cart icon link found on the page. The
  // link's own href takes the customer straight to checkout.
  // -----------------------------------------------------------------------
  function renderBadge() {
    var count = itemCount();
    document.querySelectorAll(".cart-badge").forEach(function (badge) {
      badge.textContent = String(count);
      badge.hidden = count === 0;
    });
  }

  function wireCartIcons() {
    document.querySelectorAll("a.link-block.w-inline-block").forEach(function (link) {
      link.setAttribute("href", "checkout.html");
      if (link.querySelector(".cart-badge")) return;
      var badge = document.createElement("span");
      badge.className = "cart-badge";
      badge.hidden = true;
      link.appendChild(badge);
    });
  }

  function init() {
    wireCartIcons();
    renderBadge();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.EmberCart = {
    addItem: addItem,
    removeItem: removeItem,
    setQty: setQty,
    clear: clearCart,
    getItems: loadCart,
    getSubtotal: getSubtotal,
    parsePrice: parsePrice
  };
})();
