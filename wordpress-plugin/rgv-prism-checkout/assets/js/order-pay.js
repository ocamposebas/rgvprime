(function () {
  'use strict';

  var copyReplacements = [
    [/PRISM Secure Checkout/gi, 'Secure card payment'],
    [/PRISM Fall Checkout/gi, 'Secure card payment'],
    [/Powered by PRISM/gi, 'Secure checkout'],
    [/PRISM research verification/gi, 'Secure research verification'],
    [/Loading PRISM verification/gi, 'Loading secure verification'],
    [/\bPRISM\b/gi, 'secure checkout']
  ];
  var revealTimer = 0;
  var revealQueued = false;
  var updateQueued = false;

  function replaceCopy(value) {
    return copyReplacements.reduce(function (current, entry) {
      return current.replace(entry[0], entry[1]);
    }, String(value || ''));
  }

  function neutralizeProviderCopy(root) {
    if (!root || root.nodeType !== 1) return;

    root.querySelectorAll('img[src*="prism-wordmark"], img[alt*="PRISM" i]').forEach(function (image) {
      image.hidden = true;
      image.setAttribute('aria-hidden', 'true');
    });

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(function (node) {
      if (!node.parentElement || /^(SCRIPT|STYLE|TEXTAREA|OPTION)$/.test(node.parentElement.tagName)) return;
      var nextValue = replaceCopy(node.nodeValue);
      if (nextValue !== node.nodeValue) node.nodeValue = nextValue;
    });

    root.querySelectorAll('[aria-label], [title], [alt]').forEach(function (element) {
      ['aria-label', 'title', 'alt'].forEach(function (attribute) {
        if (!element.hasAttribute(attribute)) return;
        var currentValue = element.getAttribute(attribute);
        var nextValue = replaceCopy(currentValue);
        if (nextValue !== currentValue) element.setAttribute(attribute, nextValue);
      });
    });
  }

  function paymentSurface() {
    return document.querySelector('#psc-checkout-root, #psc-checkout');
  }

  function arrangeCheckout() {
    var form = document.querySelector('form#order_review.rgv-order-pay, form#order_review');
    var payment = form ? form.querySelector(':scope > #payment') : null;
    var surface = paymentSurface();

    if (!form || !payment) return;

    // The provider normally prints this just before Woo's form. Move it only
    // before Stripe owns an iframe; moving a mounted iframe invalidates it.
    if (surface && surface.parentNode !== form && !surface.querySelector('iframe')) {
      form.insertBefore(surface, payment);
    }

    if (surface && surface.parentNode === form) {
      form.classList.add('rgv-payment-layout-ready');
      surface.classList.add('rgv-card-only-surface');

      surface.querySelectorAll('#psc-wallet-stage, .psc-wallet-stage, #psc-card-toggle').forEach(function (walletElement) {
        walletElement.hidden = true;
        walletElement.setAttribute('aria-hidden', 'true');
      });

      surface.querySelectorAll('#psc-card-stage, .psc-card-stage').forEach(function (cardStage) {
        cardStage.hidden = false;
        cardStage.removeAttribute('aria-hidden');
      });
    }

    var verified = document.querySelector('#psc-research-checkout[data-psc-step="complete"]');
    if (verified && verified.parentNode !== form && !verified.querySelector('iframe')) {
      form.insertBefore(verified, surface && surface.parentNode === form ? surface : payment);
    }

    var totalRow = form.querySelector('.rgv-order-summary__total, .order-total');
    if (totalRow) {
      totalRow.classList.add('rgv-order-summary__total');
      var totalHeading = totalRow.querySelector('th');
      if (totalHeading) totalHeading.textContent = 'Total due';
    }

    var paymentMethodRow = form.querySelector('.rgv-order-summary__method');
    if (paymentMethodRow) paymentMethodRow.setAttribute('aria-hidden', 'true');

    decorateButton(form, totalRow);
    scheduleReveal(form, surface);
  }

  function decorateButton(form, totalRow) {
    var button = form.querySelector('#place_order');
    var amount = totalRow ? totalRow.querySelector('.amount') : null;
    if (!button || !amount) return;

    var amountText = String(amount.textContent || '').trim();
    if (button.dataset.rgvAmount === amountText) return;

    var label = document.createElement('span');
    label.textContent = 'Pay securely';
    var price = document.createElement('strong');
    price.textContent = amountText;
    var arrow = document.createElement('i');
    arrow.setAttribute('aria-hidden', 'true');
    button.replaceChildren(label, price, arrow);
    button.dataset.rgvAmount = amountText;
    button.setAttribute('aria-label', 'Pay securely ' + amountText);
  }

  function scheduleReveal(form, surface) {
    if (document.body.classList.contains('rgv-payment-ui-ready') || revealQueued) return;
    if (!form.classList.contains('rgv-payment-layout-ready') || !surface) return;

    var hasSecureFrame = !!surface.querySelector('#psc-payment-element iframe, iframe');
    if (!hasSecureFrame) return;

    revealQueued = true;
    window.setTimeout(function () {
      document.body.classList.add('rgv-payment-ui-ready');
      var loader = document.querySelector('.rgv-payment-loader');
      if (loader) loader.setAttribute('aria-hidden', 'true');
    }, 180);
  }

  function update() {
    updateQueued = false;
    neutralizeProviderCopy(document.body);
    arrangeCheckout();
  }

  function queueUpdate() {
    if (updateQueued) return;
    updateQueued = true;
    window.requestAnimationFrame(update);
  }

  function start() {
    update();

    new MutationObserver(queueUpdate).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-psc-step']
    });

    // If the provider is slow or verification still needs attention, reveal a
    // coherent fallback instead of leaving the customer behind a skeleton.
    revealTimer = window.setTimeout(function () {
      arrangeCheckout();
      document.body.classList.add('rgv-payment-ui-ready');
      var loader = document.querySelector('.rgv-payment-loader');
      if (loader) loader.setAttribute('aria-hidden', 'true');
    }, 5200);

    window.addEventListener('pageshow', queueUpdate);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}());
