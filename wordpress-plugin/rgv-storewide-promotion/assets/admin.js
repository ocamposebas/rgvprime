(function () {
  "use strict";

  function initializePromotionForm() {
    var scopes = Array.prototype.slice.call(
      document.querySelectorAll("[data-rgv-promotion-scope]"),
    );
    var productTarget = document.querySelector("[data-rgv-product-target]");
    var discountField = document.querySelector("[data-rgv-discount-field]");
    var countdown = document.querySelector("[data-rgv-countdown]");
    var endsAt = document.querySelector("[data-rgv-ends-at]");
    var headline = document.querySelector("[data-rgv-headline]");
    var headlineCount = document.querySelector("[data-rgv-headline-count]");

    if (!scopes.length) return;

    function selectedScope() {
      var selected = scopes.find(function (input) {
        return input.checked;
      });

      return selected ? selected.value : "announcement";
    }

    function updateFields() {
      var scope = selectedScope();
      var productSelect = productTarget
        ? productTarget.querySelector('select[name="product_id"]')
        : null;
      var discountInput = discountField
        ? discountField.querySelector('input[name="discount_percent"]')
        : null;

      if (productTarget) productTarget.hidden = scope !== "product";
      if (productSelect) productSelect.required = scope === "product";
      if (discountField) discountField.hidden = scope === "announcement";
      if (discountInput) discountInput.required = scope !== "announcement";
      if (endsAt) endsAt.required = Boolean(countdown && countdown.checked);
    }

    function updateHeadlineCount() {
      if (!headline || !headlineCount) return;
      headlineCount.textContent = headline.value.length + "/240";
    }

    scopes.forEach(function (input) {
      input.addEventListener("change", updateFields);
    });
    if (countdown) countdown.addEventListener("change", updateFields);
    if (headline) headline.addEventListener("input", updateHeadlineCount);
    updateFields();
    updateHeadlineCount();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializePromotionForm);
  } else {
    initializePromotionForm();
  }
})();
