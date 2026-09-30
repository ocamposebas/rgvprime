<?php
/**
 * Plugin Name: RGV Storefront Card & Wallet Return
 * Description: Provides a closed, branded card and wallet checkout handoff for the RGVPRIME storefront.
 * Version: 3.8.3
 * Author: RGVPRIME LLC
 * Requires at least: 6.5
 * Requires PHP: 8.1
 * WC requires at least: 8.5
 * WC tested up to: 10.9
 */

defined('ABSPATH') || exit;

final class RGV_Storefront_Card_Wallet_Return {
  const VERSION = '3.8.3';
  const PAYMENT_METHOD = 'psc';
  const RECONCILE_HOOK = 'rgv_reconcile_storefront_payment';

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
    add_action('template_redirect', [$this, 'isolate_payment_order_session'], 5);
    add_action('template_redirect', [$this, 'schedule_pending_payment_reconciliation'], 20);
    add_action(self::RECONCILE_HOOK, [$this, 'reconcile_storefront_payment'], 10, 2);
    add_action('wp_ajax_rgv_release_failed_payment', [$this, 'release_failed_payment']);
    add_action('wp_ajax_nopriv_rgv_release_failed_payment', [$this, 'release_failed_payment']);
    add_action('wp_enqueue_scripts', [$this, 'enqueue_storefront_checkout'], 100);
    add_action('wp_body_open', [$this, 'render_payment_nav'], 5, 0);
    add_action('before_woocommerce_pay_form', [$this, 'render_payment_header'], 5, 0);
    add_action('woocommerce_thankyou', [$this, 'return_paid_storefront_order'], 1000);
  }

  /**
   * Provider recovery data is stored in the Woo session. A buyer opening a
   * completely different signed order-pay URL must not inherit a stale lock
   * from an earlier order. The earlier order and its payment metadata remain
   * intact for background reconciliation; only this browser's checkout state
   * is detached so the new order can create its own payment attempt.
   */
  public function isolate_payment_order_session() {
    if (
      !$this->is_storefront_payment_request() ||
      !function_exists('WC') ||
      !WC()->session
    ) {
      return;
    }

    $current_order_id = $this->payment_request_order_id();
    if ($current_order_id < 1) {
      return;
    }

    $session = WC()->session;
    $pending = $session->get('psc_confirm_pending');
    $recovery = $session->get('psc_recovery');
    $attempt = $session->get('psc_attempt');
    $detached_order_ids = [];

    if (is_array($pending)) {
      $pending_order_id = absint($pending['order_id'] ?? 0);
      if ($pending_order_id > 0 && $pending_order_id !== $current_order_id) {
        $detached_order_ids[] = $pending_order_id;
        $session->set('psc_confirm_pending', null);
      }
    }

    if (is_array($recovery)) {
      $recovery_order_id = absint($recovery['orderId'] ?? 0);
      if ($recovery_order_id > 0 && $recovery_order_id !== $current_order_id) {
        $detached_order_ids[] = $recovery_order_id;
        $session->set('psc_recovery', null);
      }
    }

    if (is_array($attempt)) {
      $attempt_order_id = absint($attempt['woo_order_id'] ?? 0);
      if ($attempt_order_id > 0 && $attempt_order_id !== $current_order_id) {
        $detached_order_ids[] = $attempt_order_id;
        $session->set('psc_attempt', null);
      }
    }

    if (!$detached_order_ids) {
      return;
    }

    $session->set('psc_checkout_cycle', null);
    $session->set('psc_blocks_payment_data', null);

    if (function_exists('wc_get_logger')) {
      wc_get_logger()->info(
        sprintf(
          'Detached stale checkout state from order(s) %s before opening independent order #%d.',
          implode(',', array_unique(array_map('absint', $detached_order_ids))),
          $current_order_id
        ),
        ['source' => 'rgv-card-wallet-return']
      );
    }
  }

  /**
   * Release a payment that the provider has definitively marked failed or
   * canceled. This endpoint never releases processing/attention payments.
   */
  public function release_failed_payment() {
    if (!check_ajax_referer('rgv_retry_failed_payment', 'nonce', false)) {
      wp_send_json_error(['message' => 'The secure retry request expired. Refresh and try again.'], 403);
    }

    if (
      !function_exists('wc_get_order') ||
      !class_exists('PrismSimpleCheckout\\Plugin') ||
      !class_exists('PrismSimpleCheckout\\Completion') ||
      !class_exists('PrismSimpleCheckout\\Rest_Routes')
    ) {
      wp_send_json_error(['message' => 'Payment status is temporarily unavailable.'], 503);
    }

    $order_id = absint($_POST['order_id'] ?? 0);
    $order_key = isset($_POST['order_key']) ? wc_clean(wp_unslash((string) $_POST['order_key'])) : '';
    $payment_id = isset($_POST['payment_id']) ? wc_clean(wp_unslash((string) $_POST['payment_id'])) : '';
    $order = wc_get_order($order_id);

    if (
      !$order instanceof WC_Order ||
      !$this->is_storefront_card_wallet_order($order) ||
      !$order_key ||
      !hash_equals((string) $order->get_order_key(), $order_key) ||
      !$payment_id ||
      !hash_equals((string) $order->get_meta('_psc_payment_id', true), $payment_id)
    ) {
      wp_send_json_error(['message' => 'The payment attempt does not match this order.'], 403);
    }

    $plugin = \PrismSimpleCheckout\Plugin::instance();
    $identity = \PrismSimpleCheckout\Completion::recovery_identity($order);
    $payment = $plugin->service_client()->get_payment($payment_id);

    if (is_wp_error($payment)) {
      $error_data = $payment->get_error_data();
      $missing = 404 === (int) (is_array($error_data) ? ($error_data['status'] ?? 0) : 0);
      if (!$missing || !str_starts_with($payment_id, 'pending_')) {
        wp_send_json_error(['message' => 'Payment status is still being verified.'], 409);
      }
      $released = $plugin->completion()->finish_unpaid($order, $identity);
    } else {
      $status = (string) ($payment['status'] ?? '');
      if ('succeeded' === $status) {
        $plugin->reconciler()->reconcile_order($order);
        $fresh = wc_get_order($order_id);
        if ($fresh instanceof WC_Order && $fresh->is_paid()) {
          wp_send_json_success([
            'paid' => true,
            'redirect' => $fresh->get_checkout_order_received_url(),
          ]);
        }
        wp_send_json_error(['message' => 'Payment was received and is being finalized.'], 409);
      }

      if (!in_array($status, ['failed', 'canceled'], true)) {
        wp_send_json_error(['message' => 'Payment status is still being verified.'], 409);
      }

      $terminal_payment = $payment;
      if ('failed' === $status) {
        $terminal_payment['status'] = 'canceled';
        $order->add_order_note('Payment processor confirmed a terminal failed attempt. Checkout released for retry.');
        $order->save();
      }
      $released = $plugin->completion()->finish_unpaid($order, $identity, $terminal_payment);
    }

    if (!$released) {
      wp_send_json_error(['message' => 'Payment status is still being verified.'], 409);
    }

    \PrismSimpleCheckout\Rest_Routes::clear_matching_recovery($identity);
    $fresh = wc_get_order($order_id);
    if (!$fresh instanceof WC_Order || $fresh->is_paid() || !$fresh->needs_payment()) {
      wp_send_json_error(['message' => 'The order is no longer available for payment.'], 409);
    }

    wp_send_json_success([
      'released' => true,
      'retry_url' => $fresh->get_checkout_payment_url(),
    ]);
  }

  /**
   * A provider confirmation can legitimately return before its final payment
   * status is available. Queue a focused, session-free status check for this
   * exact order instead of making the buyer wait for the broad five-minute
   * reconciliation sweep.
   */
  public function schedule_pending_payment_reconciliation() {
    if (!$this->is_storefront_payment_request() || !function_exists('wc_get_order')) {
      return;
    }

    $order = wc_get_order($this->payment_request_order_id());
    if (
      !$order instanceof WC_Order ||
      !$this->is_storefront_card_wallet_order($order) ||
      $order->is_paid() ||
      '' === (string) $order->get_meta('_psc_payment_id', true)
    ) {
      return;
    }

    for ($queued_attempt = 0; $queued_attempt <= 20; $queued_attempt++) {
      if (wp_next_scheduled(self::RECONCILE_HOOK, [(int) $order->get_id(), $queued_attempt])) {
        return;
      }
    }

    wp_schedule_single_event(time() + 1, self::RECONCILE_HOOK, [(int) $order->get_id(), 0]);
  }

  /**
   * Ask the provider for the existing payment's state. This never creates or
   * confirms a payment; it can only reconcile the order already on hold.
   */
  public function reconcile_storefront_payment($order_id, $attempt = 0) {
    if (
      !function_exists('wc_get_order') ||
      !class_exists('PrismSimpleCheckout\\Plugin')
    ) {
      return;
    }

    $order = wc_get_order(absint($order_id));
    if (
      !$order instanceof WC_Order ||
      !$this->is_storefront_card_wallet_order($order) ||
      $order->is_paid() ||
      '' === (string) $order->get_meta('_psc_payment_id', true)
    ) {
      return;
    }

    try {
      $plugin = \PrismSimpleCheckout\Plugin::instance();
      $reconciler = $plugin->reconciler();
      $result = $reconciler->reconcile_order($order);
    } catch (Throwable $error) {
      $result = 'ambiguous';
    }

    $attempt = max(0, absint($attempt));
    if (!in_array($result, ['pending', 'ambiguous'], true) || $attempt >= 20) {
      return;
    }

    $next_args = [(int) $order->get_id(), $attempt + 1];
    if (!wp_next_scheduled(self::RECONCILE_HOOK, $next_args)) {
      $delay = min(60, 5 * (2 ** $attempt));
      wp_schedule_single_event(time() + $delay, self::RECONCILE_HOOK, $next_args);
    }
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
      layout: { maxColumns: 2, overflow: 'never' },
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
    if (!controller) return false;

    if (!controller.__rgvFreshAttemptFactory && typeof controller.createController === 'function') {
      var originalControllerFactory = controller.createController.bind(controller);
      controller.createController = function (dependencies) {
        var checkoutController = originalControllerFactory(dependencies);
        if (checkoutController && !checkoutController.__rgvFreshPaymentData && typeof checkoutController.paymentData === 'function') {
          var originalPaymentData = checkoutController.paymentData.bind(checkoutController);
          checkoutController.paymentData = function (kind) {
            // The research record is session-bound and can be replaced by a
            // second checkout tab. Revalidate the provider attempt immediately
            // before token creation so a stale tab can never reach Woo submit.
            if (typeof checkoutController.markAttemptForRevalidation === 'function') {
              checkoutController.markAttemptForRevalidation();
            }
            return originalPaymentData(kind);
          };
          checkoutController.__rgvFreshPaymentData = true;
        }
        window.__rgvCheckoutControllerInstance = checkoutController;
        return checkoutController;
      };
      controller.__rgvFreshAttemptFactory = true;
    }

    if (!controller.__rgvCardOnlyOptions && typeof controller.paymentElementOptions === 'function') {
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
          wallets: { applePay: 'never', googlePay: 'never', link: 'never' }
        });
      };
      if (typeof controller.expressCheckoutOptions === 'function') {
        var originalExpressOptions = controller.expressCheckoutOptions.bind(controller);
        controller.expressCheckoutOptions = function (policy) {
          return expressCheckoutOptions(originalExpressOptions(policy));
        };
      }
      controller.__rgvCardOnlyOptions = true;
    }

    return !!(controller.__rgvCardOnlyOptions && controller.__rgvFreshAttemptFactory);
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
    var controllerReady = patchController() || !!(
      window.PSCCheckoutController &&
      window.PSCCheckoutController.__rgvCardOnlyOptions &&
      window.PSCCheckoutController.__rgvFreshAttemptFactory
    );
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
    $recovery_order = wc_get_order($this->payment_request_order_id());
    $fallback_recovery = null;
    if ($recovery_order instanceof WC_Order && !$recovery_order->is_paid()) {
      $fallback_payment_id = (string) $recovery_order->get_meta('_psc_payment_id', true);
      if ('' !== $fallback_payment_id) {
        $fallback_recovery = [
          'orderId' => (int) $recovery_order->get_id(),
          'orderKey' => (string) $recovery_order->get_order_key(),
          'paymentId' => $fallback_payment_id,
        ];
      }
    }

    wp_localize_script(
      'rgv-order-pay',
      'rgvPaymentRecovery',
      [
        'ajaxUrl' => admin_url('admin-ajax.php'),
        'retryNonce' => wp_create_nonce('rgv_retry_failed_payment'),
        'recovery' => $fallback_recovery,
      ]
    );
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
