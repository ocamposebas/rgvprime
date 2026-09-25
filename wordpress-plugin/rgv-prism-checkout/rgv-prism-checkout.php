<?php
/**
 * Plugin Name: RGV Storefront Card & Wallet Return
 * Description: Provides a closed, branded card and wallet checkout handoff for the RGVPRIME storefront.
 * Version: 3.7.3
 * Author: RGVPRIME LLC
 * Requires at least: 6.5
 * Requires PHP: 8.1
 * WC requires at least: 8.5
 * WC tested up to: 10.9
 */

defined('ABSPATH') || exit;

final class RGV_Storefront_Card_Wallet_Return {
  const VERSION = '3.7.3';
  const PAYMENT_METHOD = 'psc';

  public function __construct() {
    add_filter('woocommerce_gateway_title', [$this, 'gateway_title'], 100, 2);
    add_filter('woocommerce_gateway_description', [$this, 'gateway_description'], 100, 2);
    add_filter('woocommerce_order_get_payment_method_title', [$this, 'order_payment_title'], 100, 2);
    add_filter('woocommerce_order_item_name', [$this, 'order_item_name_with_image'], 100, 3);
    add_filter('woocommerce_available_payment_gateways', [$this, 'card_gateway_only'], 1000);
    add_filter('option_woocommerce_psc_settings', [$this, 'force_dark_gateway_theme'], 100);
    add_filter('gettext', [$this, 'neutral_frontend_copy'], 100, 3);
    add_filter('woocommerce_order_get_customer_id', [$this, 'allow_bearer_payment_session'], 1000, 2);
    add_filter('body_class', [$this, 'payment_page_body_class'], 100);
    add_filter('woocommerce_locate_template', [$this, 'locate_storefront_template'], 100, 3);
    add_action('template_redirect', [$this, 'restrict_public_wordpress_navigation'], 1);
    add_action('wp_enqueue_scripts', [$this, 'enqueue_storefront_checkout'], 100);
    add_action('wp_body_open', [$this, 'render_payment_nav'], 5, 0);
    add_action('before_woocommerce_pay_form', [$this, 'render_payment_header'], 5, 0);
    add_action('woocommerce_thankyou', [$this, 'return_paid_storefront_order'], 1000);
  }

  public function locate_storefront_template($template, $template_name, $template_path) {
    if ('checkout/form-pay.php' !== (string) $template_name || !$this->is_storefront_payment_request()) {
      return $template;
    }

    $storefront_template = plugin_dir_path(__FILE__) . 'templates/checkout/form-pay.php';
    return is_readable($storefront_template) ? $storefront_template : $template;
  }

  public function gateway_title($title, $gateway_id) {
    return self::PAYMENT_METHOD === (string) $gateway_id ? 'Secure card payment' : $title;
  }

  public function gateway_description($description, $gateway_id) {
    if (self::PAYMENT_METHOD !== (string) $gateway_id) {
      return $description;
    }

    return 'Enter your card details below. Your payment is encrypted and processed securely.';
  }

  public function card_gateway_only($gateways) {
    if (!$this->is_storefront_payment_request() || !is_array($gateways) || !isset($gateways[self::PAYMENT_METHOD])) {
      return $gateways;
    }

    return [self::PAYMENT_METHOD => $gateways[self::PAYMENT_METHOD]];
  }

  public function force_dark_gateway_theme($settings) {
    if ($this->is_storefront_payment_request() && is_array($settings)) {
      $settings['theme'] = 'dark';
    }

    return $settings;
  }

  public function order_payment_title($title, $order) {
    if ($order instanceof WC_Order && self::PAYMENT_METHOD === $order->get_payment_method()) {
      return 'Secure card payment';
    }

    return $title;
  }

  public function order_item_name_with_image($name, $item, $is_visible) {
    if (
      !$this->is_storefront_payment_request() ||
      !$item instanceof WC_Order_Item_Product ||
      false !== strpos((string) $name, 'rgv-order-summary__thumb')
    ) {
      return $name;
    }

    $product = $item->get_product();
    if (!$product instanceof WC_Product) {
      return $name;
    }

    $image_id = (int) $product->get_image_id();
    if (!$image_id && $product->get_parent_id()) {
      $image_id = (int) get_post_thumbnail_id($product->get_parent_id());
    }

    $attributes = [
      'class' => 'rgv-order-summary__product-image',
      'alt' => '',
      'loading' => 'eager',
      'decoding' => 'async',
    ];
    $image = $image_id
      ? wp_get_attachment_image($image_id, 'woocommerce_thumbnail', false, $attributes)
      : wc_placeholder_img('woocommerce_thumbnail', $attributes);

    if (!$image) {
      return $name;
    }

    return '<span class="rgv-order-summary__thumb" aria-hidden="true">' . $image . '</span>' .
      '<span class="rgv-order-summary__product-title">' . $name . '</span>';
  }

  public function allow_bearer_payment_session($customer_id, $order) {
    if (
      (int) $customer_id < 1 ||
      !$order instanceof WC_Order ||
      $this->payment_request_order_id() !== (int) $order->get_id()
    ) {
      return $customer_id;
    }

    $provided_key = $this->payment_request_order_key();
    if (
      $provided_key &&
      $this->is_storefront_card_wallet_order($order) &&
      hash_equals((string) $order->get_order_key(), (string) $provided_key)
    ) {
      // Present the signed request as belonging to the active WordPress user,
      // or as a guest when no WordPress session exists. This is request-only;
      // the persisted customer remains intact for history and rewards.
      return (int) get_current_user_id();
    }

    return $customer_id;
  }

  public function neutral_frontend_copy($translated, $original, $domain) {
    if (is_admin() || 'prism-simple-checkout' !== $domain || false === stripos((string) $translated, 'prism')) {
      return $translated;
    }

    $copy = str_ireplace(
      ['PRISM Secure Checkout', 'PRISM Fall Checkout', 'Powered by PRISM', 'PRISM research verification', 'Loading PRISM verification'],
      ['Card payment', 'Card payment', 'Card payment', 'Research verification', 'Loading verification'],
      (string) $translated
    );

    return preg_replace('/\bPRISM\b/i', 'payment', $copy);
  }

