(function () {
  'use strict';
  if (window.pscResearch && window.pscResearch.verification_only) return;
  var wc = window.wc || {}, wp = window.wp || {};
  var register = wc.wcBlocksRegistry && wc.wcBlocksRegistry.registerPaymentMethod;
  var api = window.PSCCheckoutController;
  if (!register || !api || !wp.element) return;
  var settings = wc.wcSettings && wc.wcSettings.getSetting ? wc.wcSettings.getSetting('psc_data', {}) : {};
  if (settings.verification_only) return;
  var researchManaged = !!window.pscResearch;
  var walletFirst = researchManaged && !!settings.wallet_first;
  var el = wp.element.createElement, useState = wp.element.useState, useEffect = wp.element.useEffect, useRef = wp.element.useRef;
  var ADDR = ['first_name','last_name','company','address_1','address_2','city','state','postcode','country','phone'];
  function shipFlag(f) {
    f = f || {}; var h = 0, d = 0;
    ADDR.forEach(function (k) { var s = String(f['shipping_' + k] || '').trim(); if (s) h = 1; if (s !== String(f['billing_' + k] || '').trim()) d = 1; });
    return h && d ? '1' : '0';
  }
  function request(action, data) {
    var body = new URLSearchParams(Object.assign({}, data || {}, { action: action, nonce: window.pscResearch ? window.pscResearch.nonce : settings.nonce }));
    return fetch(settings.ajax_url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: body }).then(function (response) { return response.json(); }).then(function (response) {
      var payload = response && response.data != null ? response.data : null;
      if (!response || !response.success) {
        var err = new Error((payload && payload.message) || 'Request failed.');
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
        throw err;
      }
      return payload;
    });
  }
  function domRead(name) { var field = document.querySelector('[name="' + name + '"]'); return field ? field.value : ''; }
  function domWrite(name, value, silent) {
    var field = document.querySelector('[name="' + name + '"]');
    if (!field) return;
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(field, value); else field.value = value;
    if (!silent) { field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  function checkoutExtensionsJson() {
    try {
      var store = wp.data && typeof wp.data.select === 'function'
        ? wp.data.select('wc/store/checkout')
        : null;
      var extensions = store && typeof store.getExtensionData === 'function'
        ? store.getExtensionData()
        : {};
      if (!extensions || typeof extensions !== 'object') extensions = {};
      return JSON.stringify(extensions);
    } catch (e) {
      return '{}';
    }
  }
  function cartStoreDispatch() {
    try {
      return wp.data && typeof wp.data.dispatch === 'function' ? wp.data.dispatch('wc/store/cart') : null;
    } catch (e) {
      return null;
    }
  }
  function cartStoreSelect() {
    try {
      return wp.data && typeof wp.data.select === 'function' ? wp.data.select('wc/store/cart') : null;
    } catch (e) {
      return null;
    }
  }
  function cartNeedsPayment() {
    var store = cartStoreSelect();
    var cart = store && store.getCartData ? store.getCartData() : null;
    return !researchManaged || !cart || cart.needsPayment !== false;
  }
  function releaseNativeFields(checkout) {
    if (!checkout) return;
    checkout.querySelectorAll('[data-psc-wallet-core], [data-psc-verified-contact], [data-psc-verified-detail]').forEach(function (step) {
      step.removeAttribute('data-psc-wallet-core'); step.removeAttribute('data-psc-verified-contact');
      step.removeAttribute('data-psc-verified-detail');
    });
  }
  /**
   * FIX (1.0.9.9): the addresses the Store API checkout POST sends come from the
   * wc/store/cart data store. The payment-method React props (props.billing /
   * props.shippingData) are a SNAPSHOT that only refreshes when this component
   * re-renders, so they can still hold empty first_name / address_1 / city while the
   * store already has the typed values. create_attempt then fingerprints the stale
   * address, the checkout POST writes the real one, and process_payment rejects the
   * order with "Your cart changed before payment."
   *
   * Field evidence (ProjectLabs 2026-08-27T18:07:03Z, stage=process_payment):
   *   fields=billing_first_name,billing_address_1,billing_city,
   *          shipping_first_name,shipping_address_1,shipping_city,shipping_packages
   * — exactly the fields a buyer types, with state/postcode/country (set earlier by
   * geolocation) unchanged. Reading the store makes both writers agree.
   */
  function storeAddresses() {
    try {
      var store = cartStoreSelect();
      var data = store && typeof store.getCustomerData === 'function' ? store.getCustomerData() : null;
      if (!data) return null;
      return {
        billing: data.billingAddress || {},
        shipping: data.shippingAddress || {}
      };
    } catch (e) {
      return null;
    }
  }
  function waitForCustomerDataIdle() {
    return new Promise(function (resolve) {
      var tries = 0;
      function tick() {
        try {
          var store = cartStoreSelect();
          if (!store || typeof store.isCustomerDataUpdating !== 'function' || !store.isCustomerDataUpdating()) {
            resolve(true);
            return;
          }
        } catch (e) {
          resolve(true);
          return;
        }
        if (++tries > 100) {
          resolve(false);
          return;
        }
        setTimeout(tick, 20);
      }
      tick();
    });
  }
  /**
   * Two-writer referee (Blocks): the checkout POST reads addresses from the
   * wc/store/cart data store, NOT the DOM, so wallet-confirm fields written via
   * domWrite/walletIdentityRef alone never reach the Store API submit. The store
   * then restores the pre-wallet address over the Woo session, the attempt
   * fingerprint mismatches, and process_payment rejects every express pay with
   * "Payment attempt is stale because the cart changed." (Field evidence:
   * Noverix 2026-08-12 — paired "attempt invalidated; changed categories:
   * address[,shipping]" log entries seconds apart on every Link confirm.)
   *
   * Official cart-store contract (developer.woocommerce.com/docs/block-development/
   * reference/data-store/cart/): setBillingAddress/setShippingAddress are LOCAL
   * only; updateCustomerData POSTs billing/shipping to the Store API and returns
   * the updated cart. Push the exact fields the attempt fingerprinted — including
   * the FIX C verified billing email — through updateCustomerData and wait until
   * isCustomerDataUpdating is false BEFORE onSubmit so the checkout POST cannot
   * restore the page/account address.
   */
  function pushWalletFieldsToCartStore(fields) {
    fields = fields || {};
    var cart = cartStoreDispatch();
    // Store API contract: setBillingAddress is local-only. Persist requires updateCustomerData.
    // https://developer.woocommerce.com/docs/block-development/reference/data-store/cart/
    if (!cart || typeof cart.updateCustomerData !== 'function') return Promise.resolve(false);
    var billing = {}, shipping = {}, hasBilling = false, hasShipping = false;
    Object.keys(fields).forEach(function (key) {
      var value = fields[key] == null ? '' : String(fields[key]);
      if (key.indexOf('billing_') === 0) { billing[key.slice(8)] = value; hasBilling = true; }
      else if (key.indexOf('shipping_') === 0) { shipping[key.slice(9)] = value; hasShipping = true; }
    });
    if (!hasBilling && !hasShipping) return Promise.resolve(false);
    var payload = {};
    if (hasBilling) payload.billing_address = billing;
    if (hasShipping) payload.shipping_address = shipping;
    var waits = [];
    try {
      waits.push(Promise.resolve(cart.updateCustomerData(payload, false)));
      if (hasBilling && typeof cart.setBillingAddress === 'function') {
        waits.push(Promise.resolve(cart.setBillingAddress(billing)));
      }
      if (hasShipping && typeof cart.setShippingAddress === 'function') {
        waits.push(Promise.resolve(cart.setShippingAddress(shipping)));
      }
    } catch (e) {
      return Promise.resolve(false);
    }
    return Promise.all(waits).then(function () {
      return waitForCustomerDataIdle();
    }).catch(function () {
      return false;
    });
  }
  function emptyHost(id) {
    var host = typeof document !== 'undefined' && document.getElementById
      ? document.getElementById(id)
      : null;
    if (host) host.innerHTML = '';
  }
  function safeUnmount(element) {
    if (!element) return;
    try { if (typeof element.unmount === 'function') element.unmount(); } catch (e) { /* host may already be gone */ }
  }
  function safeDestroy(element) {
    if (!element) return;
    try { if (typeof element.destroy === 'function') element.destroy(); } catch (e) { /* already destroyed */ }
  }
  function blocksIsDark() {
    var pref = String((document.body && document.body.dataset && document.body.dataset.pscCheckoutTheme) || (window.pscResearch && window.pscResearch.theme) || settings.theme || 'auto').toLowerCase();
    var bodyBg = '', docBg = '';
    try {
      if (typeof document !== 'undefined' && window.getComputedStyle) {
        bodyBg = window.getComputedStyle(document.body).backgroundColor;
        docBg = window.getComputedStyle(document.documentElement).backgroundColor;
      }
    } catch (e) { /* ignore */ }
    return api.resolveCheckoutIsDark
      ? api.resolveCheckoutIsDark({ preference: pref, bodyBg: bodyBg, documentBg: docBg })
      : pref === 'dark';
  }
  function Label() {
    var isDark = blocksIsDark();
    var src = isDark
      ? (settings.wordmark_url_dark || settings.wordmark_url)
      : (settings.wordmark_url_light || settings.wordmark_url);
    return el('span', { className: 'psc-blocks-label' }, src ? el('img', { src: src, alt: 'PRISM', style: { height: '20px', marginRight: '8px' } }) : null, settings.title || 'PRISM Secure Checkout');
  }
  function Content(props) {
    var attestation = useState(false), attested = attestation[0], setAttested = attestation[1];
    var cardMode = useState((researchManaged && !walletFirst) || !!(settings.field_policy && settings.field_policy.native_fallback)), cardOpen = cardMode[0], setCardOpen = cardMode[1];
    var expressVisibility = useState(true), expressAvailable = expressVisibility[0], setExpressAvailable = expressVisibility[1];
    var fallbackState = useState(!!(settings.field_policy && settings.field_policy.native_fallback)), nativeFallback = fallbackState[0], setNativeFallback = fallbackState[1];
    var forcedFieldsState = useState(false), forcedFields = forcedFieldsState[0], setForcedFields = forcedFieldsState[1];
    var notice = useState(''), text = notice[0], setText = notice[1];
    var rememberedGate = useState(false), otpHidden = rememberedGate[0], setOtpHidden = rememberedGate[1];
    var paymentRequirement = useState(cartNeedsPayment()), needsPayment = paymentRequirement[0], setNeedsPayment = paymentRequirement[1];
    var needsPaymentRef = useRef(needsPayment);
    var rememberedEmailRef = useRef('');
    var stripeRef = useRef(null), elementsRef = useRef(null), paymentElRef = useRef(null), expressElRef = useRef(null);
    var paymentMountedRef = useRef(false), expressMountedRef = useRef(false);
    var mountedBootstrapRef = useRef(false), bootstrapInflightRef = useRef(null);
    var attemptRef = useRef(''), controllerRef = useRef(null);
    var latestPropsRef = useRef(props), walletIdentityRef = useRef(null);
    var cartResyncTimerRef = useRef(null);
    var lastCartAmountRef = useRef(null);
    var cardOpenRef = useRef(cardOpen);
    var payModeRef = useRef('auto'); // 'express' | 'card' | 'auto' — set through confirm → onPaymentSetup
    var lastMoneyRef = useRef(null);
    var contentRef = useRef(null), nativeFallbackRef = useRef(nativeFallback), forcedFieldsRef = useRef(false), expressAvailableRef = useRef(expressAvailable);
    var nativeObserverRef = useRef(null), focusFrameRef = useRef(null);
    latestPropsRef.current = props;
    cardOpenRef.current = cardOpen;
    nativeFallbackRef.current = nativeFallback;
    expressAvailableRef.current = expressAvailable;
    function checkoutRoot() { return contentRef.current && contentRef.current.closest('.wp-block-woocommerce-checkout'); }
    function nativeFieldsVisible() {
      return !cartNeedsPayment() || !needsPaymentRef.current || !walletFirst || !expressAvailableRef.current || nativeFallbackRef.current || forcedFieldsRef.current || cardOpenRef.current;
    }
    function applyNativeState() {
      if (!walletFirst || !contentRef.current) return;
      var checkout = checkoutRoot();
      if (!checkout) return;
      if (!cartNeedsPayment() || !needsPaymentRef.current) {
        releaseNativeFields(checkout);
        contentRef.current.setAttribute('data-psc-wallet-first', 'false');
        contentRef.current.setAttribute('data-psc-native-fields', 'visible');
        return;
      }
      contentRef.current.setAttribute('data-psc-wallet-first', 'true');
      var selectors = '.wp-block-woocommerce-checkout-contact-information-block, .wp-block-woocommerce-checkout-billing-address-block, .wp-block-woocommerce-checkout-shipping-address-block, .wp-block-woocommerce-checkout-shipping-methods-block';
      var unexpected = false;
      checkout.querySelectorAll(selectors).forEach(function (step) {
        var contactStep = step.matches('.wp-block-woocommerce-checkout-contact-information-block');
        // Only standard Woo controls can be deferred to the wallet. Extension
        // fields keep the native form open instead of hiding required inputs.
        var safe = Array.prototype.every.call(step.querySelectorAll('input, select, textarea'), function (field) {
          if (field.type === 'hidden') return true;
          if (field.closest('.wc-block-checkout__use-address-for-billing')) return true;
          if (contactStep && field.type === 'checkbox' && !field.required && field.closest('.wc-block-checkout__create-account')) return true;
          if (contactStep && field.type === 'password' && field.closest('.wc-block-components-address-form__password')) return true;
          if (field.type === 'radio' && field.closest('.wc-block-components-shipping-rates-control')) return true;
          var key = String(field.name || field.id || '').replace(/^(billing|shipping|contact)[_-]/, '');
          if (key === 'email') return true;
          return ADDR.indexOf(key) !== -1;
        });
        // Contact owns optional native account/login controls, which remain
        // visible. Only its already-verified email and title may be compacted.
        if (safe && !contactStep) step.setAttribute('data-psc-wallet-core', 'true');
        else step.removeAttribute('data-psc-wallet-core');
        if (!safe) unexpected = true;
        if (contactStep) {
          var status = window.PSCResearchCheckout && window.PSCResearchCheckout.getStatus();
          var verifiedContact = safe && status && status.ready && !step.querySelector('[aria-invalid="true"]')
            && String(status.email || '').trim().toLowerCase() === String(read('billing_email') || '').trim().toLowerCase();
          if (verifiedContact) step.setAttribute('data-psc-verified-contact', 'true');
          else step.removeAttribute('data-psc-verified-contact');
          step.querySelectorAll('.wc-block-components-address-form__email, .wc-block-components-checkout-step__title').forEach(function (detail) {
            if (verifiedContact) detail.setAttribute('data-psc-verified-detail', 'true');
            else detail.removeAttribute('data-psc-verified-detail');
          });
        }
      });
      // A native collection/pickup choice must remain available before payment.
      if (checkout.querySelector('.wp-block-woocommerce-checkout-pickup-options-block input, .wp-block-woocommerce-checkout-shipping-method-block input')) unexpected = true;
      if (unexpected && !nativeFallbackRef.current) {
        nativeFallbackRef.current = true;
        setNativeFallback(true);
        openNativePayment();
      }
      contentRef.current.setAttribute('data-psc-native-fields', nativeFieldsVisible() ? 'visible' : 'hidden');
      var summary = checkout.querySelector('.wc-block-checkout__sidebar');
      var summaryToggle = summary && summary.querySelector('.wc-block-components-checkout-order-summary__title[aria-expanded="false"]');
      if (summaryToggle && (summary.querySelector('[aria-invalid="true"], .wc-block-components-validation-error, .wc-block-components-notice-banner.is-error')
          || summary.querySelectorAll('input[name^="shipping_method"]').length > 1)) summaryToggle.click();
    }
    function openNativePayment() {
      cardOpenRef.current = true;
      setCardOpen(true);
      if (researchManaged && paymentElRef.current && paymentElRef.current.update) {
        // Stripe accepts defaultCollapsed at creation but rejects it in update.
        // The string layout restores its expanded defaults on the same element.
        paymentElRef.current.update({ layout: 'tabs' });
      }
      applyNativeState();
    }
    function validationErrors() {
      try {
        var validation = wp.data && wp.data.select('wc/store/validation');
        return validation && validation.getValidationErrors ? validation.getValidationErrors() : {};
      } catch (error) { return {}; }
    }
    function revealValidationFields(errors, force) {
      if (!walletFirst) return;
      var checkout = checkoutRoot();
      if (!checkout) return;
      errors = errors || validationErrors();
      if (!force && !Object.keys(errors).length && !checkout.querySelector('[aria-invalid="true"], input:invalid, select:invalid, textarea:invalid')) return;
      forcedFieldsRef.current = true;
      setForcedFields(true);
      openNativePayment();
      // The native store and its notices still own validation. Only expose and
      // focus its first failing field; never clear or replace Woo errors.
      if (focusFrameRef.current) cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = requestAnimationFrame(function () {
        focusFrameRef.current = null;
        var keys = Object.keys(errors);
        var controls = checkout.querySelectorAll('input, select, textarea');
        var target = Array.prototype.find.call(controls, function (field) {
          var described = field.getAttribute('aria-describedby') || '';
          var key = String(field.name || field.id || '').replace(/^(billing|shipping)-/, '$1_');
          return keys.indexOf(key) !== -1 || keys.some(function (errorKey) { return described.indexOf('validate-error-' + errorKey) !== -1; });
        }) || checkout.querySelector('[aria-invalid="true"], input:invalid, select:invalid, textarea:invalid');
        if (target && target.getClientRects().length) { target.focus(); target.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      });
    }
    function read(name) {
      var latestProps = latestPropsRef.current || {};
      // FIX (1.0.9.9): cart store first (same source as the checkout POST), props as fallback.
      var fromStore = storeAddresses();
      var billing = (fromStore && fromStore.billing)
        || (latestProps.billing && latestProps.billing.billingAddress) || {};
      var shipping = (fromStore && fromStore.shipping)
        || (latestProps.shippingData && latestProps.shippingData.shippingAddress) || {};
      var fromBlocks = {
        billing_email: billing.email, billing_first_name: billing.first_name, billing_last_name: billing.last_name,
        billing_company: billing.company, billing_address_1: billing.address_1, billing_address_2: billing.address_2,
        billing_city: billing.city, billing_state: billing.state, billing_postcode: billing.postcode,
        billing_country: billing.country, billing_phone: billing.phone,
        shipping_first_name: shipping.first_name, shipping_last_name: shipping.last_name, shipping_company: shipping.company,
        shipping_address_1: shipping.address_1, shipping_address_2: shipping.address_2, shipping_city: shipping.city,
        shipping_state: shipping.state, shipping_postcode: shipping.postcode, shipping_country: shipping.country,
        shipping_phone: shipping.phone
      };
      if (fromBlocks[name] != null && fromBlocks[name] !== '') return String(fromBlocks[name]);
      return domRead(name);
    }
    function writeField(name, value, silent) {
      if (name.indexOf('billing_') === 0 || name.indexOf('shipping_') === 0) {
        walletIdentityRef.current = walletIdentityRef.current || {};
        walletIdentityRef.current[name] = value;
      }
      domWrite(name, value, silent);
    }
    function createAttemptFields() {
      var fields = {}, names = ['billing_first_name','billing_last_name','billing_company','billing_address_1','billing_address_2','billing_city','billing_state','billing_postcode','billing_country','billing_phone','billing_email','shipping_first_name','shipping_last_name','shipping_company','shipping_address_1','shipping_address_2','shipping_city','shipping_state','shipping_postcode','shipping_country','shipping_phone'];
      var walletIdentity = walletIdentityRef.current;
      names.forEach(function (name) { fields[name] = walletIdentity ? (Object.prototype.hasOwnProperty.call(walletIdentity, name) ? String(walletIdentity[name] || '') : '') : read(name); });
      return {
        fields: JSON.stringify(fields),
        ship_to_different_address: shipFlag(fields),
        blocks_extensions: checkoutExtensionsJson()
      };
    }
    function stripeName(prefix) { return (read(prefix + '_first_name') + ' ' + read(prefix + '_last_name')).trim(); }
    function confirmationParams(attempt) {
      return api.confirmationParams(attempt, attempt.field_policy && attempt.field_policy.needs_shipping);
    }
    /** Unmount PE from host; keep element instance so hide → reopen can remount. */
    function unmountPaymentKeepInstance() {
      if (paymentElRef.current && paymentMountedRef.current) {
        safeUnmount(paymentElRef.current);
      }
      paymentMountedRef.current = false;
    }
    /**
     * Full teardown on Content unmount only — never for incomplete OTP/gate.
     * (Classic keeps bootstrap Elements painted while gate incomplete.)
     */
    function clearMount() {
      if (paymentElRef.current) {
        if (paymentMountedRef.current) safeUnmount(paymentElRef.current);
        safeDestroy(paymentElRef.current);
      }
      if (expressElRef.current) {
        if (expressMountedRef.current) safeUnmount(expressElRef.current);
        safeDestroy(expressElRef.current);
      }
      paymentElRef.current = null;
      expressElRef.current = null;
      paymentMountedRef.current = false;
      expressMountedRef.current = false;
      mountedBootstrapRef.current = false;
      bootstrapInflightRef.current = null;
      emptyHost('psc-blocks-express');
      emptyHost('psc-blocks-payment');
      attemptRef.current = '';
      stripeRef.current = null;
      elementsRef.current = null;
    }
    function mountPaymentIfReady() {
      if (!needsPaymentRef.current || !cartNeedsPayment()) return;
      if (!paymentElRef.current || paymentMountedRef.current) return;
      if (!researchManaged && !cardOpenRef.current) return;
      var host = typeof document !== 'undefined' && document.getElementById
        ? document.getElementById('psc-blocks-payment')
        : null;
      if (!host) return;
      paymentElRef.current.mount('#psc-blocks-payment');
      paymentMountedRef.current = true;
    }
    function bindExpressHandlers(express) {
      function availability(methods) {
        if (expressElRef.current !== express) return;
        var available = !!methods && Object.keys(methods).some(function (key) { return !!methods[key]; });
        expressAvailableRef.current = available;
        setExpressAvailable(available);
        if (researchManaged && (!available || nativeFallbackRef.current)) openNativePayment();
      }
      express.on('ready', function (event) { availability(event.availablePaymentMethods); });
      express.on('availablepaymentmethodschange', function (event) { availability(event.paymentMethods); });
      express.on('loaderror', function () { availability(null); });
      express.on('shippingaddresschange', function (event) {
        controllerRef.current.handleShippingAddressChange(event.shippingAddress || event.address || event, event).catch(function () {
          if (event.reject) event.reject();
        });
      });
      express.on('shippingratechange', function (event) {
        controllerRef.current.handleShippingRateChange(event.shippingRate && event.shippingRate.id || '', event).catch(function () {
          if (event.reject) event.reject();
        });
      });
      // Dismissed sheet: restore Elements amount to full amount_minor (Stripe guide pattern).
      express.on('cancel', function () {
        if (controllerRef.current && controllerRef.current.handleWalletCancel) {
          controllerRef.current.handleWalletCancel();
        }
        setText((api.buyerCopy && api.buyerCopy('wallet_cancel')) || 'Payment cancelled. Nothing was charged.');
      });
      express.on('confirm', function (event) {
        // Gate blocks CHARGE only — Express stays painted regardless of OTP/terms.
        if (!controllerRef.current.isGateComplete || !controllerRef.current.isGateComplete()) {
          setText('Verify email and accept research terms before paying.');
          if (event && event.paymentFailed) event.paymentFailed({ reason: 'fail' });
          else if (event && event.reject) event.reject();
          return;
        }
        // Preserve Express mode through onSubmit → onPaymentSetup → token creation.
        payModeRef.current = 'express';
        if (controllerRef.current.markWalletHandoff) controllerRef.current.markWalletHandoff(true);
        if (lastMoneyRef.current) applyElementsMoney(lastMoneyRef.current, 'express');
        controllerRef.current.handleWalletConfirm(event).then(function () {
          // Persist the canonical address create_attempt bound (Woo Pay transforms),
          // not raw wallet sheet fields. Local setBillingAddress is not persist.
          var persistFields = controllerRef.current.getPersistFields
            ? controllerRef.current.getPersistFields()
            : (controllerRef.current.getWalletFields ? controllerRef.current.getWalletFields() : null);
          return Promise.resolve(persistFields ? pushWalletFieldsToCartStore(persistFields) : false);
        }).then(function (persisted) {
          if (!persisted) {
            throw new Error('Could not save the wallet address to checkout. Try again.');
          }
          var latestProps = latestPropsRef.current || {};
          if (latestProps.onSubmit) latestProps.onSubmit();
        }).catch(function (error) {
          payModeRef.current = 'auto';
          if (controllerRef.current.markWalletHandoff) controllerRef.current.markWalletHandoff(false);
          setText(error.message);
          revealValidationFields();
          if (event && event.paymentFailed) event.paymentFailed({ reason: 'fail' });
          else if (event && event.reject) event.reject();
        });
      });
    }
    function mountFromPayload(payload, isAttempt) {
      if ((researchManaged && payload.needs_payment === false) || !cartNeedsPayment()) {
        useNativeNoPayment();
        return Promise.resolve();
      }
      needsPaymentRef.current = true;
      setNeedsPayment(true);
      if (!window.Stripe) return Promise.reject(new Error('Secure payment form is unavailable.'));
      // Tear down any prior Stripe widgets before creating a new Elements group.
      if (paymentElRef.current) {
        if (paymentMountedRef.current) safeUnmount(paymentElRef.current);
        safeDestroy(paymentElRef.current);
      }
      if (expressElRef.current) {
        if (expressMountedRef.current) safeUnmount(expressElRef.current);
        safeDestroy(expressElRef.current);
      }
      paymentElRef.current = null;
      expressElRef.current = null;
      paymentMountedRef.current = false;
      expressMountedRef.current = false;
      emptyHost('psc-blocks-express');
      emptyHost('psc-blocks-payment');
      var stripe = window.Stripe(payload.publishable_key, { stripeAccount: payload.connected_account });
      var policy = payload.field_policy || settings.field_policy || {};
      if (policy.native_fallback) {
        nativeFallbackRef.current = true;
        setNativeFallback(true);
      }
      var fullAmount = Number(payload.amount_minor);
      var displayAmount = payload.wallet_display_base_minor != null
        ? Number(payload.wallet_display_base_minor) : fullAmount;
      lastMoneyRef.current = {
        amount_minor: fullAmount,
        wallet_display_base_minor: displayAmount,
        field_policy: policy
      };
      // Elements amount = full amount_minor for every mode (Stripe pay total IS Elements amount;
      // shippingRates are picker-only). Mount-at-full mandatory — Apple Pay cannot raise mid-sheet.
      var elementsAmount = fullAmount;
      var elements = stripe.elements({
        mode: 'payment',
        amount: elementsAmount,
        currency: payload.currency,
        paymentMethodCreation: 'manual',
        appearance: api.paymentAppearance ? api.paymentAppearance(blocksIsDark()) : undefined,
        fonts: settings.font_url ? [{ cssSrc: settings.font_url.replace(/\.woff2(?:\?.*)?$/, '.css') }] : []
      });
      stripeRef.current = stripe;
      elementsRef.current = elements;
      mountedBootstrapRef.current = true;
      if (isAttempt && payload.attempt_id) attemptRef.current = payload.attempt_id;
      else attemptRef.current = '';
      var expressOptions = !nativeFallbackRef.current ? api.expressCheckoutOptions(policy) : null;
      var collapsed = walletFirst && !!expressOptions && !cardOpenRef.current && !forcedFieldsRef.current;
      if (researchManaged && !collapsed) { cardOpenRef.current = true; setCardOpen(true); }
      // Research checkout has exactly one permanent Payment Element. Stripe's
      // own selector controls expansion, so changing methods keeps typed data.
      var paymentOptions = api.paymentElementOptions({
        collapsed: collapsed,
        billingDetails: { name: stripeName('billing'), email: read('billing_email') }
      });
      if (!researchManaged) paymentOptions = { fields: { billingDetails: 'never' } };
      var payment = elements.create('payment', paymentOptions);
      paymentElRef.current = payment;
      payment.on('change', function (event) {
        if (!researchManaged || paymentElRef.current !== payment) return;
        var selected = event && event.value && event.value.type;
        if (typeof event.collapsed !== 'boolean' && !selected) return;
        var expanded = event.collapsed === false || (event.collapsed !== true && !!selected);
        cardOpenRef.current = !walletFirst || !expressAvailableRef.current || nativeFallbackRef.current || expanded;
        setCardOpen(cardOpenRef.current);
        if (payModeRef.current !== 'express') payModeRef.current = cardOpenRef.current ? 'card' : 'auto';
        applyNativeState();
      });
      mountPaymentIfReady();
      // Mount Express only when not native_fallback (multi-package / custom fields).
      expressAvailableRef.current = !!expressOptions;
      setExpressAvailable(!!expressOptions);
      if (expressOptions) {
        try {
          var express = elements.create('expressCheckout', expressOptions);
          expressElRef.current = express;
          bindExpressHandlers(express);
          express.mount('#psc-blocks-express');
          expressMountedRef.current = true;
        } catch (error) {
          expressAvailableRef.current = false;
          setExpressAvailable(false);
          if (researchManaged) openNativePayment();
        }
      } else if (researchManaged) {
        openNativePayment();
      }
      applyNativeState();
      return Promise.resolve();
    }
    /**
     * Mount Express via psc_express_bootstrap — does NOT require isGateComplete / attested.
     * Wallets stay visible in method content (OTP never blanks this container).
     */
    function ensureExpressMounted() {
      if (researchManaged && !controllerRef.current.isGateComplete()) return Promise.resolve();
      if (!cartNeedsPayment()) { useNativeNoPayment(); return Promise.resolve(); }
      if (mountedBootstrapRef.current && elementsRef.current) return Promise.resolve();
      if (bootstrapInflightRef.current) return bootstrapInflightRef.current;
      bootstrapInflightRef.current = request('psc_express_bootstrap', {}).then(function (boot) {
        return mountFromPayload(boot, false);
      }).catch(function (error) {
        setText(error.message);
      }).then(function () {
        bootstrapInflightRef.current = null;
      });
      return bootstrapInflightRef.current;
    }
    function useNativeNoPayment() {
      if (controllerRef.current.isWalletHandoffActive()) return;
      [paymentElRef.current, expressElRef.current].forEach(function (element) { safeUnmount(element); safeDestroy(element); });
      paymentElRef.current = null; expressElRef.current = null; elementsRef.current = null;
      paymentMountedRef.current = false; expressMountedRef.current = false;
      mountedBootstrapRef.current = false; attemptRef.current = '';
      controllerRef.current.reset();
      needsPaymentRef.current = false;
      setNeedsPayment(false);
      applyNativeState();
    }
    /**
     * Pay-path mount: reuse bootstrap Elements when present so Express confirm tokens
     * stay on the same Stripe session. Fall back to attempt-backed mount if bootstrap never ran.
     */
    function applyElementsMoney(payload, mode) {
      if (!elementsRef.current || !elementsRef.current.update) return;
      var policy = (payload && payload.field_policy) || settings.field_policy || {};
      var full = Number(payload && payload.amount_minor);
      var base = payload && payload.wallet_display_base_minor != null
        ? Number(payload.wallet_display_base_minor) : full;
      lastMoneyRef.current = {
        amount_minor: full,
        wallet_display_base_minor: base,
        field_policy: policy
      };
      // Full amount_minor always — never feed wallet_display_base_minor to Elements.
      var amount = full;
      if (!(amount > 0)) return;
      try { elementsRef.current.update({ amount: amount }); } catch (e) { /* ignore */ }
    }
    function mount(attempt, kind) {
      if (elementsRef.current && (attemptRef.current === attempt.attempt_id || mountedBootstrapRef.current)) {
        attemptRef.current = attempt.attempt_id;
        applyElementsMoney(attempt, kind || (cardOpenRef.current ? 'card' : 'express'));
        mountPaymentIfReady();
        return Promise.resolve();
      }
      return mountFromPayload(attempt, true);
    }
    function token(kind, attempt) {
      // Blocks onPaymentSetup always passes kind='blocks'. Express and card both pin
      // full amount_minor (Elements pay total === charged total).
      var payKind = (kind === 'express' || kind === 'wallet' || payModeRef.current === 'express')
        ? 'express'
        : 'card';
      payModeRef.current = payKind;
      return mount(attempt, payKind).then(function () {
        if (cardOpenRef.current || payKind === 'card') mountPaymentIfReady();
        // Pin Elements amount (full amount_minor) immediately before token creation.
        applyElementsMoney(attempt, payKind);
        return elementsRef.current.submit();
      }).then(function (result) {
        if (result && result.error) throw new Error(result.error.message || (api.buyerCopy && api.buyerCopy('pe_incomplete')) || 'Payment details are incomplete. Check the card and try again.');
        return stripeRef.current.createConfirmationToken({ elements: elementsRef.current, params: confirmationParams(attempt) });
      }).then(function (result) {
        if (!result || result.error) throw new Error(result && result.error && result.error.message || 'Payment token failed.');
        return { id: result.confirmationToken.id };
      });
    }
    if (!controllerRef.current) {
      controllerRef.current = api.createController({
        researchManaged: researchManaged,
        onResearchRequired: function (error) { document.dispatchEvent(new CustomEvent('psc:research-required', { detail: { code: error.code, message: error.message } })); },
        readField: read, writeField: writeField, post: request, recalculateWoo: function () { return Promise.resolve(); },
        createAttemptFields: createAttemptFields,
        invalidateAttempt: function () { controllerRef.current.reset(); },
        adoptAttempt: function (attempt) {
          attemptRef.current = attempt.attempt_id;
          applyElementsMoney(attempt, cardOpenRef.current ? 'card' : payModeRef.current);
        },
        updateElementsAmount: function (amount) {
          if (elementsRef.current) {
            try { elementsRef.current.update({ amount: Number(amount) }); } catch (e) { /* ignore */ }
          }
        },
        updateElementsMoney: function (money, mode) {
          applyElementsMoney(money, mode || (cardOpenRef.current ? 'card' : 'auto'));
        },
        createConfirmationToken: token, submitWoo: function (data) { return data; }
      });
    }
    var controller = controllerRef.current;
    useEffect(function () {
      if (!researchManaged) return;
      function saved(event) {
        var context = event && event.detail || (window.PSCResearchCheckout && window.PSCResearchCheckout.getStatus());
        if (!controller.setResearchContext(context)) return;
        setAttested(true); setText('');
        applyNativeState();
        ensureExpressMounted();
      }
      function invalidated() { controller.invalidateResearch(); attemptRef.current = ''; setAttested(false); }
      document.addEventListener('psc:research-saved', saved);
      document.addEventListener('psc:research-invalidated', invalidated);
      saved();
      return function () { document.removeEventListener('psc:research-saved', saved); document.removeEventListener('psc:research-invalidated', invalidated); };
    }, []);
    useEffect(function () {
      if (!walletFirst) return;
      var checkout = checkoutRoot();
      if (!checkout) return;
      applyNativeState();
      nativeObserverRef.current = new MutationObserver(applyNativeState);
      nativeObserverRef.current.observe(checkout, { childList: true, subtree: true, attributes: true, attributeFilter: ['required', 'aria-required'] });
      return function () {
        if (nativeObserverRef.current) nativeObserverRef.current.disconnect();
        nativeObserverRef.current = null;
        if (focusFrameRef.current) cancelAnimationFrame(focusFrameRef.current);
        releaseNativeFields(checkout);
      };
    }, []);
    useEffect(function () {
      if (!researchManaged || !wp.data || !wp.data.subscribe) return;
      return wp.data.subscribe(function () {
        if (controller.isWalletHandoffActive() || cartNeedsPayment() === needsPaymentRef.current) return;
        if (!cartNeedsPayment()) useNativeNoPayment();
        else ensureExpressMounted();
      });
    }, []);
    useEffect(function () {
      if (!walletFirst) return;
      applyNativeState();
    }, [cardOpen, expressAvailable, nativeFallback, forcedFields, attested]);
    useEffect(function () {
      var registration = props.eventRegistration || {}, unsubscribers = [], visibleErrors = '';
      if (walletFirst && registration.onCheckoutValidation) {
        unsubscribers.push(registration.onCheckoutValidation(function () {
          revealValidationFields(validationErrors());
          return true;
        }));
      }
      if (registration.onCheckoutFail) {
        unsubscribers.push(registration.onCheckoutFail(function () {
          controller.markAttemptForRevalidation();
          if (walletFirst) revealValidationFields(validationErrors(), true);
          return true;
        }));
      }
      if (walletFirst && wp.data && wp.data.subscribe) {
        unsubscribers.push(wp.data.subscribe(function () {
          var errors = validationErrors();
          var next = Object.keys(errors).filter(function (key) { return errors[key] && !errors[key].hidden; }).sort().join('|');
          if (next && next !== visibleErrors) revealValidationFields(errors);
          visibleErrors = next;
        }));
      }
      return function () { unsubscribers.forEach(function (unsubscribe) { if (typeof unsubscribe === 'function') unsubscribe(); }); };
    }, [props.eventRegistration]);
    useEffect(function () {
      if (researchManaged) return;
      var canceled = false, revision = 0;
      var normalize = function (value) { return String(value || '').trim().toLowerCase(); };
      var requestedEmail = normalize(read('billing_email'));
      function edited(event) {
        var target = event.target;
        if (target && (target.type === 'email' || target.name === 'billing_email')) { revision += 1; setOtpHidden(false); }
      }
      document.addEventListener('input', edited);
      request('psc_device_hydrate', { email: requestedEmail }).then(function (data) {
        if (!data || !data.remembered || !data.email) return;
        if (canceled || revision) return;
        var next = normalize(data.email), current = normalize(read('billing_email'));
        if ((requestedEmail && requestedEmail !== next) || (current && current !== next)) return;
        var cart = cartStoreDispatch();
        if (!current && cart && cart.setBillingAddress) {
          var address = (storeAddresses() || {}).billing || {};
          cart.setBillingAddress(Object.assign({}, address, { email: data.email }));
          domWrite('billing_email', data.email, true);
        }
        if (normalize(read('billing_email')) !== next) return;
        if (controller.applyRememberedEmail && controller.applyRememberedEmail(data.email) !== false) {
          rememberedEmailRef.current = next;
          setOtpHidden(true);
        }
      }).catch(function () { /* old service: first-time OTP path */ });
      return function () { canceled = true; document.removeEventListener('input', edited); };
    }, []);
    useEffect(function () {
      if (otpHidden && String(read('billing_email') || '').trim().toLowerCase() !== rememberedEmailRef.current) setOtpHidden(false);
    });
    // Content mount: paint Express without waiting for OTP/terms (classic Task 4 parity).
    useEffect(function () {
      if (!settings.terms_version) {
        setText((api.buyerCopy && api.buyerCopy('terms_unavailable')) || 'Checkout terms are unavailable. This order cannot be placed.');
      }
      ensureExpressMounted();
      return function () {
        // Content unmount only — full teardown of Stripe widgets.
        clearMount();
        if (cartResyncTimerRef.current) {
          clearTimeout(cartResyncTimerRef.current);
          cartResyncTimerRef.current = null;
        }
      };
    }, []);
    /**
     * Coupon / qty / shipping changes update blocks cart totals.
     * Mirror classic: re-fetch live amount, drop only money attempt, update Elements.
     */
    function runBlocksCartResync() {
      if (researchManaged && !controllerRef.current.isGateComplete()) return Promise.resolve(null);
      if (controllerRef.current && controllerRef.current.isWalletHandoffActive &&
          controllerRef.current.isWalletHandoffActive()) {
        return Promise.resolve(null);
      }
      return request('psc_express_bootstrap', {}).then(function (boot) {
        if ((researchManaged && boot.needs_payment === false) || !cartNeedsPayment()) { useNativeNoPayment(); return boot; }
        var fresh = Number(boot && boot.amount_minor);
        if (!(fresh > 0)) return boot;
        if (!needsPaymentRef.current) return mountFromPayload(boot, false).then(function () { return boot; });
        lastCartAmountRef.current = fresh;
        if (typeof window !== 'undefined') {
          window.__pscCheckoutCartAmountMinor = fresh;
        }
        var mode = cardOpenRef.current ? 'card' : 'auto';
        if (controllerRef.current && controllerRef.current.resyncCartAmount) {
          var result = controllerRef.current.resyncCartAmount(boot, mode);
          if (result && result.dropped) {
            attemptRef.current = '';
            setText((api.buyerCopy && api.buyerCopy('cart_stale_js')) || 'Your cart total changed. Review your order and try payment again.');
          }
        } else {
          applyElementsMoney(boot, mode);
        }
        return boot;
      }).catch(function () {
        return null;
      });
    }
    // React to cart total changes from the Blocks payment method props.
    useEffect(function () {
      var cartTotal = props.billing && props.billing.cartTotal;
      var value = null;
      if (cartTotal != null) {
        if (typeof cartTotal === 'object' && cartTotal.value != null) {
          value = Number(cartTotal.value);
        } else {
          value = Number(cartTotal);
        }
      }
      // Also accept cart totals from shippingData extensions when present.
      if (!(value > 0) && props.cartTotals && props.cartTotals.total_price != null) {
        value = Number(props.cartTotals.total_price);
      }
      if (!(value > 0)) return undefined;
      if (lastCartAmountRef.current === value) {
        // Still schedule a soft bootstrap resync only when we have never synced.
        // (value equality short-circuit is fine after first pin.)
      }
      if (cartResyncTimerRef.current) clearTimeout(cartResyncTimerRef.current);
      cartResyncTimerRef.current = setTimeout(function () {
        cartResyncTimerRef.current = null;
        runBlocksCartResync();
      }, 300);
      return function () {
        if (cartResyncTimerRef.current) {
          clearTimeout(cartResyncTimerRef.current);
          cartResyncTimerRef.current = null;
        }
      };
    }, [
      props.billing && props.billing.cartTotal && (
        typeof props.billing.cartTotal === 'object'
          ? props.billing.cartTotal.value
          : props.billing.cartTotal
      ),
      props.cartTotals && props.cartTotals.total_price
    ]);
    useEffect(function () {
      if (!props.eventRegistration || !props.eventRegistration.onPaymentSetup) return;
      return props.eventRegistration.onPaymentSetup(async function () {
        // Gate blocks CHARGE only (attestation + email verify).
        if (!attested || !(controller.isGateComplete && controller.isGateComplete())) {
          payModeRef.current = 'auto';
          if (controller.markWalletHandoff) controller.markWalletHandoff(false);
          return {
            type: props.emitResponse.responseTypes.ERROR,
            message: attested
              ? 'Verify email and accept research terms before paying.'
              : 'Accept the research-purchase terms.'
          };
        }
        if (!cartNeedsPayment()) {
          useNativeNoPayment();
          return { type: props.emitResponse.responseTypes.SUCCESS, meta: { paymentMethodData: {} } };
        }
        // No Stripe element is mounted to charge from: the card form is closed and this is not an
        // Express/Link confirm (e.g. WooCommerce's native Place Order was clicked while PRISM is the
        // selected method but neither "Pay with card" nor "Pay with Link" was used). Proceeding would
        // trip Stripe's "Could not find a mounted element to create the Confirmation Token from" error.
        // Guide the buyer to a real payment control instead of surfacing that raw SDK error.
        if (!cardOpenRef.current && payModeRef.current !== 'express') {
          payModeRef.current = 'auto';
          if (controller.markWalletHandoff) controller.markWalletHandoff(false);
          if (researchManaged) openNativePayment();
          return {
            type: props.emitResponse.responseTypes.ERROR,
            message: researchManaged ? 'Choose a payment method to continue.' : 'Choose “Pay with Link” or open “Pay with card” to complete your payment.'
          };
        }
        // Card Place Order uses full amount; Express confirm already set payModeRef='express'.
        if (cardOpenRef.current && payModeRef.current !== 'express') {
          payModeRef.current = 'card';
        }
        // FIX (1.0.9.9): wait for the cart store to finish flushing typed address fields
        // BEFORE create_attempt fingerprints them, so the attempt and the checkout POST
        // describe the same address. Never blocks payment: resolves either way.
        await waitForCustomerDataIdle();
        try {
          // Woo can still emit payment setup while native address validation
          // errors exist. Stop before creating an attempt or a Stripe token.
          // Wallet confirmation has already persisted its address before onSubmit.
          var nativeErrors = validationErrors();
          var errorKeys = Object.keys(nativeErrors);
          if (errorKeys.length) {
            revealValidationFields(nativeErrors);
            return {
              type: props.emitResponse.responseTypes.ERROR,
              message: nativeErrors[errorKeys[0]].message || 'Check the highlighted checkout fields.'
            };
          }
          var result = await api.blocksPaymentSetup(controller);
          if (result.type !== 'success') revealValidationFields();
          result.type = result.type === 'success' ? props.emitResponse.responseTypes.SUCCESS : props.emitResponse.responseTypes.ERROR;
          return result;
        } finally {
          payModeRef.current = 'auto';
          if (controller.markWalletHandoff) controller.markWalletHandoff(false);
        }
      });
    }, [attested, props.eventRegistration]);
    // cardOpen true → remount PE into #psc-blocks-payment; false → unmount PE, clear paymentMountedRef.
    // Does NOT require gate — card form can open for review; charge still gated on submit.
    useEffect(function () {
      if (researchManaged) {
        // Stripe's tabs own collapse/selection; the host and iframe stay mounted.
        ensureExpressMounted().then(mountPaymentIfReady).catch(function (error) { setText(error.message); });
        return;
      }
      if (!cardOpen) {
        unmountPaymentKeepInstance();
        // Leaving card mode: restore Express display base if money known.
        if (lastMoneyRef.current && payModeRef.current !== 'express') {
          applyElementsMoney(lastMoneyRef.current, 'auto');
        }
        return;
      }
      var cancelled = false;
      payModeRef.current = 'card';
      ensureExpressMounted().then(function () {
        if (cancelled) return;
        if (lastMoneyRef.current) applyElementsMoney(lastMoneyRef.current, 'card');
        mountPaymentIfReady();
      }).catch(function (error) {
        if (!cancelled) setText(error.message);
      });
      return function () {
        cancelled = true;
        unmountPaymentKeepInstance();
      };
    }, [cardOpen]);
    function send() {
      return controller.sendCode().then(function (result) {
        if (result && result.dispatch_state === 'ambiguous') {
          setText((api.buyerCopy && api.buyerCopy('otp_send_ambiguous')) || 'We couldn’t confirm the email was sent. Wait a moment and tap Resend.');
          return;
        }
        setText('Verification code sent.');
      }).catch(function (error) { setText(error.message); });
    }
    function verify() {
      return controller.verifyCode(domRead('psc_blocks_code'), !!document.querySelector('[name="psc_blocks_remember"]:checked')).then(function () {
        domWrite('psc_blocks_code', '', true);
        setText('Research email verified.');
        // Wallets already painted via bootstrap — never gate mount on OTP success.
        ensureExpressMounted();
      }).catch(function (error) { setText(error.message); });
    }
    function attest(event) {
      var value = !!event.target.checked; setAttested(value);
      controller.setAttested(value);
      if (value) {
        // Wallets already painted — do not wait for create_attempt to show Express.
        ensureExpressMounted();
        return;
      }
      // Drop money attempt identity; keep bootstrap Elements painted (classic parity).
      attemptRef.current = '';
      setCardOpen(false);
      unmountPaymentKeepInstance();
      // setAttested(false) already resets controller attempt/wallet money state.
    }
    function toggleCard() {
      setCardOpen(function (open) {
        if (open) {
          // Closing: unmount PE while host still exists (before React removes it).
          unmountPaymentKeepInstance();
          return false;
        }
        return true;
      });
    }
    // Express container is ALWAYS in the tree — never hide for incomplete OTP/gate.
    // Card toggle is always available (native_fallback still uses card path).
    var isDark = blocksIsDark();
    var themeClass = isDark ? 'psc-checkout--theme-dark' : 'psc-checkout--theme-light';
    return el('div', {
      ref: contentRef,
      className: 'psc-blocks-content psc-checkout ' + (walletFirst ? 'psc-checkout--wallet-first ' : '') + themeClass,
      'data-psc-theme': String(settings.theme || 'auto').toLowerCase(),
      'data-psc-wallet-first': walletFirst && needsPayment ? 'true' : 'false',
      'data-psc-native-fields': (!needsPayment || !walletFirst || !expressAvailable || nativeFallback || forcedFields || cardOpen) ? 'visible' : 'hidden',
    },
      el('p', {
        id: 'psc-blocks-alert',
        className: 'psc-payment-message',
        role: 'alert',
        hidden: !text
      }, text || ''),
      researchManaged ? null : el('div', { className: 'psc-blocks-research-gate' },
        el('p', null, 'Verification uses your billing email.'),
        otpHidden ? null : el('button', { type: 'button', onClick: send }, 'Send code'),
        otpHidden ? null : el('input', { name: 'psc_blocks_code', inputMode: 'numeric', maxLength: 6, placeholder: '6-digit code' }),
        otpHidden ? null : el('label', null, el('input', { name: 'psc_blocks_remember', type: 'checkbox', defaultChecked: true }), ' Remember this device'),
        otpHidden ? null : el('button', { type: 'button', onClick: verify }, 'Verify'),
        el('details', { className: 'psc-blocks-terms' },
          el('summary', null, 'Read the research-purchase terms'),
          el('p', { className: 'psc-terms-copy' },
            'By checking the box you confirm this is a research purchase and accept the PRISM checkout terms' +
            (settings.terms_version ? ' (version ' + settings.terms_version + ')' : '') +
            '. Acceptance is recorded with your order.'
          )
        ),
        el('label', null, el('input', { type: 'checkbox', checked: attested, onChange: attest }), ' I confirm this is a research purchase and accept the terms.')
      ),
      el('div', { id: 'psc-blocks-express', className: 'psc-blocks-express', hidden: !needsPayment || !expressAvailable || nativeFallback }),
      researchManaged ? null : el('button', { type: 'button', className: 'button psc-card-toggle', onClick: toggleCard }, cardOpen ? 'Hide card form' : 'Pay with card'),
      (researchManaged || cardOpen) ? el('div', { id: 'psc-blocks-payment', className: 'psc-blocks-payment', hidden: !needsPayment }) : null
    );
  }
  register({
    name: settings.gateway_id || 'psc', label: el(Label), content: el(Content), edit: el(Content),
    canMakePayment: function () { return true; }, ariaLabel: settings.title || 'PRISM Secure Checkout',
    supports: { features: settings.supports || ['products'] }
  });
})();
