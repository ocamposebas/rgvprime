(function () {
  'use strict';
  var config = window.pscResearch;
  if (!config) return;
  var tr = function (text) { return window.wp && wp.i18n ? wp.i18n.__(text, 'prism-simple-checkout') : text; };
  var escape = function (text) { return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var emailKey = function (email) { return String(email || '').trim().toLowerCase(); };
  var labels = { independent: tr('Independent'), university: tr('University'), laboratory: tr('Institution / lab') };
  var detailsVersion = 'psc-research-details-v3';
  var agreement = config.researcher_agreement;
  var agreementReady = agreement && agreement.version === detailsVersion && typeof agreement.title === 'string'
    && Array.isArray(agreement.sections) && agreement.sections.length > 0 && agreement.sections.every(function (section) {
      return typeof section.heading === 'string' && Array.isArray(section.paragraphs) && section.paragraphs.length > 0
        && section.paragraphs.every(function (paragraph) { return typeof paragraph === 'string'; });
    });

  function bootstrap() {
    return fetch(config.ajax_url, { method: 'POST', credentials: config.fetch_credentials || 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-PSC-Bootstrap': '1' }, body: 'action=psc_research_bootstrap' }).then(function (response) { return response.json(); }).then(function (response) {
      if (!response || !response.success || !response.data.nonce) throw new Error(tr('Your checkout session could not be refreshed. Please reload the page.'));
      config.nonce = response.data.nonce;
      if (window.pscCheckout) window.pscCheckout.nonce = config.nonce;
      return response.data;
    });
  }

  function post(action, data, retried) {
    var body = new URLSearchParams(Object.assign({}, config.order_pay ? { order_id: config.order_id, order_key: config.order_key } : {}, data, { action: action, nonce: config.nonce }));
    return fetch(config.ajax_url, { method: 'POST', credentials: config.fetch_credentials || 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: body }).then(function (response) {
      return response.json();
    }).then(function (response) {
      var data = response && response.data;
      if (!response || !response.success) {
        var error = new Error(data && data.message || tr('We could not complete that request. Please try again.'));
        error.code = data && data.code;
        throw error;
      }
      return data || {};
    }).catch(function (error) {
      if (error.code === 'invalid_nonce' && !retried) return bootstrap().then(function () { return post(action, data, true); });
      throw error;
    });
  }

  function cartAccess(method) {
    try {
      var data = window.wp && wp.data;
      var descriptor = window.wc && wc.wcBlocksData && wc.wcBlocksData.cartStore;
      return data && descriptor ? data[method](descriptor) : null;
    } catch (error) { return null; }
  }

  function billing() {
    var store = cartAccess('select');
    if (store && store.getCustomerData) return store.getCustomerData().billingAddress || {};
    var read = function (key) { var field = document.querySelector('[name="billing_' + key + '"]'); return field ? field.value : ''; };
    return { email: read('email'), first_name: read('first_name'), last_name: read('last_name') };
  }

  function uuid() {
    if (window.crypto.randomUUID) return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var text = Array.from(bytes, function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
    return text.slice(0, 8) + '-' + text.slice(8, 12) + '-' + text.slice(12, 16) + '-' + text.slice(16, 20) + '-' + text.slice(20);
  }

  function mount(root) {
    if (root.dataset.pscMounted) return;
    var app = root.querySelector('#psc-research-app');
    if (!app) return;
    root.dataset.pscMounted = 'true';
    var original = config.order_pay && config.initial_billing ? config.initial_billing : billing();
    var theme = root.dataset.pscFixedTheme || config.theme;
    var state = {
      step: 'checking', renewal: false, theme: theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light',
      name: [original.first_name, original.last_name].filter(Boolean).join(' '), email: original.email || '',
      category: 'independent', organization: null, query: '', organizations: [], searchBusy: false, searchMessage: '',
      declarations: { age: false, research: false, terms: false }, accepted: false,
      declarationsSourceId: '', declarationsAcceptedAt: '', declarationsProfileKey: '',
      declarationsTermsVersion: '', declarationsTermsHash: '', declarationsChoiceMade: false,
      automaticReuseBlocked: false,
      detailsAccepted: false, detailsRecordId: '', agreementOpen: false,
      verifiedEmail: '', proofExpires: '', remembered: false, rememberedContext: false,
      challenge: '', challengeExpires: '', challengeEmail: '', code: '', remember: true,
      profileEdits: { name: false, email: false, category: false, organization: false },
      googleEnabled: false, authMode: 'email', googleRequestId: '', googleIdentity: false,
      revision: 0, searchRevision: 0, record: null, requestId: '', busy: false, message: '', error: false
    };
    var searchTimer, clockTimer, syncingBilling = false, renewalInFlight = null;
    var help = document.createElement('dialog');
    help.id = 'psc-research-help';
    help.className = 'psc-r-help';
    help.setAttribute('aria-labelledby', 'psc-research-help-title');
    root.appendChild(help);
    help.addEventListener('close', function () {
      var trigger = root.querySelector('[data-action="help"]');
      if (trigger) trigger.focus({ preventScroll: true });
    });
    function openHelp() {
      var signIn = state.googleEnabled
        ? tr('Independent can use Google or an email code. University and Institution / lab use a matching organization email.')
        : tr('Confirm your email with the code sent to your inbox. University and Institution / lab need a matching organization email.');
      help.innerHTML = '<h3 id="psc-research-help-title" tabindex="-1" autofocus>' + escape(tr('Checkout in 3 simple steps')) + '</h3><ol class="psc-r-help-steps">'
        + '<li><strong>' + escape(tr('Review and agree')) + '</strong><p>' + escape(tr('Confirm the declarations, choose your researcher type and accept the Researcher Agreement.')) + '</p></li>'
        + '<li><strong>' + escape(tr('Confirm it’s you')) + '</strong><p>' + escape(signIn) + '</p></li>'
        + '<li><strong>' + escape(tr('Continue to checkout')) + '</strong><p>' + escape(tr('Once confirmed, billing and payment will open.')) + '</p></li></ol>'
        + '<div class="psc-r-help-remember"><strong>' + escape(tr('Fewer steps next time')) + '</strong><p>' + escape(tr('Keep “Remember this device” selected to skip email confirmation for 30 days on this device. When your details and terms are unchanged, your saved agreements let you continue straight to checkout.')) + '</p></div>'
        + '<button type="button" data-action="close-help" class="psc-r-button psc-r-primary">' + escape(tr('Got it')) + '</button>';
      help.showModal();
    }
    var invalidation = Promise.resolve();
    function status() {
      return { ready: state.step === 'complete' && !!state.record, recordId: state.record && state.record.id || '', digest: state.record && state.record.digest || '', email: state.email };
    }
    function revokePayment() {
      var hadRecord = !!state.record;
      root.dispatchEvent(new CustomEvent('psc:research-invalidated', { bubbles: true }));
      if (hadRecord) {
        invalidation = invalidation.catch(function () {}).then(function () { return post('psc_research_invalidate', {}); });
        invalidation.catch(function (error) { failed(error); render(); });
      }
    }
    window.PSCResearchCheckout = { getStatus: status, refreshSession: bootstrap };
    document.addEventListener('psc:research-required', function (event) {
      if (state.busy || renewalInFlight) return;
      var detail = event.detail || {};
      if (detail.code === 'declarations_expired' && state.automaticReuseBlocked && state.declarationsSourceId) {
        state.authMode = 'email'; state.step = 'details'; render(true); return;
      }
      revokePayment();
      state.revision += 1; state.record = null; state.requestId = '';
      if (detail.code === 'declarations_expired') {
        if (savedDeclarationsReady() && hasProof() && detailsValid() && detailsConfirmed()) {
          state.busy = true; state.renewal = true; state.step = 'checking'; message(''); render();
          renewalInFlight = saveRecord().catch(failed).finally(function () {
            renewalInFlight = null; state.busy = false;
            if (state.step === 'checking') state.step = 'gate';
            render(true);
          });
          return;
        }
        clearDeclarationReuse(true);
        state.declarations = { age: false, research: false, terms: false };
        state.accepted = false; state.renewal = true; state.step = 'gate';
        message(tr('Confirm these declarations again to continue with your order.'));
      } else {
        state.verifiedEmail = ''; state.proofExpires = ''; state.rememberedContext = false;
        state.authMode = 'email'; state.step = 'details';
        message(detail.message || tr('Confirm your email to continue.'));
      }
      render(true);
      root.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    function focusCheckout() {
      if (config.verification_only) return;
      window.requestAnimationFrame(function () {
        var target = document.querySelector('form.checkout, form#order_review, .wp-block-woocommerce-checkout');
        if (!target || target.getClientRects().length === 0) return;
        var next = target.querySelector('h3, .wc-block-components-title, h2');
        if (!next) next = target;
        next.setAttribute('tabindex', '-1');
        next.focus({ preventScroll: true });
        next.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    }
    var field = function (id) { return root.querySelector('#' + id); };
    function hasProof() {
      return state.verifiedEmail && state.verifiedEmail === emailKey(state.email) && (state.category === 'independent' || !state.googleIdentity)
        && (!state.proofExpires || Date.parse(state.proofExpires) > Date.now());
    }
    function googleAvailable() { return state.googleEnabled && state.category === 'independent'; }
    function domains() {
      if (!state.organization) return [];
      return state.organization.domains || (state.organization.domain ? [state.organization.domain] : []);
    }
    function detailsValid() {
      var valid = !!state.name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email.trim());
      if (state.category === 'independent') return valid;
      return valid && !!state.organization && domains().some(function (domain) { return emailKey(domain) === emailKey(state.email).split('@')[1]; });
    }
    function googleValid() { return googleAvailable() && state.accepted && detailsConfirmed(); }
    function detailsConfirmed() { return agreementReady && (state.detailsAccepted || !!state.detailsRecordId); }
    function agreementMarkup() {
      if (!agreementReady) return '<p role="alert">' + escape(tr('The Researcher Agreement is unavailable. Reload this page or contact the store.')) + '</p>';
      return '<h3 class="psc-r-document-title">' + escape(agreement.title) + '</h3>' + agreement.sections.map(function (section) {
        return '<section><h4>' + escape(section.heading) + '</h4>'
          + section.paragraphs.map(function (paragraph) { return '<p>' + escape(paragraph) + '</p>'; }).join('') + '</section>';
      }).join('');
    }
    function profileKey(profile) {
      var value = profile || state;
      return JSON.stringify([String(value.name || '').trim(), emailKey(value.email), value.category, value.organization && value.organization.id || '']);
    }
    function allDeclarations(declarations) {
      return !!declarations && ['age', 'research', 'terms'].every(function (key) { return declarations[key] === true; });
    }
    function clearDeclarationReuse(resetAcceptance) {
      var reused = !!state.declarationsSourceId;
      state.declarationsSourceId = ''; state.declarationsAcceptedAt = ''; state.declarationsProfileKey = '';
      state.declarationsTermsVersion = ''; state.declarationsTermsHash = '';
      if (resetAcceptance && reused) {
        state.declarations = { age: false, research: false, terms: false }; state.accepted = false;
      }
    }
    function rememberDeclarations(profile) {
      var legal = profile && profile.legal;
      var attestation = profile && profile.declarations && profile.declarations.details_attestation;
      if (!profile || !profile.id || profileKey(profile) !== profileKey() || !allDeclarations(profile.declarations)
          || !legal || legal.accepted !== true || legal.version !== config.terms_version || legal.hash !== config.terms_hash
          || typeof legal.accepted_at !== 'string' || !Number.isFinite(Date.parse(legal.accepted_at))
          || !attestation || attestation.accepted !== true || attestation.version !== detailsVersion || !agreementReady) return false;
      state.declarationsSourceId = profile.id; state.declarationsAcceptedAt = legal.accepted_at;
      state.declarationsTermsVersion = legal.version; state.declarationsTermsHash = legal.hash;
      state.declarationsProfileKey = profileKey();
      state.declarations = { age: true, research: true, terms: true }; state.accepted = true;
      state.detailsAccepted = false; state.detailsRecordId = profile.id;
      return true;
    }
    function savedDeclarationsReady() {
      return !!state.declarationsSourceId && !!state.declarationsAcceptedAt && state.declarationsProfileKey === profileKey()
        && state.declarationsTermsVersion === config.terms_version && state.declarationsTermsHash === config.terms_hash
        && state.accepted && allDeclarations(state.declarations) && !state.detailsAccepted
        && state.detailsRecordId === state.declarationsSourceId && agreementReady;
    }
    function restoreProfile(profile) {
      if (!profile || emailKey(profile.email) !== emailKey(state.email) || !labels[profile.category]) return;
      var before = JSON.stringify([state.name, state.category, state.organization && state.organization.id]);
      // A freshly authenticated profile can restore defaults, never deliberate edits.
      if (!state.profileEdits.name && profile.name) state.name = profile.name;
      if (!state.profileEdits.category && !state.profileEdits.organization) {
        state.category = profile.category; state.organization = profile.organization || null;
        state.query = state.organization ? state.organization.name : '';
      }
      if (before !== JSON.stringify([state.name, state.category, state.organization && state.organization.id])) {
        state.detailsAccepted = false; state.detailsRecordId = '';
      }
      var attestation = profile.declarations && profile.declarations.details_attestation;
      if (!state.detailsAccepted && !Object.values(state.profileEdits).some(Boolean)
          && profile.name === state.name && profile.category === state.category
          && (profile.organization && profile.organization.id || '') === (state.organization && state.organization.id || '')
          && attestation && attestation.accepted === true && attestation.version === detailsVersion) state.detailsRecordId = profile.id;
      if (!state.declarationsChoiceMade && !state.detailsAccepted && !Object.values(state.profileEdits).some(Boolean) && hasProof()) {
        rememberDeclarations(profile);
      }
      state.rememberedContext = detailsValid() && detailsConfirmed();
    }
    function invalidate(emailChanged) {
      revokePayment();
      state.revision += 1;
      state.record = null;
      state.requestId = '';
      state.googleRequestId = '';
      clearDeclarationReuse(true);
      state.rememberedContext = false;
      state.detailsAccepted = false; state.detailsRecordId = '';
      if (emailChanged) {
        state.verifiedEmail = ''; state.proofExpires = ''; state.remembered = false;
        state.challenge = ''; state.challengeEmail = ''; state.code = ''; state.googleIdentity = false;
      }
    }
    function message(text, error) { state.message = text || ''; state.error = !!error; }
    function failed(error) {
      if (state.declarationsSourceId && (state.step === 'checking' || renewalInFlight)) state.automaticReuseBlocked = true;
      // A rejected source returns to actual assent. Transient failures retain
      // the source and idempotent request for a buyer-initiated retry instead.
      if (state.declarationsSourceId && ['declarations_expired', 'details_attestation_required', 'declarations_source_invalid', 'declarations_reuse_invalid', 'terms_changed'].indexOf(error.code) !== -1) {
        clearDeclarationReuse(true); state.detailsAccepted = false; state.detailsRecordId = '';
        state.record = null; state.requestId = ''; state.rememberedContext = false; state.step = 'gate';
      } else if (state.declarationsSourceId && state.step === 'checking') {
        state.authMode = 'email'; state.step = 'details';
      }
      if (['declarations_required', 'declarations_expired', 'declarations_source_invalid', 'declarations_reuse_invalid', 'terms_changed'].indexOf(error.code) !== -1) {
        clearDeclarationReuse(true); state.declarations = { age: false, research: false, terms: false };
        state.accepted = false; state.record = null; state.requestId = ''; state.step = 'gate';
      }
      if (error.code === 'details_attestation_required') { state.detailsAccepted = false; state.detailsRecordId = ''; state.rememberedContext = false; state.step = 'details'; }
      if (['email_verification_required', 'verification_required', 'email_mismatch'].indexOf(error.code) !== -1) {
        state.verifiedEmail = ''; state.proofExpires = ''; state.record = null; state.requestId = ''; state.rememberedContext = false; state.step = 'details';
      }
      message(error.message, true);
    }
    function currentDomainNotice() {
      if (state.category === 'independent') return tr('Use your preferred email.');
      if (!state.organization) return tr('Select your organization from the search results.');
      var expected = domains().map(function (domain) { return '@' + domain; }).join(', ');
      if (state.email && !domains().some(function (domain) { return emailKey(domain) === emailKey(state.email).split('@')[1]; })) return tr('Use an email at your selected organization: ') + expected + '.';
      return tr('Confirm an email at ') + expected + '.';
    }
    function textInput(id, label, value, type, autocomplete) {
      return '<label class="psc-r-field" for="' + id + '"><span>' + escape(label) + '</span><input id="' + id + '" type="' + (type || 'text') + '" value="' + escape(value) + '" autocomplete="' + (autocomplete || 'off') + '"' + (type === 'email' ? ' inputmode="email" autocapitalize="none" spellcheck="false" aria-describedby="psc-research-domain"' : '') + (id === 'psc-research-name' ? ' enterkeyhint="next"' : '') + (state.busy ? ' disabled' : '') + '></label>';
    }
    function button(action, title, primary, disabled) {
      return '<button type="button" data-action="' + action + '" class="psc-r-button' + (primary ? ' psc-r-primary' : '') + '"' + (disabled || state.busy ? ' disabled' : '') + '>' + escape(title) + '</button>';
    }
    function rememberChoice() {
      return '<label class="psc-r-check psc-r-remember"><input id="psc-research-remember" type="checkbox"'
        + (state.remember ? ' checked' : '') + (state.busy ? ' disabled' : '')
        + '><span><strong>' + escape(tr('Remember this device')) + '</strong><span>'
        + escape(tr('Skip email confirmation on this device for 30 days.')) + '</span></span></label>';
    }
    function updateDeclarations() {
      var values = Object.values(state.declarations);
      var all = values.every(Boolean);
      var checkAll = field('psc-research-check-all');
      if (checkAll) { checkAll.checked = all; checkAll.indeterminate = !all && values.some(Boolean); }
      root.querySelectorAll('[data-declaration]').forEach(function (input) { input.checked = state.declarations[input.dataset.declaration]; });
      var next = root.querySelector('[data-action="continue"]');
      if (next) next.disabled = state.busy || !all || !config.terms_version || !config.terms_hash;
    }
    function render(focus) {
      if (state.step === 'details' && root.dataset.pscStep !== 'details') state.agreementOpen = false;
      root.dataset.pscTheme = state.theme;
      root.dataset.pscStep = state.step;
      root.dataset.pscRenewal = String(state.renewal);
      document.body.dataset.pscCheckoutTheme = state.theme;
      root.setAttribute('aria-busy', String(state.busy));
      var titles = { checking: tr('One moment…'), gate: tr('Research access'), details: tr('Your details'), code: tr('Confirm your email'), complete: tr('Verified') };
      var content = '';
      if (state.step === 'checking') {
        content = '<p class="psc-r-hint" role="status">' + escape(tr('Opening your checkout.')) + '</p>';
      } else if (state.step === 'gate') {
        content = state.renewal ? '' : '<p class="psc-r-intro"><strong>' + escape(tr('Verify to continue to checkout.')) + '</strong><br>' + escape(tr('Use “Remember this device” for fewer steps next time.')) + '</p>';
        content += '<label class="psc-r-check psc-r-check-all"><input id="psc-research-check-all" type="checkbox"' + (state.busy ? ' disabled' : '') + '><span>' + escape(tr('Agree to all')) + '</span></label><div class="psc-r-declarations">';
        [ ['age', tr('I am at least 21 years of age.')], ['research', tr('I confirm I am a qualified researcher purchasing for in vitro / laboratory research only — not for human or veterinary use.')], ['terms', tr('I have read and accept the research-purchase terms below.')] ].forEach(function (item) {
          content += '<label class="psc-r-check"><input type="checkbox" data-declaration="' + item[0] + '"' + (state.declarations[item[0]] ? ' checked' : '') + (state.busy ? ' disabled' : '') + '><span>' + escape(item[1]) + '</span></label>';
        });
        content += '</div><details class="psc-r-terms"><summary>' + escape(tr('Research-purchase terms')) + '</summary><div>' + escape(config.terms_text || tr('Terms are unavailable. Please contact the store.')) + '</div></details>';
        content += button('continue', state.busy ? tr('Continuing…') : tr('Continue'), true, !Object.values(state.declarations).every(Boolean) || !config.terms_version || !config.terms_hash);
      } else if (state.step === 'details') {
        content = '<fieldset class="psc-r-categories"><legend>' + escape(tr('Researcher type')) + '</legend><div>';
        Object.keys(labels).forEach(function (category) {
          content += '<label class="psc-r-category"><input type="radio" name="psc_research_category" value="' + category + '"' + (state.category === category ? ' checked' : '') + (state.busy ? ' disabled' : '') + '><span><i class="psc-r-category-icon psc-r-icon-' + category + '" aria-hidden="true"></i>' + escape(labels[category]) + '</span></label>';
        });
        content += '</div></fieldset>';
        if (state.category !== 'independent') {
          content += textInput('psc-research-organization', tr('Find your organization'), state.query, 'search');
          content += '<div id="psc-research-organizations" class="psc-r-organizations" aria-live="polite">' + searchMarkup() + '</div>';
        }
        if (state.authMode === 'email' || !googleAvailable()) {
          content += textInput('psc-research-name', tr('Your name'), state.name, 'text', 'name');
          content += textInput('psc-research-email', tr('Email address'), state.email, 'email', 'email');
        } else if (state.googleIdentity) {
          content += '<div class="psc-r-identity"><strong>' + escape(state.name || tr('Google account')) + '</strong><span>' + escape(state.email) + '</span>' + button('edit-identity', tr('Edit details'), false) + '</div>';
          if (!state.name.trim()) content += textInput('psc-research-name', tr('Your name'), state.name, 'text', 'name');
        }
        if (state.authMode === 'email' || state.category !== 'independent') content += '<p id="psc-research-domain" class="psc-r-hint">' + escape(currentDomainNotice()) + '</p>';
        if (state.category !== 'independent') content += button('independent', tr('Working independently? Select Independent'), false);
        content += '<div class="psc-r-agreement"><details id="psc-research-agreement"' + (state.agreementOpen ? ' open' : '') + '><summary><span>' + escape(tr('Researcher Agreement')) + '</span><span class="psc-r-agreement-hint">' + escape(state.agreementOpen ? tr('Click to close') : tr('Click to read')) + '</span></summary><div class="psc-r-agreement-text" role="region" aria-label="' + escape(tr('Researcher Agreement terms')) + '" tabindex="0">' + agreementMarkup() + '</div></details>';
        content += '<label class="psc-r-check psc-r-details-attestation"><input id="psc-research-details-attestation" type="checkbox"' + (detailsConfirmed() ? ' checked' : '') + (state.busy || !agreementReady ? ' disabled' : '') + '><span>' + escape(tr('I agree')) + '</span></label></div>';
        content += rememberChoice();
        if (googleAvailable() && state.authMode === 'google' && !hasProof()) {
          content += googleButton();
          content += '<div class="psc-r-actions">' + button('back', tr('Back'), false) + button('use-email', tr('Use email instead'), false) + '</div>';
        } else {
          content += button('send', state.busy ? tr('Please wait…') : hasProof() ? tr('Save and continue') : tr('Send verification code'), true, !detailsValid() || !detailsConfirmed());
          content += '<div class="psc-r-actions">' + button('back', tr('Back'), false);
          if (googleAvailable()) content += button('use-google', state.googleIdentity ? tr('Use another Google account') : tr('Continue with Google'), false);
          content += '</div>';
        }
      } else if (state.step === 'code') {
        content = '<p class="psc-r-intro">' + escape(tr('Enter the six-digit code sent to your inbox.')) + '</p><div class="psc-r-delivery"><span>' + escape(state.challengeEmail) + '</span>' + button('back', tr('Change'), false) + '</div>';
        content += '<label class="psc-r-field psc-r-code-field" for="psc-research-code"><span>' + escape(tr('Verification code')) + '</span><input id="psc-research-code" type="text" inputmode="numeric" autocomplete="one-time-code" enterkeyhint="done" aria-describedby="psc-research-expiry" maxlength="6" pattern="[0-9]{6}" value="' + escape(state.code) + '"' + (state.busy ? ' disabled' : '') + '></label><p class="psc-r-hint" id="psc-research-expiry"></p>';
        content += rememberChoice();
        content += button('verify', state.busy ? tr('Confirming…') : hasProof() ? tr('Save and continue') : tr('Confirm and continue'), true, !hasProof() && !/^\d{6}$/.test(state.code));
        content += '<div class="psc-r-resend"><span>' + escape(tr('Didn’t receive it?')) + '</span>' + button('resend', tr('Resend code'), false) + '</div>';
      } else {
        content = '<div class="psc-r-recognized"><span class="psc-r-checkmark" aria-hidden="true">✓</span><div><strong>' + escape(state.name) + '</strong><span>' + escape(state.email) + '</span><span>' + escape(labels[state.category]) + (state.organization ? ' · ' + escape(state.organization.name) : '') + '</span></div></div>';
        if (config.verification_only) content += '<p class="psc-r-development">' + escape(tr('Payments are not enabled in this development build.')) + '</p>';
        content += button('edit', tr('Edit details'), false);
      }
      var stepIndex = ['gate', 'details', 'code', 'complete'].indexOf(state.step);
      var progress = [tr('Declarations'), tr('Your details'), tr('Confirmation')].map(function (label, index) {
        return '<li class="' + (index < stepIndex ? 'is-done' : index === stepIndex ? 'is-current' : '') + '"' + (index === stepIndex ? ' aria-current="step"' : '') + '><span class="psc-r-step-number" aria-hidden="true">' + (index < stepIndex ? '✓' : index + 1) + '</span><span>' + escape(label) + '</span></li>';
      }).join('');
      var heading = state.step === 'details' ? '' : '<h2 id="psc-research-heading" tabindex="-1">' + escape(titles[state.step]) + '</h2>';
      app.innerHTML = '<div class="psc-r-shell"><header class="psc-r-header"><img class="psc-r-wordmark" src="' + escape(state.theme === 'dark' ? config.wordmark_url_dark : config.wordmark_url_light) + '" alt="PRISM" width="160" height="29"><button type="button" data-action="help" class="psc-r-help-trigger" aria-haspopup="dialog" aria-controls="psc-research-help"><span aria-hidden="true">?</span>' + escape(tr('Need help')) + '</button></header><div class="psc-r-body">' + (state.step === 'checking' ? '' : '<ol class="psc-r-progress" aria-label="' + escape(tr('Verification progress')) + '">' + progress + '</ol>') + heading + '<div id="psc-research-message" class="psc-r-message' + (state.error ? ' psc-r-error' : '') + '" role="' + (state.error ? 'alert' : 'status') + '"' + (!state.message ? ' hidden' : '') + '>' + escape(state.message) + '</div>' + content + '</div><footer class="psc-r-footer"><span>' + escape(tr('Research use only')) + '</span><span>' + escape(tr('Powered by PRISM')) + '</span></footer></div>';
      updateDeclarations();
      updateControls();
      if (clockTimer) clearInterval(clockTimer);
      if (state.step === 'code') { updateClock(); clockTimer = setInterval(updateClock, 1000); }
      if (focus && !help.open && state.step === 'complete') focusCheckout();
      else if (focus && !help.open) (state.step === 'details' ? app.querySelector('[name="psc_research_category"]:checked') : field(state.step === 'code' ? 'psc-research-code' : 'psc-research-heading')).focus({ preventScroll: true });
    }
    function googleButton() {
      return '<button type="button" data-action="google" class="psc-r-button psc-r-primary psc-r-google"' + (state.busy || !googleValid() ? ' disabled' : '') + '><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.01v2.5h3.23c1.89-1.74 2.99-4.31 2.99-7.34Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.61-2.43l-3.23-2.5c-.9.6-2.04.97-3.38.97-2.6 0-4.8-1.76-5.59-4.12H3.07v2.58A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.41 13.92A6 6 0 0 1 6.1 12c0-.67.11-1.31.31-1.92V7.5H3.07A10 10 0 0 0 2 12c0 1.61.39 3.13 1.07 4.5l3.34-2.58Z"/><path fill="#EA4335" d="M12 5.96c1.47 0 2.79.5 3.82 1.49l2.86-2.86A9.57 9.57 0 0 0 12 2a10 10 0 0 0-8.93 5.5l3.34 2.58A5.99 5.99 0 0 1 12 5.96Z"/></svg><span>' + escape(state.busy ? tr('Connecting…') : tr('Continue with Google')) + '</span></button>';
    }
    function searchMarkup() {
      if (state.organization) return '<p class="psc-r-selected"><strong>' + escape(state.organization.name) + '</strong><span>' + escape(domains().join(', ')) + '</span></p>';
      if (state.searchBusy) return '<p class="psc-r-hint">' + escape(tr('Searching organizations…')) + '</p>';
      if (state.searchMessage) return '<p class="psc-r-hint">' + escape(state.searchMessage) + '</p>';
      return state.organizations.map(function (organization, index) { return '<button type="button" data-organization="' + index + '"><strong>' + escape(organization.name) + '</strong><span>' + escape((organization.domains || []).join(', ')) + '</span></button>'; }).join('');
    }
    function updateClock() {
      var remaining = Math.max(0, Math.ceil((Date.parse(state.challengeExpires) - Date.now()) / 1000));
      var target = field('psc-research-expiry');
      if (!target) return;
      target.textContent = remaining > 0 ? tr('Code expires in ') + Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0') : tr('This code has expired. Request a new code to continue.');
      var verify = root.querySelector('[data-action="verify"]');
      if (verify) verify.disabled = state.busy || (!hasProof() && (!remaining || !/^\d{6}$/.test(state.code)));
    }
    function updateControls() {
      var send = root.querySelector('[data-action="send"]');
      if (send) { send.disabled = state.busy || (state.accepted && (!detailsValid() || !detailsConfirmed())); send.textContent = !state.accepted ? tr('Review declarations') : hasProof() ? tr('Save and continue') : tr('Send verification code'); }
      var google = root.querySelector('[data-action="google"]');
      if (google) {
        google.disabled = state.busy || (state.accepted && !googleValid());
        var title = google.querySelector('span');
        if (title) title.textContent = !state.accepted ? tr('Review declarations') : state.busy ? tr('Connecting…') : tr('Continue with Google');
      }
      var declaration = field('psc-research-details-attestation');
      if (declaration) declaration.checked = !!detailsConfirmed();
      var notice = field('psc-research-domain');
      if (notice) notice.textContent = currentDomainNotice();
    }
    function searchOrganizations() {
      var revision = ++state.searchRevision;
      var query = state.query.trim();
      var result = field('psc-research-organizations');
      state.organizations = []; state.searchMessage = ''; state.searchBusy = query.length >= 2;
      if (query.length < 2) state.searchMessage = tr('Enter at least two characters to search.');
      if (result) result.innerHTML = searchMarkup();
      if (query.length < 2) return;
      post('psc_research_organizations', { query: query, category: state.category }).then(function (data) {
        if (revision !== state.searchRevision) return;
        state.organizations = Array.isArray(data.organizations) ? data.organizations : [];
        state.searchBusy = false;
        if (!state.organizations.length) state.searchMessage = tr('No matching organization with known email domains was found. Try another name or check your researcher category.');
        var target = field('psc-research-organizations');
        if (target) target.innerHTML = searchMarkup();
      }).catch(function (error) {
        if (revision !== state.searchRevision) return;
        state.searchBusy = false; state.searchMessage = error.message;
        var target = field('psc-research-organizations');
        if (target) target.innerHTML = searchMarkup();
      });
    }
    async function syncBilling() {
      var revision = state.revision;
      var parts = state.name.trim().split(/\s+/);
      var values = { email: state.email.trim(), first_name: parts.shift() || '', last_name: parts.join(' ') };
      if (config.order_pay) return;
      var cart = cartAccess('dispatch');
      syncingBilling = true;
      try {
        // Woo's cart store owns Blocks billing data; DOM changes alone are not persisted.
        // https://developer.woocommerce.com/docs/block-development/reference/data-store/cart/
        if (document.querySelector('.wp-block-woocommerce-checkout') && cart && cart.updateCustomerData) {
          var next = Object.assign({}, billing(), values);
          await cart.updateCustomerData({ billing_address: next }, false);
          if (revision === state.revision && cart.setBillingAddress) cart.setBillingAddress(next);
        } else {
          Object.keys(values).forEach(function (name) {
            var target = document.querySelector('[name="billing_' + name + '"]');
            if (target && target.value !== values[name]) { target.value = values[name]; target.dispatchEvent(new Event('change', { bubbles: true })); }
          });
        }
      } finally { syncingBilling = false; }
    }
    async function saveRecord() {
      if (state.declarationsSourceId && !savedDeclarationsReady()) {
        clearDeclarationReuse(true);
        var changed = new Error(tr('Review the declarations for your updated details.'));
        changed.code = 'declarations_required'; throw changed;
      }
      if (!state.accepted || !detailsValid() || !detailsConfirmed() || !hasProof()) throw new Error(tr('Confirm your current details and email before continuing.'));
      var revision = state.revision;
      if (!state.requestId) state.requestId = uuid();
      await invalidation;
      await syncBilling();
      if (revision !== state.revision) return;
      var payload = {
        request_id: state.requestId, name: state.name.trim(), email: state.email.trim(), category: state.category,
        terms_version: config.terms_version, terms_hash: config.terms_hash,
        organization_id: state.organization ? state.organization.id : '', declarations: JSON.stringify(state.declarations),
        details_attestation: JSON.stringify(state.declarationsSourceId ? { record_id: state.declarationsSourceId }
          : state.detailsAccepted ? { accepted: true, version: detailsVersion } : { record_id: state.detailsRecordId })
      };
      if (state.declarationsSourceId) {
        payload.declarations_source_record_id = state.declarationsSourceId;
        payload.declarations_accepted_at = state.declarationsAcceptedAt;
      }
      var response = await post('psc_research_save', payload);
      if (revision !== state.revision) return;
      if (!response.record || !response.record.id || !response.record.digest) throw new Error(tr('The verification record could not be confirmed. Please try again.'));
      state.record = response.record; state.step = 'complete'; state.renewal = false; message('');
      state.detailsAccepted = false; state.detailsRecordId = state.record.id;
      state.profileEdits = { name: false, email: false, category: false, organization: false };
      state.declarationsChoiceMade = false; state.automaticReuseBlocked = false;
      clearDeclarationReuse(false);
      rememberDeclarations(state.record);
      root.dispatchEvent(new CustomEvent('psc:research-saved', { bubbles: true, detail: status() }));
    }
    async function sendCode() {
      if (!detailsValid() || !detailsConfirmed()) throw new Error(tr('Check your details and accept the Researcher Agreement.'));
      var response = await post('psc_otp_challenge', { email: state.email.trim() });
      if (!response.challenge_id || response.dispatch_state === 'reserved') throw new Error(tr('The email could not be sent. Please try again.'));
      state.challenge = response.challenge_id; state.challengeExpires = response.expires_at; state.challengeEmail = state.email.trim(); state.code = ''; state.step = 'code';
      message(response.dispatch_state === 'ambiguous' ? tr('We could not confirm delivery. Check your inbox, then use Resend if needed.') : '');
    }
    async function startGoogle() {
      if (!state.googleEnabled || !googleValid()) throw new Error(tr('Select your researcher type and accept the Researcher Agreement.'));
      if (!state.googleRequestId) state.googleRequestId = uuid();
      var response = await post('psc_google_start', {
        request_id: state.googleRequestId, checkout_url: config.checkout_url || window.location.origin + window.location.pathname + (config.order_pay ? window.location.search : ''),
        draft: JSON.stringify({ name: state.name, email: state.email, category: state.category, organization: state.organization ? Object.assign({}, state.organization, { domains: domains() }) : null,
          terms_version: config.terms_version, terms_hash: config.terms_hash,
          declarations: state.declarations, details_attestation: state.detailsAccepted ? { accepted: true, version: detailsVersion } : { record_id: state.detailsRecordId },
          declarations_source_record_id: state.declarationsSourceId || undefined, declarations_accepted_at: state.declarationsSourceId ? state.declarationsAcceptedAt : undefined,
          profileEdits: state.profileEdits, remember: state.remember })
      });
      if (!response.url || new URL(response.url).protocol !== 'https:') throw new Error(tr('Google sign-in could not start. Use email instead or try again.'));
      window.location.assign(response.url);
    }
    async function act(action) {
      if (state.busy) return;
      if ((action === 'send' || action === 'google') && !state.accepted) {
        state.step = 'gate'; message(tr('Review the declarations for your updated details.')); render(true); return;
      }
      if (action === 'use-email' || action === 'edit-identity') { state.authMode = 'email'; message(''); render(true); return; }
      if (action === 'use-google') {
        if (!googleAvailable()) return;
        state.authMode = 'google'; state.googleIdentity = false; state.verifiedEmail = ''; state.proofExpires = ''; state.record = null; state.requestId = ''; state.googleRequestId = ''; state.rememberedContext = false;
        message(''); render(true); return;
      }
      if (action === 'back' || action === 'edit') {
        if (action === 'edit') { revokePayment(); state.authMode = 'email'; state.record = null; state.requestId = ''; state.rememberedContext = false; }
        state.step = state.step === 'details' ? 'gate' : 'details'; message(''); render(true); return;
      }
      if (action === 'independent') { state.profileEdits.category = true; invalidate(false); state.category = 'independent'; state.organization = null; state.query = ''; state.searchRevision += 1; render(); return; }
      state.busy = true; message(''); render();
      try {
        if (action === 'continue') {
          if (!allDeclarations(state.declarations) || !config.terms_version || !config.terms_hash) throw new Error(tr('Accept all three declarations to continue.'));
          state.accepted = true;
          await hydration;
          if ((state.rememberedContext || state.renewal) && hasProof() && detailsValid() && detailsConfirmed()) await saveRecord();
          else state.step = 'details';
        } else if (action === 'google') await startGoogle();
        else if (action === 'send') {
          if (hasProof()) await saveRecord(); else await sendCode();
        } else if (action === 'resend') await sendCode();
        else if (action === 'verify') {
          if (!hasProof() && (!/^\d{6}$/.test(state.code) || Date.parse(state.challengeExpires) <= Date.now())) throw new Error(tr('Enter a current six-digit code.'));
          if (!hasProof()) {
            var response = await post('psc_otp_verify', { challenge_id: state.challenge, code: state.code, remember_device: state.remember ? '1' : '' });
            if (emailKey(response.email) !== emailKey(state.email)) throw new Error(tr('The confirmed email does not match your current details.'));
            state.verifiedEmail = emailKey(response.email); state.proofExpires = response.expires_at || ''; state.remembered = !!response.remembered; state.googleIdentity = false;
            restoreProfile(response.researcher);
          }
          if (!state.accepted) { state.step = 'gate'; message(tr('Review the declarations to continue.')); }
          else if (detailsConfirmed()) await saveRecord();
          else { state.step = 'details'; message(tr('Accept the Researcher Agreement to continue.')); }
        }
      } catch (error) { failed(error); }
      finally { state.busy = false; render(true); }
    }
    function setRemember(remember) {
      state.remember = remember;
      state.googleRequestId = '';
      var choice = field('psc-research-remember');
      if (choice) choice.checked = remember;
      if (hasProof() && state.remember !== state.remembered) {
        state.verifiedEmail = ''; state.proofExpires = ''; state.record = null; state.requestId = ''; state.rememberedContext = false; state.revision += 1;
        state.step = 'details'; message(tr('Confirm your account to update your device preference.')); render();
      } else updateControls();
    }
    root.addEventListener('toggle', function (event) {
      if (event.target.id === 'psc-research-agreement') {
        state.agreementOpen = event.target.open;
        var hint = event.target.querySelector('.psc-r-agreement-hint');
        if (hint) hint.textContent = state.agreementOpen ? tr('Click to close') : tr('Click to read');
      }
    }, true);
    root.addEventListener('click', function (event) {
      // Clicking an already-selected category is still an intentional choice.
      if (event.target.closest('.psc-r-category')) state.profileEdits.category = true;
      var target = event.target.closest('button');
      if (!target || !root.contains(target)) return;
      if (target.dataset.action === 'help') { openHelp(); return; }
      if (target.dataset.action === 'close-help') { help.close(); return; }
      if (target.dataset.organization != null) {
        state.profileEdits.organization = true; invalidate(false); state.organization = state.organizations[Number(target.dataset.organization)]; state.query = state.organization.name; render(); return;
      }
      if (target.dataset.action) act(target.dataset.action);
    });
    root.addEventListener('input', function (event) {
      var target = event.target;
      if (target.id === 'psc-research-name') { state.profileEdits.name = true; state.name = target.value; invalidate(false); updateControls(); }
      else if (target.id === 'psc-research-email') { var changed = emailKey(target.value) !== emailKey(state.email); state.profileEdits.email = true; state.email = target.value; invalidate(changed); updateControls(); }
      else if (target.id === 'psc-research-code') { state.code = target.value.replace(/\D/g, '').slice(0, 6); target.value = state.code; updateClock(); }
      else if (target.id === 'psc-research-organization') {
        state.profileEdits.organization = true; state.query = target.value; state.organization = null; state.organizations = []; invalidate(false); state.searchRevision += 1; updateControls(); clearTimeout(searchTimer); searchTimer = setTimeout(searchOrganizations, 250);
      }
    });
    root.addEventListener('change', function (event) {
      var target = event.target;
      if (target.id === 'psc-research-check-all' || target.dataset.declaration) {
        clearDeclarationReuse(false); state.declarationsChoiceMade = true;
        if (target.id === 'psc-research-check-all') Object.keys(state.declarations).forEach(function (key) { state.declarations[key] = target.checked; });
        else state.declarations[target.dataset.declaration] = target.checked;
        state.accepted = false; state.record = null; state.requestId = '';
        updateDeclarations();
      } else if (target.name === 'psc_research_category') {
        state.profileEdits.category = true; state.category = target.value; state.organization = null; state.organizations = []; state.query = ''; state.searchMessage = ''; state.searchRevision += 1; invalidate(false); render();
      } else if (target.id === 'psc-research-details-attestation') {
        clearDeclarationReuse(true);
        state.detailsAccepted = target.checked; state.detailsRecordId = ''; state.record = null; state.requestId = ''; state.revision += 1; state.rememberedContext = false;
        state.googleRequestId = '';
        if (target.checked) setRemember(true); else updateControls();
      } else if (target.id === 'psc-research-remember') {
        setRemember(target.checked);
      }
    });
    root.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' || event.target.tagName !== 'INPUT' || event.target.type === 'checkbox' || event.target.type === 'radio' || event.target.id === 'psc-research-organization') return;
      event.preventDefault();
      if (event.target.id === 'psc-research-name' && field('psc-research-email')) { field('psc-research-email').focus(); return; }
      var next = root.querySelector('.psc-r-primary');
      if (next && !next.disabled) next.click();
    });
    // 0.1.3.1: billing edits after "Verified" (Apex Amino report, 2026-09-12).
    // The previous document-level 'input' listener revoked the research record on
    // every keystroke in billing_first_name / billing_last_name / billing_email and
    // threw the buyer back to "Your details" mid-typing.
    // - Email is the verified identity: a COMMITTED change ('change', i.e. leaving the
    //   field) that differs from the attested email still requires a fresh confirmation.
    // - Name is not the verified identity: editing the billing name no longer revokes
    //   the record or reopens the gate. The edit is kept in state so a later billing
    //   sync does not overwrite it. The saved research record keeps the attested name.
    // - Scoped to the checkout form so an unrelated input#email cannot trip it.
    var checkoutScope = 'form.checkout, form#order_review, .wp-block-woocommerce-checkout';
    var nameKey = function (value) { return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase(); };
    document.addEventListener('change', function (event) {
      var target = event.target;
      if (syncingBilling || !target || root.contains(target) || typeof target.closest !== 'function' || !target.closest(checkoutScope)) return;
      if (target.name === 'billing_email' || target.id === 'email' || target.id === 'billing-email') {
        if (emailKey(target.value) === emailKey(state.email)) return;
        state.profileEdits.email = true; state.email = target.value; invalidate(true);
        if (state.step !== 'gate') { state.step = 'details'; state.authMode = 'email'; }
        message(tr('Confirm your updated email to continue.')); render();
      } else if (/^billing_(first_name|last_name)$/.test(target.name)) {
        var contact = billing();
        var nextName = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
        if (nameKey(nextName) === nameKey(state.name)) return;
        // Keep the buyer's billing name; do not invalidate, change step or re-render.
        state.profileEdits.name = true; state.name = nextName;
      }
    });
    async function resumeGoogle(resume) {
      var draft = resume && resume.draft;
      if (!draft || !labels[draft.category]) return false;
      var currentTerms = draft.terms_version === config.terms_version && draft.terms_hash === config.terms_hash;
      var usedSavedDeclarations = !!draft.declarations_source_record_id;
      state.step = 'details'; state.authMode = state.googleEnabled ? 'google' : 'email';
      state.name = draft.name || ''; state.email = draft.email || ''; state.category = draft.category;
      state.organization = draft.organization || null; state.query = state.organization ? state.organization.name : '';
      clearDeclarationReuse(false);
      state.accepted = currentTerms && !usedSavedDeclarations && allDeclarations(draft.declarations);
      state.declarations = { age: state.accepted, research: state.accepted, terms: state.accepted };
      // A saved draft is only a reference. Restore acceptance from the newly
      // authenticated account's matching history, never from draft booleans.
      state.declarationsChoiceMade = !usedSavedDeclarations || !currentTerms;
      state.remember = !!draft.remember;
      state.profileEdits = Object.assign({ name: false, email: false, category: false, organization: false }, draft.profileEdits || {});
      state.detailsAccepted = currentTerms && !usedSavedDeclarations && !!(draft.details_attestation && draft.details_attestation.accepted && draft.details_attestation.version === detailsVersion);
      state.detailsRecordId = currentTerms && !usedSavedDeclarations && draft.details_attestation && draft.details_attestation.record_id || '';
      state.requestId = resume.request_id || '';
      var identity = resume.identity;
      if (!identity) {
        if (!state.accepted) state.step = 'gate';
        message(resume.message || tr('Google sign-in was not completed. Try again or use email instead.'), true); return true;
      }
      if (emailKey(state.email) !== emailKey(identity.email)) state.detailsRecordId = '';
      state.email = identity.email; state.googleIdentity = true;
      // An empty draft is not a name override; allow the authenticated name to fill it.
      if (!state.name.trim()) state.profileEdits.name = false;
      if (!state.profileEdits.name) state.name = identity.name || state.name;
      if (identity.requires_email_confirmation) {
        state.authMode = 'email';
        if (!state.accepted) state.step = 'gate';
        message(tr('Confirm this email with a code to continue.'));
        return true;
      }
      state.verifiedEmail = emailKey(identity.email); state.proofExpires = identity.expires_at || ''; state.remembered = !!identity.remembered;
      var freshlyAccepted = state.detailsAccepted;
      restoreProfile(identity.researcher);
      // Google supplies identity automatically; only deliberate profile edits reset fresh assent.
      if (freshlyAccepted) { state.detailsAccepted = true; state.detailsRecordId = ''; }
      if (!state.accepted) {
        state.step = 'gate';
        message(currentTerms ? tr('Review the declarations for this account to continue.') : tr('The terms have changed. Review the current declarations to continue.'));
      } else if (detailsValid() && detailsConfirmed() && hasProof()) await saveRecord();
      else if (!detailsValid()) message(state.category !== 'independent' && state.organization ? currentDomainNotice() : tr('Add the missing information to continue.'));
      else message(tr('Accept the Researcher Agreement to continue.'));
      return true;
    }
    state.busy = true;
    render();
    var startRevision = state.revision;
    var hydration = bootstrap().then(async function (data) {
      state.googleEnabled = data.google_enabled === true;
      state.authMode = state.googleEnabled ? 'google' : 'email';
      if (data.resume && await resumeGoogle(data.resume)) return;
      var requestedEmail = emailKey(state.email);
      var response = await post('psc_device_hydrate', { email: state.email.trim() });
      // F4: never hide email controls or overwrite edits for a late, mismatched grant.
      if (!response.remembered || !response.email || startRevision !== state.revision) return;
      var next = emailKey(response.email);
      if (requestedEmail && requestedEmail !== next || emailKey(state.email) && emailKey(state.email) !== next) return;
      state.email = response.email; state.verifiedEmail = next; state.proofExpires = response.expires_at || ''; state.remembered = true;
      restoreProfile(response.researcher);
      // Keep the displayed identity and Woo identity aligned only after validating the grant.
      if (savedDeclarationsReady() && hasProof() && detailsValid() && detailsConfirmed()) await saveRecord();
      else await syncBilling();
    }).catch(failed).finally(function () {
      state.busy = false;
      if (state.step === 'checking') state.step = 'gate';
      render();
    });
  }
  function init() { document.querySelectorAll('#psc-research-checkout').forEach(mount); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  if (window.jQuery) window.jQuery(document.body).on('updated_checkout.pscResearch', init);
})();
