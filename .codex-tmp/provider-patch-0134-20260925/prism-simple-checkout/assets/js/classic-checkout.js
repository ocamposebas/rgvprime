(function ($) {
  'use strict';
  var cfg = window.pscCheckout || {};
  if (cfg.verification_only || (window.pscResearch && window.pscResearch.verification_only)) return;
  var researchManaged = !!window.pscResearch;
  var orderPay = cfg.orderPay && cfg.orderPay.orderId ? cfg.orderPay : null;
  var formSelector = orderPay ? 'form#order_review' : 'form.checkout';
  var api = window.PSCCheckoutController;
  if (!api) return;
  var stripe, elements, mountedAttempt, mountedBootstrap = false, bootstrapInflight = null, resubmitting = false;
  // H2: in-flight latch for place-order tokenization chain (independent of Woo .processing).
  var placeOrderInFlight = false;
  var expressAvailable = null;
  var paymentElement = null;
  var expressElement = null;
  var paymentNotRequired = false;
  var paymentMounted = false;
  var cartResyncTimer = null;
  var cartResyncInflight = null;
  var lastKnownCartAmountMinor = null;
  var hydrateEmailRevision = 0;
  var stableCheckoutShell = null;
  var mountedFieldPolicy = null;
  var optionalSections = [];
  function prismSelected() {
    return $('input[name="payment_method"]:checked').val() === (cfg.gatewayId || 'psc');
  }
  function canRefreshPrismCart() {
    // Woo removes all gateway radios for a free cart. The research gate still
    // owns verification; native Woo owns its no-payment submission.
    return prismSelected() || (researchManaged && !orderPay && $(formSelector).length > 0 && !$('input[name="payment_method"]').length);
  }
  /**
   * Apply light/dark shell classes from gateway theme setting (or data-psc-theme).
   * Preference: cfg.theme if light|dark, else data-psc-theme, else auto luminance.
   * Wordmark CSS follows the resulting theme classes (effective theme).
   */
  function applyCheckoutTheme() {
    var root = document.getElementById('psc-checkout');
    if (!root) return;
    var pref = String((document.body && document.body.dataset && document.body.dataset.pscCheckoutTheme) || (window.pscResearch && window.pscResearch.theme) || cfg.theme || root.getAttribute('data-psc-theme') || 'auto').toLowerCase();
    if (pref !== 'light' && pref !== 'dark' && pref !== 'auto') pref = 'auto';
    root.setAttribute('data-psc-theme', pref);
    var bodyBg = '';
    var docBg = '';
    try {
      bodyBg = window.getComputedStyle(document.body).backgroundColor;
      docBg = window.getComputedStyle(document.documentElement).backgroundColor;
    } catch (e) { /* harness may omit styles */ }
    var isDark = api.resolveCheckoutIsDark
      ? api.resolveCheckoutIsDark({ preference: pref, bodyBg: bodyBg, documentBg: docBg })
      : pref === 'dark';
    root.classList.toggle('psc-checkout--theme-dark', isDark);
    root.classList.toggle('psc-checkout--theme-light', !isDark);
  }
  function syncGateEmailToBilling() {
    var gate = $('#psc-gate-email');
    if (!gate.length) return;
    var val = String(gate.val() || '').trim();
    var billing = $('[name="billing_email"]').first();
    if (billing.length && val) billing.val(val).trigger('change');
  }
  function syncBillingToGateEmail() {
    var gate = $('#psc-gate-email');
    if (!gate.length) return;
    if (String(gate.val() || '').trim()) return;
    var billing = String($('[name="billing_email"]').first().val() || '').trim();
    if (billing) gate.val(billing);
  }
  /**
   * F3 (1.0.5 r2): if Woo replaced native billing_email with a blank input while the
   * gate still holds the verified address, push gate → native. Never delete/disable native.
   */
  function ensureNativeEmailFromGate() {
    var gate = $('#psc-gate-email');
    if (!gate.length) return;
    var gateVal = String(gate.val() || '').trim();
    if (!gateVal) return;
    var billing = $('[name="billing_email"]').first();
    if (!billing.length) return;
    if (!String(billing.val() || '').trim()) {
      billing.val(gateVal).trigger('change');
    }
  }
  function bindGateEmail() {
    var gate = $('#psc-gate-email');
    if (!gate.length) return;
    $(formSelector).addClass('psc-gate-owns-email');
    syncBillingToGateEmail();
    // After fragment refresh, refill blank native from gate (gate may not re-fire input).
    ensureNativeEmailFromGate();
    gate.off('input.pscGate change.pscGate').on('input.pscGate change.pscGate', function () {
      syncGateEmailToBilling();
    });
    $(document.body).off('change.pscGateBilling', '[name="billing_email"]').on('change.pscGateBilling', '[name="billing_email"]', function () {
      var v = String($(this).val() || '').trim();
      if (v && !String(gate.val() || '').trim()) gate.val(v);
    });
  }
  function setOtpStatus(text, kind) {
    var el = $('#psc-otp-status');
    if (!el.length) return;
    el.removeClass('psc-otp-status--success psc-otp-status--error psc-otp-status--info');
    if (!text) {
      el.text('').prop('hidden', true);
      return;
    }
    el.addClass('psc-otp-status--' + (kind || 'info'));
    el.text(text).prop('hidden', false);
    try {
      el[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (e) { /* ignore */ }
  }
  function message(text, kind) {
    var k = kind || (text ? 'error' : '');
    var nodes = $('#psc-payment-message, #psc-payment-message-footer, #psc-recovery-message');
    nodes.each(function () {
      var $n = $(this);
      $n.removeClass('psc-payment-message--success');
      if (k === 'success') $n.addClass('psc-payment-message--success');
      $n.text(text || '').prop('hidden', !text);
    });
    // OTP lifecycle also lands in the gate status (visible next to Send code).
    if (text && (k === 'success' || k === 'otp' || k === 'otp-error')) {
      setOtpStatus(text, k === 'otp-error' || k === 'error' ? 'error' : (k === 'success' || k === 'otp' ? 'success' : 'info'));
    }
    if (text) {
      try {
        var primary = document.getElementById('psc-payment-message') || document.getElementById('psc-recovery-message') || document.getElementById('psc-otp-status');
        if (primary) primary.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch (e2) { /* ignore */ }
    }
  }
  /**
   * Woo AJAX checkout errors often land in .woocommerce-error at the top of the form.
   * Themes may skip scroll; always bring the newest notice into view when PSC is selected.
   */
  function scrollCheckoutNoticesIntoView() {
    if (!prismSelected()) return;
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    var selectors = [
      '.woocommerce-NoticeGroup-checkout .woocommerce-error',
      '.woocommerce-NoticeGroup .woocommerce-error',
      '.woocommerce-notices-wrapper .woocommerce-error',
      'form.checkout .woocommerce-error',
      '.woocommerce-error',
      '.woocommerce-message',
      '.woocommerce-info',
      '#psc-payment-message:not([hidden])'
    ];
    var el = null;
    for (var i = 0; i < selectors.length; i++) {
      var found = null;
      try { found = document.querySelector(selectors[i]); } catch (e0) { found = null; }
      if (found && found.offsetParent !== null) {
        el = found;
        break;
      }
      if (found && !el) el = found;
    }
    if (!el) return;
    try {
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    } catch (e) {
      try { if (typeof el.scrollIntoView === 'function') el.scrollIntoView(true); } catch (e2) { /* ignore */ }
    }
  }
  /**
   * FIX (1.0.10.1): send the checkout form's posted state with every PRISM money request.
   *
   * Conditional checkout fees (shipping protection, insurance, tips, gift wrap) register
   * themselves from the POSTED checkout state — that is why they appear and update when
   * WooCommerce fires its update_order_review AJAX. PRISM's money endpoints were their own
   * requests that never carried that state, so such a fee was ABSENT when PRISM locked the
   * total and PRESENT again when WooCommerce processed the real submission. The total moved
   * between authorization and capture, the amount guard correctly refused, and the order
   * stranded in Pending payment.
   *
   * Field evidence (Puratek 2026-08-27T21:48Z):
   *   stage=create_attempt   attempt_amount=2094 live_amount=2094 delta=0  fees=none
   *   stage=process_payment  attempt_amount=2094 live_amount=2143 delta=49 fees=Shipping Protection=49
   */
  function checkoutPostData() {
    try {
      var form = $(formSelector);
      if (!form.length || typeof form.serialize !== 'function') return {};
      var serialized = form.serialize();
      return serialized ? { post_data: serialized } : {};
    } catch (e) {
      return {};
    }
  }
  function post(action, data) {
    // F6: 35s must exceed the PHP server client's 30s so a slow-but-successful
    // server call is never abandoned client-side while the server is finishing.
    // F1 (1.0.5 r2): wp_send_json_error(..., 400/409/502) makes jQuery REJECT the deferred.
    // A fulfillment-only .then never sees response.data — wallet catch then shows a generic.
    function errorFromPayload(payload, status) {
      var msg =
        (payload && payload.message) ||
        (status === 0 ? 'Network error. Check your connection and try again.' : 'Request failed.');
      var err = new Error(msg);
      if (payload && payload.code) err.code = payload.code;
      if (payload && payload.paid === true && payload.redirect) {
        err.paid = true;
        try {
          var destination = new URL(payload.redirect, window.location.href);
          if (destination.origin === window.location.origin) {
            err.redirect = destination.href;
            window.location.assign(destination.href);
          }
        } catch (eRedirect) { /* Keep the paid-order message if navigation is unavailable. */ }
      }
      return err;
    }
    function payloadFromJqXHR(jqXHR) {
      if (!jqXHR) return null;
      if (jqXHR.responseJSON) {
        return jqXHR.responseJSON.data != null ? jqXHR.responseJSON.data : jqXHR.responseJSON;
      }
      if (jqXHR.responseText) {
        try {
          var parsed = JSON.parse(jqXHR.responseText);
          return parsed && parsed.data != null ? parsed.data : parsed;
        } catch (eParse) { /* ignore */ }
      }
      return null;
    }
    return $.ajax({ url: cfg.ajaxUrl, method: 'POST', timeout: 35000,
                    data: $.extend({}, checkoutPostData(), orderPay ? { order_id: orderPay.orderId, order_key: orderPay.orderKey } : {}, data, { action: action, nonce: cfg.nonce }) }).then(
      function (response) {
        if (!response || !response.success) {
          throw errorFromPayload(response && response.data ? response.data : null, 200);
        }
        return response.data;
      },
      function (jqXHR) {
        var status = jqXHR && typeof jqXHR.status === 'number' ? jqXHR.status : 0;
        throw errorFromPayload(payloadFromJqXHR(jqXHR), status);
      }
    );
  }
  /** A4: watchdog for pre-payment promises so the place-order chain can never hang. */
  function withTimeout(promise, ms, label) {
    return Promise.race([ promise, new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error(label + ' timed out. Please try again.')); }, ms);
    }) ]);
  }
  function readField(name) {
    if (orderPay && orderPay.fields && Object.prototype.hasOwnProperty.call(orderPay.fields, name)) return String(orderPay.fields[name] || '');
    if (name === 'shipping_method') return $('input[name^="shipping_method"]:checked').val() || '';
    if (name === 'billing_email') {
      var gateEmail = String($('#psc-gate-email').val() || '').trim();
      if (gateEmail) return gateEmail;
    }
    return $('[name="' + name + '"]').first().val() || '';
  }
  function checkoutIdentityFields() {
    var names = [
      'billing_first_name', 'billing_last_name', 'billing_company', 'billing_address_1', 'billing_address_2',
      'billing_city', 'billing_state', 'billing_postcode', 'billing_country', 'billing_phone', 'billing_email',
      'shipping_first_name', 'shipping_last_name', 'shipping_company', 'shipping_address_1', 'shipping_address_2',
      'shipping_city', 'shipping_state', 'shipping_postcode', 'shipping_country', 'shipping_phone'
    ];
    var fields = {};
    names.forEach(function (name) { fields[name] = readField(name); });
    return fields;
  }
  function walletFieldsDiffer(f) {
    var keys = ['first_name', 'last_name', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country', 'phone'];
    return keys.some(function (k) {
      return String(f['billing_' + k] || '') !== String(f['shipping_' + k] || '');
    });
  }
  function createAttemptPost() {
    if (orderPay) return { order_id: orderPay.orderId, order_key: orderPay.orderKey };
    syncGateEmailToBilling();
    // Prefer controller wallet snapshot after Express confirm so replacement create_attempt
    // carries wallet addresses + ship flag even when the checkbox / DOM lag behind silent writes.
    var wallet = controller && controller.getWalletFields && controller.getWalletFields();
    var fields = wallet || checkoutIdentityFields();
    var shipDiff = wallet
      ? (walletFieldsDiffer(wallet) ? '1' : '0')
      : ($('#ship-to-different-address-checkbox').is(':checked') ? '1' : '0');
    return { fields: JSON.stringify(fields), ship_to_different_address: shipDiff };
  }
  function stripeName(prefix) {
    return (readField(prefix + '_first_name') + ' ' + readField(prefix + '_last_name')).trim();
  }
  function confirmationParams(attempt) {
    // Order-pay retains its locked delivery address without asking a wallet
    // to collect shipping again (its wallet policy has needs_shipping=false).
    return api.confirmationParams(attempt, (attempt.field_policy && attempt.field_policy.needs_shipping)
      || (orderPay && attempt.shipping && attempt.shipping.address_1));
  }
  function writeField(name, value, silent) {
    if (name === 'shipping_method') $('input[name^="shipping_method"][value="' + value.replace(/"/g, '') + '"]').prop('checked', true);
    else {
      var field = $('[name="' + name + '"]').first().val(value);
      if (!silent) field.trigger('change');
    }
    // Wallet handoff: when shipping differs from billing, check ship-to-different so Woo
    // update_checkout / place-order keep distinct shipping instead of ship-to-same mirror.
    // Prefer wallet snapshot after confirm; during the forEach write pass, read live DOM.
    if (String(name || '').indexOf('shipping_') === 0) {
      var wallet = controller && controller.getWalletFields && controller.getWalletFields();
      if (walletFieldsDiffer(wallet || checkoutIdentityFields())) {
        var cb = $('#ship-to-different-address-checkbox');
        if (cb.length && !cb.is(':checked')) {
          cb.prop('checked', true).trigger('change');
        }
      }
    }
  }
  function recalculateWoo() {
    if (orderPay) return Promise.resolve();
    return new Promise(function (resolve) {
      var done = false;
      var finish = function () { if (!done) { done = true; resolve(); } };
      $(document.body).one('updated_checkout.psc', finish).trigger('update_checkout');
      window.setTimeout(finish, 4000);
    });
  }
  function markFormReady(ready) {
    var form = $(formSelector);
    form.toggleClass('psc-wallet-ready', !!ready);
    form.toggleClass('psc-gate-incomplete', !ready);
    // Do NOT strip psc-card-mode when gate is incomplete — buyer may open
    // "Pay with card" before OTP; OTP blocks charge only, not address/card UI.
  }
  function isCardModeOn() {
    return $(formSelector).hasClass('psc-card-mode');
  }
  function safeUnmount(el) {
    if (!el) return;
    try {
      if (typeof el.unmount === 'function') el.unmount();
    } catch (e) { /* host may already be gone */ }
  }
  function unmountPaymentKeepInstance() {
    if (paymentElement && paymentMounted) {
      safeUnmount(paymentElement);
    }
    paymentMounted = false;
  }
  function mountPaymentIfCardMode() {
    if (paymentNotRequired) return;
    if (!paymentElement || paymentMounted) return;
    if (!researchManaged && !isCardModeOn()) return;
    if (typeof document === 'undefined' || !document.getElementById('psc-payment-element')) return;
    paymentElement.mount('#psc-payment-element');
    paymentMounted = true;
  }
  /**
   * Call immediately before every elements.submit(). Research checkout uses
   * Stripe's combined selector; legacy checkout retains its mount-on-card behavior.
   */
  function enforcePaymentMountForSubmit(kind) {
    // Research checkout uses Stripe's own method selector. Express Checkout and
    // the Payment Element share one mounted Elements session throughout.
    if (researchManaged) { mountPaymentIfCardMode(); return; }
    if (kind === 'express' || kind === 'wallet') {
      unmountPaymentKeepInstance();
      return;
    }
    if (isCardModeOn()) {
      mountPaymentIfCardMode();
    } else {
      unmountPaymentKeepInstance();
    }
  }
  function setCardMode(on) {
    $(formSelector).toggleClass('psc-card-mode', !!on);
    if (researchManaged) {
      $('#psc-card-stage').prop('hidden', paymentNotRequired || !prismSelected());
      $('#psc-card-toggle').prop('hidden', true);
      if (prismSelected()) mountPaymentIfCardMode();
      syncResearchNativeFields();
      placeOrderUnderCard();
      return;
    }
    $('#psc-card-stage').prop('hidden', !on);
    $('#psc-card-toggle').text(on ? 'Hide card form' : 'Pay with card');
    // Card and express both use full amount_minor (Stripe ECE pay total === Elements amount).
    if (elements && elements.update && window.__pscLastFullAmountMinor) {
      try { elements.update({ amount: Number(window.__pscLastFullAmountMinor) }); } catch (e) { /* ignore */ }
    }
    if (on) {
      mountPaymentIfCardMode();
    } else {
      unmountPaymentKeepInstance();
    }
    placeOrderUnderCard();
  }
  /** Hide wallet chrome only when PSC is not selected (or native_fallback has no Express). Never for OTP/gate. */
  function hideWalletCardUi() {
    setCardMode(false);
    $('#psc-wallet-stage, #psc-card-toggle, #psc-card-stage').prop('hidden', true);
  }
  function showWalletCardChrome() {
    if (paymentNotRequired) { $('#psc-wallet-stage, #psc-card-toggle, #psc-card-stage').prop('hidden', true); return; }
    var policy = mountedFieldPolicy || cfg.fieldPolicy || {};
    if (researchManaged) {
      var fallback = !!policy.native_fallback || expressAvailable === false;
      $('#psc-wallet-stage').prop('hidden', fallback);
      $('#psc-card-toggle').prop('hidden', true);
      $('#psc-card-stage').prop('hidden', false);
      $(formSelector).toggleClass('psc-native-fallback', !!policy.native_fallback);
      if (fallback) {
        if (!isCardModeOn() && paymentElement && paymentElement.update) paymentElement.update({ layout: 'tabs' });
        setCardMode(true);
      }
      mountPaymentIfCardMode();
      return;
    }
    if (policy.native_fallback) {
      $('#psc-wallet-stage').prop('hidden', true);
      $('#psc-card-toggle').prop('hidden', false);
      return;
    }
    $('#psc-wallet-stage').prop('hidden', expressAvailable === false);
    $('#psc-card-toggle').prop('hidden', false);
  }
  /**
   * Visual stack: PRISM gate → order table → wallets → card toggle → place order.
   * - Reparent #psc-checkout (or #psc-checkout-root) into form.checkout first so
   *   slot moves never detach payment / place_order from the form POST set.
   * - Move only the order table (+ optional sibling shipping UI), never full #order_review.
   * Prefers #psc-order-slot (Task 3 markup); falls back to insertBefore wallet.
   */
  /**
   * FIX (1.0.10.6): PRISM used to steal the order table on FIRST PAINT even when a
   * different gateway was selected, and never gave it back. On a stock theme that is
   * invisible; on a merchant with its own order-summary column it guts their layout.
   * Remember where the table lived so it can be returned when PSC is deselected.
   */
  var pscTableHome = null;
  function rememberTableHome(node) {
    if (pscTableHome || !node || !node.parentNode) return;
    if (node.parentNode.id === 'psc-order-slot') return;
    pscTableHome = { parent: node.parentNode, next: node.nextElementSibling };
  }
  function releaseStackedLayout() {
    if (!pscTableHome) return;
    var slot = document.querySelector('#psc-order-slot');
    if (!slot) { pscTableHome = null; return; }
    var moved = slot.querySelector('.woocommerce-checkout-review-order-table');
    var home = pscTableHome;
    pscTableHome = null;
    if (!moved || !home.parent || !document.body.contains(home.parent)) return;
    // Woo may have re-rendered a fresh table into its home during a fragment refresh.
    if (home.parent.querySelector('.woocommerce-checkout-review-order-table')) {
      if (moved.parentNode) moved.parentNode.removeChild(moved);
      return;
    }
    if (home.next && home.next.parentNode === home.parent) home.parent.insertBefore(moved, home.next);
    else home.parent.appendChild(moved);
  }
  /**
   * FIX (1.0.10.10): PSC's wallet-first CSS hides .woocommerce-shipping-fields and
   * .woocommerce-additional-fields, on the assumption they only hold data the wallet sheet
   * collects. But .woocommerce-additional-fields is where merchant custom checkout fields
   * render too, and WooCommerce still validates them. A hidden REQUIRED field means the
   * order is refused for a field the buyer never saw. Mark any container holding a required
   * row so the CSS leaves it alone.
   */
  function syncNativeRequiredVisibility() {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
    var groups = document.querySelectorAll('.woocommerce-shipping-fields, .woocommerce-additional-fields');
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      var hasRequired = !!g.querySelector('.validate-required, [required], [aria-required="true"]');
      if (!g.classList) continue;
      if (hasRequired) g.classList.add('psc-keep-native');
      else g.classList.remove('psc-keep-native');
    }
  }

  function syncResearchNativeFields() {
    var form = document.querySelector(formSelector);
    if (!form) return;
    form.querySelectorAll('.psc-manual-address-row, .psc-verified-identity-row').forEach(function (node) {
      node.classList.remove('psc-manual-address-row', 'psc-verified-identity-row');
    });
    if (paymentNotRequired || !isResearchWalletLayout() || !prismSelected()) return;
    var context = window.PSCResearchCheckout && window.PSCResearchCheckout.getStatus();
    var verified = !!(context && context.ready && controller.isGateComplete());
    var sameEmail = verified && String(readField('billing_email')).trim().toLowerCase() === String(context.email || '').trim().toLowerCase();
    var addressNames = /^(?:billing_(?:company|country|address_1|address_2|city|state|postcode|phone)|shipping_(?:first_name|last_name|company|country|address_1|address_2|city|state|postcode|phone))$/;
    form.querySelectorAll('#customer_details .form-row').forEach(function (row) {
      var controls = Array.prototype.filter.call(row.querySelectorAll('input[name], select[name], textarea[name]'), function (field) { return field.type !== 'hidden'; });
      if (!controls.length) return;
      var required = row.matches('.validate-required') || !!row.querySelector('[required], [aria-required="true"]');
      // Never hide an unknown merchant field, including one sharing a core row.
      if (controls.every(function (field) {
        return addressNames.test(field.name) && !(required && /_(?:company|phone)$/.test(field.name));
      })) {
        row.classList.add('psc-manual-address-row');
      } else if (sameEmail && controls.every(function (field) {
        return /^(?:billing_first_name|billing_last_name|billing_email)$/.test(field.name) && String(field.value || '').trim();
      })) row.classList.add('psc-verified-identity-row');
    });
    form.querySelectorAll('.woocommerce-billing-fields, .woocommerce-shipping-fields').forEach(function (group) {
      var hasOtherFields = Array.prototype.some.call(group.querySelectorAll('input[name], select[name], textarea[name]'), function (field) {
        if (field.type === 'hidden' || field.name === 'ship_to_different_address') return false;
        var row = field.closest('.form-row');
        return !row || (!row.classList.contains('psc-manual-address-row') && !row.classList.contains('psc-verified-identity-row'));
      });
      if (!hasOtherFields) {
        Array.prototype.forEach.call(group.children, function (child) {
          if (/^H[1-6]$/.test(child.tagName)) child.classList.add('psc-manual-address-row');
        });
        if (group.classList.contains('woocommerce-shipping-fields')) group.classList.add('psc-manual-address-row');
      }
    });
  }

  function addOptionalSection(nodes, title, open) {
    nodes = nodes.filter(function (node) { return node && node.parentNode; });
    if (!nodes.length || nodes[0].closest('.psc-optional-section')) return;
    var disclosure = document.createElement('details');
    disclosure.className = 'psc-optional-section psc-research-optional';
    disclosure.open = !!open;
    var summary = document.createElement('summary');
    summary.textContent = title;
    disclosure.appendChild(summary);
    nodes[0].parentNode.insertBefore(disclosure, nodes[0]);
    nodes.forEach(function (node) { disclosure.appendChild(node); });
    optionalSections.push(disclosure);
  }
  function enhanceOptionalSections() {
    if (!isResearchWalletLayout() || !controller.isGateComplete()) return;
    var form = document.querySelector(formSelector);
    if (!form) return;
    var note = form.querySelector('#order_comments_field');
    if (note && !note.matches('.validate-required') && !note.querySelector('[required], [aria-required="true"]')) {
      addOptionalSection([note], 'Add an order note', !!String(readField('order_comments')).trim());
    }
    var account = form.querySelector('.woocommerce-account-fields');
    var createAccount = account && account.querySelector('[name="createaccount"]');
    if (createAccount) {
      var unknownRequired = Array.prototype.some.call(account.querySelectorAll('.validate-required input, .validate-required select, .validate-required textarea, [required], [aria-required="true"]'), function (field) {
        return !/^account_/.test(field.name) && field.name !== 'createaccount';
      });
      if (!unknownRequired) addOptionalSection([account], 'Create a store account', createAccount.checked);
    }
    // Woo's existing coupon toggle already owns a working disclosure and its
    // form events. Give that real control the compact treatment without nesting
    // a coupon form inside checkout or taking ownership of its AJAX behavior.
    document.querySelectorAll('.woocommerce-form-coupon-toggle').forEach(function (toggle) { toggle.classList.add('psc-optional-coupon'); });
    optionalSections.forEach(function (section) { section.hidden = false; });
  }
  function releaseOptionalSections() {
    optionalSections.forEach(function (section) {
      if (!section.parentNode) return;
      Array.prototype.slice.call(section.children).forEach(function (child) {
        if (child.tagName !== 'SUMMARY') section.parentNode.insertBefore(child, section);
      });
      section.remove();
    });
    optionalSections = [];
    document.querySelectorAll('.psc-optional-coupon').forEach(function (node) { node.classList.remove('psc-optional-coupon'); });
  }

  /**
   * LAYOUT SETTING (1.0.10.12). Gateway option "layout":
   *   wallet_first (default) — PRISM shell hoisted to the top of the form, order table pulled
   *                            into it, billing/shipping revealed only in card mode.
   *   standard               — conventional WooCommerce order: customer details, then PRISM
   *                            (verification + wallets + card), then order review, then payment.
   * The shell is moved ONCE, before Elements mount, to a position outside both of the
   * fragments that update_checkout replaces (the review table and #payment). Moving a node
   * that contains Stripe's iframes reloads them, so the shell must never ride inside a
   * fragment. Express wallets stay mounted in standard mode — only their position changes.
   */
  function isStandardLayout() {
    return !!orderPay || String(cfg.layout || '').toLowerCase() === 'standard';
  }
  function isResearchWalletLayout() {
    return researchManaged && !isStandardLayout();
  }
  function checkoutShell() {
    var psc = stableCheckoutShell && document.body.contains(stableCheckoutShell)
      ? stableCheckoutShell.querySelector('#psc-checkout') || stableCheckoutShell
      : document.querySelector('#psc-checkout');
    if (!psc) return null;
    var root = psc.parentNode && psc.parentNode.id === 'psc-checkout-root' ? psc.parentNode : psc;
    stableCheckoutShell = root;
    // Woo payment fragments can print a fresh shell; retain the mounted original.
    document.querySelectorAll('#psc-checkout').forEach(function (candidate) {
      if (candidate !== psc && candidate.closest('#payment')) candidate.remove();
    });
    return root;
  }
  function applyResearchWalletLayout() {
    var form = document.querySelector(formSelector);
    var shell = checkoutShell();
    if (!form || !shell) return;
    var details = form.querySelector('#customer_details');
    // Keep Wolmart's existing left-column wrapper; neither Stripe iframe may be
    // moved after mounting, or its payment state would be discarded by the browser.
    if (!mountedBootstrap && !paymentMounted) {
      if (details && details.parentNode) {
        if (shell.parentNode !== details.parentNode || shell.nextElementSibling !== details) details.parentNode.insertBefore(shell, details);
      } else if (shell.parentNode !== form) form.insertBefore(shell, form.firstChild);
    }
    form.classList.remove('psc-layout-standard');
    form.classList.add('psc-layout-research-wallet');
    var review = form.querySelector('#order_review');
    if (details && review) {
      var main = details.parentNode;
      var summary = review.parentNode;
      if (main !== form && summary !== form && main !== summary && main.parentNode === summary.parentNode) {
        main.classList.add('psc-checkout-main');
        summary.classList.add('psc-checkout-summary');
      }
    }
    releaseStackedLayout();
    syncResearchNativeFields();
    enhanceOptionalSections();
    syncNativeRequiredVisibility();
    hideGatewayChrome();
    placeOrderUnderCard();
    if (review && api.setupOrderSummary) api.setupOrderSummary(review);
  }
  function applyStandardLayout() {
    if (!document || typeof document.querySelector !== 'function') return;
    var form = document.querySelector(formSelector);
    var shell = checkoutShell();
    if (!form || !shell) return;
    // Home: inside #order_review, directly before #payment — where WooCommerce puts gateway
    // fields. Works for single-column Woo (details → order → PRISM → pay) and for two-column
    // themes (details left; order → PRISM → pay in the right column), and keeps the shell
    // out of the form's own flex/grid flow where theme CSS reorders direct children.
    // #payment and the review table are the two fragments update_checkout replaces; a
    // sibling between them survives, so this is a one-time move.
    var review = form.querySelector('#order_review');
    var payment = review ? review.querySelector('#payment') : null;
    if (mountedBootstrap || paymentMounted) {
      // The shell is already outside Woo's replaced fragments. Leave iframes put.
    } else if (review && payment && payment.parentNode === review) {
      if (shell.parentNode !== review || shell.nextElementSibling !== payment) {
        review.insertBefore(shell, payment);
      }
    } else {
      // Fallbacks: after customer details, else before the review, else form top.
      var details = form.querySelector('#customer_details');
      if (details && details.parentNode === form) {
        if (shell.parentNode !== form || shell.previousElementSibling !== details) form.insertBefore(shell, details.nextSibling);
      } else if (review && review.parentNode) {
        if (shell.nextElementSibling !== review) review.parentNode.insertBefore(shell, review);
      } else if (shell.parentNode !== form) {
        form.insertBefore(shell, form.firstChild);
      }
    }
    // Never hold the order table inside the shell in this layout.
    releaseStackedLayout();
    if (form.classList) {
      form.classList.remove('psc-layout-research-wallet');
      form.classList.add('psc-layout-standard');
    }
    syncNativeRequiredVisibility();
    hideGatewayChrome();
    // Place order stays where WooCommerce renders it, under the payment methods.
    placeOrderReleaseToPayment();
  }

  function applyStackedLayout() {
    if (paymentNotRequired) { clearWalletFirstFormState(); return; }
    if (isStandardLayout()) { applyStandardLayout(); return; }
    if (isResearchWalletLayout()) { applyResearchWalletLayout(); return; }
    if (!document || typeof document.querySelector !== 'function') return;
    var form = document.querySelector(formSelector);
    var psc = document.querySelector('#psc-checkout');
    if (!form || !psc) return;

    // Production top shell mounts via before_checkout_form into #psc-checkout-root
    // (outside form). Bring the shell into the form as first child before any move.
    var root = document.querySelector('#psc-checkout-root');
    var shell = (root && psc.parentNode === root) ? root : psc;
    if (shell.parentNode !== form) {
      form.insertBefore(shell, form.firstChild);
    } else if (form.firstChild !== shell) {
      form.insertBefore(shell, form.firstChild);
    }

    var slot = document.querySelector('#psc-order-slot');
    var wallet = document.querySelector('#psc-wallet-stage');
    // Table only — leave #payment / #place_order in the form after wallet chrome.
    var table =
      document.querySelector('table.shop_table.woocommerce-checkout-review-order-table') ||
      document.querySelector('.woocommerce-checkout-review-order-table');
    if (!table) return;

    var shippingSibling = null;
    var sib = table.nextElementSibling;
    if (sib && sib.id !== 'payment') {
      var cls = sib.className || '';
      var isPayment = (typeof cls === 'string' && cls.indexOf('woocommerce-checkout-payment') !== -1) ||
        (sib.classList && sib.classList.contains && sib.classList.contains('woocommerce-checkout-payment'));
      if (!isPayment) {
        var looksShipping =
          sib.id === 'shipping_method' ||
          (typeof cls === 'string' && (
            cls.indexOf('woocommerce-shipping-methods') !== -1 ||
            cls.indexOf('shipping-methods') !== -1
          )) ||
          (typeof sib.querySelector === 'function' &&
            sib.querySelector('input[name^="shipping_method"], #shipping_method, .woocommerce-shipping-methods'));
        if (looksShipping) shippingSibling = sib;
      }
    }

    function placeInStack(node) {
      if (!node) return;
      if (slot) {
        if (node.parentNode !== slot) slot.appendChild(node);
      } else if (wallet && node.parentNode !== psc) {
        psc.insertBefore(node, wallet);
      }
    }
    rememberTableHome(table);
    placeInStack(table);
    placeInStack(shippingSibling);
    syncNativeRequiredVisibility();
    hideGatewayChrome();
    placeOrderUnderCard();
  }
  /** True when more than one payment method radio is present (multi-gateway store). */
  function hasMultipleGateways() {
    return $('input[name="payment_method"]').length > 1;
  }
  /**
   * Presentation: hide Woo gateway radio chrome only when PSC is the sole gateway.
   * Multi-gateway stores keep the selector so buyers can switch methods.
   */
  function hideGatewayChrome() {
    if (paymentNotRequired || !prismSelected() || hasMultipleGateways()) {
      $(formSelector).removeClass('psc-hide-gateway-chrome');
      return;
    }
    $(formSelector).addClass('psc-hide-gateway-chrome');
    var gid = cfg.gatewayId || 'psc';
    var radio = $('input[name="payment_method"][value="' + gid + '"]');
    if (radio.length && !radio.is(':checked')) {
      radio.prop('checked', true);
    }
  }
  /** Gate email is only required while PSC is the selected method. */
  function syncGateEmailRequired() {
    var gate = $('#psc-gate-email');
    if (!gate.length) return;
    if (prismSelected()) {
      try { gate.prop('required', true); } catch (e0) { /* harness */ }
      try { if (gate.attr) gate.attr('required', 'required'); } catch (e1) { /* harness */ }
    } else {
      try { gate.prop('required', false); } catch (e2) { /* harness */ }
      try { if (gate.removeAttr) gate.removeAttr('required'); } catch (e3) { /* harness */ }
    }
  }
  /**
   * #10: HTML5 constraint validation still runs on fields inside [hidden] ancestors.
   * Clear pattern/required/customValidity on PSC interactive inputs when another
   * gateway is selected so COD/other methods can submit. Restore when PSC returns.
   */
  function syncPscFieldConstraints() {
    var gate = $('#psc-gate-email');
    var code = $('#psc-code');
    if (prismSelected()) {
      if (gate.length) {
        try { gate.prop('disabled', false); } catch (e0) { /* harness */ }
        try { if (gate[0] && gate[0].setCustomValidity) gate[0].setCustomValidity(''); } catch (e1) { /* harness */ }
      }
      if (code.length) {
        try { code.prop('disabled', false); } catch (e2) { /* harness */ }
        try {
          if (code.attr && !code.attr('pattern')) code.attr('pattern', '[0-9]{6}');
        } catch (e3) { /* harness */ }
        try { if (code[0] && code[0].setCustomValidity) code[0].setCustomValidity(''); } catch (e4) { /* harness */ }
      }
      syncGateEmailRequired();
      return;
    }
    if (gate.length) {
      try { gate.prop('required', false); } catch (e5) { /* harness */ }
      try { if (gate.removeAttr) gate.removeAttr('required'); } catch (e6) { /* harness */ }
      try { if (gate[0] && gate[0].setCustomValidity) gate[0].setCustomValidity(''); } catch (e7) { /* harness */ }
      try { gate.prop('disabled', true); } catch (e8) { /* harness */ }
    }
    if (code.length) {
      try { if (code.removeAttr) code.removeAttr('pattern'); } catch (e9) { /* harness */ }
      try { if (code[0] && code[0].setCustomValidity) code[0].setCustomValidity(''); } catch (e10) { /* harness */ }
      try { code.prop('disabled', true); } catch (e11) { /* harness */ }
    }
  }
  /** Hide or show the PRISM shell when another gateway is selected (multi-gateway). */
  function syncShellVisibility() {
    var root = $('#psc-checkout-root, #psc-checkout');
    if (!root.length) return;
    if (!paymentNotRequired && prismSelected()) {
      try { root.prop('hidden', false); } catch (e0) { /* harness */ }
      try { if (root.removeAttr) root.removeAttr('hidden'); } catch (e1) { /* harness */ }
      $(formSelector).addClass('psc-gateway-selected');
    } else {
      try { root.prop('hidden', true); } catch (e2) { /* harness */ }
      try { if (root.attr) root.attr('hidden', 'hidden'); } catch (e3) { /* harness */ }
      $(formSelector).removeClass('psc-gateway-selected');
    }
  }
  /**
   * Presentation: move Place order row immediately after #psc-card-stage (document flow).
   * Must stay inside form.checkout. Does not touch PE lifecycle.
   *
   * Ownership (1.0.5): prefer the fresh #payment #place_order Woo injects on
   * updated_checkout. Remove any stale moved place-order rows so duplicate IDs
   * and dual submit controls never remain in the DOM. CSS hiding alone is not enough.
   *
   * F2 (1.0.5 r2): when PRISM is NOT selected, never steal the button into the PSC
   * shell — return/keep it under #payment and drop psc-place-order-owned so COD/etc.
   * keep a visible submit.
   */
  function placeOrderFindBtn(root) {
    if (!root || typeof root.querySelector !== 'function') return null;
    return root.querySelector('#place_order') ||
      root.querySelector('button[name="woocommerce_checkout_place_order"]') ||
      root.querySelector('input[name="woocommerce_checkout_place_order"]');
  }
  /**
   * FIX (1.0.10.8): stock WooCommerce fires woocommerce_review_order_before_submit INSIDE
   * <div class="form-row place-order">, so a merchant's consent checkboxes are CHILDREN of
   * the row we relocate. Dragging the whole row into the card stage carried them out of
   * .woocommerce-checkout-payment — the only region Woo's fragment refresh replaces — so a
   * field the server had already suppressed stayed on screen permanently, under the pay
   * button. Move only the button and its hidden fields; leave everything else in the
   * container Woo owns, where a refresh can update or remove it.
   */
  function evacuatePlaceOrderExtras(row, btn, payment) {
    if (!row || !btn || !payment || !row.childNodes) return;
    var kids = Array.prototype.slice.call(row.childNodes);
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (!n || n.nodeType !== 1) continue;
      if (n === btn) continue;
      if (n.contains && n.contains(btn)) continue;
      if (n.tagName === 'NOSCRIPT') continue;
      if (n.tagName === 'INPUT' && (n.type === 'hidden' || n.type === 'submit')) continue;
      // Anything else goes back to #payment. A nonce nested inside an evacuated wrapper is
      // still submitted — #payment lives inside form.checkout either way — so we must not
      // keep a whole wrapper just because it happens to contain a hidden input.
      try { payment.appendChild(n); } catch (eEvac) { /* leave it where it is */ }
    }
  }

  function placeOrderRowFor(btn) {
    if (!btn) return null;
    var row = btn.closest ? btn.closest('.form-row') : null;
    if (!row) row = btn.parentElement;
    return row;
  }
  function placeOrderReleaseToPayment() {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    var form = document.querySelector(formSelector);
    var payment = document.querySelector('#payment');
    if (!form) return;
    try {
      if (form.classList && form.classList.remove) form.classList.remove('psc-place-order-owned');
      else if (window.jQuery) window.jQuery(form).removeClass('psc-place-order-owned');
    } catch (eRel) { /* harness */ }
    if (!payment) return;
    // Prefer a button already under #payment (Woo fresh fragment).
    var btn = placeOrderFindBtn(payment);
    var row = placeOrderRowFor(btn);
    if (!row) {
      // Recover the PSC-owned row and put it back under #payment.
      btn = placeOrderFindBtn(form);
      row = placeOrderRowFor(btn);
      if (row && payment && !payment.contains(row)) {
        payment.appendChild(row);
      }
    }
    // Strip any extra place-order rows (stale under card stage, etc.) — keep one under #payment.
    if (typeof form.querySelectorAll === 'function') {
      var keep = placeOrderRowFor(placeOrderFindBtn(payment));
      var rows = form.querySelectorAll('.form-row.place-order');
      for (var i = 0; i < rows.length; i++) {
        if (keep && rows[i] === keep) continue;
        // Keep the #payment-owned row even if keep lookup failed.
        if (!keep && payment.contains(rows[i])) {
          keep = rows[i];
          continue;
        }
        if (rows[i].parentNode) rows[i].parentNode.removeChild(rows[i]);
      }
    }
  }
  function placeOrderUnderCard() {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    if (paymentNotRequired) { placeOrderReleaseToPayment(); return; }
    // Standard layout: the button belongs to #payment exactly as WooCommerce rendered it.
    if (isStandardLayout()) { placeOrderReleaseToPayment(); return; }
    // F2: other gateways own #payment place-order — do not move under PSC chrome.
    if (!prismSelected()) {
      placeOrderReleaseToPayment();
      return;
    }
    var form = document.querySelector(formSelector);
    var card = document.querySelector('#psc-card-stage');
    if (!form || !card) return;
    var manualSubmit = null;
    if (isResearchWalletLayout()) {
      var details = form.querySelector('#customer_details');
      if (!details || !details.parentNode) { placeOrderReleaseToPayment(); return; }
      manualSubmit = form.querySelector('.psc-manual-submit');
      if (!manualSubmit) {
        manualSubmit = document.createElement('div');
        manualSubmit.className = 'psc-manual-submit';
        details.parentNode.insertBefore(manualSubmit, details.nextSibling);
      }
    }
    var payment = document.querySelector('#payment');
    // Prefer the button Woo just injected into #payment over a previously moved one.
    var btn = placeOrderFindBtn(payment);
    if (!btn) {
      btn = placeOrderFindBtn(form) ||
        document.querySelector('#place_order') ||
        document.querySelector('form.checkout button[name="woocommerce_checkout_place_order"]') ||
        document.querySelector('form.checkout input[name="woocommerce_checkout_place_order"]');
    }
    if (!btn) return;
    var row = placeOrderRowFor(btn);
    if (!row || !form.contains(row)) return;
    // Keep merchant consent fields inside #payment before the row leaves it (1.0.10.8).
    evacuatePlaceOrderExtras(row, btn, payment);
    // Drop every other place-order row (stale move + any duplicate Woo fragment).
    var stale = [];
    if (typeof form.querySelectorAll === 'function') {
      var rows = form.querySelectorAll('.form-row.place-order');
      for (var i = 0; i < rows.length; i++) {
        if (rows[i] !== row) stale.push(rows[i]);
      }
      // Also catch orphan #place_order not wrapped in .place-order.
      var orphans = form.querySelectorAll('#place_order, button[name="woocommerce_checkout_place_order"], input[name="woocommerce_checkout_place_order"]');
      for (var j = 0; j < orphans.length; j++) {
        if (orphans[j] === btn) continue;
        var orphanRow = orphans[j].closest ? orphans[j].closest('.form-row') : orphans[j].parentElement;
        if (orphanRow && orphanRow !== row && stale.indexOf(orphanRow) === -1) stale.push(orphanRow);
        else if (!orphanRow || orphanRow === orphans[j]) {
          if (stale.indexOf(orphans[j]) === -1 && orphans[j] !== row) stale.push(orphans[j]);
        }
      }
    }
    for (var k = 0; k < stale.length; k++) {
      if (stale[k] && stale[k].parentNode) stale[k].parentNode.removeChild(stale[k]);
    }
    if (manualSubmit) {
      if (row.parentNode !== manualSubmit) manualSubmit.appendChild(row);
    } else if (card.nextElementSibling !== row) {
      if (card.parentNode) {
        card.parentNode.insertBefore(row, card.nextSibling);
      }
    }
    // Belt class for CSS: hide any place-order still trapped under #payment.
    try {
      if (form.classList && form.classList.add) form.classList.add('psc-place-order-owned');
      else if (window.jQuery) window.jQuery(form).addClass('psc-place-order-owned');
    } catch (eOwn) { /* harness */ }
  }
  // Multi-gateway: wallet-first collapse classes must not stick when another method is selected.
  function clearWalletFirstFormState() {
    $(formSelector).removeClass(
      'psc-gate-incomplete psc-wallet-ready psc-card-mode psc-native-fallback psc-hide-gateway-chrome psc-gateway-selected psc-place-order-owned psc-layout-research-wallet'
    );
    // F2: return Place order to #payment before hiding PSC chrome (setCardMode → placeOrderUnderCard releases).
    placeOrderReleaseToPayment();
    releaseStackedLayout();
    hideWalletCardUi();
    syncGateEmailRequired();
    syncPscFieldConstraints();
    syncShellVisibility();
    syncResearchNativeFields();
    releaseOptionalSections();
    if (researchManaged) return;
    mountedAttempt = null;
    mountedBootstrap = false;
    bootstrapInflight = null;
    paymentElement = null;
    paymentMounted = false;
    elements = null;
  }
  function syncWalletFirstForGateway() {
    if (!prismSelected()) {
      clearWalletFirstFormState();
      return;
    }
    syncPscFieldConstraints();
    syncGateEmailRequired();
    syncShellVisibility();
    if (controller.isGateComplete && controller.isGateComplete()) markFormReady(true);
    else markFormReady(false);
    applyStackedLayout();
    syncNativeRequiredVisibility();
    hideGatewayChrome();
    ensureExpressMounted();
  }
  function bindExpressHandlers(express) {
    expressElement = express;
    function availability(methods) {
      expressAvailable = !!methods && Object.keys(methods).some(function (key) {
        var method = methods[key];
        return method && typeof method === 'object' ? method.available === true : method === true;
      });
      showWalletCardChrome();
    }
    express.on('ready', function (event) { availability(event.availablePaymentMethods); });
    express.on('loaderror', function () { availability(null); });
    express.on('availablepaymentmethodschange', function (event) { availability(event.paymentMethods); });
    express.on('confirm', function (event) {
      api.classicWalletSubmit(controller, event).catch(function (error) {
        // Surface the real per-cause reason OUTSIDE the wallet sheet
        // (#psc-payment-message + footer), not only Stripe paymentFailed in-sheet.
        var reason = (error && (error.message || error.code)) || 'Payment could not be completed.';
        message(reason);
        if (event && event.paymentFailed) event.paymentFailed({ reason: 'fail' });
        else if (event && event.reject) event.reject();
      });
    });
    express.on('shippingaddresschange', function (event) {
      controller.handleShippingAddressChange(event.shippingAddress || event.address || event, event).catch(function () {
        if (event.reject) event.reject();
      });
    });
    express.on('shippingratechange', function (event) {
      controller.handleShippingRateChange(event.shippingRate && event.shippingRate.id || '', event).catch(function () {
        if (event.reject) event.reject();
      });
    });
    // Dismissed sheet: restore Elements amount to full amount_minor (Stripe guide pattern).
    express.on('cancel', function () {
      if (controller.handleWalletCancel) controller.handleWalletCancel();
      message((api.buyerCopy && api.buyerCopy('wallet_cancel')) || 'Payment cancelled. Nothing was charged.');
    });
  }
  function mountFromPayload(payload, isAttempt) {
    if (researchManaged && !orderPay && payload.needs_payment === false) {
      useNativeNoPayment();
      return Promise.resolve();
    }
    if (paymentNotRequired) {
      paymentNotRequired = false;
      syncShellVisibility();
      applyStackedLayout();
    }
    if (!window.Stripe) return Promise.reject(new Error('Secure payment form is unavailable.'));
    stripe = window.Stripe(payload.publishable_key, { stripeAccount: payload.connected_account });
    // Elements amount = full Woo total (amount_minor). Stripe never auto-adds shippingRates
    // into the pay total; rates are picker-only. Mount-at-full is mandatory (Apple Pay
    // honors mid-sheet decreases only — never open below amount_minor).
    var policy = payload.field_policy || cfg.fieldPolicy || {};
    mountedFieldPolicy = policy;
    moneyFromPayload(payload);
    var fullAmount = Number(window.__pscLastFullAmountMinor || payload.amount_minor);
    var elementsAmount = fullAmount;
    elements = stripe.elements({
      mode: 'payment',
      amount: elementsAmount,
      currency: payload.currency,
      paymentMethodCreation: 'manual',
      appearance: api.paymentAppearance ? api.paymentAppearance((document.body && document.body.dataset && document.body.dataset.pscCheckoutTheme) === 'dark' || $('#psc-checkout').hasClass('psc-checkout--theme-dark')) : undefined,
      fonts: cfg.fontUrl ? [{ cssSrc: cfg.fontUrl.replace(/\.woff2(?:\?.*)?$/, '.css') }] : []
    });
    expressAvailable = null;
    $('#psc-express-checkout-element,#psc-payment-element').empty();
    paymentElement = null;
    paymentMounted = false;
    var paymentOptions = researchManaged && api.paymentElementOptions
      ? api.paymentElementOptions({ collapsed: isResearchWalletLayout() && !policy.native_fallback, billingDetails: { name: stripeName('billing'), email: readField('billing_email') } })
      : { fields: { billingDetails: 'never' } };
    paymentElement = elements.create('payment', paymentOptions);
    if (researchManaged) paymentElement.on('change', function (event) {
      // Selection opens addresses immediately; a complete card number is not
      // needed. Collapsing preserves native values and the mounted Stripe input.
      if (!isResearchWalletLayout() || policy.native_fallback || expressAvailable === false) { setCardMode(true); return; }
      if (event.collapsed === true) setCardMode(false);
      else if (event.collapsed === false && event.value && event.value.type) setCardMode(true);
    });
    if (researchManaged || isCardModeOn()) {
      mountPaymentIfCardMode();
    }
    // Mount Express only when not native_fallback (multi-package / custom fields).
    if (!policy.native_fallback) {
      var expressOptions = api.expressCheckoutOptions(orderPay ? Object.assign({}, policy, { needs_shipping: false }) : policy);
      if (expressOptions) {
        try {
          var express = elements.create('expressCheckout', expressOptions);
          bindExpressHandlers(express);
          express.mount('#psc-express-checkout-element');
        } catch (error) { expressAvailable = false; }
      } else expressAvailable = false;
    } else expressAvailable = false;
    mountedBootstrap = true;
    if (isAttempt && payload.attempt_id) mountedAttempt = payload.attempt_id;
    else mountedAttempt = null;
    showWalletCardChrome();
    return Promise.resolve();
  }
  /**
   * Mount Express via psc_express_bootstrap — does NOT require isGateComplete.
   * Wallets stay visible whenever PSC is selected (except native_fallback).
   */
  function ensureExpressMounted() {
    if (researchManaged && !(controller.isGateComplete && controller.isGateComplete())) return Promise.resolve();
    if (!canRefreshPrismCart()) return Promise.resolve();
    if (cfg.fieldPolicy && cfg.fieldPolicy.native_fallback) {
      $(formSelector).addClass('psc-native-fallback');
      // Rider 2: no Express; force card mode so PE mounts for Place order.
      $('#psc-wallet-stage').prop('hidden', true);
      $('#psc-card-toggle').prop('hidden', false);
      setCardMode(true);
      if (mountedBootstrap && elements) {
        mountPaymentIfCardMode();
        return Promise.resolve();
      }
      if (bootstrapInflight) return bootstrapInflight;
      bootstrapInflight = post('psc_express_bootstrap', {}).then(function (boot) {
        return mountFromPayload(boot, false);
      }).catch(function (error) {
        message(error.message);
      }).then(function () {
        bootstrapInflight = null;
        setCardMode(true);
        mountPaymentIfCardMode();
      });
      return bootstrapInflight;
    }
    // Always show wallet chrome when Express is allowed — OTP never blanks this.
    showWalletCardChrome();
    if (mountedBootstrap && elements) return Promise.resolve();
    if (bootstrapInflight) return bootstrapInflight;
    bootstrapInflight = post('psc_express_bootstrap', {}).then(function (boot) {
      return mountFromPayload(boot, false);
    }).catch(function (error) {
      message(error.message);
    }).then(function () {
      bootstrapInflight = null;
    });
    return bootstrapInflight;
  }
  function useNativeNoPayment() {
    if (!paymentNotRequired) {
      [paymentElement, expressElement].forEach(function (element) {
        safeUnmount(element);
        if (element && element.destroy) { try { element.destroy(); } catch (error) { /* Already removed by Woo. */ } }
      });
      paymentElement = null; expressElement = null; elements = null;
      paymentMounted = false; mountedBootstrap = false; mountedAttempt = null;
      controller.reset();
    }
    paymentNotRequired = true;
    lastKnownCartAmountMinor = 0;
    clearPlaceOrderChain({ strip: true });
    clearWalletFirstFormState();
  }
  /**
   * Pay-path mount: reuse bootstrap Elements when present so Express confirm tokens
   * stay on the same Stripe session. Fall back to attempt-backed mount if bootstrap never ran.
   */
  function moneyFromPayload(payload) {
    var full = Number(payload && payload.amount_minor);
    var base = payload && payload.wallet_display_base_minor != null
      ? Number(payload.wallet_display_base_minor) : full;
    if (Number.isFinite(full) && full > 0) {
      window.__pscLastFullAmountMinor = full;
    }
    // Display base kept for diagnostics/tripwire only — never used as Elements amount.
    if (Number.isFinite(base) && base >= 0) {
      window.__pscLastDisplayAmountMinor = base;
    }
    return {
      amount_minor: full,
      wallet_display_base_minor: base,
      field_policy: (payload && payload.field_policy) || cfg.fieldPolicy || {}
    };
  }
  function elementsAmountForKind(payload, kind) {
    var money = moneyFromPayload(payload);
    if (controller && controller.elementsAmountForMode) {
      return controller.elementsAmountForMode(money, kind === 'express' || kind === 'wallet' ? 'express' : (kind === 'card' || kind === 'payment' ? 'card' : 'auto'));
    }
    // Full amount_minor for every mode (Stripe pay total === Elements amount).
    return money.amount_minor;
  }
  function applyElementsMoney(payload, kind) {
    if (!elements || !elements.update) return;
    var amount = elementsAmountForKind(payload, kind);
    if (!(amount > 0)) return;
    try { elements.update({ amount: amount }); } catch (e) { /* unmounted */ }
  }
  function ensureMounted(attempt, kind) {
    if (elements && (mountedAttempt === attempt.attempt_id || mountedBootstrap)) {
      mountedAttempt = attempt.attempt_id;
      showWalletCardChrome();
      // Always pin full amount_minor (card and express share identity).
      applyElementsMoney(attempt, kind || (isCardModeOn() ? 'card' : 'express'));
      return Promise.resolve();
    }
    return mountFromPayload(attempt, true);
  }
  function createToken(kind, attempt) {
    return ensureMounted(attempt, kind).then(function () {
      enforcePaymentMountForSubmit(kind);
      // Immediately before token: pin Elements amount for this payment mode.
      applyElementsMoney(attempt, kind);
      // F6: ONE 20s watchdog over the FULL submit -> createConfirmationToken chain,
      // so a hung elements.submit() recovers the button too (pure client-side).
      return withTimeout(Promise.resolve(elements.submit()).then(function (result) {
        if (result && result.error) throw new Error(result.error.message || (api.buyerCopy && api.buyerCopy('pe_incomplete')) || 'Payment details are incomplete. Check the card and try again.');
        return stripe.createConfirmationToken({ elements: elements, params: confirmationParams(attempt) });
      }), 20000, 'Card check');
    }).then(function (result) {
      if (!result || result.error) throw new Error(result && result.error && result.error.message || 'Payment token failed.');
      return { id: result.confirmationToken.id };
    });
  }
  function stripPscHiddenFields() {
    // H2: never leave stale tokens for a resubmitting passthrough or other gateway.
    ['psc_attest', 'psc_attempt_id', 'psc_operation_id', 'psc_confirmation_token'].forEach(function (name) {
      $(formSelector).find('input[type="hidden"][name="' + name + '"]').remove();
    });
  }
  function hasFreshPscFields() {
    var attemptId = $(formSelector).find('input[name="psc_attempt_id"]').val() || '';
    var token = $(formSelector).find('input[name="psc_confirmation_token"]').val() || '';
    var op = $(formSelector).find('input[name="psc_operation_id"]').val() || '';
    return !!(attemptId && op && token && String(token).indexOf('ctoken_') === 0);
  }
  function setPlaceOrderDisabled(disabled) {
    var $btn = $(formSelector).find('#place_order, button[name="woocommerce_checkout_place_order"], input[name="woocommerce_checkout_place_order"], button[name="woocommerce_pay"]');
    $btn.prop('disabled', !!disabled);
    if (disabled) $btn.attr('aria-busy', 'true');
    else $btn.removeAttr('aria-busy');
  }
  function clearPlaceOrderChain(opts) {
    opts = opts || {};
    placeOrderInFlight = false;
    resubmitting = false;
    setPlaceOrderDisabled(false);
    if (opts.strip !== false) stripPscHiddenFields();
  }
  function submitWoo(data) {
    syncGateEmailToBilling();
    if (orderPay) data.woocommerce_pay = '1';
    Object.keys(data).forEach(function (name) {
      var field = $(formSelector).find('input[name="' + name + '"]');
      if (!field.length) field = $('<input type="hidden">').attr('name', name).appendTo($(formSelector));
      field.val(data[name]);
    });
    // Only arm passthrough when gate is complete and fields are fresh.
    if (controller.isGateComplete && controller.isGateComplete() && hasFreshPscFields()) {
      resubmitting = true;
    } else {
      resubmitting = false;
      stripPscHiddenFields();
      throw new Error('Checkout is not ready to submit payment.');
    }
    if (orderPay) {
      var form = $(formSelector)[0];
      // Native pay submits this existing order; Woo AJAX checkout would create another.
      setPlaceOrderDisabled(false);
      if (!form || !form.reportValidity()) { clearPlaceOrderChain({ strip: true }); return data; }
      resubmitting = false;
      HTMLFormElement.prototype.submit.call(form);
      return data;
    }
    $(formSelector).trigger('submit');
    // If Woo swallowed the submit (.processing / third-party block), clear the latch
    // so a later click cannot bypass the gate with stale tokens.
    setTimeout(function () {
      if (resubmitting && !$(formSelector).hasClass('processing')) {
        clearPlaceOrderChain({ strip: true });
      }
    }, 0);
    return data;
  }
  var controller = api.createController({
    researchManaged: researchManaged, orderPay: !!orderPay,
    onResearchRequired: function (error) { document.dispatchEvent(new CustomEvent('psc:research-required', { detail: { code: error.code, message: error.message } })); },
    readField: readField, writeField: writeField, post: post, recalculateWoo: recalculateWoo,
    createAttemptFields: createAttemptPost,
    invalidateAttempt: function () { controller.reset(); },
    adoptAttempt: function (attempt) {
      mountedAttempt = attempt.attempt_id;
      moneyFromPayload(attempt);
    },
    updateElementsAmount: function (amount) {
      // Legacy: bare integer treated as full total for card-ish updates only.
      if (elements) {
        try { elements.update({ amount: Number(amount) }); } catch (e) { /* ignore */ }
      }
    },
    updateElementsMoney: function (money, mode) {
      if (!elements || !elements.update) return;
      moneyFromPayload(money);
      // Always full amount_minor — mode no longer selects a display base.
      var amount = controller.elementsAmountForMode
        ? controller.elementsAmountForMode(money, mode || (isCardModeOn() ? 'card' : 'auto'))
        : Number(money.amount_minor);
      if (!(amount > 0)) return;
      try { elements.update({ amount: amount }); } catch (e) { /* ignore */ }
    },
    createConfirmationToken: createToken, submitWoo: submitWoo
  });
  if (researchManaged) {
    $(formSelector).addClass('psc-research-managed');
    function researchSaved(event) {
      var context = event && event.detail || (window.PSCResearchCheckout && window.PSCResearchCheckout.getStatus());
      if (!controller.setResearchContext(context)) return;
      applyCheckoutTheme();
      markFormReady(true);
      applyStackedLayout();
      if (!mountedBootstrap) setCardMode(isStandardLayout() || !!(cfg.fieldPolicy && cfg.fieldPolicy.native_fallback));
      enhanceOptionalSections();
      ensureExpressMounted();
      message('');
    }
    document.addEventListener('psc:research-saved', researchSaved);
    document.addEventListener('psc:research-invalidated', function () {
      controller.invalidateResearch(); mountedAttempt = null;
      clearPlaceOrderChain({ strip: true }); markFormReady(false);
      syncResearchNativeFields();
      optionalSections.forEach(function (section) { section.hidden = true; });
    });
    researchSaved();
  }
  /**
   * Coupon / qty / shipping on the checkout page fire updated_checkout.
   * Re-fetch live cart money payload (full + display base); never collapse base into full.
   */
  function runCartResync() {
    if (researchManaged && !controller.isGateComplete()) return Promise.resolve(null);
    if (!canRefreshPrismCart()) return Promise.resolve(null);
    if (controller.isWalletHandoffActive && controller.isWalletHandoffActive()) {
      return Promise.resolve(null);
    }
    if (cartResyncInflight) return cartResyncInflight;
    cartResyncInflight = post('psc_express_bootstrap', {}).then(function (boot) {
      if (researchManaged && !orderPay && boot.needs_payment === false) { useNativeNoPayment(); return boot; }
      var fresh = Number(boot && boot.amount_minor);
      if (!(fresh > 0)) return boot;
      if (paymentNotRequired) {
        paymentNotRequired = false;
        syncShellVisibility();
        applyStackedLayout();
        return mountFromPayload(boot, false).then(function () { return boot; });
      }
      lastKnownCartAmountMinor = fresh;
      if (typeof window !== 'undefined') {
        window.__pscCheckoutCartAmountMinor = fresh;
      }
      moneyFromPayload(boot);
      var mode = isCardModeOn() ? 'card' : 'auto';
      if (controller.resyncCartAmount) {
        var result = controller.resyncCartAmount(boot, mode);
        if (result && result.dropped) {
          mountedAttempt = null;
          // Do not clear OTP/legal — only money state dropped.
          message((api.buyerCopy && api.buyerCopy('cart_stale_js')) || 'Your cart total changed. Review your order and try payment again.');
        }
      } else {
        applyElementsMoney(boot, mode === 'card' ? 'card' : 'express');
      }
      return boot;
    }).catch(function () {
      return null;
    }).then(function (boot) {
      cartResyncInflight = null;
      return boot;
    });
    return cartResyncInflight;
  }
  function scheduleCartResync() {
    if (!canRefreshPrismCart()) return;
    if (controller.isWalletHandoffActive && controller.isWalletHandoffActive()) return;
    if (cartResyncTimer) clearTimeout(cartResyncTimer);
    cartResyncTimer = setTimeout(function () {
      cartResyncTimer = null;
      runCartResync();
    }, 300);
  }
  function syncGateReadyClass() {
    if (controller.isGateComplete && controller.isGateComplete()) markFormReady(true);
    else markFormReady(false);
  }
  $(document).on('click', '#psc-send-code', function () {
    syncGateEmailToBilling();
    var btn = $(this).prop('disabled', true);
    setOtpStatus('Sending verification code…', 'info');
    var doneSend = function () { btn.prop('disabled', false); };
    controller.sendCode().then(function (result) {
      if (result && result.dispatch_state === 'ambiguous') {
        var amb = (api.buyerCopy && api.buyerCopy('otp_send_ambiguous')) || 'We couldn’t confirm the email was sent. Wait a moment and tap Resend.';
        message(amb, 'otp-error');
        setOtpStatus(amb, 'error');
        return;
      }
      message('Email sent successfully — check your inbox for the 6-digit code.', 'success');
      setOtpStatus('Email sent successfully. Enter the code below.', 'success');
    }).catch(function (error) {
      message(error.message || 'Could not send code.', 'otp-error');
      setOtpStatus(error.message || 'Could not send code.', 'error');
    }).then(doneSend, doneSend);
  });
  $(document).on('click', '#psc-verify-code', function () {
    syncGateEmailToBilling();
    var btn = $(this).prop('disabled', true);
    var doneVerify = function () { btn.prop('disabled', false); };
    controller.verifyCode($('#psc-code').val(), $('#psc-remember-device').is(':checked')).then(function () {
      $('#psc-code').val('');
      $('#psc-remember-note').prop('hidden', false);
      message('Billing email verified. Accept research terms, then pay.', 'success');
      setOtpStatus('Email verified. Accept the research terms below, then you can pay.', 'success');
      $('#psc-step-banner').addClass('psc-step-banner--done');
      syncGateReadyClass();
      // Wallets already painted via bootstrap — never gate mount on OTP success.
      ensureExpressMounted();
    }).catch(function (error) {
      message(error.message || 'Verification failed.', 'otp-error');
      setOtpStatus(error.message || 'Verification failed.', 'error');
    }).then(doneVerify, doneVerify);
  });
  $(document).on('change', '#psc-attest-checkbox', function () {
    controller.setAttested(this.checked);
    if (!this.checked) {
      // Drop money attempt identity; keep bootstrap Elements painted.
      mountedAttempt = null;
      markFormReady(false);
      setCardMode(false);
      return;
    }
    syncGateReadyClass();
    ensureExpressMounted();
  });
  $(document).on('click', '#psc-card-toggle', function () {
    var on = !$(formSelector).hasClass('psc-card-mode');
    setCardMode(on);
  });
  function handlePlaceOrder() {
    if (paymentNotRequired) {
      stripPscHiddenFields();
      return controller.isGateComplete();
    }
    // H2: passthrough only when this click is the intentional resubmit after tokenization,
    // gate is complete, and psc_* fields are fresh — never with a stuck latch alone.
    if (resubmitting) {
      resubmitting = false;
      if (!controller.isGateComplete || !controller.isGateComplete() || !hasFreshPscFields()) {
        stripPscHiddenFields();
        placeOrderInFlight = false;
        setPlaceOrderDisabled(false);
        message('Verify email and accept research terms before paying.');
        return false;
      }
      return true;
    }
    if (placeOrderInFlight) {
      return false;
    }
    // Keep checkbox → controller attestation in sync before gate check.
    if (!researchManaged) controller.setAttested($('#psc-attest-checkbox').is(':checked'));
    // Gate blocks CHARGE only — wallets stay visible regardless.
    if (!controller.isGateComplete || !controller.isGateComplete()) {
      message('Verify email and accept research terms before paying.');
      return false;
    }
    placeOrderInFlight = true;
    setPlaceOrderDisabled(true);
    api.classicSubmit(controller, 'payment').then(function () {
      // submitWoo armed resubmitting; Woo owns the form now. Keep button disabled until
      // checkout_error or page navigation. placeOrderInFlight clears on error paths.
    }).catch(function (error) {
      message(error && error.message ? error.message : 'Payment could not start.');
      clearPlaceOrderChain({ strip: true });
    });
    return false;
  }
  function bindPlaceOrder() {
    if (orderPay) {
      $(formSelector).off('submit.pscOrderPay').on('submit.pscOrderPay', function (event) {
        if (!prismSelected()) return;
        event.preventDefault(); handlePlaceOrder();
      });
      return;
    }
    $(formSelector).off('checkout_place_order_psc.psc').on('checkout_place_order_psc.psc', handlePlaceOrder);
  }
  bindPlaceOrder();
  // Woo fires checkout_error when AJAX place-order returns failures (e.g. stale cart).
  $(document.body).on('checkout_error.pscNotices', function () {
    controller.markAttemptForRevalidation();
    clearPlaceOrderChain({ strip: true });
    var woo = null;
    try { woo = document.querySelector('.woocommerce-error'); } catch (eWoo) { woo = null; }
    var wooText = woo && (woo.textContent || woo.innerText) ? String(woo.textContent || woo.innerText).trim() : '';
    if (wooText) message(wooText);
    if (isResearchWalletLayout()) {
      setCardMode(true);
      optionalSections.forEach(function (section) {
        if (section.querySelector('.woocommerce-invalid, [aria-invalid="true"]')) section.open = true;
      });
    }
    setTimeout(scrollCheckoutNoticesIntoView, 50);
  });
  /**
   * FIX (1.0.10.9): WooCommerce does NOT refresh the order review when the shopper changes
   * gateway — it only swaps the payment box and the button label. So anything the server
   * renders conditionally on the chosen gateway keeps whatever the PREVIOUS render produced.
   * That is why a merchant consent checkbox PSC suppresses server-side stayed on screen:
   * the suppression was correct, it was simply never asked for again. Request exactly one
   * refresh when PSC gains or loses assent ownership, and never on unrelated changes.
   */
  var pscAssentGateway = null;
  function currentGatewayValue() {
    return $('input[name="payment_method"]:checked').val() || '';
  }
  function refreshWhenAssentOwnershipChanges() {
    var now = currentGatewayValue();
    var id = cfg.gatewayId || 'psc';
    var was = pscAssentGateway;
    pscAssentGateway = now;
    if (was === null) return;
    if ((was === id) !== (now === id)) {
      $(document.body).trigger('update_checkout');
    }
  }
  pscAssentGateway = currentGatewayValue();
  $(document.body).on('change', 'input[name="payment_method"]', function () {
    syncWalletFirstForGateway();
    refreshWhenAssentOwnershipChanges();
  });
  /**
   * FIX (1.0.10.5): re-sync whenever the ORDER TOTAL changes, however it changed.
   *
   * PRISM previously only re-read the cart on WooCommerce's own updated_checkout event.
   * Checkout add-ons that live OUTSIDE the checkout form — shipping protection, insurance,
   * tip and gift-wrap toggles — change the cart total through their own request and never
   * fire that event. PRISM therefore never learned the total had moved, the Stripe Elements
   * amount stayed at the pre-toggle figure, and the wallet sheet opened BELOW the real order
   * total. The buyer then authorized the old amount against a larger order and the charge
   * identity guard stopped it — client-side, so nothing appeared in the server log.
   *
   * Field evidence (Puratek 2026-08-27): cart displayed $21.43 while the Link button showed
   * $20.94, the exact $0.49 protection fee, with every server-side amount already correct.
   *
   * Watching the rendered total is deliberately source-agnostic: it catches any plugin that
   * moves the total, not just the one we happened to debug. runCartResync() already no-ops
   * when PRISM is not the selected gateway and while a wallet sheet is open, so this can
   * never disturb an in-flight authorization.
   */
  function watchOrderTotalForChanges() {
    try {
      var lastSeen = null;
      var pending = null;
      function renderedTotal() {
        var el = document.querySelector('.order-total .woocommerce-Price-amount, .order-total .amount, .order-total bdi, tr.order-total td');
        return el ? String(el.textContent || '').replace(/\s+/g, '') : '';
      }
      function check() {
        try {
          var now = renderedTotal();
          if (!now) return;
          if (lastSeen === null) { lastSeen = now; return; }
          if (now === lastSeen) return;
          lastSeen = now;
          if (controller.isWalletHandoffActive && controller.isWalletHandoffActive()) return;
          if (pending) clearTimeout(pending);
          pending = setTimeout(function () { pending = null; runCartResync(); }, 250);
        } catch (e) { /* never break checkout */ }
      }
      var timer = setInterval(check, 800);
      if (timer && typeof timer.unref === 'function') timer.unref(); // Node test runners only; no-op in browsers
      check();
    } catch (e) { /* never break checkout */ }
  }
  watchOrderTotalForChanges();
  $(document.body).on('updated_checkout', function () {
    // Wallet handoff writes fields then recalculateWoo → update_checkout. A full reset here
    // would drop walletFields / mounted attempt / Elements mid classicWalletSubmit.
    if (controller.isWalletHandoffActive && controller.isWalletHandoffActive()) {
      bindPlaceOrder();
      ensureNativeEmailFromGate();
      if (isResearchWalletLayout()) applyResearchWalletLayout();
      return;
    }
    bindPlaceOrder();
    // F3: refill blank native billing_email from gate after every fragment refresh.
    ensureNativeEmailFromGate();
    // Multi-gateway: drop collapse classes and never remount when PSC is not selected.
    if (!prismSelected()) {
      clearWalletFirstFormState();
      scheduleCartResync();
      return;
    }
    applyStackedLayout();
    hideGatewayChrome();
    placeOrderUnderCard();
    var expressEmpty = !$('#psc-express-checkout-element').children().length;
    var paymentEmpty = !$('#psc-payment-element').children().length;
    if (expressEmpty && paymentEmpty) {
      mountedAttempt = null;
      mountedBootstrap = false;
      paymentElement = null;
      paymentMounted = false;
      elements = null;
    }
    if (controller.isGateComplete && controller.isGateComplete()) {
      // Completed research gate survives fragment refresh: remount if Elements DOM was destroyed.
      // Money state may still be stale after coupon/qty — scheduleCartResync drops only that.
      markFormReady(true);
      if ($(formSelector).hasClass('psc-card-mode')) setCardMode(true);
      ensureExpressMounted();
      placeOrderUnderCard();
      scheduleCartResync();
      return;
    }
    // Incomplete gate: drop stale attempt/wallet money state; keep bootstrap paint path.
    controller.reset();
    markFormReady(false);
    // NEVER hideWalletCardUi for incomplete gate.
    ensureExpressMounted();
    placeOrderUnderCard();
    // Still keep Elements amount aligned with the live cart (buyer may open wallet after OTP).
    scheduleCartResync();
    // Notices may have been injected with the fragment — keep them readable + in view.
    setTimeout(scrollCheckoutNoticesIntoView, 80);
  });
  // Initial: theme + gate email + stack layout + mount Express without waiting for OTP/terms.
  applyCheckoutTheme();
  bindGateEmail();
  // FIX (1.0.10.6): only take over the order table when PSC is actually the chosen gateway.
  if (prismSelected()) {
    applyStackedLayout();
    hideGatewayChrome();
    placeOrderUnderCard();
  }
  syncGateEmailRequired();
  syncShellVisibility();
  function hideOtpChrome(on) {
    var nodes = $('#psc-send-code, #psc-code, label[for="psc-code"], #psc-verify-code, .psc-remember-callout');
    if (on) nodes.hide();
    else nodes.show();
    if (on) $('#psc-remember-note').prop('hidden', false);
  }
  function hydrateRememberedDevice() {
    if (researchManaged) return;
    if (!prismSelected() || !controller.applyRememberedEmail) return;
    var normalize = function (value) { return String(value || '').trim().toLowerCase(); };
    var requestedEmail = normalize($('#psc-gate-email').val() || $('[name="billing_email"]').first().val());
    var revision = hydrateEmailRevision;
    post('psc_device_hydrate', { email: requestedEmail }).then(function (data) {
      if (!data || !data.remembered || !data.email) return;
      if (revision !== hydrateEmailRevision) return;
      var gate = $('#psc-gate-email');
      var current = normalize(gate.val() || $('[name="billing_email"]').first().val());
      if ((requestedEmail && requestedEmail !== normalize(data.email)) || (current && current !== normalize(data.email))) return;
      if (gate.length && !normalize(gate.val())) gate.val(data.email);
      syncGateEmailToBilling();
      if (controller.applyRememberedEmail(data.email) === false) return;
      hideOtpChrome(normalize(gate.val() || $('[name="billing_email"]').first().val()) === normalize(data.email));
      syncGateReadyClass();
    }).catch(function () { /* old service / network: stay on first-time OTP path */ });
  }
  $(document.body).on('input.pscHydrate', '#psc-gate-email, [name="billing_email"]', function () {
    hydrateEmailRevision += 1;
    hideOtpChrome(false);
  });
  if (prismSelected()) {
    $(formSelector).addClass('psc-gateway-selected');
    markFormReady(controller.isGateComplete());
    hydrateRememberedDevice();
    ensureExpressMounted();
  } else {
    clearWalletFirstFormState();
  }
  $(document.body).on('updated_checkout.pscTheme', function () {
    applyCheckoutTheme();
    bindGateEmail();
    ensureNativeEmailFromGate();
  });
  // Observability + Playwright proof hooks (safe: amounts only, no secrets).
  if (typeof window !== 'undefined') {
    window.__pscCartResync = {
      lastAmountMinor: function () { return lastKnownCartAmountMinor; },
      resyncNow: runCartResync,
      schedule: scheduleCartResync,
    };
  }
  if (typeof window !== 'undefined' && window.__PSC_ENABLE_PE_TEST_HOOKS) {
    window.__pscClassicPeLifecycle = {
      isPaymentMounted: function () { return paymentMounted; },
      unmountPaymentKeepInstance: unmountPaymentKeepInstance,
      mountPaymentIfCardMode: mountPaymentIfCardMode,
      enforcePaymentMountForSubmit: enforcePaymentMountForSubmit,
      isCardModeOn: isCardModeOn,
    };
  }
  if (cfg.recovery && cfg.recovery.paymentId) {
    var recoveryBusy = false;
    function recoveryUrl(value) {
      var destination = new URL(value, window.location.href);
      if (destination.origin !== window.location.origin) throw new Error('The order address could not be validated. Refresh this page to check your order.');
      return destination.href;
    }
    function pollRecovery(remaining, authenticate) {
      return post('psc_poll_payment', { order_id: cfg.recovery.orderId, order_key: cfg.recovery.orderKey, payment_id: cfg.recovery.paymentId }).then(function (result) {
        if (result && result.status === 'succeeded' && result.completed === true && result.redirect) {
          message('Payment complete. Opening your order confirmation…', 'success');
          window.location.assign(recoveryUrl(result.redirect)); return;
        }
        if (result && result.retry_url) {
          $('#psc-recovery-retry').attr('href', recoveryUrl(result.retry_url)).prop('hidden', false);
          message('Payment did not complete. Review your order and try another payment method.'); return;
        }
        if (result && result.status === 'requires_action') {
          if (authenticate && window.Stripe && result.client_secret && result.publishable_key && result.connected_account) {
            message((api.buyerCopy && api.buyerCopy('threeds_pending')) || 'Your bank needs a quick extra check. Finish that prompt — don’t close the tab.', 'info');
            var recoveryStripe = window.Stripe(result.publishable_key, { stripeAccount: result.connected_account });
            return recoveryStripe.handleNextAction({ clientSecret: result.client_secret }).then(function () {
              // Cancellation is not proof of an unpaid terminal state. Ask the service again.
              return pollRecovery(remaining, false);
            });
          }
          message('Your bank confirmation is not complete. Select “Check payment status” to continue.'); return;
        }
        if (remaining > 0 && result && ['processing', 'creating', 'succeeded', 'attention'].indexOf(result.status) !== -1) {
          message('Your payment is still confirming. Keep this page open.', 'info');
          return new Promise(function (resolve) { window.setTimeout(resolve, 2000); }).then(function () { return pollRecovery(remaining - 1, false); });
        }
        message((api.buyerCopy && api.buyerCopy('confirm_pending')) || 'Payment is still confirming. Don’t submit again — wait or refresh.', 'info');
      });
    }
    function checkRecovery() {
      if (recoveryBusy) return;
      recoveryBusy = true;
      $('#psc-recovery-check').prop('disabled', true);
      $('#psc-recovery-retry').prop('hidden', true).removeAttr('href');
      return pollRecovery(5, true).catch(function (error) {
        message(error.message || ((api.buyerCopy && api.buyerCopy('poll_unavailable')) || 'We can’t confirm payment status yet. Refresh this page. Don’t pay twice.'));
      }).then(function () {
        recoveryBusy = false;
        $('#psc-recovery-check').prop('disabled', false);
      });
    }
    $(document).on('click', '#psc-recovery-check', checkRecovery);
    checkRecovery();
  }
})(jQuery);
