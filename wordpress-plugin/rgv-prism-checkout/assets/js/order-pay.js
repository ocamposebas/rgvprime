(function () {
  'use strict';

  /* Apple Pay must begin while Safari still considers the checkout action a
     trusted user gesture. The provider performs server-side attempt checks
     before calling elements.submit(), which can make Safari reject the wallet
     sheet. Start submit in the trusted click/submit event and let the provider
     consume that exact promise after its safety checks finish. */
  function gestureSubmitBridge(elements) {
    if (!elements || typeof elements.submit !== 'function') return null;

    var originalSubmit = elements.submit.bind(elements);
    var pending = null;

    function remember(promise) {
      var guarded = Promise.resolve(promise);
      // The provider consumes this promise shortly afterwards. Attach a
      // rejection observer now so a slow create-attempt request cannot produce
      // an unhandled rejection before that consumer is attached.
      guarded.catch(function () {});
      pending = { promise: guarded, startedAt: Date.now() };
      return guarded;
    }

    return {
      begin: function () {
        if (pending && Date.now() - pending.startedAt < 1500) return pending.promise;
        try {
          return remember(originalSubmit());
        } catch (error) {
          return remember(Promise.reject(error));
        }
      },
      submit: function () {
        if (pending) {
          var current = pending;
          pending = null;
          return current.promise;
        }
        return originalSubmit();
      }
    };
  }

  function checkoutFormReady(form) {
    if (!form || !form.matches('form#order_review, form.checkout')) return false;
    if (!form.classList.contains('psc-wallet-ready')) return false;
    if (form.querySelector('input[name="psc_confirmation_token"]')) return false;

    var selected = form.querySelector('input[name="payment_method"]:checked');
    return !selected || selected.value === 'psc';
  }

  function beginGestureSubmit(form) {
    if (!checkoutFormReady(form)) return;
    var active = window.__rgvGestureSubmitElements;
    if (!active || typeof active.__rgvBeginGestureSubmit !== 'function') return;
    active.__rgvBeginGestureSubmit();
  }

  if (!window.__rgvGestureSubmitCaptureInstalled) {
    window.__rgvGestureSubmitCaptureInstalled = true;
    document.addEventListener('click', function (event) {
      if (!event.isTrusted) return;
      var target = event.target && event.target.closest
        ? event.target.closest('#place_order, button[name="woocommerce_pay"], input[name="woocommerce_checkout_place_order"]')
        : null;
      if (!target || target.disabled) return;
      beginGestureSubmit(target.closest('form'));
    }, true);
    document.addEventListener('submit', function (event) {
      if (!event.isTrusted) return;
      beginGestureSubmit(event.target);
    }, true);
  }

  function expressCheckoutOptions(options) {
    options = options || {};
    return Object.assign({}, options, {
      buttonHeight: 50,
      buttonTheme: Object.assign({}, options.buttonTheme || {}, {
        applePay: 'black',
        googlePay: 'black'
      }),
      buttonType: Object.assign({}, options.buttonType || {}, {
        applePay: 'check-out',
        googlePay: 'checkout'
      }),
      layout: {
        maxColumns: 2,
        overflow: 'never'
      },
      paymentMethodOrder: ['applePay', 'googlePay', 'link'],
      paymentMethods: Object.assign({}, options.paymentMethods || {}, {
        applePay: 'auto',
        googlePay: 'auto',
        link: 'auto',
        amazonPay: 'never',
        klarna: 'never',
        paypal: 'never'
      })
    });
  }

  /* The provider builds a deferred Stripe Elements session after research
     verification. Keep the manual form to card/bank and give eligible wallets
     a dedicated Express Checkout row above it. */
  function enforceCardOnlyStripe() {
    var controller = window.PSCCheckoutController;
    if (controller && !controller.__rgvCardOnlyOptionsV2 && typeof controller.paymentElementOptions === 'function') {
      var originalPaymentOptions = controller.paymentElementOptions.bind(controller);
      controller.paymentElementOptions = function (options) {
        return Object.assign({}, originalPaymentOptions(options) || {}, {
          layout: {
            type: 'accordion',
            defaultCollapsed: false,
            radios: false,
            spacedAccordionItems: false
          },
          paymentMethodOrder: ['card', 'us_bank_account'],
          wallets: { applePay: 'never', googlePay: 'never', link: 'never' }
        });
      };
      if (typeof controller.expressCheckoutOptions === 'function') {
        var originalExpressOptions = controller.expressCheckoutOptions.bind(controller);
        controller.expressCheckoutOptions = function (policy) {
          return expressCheckoutOptions(originalExpressOptions(policy));
        };
      }
      controller.__rgvCardOnlyOptionsV2 = true;
    }

    var originalStripe = window.Stripe;
    if (typeof originalStripe !== 'function') return false;
    if (originalStripe.__rgvCardOnlyFactoryV2) return true;

    var wrappedStripe = function () {
      var stripeClient = originalStripe.apply(this, arguments);
      if (!stripeClient || typeof stripeClient.elements !== 'function') {
        return stripeClient;
      }

      var originalElements = stripeClient.elements.bind(stripeClient);
      var guardedElements = function (options) {
        var elementsOptions = Object.assign({}, options || {}, {
          paymentMethodTypes: ['card', 'us_bank_account']
        });
        var elements = originalElements(elementsOptions);
        if (!elements || typeof elements.create !== 'function') return elements;

        var submitBridge = gestureSubmitBridge(elements);

        var originalCreate = elements.create.bind(elements);
        var guardedCreate = function (type, elementOptions) {
          if (type === 'expressCheckout') {
            return originalCreate(type, expressCheckoutOptions(elementOptions));
          }
          if (type !== 'payment') return originalCreate(type, elementOptions);

          return originalCreate(type, Object.assign({}, elementOptions || {}, {
            layout: {
              type: 'accordion',
              defaultCollapsed: false,
              radios: false,
              spacedAccordionItems: false
            },
            paymentMethodOrder: ['card', 'us_bank_account'],
            wallets: { applePay: 'never', googlePay: 'never', link: 'never' }
          }));
        };

        var guardedElementsProxy = new Proxy(elements, {
          get: function (target, property) {
            if (property === 'create') return guardedCreate;
            if (property === 'submit' && submitBridge) return submitBridge.submit;
            if (property === '__rgvBeginGestureSubmit' && submitBridge) return submitBridge.begin;
            var value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          }
        });
        if (submitBridge) window.__rgvGestureSubmitElements = guardedElementsProxy;
        return guardedElementsProxy;
      };
      return new Proxy(stripeClient, {
        get: function (target, property) {
          if (property === 'elements') return guardedElements;
          if (property === '__rgvCardOnlyElementsV2') return true;
          var value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
    };

    Object.getOwnPropertyNames(originalStripe).forEach(function (property) {
      if (['length', 'name', 'prototype', 'arguments', 'caller'].indexOf(property) !== -1) return;
      try {
        Object.defineProperty(wrappedStripe, property, Object.getOwnPropertyDescriptor(originalStripe, property));
      } catch (error) { /* Optional Stripe factory metadata. */ }
    });
    try {
      Object.defineProperty(wrappedStripe, '__rgvCardOnlyFactoryV2', { value: true });
      Object.defineProperty(window, 'Stripe', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: wrappedStripe
      });
    } catch (error) {
      window.Stripe = wrappedStripe;
    }
    window.__rgvCardOnlyRuntimeReady = window.Stripe === wrappedStripe;
    return window.__rgvCardOnlyRuntimeReady;
  }

  var cardOnlyChecks = 0;
  if (!enforceCardOnlyStripe()) {
    var cardOnlyTimer = window.setInterval(function () {
      cardOnlyChecks += 1;
      if (enforceCardOnlyStripe() || cardOnlyChecks > 400) {
        window.clearInterval(cardOnlyTimer);
      }
    }, 25);
  }

  var copyReplacements = [
    [/PRISM Secure Checkout/gi, 'Card payment'],
    [/PRISM Fall Checkout/gi, 'Card payment'],
    [/Powered by PRISM/gi, 'Card payment'],
    [/PRISM research verification/gi, 'Research verification'],
    [/Loading PRISM verification/gi, 'Loading verification'],
    [/\bPRISM\b/gi, 'payment']
  ];
  var revealTimer = 0;
  var revealQueued = false;
  var updateQueued = false;
  var confirmationReloadQueued = false;

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

  function managePendingConfirmation() {
    var notices = Array.prototype.filter.call(
      document.querySelectorAll('.woocommerce-error, .woocommerce-info, .woocommerce-message, .wc-block-components-notice-banner'),
      function (notice) {
        return /still confirming|still settling|confirmation is still|previous payment confirmation/i.test(
          String(notice.textContent || '')
        );
      }
    );

    if (!notices.length) return;

    notices.forEach(function (notice, index) {
      if (index > 0) {
        notice.hidden = true;
        notice.setAttribute('aria-hidden', 'true');
        return;
      }

      notice.hidden = false;
      notice.removeAttribute('aria-hidden');
      notice.classList.add('rgv-payment-confirmation-notice');
      notice.setAttribute('role', 'status');
      notice.textContent = 'Confirming your payment. Keep this page open — it will update automatically.';
    });

    document.body.classList.add('rgv-payment-reconciling');
    var button = document.querySelector('form#order_review #place_order');
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
      button.textContent = 'Checking payment status…';
    }

    var recovery = window.pscCheckout && window.pscCheckout.recovery;
    if (recovery && recovery.paymentId) return;
    if (confirmationReloadQueued) return;

    confirmationReloadQueued = true;
    window.setTimeout(function () {
      window.location.reload();
    }, 1400);
  }

  function manageVerificationRefresh() {
    var notices = Array.prototype.filter.call(
      document.querySelectorAll('.woocommerce-error, .woocommerce-info, .woocommerce-message, .psc-payment-message'),
      function (notice) {
        return /research verification changed/i.test(String(notice.textContent || ''));
      }
    );

    if (!notices.length) return;

    notices.forEach(function (notice, index) {
      if (index > 0) {
        notice.hidden = true;
        notice.setAttribute('aria-hidden', 'true');
        return;
      }

      notice.hidden = false;
      notice.removeAttribute('aria-hidden');
      notice.classList.add('rgv-payment-retry-notice');
      notice.setAttribute('role', 'status');
      notice.textContent = 'Your secure payment session was refreshed. Review the order and tap Pay securely once more. Nothing was charged.';
    });
  }

  function managePaymentFeedback() {
    var existing = document.querySelector('.rgv-payment-inline-notice');
    var sources = Array.prototype.filter.call(
      document.querySelectorAll(
        '.woocommerce-error, .woocommerce-info, .woocommerce-message, .wc-block-components-notice-banner, .psc-payment-message'
      ),
      function (notice) {
        if (notice.classList.contains('rgv-payment-inline-notice')) return false;
        return /payment cancelled|unable to show apple pay|apple pay.*different payment|couldn.t start the payment/i.test(
          String(notice.textContent || '')
        );
      }
    );

    if (!sources.length) {
      if (existing) existing.remove();
      return;
    }

    var combined = sources.map(function (notice) {
      return String(notice.textContent || '');
    }).join(' ');
    var message = /apple pay/i.test(combined)
      ? 'Apple Pay couldn\u2019t start. Nothing was charged \u2014 use Link, card, or bank.'
      : 'Payment cancelled \u2014 nothing was charged. Choose a payment method and try again.';

    sources.forEach(function (notice) {
      notice.hidden = true;
      notice.setAttribute('aria-hidden', 'true');
      notice.classList.add('rgv-payment-source-hidden');
    });

    var surface = paymentSurface();
    if (!surface) return;

    var compact = existing || document.createElement('div');
    compact.className = 'rgv-payment-inline-notice';
    compact.setAttribute('role', 'status');
    compact.setAttribute('aria-live', 'polite');
    if (String(compact.textContent || '') !== message) compact.textContent = message;
    compact.hidden = false;
    compact.removeAttribute('aria-hidden');
    if (compact.parentNode !== surface || compact !== surface.firstElementChild) {
      surface.insertBefore(compact, surface.firstChild);
    }
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

      surface.querySelectorAll('#psc-card-toggle').forEach(function (cardToggle) {
        cardToggle.hidden = true;
        cardToggle.setAttribute('aria-hidden', 'true');
      });

      surface.querySelectorAll('#psc-wallet-stage, .psc-wallet-stage').forEach(function (walletStage) {
        walletStage.classList.add('rgv-quick-pay');

        var expressElement = walletStage.querySelector('#psc-express-checkout-element, .psc-express-element');
        if (expressElement && !walletStage.querySelector(':scope > .rgv-quick-pay__label')) {
          var quickLabel = document.createElement('div');
          quickLabel.className = 'rgv-quick-pay__label';
          quickLabel.innerHTML = '<strong>Express checkout</strong><span>Fast and secure</span>';
          walletStage.insertBefore(quickLabel, expressElement);
        }
        if (expressElement && !walletStage.querySelector(':scope > .rgv-quick-pay__divider')) {
          var divider = document.createElement('div');
          divider.className = 'rgv-quick-pay__divider';
          divider.innerHTML = '<span>or pay with card or bank</span>';
          expressElement.insertAdjacentElement('afterend', divider);
        }
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
    var desiredLabel = 'Pay securely · ' + amountText;
    if (String(button.textContent || '').trim() !== desiredLabel) {
      button.textContent = desiredLabel;
    }
    button.dataset.rgvAmount = amountText;
    button.setAttribute('aria-label', desiredLabel);
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
    managePendingConfirmation();
    manageVerificationRefresh();
    managePaymentFeedback();
    arrangeCheckout();
  }

  function queueUpdate() {
    if (updateQueued) return;
    updateQueued = true;
    window.requestAnimationFrame(update);
  }

  function start() {
    enforceCardOnlyStripe();
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