  public function enqueue_storefront_checkout() {
    if (!$this->is_checkout_surface()) {
      return;
    }

    $provider_neutralizer = '
      img[src*="prism-wordmark"],
      .psc-blocks-label img[alt="PRISM"] {
        display: none !important;
      }
    ';

    foreach (['psc-research-checkout', 'psc-checkout'] as $handle) {
      if (wp_style_is($handle, 'enqueued')) {
        wp_add_inline_style($handle, $provider_neutralizer);
      }
    }

    if ($this->is_storefront_receipt_request()) {
      wp_register_style('rgv-card-wallet-receipt', false, [], self::VERSION);
      wp_enqueue_style('rgv-card-wallet-receipt');
      wp_add_inline_style('rgv-card-wallet-receipt', $provider_neutralizer . $this->thankyou_page_css());
      return;
    }

    if (!$this->is_storefront_payment_request()) {
      return;
    }

    wp_enqueue_style(
      'rgv-order-pay',
      plugins_url('assets/css/order-pay.css', __FILE__),
      [],
      self::VERSION
    );

    // The connected account may have several Stripe methods enabled. Keep the
    // hosted form limited to cards, eligible card wallets, and US bank accounts.
    // Run before the provider initializes Elements so there is no tab reflow.
    $card_only_script = <<<'JS'
(function () {
  if (window.__rgvCardOnlyStripeGuard) return;
  window.__rgvCardOnlyStripeGuard = true;

  function gestureSubmitBridge(elements) {
    if (!elements || typeof elements.submit !== 'function') return null;

    var originalSubmit = elements.submit.bind(elements);
    var pending = null;

    function remember(promise) {
      var guarded = Promise.resolve(promise);
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

  function wrapStripeFactory(originalStripe) {
    if (typeof originalStripe !== 'function' || originalStripe.__rgvCardOnlyFactory) return originalStripe;

    var wrappedStripe = function () {
      var stripeClient = originalStripe.apply(null, arguments);
    if (!stripeClient || typeof stripeClient.elements !== 'function') {
      return stripeClient;
    }

    var originalElements = stripeClient.elements.bind(stripeClient);
    var guardedElements = function (options) {
      var elementsOptions = Object.assign({}, options || {}, { paymentMethodTypes: ['card', 'us_bank_account'] });
      var originalAppearance = options && options.appearance ? options.appearance : {};
      elementsOptions.appearance = Object.assign({}, originalAppearance, {
        theme: 'night',
        variables: Object.assign({}, originalAppearance.variables || {}, {
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSizeBase: '15px',
          borderRadius: '12px',
          spacingUnit: '5px',
          colorPrimary: '#9d4146',
          colorBackground: '#101114',
          colorText: '#ededeb',
          colorTextSecondary: '#9698a1',
          colorDanger: '#ef7379'
        }),
        rules: Object.assign({}, originalAppearance.rules || {}, {
          '.Input': {
            padding: '14px',
            border: '1px solid #343840',
            boxShadow: 'none'
          },
          '.Input:focus': {
            border: '1px solid #9d4146',
            boxShadow: '0 0 0 1px #9d4146'
          },
          '.Label': {
            color: '#d8d9dc',
            fontSize: '13px',
            fontWeight: '600'
          }
        })
      });

      var elements = originalElements(elementsOptions);
      if (!elements || typeof elements.create !== 'function') return elements;

      var submitBridge = gestureSubmitBridge(elements);

      var originalCreate = elements.create.bind(elements);
      var guardedCreate = function (type, elementOptions) {
        if (type === 'expressCheckout') {
          throw new Error('Express checkout is disabled for this card-only storefront flow.');
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
          wallets: { applePay: 'auto', googlePay: 'auto', link: 'auto' }
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
          if (property === '__rgvCardOnlyElements') return true;
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
    try { Object.defineProperty(wrappedStripe, '__rgvCardOnlyFactory', { value: true }); } catch (error) { /* Optional marker. */ }
    return wrappedStripe;
  }

  function patchController() {
    var controller = window.PSCCheckoutController;
    if (!controller || controller.__rgvCardOnlyOptions || typeof controller.paymentElementOptions !== 'function') return false;
    var originalOptions = controller.paymentElementOptions.bind(controller);
    controller.paymentElementOptions = function (options) {
      return Object.assign({}, originalOptions(options) || {}, {
        layout: {
          type: 'accordion',
          defaultCollapsed: false,
          radios: false,
          spacedAccordionItems: false
        },
        paymentMethodOrder: ['card', 'us_bank_account'],
        wallets: { applePay: 'auto', googlePay: 'auto', link: 'auto' }
      });
    };
    controller.__rgvCardOnlyOptions = true;
    return true;
  }

  var stripeFactory = typeof window.Stripe === 'function' ? wrapStripeFactory(window.Stripe) : window.Stripe;
  if (typeof stripeFactory === 'function') {
    window.Stripe = stripeFactory;
    window.__rgvCardOnlyStripe = true;
  } else {
    try {
      Object.defineProperty(window, 'Stripe', {
        configurable: true,
        enumerable: true,
        get: function () { return stripeFactory; },
        set: function (nextFactory) {
          stripeFactory = wrapStripeFactory(nextFactory);
          if (typeof stripeFactory === 'function') window.__rgvCardOnlyStripe = true;
        }
      });
    } catch (error) { /* Polling below handles a non-configurable global. */ }
  }

  patchController();
  var checks = 0;
  var guard = window.setInterval(function () {
    checks += 1;
    if (typeof window.Stripe === 'function' && !window.Stripe.__rgvCardOnlyFactory) {
      window.Stripe = wrapStripeFactory(window.Stripe);
      window.__rgvCardOnlyStripe = true;
    }
    var controllerReady = patchController() || !!(window.PSCCheckoutController && window.PSCCheckoutController.__rgvCardOnlyOptions);
    if ((window.__rgvCardOnlyStripe && controllerReady) || checks > 200) window.clearInterval(guard);
  }, 25);
}());
JS;

    if (wp_script_is('psc-classic-checkout', 'registered')) {
      wp_add_inline_script('psc-classic-checkout', $card_only_script, 'before');
    }

    $script_dependencies = wp_script_is('psc-classic-checkout', 'registered')
      ? ['psc-classic-checkout']
      : [];
    wp_enqueue_script(
      'rgv-order-pay',
      plugins_url('assets/js/order-pay.js', __FILE__),
      $script_dependencies,
      self::VERSION,
      true
    );
  }

  public function neutralize_frontend_branding() {
    if (!$this->is_checkout_surface()) {
      return;
    }

    $css = '
      img[src*="prism-wordmark"],
      .psc-blocks-label img[alt="PRISM"] {
        display: none !important;
      }
    ';

    foreach (['psc-research-checkout', 'psc-checkout'] as $handle) {
      if (wp_style_is($handle, 'enqueued')) {
        wp_add_inline_style($handle, $css);
      }
    }

    // Keep the branded order-pay shell available even if the payment provider
    // changes its stylesheet handles in a later release.
    if ($this->is_storefront_payment_request() || $this->is_storefront_receipt_request()) {
      wp_register_style('rgv-card-wallet-payment-page', false, [], self::VERSION);
      wp_enqueue_style('rgv-card-wallet-payment-page');
      wp_add_inline_style(
        'rgv-card-wallet-payment-page',
        $css . $this->payment_page_css() . $this->payment_page_premium_css() . $this->thankyou_page_css()
      );
    }

    // The provider defaults to every payment method enabled on the connected
    // Stripe account. Constrain the deferred Elements session to cards, eligible
    // card wallets, and US bank accounts. The server-side confirmation flow
    // remains unchanged.
    $card_only_script = <<<'JS'
(function () {
  if (window.__rgvCardOnlyStripe || typeof window.Stripe !== 'function') return;

  var originalStripe = window.Stripe;
  var wrappedStripe = function () {
    var stripeClient = originalStripe.apply(null, arguments);
    if (!stripeClient || typeof stripeClient.elements !== 'function') {
      return stripeClient;
    }

    var originalElements = stripeClient.elements.bind(stripeClient);
    var guardedElements = function (options) {
      var elementsOptions = Object.assign({}, options || {}, {
        paymentMethodTypes: ['card', 'us_bank_account']
      });
      var originalAppearance = options && options.appearance ? options.appearance : {};
      elementsOptions.appearance = Object.assign({}, originalAppearance, {
        theme: 'night',
        variables: Object.assign({}, originalAppearance.variables || {}, {
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSizeBase: '15px',
          borderRadius: '11px',
          spacingUnit: '5px',
          colorPrimary: '#9d4146',
          colorBackground: '#101114',
          colorText: '#ededeb',
          colorTextSecondary: '#9698a1',
          colorDanger: '#ef7379'
        }),
        rules: Object.assign({}, originalAppearance.rules || {}, {
          '.Input': {
            padding: '13px 14px',
            border: '1px solid #343840',
            boxShadow: 'none'
          },
          '.Input:focus': {
            border: '1px solid #9d4146',
            boxShadow: '0 0 0 1px #9d4146'
          },
          '.Label': {
            color: '#d8d9dc',
            fontSize: '13px',
            fontWeight: '600'
          }
        })
      });

      var elements = originalElements(elementsOptions);
      if (!elements || typeof elements.create !== 'function') return elements;

      var originalCreate = elements.create.bind(elements);
      var guardedCreate = function (type, elementOptions) {
        if (type === 'expressCheckout') {
          throw new Error('Express checkout is disabled for this card-only storefront flow.');
        }
        if (type !== 'payment') return originalCreate(type, elementOptions);

        var paymentOptions = Object.assign({}, elementOptions || {}, {
          layout: {
            type: 'accordion',
            defaultCollapsed: false,
            radios: false,
            spacedAccordionItems: false
          },
          paymentMethodOrder: ['card', 'us_bank_account'],
          wallets: {
            applePay: 'auto',
            googlePay: 'auto',
            link: 'auto'
          }
        });
        return originalCreate(type, paymentOptions);
      };

      return new Proxy(elements, {
        get: function (target, property) {
          if (property === 'create') return guardedCreate;
          var value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
    };
    return new Proxy(stripeClient, {
      get: function (target, property) {
        if (property === 'elements') return guardedElements;
        if (property === '__rgvCardOnlyElements') return true;
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

  window.Stripe = wrappedStripe;
  window.__rgvCardOnlyStripe = true;
}());
JS;

    $script = <<<'JS'
(function () {
  var replacements = [
    [/PRISM Secure Checkout/gi, 'Card payment'],
    [/PRISM Fall Checkout/gi, 'Card payment'],
    [/Powered by PRISM/gi, 'Card payment'],
    [/PRISM research verification/gi, 'Research verification'],
    [/Loading PRISM verification/gi, 'Loading verification'],
    [/\bPRISM\b/gi, 'payment']
  ];

  function replace(value) {
    return replacements.reduce(function (current, entry) {
      return current.replace(entry[0], entry[1]);
    }, String(value || ''));
  }

  function neutralize(root) {
    if (!root || root.nodeType !== 1) return;

    root.querySelectorAll('img[src*="prism-wordmark"], img[alt*="PRISM" i]').forEach(function (image) {
      image.hidden = true;
      image.setAttribute('aria-hidden', 'true');
    });

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      if (!node.parentElement || /^(SCRIPT|STYLE|TEXTAREA|OPTION)$/.test(node.parentElement.tagName)) return;
      var next = replace(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    });

    root.querySelectorAll('[aria-label], [title], [alt]').forEach(function (element) {
      ['aria-label', 'title', 'alt'].forEach(function (attribute) {
        if (!element.hasAttribute(attribute)) return;
        var current = element.getAttribute(attribute);
        var next = replace(current);
        if (next !== current) element.setAttribute(attribute, next);
      });
    });
  }

  function arrangeOrderPaySurface() {
    var form = document.querySelector('form#order_review');
    var payment = form ? form.querySelector('#payment') : null;
    var paymentSurface = document.querySelector('#psc-checkout-root, #psc-checkout');

    // On Woo's order-pay endpoint the provider prints its Stripe surface before
    // the form. Move it into the stable form before Stripe mounts its iframes so
    // the complete payment experience can be presented as one composed card.
    if (form && payment && paymentSurface && paymentSurface.parentNode !== form) {
      if (!paymentSurface.querySelector('iframe')) {
        form.insertBefore(paymentSurface, payment);
      }
    }

    if (form && form.querySelector('#psc-checkout-root, #psc-checkout')) {
      form.classList.add('rgv-payment-layout-ready');
    }

    if (paymentSurface) {
      paymentSurface.classList.add('rgv-card-only-surface');
      var walletStage = paymentSurface.querySelector('#psc-wallet-stage, .psc-wallet-stage');
      if (walletStage) {
        walletStage.hidden = true;
        walletStage.setAttribute('aria-hidden', 'true');
      }

      var cardStage = paymentSurface.matches('#psc-card-stage, .psc-card-stage')
        ? paymentSurface
        : paymentSurface.querySelector('#psc-card-stage, .psc-card-stage');
      var paymentElement = cardStage ? cardStage.querySelector('#psc-payment-element') : null;
      if (cardStage) {
        cardStage.hidden = false;
        cardStage.removeAttribute('aria-hidden');
      }
      if (cardStage && paymentElement && !cardStage.querySelector(':scope > .rgv-card-details__heading')) {
        var cardHeading = document.createElement('div');
        cardHeading.className = 'rgv-card-details__heading';
        cardHeading.innerHTML = '<span>Card details</span><small>Secure payment</small>';
        cardStage.insertBefore(cardHeading, paymentElement);
      }
      if (cardStage && paymentElement && !cardStage.querySelector(':scope > .rgv-card-details__security')) {
        var security = document.createElement('p');
        security.className = 'rgv-card-details__security';
        security.textContent = 'Your card information is encrypted and never stored by RGVPRIME.';
        paymentElement.insertAdjacentElement('afterend', security);
      }
    }

    var verification = document.querySelector('#psc-research-checkout[data-psc-step="complete"]');
    payment = payment || document.querySelector('form#order_review #payment, .woocommerce-order-pay #order_review #payment');
    if (!verification || !payment || !payment.parentNode) return;
    if (payment.nextElementSibling !== verification) {
      payment.insertAdjacentElement('afterend', verification);
    }
  }

  var revealStarted = false;
  function revealPaymentSurface() {
    if (revealStarted) return;
    var form = document.querySelector('form#order_review.rgv-payment-layout-ready');
    var surface = form ? form.querySelector('#psc-checkout-root, #psc-checkout') : null;
    if (!form || !surface) return;

    revealStarted = true;
    var startedAt = Date.now();
    var inspect = function () {
      // Wait for Stripe's actual secure iframe, not merely the empty host shell.
      // Revealing on .psc-card-stage caused the half-built flash buyers reported.
      var hasMountedContent = !!surface.querySelector('#psc-payment-element iframe, iframe');
      if (!hasMountedContent && Date.now() - startedAt < 3600) {
        window.requestAnimationFrame(inspect);
        return;
      }

      window.setTimeout(function () {
        document.body.classList.add('rgv-payment-ui-ready');
        var loader = document.querySelector('.rgv-payment-loader');
        if (loader) loader.setAttribute('aria-hidden', 'true');
      }, 320);
    };
    window.requestAnimationFrame(inspect);
  }

  function decorateOrderSummary() {
    var form = document.querySelector('form#order_review');
    var table = form ? form.querySelector(':scope > table.shop_table') : null;
    if (!form || !table) return;

    table.classList.add('rgv-order-summary');
    var productRows = Array.prototype.slice.call(table.querySelectorAll('tbody tr.cart_item'));
    if (!productRows.length) {
      productRows = Array.prototype.slice.call(table.querySelectorAll('tbody tr'));
    }

    if (!table.querySelector(':scope > caption.rgv-order-summary__caption')) {
      var caption = document.createElement('caption');
      caption.className = 'rgv-order-summary__caption';
      var title = document.createElement('strong');
      title.textContent = 'Order summary';
      var meta = document.createElement('span');
      meta.textContent = productRows.length + (productRows.length === 1 ? ' product' : ' products') + ' · USD';
      caption.appendChild(title);
      caption.appendChild(meta);
      table.insertBefore(caption, table.firstChild);
    }

    productRows.forEach(function (row, index) {
      row.classList.add('rgv-order-summary__product');
      var name = row.querySelector('.product-name');
      if (!name) return;
      name.setAttribute('data-rgv-line', String(index + 1).padStart(2, '0'));
      if (!name.querySelector(':scope > .rgv-order-summary__product-copy')) {
        var media = name.querySelector(':scope > .rgv-order-summary__thumb');
        var copy = document.createElement('div');
        copy.className = 'rgv-order-summary__product-copy';
        Array.prototype.slice.call(name.childNodes).forEach(function (node) {
          if (node !== media) copy.appendChild(node);
        });
        name.appendChild(copy);
      }
    });

    Array.prototype.forEach.call(table.querySelectorAll('tfoot tr'), function (row) {
      var heading = row.querySelector('th');
      var label = heading ? String(heading.textContent || '').trim().toLowerCase() : '';
      if (label.indexOf('payment method') !== -1) row.classList.add('rgv-order-summary__method');
      if (label === 'total' || row.classList.contains('order-total')) {
        row.classList.add('rgv-order-summary__total');
        if (heading) heading.textContent = 'Total due';
      }
    });

    var amount = table.querySelector('.rgv-order-summary__total .amount, .order-total .amount');
    var button = form.querySelector('#place_order');
    if (amount && button && !button.dataset.rgvPremiumLabel) {
      button.textContent = 'Pay securely · ' + String(amount.textContent || '').trim();
      button.dataset.rgvPremiumLabel = 'true';
    }
  }

  function start() {
    neutralize(document.body);
    arrangeOrderPaySurface();
    decorateOrderSummary();
    revealPaymentSurface();
    new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        if (mutation.type === 'characterData' && mutation.target.parentElement) {
          neutralize(mutation.target.parentElement);
        }
        mutation.addedNodes.forEach(function (node) {
          if (node.nodeType === 1) neutralize(node);
        });
      });
      arrangeOrderPaySurface();
      decorateOrderSummary();
      revealPaymentSurface();
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-psc-step'] });

    window.setTimeout(function () {
      if (document.querySelector('form#order_review.rgv-payment-layout-ready')) {
        document.body.classList.add('rgv-payment-ui-ready');
      }
    }, 4600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}());
JS;

    if (wp_script_is('psc-classic-checkout', 'enqueued')) {
      wp_add_inline_script('psc-classic-checkout', $card_only_script, 'before');
    }

    foreach (['psc-research-checkout', 'psc-classic-checkout'] as $handle) {
      if (wp_script_is($handle, 'enqueued')) {
        wp_add_inline_script($handle, $script, 'after');
        break;
      }
    }
  }

  public function payment_page_body_class($classes) {
    if ($this->is_storefront_payment_request()) {
      $classes[] = 'rgv-card-wallet-payment-page';
    }
    if ($this->is_storefront_receipt_request()) {
      $classes[] = 'rgv-card-wallet-thankyou-page';
    }

    return array_values(array_unique($classes));
  }

  public function restrict_public_wordpress_navigation() {
    if (
      is_admin() ||
      wp_doing_ajax() ||
      (defined('REST_REQUEST') && REST_REQUEST) ||
      (defined('DOING_CRON') && DOING_CRON) ||
      (defined('WP_CLI') && WP_CLI) ||
      (defined('XMLRPC_REQUEST') && XMLRPC_REQUEST) ||
      isset($_GET['wc-api']) ||
      isset($_GET['wc-ajax']) ||
      (function_exists('get_query_var') && (get_query_var('wc-api') || get_query_var('wc-ajax'))) ||
      !in_array(strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')), ['GET', 'HEAD'], true)
    ) {
      return;
    }

    if ($this->is_storefront_payment_request() || $this->is_storefront_receipt_request()) {
      return;
    }

    $storefront = $this->storefront_url();
    if (!$storefront) {
      return;
    }

    wp_redirect($storefront, 302, 'RGVPRIME Storefront');
    exit;
  }

  public function render_payment_nav() {
    if (!$this->is_storefront_payment_request() && !$this->is_storefront_receipt_request()) {
      return;
    }

    $storefront = $this->storefront_url();
    $checkout = $storefront ? trailingslashit($storefront) . 'checkout' : '';
    $logo = $storefront ? trailingslashit($storefront) . 'logo.webp' : '';

    echo '<nav class="rgv-pay-nav" aria-label="Payment navigation"><div class="rgv-pay-nav__inner">';
    echo '<a class="rgv-pay-nav__brand" href="' . esc_url($storefront ?: home_url('/')) . '" aria-label="RGVPRIME home">';
    if ($logo) {
      echo '<img src="' . esc_url($logo) . '" alt="RGVPRIME">';
    } else {
      echo 'RGV<span>PRIME</span>';
    }
    echo '</a>';
    if ($checkout) {
      echo '<a class="rgv-pay-nav__back" href="' . esc_url($checkout) . '"><span aria-hidden="true">&larr;</span> Back to checkout</a>';
    }
    echo '</div></nav>';
  }

  public function render_payment_header() {
    if (!$this->is_storefront_payment_request()) {
      return;
    }

    echo '<section class="rgv-payment-intro" aria-labelledby="rgv-payment-title">';
    echo '<div class="rgv-payment-intro__copy-group">';
    echo '<p class="rgv-payment-intro__eyebrow"><span aria-hidden="true"></span> Final payment</p>';
    echo '<h1 id="rgv-payment-title">Complete your order</h1>';
    echo '<p class="rgv-payment-intro__copy">Review your order, then complete payment by card.</p>';
    echo '</div>';
    echo '<div class="rgv-payment-intro__trust" aria-label="Checkout protections">';
    echo '<span><b aria-hidden="true">&#10003;</b> Encrypted payment</span>';
    echo '<span><b aria-hidden="true">&#10003;</b> Card details stay private</span>';
    echo '</div></section>';
    echo '<section class="rgv-payment-loader" aria-live="polite" aria-label="Preparing card form">';
    echo '<div class="rgv-payment-loader__payment">';
    echo '<div class="rgv-payment-loader__head"><span></span><i></i></div>';
    echo '<div class="rgv-payment-loader__field"></div><div class="rgv-payment-loader__field rgv-payment-loader__field--short"></div>';
    echo '<div class="rgv-payment-loader__button"></div></div>';
    echo '<div class="rgv-payment-loader__summary">';
    echo '<span class="rgv-payment-loader__line"></span>';
    echo '<div class="rgv-payment-loader__items"><span></span><span></span><span></span></div>';
    echo '<div class="rgv-payment-loader__total"></div></div>';
    echo '<p class="rgv-payment-loader__status"><span aria-hidden="true"></span> Preparing your card form&hellip;</p>';
    echo '</section>';
  }

  private function payment_page_css() {
    return <<<'CSS'

      body.rgv-card-wallet-payment-page {
        --rgv-pay-bg: #050506;
        --rgv-pay-surface: #101114;
        --rgv-pay-surface-raised: #0c0d10;
        --rgv-pay-text: #f7f7f5;
        --rgv-pay-muted: #a7a9b1;
        --rgv-pay-border: rgba(255, 255, 255, 0.13);
        --rgv-pay-border-strong: rgba(255, 255, 255, 0.22);
        --rgv-pay-accent: #8f1d27;
        --rgv-pay-accent-hover: #a12a33;
        background: var(--rgv-pay-bg) !important;
        color: var(--rgv-pay-text) !important;
        min-height: 100svh;
        background-image:
          radial-gradient(circle at 8% -10%, rgba(220, 38, 38, .16), transparent 34%),
          radial-gradient(circle at 100% 12%, rgba(127, 29, 29, .18), transparent 30%),
          linear-gradient(135deg, #020202 0%, #080304 52%, #030303 100%) !important;
        font-family: "RGV Sora", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        -webkit-font-smoothing: antialiased;
      }

      html:has(body.rgv-card-wallet-payment-page) {
        background: #090a0c !important;
      }

      body.rgv-card-wallet-payment-page :where(.wp-site-blocks > header, .wp-site-blocks > footer, .wp-block-post-title, .woocommerce-breadcrumb, .storefront-breadcrumb, #secondary, .widget-area) {
        display: none !important;
      }

      body.rgv-card-wallet-payment-page :where(.wp-site-blocks, .wp-site-blocks > main, .wp-block-post-content, .entry-content) {
        box-sizing: border-box;
        max-width: none !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav {
        position: relative;
        z-index: 20;
        width: 100%;
        border-bottom: 1px solid rgba(255, 255, 255, .10);
        background: rgba(9, 10, 12, .96);
        color: var(--rgv-pay-text);
        backdrop-filter: blur(14px);
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__inner {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        width: min(1256px, calc(100% - 96px));
        min-height: 76px;
        margin: 0 auto;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__brand {
        justify-self: start;
        color: #ededeb !important;
        font-size: 19px;
        font-weight: 720;
        letter-spacing: -.055em;
        line-height: 1;
        text-decoration: none !important;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__brand span {
        color: #a12a33;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__brand img {
        display: block;
        width: 144px;
        height: auto;
        max-height: 44px;
        object-fit: contain;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__secure {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        justify-self: center;
        color: #b0b1ba;
        font-size: 10px;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__secure span {
        color: #ad7773;
        font-size: 11px;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__back {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        justify-self: end;
        min-height: 40px;
        padding: 10px 14px;
        border: 1px solid rgba(255, 255, 255, .14);
        border-radius: 11px;
        background: rgba(255, 255, 255, .012);
        color: #d3d2d0 !important;
        font-size: 10px;
        text-decoration: none !important;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__back:hover {
        border-color: rgba(255, 255, 255, .25);
        background: rgba(255, 255, 255, .035);
      }

      body.rgv-card-wallet-payment-page :where(.site, .site-content, .content-area, .site-main, .wp-site-blocks, main, article, .entry-content) {
        background-color: transparent !important;
      }

      body.rgv-card-wallet-payment-page .woocommerce {
        box-sizing: border-box;
        width: min(100% - 48px, 1160px) !important;
        max-width: 1160px !important;
        margin: 42px auto 72px !important;
        color: var(--rgv-pay-text) !important;
        font-family: inherit;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro {
        margin: 0 0 22px;
        padding: 0 0 22px;
        border-bottom: 1px solid var(--rgv-pay-border);
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__eyebrow {
        margin: 0 0 12px;
        color: #b97774 !important;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: .11em;
        text-transform: uppercase;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro h1 {
        margin: 0;
        color: var(--rgv-pay-text) !important;
        font-size: clamp(36px, 5vw, 50px);
        font-weight: 750;
        letter-spacing: -.055em;
        line-height: 1;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__copy {
        max-width: 600px;
        margin: 12px 0 0;
        color: var(--rgv-pay-muted) !important;
        font-size: 15px;
        line-height: 1.65;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__trust {
        display: flex;
        flex-wrap: wrap;
        gap: 10px 22px;
        margin-top: 15px;
        color: #b8b9bf;
        font-size: 11px;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__trust span::before {
        display: inline-block;
        width: 6px;
        height: 6px;
        margin: 0 8px 1px 0;
        border-radius: 50%;
        background: #a25a5d;
        content: "";
      }

      body.rgv-card-wallet-payment-page form#order_review,
      body.rgv-card-wallet-payment-page .woocommerce-order-pay #order_review {
        overflow: hidden;
        margin: 0 !important;
        border: 1px solid var(--rgv-pay-border) !important;
        border-radius: 24px;
        background: var(--rgv-pay-surface) !important;
        box-shadow: 0 22px 70px rgba(0, 0, 0, .28);
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table {
        width: 100% !important;
        margin: 0 !important;
        border: 0 !important;
        border-collapse: collapse !important;
        border-radius: 0 !important;
        background: transparent !important;
        color: var(--rgv-pay-text) !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table :is(th, td) {
        padding: 17px 24px !important;
        border: 0 !important;
        border-bottom: 1px solid var(--rgv-pay-border) !important;
        background: transparent !important;
        color: var(--rgv-pay-text) !important;
        font-size: 14px;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table th {
        color: var(--rgv-pay-muted) !important;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .08em;
        text-transform: uppercase;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr:last-child :is(th, td) {
        border-bottom: 0 !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table .amount {
        color: var(--rgv-pay-text) !important;
        font-weight: 600;
      }

      body.rgv-card-wallet-payment-page #payment {
        margin: 0 !important;
        padding: 26px 24px 24px !important;
        border: 0 !important;
        border-top: 1px solid var(--rgv-pay-border) !important;
        border-radius: 0 !important;
        background: var(--rgv-pay-surface) !important;
        color: var(--rgv-pay-text) !important;
      }

      body.rgv-card-wallet-payment-page #payment ul.payment_methods,
      body.rgv-card-wallet-payment-page #payment .payment_box {
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        background: transparent !important;
        color: var(--rgv-pay-text) !important;
      }

      body.rgv-card-wallet-payment-page #payment ul.payment_methods > li {
        margin: 0 !important;
        padding: 0 !important;
        list-style: none !important;
      }

      body.rgv-card-wallet-payment-page #payment ul.payment_methods > li > label {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0 0 16px !important;
        color: var(--rgv-pay-text) !important;
        font-size: 15px;
        font-weight: 550;
      }

      body.rgv-card-wallet-payment-page #payment input[type="radio"] {
        accent-color: var(--rgv-pay-accent);
      }

      body.rgv-card-wallet-payment-page .psc-gateway-description {
        margin: 0 0 16px !important;
        color: var(--rgv-pay-muted) !important;
        font-size: 13px;
        line-height: 1.65;
      }

      body.rgv-card-wallet-payment-page .psc-checkout,
      body.rgv-card-wallet-payment-page .psc-checkout--theme-dark {
        --psc-surface: var(--rgv-pay-surface-raised);
        --psc-surface-2: #0c0d10;
        --psc-text: var(--rgv-pay-text);
        --psc-text-muted: var(--rgv-pay-muted);
        --psc-border: var(--rgv-pay-border);
        --psc-accent: var(--rgv-pay-accent);
        --psc-accent-text: #ffffff;
        --psc-banner-bg: rgba(143, 29, 39, .14);
        --psc-banner-border: #743039;
        --psc-banner-text: var(--rgv-pay-text);
        --psc-input-bg: #0b0c0f;
        --psc-input-text: var(--rgv-pay-text);
        --psc-input-border: #33343a;
        --psc-focus: #c87875;
        margin: 0 0 18px !important;
        padding: 18px !important;
        border: 1px solid var(--rgv-pay-border) !important;
        border-radius: 14px !important;
        background: var(--rgv-pay-surface-raised) !important;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page :is(#psc-research-checkout, .psc-checkout) :where(input, button, select, summary):focus-visible,
      body.rgv-card-wallet-payment-page #payment :where(input, button):focus-visible {
        outline: 2px solid #c87875 !important;
        outline-offset: 3px;
      }

      body.rgv-card-wallet-payment-page #payment .form-row.place-order {
        margin: 20px 0 0 !important;
        padding: 20px 0 0 !important;
        border-top: 1px solid var(--rgv-pay-border) !important;
      }

      body.rgv-card-wallet-payment-page #place_order,
      body.rgv-card-wallet-payment-page #payment .button.alt {
        min-height: 56px;
        padding: 15px 20px !important;
        border: 1px solid #aa3943 !important;
        border-radius: 12px !important;
        background: var(--rgv-pay-accent) !important;
        color: #ffffff !important;
        font-size: 14px !important;
        font-weight: 750 !important;
        text-transform: none !important;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page #place_order:hover,
      body.rgv-card-wallet-payment-page #payment .button.alt:hover {
        background: var(--rgv-pay-accent-hover) !important;
      }

      body.rgv-card-wallet-payment-page :is(.woocommerce-error, .woocommerce-message, .woocommerce-info) {
        margin: 0 0 18px !important;
        padding: 14px 16px !important;
        border: 1px solid var(--rgv-pay-border-strong) !important;
        border-radius: 12px !important;
        background: var(--rgv-pay-surface-raised) !important;
        color: var(--rgv-pay-text) !important;
        font-size: 13px;
        line-height: 1.6;
      }

      body.rgv-card-wallet-payment-page .woocommerce-error {
        border-color: rgba(200, 120, 117, .6) !important;
        background: rgba(143, 29, 39, .16) !important;
        color: #e7b5ae !important;
      }

      body.rgv-card-wallet-payment-page :where(a) {
        color: #d2a19a;
      }

      /* Match the first verification step to the same checkout shell. */
      body.rgv-card-wallet-payment-page #psc-research-checkout {
        --psc-r-bg: #101114;
        --psc-r-surface: #0c0d10;
        --psc-r-text: #ededeb;
        --psc-r-muted: #9698a1;
        --psc-r-border: rgba(255, 255, 255, .12);
        --psc-r-input-border: #33343a;
        --psc-r-highlight: #c87875;
        --psc-r-tint: rgba(143, 29, 39, .16);
        --psc-r-success: #a9d6a5;
        --psc-r-success-bg: rgba(37, 61, 38, .28);
        --psc-r-accent: #8f1d27;
        --psc-r-on-accent: #ffffff;
        --psc-r-error: #e7b5ae;
        --psc-r-error-bg: rgba(143, 29, 39, .16);
        --psc-r-shadow: none;
        width: min(100% - 36px, 620px) !important;
        max-width: 620px !important;
        margin: 42px auto 72px !important;
        color-scheme: dark !important;
        font-family: inherit !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout .psc-r-shell {
        overflow: hidden;
        border: 1px solid var(--rgv-pay-border) !important;
        border-radius: 18px !important;
        background: #101114 !important;
        box-shadow: 0 22px 70px rgba(0, 0, 0, .28) !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout .psc-r-header {
        justify-content: space-between;
        min-height: 74px;
        padding: 22px 28px !important;
        border-color: var(--rgv-pay-border) !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout .psc-r-header::before {
        color: #b97774;
        content: "Secure verification";
        font-size: 9px;
        font-weight: 550;
        letter-spacing: .10em;
        text-transform: uppercase;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout .psc-r-wordmark {
        display: none !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout .psc-r-help-trigger {
        color: #aeb0b8 !important;
        font-family: inherit !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout .psc-r-body {
        padding: 30px 32px 28px !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout :where(h2, .psc-r-help h3) {
        color: #ededeb !important;
        font-family: inherit !important;
        font-weight: 450 !important;
        letter-spacing: -.04em !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout h2 {
        font-size: clamp(28px, 5vw, 38px) !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout :where(.psc-r-check, .psc-r-field, .psc-r-button, .psc-r-category, .psc-r-help) {
        font-family: inherit !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout :where(.psc-r-declarations .psc-r-check, .psc-r-check-all, .psc-r-remember, .psc-r-identity, .psc-r-delivery, .psc-r-agreement) {
        border-radius: 11px !important;
        background: #0b0c0f !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout :where(.psc-r-declarations .psc-r-check, .psc-r-check-all, .psc-r-remember):hover {
        border-color: #51535d !important;
        background: rgba(255, 255, 255, .025) !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout :where(.psc-r-declarations .psc-r-check, .psc-r-check-all, .psc-r-remember):has(input:checked) {
        border-color: #557c52 !important;
        background: rgba(34, 55, 33, .34) !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout .psc-r-check input {
        accent-color: #8f1d27 !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout :where(.psc-r-field input, .psc-r-category > span) {
        border-color: #33343a !important;
        border-radius: 11px !important;
        background: #0b0c0f !important;
        color: #ededeb !important;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout :where(input, button, summary):focus-visible {
        outline: 2px solid #c87875 !important;
        outline-offset: 3px;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout .psc-r-primary {
        min-height: 50px !important;
        border: 1px solid #aa3943 !important;
        border-radius: 12px !important;
        background: #8f1d27 !important;
        color: #ffffff !important;
        font-weight: 550 !important;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout .psc-r-primary:hover:not(:disabled) {
        background: #a12a33 !important;
        filter: none !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout .psc-r-footer {
        border-color: var(--rgv-pay-border) !important;
        color: #858792 !important;
      }

      /* Once verified, keep the identity as a quiet confirmation below payment. */
      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] {
        width: 100% !important;
        max-width: none !important;
        margin: 14px 0 0 !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-shell {
        overflow: hidden;
        border: 1px solid rgba(86, 122, 82, .48) !important;
        border-radius: 18px !important;
        background: rgba(14, 19, 15, .82) !important;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-body {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-rows: auto auto;
        column-gap: 22px;
        align-items: center;
        padding: 16px 18px !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] h2 {
        grid-column: 1;
        grid-row: 1;
        margin: 0 0 3px 44px !important;
        color: #b9deb5 !important;
        font-size: 11px !important;
        font-weight: 700 !important;
        letter-spacing: .12em !important;
        line-height: 1.3 !important;
        text-transform: uppercase;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-recognized {
        grid-column: 1;
        grid-row: 2;
        gap: 12px;
        min-width: 0;
        margin: 0 !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-checkmark {
        width: 32px;
        height: 32px;
        border-color: #6b9667 !important;
        background: rgba(43, 73, 41, .45) !important;
        color: #b9deb5 !important;
        font-size: 15px;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-recognized strong {
        color: var(--rgv-pay-text) !important;
        font-size: 14px !important;
        font-weight: 650 !important;
        line-height: 1.45;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-recognized div > span {
        color: #aeb1b8 !important;
        font-size: 12px !important;
        line-height: 1.5;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] [data-action="edit"] {
        grid-column: 2;
        grid-row: 1 / 3;
        width: auto !important;
        min-height: 40px !important;
        margin: 0 !important;
        padding: 8px 12px !important;
        border: 1px solid rgba(255, 255, 255, .10) !important;
        border-radius: 999px !important;
        color: #dca7a3 !important;
        font-size: 11px !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] [data-action="edit"]:hover {
        border-color: rgba(220, 167, 163, .4) !important;
        background: rgba(255, 255, 255, .035) !important;
        color: #f0c2be !important;
      }

      /* Traditional checkout: payment on the left and order summary on the right. */
      body.rgv-card-wallet-payment-page form#order_review,
      body.rgv-card-wallet-payment-page .woocommerce-order-pay #order_review {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(360px, 410px);
        grid-template-rows: minmax(0, 1fr) auto;
        gap: 16px 28px;
        align-items: stretch;
        overflow: visible;
        border: 0 !important;
        border-radius: 0 !important;
        background: transparent !important;
        box-shadow: none;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table {
        position: sticky;
        top: 24px;
        grid-column: 2;
        grid-row: 1 / 3;
        align-self: start;
        overflow: hidden;
        table-layout: auto !important;
        border: 1px solid var(--rgv-pay-border) !important;
        border-radius: 24px !important;
        background: #111215 !important;
        box-shadow: 0 22px 70px rgba(0, 0, 0, .28);
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table .product-name {
        width: 62%;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table .product-quantity {
        width: 12%;
        text-align: center !important;
        white-space: nowrap;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table .product-total {
        width: 26%;
        text-align: right !important;
        white-space: nowrap;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table td.product-name {
        color: #dededc !important;
        line-height: 1.45;
      }

      body.rgv-card-wallet-payment-page #order_review :where(.wc-item-meta, dl.variation) {
        display: flex;
        flex-wrap: wrap;
        gap: 5px 12px;
        margin: 6px 0 0 !important;
        padding: 0 !important;
        color: var(--rgv-pay-muted) !important;
        font-size: 12px;
        list-style: none !important;
      }

      body.rgv-card-wallet-payment-page #order_review :where(.wc-item-meta li, dl.variation > div) {
        display: inline-flex;
        gap: 4px;
        margin: 0 !important;
      }

      body.rgv-card-wallet-payment-page #order_review :where(.wc-item-meta strong, dl.variation dt, .wc-item-meta p, dl.variation dd) {
        display: inline !important;
        float: none !important;
        margin: 0 !important;
        padding: 0 !important;
        color: inherit !important;
        font-size: inherit !important;
        font-weight: 400 !important;
        line-height: inherit !important;
      }

      body.rgv-card-wallet-payment-page #payment {
        display: flex;
        min-height: 430px;
        flex-direction: column;
        grid-column: 1;
        grid-row: 1;
        padding: 28px !important;
        border: 1px solid var(--rgv-pay-border) !important;
        border-radius: 24px !important;
        background:
          radial-gradient(circle at 100% 0, rgba(143, 29, 39, .13), transparent 260px),
          #101114 !important;
        box-shadow: 0 22px 70px rgba(0, 0, 0, .28);
      }

      body.rgv-card-wallet-payment-page #payment .payment_method_psc > input.input-radio {
        position: absolute !important;
        width: 1px !important;
        height: 1px !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      body.rgv-card-wallet-payment-page #payment .payment_method_psc > label {
        gap: 11px;
        margin-bottom: 6px !important;
        font-size: 17px;
        font-weight: 700;
        letter-spacing: -.025em;
      }

      body.rgv-card-wallet-payment-page #payment .payment_method_psc > label::before {
        display: inline-grid;
        width: 30px;
        height: 30px;
        place-items: center;
        border: 1px solid rgba(255, 255, 255, .13);
        border-radius: 9px;
        background: rgba(255, 255, 255, .02);
        color: #b28c85;
        content: "\1F4B3";
        font-size: 14px;
      }

      body.rgv-card-wallet-payment-page #payment .payment_box::before {
        display: none !important;
      }

      body.rgv-card-wallet-payment-page #payment .payment_box {
        display: block !important;
      }

      body.rgv-card-wallet-payment-page #payment .psc-gateway-description {
        max-width: 560px;
        margin-bottom: 18px !important;
      }

      body.rgv-card-wallet-payment-page #payment .form-row.place-order {
        width: 100%;
        margin: auto 0 0 !important;
        padding: 22px 0 0 !important;
        border: 0 !important;
        border-top: 1px solid var(--rgv-pay-border) !important;
      }

      body.rgv-card-wallet-payment-page #place_order,
      body.rgv-card-wallet-payment-page #payment .button.alt {
        width: 100% !important;
      }

      body.rgv-card-wallet-payment-page form#order_review > #psc-research-checkout[data-psc-step="complete"],
      body.rgv-card-wallet-payment-page .woocommerce-order-pay #order_review > #psc-research-checkout[data-psc-step="complete"] {
        grid-column: 1;
        grid-row: 2;
        align-self: start;
        margin: 0 !important;
      }

      @media (max-width: 1040px) {
        body.rgv-card-wallet-payment-page .rgv-pay-nav__inner {
          width: calc(100% - 64px);
        }

        body.rgv-card-wallet-payment-page form#order_review,
        body.rgv-card-wallet-payment-page .woocommerce-order-pay #order_review {
          grid-template-columns: minmax(0, 1fr) minmax(330px, 370px);
          gap: 16px 22px;
        }
      }

      @media (max-width: 860px) {
        body.rgv-card-wallet-payment-page form#order_review,
        body.rgv-card-wallet-payment-page .woocommerce-order-pay #order_review {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: auto auto auto;
          gap: 16px;
        }

        body.rgv-card-wallet-payment-page #payment {
          min-height: 390px;
          grid-column: 1;
          grid-row: 1;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table {
          position: static;
          grid-column: 1;
          grid-row: 2;
        }

        body.rgv-card-wallet-payment-page form#order_review > #psc-research-checkout[data-psc-step="complete"],
        body.rgv-card-wallet-payment-page .woocommerce-order-pay #order_review > #psc-research-checkout[data-psc-step="complete"] {
          grid-column: 1;
          grid-row: 3;
        }
      }

      @media (max-width: 700px) {
        body.rgv-card-wallet-payment-page .rgv-pay-nav__inner {
          grid-template-columns: 1fr auto;
          width: calc(100% - 36px);
          min-height: 66px;
        }

        body.rgv-card-wallet-payment-page .rgv-pay-nav__secure {
          display: none;
        }

        body.rgv-card-wallet-payment-page .rgv-pay-nav__brand {
          font-size: 17px;
        }

        body.rgv-card-wallet-payment-page .rgv-pay-nav__brand img {
          width: 116px;
        }

        body.rgv-card-wallet-payment-page .rgv-pay-nav__back {
          min-height: 36px;
          padding: 8px 10px;
        }

        body.rgv-card-wallet-payment-page .woocommerce {
          width: min(100% - 24px, 1160px) !important;
          margin: 24px auto 42px !important;
        }

        body.rgv-card-wallet-payment-page .rgv-payment-intro {
          margin-bottom: 20px;
          padding-bottom: 22px;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table :is(th, td) {
          padding: 14px 16px !important;
        }

        body.rgv-card-wallet-payment-page #payment {
          min-height: 0;
          padding: 22px 16px 18px !important;
        }

        body.rgv-card-wallet-payment-page #payment .form-row.place-order {
          width: 100%;
        }

        body.rgv-card-wallet-payment-page .psc-checkout,
        body.rgv-card-wallet-payment-page .psc-checkout--theme-dark {
          padding: 14px !important;
        }

        body.rgv-card-wallet-payment-page #psc-research-checkout {
          width: calc(100% - 24px) !important;
          margin: 24px auto 42px !important;
        }

        body.rgv-card-wallet-payment-page #psc-research-checkout .psc-r-header {
          min-height: 62px;
          padding: 16px 20px !important;
        }

        body.rgv-card-wallet-payment-page #psc-research-checkout .psc-r-body {
          padding: 24px 20px 20px !important;
        }

        body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] {
          width: 100% !important;
          margin-top: 12px !important;
        }

        body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-body {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: auto auto auto;
          gap: 3px;
          padding: 15px !important;
        }

        body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] h2 {
          grid-column: 1;
          grid-row: 1;
          margin-left: 44px !important;
        }

        body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-recognized {
          grid-column: 1;
          grid-row: 2;
        }

        body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] [data-action="edit"] {
          grid-column: 1;
          grid-row: 3;
          justify-self: start;
          min-height: 36px !important;
          margin: 8px 0 0 44px !important;
        }

      }

      /* 2.3.4: compose Woo's header/button and the stable Stripe surface as one card. */
      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready {
        grid-template-columns: minmax(0, 1fr) minmax(370px, 410px);
        grid-template-rows: auto auto auto auto;
        column-gap: 28px;
        row-gap: 0;
        align-items: start;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #payment {
        display: contents !important;
        min-height: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #payment > ul.payment_methods {
        box-sizing: border-box;
        grid-column: 1;
        grid-row: 1;
        width: 100%;
        margin: 0 !important;
        padding: 26px 26px 16px !important;
        border: 1px solid var(--rgv-pay-border) !important;
        border-bottom: 0 !important;
        border-radius: 22px 22px 0 0 !important;
        background: #101114 !important;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > :is(#psc-checkout-root, #psc-checkout) {
        box-sizing: border-box;
        grid-column: 1;
        grid-row: 2;
        width: 100% !important;
        min-width: 0;
        margin: 0 !important;
        padding: 0 26px 20px !important;
        border-right: 1px solid var(--rgv-pay-border);
        border-left: 1px solid var(--rgv-pay-border);
        background: #101114;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #psc-checkout-root .psc-checkout {
        box-sizing: border-box;
        width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        padding: 16px !important;
        border: 1px solid rgba(255, 255, 255, .11) !important;
        border-radius: 15px !important;
        background: #0b0c0f !important;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #psc-checkout {
        box-sizing: border-box;
        grid-column: 1;
        grid-row: 2;
        width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        padding: 0 26px 20px !important;
        border: 0 !important;
        border-right: 1px solid var(--rgv-pay-border) !important;
        border-left: 1px solid var(--rgv-pay-border) !important;
        border-radius: 0 !important;
        background: #101114 !important;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #psc-checkout > .psc-card-stage {
        padding: 16px !important;
        border: 1px solid rgba(255, 255, 255, .11) !important;
        border-radius: 15px !important;
        background: #0b0c0f !important;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > :is(#psc-checkout-root, #psc-checkout) :where(.psc-wallet-stage, .psc-card-stage) {
        width: 100%;
        min-width: 0;
        margin: 0 !important;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #payment > .form-row.place-order {
        box-sizing: border-box;
        grid-column: 1;
        grid-row: 3;
        width: 100%;
        margin: 0 !important;
        padding: 0 26px 26px !important;
        border: 1px solid var(--rgv-pay-border) !important;
        border-top: 0 !important;
        border-radius: 0 0 22px 22px !important;
        background: #101114 !important;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #payment > .form-row.place-order::before {
        display: block;
        width: 100%;
        margin: 0 0 20px;
        border-top: 1px solid var(--rgv-pay-border);
        content: "";
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #payment > .form-row.place-order #place_order {
        min-height: 54px;
        border-radius: 13px !important;
        font-size: 14px !important;
        letter-spacing: -.01em;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > table.shop_table {
        grid-column: 2;
        grid-row: 1 / 5;
        margin: 0 !important;
        border-radius: 22px !important;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > table.shop_table :is(th, td) {
        padding: 16px 18px !important;
        font-size: 13px;
        line-height: 1.5;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #psc-research-checkout[data-psc-step="complete"] {
        grid-column: 1;
        grid-row: 4;
        width: 100% !important;
        margin: 14px 0 0 !important;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #psc-research-checkout[data-psc-step="complete"] .psc-r-shell {
        border-radius: 14px !important;
        background: rgba(16, 17, 20, .96) !important;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #psc-research-checkout[data-psc-step="complete"] .psc-r-body {
        padding: 13px 16px !important;
      }

      @media (max-width: 900px) {
        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: auto auto auto auto auto;
          column-gap: 0;
          row-gap: 0;
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > table.shop_table {
          position: static;
          grid-column: 1;
          grid-row: 1;
          margin: 0 0 18px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #payment > ul.payment_methods {
          grid-column: 1;
          grid-row: 2;
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > :is(#psc-checkout-root, #psc-checkout) {
          grid-column: 1;
          grid-row: 3;
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #payment > .form-row.place-order {
          grid-column: 1;
          grid-row: 4;
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #psc-research-checkout[data-psc-step="complete"] {
          grid-column: 1;
          grid-row: 5;
        }
      }

      @media (max-width: 700px) {
        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #payment > ul.payment_methods {
          padding: 21px 17px 13px !important;
          border-radius: 18px 18px 0 0 !important;
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > :is(#psc-checkout-root, #psc-checkout) {
          padding: 0 17px 16px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #psc-checkout-root .psc-checkout {
          padding: 12px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #psc-checkout {
          padding: 0 17px 16px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #psc-checkout > .psc-card-stage {
          padding: 12px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #payment > .form-row.place-order {
          padding: 0 17px 18px !important;
          border-radius: 0 0 18px 18px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #psc-research-checkout[data-psc-step="complete"] {
          margin-top: 12px !important;
        }
      }
CSS;
  }

  private function payment_page_premium_css() {
    return <<<'CSS'

      /* 2.5.0 — RGVPRIME premium card-only order-pay composition. */
      body.rgv-card-wallet-payment-page {
        --rgv-premium-bg: #090a0c;
        --rgv-premium-panel: #101114;
        --rgv-premium-panel-2: #0b0c0f;
        --rgv-premium-panel-3: #15161a;
        --rgv-premium-text: #ededeb;
        --rgv-premium-muted: #9698a1;
        --rgv-premium-border: rgba(255, 255, 255, .125);
        --rgv-premium-border-soft: rgba(255, 255, 255, .085);
        --rgv-premium-red: #8f1d27;
        --rgv-premium-red-hover: #a12a33;
        background: linear-gradient(145deg, rgba(73, 20, 26, .07), transparent 42%), var(--rgv-premium-bg) !important;
      }

      body.rgv-card-wallet-payment-page :where(
        .site,
        .site-content,
        .content-area,
        .site-main,
        .wp-site-blocks,
        .wp-site-blocks > main,
        main,
        article,
        .entry-content,
        .wp-block-post-content,
        .wp-block-group,
        .wp-block-group__inner-container
      ) {
        box-sizing: border-box;
        width: 100% !important;
        max-width: none !important;
        margin-right: 0 !important;
        margin-left: 0 !important;
        padding-right: 0 !important;
        padding-left: 0 !important;
        background: transparent !important;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__inner {
        width: min(1180px, calc(100% - 64px));
        min-height: 82px;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__brand img {
        width: 200px;
        max-height: 64px;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__secure,
      body.rgv-card-wallet-payment-page .rgv-pay-nav__back {
        font-size: 11px;
      }

      body.rgv-card-wallet-payment-page .woocommerce {
        position: relative;
        width: min(1180px, calc(100% - 64px)) !important;
        max-width: 1180px !important;
        margin: 46px auto 80px !important;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro {
        margin: 0 0 30px;
        padding: 0 0 30px;
        border-bottom: 1px solid rgba(255, 255, 255, .10);
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__eyebrow {
        margin-bottom: 14px;
        color: #b97774 !important;
        font-size: 10px;
        font-weight: 550;
        letter-spacing: .12em;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro h1 {
        max-width: 760px;
        color: var(--rgv-premium-text) !important;
        font-size: clamp(38px, 4.6vw, 56px);
        font-weight: 470;
        letter-spacing: -.055em;
        line-height: 1.05;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__copy {
        max-width: 650px;
        margin-top: 14px;
        color: var(--rgv-premium-muted) !important;
        font-size: 14px;
        line-height: 1.7;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__trust {
        gap: 12px 24px;
        margin-top: 17px;
        color: #aeb0b8;
        font-size: 11px;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) 410px;
        grid-template-rows: auto auto auto auto;
        column-gap: 32px;
        row-gap: 0;
        align-items: start;
        width: 100% !important;
        overflow: visible !important;
        border: 0 !important;
        border-radius: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page:not(.rgv-payment-ui-ready) form#order_review,
      body.rgv-card-wallet-payment-page:not(.rgv-payment-ui-ready) .woocommerce > :is(#psc-checkout-root, #psc-checkout) {
        position: absolute !important;
        left: -200vw !important;
        width: min(1180px, calc(100vw - 64px)) !important;
        max-height: 1px !important;
        overflow: hidden !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      body.rgv-card-wallet-payment-page.rgv-payment-ui-ready form#order_review {
        visibility: visible;
        opacity: 1;
        transition: opacity .28s ease;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #payment {
        display: contents !important;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #payment > ul.payment_methods {
        box-sizing: border-box;
        grid-column: 1;
        grid-row: 1;
        width: 100%;
        margin: 0 !important;
        padding: 30px 30px 18px !important;
        border: 1px solid var(--rgv-premium-border) !important;
        border-bottom: 0 !important;
        border-radius: 20px 20px 0 0 !important;
        background:
          radial-gradient(circle at 100% 0, rgba(143, 29, 39, .13), transparent 250px),
          var(--rgv-premium-panel) !important;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #payment .payment_method_psc > label {
        gap: 12px;
        margin-bottom: 8px !important;
        color: var(--rgv-premium-text) !important;
        font-size: 19px;
        font-weight: 520;
        letter-spacing: -.035em;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #payment .payment_method_psc > label::before {
        width: 34px;
        height: 34px;
        border-color: rgba(255, 255, 255, .14);
        border-radius: 10px;
        background: rgba(255, 255, 255, .025);
        color: #c58d84;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready .psc-gateway-description {
        max-width: 620px;
        margin: 0 !important;
        color: var(--rgv-premium-muted) !important;
        font-size: 12px;
        line-height: 1.7;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > :is(#psc-checkout-root, #psc-checkout) {
        box-sizing: border-box;
        grid-column: 1;
        grid-row: 2;
        width: 100% !important;
        max-width: none !important;
        min-width: 0;
        margin: 0 !important;
        padding: 0 30px 22px !important;
        border: 0 !important;
        border-right: 1px solid var(--rgv-premium-border) !important;
        border-left: 1px solid var(--rgv-premium-border) !important;
        border-radius: 0 !important;
        background: var(--rgv-premium-panel) !important;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #psc-checkout-root .psc-checkout {
        box-sizing: border-box;
        width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
        border: 0 !important;
        border-radius: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready :is(#psc-checkout-root, #psc-checkout) :is(#psc-card-stage, .psc-card-stage),
      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #psc-checkout:is(#psc-card-stage, .psc-card-stage) {
        box-sizing: border-box !important;
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0;
        margin: 0 !important;
        padding: 22px !important;
        overflow: hidden !important;
        border: 1px solid rgba(255, 255, 255, .105) !important;
        border-radius: 15px !important;
        background: #0d0f13 !important;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, .02) !important;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready :is(#psc-checkout-root, #psc-checkout) :is(#psc-wallet-stage, .psc-wallet-stage, #psc-card-toggle) {
        display: none !important;
      }

      body.rgv-card-wallet-payment-page .rgv-card-details__heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin: 0 0 20px;
        padding: 0 0 16px;
        border-bottom: 1px solid rgba(255, 255, 255, .08);
      }

      body.rgv-card-wallet-payment-page .rgv-card-details__heading > span {
        color: var(--rgv-premium-text);
        font-size: 15px;
        font-weight: 650;
        letter-spacing: -.02em;
      }

      body.rgv-card-wallet-payment-page .rgv-card-details__heading > small {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        color: #a9abb2;
        font-size: 10px;
        font-weight: 550;
        letter-spacing: .01em;
      }

      body.rgv-card-wallet-payment-page .rgv-card-details__heading > small::before {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #6fcf86;
        box-shadow: 0 0 0 3px rgba(111, 207, 134, .10);
        content: "";
      }

      body.rgv-card-wallet-payment-page .rgv-card-details__security {
        position: relative;
        margin: 18px 0 0 !important;
        padding: 15px 16px 15px 41px;
        border: 1px solid rgba(255, 255, 255, .07);
        border-radius: 11px;
        background: rgba(255, 255, 255, .018);
        color: #8e919a !important;
        font-size: 10px;
        line-height: 1.55;
      }

      body.rgv-card-wallet-payment-page .rgv-card-details__security::before {
        position: absolute;
        top: 50%;
        left: 16px;
        color: #c77a78;
        font-size: 13px;
        line-height: 1;
        content: "\1F512";
        transform: translateY(-50%);
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #psc-checkout > .psc-card-stage > *,
      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #psc-checkout-root .psc-checkout > * {
        box-sizing: border-box !important;
        max-width: 100% !important;
        min-width: 0 !important;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready :is(#psc-checkout, #psc-checkout-root) iframe {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
      }

      /* Stable branded loading state: customers never see Woo/provider reflow. */
      body.rgv-card-wallet-payment-page .rgv-payment-loader {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 410px;
        gap: 30px;
        align-items: start;
        min-height: 540px;
      }

      body.rgv-card-wallet-payment-page.rgv-payment-ui-ready .rgv-payment-loader {
        display: none !important;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-loader__payment,
      body.rgv-card-wallet-payment-page .rgv-payment-loader__summary {
        box-sizing: border-box;
        min-width: 0;
        overflow: hidden;
        border: 1px solid var(--rgv-premium-border);
        border-radius: 20px;
        background: var(--rgv-premium-panel);
      }

      body.rgv-card-wallet-payment-page .rgv-payment-loader__payment {
        padding: 30px;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-loader__summary {
        padding: 26px 24px 22px;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-loader__line,
      body.rgv-card-wallet-payment-page .rgv-payment-loader__gateway span,
      body.rgv-card-wallet-payment-page .rgv-payment-loader__field,
      body.rgv-card-wallet-payment-page .rgv-payment-loader__button,
      body.rgv-card-wallet-payment-page .rgv-payment-loader__items span,
      body.rgv-card-wallet-payment-page .rgv-payment-loader__total {
        display: block;
        border-radius: 9px;
        background: linear-gradient(100deg, #17191d 20%, #22242a 38%, #17191d 58%);
        background-size: 220% 100%;
        animation: rgv-payment-shimmer 1.25s linear infinite;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-loader__line--title {
        width: 190px;
        height: 21px;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-loader__line--copy {
        width: min(430px, 78%);
        height: 10px;
        margin-top: 13px;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-loader__gateway {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 9px;
        margin-top: 28px;
        padding: 16px;
        border: 1px solid var(--rgv-premium-border-soft);
        border-radius: 16px;
        background: var(--rgv-premium-panel-2);
      }

      body.rgv-card-wallet-payment-page .rgv-payment-loader__gateway span {
        height: 54px;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-loader__gateway span:not(:first-child) {
        display: none;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-loader__field {
        height: 112px;
        margin-top: 12px;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-loader__field--short {
        height: 45px;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-loader__button {
        height: 56px;
        margin-top: 24px;
        background: linear-gradient(100deg, #681820 20%, #8f2730 38%, #681820 58%);
        background-size: 220% 100%;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-loader__line--summary {
        width: 170px;
        height: 22px;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-loader__items {
        display: grid;
        gap: 14px;
        margin-top: 28px;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-loader__items span {
        height: 68px;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-loader__total {
        height: 70px;
        margin-top: 24px;
        border: 1px solid rgba(174, 61, 70, .20);
        background: linear-gradient(100deg, rgba(71, 24, 29, .72) 20%, rgba(105, 32, 39, .78) 38%, rgba(71, 24, 29, .72) 58%);
        background-size: 220% 100%;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-loader__status {
        grid-column: 1 / -1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 9px;
        margin: -6px 0 0;
        color: #9698a1;
        font-size: 10px;
        letter-spacing: .02em;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-loader__status span {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #a05b59;
        box-shadow: 0 0 0 0 rgba(160, 91, 89, .42);
        animation: rgv-payment-pulse 1.3s ease-out infinite;
      }

      @keyframes rgv-payment-shimmer {
        to { background-position-x: -220%; }
      }

      @keyframes rgv-payment-pulse {
        70% { box-shadow: 0 0 0 7px rgba(160, 91, 89, 0); }
        100% { box-shadow: 0 0 0 0 rgba(160, 91, 89, 0); }
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #payment > .form-row.place-order {
        box-sizing: border-box;
        grid-column: 1;
        grid-row: 3;
        width: 100%;
        margin: 0 !important;
        padding: 0 30px 30px !important;
        border: 1px solid var(--rgv-premium-border) !important;
        border-top: 0 !important;
        border-radius: 0 0 20px 20px !important;
        background: var(--rgv-premium-panel) !important;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #payment > .form-row.place-order::before {
        display: block;
        width: 100%;
        margin: 0 0 22px;
        border-top: 1px solid var(--rgv-premium-border-soft);
        content: "";
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready #place_order {
        width: 100% !important;
        min-height: 56px;
        margin: 0 !important;
        border: 1px solid #aa3943 !important;
        border-radius: 13px !important;
        background: var(--rgv-premium-red) !important;
        color: #fff !important;
        font-size: 13px !important;
        font-weight: 650 !important;
        letter-spacing: -.01em;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready #place_order:hover {
        background: var(--rgv-premium-red-hover) !important;
      }

      /* Editorial order summary, derived from Woo's canonical table. */
      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > table.rgv-order-summary {
        position: sticky;
        top: 24px;
        display: block;
        grid-column: 2;
        grid-row: 1 / 5;
        align-self: start;
        width: 100% !important;
        margin: 0 !important;
        overflow: hidden;
        border: 1px solid var(--rgv-premium-border) !important;
        border-radius: 20px !important;
        background: var(--rgv-premium-panel) !important;
        color: var(--rgv-premium-text) !important;
        box-shadow: 0 24px 60px rgba(0, 0, 0, .24);
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary,
      body.rgv-card-wallet-payment-page table.rgv-order-summary * {
        box-sizing: border-box;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary > caption.rgv-order-summary__caption {
        display: flex;
        width: 100%;
        align-items: flex-end;
        justify-content: space-between;
        gap: 18px;
        padding: 26px 24px 20px;
        border-bottom: 1px solid var(--rgv-premium-border-soft);
        background:
          radial-gradient(circle at 100% 0, rgba(143, 29, 39, .12), transparent 220px),
          transparent;
        caption-side: top;
        color: var(--rgv-premium-text);
        text-align: left;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary > caption strong {
        color: var(--rgv-premium-text);
        font-size: 21px;
        font-weight: 480;
        letter-spacing: -.035em;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary > caption span {
        color: var(--rgv-premium-muted);
        font-size: 9px;
        letter-spacing: .08em;
        text-transform: uppercase;
        white-space: nowrap;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary > thead {
        display: none !important;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary > :is(tbody, tfoot) {
        display: grid;
        width: 100%;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary > tbody {
        padding: 0 24px;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary tr.rgv-order-summary__product {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto minmax(62px, auto);
        gap: 10px;
        align-items: center;
        width: 100%;
        padding: 17px 0;
        border-bottom: 1px solid var(--rgv-premium-border-soft);
        background: transparent !important;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary tr.rgv-order-summary__product:last-child {
        border-bottom: 0;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary tr.rgv-order-summary__product > td {
        display: block;
        width: auto !important;
        min-width: 0;
        padding: 0 !important;
        border: 0 !important;
        background: transparent !important;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary td.product-name {
        display: grid !important;
        grid-template-columns: 58px minmax(0, 1fr);
        gap: 13px;
        align-items: center;
        color: #dedddb !important;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary td.product-name::before {
        display: grid;
        width: 58px;
        height: 66px;
        place-items: center;
        border: 1px solid rgba(255, 255, 255, .10);
        border-radius: 11px;
        background:
          linear-gradient(150deg, rgba(143, 29, 39, .28), transparent 65%),
          #0b0c0f;
        color: #c8a19b;
        content: attr(data-rgv-line);
        font-size: 10px;
        font-weight: 650;
        letter-spacing: .08em;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary td.product-name:has(.rgv-order-summary__thumb)::before {
        display: none;
      }

      body.rgv-card-wallet-payment-page .rgv-order-summary__thumb {
        display: grid;
        width: 58px;
        height: 66px;
        place-items: center;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, .10);
        border-radius: 12px;
        background: linear-gradient(150deg, rgba(143, 29, 39, .16), transparent 68%), #0b0c0f;
      }

      body.rgv-card-wallet-payment-page .rgv-order-summary__thumb img.rgv-order-summary__product-image {
        display: block !important;
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
        padding: 4px;
        object-fit: contain;
        border: 0 !important;
        border-radius: 0 !important;
        background: transparent !important;
      }

      body.rgv-card-wallet-payment-page .rgv-order-summary__product-copy {
        display: grid;
        min-width: 0;
        gap: 4px;
        font-size: 12px;
        font-weight: 520;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary :where(.wc-item-meta, dl.variation) {
        display: grid !important;
        gap: 2px !important;
        margin: 0 !important;
        color: var(--rgv-premium-muted) !important;
        font-size: 9px !important;
        line-height: 1.45 !important;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary :where(.wc-item-meta li, dl.variation > div) {
        display: block !important;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary td.product-quantity {
        min-width: 34px;
        padding: 5px 7px !important;
        border: 1px solid rgba(255, 255, 255, .10) !important;
        border-radius: 999px;
        color: #b8b9bf !important;
        font-size: 10px;
        text-align: center !important;
        white-space: nowrap;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary td.product-total {
        min-width: 62px;
        color: #dedddb !important;
        font-size: 12px;
        font-weight: 560;
        text-align: right !important;
        white-space: nowrap;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary > tfoot {
        padding: 14px 24px 20px;
        border-top: 1px solid var(--rgv-premium-border-soft);
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary > tfoot::after {
        display: block;
        margin-top: 17px;
        color: #85878f;
        content: "\2022  Payment details are encrypted";
        font-size: 9px;
        text-align: center;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary > tfoot > tr {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 18px;
        width: 100%;
        padding: 7px 0;
        border: 0 !important;
        background: transparent !important;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary > tfoot > tr > :is(th, td) {
        display: block;
        width: auto !important;
        padding: 0 !important;
        border: 0 !important;
        background: transparent !important;
        color: var(--rgv-premium-muted) !important;
        font-size: 11px;
        font-weight: 430;
        letter-spacing: 0;
        line-height: 1.5;
        text-transform: none;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary > tfoot > tr > td {
        max-width: 58%;
        color: #d8d7d5 !important;
        font-weight: 520;
        text-align: right !important;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary > tfoot > tr.rgv-order-summary__method {
        display: none !important;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary > tfoot > tr.rgv-order-summary__total {
        align-items: flex-end;
        margin-top: 12px;
        padding: 18px;
        border: 1px solid rgba(174, 61, 70, .30) !important;
        border-radius: 14px;
        background: linear-gradient(135deg, rgba(143, 29, 39, .20), rgba(143, 29, 39, .045) 70%) !important;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary > tfoot > tr.rgv-order-summary__total > th {
        color: var(--rgv-premium-text) !important;
        font-size: 13px;
        font-weight: 600;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary > tfoot > tr.rgv-order-summary__total > th::after {
        display: block;
        margin-top: 5px;
        color: #a9a5a6;
        content: "USD \00b7  Secure payment";
        font-size: 9px;
        font-weight: 430;
      }

      body.rgv-card-wallet-payment-page table.rgv-order-summary > tfoot > tr.rgv-order-summary__total > td,
      body.rgv-card-wallet-payment-page table.rgv-order-summary > tfoot > tr.rgv-order-summary__total .amount {
        color: var(--rgv-premium-text) !important;
        font-size: 28px !important;
        font-weight: 470 !important;
        letter-spacing: -.045em;
        line-height: 1;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #psc-research-checkout[data-psc-step="complete"] {
        grid-column: 1;
        grid-row: 4;
        width: 100% !important;
        margin: 14px 0 0 !important;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #psc-research-checkout[data-psc-step="complete"] .psc-r-shell {
        border: 1px solid rgba(101, 139, 97, .42) !important;
        border-radius: 14px !important;
        background: var(--rgv-premium-panel) !important;
      }

      body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #psc-research-checkout[data-psc-step="complete"] .psc-r-body {
        padding: 13px 16px !important;
      }

      body.rgv-card-wallet-payment-page :is(.woocommerce-error, .woocommerce-message, .woocommerce-info) {
        border-radius: 12px !important;
        font-size: 12px;
      }

      @media (max-width: 980px) {
        body.rgv-card-wallet-payment-page .rgv-pay-nav__inner,
        body.rgv-card-wallet-payment-page .woocommerce {
          width: calc(100% - 48px) !important;
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready {
          grid-template-columns: minmax(0, 1fr) 370px;
          column-gap: 22px;
        }
      }

      @media (max-width: 860px) {
        body.rgv-card-wallet-payment-page .rgv-payment-loader {
          grid-template-columns: minmax(0, 1fr);
          min-height: 680px;
        }

        body.rgv-card-wallet-payment-page .rgv-payment-loader__summary {
          grid-row: 1;
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: auto auto auto auto auto;
          column-gap: 0;
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > table.rgv-order-summary {
          position: static;
          grid-column: 1;
          grid-row: 1;
          margin: 0 0 20px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #payment > ul.payment_methods {
          grid-column: 1;
          grid-row: 2;
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > :is(#psc-checkout-root, #psc-checkout) {
          grid-column: 1;
          grid-row: 3;
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #payment > .form-row.place-order {
          grid-column: 1;
          grid-row: 4;
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #psc-research-checkout[data-psc-step="complete"] {
          grid-column: 1;
          grid-row: 5;
        }
      }

      @media (max-width: 700px) {
        body.rgv-card-wallet-payment-page .rgv-pay-nav__inner {
          width: calc(100% - 32px) !important;
          min-height: 70px;
        }

        body.rgv-card-wallet-payment-page .rgv-pay-nav__brand img {
          width: 150px;
          max-height: 52px;
        }

        body.rgv-card-wallet-payment-page .woocommerce {
          width: calc(100% - 24px) !important;
          margin: 26px auto 48px !important;
        }

        body.rgv-card-wallet-payment-page .rgv-payment-loader {
          gap: 16px;
        }

        body.rgv-card-wallet-payment-page .rgv-payment-loader__payment,
        body.rgv-card-wallet-payment-page .rgv-payment-loader__summary {
          padding: 20px 17px;
          border-radius: 16px;
        }

        body.rgv-card-wallet-payment-page .rgv-payment-intro {
          margin-bottom: 22px;
          padding-bottom: 22px;
        }

        body.rgv-card-wallet-payment-page .rgv-payment-intro h1 {
          font-size: clamp(34px, 11vw, 44px);
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #payment > ul.payment_methods {
          padding: 22px 17px 14px !important;
          border-radius: 16px 16px 0 0 !important;
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > :is(#psc-checkout-root, #psc-checkout) {
          padding: 0 17px 17px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready :is(#psc-checkout-root, #psc-checkout) :is(#psc-card-stage, .psc-card-stage),
        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #psc-checkout:is(#psc-card-stage, .psc-card-stage) {
          padding: 17px !important;
          border-radius: 12px !important;
        }

        body.rgv-card-wallet-payment-page .rgv-card-details__heading {
          margin-bottom: 16px;
          padding-bottom: 14px;
        }

        body.rgv-card-wallet-payment-page .rgv-card-details__security {
          padding-right: 13px;
        }

        body.rgv-card-wallet-payment-page form#order_review.rgv-payment-layout-ready > #payment > .form-row.place-order {
          padding: 0 17px 18px !important;
          border-radius: 0 0 16px 16px !important;
        }

        body.rgv-card-wallet-payment-page table.rgv-order-summary > caption.rgv-order-summary__caption {
          padding: 22px 18px 17px;
        }

        body.rgv-card-wallet-payment-page table.rgv-order-summary > tbody,
        body.rgv-card-wallet-payment-page table.rgv-order-summary > tfoot {
          padding-right: 18px;
          padding-left: 18px;
        }

        body.rgv-card-wallet-payment-page table.rgv-order-summary td.product-name {
          grid-template-columns: 50px minmax(0, 1fr);
          gap: 10px;
        }

        body.rgv-card-wallet-payment-page table.rgv-order-summary td.product-name::before {
          width: 50px;
          height: 58px;
        }

        body.rgv-card-wallet-payment-page .rgv-order-summary__thumb {
          width: 50px;
          height: 58px;
        }

        body.rgv-card-wallet-payment-page table.rgv-order-summary > tfoot > tr.rgv-order-summary__total > td,
        body.rgv-card-wallet-payment-page table.rgv-order-summary > tfoot > tr.rgv-order-summary__total .amount {
          font-size: 25px !important;
        }
      }
CSS;
  }

  private function thankyou_page_css() {
    return <<<'CSS'

      body.rgv-card-wallet-thankyou-page {
        --rgv-pay-bg: #090a0c;
        --rgv-pay-surface: #101114;
        --rgv-pay-text: #ededeb;
        --rgv-pay-muted: #9698a1;
        --rgv-pay-border: rgba(255, 255, 255, .13);
        --rgv-pay-accent: #8f1d27;
        --rgv-pay-accent-hover: #a12a33;
        min-height: 100svh;
        background: linear-gradient(145deg, rgba(73, 20, 26, .075), transparent 42%), var(--rgv-pay-bg) !important;
        color: var(--rgv-pay-text) !important;
        font-family: "RGV Sora", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        -webkit-font-smoothing: antialiased;
      }

      html:has(body.rgv-card-wallet-thankyou-page) {
        background: #090a0c !important;
      }

      body.rgv-card-wallet-thankyou-page :where(.wp-site-blocks > header, .wp-site-blocks > footer, .wp-block-post-title, .woocommerce-breadcrumb, .storefront-breadcrumb, #secondary, .widget-area) {
        display: none !important;
      }

      body.rgv-card-wallet-thankyou-page :where(.wp-site-blocks, .wp-site-blocks > main, .wp-block-post-content, .entry-content) {
        box-sizing: border-box;
        max-width: none !important;
        margin: 0 !important;
        padding: 0 !important;
        background: transparent !important;
      }

      body.rgv-card-wallet-thankyou-page .rgv-pay-nav {
        position: relative;
        z-index: 20;
        width: 100%;
        border-bottom: 1px solid rgba(255, 255, 255, .10);
        background: rgba(9, 10, 12, .96);
        color: var(--rgv-pay-text);
        backdrop-filter: blur(14px);
      }

      body.rgv-card-wallet-thankyou-page .rgv-pay-nav__inner {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        width: min(1256px, calc(100% - 96px));
        min-height: 76px;
        margin: 0 auto;
      }

      body.rgv-card-wallet-thankyou-page .rgv-pay-nav__brand {
        justify-self: start;
        color: #ededeb !important;
        text-decoration: none !important;
      }

      body.rgv-card-wallet-thankyou-page .rgv-pay-nav__brand img {
        display: block;
        width: 144px;
        height: auto;
        max-height: 44px;
        object-fit: contain;
      }

      body.rgv-card-wallet-thankyou-page .rgv-pay-nav__secure {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        justify-self: center;
        color: #b0b1ba;
        font-size: 10px;
      }

      body.rgv-card-wallet-thankyou-page .rgv-pay-nav__back {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        justify-self: end;
        min-height: 40px;
        padding: 10px 14px;
        border: 1px solid rgba(255, 255, 255, .14);
        border-radius: 11px;
        background: rgba(255, 255, 255, .012);
        color: #d3d2d0 !important;
        font-size: 10px;
        text-decoration: none !important;
      }

      body.rgv-card-wallet-thankyou-page .woocommerce {
        box-sizing: border-box;
        width: min(100% - 36px, 720px) !important;
        max-width: 720px !important;
        margin: 64px auto 80px !important;
        color: var(--rgv-pay-text) !important;
        font-family: inherit;
      }

      body.rgv-card-wallet-thankyou-page :where(.woocommerce-thankyou-order-received, .woocommerce-order-overview, .woocommerce-order-details, .woocommerce-customer-details, .wc-bacs-bank-details, .woocommerce-notice:not(.rgv-thankyou-card *)) {
        display: none !important;
      }

      body.rgv-card-wallet-thankyou-page .rgv-thankyou-card {
        padding: 42px 38px 36px;
        border: 1px solid var(--rgv-pay-border);
        border-radius: 18px;
        background: var(--rgv-pay-surface);
        color: var(--rgv-pay-text);
        text-align: center;
        box-shadow: 0 22px 70px rgba(0, 0, 0, .28);
      }

      body.rgv-card-wallet-thankyou-page .rgv-thankyou-card__icon {
        display: grid;
        width: 58px;
        height: 58px;
        margin: 0 auto 24px;
        place-items: center;
        border: 1px solid rgba(169, 214, 165, .45);
        border-radius: 16px;
        background: rgba(37, 61, 38, .28);
        color: #a9d6a5;
        font-size: 26px;
      }

      body.rgv-card-wallet-thankyou-page .rgv-thankyou-card__eyebrow {
        margin: 0 0 12px;
        color: #b97774;
        font-size: 9px;
        font-weight: 550;
        letter-spacing: .10em;
        text-transform: uppercase;
      }

      body.rgv-card-wallet-thankyou-page .rgv-thankyou-card h1 {
        margin: 0;
        color: var(--rgv-pay-text) !important;
        font-size: clamp(34px, 7vw, 50px);
        font-weight: 450;
        letter-spacing: -.05em;
        line-height: 1.08;
      }

      body.rgv-card-wallet-thankyou-page .rgv-thankyou-card__copy {
        max-width: 520px;
        margin: 16px auto 0;
        color: var(--rgv-pay-muted) !important;
        font-size: 13px;
        line-height: 1.8;
      }

      body.rgv-card-wallet-thankyou-page .rgv-thankyou-card__meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin: 28px 0 0;
        padding: 18px;
        border: 1px solid var(--rgv-pay-border);
        border-radius: 14px;
        background: #0b0c0f;
        text-align: left;
      }

      body.rgv-card-wallet-thankyou-page .rgv-thankyou-card__meta span {
        display: block;
        margin-bottom: 5px;
        color: var(--rgv-pay-muted);
        font-size: 9px;
        letter-spacing: .06em;
        text-transform: uppercase;
      }

      body.rgv-card-wallet-thankyou-page .rgv-thankyou-card__meta strong {
        color: #dedddb;
        font-size: 13px;
        font-weight: 520;
      }

      body.rgv-card-wallet-thankyou-page .rgv-thankyou-card__actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin-top: 24px;
      }

      body.rgv-card-wallet-thankyou-page .rgv-thankyou-card__actions a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 50px;
        padding: 12px 18px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 550;
        text-decoration: none !important;
      }

      body.rgv-card-wallet-thankyou-page .rgv-thankyou-card__account {
        border: 1px solid #aa3943;
        background: var(--rgv-pay-accent);
        color: #ffffff !important;
      }

      body.rgv-card-wallet-thankyou-page .rgv-thankyou-card__store {
        border: 1px solid rgba(255, 255, 255, .15);
        background: rgba(255, 255, 255, .02);
        color: #d8d7d5 !important;
      }

      body.rgv-card-wallet-thankyou-page .rgv-thankyou-card__redirect {
        margin: 18px 0 0;
        color: #858792;
        font-size: 10px;
      }

      @media (max-width: 700px) {
        body.rgv-card-wallet-thankyou-page .rgv-pay-nav__inner {
          grid-template-columns: 1fr auto;
          width: calc(100% - 36px);
          min-height: 66px;
        }

        body.rgv-card-wallet-thankyou-page .rgv-pay-nav__secure {
          display: none;
        }

        body.rgv-card-wallet-thankyou-page .rgv-pay-nav__brand img {
          width: 116px;
        }

        body.rgv-card-wallet-thankyou-page .rgv-pay-nav__back {
          min-height: 36px;
          padding: 8px 10px;
        }

        body.rgv-card-wallet-thankyou-page .woocommerce {
          width: calc(100% - 24px) !important;
          margin: 28px auto 48px !important;
        }

        body.rgv-card-wallet-thankyou-page .rgv-thankyou-card {
          padding: 32px 20px 24px;
        }

        body.rgv-card-wallet-thankyou-page .rgv-thankyou-card__actions,
        body.rgv-card-wallet-thankyou-page .rgv-thankyou-card__meta {
          grid-template-columns: minmax(0, 1fr);
        }
      }
CSS;
  }

  public function return_paid_storefront_order($order_id) {
    $order = wc_get_order($order_id);
    if (!$this->is_storefront_card_wallet_order($order)) {
      return;
    }

    $provided_key = isset($_GET['key']) ? wc_clean(wp_unslash($_GET['key'])) : '';
    if (!$provided_key || !hash_equals((string) $order->get_order_key(), (string) $provided_key)) {
      return;
    }

    if (!$order->is_paid() && !in_array($order->get_status(), ['processing', 'completed'], true)) {
      return;
    }

    $storefront = $this->storefront_url();
    if (!$storefront) {
      return;
    }

    $account_url = trailingslashit($storefront) . 'account';
    $store_url = trailingslashit($storefront);

    echo '<section class="rgv-thankyou-card" aria-labelledby="rgv-thankyou-title">';
    echo '<div class="rgv-thankyou-card__icon" aria-hidden="true">&#10003;</div>';
    echo '<p class="rgv-thankyou-card__eyebrow">Payment confirmed</p>';
    echo '<h1 id="rgv-thankyou-title">Thank you for your order.</h1>';
    echo '<p class="rgv-thankyou-card__copy">Your payment was received successfully. You can review the order and its progress from your account.</p>';
    echo '<div class="rgv-thankyou-card__meta">';
    echo '<div><span>Order</span><strong>#' . esc_html((string) $order->get_order_number()) . '</strong></div>';
    echo '<div><span>Total</span><strong>' . wp_kses_post($order->get_formatted_order_total()) . '</strong></div>';
    echo '</div>';
    echo '<div class="rgv-thankyou-card__actions">';
    echo '<a class="rgv-thankyou-card__account" href="' . esc_url($account_url) . '">Go to my account</a>';
    echo '<a class="rgv-thankyou-card__store" href="' . esc_url($store_url) . '">Back to store</a>';
    echo '</div>';
    echo '<p class="rgv-thankyou-card__redirect" role="status">Taking you to your account in <span data-rgv-countdown>5</span> seconds.</p>';
    echo '</section>';
    echo '<script>(function(){var remaining=5;var counter=document.querySelector("[data-rgv-countdown]");var timer=window.setInterval(function(){remaining-=1;if(counter)counter.textContent=String(Math.max(remaining,0));if(remaining<=0)window.clearInterval(timer);},1000);window.setTimeout(function(){window.location.replace(' . wp_json_encode(esc_url_raw($account_url)) . ');},5000);}());</script>';
  }

  private function storefront_url() {
    $configured = defined('RGV_STOREFRONT_URL') ? RGV_STOREFRONT_URL : get_option('rgv_storefront_url', 'https://rgvprimellc.com');
    $url = untrailingslashit(esc_url_raw((string) $configured));
    if (!$url || 'https' !== wp_parse_url($url, PHP_URL_SCHEME)) {
      return '';
    }

    return $url;
  }

  private function is_storefront_card_wallet_order($order) {
    if (!$order instanceof WC_Order || self::PAYMENT_METHOD !== $order->get_payment_method()) {
      return false;
    }

    return in_array(
      (string) $order->get_meta('_rgv_payment_source'),
      ['rgv_custom_checkout_card_wallets', 'rgv_custom_checkout_prism'],
      true
    );
  }

  private function payment_request_order_id() {
    $posted = isset($_POST['order_id']) && is_scalar($_POST['order_id'])
      ? absint(wp_unslash($_POST['order_id']))
      : 0;
    if ($posted > 0) {
      return $posted;
    }

    return function_exists('get_query_var') ? absint(get_query_var('order-pay', 0)) : 0;
  }

  private function payment_request_order_key() {
    if (isset($_POST['order_key']) && is_string($_POST['order_key'])) {
      return wc_clean(wp_unslash($_POST['order_key']));
    }
    if (isset($_GET['key']) && is_string($_GET['key'])) {
      return wc_clean(wp_unslash($_GET['key']));
    }

    return '';
  }

  private function is_checkout_surface() {
    return (function_exists('is_checkout') && is_checkout()) ||
      (function_exists('is_checkout_pay_page') && is_checkout_pay_page()) ||
      (function_exists('is_order_received_page') && is_order_received_page());
  }

  private function is_storefront_payment_request() {
    if (!function_exists('is_checkout_pay_page') || !is_checkout_pay_page()) {
      return false;
    }

    $order_id = $this->payment_request_order_id();
    $provided_key = $this->payment_request_order_key();
    if (!$order_id || !$provided_key) {
      return false;
    }

    $order = wc_get_order($order_id);
    return $this->is_storefront_card_wallet_order($order) &&
      hash_equals((string) $order->get_order_key(), (string) $provided_key);
  }

  private function is_storefront_receipt_request() {
    if (!function_exists('is_order_received_page') || !is_order_received_page()) {
      return false;
    }

    $order_id = function_exists('get_query_var') ? absint(get_query_var('order-received', 0)) : 0;
    $provided_key = $this->payment_request_order_key();
    if (!$order_id || !$provided_key) {
      return false;
    }

    $order = wc_get_order($order_id);
    return $this->is_storefront_card_wallet_order($order) &&
      hash_equals((string) $order->get_order_key(), (string) $provided_key);
  }
}

add_action('before_woocommerce_init', static function () {
  if (class_exists('\Automattic\WooCommerce\Utilities\FeaturesUtil')) {
    \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility(
      'custom_order_tables',
      __FILE__,
      true
    );
  }
});

add_action('plugins_loaded', static function () {
  if (class_exists('WooCommerce')) {
    new RGV_Storefront_Card_Wallet_Return();
  }
});
