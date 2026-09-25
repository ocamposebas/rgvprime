(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PSCCheckoutController = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var own = function (value, key) { return Object.prototype.hasOwnProperty.call(value || {}, key); };
  var normalizedEmail = function (value) { return String(value || '').trim().toLowerCase(); };

  function stripeRates(policy) {
    return (policy.shipping_rates || []).filter(function (rate) {
      return rate && String(rate.id || '') && Number.isFinite(Number(rate.amount)) && Number(rate.amount) >= 0;
    }).map(function (rate) {
      return { id: String(rate.id), displayName: String(rate.display_name || rate.displayName || rate.id), amount: Number(rate.amount) };
    });
  }

  function expressCheckoutOptions(policy) {
    policy = policy || {};
    var options = { emailRequired: true, billingAddressRequired: true };
    // Phone is never mandatory on PSC (privacy). Do not set phoneNumberRequired.
    if (policy.needs_shipping) {
      var rates = stripeRates(policy);
      options.shippingAddressRequired = true;
      // Empty rates are OK: shippingaddresschange will resolve rates after wallet address.
      options.shippingRates = rates;
    }
    return options;
  }

  /**
   * Relative luminance 0–1 from computed rgb/rgba background (WCAG-ish).
   * @param {string} color
   * @returns {number}
   */
  function relativeLuminance(color) {
    var m = String(color || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!m) return 0;
    var toLin = function (c) {
      c = Number(c) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * toLin(m[1]) + 0.7152 * toLin(m[2]) + 0.0722 * toLin(m[3]);
  }

  /**
   * Resolve whether the PRISM shell should use the dark skin.
   * Forced light/dark always win; auto uses body then document background luminance.
   *
   * @param {{ preference?: string, bodyBg?: string, documentBg?: string }} opts
   * @returns {boolean} true = dark theme
   */
  function resolveCheckoutIsDark(opts) {
    opts = opts || {};
    var pref = String(opts.preference || 'auto').toLowerCase();
    if (pref === 'dark') return true;
    if (pref === 'light') return false;
    var bodyBg = opts.bodyBg;
    var lum = relativeLuminance(bodyBg);
    if (!bodyBg || bodyBg === 'transparent' || bodyBg === 'rgba(0, 0, 0, 0)') {
      lum = relativeLuminance(opts.documentBg);
    }
    return lum < 0.45;
  }

  /** @param {boolean} isDark @returns {'dark'|'light'} */
  function effectiveThemeName(isDark) {
    return isDark ? 'dark' : 'light';
  }

  function paymentAppearance(isDark) {
    return {
      theme: isDark ? 'night' : 'stripe',
      variables: {
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSizeBase: '16px', borderRadius: '8px', spacingUnit: '4px',
        colorPrimary: isDark ? '#b4adff' : '#4f46e5',
        colorBackground: isDark ? '#171c24' : '#ffffff',
        colorText: isDark ? '#eff1f5' : '#20242c',
        colorTextSecondary: isDark ? '#a1aaba' : '#69717e',
        colorDanger: isDark ? '#ffb1ad' : '#ac3333'
      },
      rules: { '.Input': { padding: '12px', borderColor: isDark ? '#444e5e' : '#cbd0d8' }, '.Label': { fontWeight: '500' } }
    };
  }

  function paymentElementOptions(options) {
    options = options || {};
    var contact = options.billingDetails || {};
    return {
      fields: { billingDetails: 'never' },
      layout: { type: 'tabs', defaultCollapsed: !!options.collapsed },
      defaultValues: { billingDetails: { name: String(contact.name || ''), email: String(contact.email || '') } }
    };
  }

  function confirmationParams(attempt, includeShipping) {
    // These are Woo's canonical addresses from public_attempt(), after its
    // billing-to-shipping default and address normalization have been applied.
    function contact(fields) {
      fields = fields || {};
      return {
        name: (String(fields.first_name || '') + ' ' + String(fields.last_name || '')).trim(),
        address: {
          line1: String(fields.address_1 || ''), line2: String(fields.address_2 || ''),
          city: String(fields.city || ''), state: String(fields.state || ''),
          postal_code: String(fields.postcode || ''), country: String(fields.country || '')
        }
      };
    }
    var billing = contact(attempt.billing);
    billing.email = String(attempt.email || '');
    billing.phone = String(attempt.billing && attempt.billing.phone || '');
    var params = { payment_method_data: { billing_details: billing } };
    if (includeShipping) params.shipping = contact(attempt.shipping);
    return params;
  }

  function setupOrderSummary(container) {
    if (!container) return;
    var table = container.querySelector('.woocommerce-checkout-review-order-table');
    if (!table) return;
    var doc = container.ownerDocument, view = doc.defaultView;
    var translate = view.wp && view.wp.i18n ? function (text) { return view.wp.i18n.__(text, 'prism-simple-checkout'); } : function (text) { return text; };
    var disclosure = container.querySelector('.psc-order-summary');
    if (!disclosure) {
      disclosure = doc.createElement('details');
      disclosure.className = 'psc-order-summary';
      var heading = doc.createElement('summary'), label = doc.createElement('span'), total = doc.createElement('strong');
      label.textContent = translate('Order summary');
      total.className = 'psc-summary-total';
      heading.appendChild(label); heading.appendChild(total); disclosure.appendChild(heading);
      table.parentNode.insertBefore(disclosure, table);
      disclosure.appendChild(table);
      var mobile = view.matchMedia('(max-width: 991px)');
      disclosure.open = !mobile.matches;
      heading.addEventListener('click', function () { disclosure.dataset.mobileOpen = String(!disclosure.open); });
      mobile.addEventListener('change', function () {
        if (!disclosure.isConnected) return;
        disclosure.open = !mobile.matches || disclosure.dataset.mobileOpen === 'true';
      });
    } else if (!disclosure.contains(table)) {
      disclosure.appendChild(table);
    }
    var amount = table.querySelector('.order-total .amount, .order-total td');
    disclosure.querySelector('.psc-summary-total').textContent = amount ? amount.textContent.trim() : '';
    var form = container.closest('form');
    if (table.querySelectorAll('input[name^="shipping_method"]').length > 1 || table.querySelector('select[name^="shipping_method"] option + option') || (form && form.querySelector('.woocommerce-error, [aria-invalid="true"]'))) {
      disclosure.open = true;
    }
  }

  function mapContact(prefix, contact, includeContact) {
    contact = contact || {};
    var fields = {}, address = contact.address || contact;
    if (own(contact, 'name')) {
      var names = String(contact.name || '').trim().split(/\s+/), first = names.shift() || '';
      fields[prefix + '_first_name'] = first;
      fields[prefix + '_last_name'] = names.join(' ');
    }
    var addressMap = { line1: 'address_1', line2: 'address_2', city: 'city', state: 'state', postal_code: 'postcode', country: 'country' };
    Object.keys(addressMap).forEach(function (key) {
      if (own(address, key)) fields[prefix + '_' + addressMap[key]] = String(address[key] || '');
    });
    if (includeContact && own(contact, 'email')) fields.billing_email = normalizedEmail(contact.email);
    // Phone belongs on the prefix being mapped (billing_phone or shipping_phone).
    if (own(contact, 'phone') && contact.phone) {
      fields[prefix + '_phone'] = String(contact.phone);
    }
    return fields;
  }

  function hasFullAddress(contact, requireEmail) {
    var address = contact && (contact.address || contact) || {};
    return !!(address.line1 && address.city && address.postal_code && address.country && (!requireEmail || normalizedEmail(contact.email)));
  }

  /** Keys used to detect distinct wallet shipping (matches classic/blocks walletFieldsDiffer). */
  var SHIP_COMPARE_KEYS = ['first_name', 'last_name', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country', 'phone'];

  /**
   * Derive ship_to_different_address for psc_sync_wallet.
   * - Both billing + shipping present: '1' when any compare key differs, else '0'
   * - Shipping only (shippingaddresschange): '1' when any shipping key is present/non-empty
   * - Neither (rate-only): return priorFlag so a prior distinct address is not clobbered
   * Always returns string '0' or '1'.
   */
  function shipToDifferentFlag(fields, priorFlag) {
    fields = fields || {};
    var hasShipping = false;
    var hasBilling = false;
    SHIP_COMPARE_KEYS.forEach(function (k) {
      if (own(fields, 'shipping_' + k)) hasShipping = true;
      if (own(fields, 'billing_' + k)) hasBilling = true;
    });
    if (hasShipping && !hasBilling) {
      // shippingaddresschange: post '1' when shipping keys are present so PHP does not
      // mirror billing over the partial wallet shipping (including privacy-redacted empties).
      return '1';
    }
    if (hasShipping) {
      var differ = SHIP_COMPARE_KEYS.some(function (k) {
        return String(fields['billing_' + k] || '') !== String(fields['shipping_' + k] || '');
      });
      return differ ? '1' : '0';
    }
    return priorFlag === '1' ? '1' : '0';
  }

  function createController(deps) {
    var state = {
      researchRecordId: '', challengeId: '', verifiedEmail: '', attempt: null, attemptNeedsRevalidation: false, emailChanged: false, attested: false,
      // walletAmountMinor = full Woo total = Elements amount (Stripe pay total IS Elements amount;
      // shippingRates populate the picker only — Stripe never auto-adds the rate).
      // walletDisplayBaseMinor kept for diagnostics/tripwire only; never fed to Elements.
      walletFields: null, walletAmountMinor: null, walletDisplayBaseMinor: null, selectedRateAmount: null,
      lastElementsAmountMinor: null,
      walletCurrency: '', walletAccount: '', syncSequence: 0,
      walletHandoffActive: false, shipToDifferent: '0'
    };
    /**
     * Seed selectedRateAmount from rates[0] (Stripe default, no shippingratechange event)
     * only when base + rate === full — arms shipping-math reconcile without false trips.
     */
    function seedSelectedRateFromRates(rates, full, base) {
      if (!rates || !rates.length || !Number.isFinite(Number(rates[0].amount))) return;
      var rateAmt = Number(rates[0].amount);
      var f = full != null ? Number(full) : state.walletAmountMinor;
      var b = base != null ? Number(base) : state.walletDisplayBaseMinor;
      if (Number.isFinite(f) && Number.isFinite(b) && (b + rateAmt) === f) {
        state.selectedRateAmount = rateAmt;
      }
    }
    function seedSelectedRateFromPolicy(policy) {
      policy = policy || {};
      seedSelectedRateFromRates(policy.shipping_rates || [], state.walletAmountMinor, state.walletDisplayBaseMinor);
    }
    function pinMoneyFrom(payload) {
      if (!payload) return;
      if (payload.amount_minor != null) {
        state.walletAmountMinor = Number(payload.amount_minor);
        // Elements amount is always full — pin identity on every money seed/mount.
        rememberElementsAmount(state.walletAmountMinor);
      }
      if (payload.wallet_display_base_minor != null) state.walletDisplayBaseMinor = Number(payload.wallet_display_base_minor);
      else if (payload.amount_minor != null) state.walletDisplayBaseMinor = Number(payload.amount_minor);
      // Mount / attempt / bootstrap: seed default rate when rates are present (chosen-first from server).
      if (payload.field_policy) seedSelectedRateFromPolicy(payload.field_policy);
      else if (payload.shipping_rates) {
        seedSelectedRateFromRates(payload.shipping_rates, state.walletAmountMinor, state.walletDisplayBaseMinor);
      }
    }
    function normalizeMoneyPayload(money) {
      if (money == null) return null;
      if (typeof money === 'number' || typeof money === 'string') {
        var n = Number(money);
        if (!Number.isFinite(n) || n <= 0) return null;
        return { amount_minor: n, wallet_display_base_minor: n };
      }
      var full = Number(money.amount_minor);
      if (!Number.isFinite(full) || full <= 0) return null;
      var base = money.wallet_display_base_minor != null ? Number(money.wallet_display_base_minor) : full;
      if (!Number.isFinite(base) || base < 0) base = full;
      return {
        amount_minor: full,
        wallet_display_base_minor: base,
        currency: money.currency,
        field_policy: money.field_policy
      };
    }
    /**
     * Elements amount for every mode is the FULL Woo total (amount_minor).
     * Stripe ECE pay total === Elements amount; rates are picker-only.
     * Mount-at-full is mandatory: Apple Pay honors mid-sheet decreases, not increases
     * (react-stripe-js #506) — never open below amount_minor.
     * @param {object} money { amount_minor, wallet_display_base_minor }
     * @param {'express'|'card'|'auto'} mode
     */
    function elementsAmountForMode(money, mode) {
      money = normalizeMoneyPayload(money) || {};
      var full = Number(money.amount_minor);
      return Number.isFinite(full) && full > 0 ? full : 0;
    }
    function elementsAmountForWallet(payload) {
      return elementsAmountForMode(payload, 'auto');
    }
    /**
     * Confirm-time identity: wallet-displayed Elements amount must equal charged amount_minor.
     * Hard-stops a sheet that opened low (or drifted) so we never charge over display.
     * @param {number} elementsAmountMinor
     * @param {number} chargedAmountMinor
     */
    function assertElementsChargeIdentity(elementsAmountMinor, chargedAmountMinor) {
      var shown = Number(elementsAmountMinor);
      var charged = Number(chargedAmountMinor);
      if (!Number.isFinite(shown) || !Number.isFinite(charged) || shown <= 0 || charged <= 0) {
        throw new Error('Wallet payment total is unavailable. Re-open the payment sheet and try again.');
      }
      if (shown !== charged) {
        throw new Error('Totals changed — re-open the payment sheet.');
      }
    }
    function moneySnapshot() {
      return {
        amount_minor: state.walletAmountMinor,
        wallet_display_base_minor: state.walletDisplayBaseMinor != null ? state.walletDisplayBaseMinor : state.walletAmountMinor,
        selected_rate_amount: state.selectedRateAmount,
        elements_amount_minor: state.lastElementsAmountMinor != null ? state.lastElementsAmountMinor : state.walletAmountMinor,
        field_policy: state.attempt && state.attempt.field_policy
      };
    }
    function rememberElementsAmount(amount) {
      var n = Number(amount);
      if (Number.isFinite(n) && n > 0) state.lastElementsAmountMinor = n;
    }
    async function pushElementsMoney(money, mode) {
      var amount = elementsAmountForMode(money, mode || 'auto');
      rememberElementsAmount(amount);
      if (deps.updateElementsMoney) {
        await deps.updateElementsMoney(money, mode || 'auto');
      } else if (deps.updateElementsAmount) {
        await deps.updateElementsAmount(amount);
      }
    }
    var email = function () { return normalizedEmail(deps.readField('billing_email')); };

    async function sendCode() {
      var target = email();
      if (!target) throw new Error('Enter a billing email.');
      var result = await deps.post('psc_otp_challenge', { email: target });
      if (result && result.dispatch_state === 'reserved') {
        throw new Error(buyerCopy('otp_send_rejected') || 'We couldn’t send to that address. Check the email and try again.');
      }
      state.challengeId = result.challenge_id;
      state.verifiedEmail = '';
      return result;
    }

    async function verifyCode(code, remember) {
      if (!state.challengeId) throw new Error('Send a code first.');
      var result = await deps.post('psc_otp_verify', {
        challenge_id: state.challengeId, code: code, remember_device: !!remember
      });
      state.verifiedEmail = normalizedEmail(result.email);
      state.emailChanged = state.verifiedEmail !== email();
      return result;
    }

    async function ensureAttempt() {
      if (!state.attested) throw new Error('Accept the research-purchase terms before payment.');
      if (state.emailChanged && state.verifiedEmail !== email()) throw new Error('Verify the updated billing email before payment.');
      if (state.attempt && !state.attemptNeedsRevalidation) return state.attempt;
      // Research records already bind the exact declarations and timestamp server-side.
      // Reaccepting here would silently replace the buyer's actual consent time.
      if (deps.researchManaged && !state.researchRecordId) throw new Error('Complete researcher verification before payment.');
      if (!deps.researchManaged) await deps.post('psc_accept_legal', { accepted: 1 });
      var attemptBody = deps.createAttemptFields ? deps.createAttemptFields() : {};
      try {
        state.attempt = await deps.post('psc_create_attempt', attemptBody || {});
        state.attemptNeedsRevalidation = false;
      } catch (error) {
        if (deps.researchManaged && deps.onResearchRequired && ['declarations_expired', 'email_verification_required', 'verification_required', 'email_mismatch', 'research_record_required', 'research_verification_required'].indexOf(error.code) !== -1) {
          state.attested = false;
          state.researchRecordId = '';
          deps.onResearchRequired(error);
        }
        throw error;
      }
      pinMoneyFrom(state.attempt);
      if (!state.walletCurrency) state.walletCurrency = String(state.attempt.currency || '').toLowerCase();
      if (!state.walletAccount) state.walletAccount = String(state.attempt.connected_account || '');
      return state.attempt;
    }

    /**
     * Pre-token freshness: full amount_minor is money truth AND Elements pay total.
     * Displayed Elements amount must equal server amount_minor (two-surface money law).
     * Shipping math (base + chosen rate === full) remains a secondary consistency check.
     */
    async function assertAttemptFreshForToken() {
      var attempt = state.attempt;
      if (!attempt) return;
      var live = null;
      if (deps.fetchLiveCartTotals) {
        live = await deps.fetchLiveCartTotals();
      } else if (deps.post) {
        live = await deps.post('psc_express_bootstrap', {});
      }
      if (!live || live.amount_minor == null) return;
      var liveAmount = Number(live.amount_minor);
      var liveCurrency = String(live.currency || '').toLowerCase();
      var attemptAmount = Number(attempt.amount_minor);
      var attemptCurrency = String(attempt.currency || '').toLowerCase();
      var expired = false;
      if (attempt.expires_at) {
        var expMs = Date.parse(String(attempt.expires_at));
        expired = Number.isFinite(expMs) && expMs <= Date.now();
      }
      var liveFp = live.cart_fingerprint ? String(live.cart_fingerprint) : '';
      var attemptFp = attempt.cart_fingerprint ? String(attempt.cart_fingerprint) : '';
      var fpMismatch = !!(liveFp && attemptFp && liveFp !== attemptFp);
      var pinned = state.walletAmountMinor != null ? Number(state.walletAmountMinor) : attemptAmount;
      var displayBase = live.wallet_display_base_minor != null
        ? Number(live.wallet_display_base_minor)
        : (state.walletDisplayBaseMinor != null ? Number(state.walletDisplayBaseMinor) : null);
      var rateAmt = state.selectedRateAmount != null ? Number(state.selectedRateAmount) : null;
      var reconcileOk = true;
      if (Number.isFinite(displayBase) && Number.isFinite(rateAmt)) {
        reconcileOk = (displayBase + rateAmt) === liveAmount;
      }
      var amountMoved = (!Number.isFinite(liveAmount) || liveAmount <= 0 ||
        attemptAmount !== liveAmount ||
        (Number.isFinite(pinned) && pinned !== liveAmount));
      var currencyMoved = !!(liveCurrency && attemptCurrency && liveCurrency !== attemptCurrency);
      if (expired || fpMismatch || amountMoved || currencyMoved || !reconcileOk) {
        await invalidateLocalAttempt();
        // FIX (1.0.10.0): report the ACTUAL cause. Every one of these branches used to throw
        // "Wallet total changed after authorization" — including the common case where no
        // money moved at all and only the address representation drifted. That single wrong
        // message sent merchants hunting a pricing bug that did not exist, and told buyers
        // to re-check a total that had never changed.
        if (expired) {
          throw new Error('Your checkout session expired. Refresh the page and start again.');
        }
        if (amountMoved || currencyMoved) {
          throw new Error('Your order total changed before payment. Close the wallet, review the new total, and pay again.');
        }
        if (!reconcileOk) {
          throw new Error('The shipping total didn\'t add up. Close the wallet, reselect shipping, and try again.');
        }
        throw new Error('Your order details changed while the wallet was open. Close the wallet and try again.');
      }
      // Elements amount === charged amount (hard identity). Mid-sheet increases Apple Pay
      // cannot render still hard-stop here rather than charge over display.
      var elementsShown = state.lastElementsAmountMinor != null
        ? Number(state.lastElementsAmountMinor)
        : pinned;
      try {
        assertElementsChargeIdentity(elementsShown, liveAmount);
      } catch (identityError) {
        await invalidateLocalAttempt();
        throw identityError;
      }
      pinMoneyFrom(live);
      rememberElementsAmount(liveAmount);
    }

    async function paymentData(kind) {
      var attempt = await ensureAttempt();
      // Re-check live totals immediately before token creation (covers post-sync drift).
      await assertAttemptFreshForToken();
      attempt = state.attempt || await ensureAttempt();
      var token;
      try {
        token = await deps.createConfirmationToken(kind, attempt);
      } catch (tokenError) {
        // Shared safety net for BOTH classic and blocks checkouts. Stripe throws
        // "Could not find a mounted element to create the Confirmation Token from" when neither a
        // Payment Element nor an Express Checkout Element is mounted (e.g. PRISM selected, card form
        // closed, Link not used). Convert that raw SDK error into a clear buyer instruction so no
        // checkout path can ever surface the cryptic message. Any other error is re-thrown untouched.
        if (tokenError && /mounted element/i.test(String((tokenError && tokenError.message) || tokenError))) {
          throw new Error('Choose a payment method to continue.');
        }
        throw tokenError;
      }
      if (!token || !token.id) throw new Error('Could not create payment confirmation.');
      return {
        psc_attest: '1', psc_attempt_id: attempt.attempt_id,
        psc_operation_id: attempt.operation_id, psc_confirmation_token: token.id
      };
    }

    async function invalidateLocalAttempt() {
      state.attempt = null;
      if (deps.invalidateAttempt) await deps.invalidateAttempt();
    }

    async function authoritativeSync(fields, rate, finalAddress) {
      var sequence = ++state.syncSequence, prior = state.attempt;
      var shownAmount = state.walletAmountMinor === null && prior ? Number(prior.amount_minor) : state.walletAmountMinor;
      var shownCurrency = state.walletCurrency || String(prior && prior.currency || '').toLowerCase();
      var shownAccount = state.walletAccount || String(prior && prior.connected_account || '');
      var shipFlag = shipToDifferentFlag(fields, state.shipToDifferent);
      state.shipToDifferent = shipFlag;
      var result = await deps.post('psc_sync_wallet', {
        fields: JSON.stringify(fields || {}),
        shipping_method: rate || '',
        ship_to_different_address: shipFlag
      });
      if (sequence !== state.syncSequence) return Object.assign({ stale: true }, result);
      var resultCurrency = String(result.currency || '').toLowerCase();
      if (finalAddress && shownAmount !== null && (Number(result.amount_minor) !== Number(shownAmount) || resultCurrency !== shownCurrency)) {
        await invalidateLocalAttempt();
        // Genuine mismatch: the server total moved after the wallet authorized a different one.
        throw new Error('Your order total changed after the wallet authorized payment. Close the wallet, review the new total, and pay again.');
      }
      if (prior) {
        state.attempt = null;
        var replacement;
        try { replacement = await ensureAttempt(); }
        catch (error) { await invalidateLocalAttempt(); throw error; }
        var replacementCurrency = String(replacement.currency || '').toLowerCase();
        if (Number(replacement.amount_minor) !== Number(result.amount_minor) || replacementCurrency !== resultCurrency ||
            (shownCurrency && replacementCurrency !== shownCurrency) ||
            (shownAccount && String(replacement.connected_account || '') !== shownAccount)) {
          await invalidateLocalAttempt();
          throw new Error('Wallet payment identity changed while synchronizing Woo totals.');
        }
        if (deps.adoptAttempt) await deps.adoptAttempt(replacement);
      }
      pinMoneyFrom(result);
      var money = Object.assign({}, result, {
        field_policy: (state.attempt && state.attempt.field_policy) || result.field_policy || { needs_shipping: true }
      });
      // Elements amount = full amount_minor (Stripe does not auto-add shipping rates).
      await pushElementsMoney(money, state.walletHandoffActive ? 'express' : 'auto');
      state.walletCurrency = resultCurrency;
      state.walletAccount = shownAccount || String(state.attempt && state.attempt.connected_account || '');
      return result;
    }

    async function handleShippingAddressChange(contact, event) {
      // Arm before Woo totals move. Stripe ECE shippingaddresschange fires while
      // the Apple Pay sheet is open (docs.stripe.com/elements/express-checkout-element/
      // accept-a-payment). Adapter cart-resync must not drop the attempt or call
      // a second elements.update mid-sheet ("cart changed").
      markWalletHandoff(true);
      var result = await authoritativeSync(mapContact('shipping', contact, false), '', false);
      if (result.stale) {
        if (event && event.resolve) event.resolve({});
        return result;
      }
      var rates = (result.shipping_rates || []).map(function (rate) {
        return { id: rate.id, displayName: rate.display_name, amount: rate.amount };
      });
      // rates[0] is the preselected default and selecting it fires NO shippingratechange
      // (docs.stripe.com/js ECE: the event fires only when the customer selects a NEW rate) —
      // so seed selectedRateAmount here, when the base+rate===full identity holds.
      state.selectedRateAmount = null;
      seedSelectedRateFromRates(
        rates,
        result.amount_minor != null ? result.amount_minor : state.walletAmountMinor,
        result.wallet_display_base_minor != null ? result.wallet_display_base_minor : state.walletDisplayBaseMinor
      );
      if (event && event.resolve) event.resolve({ shippingRates: rates });
      return result;
    }

    async function handleShippingRateChange(rateId, event) {
      markWalletHandoff(true);
      deps.writeField('shipping_method', rateId, true);
      var result = await authoritativeSync({}, rateId, false);
      if (result && result.shipping_rates) {
        var match = (result.shipping_rates || []).find(function (r) { return String(r.id) === String(rateId); });
        state.selectedRateAmount = match ? Number(match.amount) : null;
      }
      if (event && event.resolve) event.resolve({});
      return result;
    }

    async function handleWalletConfirm(event) {
      event = event || {};
      var attempt = await ensureAttempt(), policy = attempt.field_policy || {};
      // Existing-order payment uses the frozen order addresses, never the current cart
      // or a wallet address that would change the already accepted order.
      if (deps.orderPay) { await assertAttemptFreshForToken(); return attempt; }
      var billing = event.billingDetails || {}, shipping = event.shippingAddress || {};
      if (!hasFullAddress(billing, true) || (policy.needs_shipping && !hasFullAddress(shipping, false))) {
        throw new Error('The wallet did not provide a complete billing and shipping address.');
      }
      var fields = Object.assign({}, mapContact('billing', billing, true), mapContact('shipping', shipping, false));
      // Wallet email (Apple ID / hide-my-email / Link saved) is never order identity when the
      // gate email is already verified. Overwriting billing_email + wiping verifiedEmail used to
      // trip isGateComplete / ensureAttempt on every real-device wallet pay. Verified email stays
      // billing_email; no emailChanged; no verifiedEmail wipe. Native form edit still re-verifies.
      if (state.verifiedEmail) {
        fields.billing_email = state.verifiedEmail;
      }
      // If Woo requires phone and only one side carried it, mirror to billing_phone.
      if (policy.phone_required && !fields.billing_phone && fields.shipping_phone) {
        fields.billing_phone = fields.shipping_phone;
      }
      Object.keys(fields).forEach(function (key) { deps.writeField(key, fields[key], true); });
      state.walletFields = fields;
      var rate = event.shippingRate && event.shippingRate.id || deps.readField('shipping_method') || '';
      var result = await authoritativeSync(fields, rate, true);
      if (result && result.stale) return result;
      // Silent field writes leave Woo validation/UI stale; explicit recalculate refreshes them.
      // Classic's updated_checkout must not wipe wallet state during this window (see markWalletHandoff).
      if (deps.recalculateWoo) await deps.recalculateWoo();
      // After Woo recalc, refuse to proceed if the live cart no longer matches the attempt
      // the wallet sheet authorized (prevents sheet-success then process_payment stale error).
      await assertAttemptFreshForToken();
      return result;
    }

    function markWalletHandoff(active) {
      state.walletHandoffActive = !!active;
    }

    function isWalletHandoffActive() {
      return !!state.walletHandoffActive;
    }

    /**
     * Sheet dismissed (cancel): reset Elements amount to current full amount_minor
     * so the next open does not inherit a stale mid-sheet total (Stripe guide pattern).
     */
    function handleWalletCancel() {
      var money = moneySnapshot();
      if (money.amount_minor == null || !(Number(money.amount_minor) > 0)) {
        markWalletHandoff(false);
        return;
      }
      var mode = state.walletHandoffActive ? 'express' : 'auto';
      var amount = elementsAmountForMode(money, mode);
      rememberElementsAmount(amount);
      if (deps.updateElementsMoney) {
        try {
          var pMoney = deps.updateElementsMoney(money, mode);
          if (pMoney && typeof pMoney.then === 'function') {
            pMoney.catch(function () { /* mid-unmount */ });
          }
        } catch (e) { /* ignore */ }
      } else if (deps.updateElementsAmount) {
        try {
          var p = deps.updateElementsAmount(amount);
          if (p && typeof p.then === 'function') {
            p.catch(function () { /* ignore */ });
          }
        } catch (e2) { /* ignore */ }
      }
      // Stripe cancel: amount reset, then drop the latch so a later coupon/qty
      // resync is not permanently suppressed.
      markWalletHandoff(false);
    }

    function reset() {
      state.attempt = null; state.walletFields = null; state.walletAmountMinor = null;
      state.attemptNeedsRevalidation = false;
      state.walletDisplayBaseMinor = null; state.selectedRateAmount = null;
      state.lastElementsAmountMinor = null;
      state.walletCurrency = ''; state.walletAccount = ''; state.syncSequence += 1;
      state.walletHandoffActive = false;
      state.shipToDifferent = '0';
    }

    /**
     * Cart totals changed (coupon / qty / shipping) outside wallet handoff.
     * Prefer full money payload; Elements amount is always amount_minor.
     * @param {number|string|{amount_minor:number,wallet_display_base_minor?:number,field_policy?:object}} money
     * @param {'express'|'card'|'auto'} [elementsMode='auto']
     */
    function resyncCartAmount(money, elementsMode) {
      var payload = normalizeMoneyPayload(money);
      if (!payload) {
        return { dropped: false, amount: null, display_base: null };
      }
      var fresh = payload.amount_minor;
      var base = payload.wallet_display_base_minor;
      var dropped = false;
      var attemptAmount = state.attempt != null ? Number(state.attempt.amount_minor) : null;
      var pinned = attemptAmount != null && Number.isFinite(attemptAmount)
        ? attemptAmount
        : (state.walletAmountMinor != null ? Number(state.walletAmountMinor) : null);
      if (state.attempt && Number.isFinite(attemptAmount) && attemptAmount !== fresh) {
        state.attempt = null;
        state.walletFields = null;
        dropped = true;
      } else if (
        !state.attempt &&
        pinned != null &&
        Number.isFinite(pinned) &&
        pinned !== fresh
      ) {
        state.walletFields = null;
        dropped = true;
      }
      state.walletAmountMinor = fresh;
      state.walletDisplayBaseMinor = base;
      state.selectedRateAmount = null;
      // Re-seed from payload rates when present (coupon resync may still include rates).
      if (payload.field_policy) seedSelectedRateFromPolicy(payload.field_policy);
      var mode = elementsMode || 'auto';
      var show = elementsAmountForMode(payload, mode);
      rememberElementsAmount(show);
      if (deps.updateElementsMoney) {
        try {
          var pMoney = deps.updateElementsMoney(payload, mode);
          if (pMoney && typeof pMoney.then === 'function') {
            pMoney.catch(function () { /* mid-unmount */ });
          }
        } catch (e) { /* ignore */ }
      } else if (deps.updateElementsAmount) {
        try {
          var p = deps.updateElementsAmount(show);
          if (p && typeof p.then === 'function') {
            p.catch(function () { /* Elements may be mid-unmount */ });
          }
        } catch (e2) { /* ignore */ }
      }
      return { dropped: dropped, amount: fresh, display_base: base, elements_amount: show };
    }

    return {
      sendCode: sendCode, verifyCode: verifyCode, ensureAttempt: ensureAttempt, paymentData: paymentData,
      // A Woo failure may have cleared the attempt or left payment settling. Only
      // the existing server create/reconcile path can decide whether retry is safe.
      markAttemptForRevalidation: function () { state.attemptNeedsRevalidation = true; },
      handleShippingAddressChange: handleShippingAddressChange, handleShippingRateChange: handleShippingRateChange,
      handleWalletConfirm: handleWalletConfirm,
      handleWalletCancel: handleWalletCancel,
      assertAttemptFreshForToken: assertAttemptFreshForToken,
      assertElementsChargeIdentity: assertElementsChargeIdentity,
      markWalletHandoff: markWalletHandoff, isWalletHandoffActive: isWalletHandoffActive,
      resyncCartAmount: resyncCartAmount,
      elementsAmountForWallet: elementsAmountForWallet,
      elementsAmountForMode: elementsAmountForMode,
      normalizeMoneyPayload: normalizeMoneyPayload,
      moneySnapshot: moneySnapshot,
      pinMoneyFrom: pinMoneyFrom,
      setResearchContext: function (context) {
        if (!deps.researchManaged || !context || !context.ready || !context.recordId || !normalizedEmail(context.email)) return false;
        if (email() && normalizedEmail(context.email) !== email()) return false;
        if (state.researchRecordId !== context.recordId) reset();
        state.researchRecordId = context.recordId;
        state.verifiedEmail = normalizedEmail(context.email);
        state.emailChanged = false;
        state.attested = true;
        return true;
      },
      invalidateResearch: function () {
        state.researchRecordId = ''; state.verifiedEmail = ''; state.attested = false;
        reset();
      },
      setAttested: function (value) { state.attested = !!value; if (!state.attested) reset(); },
      checkoutAddresses: function () {
        var fields = state.walletFields || {}, billing = {}, shipping = {};
        Object.keys(fields).forEach(function (key) {
          if (key.indexOf('billing_') === 0) billing[key.slice(8)] = fields[key];
          if (key.indexOf('shipping_') === 0) shipping[key.slice(9)] = fields[key];
        });
        return state.walletFields ? { billingAddress: billing, shippingAddress: shipping } : {};
      },
      getWalletFields: function () {
        return state.walletFields ? Object.assign({}, state.walletFields) : null;
      },
      getPersistFields: function () {
        var attempt = state.attempt;
        if (attempt && attempt.billing && typeof attempt.billing === 'object') {
          var out = {};
          var parts = ['first_name', 'last_name', 'company', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country', 'phone'];
          parts.forEach(function (k) {
            if (attempt.billing[k] != null) out['billing_' + k] = String(attempt.billing[k]);
            if (attempt.shipping && attempt.shipping[k] != null) out['shipping_' + k] = String(attempt.shipping[k]);
          });
          out.billing_email = String(
            attempt.email || (state.walletFields && state.walletFields.billing_email) || state.verifiedEmail || ''
          );
          return out;
        }
        return state.walletFields ? Object.assign({}, state.walletFields) : null;
      },
      isEmailVerified: function () { return !!state.verifiedEmail; },
      isAttested: function () { return !!state.attested; },
      isGateComplete: function () { return !!state.verifiedEmail && !!state.attested && (!deps.researchManaged || (!!state.researchRecordId && state.verifiedEmail === email())); },
      applyRememberedEmail: function (remembered) {
        var next = normalizedEmail(remembered);
        if (!next || (email() && email() !== next)) return false;
        state.verifiedEmail = next;
        state.emailChanged = state.verifiedEmail !== email();
        return true;
      },
      reset: reset
    };
  }

  async function classicSubmit(controller, kind) {
    var data = await controller.paymentData(kind);
    return controller._submit ? controller._submit(data) : data;
  }
  async function classicWalletSubmit(controller, event) {
    // Gate blocks charge only — Express is mounted without OTP; refuse pay if incomplete.
    if (controller.isGateComplete && !controller.isGateComplete()) {
      throw new Error('Verify email and accept research terms before paying.');
    }
    if (controller.markWalletHandoff) controller.markWalletHandoff(true);
    try {
      await controller.handleWalletConfirm(event);
      // Final pre-token guard (also runs inside paymentData) so paymentFailed fires in-sheet.
      if (controller.assertAttemptFreshForToken) {
        await controller.assertAttemptFreshForToken();
      }
      return await classicSubmit(controller, 'express');
    } finally {
      if (controller.markWalletHandoff) controller.markWalletHandoff(false);
    }
  }
  async function blocksPaymentSetup(controller) {
    try {
      var result = { type: 'success', meta: { paymentMethodData: await controller.paymentData('blocks') } };
      return Object.assign(result, controller.checkoutAddresses());
    } catch (error) {
      return { type: 'error', message: error.message || 'Payment setup failed.' };
    }
  }
  var BUYER_COPY = {
    otp_send_failed: 'We couldn’t send the code. Check your connection and tap Send code again.',
    otp_send_ambiguous: 'We couldn’t confirm the email was sent. Wait a moment and tap Resend.',
    otp_send_rejected: 'We couldn’t send to that address. Check the email and try again.',
    otp_resend_cooldown: 'Wait a minute before requesting another code.',
    otp_send_rate_limited: 'Too many codes sent to this email this hour. Try again later.',
    otp_code_mismatch: 'That code doesn’t match. Check the 6 digits and try again.',
    otp_attempts_exhausted: 'Too many incorrect tries. Wait for a new code, or tap Resend after it expires.',
    otp_code_expired: 'That code expired. Tap Resend for a new one.',
    otp_verify_race: 'The code is right but confirmation is still catching up — wait 10 seconds and try again.',
    cart_stale_js: 'Your cart total changed. Review your order and try payment again.',
    cart_stale_pay: 'Your cart changed before payment. Review the total and try again.',
    checkout_claim_busy: 'Another payment is already starting. Wait a few seconds and try again.',
    create_attempt_failed: 'We couldn’t start payment. Wait a moment and try again.',
    wallet_cancel: 'Payment cancelled. Nothing was charged.',
    pe_incomplete: 'Payment details are incomplete. Check the card and try again.',
    card_declined: 'The card was declined. Try another card or pay a different way.',
    confirm_pending: 'Payment is still confirming. Don’t submit again — wait or refresh.',
    poll_unavailable: 'We can’t confirm payment status yet. Refresh this page. Don’t pay twice.',
    invalid_nonce: 'This checkout page expired. Refresh and try again.',
    terms_unavailable: 'Checkout terms are unavailable. This order cannot be placed.',
    threeds_pending: 'Your bank needs a quick extra check. Finish that prompt — don’t close the tab.'
  };
  function buyerCopy(code) {
    return Object.prototype.hasOwnProperty.call(BUYER_COPY, code) ? BUYER_COPY[code] : '';
  }

  return {
    paymentAppearance: paymentAppearance,
    paymentElementOptions: paymentElementOptions,
    confirmationParams: confirmationParams,
    setupOrderSummary: setupOrderSummary,
    expressCheckoutOptions: expressCheckoutOptions,
    relativeLuminance: relativeLuminance,
    resolveCheckoutIsDark: resolveCheckoutIsDark,
    effectiveThemeName: effectiveThemeName,
    buyerCopy: buyerCopy,
    createController: function (deps) { var controller = createController(deps); controller._submit = deps.submitWoo; return controller; },
    classicSubmit: classicSubmit, classicWalletSubmit: classicWalletSubmit, blocksPaymentSetup: blocksPaymentSetup
  };
});
