<?php
/**
 * Plugin Name: RGV Storefront Card & Wallet Return
 * Description: Keeps card and wallet checkout customer-facing copy neutral and returns paid storefront orders to the Astro receipt page.
 * Version: 2.2.0
 * Author: RGVPRIME LLC
 * Requires at least: 6.5
 * Requires PHP: 8.1
 * WC requires at least: 8.5
 * WC tested up to: 10.9
 */

defined('ABSPATH') || exit;

final class RGV_Storefront_Card_Wallet_Return {
  const VERSION = '2.2.0';
  const PAYMENT_METHOD = 'psc';

  public function __construct() {
    add_filter('woocommerce_gateway_title', [$this, 'gateway_title'], 100, 2);
    add_filter('woocommerce_gateway_description', [$this, 'gateway_description'], 100, 2);
    add_filter('woocommerce_order_get_payment_method_title', [$this, 'order_payment_title'], 100, 2);
    add_filter('woocommerce_order_item_name', [$this, 'payment_order_item_name'], 100, 3);
    add_filter('woocommerce_available_payment_gateways', [$this, 'card_gateway_only'], 1000);
    add_filter('option_woocommerce_psc_settings', [$this, 'force_dark_gateway_theme'], 100);
    add_filter('gettext', [$this, 'neutral_frontend_copy'], 100, 3);
    add_filter('woocommerce_order_get_customer_id', [$this, 'allow_bearer_payment_session'], 1000, 2);
    add_filter('body_class', [$this, 'payment_page_body_class'], 100);
    add_action('template_redirect', [$this, 'redirect_public_wordpress_home'], 1);
    add_action('template_redirect', [$this, 'redirect_confirmed_receipt_early'], 2);
    add_action('wp_enqueue_scripts', [$this, 'neutralize_frontend_branding'], 100);
    add_action('wp_body_open', [$this, 'render_payment_nav'], 5, 0);
    add_action('before_woocommerce_pay_form', [$this, 'render_payment_header'], 5, 0);
    add_action('woocommerce_thankyou', [$this, 'return_paid_storefront_order'], 1000);
    add_action('admin_notices', [$this, 'hide_stale_prism_reconciliation_notices'], PHP_INT_MAX);
  }

  /**
   * Keep the WordPress admin usable without discarding payment diagnostics.
   *
   * PRISM deliberately persists exhausted-reconciliation alerts, which means
   * every old alert is printed on every admin page. Hide only that exact,
   * repetitive presentation. The option, WooCommerce log, order notes and
   * reconciliation state remain untouched for support and audit work.
   */
  public function hide_stale_prism_reconciliation_notices() {
    if (!is_admin() || !current_user_can('manage_woocommerce')) {
      return;
    }

    echo <<<'HTML'
<script id="rgv-hide-stale-prism-reconciliation-notices">
(function () {
  var pattern = /^PRISM could not resolve order #\d+ after \d+ reconciliation attempts\. Manual review required\.?$/i;
  document.querySelectorAll('.notice.notice-error').forEach(function (notice) {
    var message = String(notice.textContent || '').replace(/\s+/g, ' ').trim();
    if (!pattern.test(message)) return;
    notice.hidden = true;
    notice.setAttribute('aria-hidden', 'true');
  });
}());
</script>
HTML;
  }

  public function gateway_title($title, $gateway_id) {
    return self::PAYMENT_METHOD === (string) $gateway_id ? 'Card & Wallets' : $title;
  }

  public function gateway_description($description, $gateway_id) {
    if (self::PAYMENT_METHOD !== (string) $gateway_id) {
      return $description;
    }

    return 'Pay securely by card, Link, Apple Pay, or Google Pay when available.';
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
      return 'Card & Wallets';
    }

    return $title;
  }

  public function payment_order_item_name($name, $item, $is_visible) {
    if (
      !$this->is_storefront_payment_request() ||
      !$item instanceof WC_Order_Item_Product
    ) {
      return $name;
    }

    $product = $item->get_product();
    if (!$product instanceof WC_Product) {
      return $name;
    }

    $image_id = (int) $product->get_image_id();
    if (!$image_id && $product->is_type('variation')) {
      $parent = wc_get_product($product->get_parent_id());
      if ($parent instanceof WC_Product) {
        $image_id = (int) $parent->get_image_id();
      }
    }

    if ($image_id) {
      $image = wp_get_attachment_image($image_id, 'woocommerce_thumbnail', false, [
        'class' => 'rgv-order-product__image',
        'loading' => 'lazy',
        'decoding' => 'async',
      ]);
    } else {
      $image = function_exists('wc_placeholder_img')
        ? wc_placeholder_img('woocommerce_thumbnail', ['class' => 'rgv-order-product__image'])
        : '';
    }

    if (!$image) {
      return $name;
    }

    return '<span class="rgv-order-product"><span class="rgv-order-product__media">' .
      $image .
      '</span><span class="rgv-order-product__name">' .
      $name .
      '</span></span>';
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
      ['Card & Wallets', 'Card & Wallets', 'Secure checkout', 'Secure research verification', 'Loading secure verification'],
      (string) $translated
    );

    return preg_replace('/\bPRISM\b/i', 'secure checkout', $copy);
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
    if ($this->is_storefront_payment_request()) {
      wp_register_style('rgv-card-wallet-payment-page', false, [], self::VERSION);
      wp_enqueue_style('rgv-card-wallet-payment-page');
      wp_add_inline_style('rgv-card-wallet-payment-page', $css . $this->payment_page_css());
    }

    $script = <<<'JS'
(function () {
  var replacements = [
    [/PRISM Secure Checkout/gi, 'Card & Wallets'],
    [/PRISM Fall Checkout/gi, 'Card & Wallets'],
    [/Powered by PRISM/gi, 'Secure checkout'],
    [/PRISM research verification/gi, 'Secure research verification'],
    [/Loading PRISM verification/gi, 'Loading secure verification'],
    [/\bPRISM\b/gi, 'secure checkout']
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

  function start() {
    neutralize(document.body);
    new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        if (mutation.type === 'characterData' && mutation.target.parentElement) {
          neutralize(mutation.target.parentElement);
        }
        mutation.addedNodes.forEach(function (node) {
          if (node.nodeType === 1) neutralize(node);
        });
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}());
JS;

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
    return array_values(array_unique($classes));
  }

  /**
   * The WordPress host is a payment handoff, not a second storefront. Keep
   * administrative, API, webhook and checkout routes untouched; only its
   * public home redirects to the customer-facing store.
   */
  public function redirect_public_wordpress_home() {
    if (
      is_admin() ||
      wp_doing_ajax() ||
      (defined('REST_REQUEST') && REST_REQUEST) ||
      (defined('DOING_CRON') && DOING_CRON) ||
      (defined('WP_CLI') && WP_CLI) ||
      (defined('XMLRPC_REQUEST') && XMLRPC_REQUEST) ||
      isset($_GET['wc-api']) ||
      isset($_GET['wc-ajax']) ||
      !in_array(strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')), ['GET', 'HEAD'], true) ||
      $this->is_checkout_surface() ||
      (!is_front_page() && !is_home())
    ) {
      return;
    }

    $storefront = $this->storefront_url();
    if (!$storefront) {
      return;
    }

    wp_safe_redirect($storefront, 302, 'RGVPRIME Storefront');
    exit;
  }

  /**
   * Send a verified paid Card & Wallets order back to the storefront before
   * WordPress renders its theme-based order confirmation page.
   */
  public function redirect_confirmed_receipt_early() {
    if (
      is_admin() ||
      wp_doing_ajax() ||
      (defined('REST_REQUEST') && REST_REQUEST) ||
      !in_array(strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')), ['GET', 'HEAD'], true) ||
      !function_exists('is_order_received_page') ||
      !is_order_received_page()
    ) {
      return;
    }

    $order_id = function_exists('get_query_var') ? absint(get_query_var('order-received', 0)) : 0;
    $provided_key = $this->payment_request_order_key();
    if (!$order_id || !$provided_key) {
      return;
    }

    $order = wc_get_order($order_id);
    if (
      !$this->is_storefront_card_wallet_order($order) ||
      !hash_equals((string) $order->get_order_key(), (string) $provided_key) ||
      (!$order->is_paid() && !$order->has_status(['processing', 'completed']))
    ) {
      return;
    }

    $target = $this->storefront_receipt_url($order);
    if (!$target) {
      return;
    }

    nocache_headers();
    wp_redirect($target, 303, 'RGVPRIME Receipt');
    exit;
  }

  public function render_payment_nav() {
    if (!$this->is_storefront_payment_request()) {
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
    echo '<h1 id="rgv-payment-title">Finish your order</h1>';
    echo '<p class="rgv-payment-intro__copy">Your order is ready. Choose a secure payment method to complete it.</p>';
    echo '</section>';
  }

  private function payment_page_css() {
    return <<<'CSS'

      body.rgv-card-wallet-payment-page {
        --rgv-pay-bg: #090a0c;
        --rgv-pay-surface: #101114;
        --rgv-pay-surface-raised: #15161a;
        --rgv-pay-text: #ededeb;
        --rgv-pay-muted: #9698a1;
        --rgv-pay-border: rgba(255, 255, 255, 0.13);
        --rgv-pay-border-strong: rgba(255, 255, 255, 0.22);
        --rgv-pay-accent: #8f1d27;
        --rgv-pay-accent-hover: #a12a33;
        background: var(--rgv-pay-bg) !important;
        color: var(--rgv-pay-text) !important;
        min-height: 100svh;
        background-image: linear-gradient(145deg, rgba(73, 20, 26, .075), transparent 42%) !important;
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
        width: min(100% - 36px, 1040px) !important;
        max-width: 1040px !important;
        margin: 48px auto 72px !important;
        color: var(--rgv-pay-text) !important;
        font-family: inherit;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro {
        margin: 0 0 28px;
        padding: 0 0 28px;
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
        font-size: clamp(34px, 5vw, 54px);
        font-weight: 450;
        letter-spacing: -.05em;
        line-height: 1.08;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__copy {
        max-width: 620px;
        margin: 14px 0 0;
        color: var(--rgv-pay-muted) !important;
        font-size: 14px;
        line-height: 1.7;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__trust {
        display: flex;
        flex-wrap: wrap;
        gap: 10px 22px;
        margin-top: 18px;
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
        border-radius: 18px;
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
        font-size: 13px;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table th {
        color: var(--rgv-pay-muted) !important;
        font-size: 11px;
        font-weight: 500;
        letter-spacing: .04em;
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
        font-size: 12px;
        line-height: 1.7;
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
        min-height: 50px;
        padding: 13px 20px !important;
        border: 1px solid #aa3943 !important;
        border-radius: 12px !important;
        background: var(--rgv-pay-accent) !important;
        color: #ffffff !important;
        font-size: 13px !important;
        font-weight: 600 !important;
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

      /* The signed card handoff has one purpose: card and supported wallets. */
      body.rgv-card-wallet-payment-page form#order_review,
      body.rgv-card-wallet-payment-page .woocommerce-order-pay #order_review {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 350px;
        gap: 26px;
        overflow: visible;
        border: 0 !important;
        border-radius: 0;
        background: transparent !important;
        box-shadow: none;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table {
        position: sticky;
        top: 24px;
        grid-column: 2;
        grid-row: 1;
        align-self: start;
        overflow: hidden;
        border: 1px solid var(--rgv-pay-border) !important;
        border-radius: 18px !important;
        background: #111215 !important;
      }

      body.rgv-card-wallet-payment-page #payment {
        grid-column: 1;
        grid-row: 1;
        align-self: start;
        padding: 28px 26px 24px !important;
        border: 1px solid var(--rgv-pay-border) !important;
        border-radius: 18px !important;
        background: #101114 !important;
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
        margin-bottom: 8px !important;
        font-size: 17px;
        font-weight: 450;
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

      body.rgv-card-wallet-payment-page #place_order,
      body.rgv-card-wallet-payment-page #payment .button.alt {
        width: 100% !important;
      }

      @media (max-width: 960px) {
        body.rgv-card-wallet-payment-page .rgv-pay-nav__inner {
          width: calc(100% - 64px);
        }

        body.rgv-card-wallet-payment-page form#order_review,
        body.rgv-card-wallet-payment-page .woocommerce-order-pay #order_review {
          grid-template-columns: minmax(0, 1fr);
          gap: 20px;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table {
          position: static;
          grid-column: 1;
          grid-row: 1;
        }

        body.rgv-card-wallet-payment-page #payment {
          grid-column: 1;
          grid-row: 2;
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

        body.rgv-card-wallet-payment-page .rgv-pay-nav__back {
          min-height: 36px;
          padding: 8px 10px;
        }

        body.rgv-card-wallet-payment-page .woocommerce {
          width: min(100% - 24px, 1040px) !important;
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
          padding: 20px 14px 16px !important;
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

        body.rgv-card-wallet-payment-page #payment {
          padding: 22px 16px 18px !important;
        }
      }

      /*
       * Visual-only layout correction.
       *
       * The payment provider keeps its secure fields as a direct child of
       * #order_review so its iframes and event handlers remain untouched. The
       * original two-column grid did not assign that child a row, allowing it
       * to fall below the full height of the order summary. These overrides
       * explicitly compose the existing WooCommerce and provider nodes into a
       * traditional payment card without hiding, moving, or replacing any
       * payment method or control.
       */
      body.rgv-card-wallet-payment-page .woocommerce {
        width: min(100% - 40px, 1120px) !important;
        max-width: 1120px !important;
      }

      body.rgv-card-wallet-payment-page form#order_review,
      body.rgv-card-wallet-payment-page .woocommerce-order-pay #order_review {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) minmax(340px, 380px);
        grid-template-rows: auto auto auto auto;
        column-gap: 24px;
        row-gap: 0;
        align-items: start;
        align-content: start;
        overflow: visible !important;
      }

      body.rgv-card-wallet-payment-page form#order_review > #payment {
        display: contents !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        background: transparent !important;
      }

      body.rgv-card-wallet-payment-page form#order_review > #payment > ul.payment_methods {
        box-sizing: border-box;
        grid-column: 1;
        grid-row: 1;
        min-width: 0;
        margin: 0 !important;
        padding: 24px 24px 14px !important;
        border: 1px solid var(--rgv-pay-border) !important;
        border-bottom: 0 !important;
        border-radius: 16px 16px 0 0 !important;
        background: var(--rgv-pay-surface) !important;
      }

      body.rgv-card-wallet-payment-page form#order_review > :is(#psc-checkout-root, #psc-checkout) {
        box-sizing: border-box;
        grid-column: 1;
        grid-row: 2;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 0 24px 18px !important;
        overflow: visible !important;
        border: 0 !important;
        border-right: 1px solid var(--rgv-pay-border) !important;
        border-left: 1px solid var(--rgv-pay-border) !important;
        border-radius: 0 !important;
        background: var(--rgv-pay-surface) !important;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page form#order_review > #psc-checkout-root > .psc-checkout,
      body.rgv-card-wallet-payment-page form#order_review > #psc-checkout {
        box-sizing: border-box;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 16px !important;
        overflow: visible !important;
        border: 1px solid var(--rgv-pay-border) !important;
        border-radius: 12px !important;
        background: var(--rgv-pay-surface-raised) !important;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page form#order_review :is(#psc-checkout-root, #psc-checkout) :where(*) {
        min-width: 0;
        max-width: 100%;
      }

      body.rgv-card-wallet-payment-page form#order_review :is(#psc-checkout-root, #psc-checkout) iframe {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        border: 0 !important;
      }

      body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row.place-order {
        box-sizing: border-box;
        grid-column: 1;
        grid-row: 3;
        width: 100%;
        min-width: 0;
        margin: 0 !important;
        padding: 18px 24px 24px !important;
        border: 1px solid var(--rgv-pay-border) !important;
        border-top: 0 !important;
        border-radius: 0 0 16px 16px !important;
        background: var(--rgv-pay-surface) !important;
      }

      body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row.place-order::before {
        display: block;
        width: 100%;
        margin: 0 0 18px;
        border-top: 1px solid var(--rgv-pay-border);
        content: "";
      }

      body.rgv-card-wallet-payment-page #place_order {
        width: 100% !important;
        min-height: 52px;
        margin: 0 !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table {
        position: sticky;
        top: 24px;
        grid-column: 2;
        grid-row: 1 / 4;
        align-self: start;
        width: 100% !important;
        min-width: 0;
        table-layout: fixed;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table :is(th, td):nth-child(2) {
        width: 48px;
        text-align: center;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table :is(th, td):last-child {
        width: 92px;
        text-align: right;
        white-space: nowrap;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table td:first-child {
        overflow-wrap: anywhere;
      }

      body.rgv-card-wallet-payment-page form#order_review > #psc-research-checkout[data-psc-step="complete"] {
        box-sizing: border-box;
        grid-column: 1;
        grid-row: 4;
        width: 100% !important;
        max-width: none !important;
        margin: 16px 0 0 !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-body {
        padding: 14px 18px !important;
      }

      @media (max-width: 960px) {
        body.rgv-card-wallet-payment-page form#order_review,
        body.rgv-card-wallet-payment-page .woocommerce-order-pay #order_review {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: auto auto auto auto auto;
          column-gap: 0;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table {
          position: static;
          grid-column: 1;
          grid-row: 1;
          margin-bottom: 18px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review > #payment > ul.payment_methods {
          grid-column: 1;
          grid-row: 2;
        }

        body.rgv-card-wallet-payment-page form#order_review > :is(#psc-checkout-root, #psc-checkout) {
          grid-column: 1;
          grid-row: 3;
        }

        body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row.place-order {
          grid-column: 1;
          grid-row: 4;
        }

        body.rgv-card-wallet-payment-page form#order_review > #psc-research-checkout[data-psc-step="complete"] {
          grid-column: 1;
          grid-row: 5;
        }
      }

      @media (max-width: 700px) {
        body.rgv-card-wallet-payment-page .woocommerce {
          width: calc(100% - 24px) !important;
        }

        body.rgv-card-wallet-payment-page form#order_review > #payment > ul.payment_methods {
          padding: 18px 16px 12px !important;
          border-radius: 14px 14px 0 0 !important;
        }

        body.rgv-card-wallet-payment-page form#order_review > :is(#psc-checkout-root, #psc-checkout) {
          padding: 0 16px 14px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review > #psc-checkout-root > .psc-checkout,
        body.rgv-card-wallet-payment-page form#order_review > #psc-checkout {
          padding: 12px !important;
          border-radius: 10px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row.place-order {
          padding: 14px 16px 18px !important;
          border-radius: 0 0 14px 14px !important;
        }
      }

      /*
       * Premium visual polish — presentation only.
       *
       * This final layer changes color, typography, spacing and grid placement
       * only. Provider controls, iframes, methods, errors and the WooCommerce
       * submit lifecycle remain visible and untouched.
       */
      body.rgv-card-wallet-payment-page {
        --rgv-pay-bg: #08090a;
        --rgv-pay-surface: #111215;
        --rgv-pay-surface-raised: #0d0e11;
        --rgv-pay-text: #f4f3f1;
        --rgv-pay-muted: #9b9da5;
        --rgv-pay-border: rgba(255, 255, 255, .105);
        --rgv-pay-border-strong: rgba(255, 255, 255, .16);
        --rgv-pay-accent: #7d272d;
        --rgv-pay-accent-hover: #8d3037;
        --rgv-pay-accent-border: #9b4046;
        --rgv-pay-accent-soft: #d08b86;
        margin: 0 !important;
        overflow-x: clip;
        background:
          radial-gradient(circle at 18% -12%, rgba(125, 39, 45, .10), transparent 31rem),
          #08090a !important;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        font-weight: 400;
        line-height: 1.5;
        text-rendering: geometricPrecision;
      }

      html:has(body.rgv-card-wallet-payment-page) {
        margin-top: 0 !important;
        background: #08090a !important;
      }

      body.rgv-card-wallet-payment-page *,
      body.rgv-card-wallet-payment-page *::before,
      body.rgv-card-wallet-payment-page *::after {
        box-sizing: border-box;
      }

      body.rgv-card-wallet-payment-page #wpadminbar {
        display: none !important;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav {
        border-bottom-color: rgba(255, 255, 255, .075);
        background: rgba(8, 9, 10, .96);
        backdrop-filter: blur(18px);
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__inner {
        grid-template-columns: 1fr auto;
        width: min(1120px, calc(100% - 48px));
        min-height: 64px;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__brand {
        display: block;
        width: 122px;
        min-width: 0;
        color: transparent !important;
        font-size: 0;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__brand img {
        display: block;
        width: 122px;
        height: 36px;
        object-fit: contain;
        object-position: left center;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__brand span,
      body.rgv-card-wallet-payment-page .rgv-pay-nav__secure {
        display: none !important;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__back {
        min-height: 38px;
        padding: 0 13px;
        border-color: var(--rgv-pay-border);
        border-radius: 10px;
        background: rgba(255, 255, 255, .018);
        color: #d8d7d4 !important;
        font-size: 11px;
        font-weight: 500;
        transition: border-color .18s ease, background .18s ease, transform .18s ease;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__back:hover {
        border-color: rgba(155, 64, 70, .68);
        background: rgba(125, 39, 45, .16);
        transform: translateY(-1px);
      }

      body.rgv-card-wallet-payment-page .woocommerce {
        width: min(1120px, calc(100% - 48px)) !important;
        max-width: 1120px !important;
        margin: 36px auto 64px !important;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro {
        margin: 0 0 26px;
        padding: 0 0 24px;
        border-bottom-color: var(--rgv-pay-border);
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__eyebrow {
        display: flex;
        align-items: center;
        gap: 9px;
        margin: 0 0 10px !important;
        color: var(--rgv-pay-accent-soft) !important;
        font-size: 9px;
        font-weight: 650;
        letter-spacing: .12em;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__eyebrow > span {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #78c98a;
        box-shadow: 0 0 0 4px rgba(120, 201, 138, .09);
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro h1 {
        max-width: 680px;
        font-size: clamp(36px, 4vw, 48px);
        font-weight: 480;
        letter-spacing: -.045em;
        line-height: 1.04;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__copy {
        margin-top: 11px;
        color: var(--rgv-pay-muted) !important;
        font-size: 12.5px;
        line-height: 1.65;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__trust {
        gap: 16px;
        margin-top: 13px;
        color: #b5b6bc;
        font-size: 9.5px;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__trust span {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__trust span::before {
        display: none;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__trust b {
        display: grid;
        width: 14px;
        height: 14px;
        place-items: center;
        border: 1px solid rgba(120, 201, 138, .24);
        border-radius: 50%;
        background: rgba(120, 201, 138, .06);
        color: #78c98a;
        font-size: 7px;
      }

      /* First verification screen: one calm panel with flat, readable rows. */
      body.rgv-card-wallet-payment-page #psc-research-checkout:not([data-psc-step="complete"]) {
        width: min(680px, calc(100% - 32px)) !important;
        max-width: 680px !important;
        margin: 34px auto 64px !important;
        font-family: inherit !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout .psc-r-shell {
        border-color: var(--rgv-pay-border) !important;
        border-radius: 18px !important;
        background: var(--rgv-pay-surface) !important;
        box-shadow: 0 24px 68px rgba(0, 0, 0, .24) !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout .psc-r-header {
        min-height: 60px;
        padding: 17px 24px !important;
        border-color: var(--rgv-pay-border) !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout .psc-r-body {
        padding: 25px 26px 24px !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout h2 {
        margin-bottom: 6px !important;
        font-size: clamp(26px, 5vw, 34px) !important;
        font-weight: 480 !important;
        line-height: 1.08 !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout .psc-r-intro {
        margin-bottom: 18px !important;
        color: var(--rgv-pay-muted) !important;
        font-size: 11px !important;
        line-height: 1.6 !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout :is(.psc-r-check-all, .psc-r-declarations .psc-r-check) {
        min-height: 0 !important;
        margin: 0 !important;
        padding: 15px 2px !important;
        border: 0 !important;
        border-top: 1px solid var(--rgv-pay-border) !important;
        border-radius: 0 !important;
        background: transparent !important;
        color: #d8d7d4 !important;
        font-size: 11.5px !important;
        font-weight: 500 !important;
        line-height: 1.55 !important;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout .psc-r-declarations .psc-r-check:last-child {
        border-bottom: 1px solid var(--rgv-pay-border) !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout :is(.psc-r-check-all, .psc-r-declarations .psc-r-check):hover {
        border-color: var(--rgv-pay-border) !important;
        background: rgba(255, 255, 255, .014) !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout :is(.psc-r-check-all, .psc-r-declarations .psc-r-check):has(input:checked) {
        border-color: var(--rgv-pay-border) !important;
        background: rgba(125, 39, 45, .075) !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout .psc-r-primary {
        min-height: 50px !important;
        border-color: var(--rgv-pay-accent-border) !important;
        border-radius: 10px !important;
        background: var(--rgv-pay-accent) !important;
        font-size: 11px !important;
        font-weight: 650 !important;
      }

      /* Traditional desktop checkout: payment left, summary right. */
      body.rgv-card-wallet-payment-page form#order_review,
      body.rgv-card-wallet-payment-page .woocommerce-order-pay #order_review {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) minmax(330px, 360px);
        grid-template-rows: auto auto auto auto;
        column-gap: 28px;
        row-gap: 0;
        align-items: start;
        align-content: start;
        overflow: visible !important;
      }

      body.rgv-card-wallet-payment-page form#order_review > #payment {
        display: contents !important;
      }

      body.rgv-card-wallet-payment-page form#order_review > #payment > ul.payment_methods {
        grid-column: 1;
        grid-row: 1;
        min-width: 0;
        padding: 24px 26px 17px !important;
        border: 1px solid var(--rgv-pay-border) !important;
        border-bottom: 0 !important;
        border-radius: 16px 16px 0 0 !important;
        background: var(--rgv-pay-surface) !important;
        box-shadow: 0 18px 52px rgba(0, 0, 0, .16);
      }

      body.rgv-card-wallet-payment-page #payment .payment_method_psc > label {
        gap: 12px;
        margin-bottom: 7px !important;
        color: var(--rgv-pay-text) !important;
        font-size: 18px;
        font-weight: 540;
        letter-spacing: -.025em;
      }

      body.rgv-card-wallet-payment-page #payment .payment_method_psc > label::before {
        display: block;
        flex: 0 0 40px;
        width: 40px;
        height: 40px;
        border: 1px solid rgba(155, 64, 70, .34);
        border-radius: 11px;
        background:
          linear-gradient(var(--rgv-pay-accent-soft), var(--rgv-pay-accent-soft)) center 47% / 18px 1px no-repeat,
          rgba(125, 39, 45, .13);
        content: "";
      }

      body.rgv-card-wallet-payment-page .psc-gateway-description {
        margin: 0 0 2px 52px !important;
        color: var(--rgv-pay-muted) !important;
        font-size: 11.5px;
        line-height: 1.6;
      }

      /* Compact the already-completed verification without removing Edit. */
      body.rgv-card-wallet-payment-page form#order_review > #psc-research-checkout[data-psc-step="complete"] {
        grid-column: 1;
        grid-row: 2;
        width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        padding: 0 26px 15px !important;
        border-right: 1px solid var(--rgv-pay-border);
        border-left: 1px solid var(--rgv-pay-border);
        background: var(--rgv-pay-surface);
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-shell {
        overflow: hidden;
        border: 1px solid var(--rgv-pay-border) !important;
        border-radius: 11px !important;
        background: var(--rgv-pay-surface-raised) !important;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] :is(.psc-r-header, .psc-r-footer, .psc-r-progress, h2) {
        display: none !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-body {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 14px;
        padding: 13px 15px !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-recognized {
        display: flex !important;
        align-items: center;
        gap: 11px;
        min-width: 0;
        margin: 0 !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-checkmark {
        display: grid;
        flex: 0 0 30px;
        width: 30px !important;
        height: 30px !important;
        place-items: center;
        border-width: 1px !important;
        font-size: 12px !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-recognized strong {
        display: block;
        color: #e9e9e6 !important;
        font-size: 11.5px !important;
        line-height: 1.35;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-recognized div > span {
        display: block;
        overflow: hidden;
        color: #8f919a !important;
        font-size: 9px !important;
        line-height: 1.4;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] [data-action="edit"] {
        min-height: 32px;
        padding: 0 10px !important;
        border: 1px solid var(--rgv-pay-border) !important;
        border-radius: 8px !important;
        background: rgba(255, 255, 255, .025) !important;
        color: #c9c9c6 !important;
        font-size: 9px !important;
      }

      /* Provider frame only: secure elements and natural iframe heights stay intact. */
      body.rgv-card-wallet-payment-page form#order_review > :is(#psc-checkout-root, #psc-checkout) {
        grid-column: 1;
        grid-row: 3;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 0 26px 18px !important;
        overflow: visible !important;
        border: 0 !important;
        border-right: 1px solid var(--rgv-pay-border) !important;
        border-left: 1px solid var(--rgv-pay-border) !important;
        border-radius: 0 !important;
        background: var(--rgv-pay-surface) !important;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page form#order_review > #psc-checkout-root > .psc-checkout,
      body.rgv-card-wallet-payment-page form#order_review > #psc-checkout {
        --psc-surface: var(--rgv-pay-surface-raised);
        --psc-surface-2: #101114;
        --psc-text: var(--rgv-pay-text);
        --psc-text-muted: var(--rgv-pay-muted);
        --psc-border: var(--rgv-pay-border);
        --psc-accent: var(--rgv-pay-accent);
        --psc-accent-text: #fff;
        --psc-banner-bg: rgba(125, 39, 45, .13);
        --psc-banner-border: var(--rgv-pay-accent-border);
        --psc-banner-text: var(--rgv-pay-text);
        --psc-input-bg: #0b0c0f;
        --psc-input-text: var(--rgv-pay-text);
        --psc-input-border: #33343a;
        --psc-focus: var(--rgv-pay-accent-soft);
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 18px !important;
        overflow: visible !important;
        border: 1px solid var(--rgv-pay-border) !important;
        border-radius: 12px !important;
        background: var(--rgv-pay-surface-raised) !important;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, .018) !important;
      }

      @supports selector(:has(*)) {
        body.rgv-card-wallet-payment-page form#order_review > #psc-checkout-root:not(:has(iframe)) > .psc-checkout,
        body.rgv-card-wallet-payment-page form#order_review > #psc-checkout:not(:has(iframe)) {
          min-height: 250px;
        }
      }

      body.rgv-card-wallet-payment-page form#order_review > #psc-checkout-root:empty {
        display: grid;
        min-height: 220px;
        place-items: center;
        color: var(--rgv-pay-muted);
        font-size: 11px;
      }

      body.rgv-card-wallet-payment-page form#order_review > #psc-checkout-root:empty::before {
        content: "Preparing secure payment...";
      }

      body.rgv-card-wallet-payment-page form#order_review :is(#psc-checkout-root, #psc-checkout) :where(*) {
        min-width: 0;
        max-width: 100%;
      }

      body.rgv-card-wallet-payment-page form#order_review :is(#psc-checkout-root, #psc-checkout) iframe {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        border: 0 !important;
      }

      body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row.place-order {
        grid-column: 1;
        grid-row: 4;
        width: 100%;
        min-width: 0;
        margin: 0 !important;
        padding: 16px 26px 24px !important;
        border: 1px solid var(--rgv-pay-border) !important;
        border-top: 0 !important;
        border-radius: 0 0 16px 16px !important;
        background: var(--rgv-pay-surface) !important;
        box-shadow: 0 22px 62px rgba(0, 0, 0, .19);
      }

      body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row.place-order::before {
        margin-bottom: 16px;
        border-top-color: var(--rgv-pay-border);
      }

      body.rgv-card-wallet-payment-page #place_order {
        display: flex !important;
        align-items: center;
        justify-content: center;
        width: 100% !important;
        min-height: 52px;
        margin: 0 !important;
        border: 1px solid var(--rgv-pay-accent-border) !important;
        border-radius: 10px !important;
        background: var(--rgv-pay-accent) !important;
        color: #fff !important;
        font-size: 12.5px !important;
        font-weight: 650 !important;
        box-shadow: 0 13px 30px rgba(125, 39, 45, .18), inset 0 1px 0 rgba(255, 255, 255, .09) !important;
        transition: filter .18s ease, transform .18s ease, box-shadow .18s ease;
      }

      body.rgv-card-wallet-payment-page #place_order:hover {
        filter: brightness(1.08);
        transform: translateY(-1px);
      }

      /* Compact ledger-style order summary. */
      body.rgv-card-wallet-payment-page #order_review > table.shop_table {
        position: sticky;
        top: 22px;
        grid-column: 2;
        grid-row: 1 / 5;
        align-self: start;
        width: 100% !important;
        min-width: 0;
        table-layout: fixed;
        overflow: hidden;
        border: 1px solid var(--rgv-pay-border) !important;
        border-radius: 16px !important;
        background: var(--rgv-pay-surface) !important;
        box-shadow: 0 22px 62px rgba(0, 0, 0, .20);
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table thead {
        background: linear-gradient(90deg, rgba(125, 39, 45, .14), transparent 78%);
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table :is(th, td) {
        padding: 16px 18px !important;
        border-bottom-color: var(--rgv-pay-border) !important;
        font-size: 12px;
        line-height: 1.5;
        vertical-align: top;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table thead th {
        padding-top: 18px !important;
        padding-bottom: 14px !important;
        color: #a4a6ae !important;
        font-size: 8.5px;
        font-weight: 650;
        letter-spacing: .09em;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table td.product-name {
        overflow-wrap: anywhere;
        color: #e7e6e3 !important;
        font-weight: 560;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table :is(.wc-item-meta, dl.variation) {
        margin: 7px 0 0 !important;
        padding: 0 !important;
        color: var(--rgv-pay-muted) !important;
        font-size: 9.5px !important;
        font-weight: 400;
        line-height: 1.45;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table :is(.wc-item-meta p, dl.variation p) {
        margin: 0 !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table :is(th, td):nth-child(2) {
        width: 48px;
        text-align: center;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table :is(th, td):last-child {
        width: 90px;
        text-align: right;
        white-space: nowrap;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot th {
        color: var(--rgv-pay-muted) !important;
        font-size: 10px;
        font-weight: 520;
        letter-spacing: 0;
        text-transform: none;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot td {
        color: #e6e5e2 !important;
        font-size: 11px;
        font-weight: 580;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total {
        background: rgba(125, 39, 45, .065);
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total th {
        color: #f0efec !important;
        font-size: 12px;
        font-weight: 650;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total :is(td, .amount) {
        color: #fff !important;
        font-size: 21px !important;
        font-weight: 560 !important;
        letter-spacing: -.035em;
      }

      body.rgv-card-wallet-payment-page :is(.woocommerce-error, .woocommerce-message, .woocommerce-info),
      body.rgv-card-wallet-payment-page .psc-payment-message {
        border-radius: 11px !important;
        font-size: 11.5px !important;
        line-height: 1.55;
      }

      body.rgv-card-wallet-payment-page .woocommerce-error,
      body.rgv-card-wallet-payment-page .psc-payment-message {
        border: 1px solid rgba(155, 64, 70, .68) !important;
        background: rgba(125, 39, 45, .16) !important;
        color: #efc0ba !important;
      }

      @media (max-width: 960px) {
        body.rgv-card-wallet-payment-page form#order_review,
        body.rgv-card-wallet-payment-page .woocommerce-order-pay #order_review {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: auto auto auto auto auto;
          column-gap: 0;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table {
          position: static;
          grid-column: 1;
          grid-row: 1;
          margin-bottom: 18px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review > #payment > ul.payment_methods {
          grid-column: 1;
          grid-row: 2;
        }

        body.rgv-card-wallet-payment-page form#order_review > #psc-research-checkout[data-psc-step="complete"] {
          grid-column: 1;
          grid-row: 3;
        }

        body.rgv-card-wallet-payment-page form#order_review > :is(#psc-checkout-root, #psc-checkout) {
          grid-column: 1;
          grid-row: 4;
        }

        body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row.place-order {
          grid-column: 1;
          grid-row: 5;
        }
      }

      @media (max-width: 700px) {
        body.rgv-card-wallet-payment-page .rgv-pay-nav__inner {
          width: calc(100% - 28px);
          min-height: 60px;
        }

        body.rgv-card-wallet-payment-page .rgv-pay-nav__brand,
        body.rgv-card-wallet-payment-page .rgv-pay-nav__brand img {
          width: 106px;
          height: 31px;
        }

        body.rgv-card-wallet-payment-page .rgv-pay-nav__back {
          min-height: 34px;
          padding: 0 10px;
          font-size: 9.5px;
        }

        body.rgv-card-wallet-payment-page .woocommerce {
          width: calc(100% - 24px) !important;
          margin: 24px auto 42px !important;
        }

        body.rgv-card-wallet-payment-page .rgv-payment-intro {
          margin-bottom: 18px;
          padding-bottom: 20px;
        }

        body.rgv-card-wallet-payment-page .rgv-payment-intro h1 {
          font-size: clamp(31px, 10vw, 38px);
        }

        body.rgv-card-wallet-payment-page #psc-research-checkout:not([data-psc-step="complete"]) {
          width: calc(100% - 24px) !important;
          margin: 24px auto 42px !important;
        }

        body.rgv-card-wallet-payment-page #psc-research-checkout .psc-r-header {
          min-height: 56px;
          padding: 15px 18px !important;
        }

        body.rgv-card-wallet-payment-page #psc-research-checkout .psc-r-body {
          padding: 21px 18px 19px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review > #payment > ul.payment_methods {
          padding: 20px 17px 14px !important;
          border-radius: 14px 14px 0 0 !important;
        }

        body.rgv-card-wallet-payment-page #payment .payment_method_psc > label {
          font-size: 16px;
        }

        body.rgv-card-wallet-payment-page .psc-gateway-description {
          margin-left: 0 !important;
          font-size: 10.5px;
        }

        body.rgv-card-wallet-payment-page form#order_review > #psc-research-checkout[data-psc-step="complete"] {
          padding: 0 17px 13px !important;
        }

        body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-body {
          grid-template-columns: minmax(0, 1fr) auto;
          padding: 11px 12px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review > :is(#psc-checkout-root, #psc-checkout) {
          padding: 0 17px 14px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review > #psc-checkout-root > .psc-checkout,
        body.rgv-card-wallet-payment-page form#order_review > #psc-checkout {
          padding: 13px !important;
          border-radius: 10px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row.place-order {
          padding: 14px 17px 18px !important;
          border-radius: 0 0 14px 14px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table :is(th, td) {
          padding: 14px 14px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table :is(th, td):last-child {
          width: 80px;
        }
      }

      /*
       * Checkout composition v3 — presentation only.
       *
       * This layer follows the provider's real order-pay DOM instead of
       * assuming the secure surface lives inside WooCommerce's payment box.
       * It changes only visual order, sizing, spacing and decoration. No
       * provider node, iframe, input, button, value or event is moved/changed.
       */
      body.rgv-card-wallet-payment-page .woocommerce {
        display: flex;
        flex-direction: column;
        width: min(1180px, calc(100% - 64px)) !important;
        max-width: 1180px !important;
        margin: 30px auto 72px !important;
      }

      body.rgv-card-wallet-payment-page .woocommerce > .woocommerce-notices-wrapper {
        order: 0;
      }

      body.rgv-card-wallet-payment-page .woocommerce > .rgv-payment-intro {
        order: 1;
      }

      body.rgv-card-wallet-payment-page .woocommerce > #psc-research-checkout:not([data-psc-step="complete"]) {
        order: 0;
      }

      body.rgv-card-wallet-payment-page .woocommerce > #psc-research-checkout[data-psc-step="complete"] {
        order: 2;
      }

      body.rgv-card-wallet-payment-page .woocommerce > form#order_review {
        order: 3;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro {
        margin: 0 0 20px !important;
        padding: 0 0 22px !important;
        border-bottom: 1px solid rgba(255, 255, 255, .09) !important;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__eyebrow {
        margin-bottom: 8px !important;
        color: #c8837f !important;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: .14em;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__eyebrow > span {
        width: 18px;
        height: 1px;
        border-radius: 0;
        background: #9b4046;
        box-shadow: none;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro h1 {
        max-width: none;
        font-size: clamp(38px, 4vw, 50px);
        font-weight: 520;
        letter-spacing: -.048em;
        line-height: 1.02;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__copy {
        max-width: 560px;
        margin-top: 10px;
        color: #a5a6ad !important;
        font-size: 13px;
        line-height: 1.55;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__trust {
        gap: 10px;
        margin-top: 14px;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__trust span {
        min-height: 26px;
        padding: 0 10px;
        border: 1px solid rgba(255, 255, 255, .08);
        border-radius: 999px;
        background: rgba(255, 255, 255, .018);
        color: #b9bac0;
        font-size: 9px;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__trust b {
        width: 13px;
        height: 13px;
        border-color: rgba(197, 127, 122, .34);
        background: rgba(125, 39, 45, .13);
        color: #d18a85;
      }

      /* A completed identity is a slim checkout row, not a floating card. */
      body.rgv-card-wallet-payment-page .woocommerce > #psc-research-checkout[data-psc-step="complete"] {
        width: 100% !important;
        max-width: none !important;
        margin: 0 0 20px !important;
        padding: 0 !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-shell {
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, .10) !important;
        border-radius: 14px !important;
        background: linear-gradient(90deg, rgba(125, 39, 45, .075), rgba(17, 18, 21, .96) 34%) !important;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-body {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 18px;
        padding: 13px 16px !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-recognized {
        gap: 12px;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-checkmark {
        width: 32px !important;
        height: 32px !important;
        border-color: rgba(209, 138, 133, .45) !important;
        background: rgba(125, 39, 45, .12) !important;
        color: #d18a85 !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-recognized strong {
        font-size: 12.5px !important;
        font-weight: 620 !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-recognized div > span {
        color: #9d9fa7 !important;
        font-size: 9.5px !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] [data-action="edit"] {
        min-height: 34px;
        padding: 0 12px !important;
        border-color: rgba(255, 255, 255, .12) !important;
        background: rgba(255, 255, 255, .025) !important;
        color: #d8d7d4 !important;
        font-size: 9.5px !important;
      }

      /* One cohesive payment card: heading -> provider -> submit. */
      body.rgv-card-wallet-payment-page form#order_review,
      body.rgv-card-wallet-payment-page .woocommerce-order-pay #order_review {
        position: relative;
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: auto auto auto;
        min-height: 0;
        padding-right: 394px;
        column-gap: 0;
        row-gap: 0;
      }

      body.rgv-card-wallet-payment-page form#order_review > #payment > ul.payment_methods {
        grid-column: 1;
        grid-row: 1;
        padding: 22px 24px 18px !important;
        border: 1px solid rgba(255, 255, 255, .11) !important;
        border-bottom: 0 !important;
        border-radius: 18px 18px 0 0 !important;
        background: #111215 !important;
        box-shadow: 0 18px 54px rgba(0, 0, 0, .17);
      }

      body.rgv-card-wallet-payment-page #payment .payment_method_psc > label {
        gap: 13px;
        margin: 0 0 5px !important;
        font-size: 17px;
        font-weight: 620;
        letter-spacing: -.02em;
      }

      body.rgv-card-wallet-payment-page #payment .payment_method_psc > label::before {
        flex: 0 0 42px;
        width: 42px;
        height: 42px;
        border: 1px solid rgba(155, 64, 70, .42);
        border-radius: 12px;
        background:
          linear-gradient(#d18a85, #d18a85) 11px 13px / 20px 2px no-repeat,
          linear-gradient(#d18a85, #d18a85) 11px 23px / 9px 2px no-repeat,
          rgba(125, 39, 45, .14);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, .035);
        content: "";
      }

      body.rgv-card-wallet-payment-page .psc-gateway-description {
        max-width: 640px;
        margin: 0 0 0 55px !important;
        color: #9698a1 !important;
        font-size: 11.5px;
        line-height: 1.55;
      }

      body.rgv-card-wallet-payment-page form#order_review > :is(#psc-checkout-root, #psc-checkout) {
        grid-column: 1;
        grid-row: 2;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 0 24px 22px !important;
        overflow: visible !important;
        border: 0 !important;
        border-right: 1px solid rgba(255, 255, 255, .11) !important;
        border-left: 1px solid rgba(255, 255, 255, .11) !important;
        border-radius: 0 !important;
        background: #111215 !important;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page form#order_review > #psc-checkout-root > .psc-checkout {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        border-radius: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page form#order_review > #psc-checkout {
        --psc-surface: #0d0e11;
        --psc-surface-2: #101114;
        --psc-text: #f4f3f1;
        --psc-text-muted: #9b9da5;
        --psc-border: rgba(255, 255, 255, .105);
        --psc-accent: #7d272d;
        --psc-accent-text: #ffffff;
        --psc-banner-bg: rgba(125, 39, 45, .13);
        --psc-banner-border: #9b4046;
        --psc-banner-text: #f4f3f1;
        --psc-input-bg: #0b0c0f;
        --psc-input-text: #f4f3f1;
        --psc-input-border: #34363d;
        --psc-focus: #d08b86;
      }

      body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row,
      body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row:has(#place_order) {
        grid-column: 1;
        grid-row: 3;
        width: 100%;
        min-width: 0;
        margin: 0 !important;
        padding: 18px 24px 24px !important;
        border: 1px solid rgba(255, 255, 255, .11) !important;
        border-top: 0 !important;
        border-radius: 0 0 18px 18px !important;
        background: #111215 !important;
        box-shadow: 0 24px 64px rgba(0, 0, 0, .20);
      }

      body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row::before {
        display: block;
        width: 100%;
        margin: 0 0 18px;
        border-top: 1px solid rgba(255, 255, 255, .09);
        content: "";
      }

      body.rgv-card-wallet-payment-page #place_order {
        min-height: 54px;
        border-color: #a2464c !important;
        border-radius: 11px !important;
        background: linear-gradient(180deg, #873038, #76242a) !important;
        font-size: 13px !important;
        font-weight: 700 !important;
        letter-spacing: -.01em;
        box-shadow: 0 14px 30px rgba(125, 39, 45, .22), inset 0 1px 0 rgba(255, 255, 255, .10) !important;
      }

      /* A readable receipt-style summary rather than a technical data table. */
      body.rgv-card-wallet-payment-page #order_review > table.shop_table {
        position: absolute;
        top: 0;
        right: 0;
        grid-column: auto;
        grid-row: auto;
        width: 370px !important;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, .11) !important;
        border-radius: 18px !important;
        background: #111215 !important;
        box-shadow: 0 24px 64px rgba(0, 0, 0, .20);
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table thead {
        background: linear-gradient(105deg, rgba(125, 39, 45, .15), rgba(17, 18, 21, .98) 62%);
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table thead th {
        vertical-align: bottom;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table thead th:first-child {
        padding: 20px 18px 15px !important;
        color: transparent !important;
        font-size: 0;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table thead th:first-child::before {
        display: block;
        margin: 0 0 12px;
        color: #f1f0ed;
        content: "Order summary";
        font-size: 18px;
        font-weight: 650;
        letter-spacing: -.025em;
        line-height: 1.15;
        text-transform: none;
        white-space: nowrap;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table thead th:first-child::after {
        display: block;
        color: #9b9da5;
        content: "ITEM";
        font-size: 8px;
        font-weight: 700;
        letter-spacing: .11em;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table thead th:not(:first-child) {
        padding-top: 20px !important;
        padding-bottom: 15px !important;
        font-size: 8px;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table :is(th, td) {
        padding: 17px 18px !important;
        border-bottom-color: rgba(255, 255, 255, .085) !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-name {
        color: #eeedea !important;
        font-size: 12.5px;
        font-weight: 620;
        line-height: 1.42;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table :is(.wc-item-meta, dl.variation) {
        margin-top: 6px !important;
        color: #92949c !important;
        font-size: 9.5px !important;
        line-height: 1.45;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-quantity {
        color: #c8c8c5 !important;
        font-size: 10.5px;
        font-weight: 620;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-subtotal {
        color: #f2f1ee !important;
        font-size: 12.5px;
        font-weight: 650;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table :is(th, td):last-child {
        width: 108px;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot th {
        color: #9b9da5 !important;
        font-size: 10px;
        font-weight: 520;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot td.product-total {
        color: #e9e8e5 !important;
        font-size: 11px;
        font-weight: 620;
        line-height: 1.45;
        white-space: normal !important;
        overflow-wrap: anywhere;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total {
        background: linear-gradient(90deg, rgba(125, 39, 45, .16), rgba(125, 39, 45, .045));
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total :is(th, td) {
        padding-top: 19px !important;
        padding-bottom: 19px !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total :is(td, .amount) {
        color: #ffffff !important;
        font-size: 20px !important;
        font-weight: 620 !important;
        white-space: nowrap !important;
      }

      body.rgv-card-wallet-payment-page :is(.woocommerce-error, .woocommerce-message, .woocommerce-info),
      body.rgv-card-wallet-payment-page .psc-payment-message {
        padding: 13px 15px !important;
        border-radius: 12px !important;
        font-size: 11px !important;
        line-height: 1.5;
        box-shadow: none !important;
      }

      @media (max-width: 960px) {
        body.rgv-card-wallet-payment-page .woocommerce {
          width: min(720px, calc(100% - 40px)) !important;
          margin-top: 26px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review,
        body.rgv-card-wallet-payment-page .woocommerce-order-pay #order_review {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: auto auto auto auto;
          min-height: 0;
          padding-right: 0;
          column-gap: 0;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table {
          position: static;
          top: auto;
          right: auto;
          grid-column: 1;
          grid-row: 1;
          width: 100% !important;
          margin: 0 0 18px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review > #payment > ul.payment_methods {
          grid-column: 1;
          grid-row: 2;
        }

        body.rgv-card-wallet-payment-page form#order_review > :is(#psc-checkout-root, #psc-checkout) {
          grid-column: 1;
          grid-row: 3;
        }

        body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row,
        body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row:has(#place_order) {
          grid-column: 1;
          grid-row: 4;
        }
      }

      @media (max-width: 700px) {
        body.rgv-card-wallet-payment-page .woocommerce {
          width: calc(100% - 24px) !important;
          margin: 20px auto 40px !important;
        }

        body.rgv-card-wallet-payment-page .rgv-payment-intro {
          margin-bottom: 16px !important;
          padding-bottom: 18px !important;
        }

        body.rgv-card-wallet-payment-page .rgv-payment-intro h1 {
          font-size: clamp(32px, 10vw, 38px);
        }

        body.rgv-card-wallet-payment-page .rgv-payment-intro__trust span {
          min-height: 24px;
          padding: 0 8px;
          font-size: 8.5px;
        }

        body.rgv-card-wallet-payment-page .woocommerce > #psc-research-checkout[data-psc-step="complete"] {
          margin-bottom: 16px !important;
        }

        body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-body {
          gap: 10px;
          padding: 11px 12px !important;
        }

        body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-checkmark {
          flex-basis: 28px;
          width: 28px !important;
          height: 28px !important;
        }

        body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] [data-action="edit"] {
          min-height: 31px;
          padding: 0 9px !important;
          font-size: 8.5px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review > #payment > ul.payment_methods {
          padding: 18px 16px 14px !important;
          border-radius: 15px 15px 0 0 !important;
        }

        body.rgv-card-wallet-payment-page #payment .payment_method_psc > label {
          font-size: 16px;
        }

        body.rgv-card-wallet-payment-page #payment .payment_method_psc > label::before {
          flex-basis: 38px;
          width: 38px;
          height: 38px;
          background:
            linear-gradient(#d18a85, #d18a85) 10px 12px / 18px 2px no-repeat,
            linear-gradient(#d18a85, #d18a85) 10px 21px / 8px 2px no-repeat,
            rgba(125, 39, 45, .14);
        }

        body.rgv-card-wallet-payment-page .psc-gateway-description {
          margin: 4px 0 0 51px !important;
          font-size: 10.5px;
        }

        body.rgv-card-wallet-payment-page form#order_review > :is(#psc-checkout-root, #psc-checkout) {
          padding: 0 16px 16px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row,
        body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row:has(#place_order) {
          padding: 14px 16px 18px !important;
          border-radius: 0 0 15px 15px !important;
        }

        body.rgv-card-wallet-payment-page #place_order {
          min-height: 52px;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table thead th:first-child::before {
          font-size: 17px;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table :is(th, td) {
          padding: 14px 13px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table :is(th, td):nth-child(2) {
          width: 42px;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table :is(th, td):last-child {
          width: 96px;
        }
      }

      /*
       * Visual refinement v4 — presentation only.
       *
       * Keep every WooCommerce/PRISM element, value and event in place while
       * removing repeated labels and giving the receipt a calmer hierarchy.
       */
      body.rgv-card-wallet-payment-page .rgv-payment-intro__eyebrow,
      body.rgv-card-wallet-payment-page .rgv-payment-intro__trust {
        display: none !important;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro {
        max-width: 760px;
        margin: 2px 0 28px !important;
        padding: 0 0 27px !important;
        border-bottom-color: rgba(255, 255, 255, .075) !important;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro h1 {
        max-width: 720px;
        margin: 0 !important;
        color: #f5f4f1 !important;
        font-family: "RGV Sora", Sora, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        font-size: clamp(42px, 4.7vw, 56px) !important;
        font-weight: 620 !important;
        letter-spacing: -.058em !important;
        line-height: .99 !important;
        text-wrap: balance;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__copy {
        max-width: 500px;
        margin: 15px 0 0 !important;
        color: #9d9fa6 !important;
        font-size: 12.5px !important;
        line-height: 1.65 !important;
      }

      body.rgv-card-wallet-payment-page .psc-gateway-description {
        display: none !important;
      }

      body.rgv-card-wallet-payment-page form#order_review > #payment > ul.payment_methods {
        padding-bottom: 15px !important;
      }

      body.rgv-card-wallet-payment-page #payment .payment_method_psc > label {
        margin: 0 !important;
      }

      body.rgv-card-wallet-payment-page form#order_review,
      body.rgv-card-wallet-payment-page .woocommerce-order-pay #order_review {
        padding-right: 410px;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table {
        width: 386px !important;
        border-color: rgba(255, 255, 255, .09) !important;
        border-radius: 18px !important;
        background: #0f1013 !important;
        box-shadow: 0 24px 64px rgba(0, 0, 0, .22);
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table thead {
        background: linear-gradient(110deg, rgba(125, 39, 45, .16), rgba(18, 19, 22, .98) 68%) !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table thead th:first-child {
        padding: 22px 18px 20px !important;
        text-align: left !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table thead th:first-child::before {
        margin: 0 !important;
        padding-left: 11px;
        border-left: 3px solid #a2464c;
        color: #f2f1ee !important;
        content: "Your order";
        font-size: 18px !important;
        font-weight: 650 !important;
        letter-spacing: -.04em !important;
        line-height: 1.15 !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table thead th:first-child::after {
        display: none !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table thead th:not(:first-child) {
        padding-top: 20px !important;
        padding-bottom: 18px !important;
        color: transparent !important;
        font-size: 0 !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody :is(th, td) {
        padding-top: 16px !important;
        padding-bottom: 16px !important;
        border-bottom-color: rgba(255, 255, 255, .075) !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-name {
        position: relative;
        padding-left: 17px !important;
        color: #eeedea !important;
        font-size: 12.5px !important;
        font-weight: 620 !important;
        letter-spacing: -.012em;
        line-height: 1.38 !important;
        overflow-wrap: anywhere;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-name::before {
        display: none !important;
        content: none !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table .rgv-order-product {
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr);
        align-items: center;
        gap: 11px;
        min-width: 0;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table .rgv-order-product__media {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, .09);
        border-radius: 11px;
        background: #0a0b0e;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, .035);
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table .rgv-order-product__image {
        display: block;
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
        padding: 4px;
        object-fit: contain;
        object-position: center;
        border: 0 !important;
        border-radius: 0 !important;
        background: transparent !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table .rgv-order-product__name {
        display: block;
        min-width: 0;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table :is(.wc-item-meta, dl.variation) {
        display: none !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-quantity {
        width: 46px !important;
        color: #a9abb2 !important;
        font-size: 10px !important;
        font-weight: 600 !important;
        text-align: center !important;
        white-space: nowrap;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-quantity strong {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 28px;
        height: 22px;
        padding: 0 6px;
        border: 1px solid rgba(255, 255, 255, .075);
        border-radius: 999px;
        background: rgba(255, 255, 255, .025);
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-subtotal {
        width: 94px !important;
        color: #f5f4f1 !important;
        font-size: 12.5px !important;
        font-weight: 650 !important;
        text-align: right !important;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:not(.order-total):not(:nth-last-child(2)) :is(th, td) {
        padding-top: 10px !important;
        padding-bottom: 10px !important;
        border-bottom: 0 !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:first-child :is(th, td) {
        padding-top: 17px !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:not(.order-total):not(:nth-last-child(2)) th {
        color: #9698a0 !important;
        font-size: 10px !important;
        font-weight: 520 !important;
        text-align: left !important;
        text-transform: none !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:not(.order-total):not(:nth-last-child(2)) td {
        color: #e7e6e3 !important;
        font-size: 10.5px !important;
        font-weight: 620 !important;
        line-height: 1.35 !important;
        text-align: right !important;
        font-variant-numeric: tabular-nums;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:last-child:not(.order-total) {
        display: none !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total,
      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:nth-last-child(2) {
        background: linear-gradient(100deg, rgba(125, 39, 45, .20), rgba(125, 39, 45, .08)) !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total :is(th, td),
      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:nth-last-child(2) :is(th, td) {
        padding-top: 17px !important;
        padding-bottom: 17px !important;
        border-top: 1px solid rgba(155, 64, 70, .26) !important;
        border-bottom: 0 !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total th,
      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:nth-last-child(2) th {
        color: #d7aaa7 !important;
        font-size: 0 !important;
        font-weight: 650 !important;
        letter-spacing: .015em;
        text-align: left !important;
        text-transform: none !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total th::before,
      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:nth-last-child(2) th::before {
        color: #dfb2ae;
        content: "Total due";
        font-size: 10.5px;
        font-weight: 680;
        letter-spacing: .01em;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total td,
      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:nth-last-child(2) td {
        width: 132px !important;
        min-width: 132px !important;
        text-align: right !important;
        white-space: nowrap !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total :is(.amount, .amount bdi),
      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:nth-last-child(2) :is(.amount, .amount bdi) {
        color: #ffffff !important;
        font-size: 25px !important;
        font-weight: 650 !important;
        letter-spacing: -.04em;
        white-space: nowrap !important;
        font-variant-numeric: tabular-nums;
      }

      @media (max-width: 960px) {
        body.rgv-card-wallet-payment-page form#order_review,
        body.rgv-card-wallet-payment-page .woocommerce-order-pay #order_review {
          padding-right: 0;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table {
          width: 100% !important;
        }
      }

      @media (max-width: 700px) {
        body.rgv-card-wallet-payment-page .rgv-payment-intro {
          margin-bottom: 18px !important;
          padding-bottom: 20px !important;
        }

        body.rgv-card-wallet-payment-page .rgv-payment-intro h1 {
          font-size: clamp(36px, 10.5vw, 44px) !important;
          line-height: 1.01 !important;
        }

        body.rgv-card-wallet-payment-page .rgv-payment-intro__copy {
          margin-top: 12px !important;
          font-size: 11.5px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table thead th:first-child {
          padding: 18px 15px 16px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody :is(th, td) {
          padding: 14px 12px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-name {
          padding-left: 12px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table .rgv-order-product {
          grid-template-columns: 38px minmax(0, 1fr);
          gap: 9px;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table .rgv-order-product__media {
          width: 38px;
          height: 38px;
          border-radius: 9px;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-quantity {
          width: 38px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-subtotal {
          width: 88px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot :is(th, td) {
          padding-right: 13px !important;
          padding-left: 13px !important;
        }
      }

      /*
       * Checkout refinement v5 — presentation only.
       *
       * This final layer keeps every WooCommerce and provider node in its
       * original place. It only tightens hierarchy, spacing, surfaces and the
       * receipt treatment so the page reads as one intentional checkout.
       */
      body.rgv-card-wallet-payment-page {
        --rgv-v5-canvas: #08090b;
        --rgv-v5-panel: #111216;
        --rgv-v5-panel-deep: #0c0d10;
        --rgv-v5-border: rgba(255, 255, 255, .105);
        --rgv-v5-border-soft: rgba(255, 255, 255, .07);
        --rgv-v5-copy: #f5f3f0;
        --rgv-v5-muted: #92959d;
        background:
          radial-gradient(48rem 30rem at 12% -8%, rgba(125, 39, 45, .12), transparent 67%),
          var(--rgv-v5-canvas) !important;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav {
        border-bottom-color: rgba(255, 255, 255, .065) !important;
        background: rgba(8, 9, 11, .91) !important;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__inner {
        width: min(1180px, calc(100% - 48px));
        min-height: 62px;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__brand,
      body.rgv-card-wallet-payment-page .rgv-pay-nav__brand img {
        width: 108px;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__brand img {
        height: 31px;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__back {
        min-height: 36px;
        padding: 0 12px;
        border-color: rgba(255, 255, 255, .10);
        border-radius: 999px;
        background: rgba(255, 255, 255, .018);
        font-size: 10px;
      }

      body.rgv-card-wallet-payment-page .woocommerce {
        width: min(1180px, calc(100% - 48px)) !important;
        max-width: 1180px !important;
        margin: 30px auto 72px !important;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro {
        width: calc(100% - 414px);
        max-width: 720px;
        margin: 0 0 20px !important;
        padding: 0 !important;
        border: 0 !important;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro h1 {
        margin: 0 !important;
        color: var(--rgv-v5-copy) !important;
        font-size: clamp(38px, 4vw, 50px) !important;
        font-weight: 640 !important;
        letter-spacing: -.055em !important;
        line-height: 1.02 !important;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__copy {
        max-width: 570px;
        margin: 11px 0 0 !important;
        color: var(--rgv-v5-muted) !important;
        font-size: 12px !important;
        line-height: 1.6 !important;
      }

      body.rgv-card-wallet-payment-page .woocommerce > #psc-research-checkout[data-psc-step="complete"] {
        width: calc(100% - 414px) !important;
        max-width: none !important;
        margin: 0 0 14px !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-shell {
        border-color: rgba(120, 201, 138, .20) !important;
        border-radius: 14px !important;
        background: linear-gradient(92deg, rgba(71, 126, 82, .09), rgba(17, 18, 22, .97) 38%) !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-body {
        min-height: 64px;
        padding: 11px 14px !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-checkmark {
        width: 34px !important;
        height: 34px !important;
        border-color: rgba(120, 201, 138, .40) !important;
        background: rgba(120, 201, 138, .08) !important;
        color: #78c98a !important;
      }

      body.rgv-card-wallet-payment-page form#order_review,
      body.rgv-card-wallet-payment-page .woocommerce-order-pay #order_review {
        min-height: 0;
        padding-right: 414px;
      }

      body.rgv-card-wallet-payment-page form#order_review > #payment > ul.payment_methods {
        padding: 21px 22px 15px !important;
        border-color: var(--rgv-v5-border) !important;
        border-radius: 20px 20px 0 0 !important;
        background:
          linear-gradient(145deg, rgba(125, 39, 45, .075), transparent 43%),
          var(--rgv-v5-panel) !important;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, .025), 0 20px 54px rgba(0, 0, 0, .18);
      }

      body.rgv-card-wallet-payment-page #payment .payment_method_psc > label {
        gap: 12px;
        color: var(--rgv-v5-copy) !important;
        font-size: 16px !important;
        font-weight: 650 !important;
        letter-spacing: -.025em;
      }

      body.rgv-card-wallet-payment-page #payment .payment_method_psc > label::before {
        flex-basis: 38px;
        width: 38px;
        height: 38px;
        border-color: rgba(155, 64, 70, .40);
        border-radius: 11px;
        background:
          linear-gradient(#d18a85, #d18a85) 10px 12px / 18px 2px no-repeat,
          linear-gradient(#d18a85, #d18a85) 10px 21px / 9px 2px no-repeat,
          rgba(125, 39, 45, .13);
      }

      body.rgv-card-wallet-payment-page form#order_review > :is(#psc-checkout-root, #psc-checkout) {
        padding: 2px 22px 20px !important;
        border-right-color: var(--rgv-v5-border) !important;
        border-left-color: var(--rgv-v5-border) !important;
        background: var(--rgv-v5-panel) !important;
      }

      body.rgv-card-wallet-payment-page form#order_review > #psc-checkout {
        --psc-surface: var(--rgv-v5-panel-deep);
        --psc-surface-2: #12141a;
        --psc-border: rgba(255, 255, 255, .115);
        --psc-input-bg: #0a0b0e;
        --psc-input-border: #343740;
      }

      body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row,
      body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row:has(#place_order) {
        padding: 17px 22px 22px !important;
        border-color: var(--rgv-v5-border) !important;
        border-radius: 0 0 20px 20px !important;
        background: var(--rgv-v5-panel) !important;
        box-shadow: 0 24px 60px rgba(0, 0, 0, .22);
      }

      body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row::before {
        margin-bottom: 17px;
        border-top-color: var(--rgv-v5-border-soft);
      }

      body.rgv-card-wallet-payment-page #place_order {
        min-height: 56px;
        border: 1px solid #a7454b !important;
        border-radius: 12px !important;
        background: linear-gradient(180deg, #94353d, #7f292f) !important;
        color: #fff !important;
        font-size: 13px !important;
        font-weight: 720 !important;
        box-shadow: 0 14px 34px rgba(125, 39, 45, .26), inset 0 1px 0 rgba(255, 255, 255, .13) !important;
      }

      body.rgv-card-wallet-payment-page #place_order:hover {
        background: linear-gradient(180deg, #a13d45, #8a2e35) !important;
        transform: translateY(-1px);
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table {
        top: 0;
        width: 390px !important;
        border-color: var(--rgv-v5-border) !important;
        border-radius: 20px !important;
        background: var(--rgv-v5-panel) !important;
        box-shadow: 0 26px 70px rgba(0, 0, 0, .27);
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table thead {
        background:
          linear-gradient(120deg, rgba(125, 39, 45, .20), rgba(17, 18, 22, .98) 70%) !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table thead th:first-child {
        padding: 22px 18px 19px !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table thead th:first-child::before {
        padding-left: 0;
        border-left: 0;
        content: "Order summary";
        font-size: 18px !important;
        font-weight: 680 !important;
        letter-spacing: -.035em !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody :is(th, td) {
        padding-top: 15px !important;
        padding-bottom: 15px !important;
        border-bottom-color: var(--rgv-v5-border-soft) !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-name {
        padding-left: 16px !important;
        font-size: 12px !important;
        font-weight: 640 !important;
        line-height: 1.32 !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table .rgv-order-product {
        grid-template-columns: 50px minmax(0, 1fr);
        gap: 12px;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table .rgv-order-product__media {
        width: 50px;
        height: 50px;
        border-color: rgba(255, 255, 255, .10);
        border-radius: 13px;
        background: linear-gradient(145deg, #17191e, #0b0c0f);
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table .rgv-order-product__image {
        padding: 5px;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-quantity strong {
        min-width: 29px;
        height: 23px;
        border-color: rgba(255, 255, 255, .09);
        background: rgba(255, 255, 255, .025);
        color: #b4b6bd;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:not(.order-total):not(:nth-last-child(2)) th {
        color: #8f929a !important;
        font-size: 10.5px !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:not(.order-total):not(:nth-last-child(2)) td {
        color: #e4e3df !important;
        font-size: 11px !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total,
      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:nth-last-child(2) {
        background: linear-gradient(100deg, rgba(125, 39, 45, .23), rgba(125, 39, 45, .08)) !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total :is(th, td),
      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:nth-last-child(2) :is(th, td) {
        padding-top: 18px !important;
        padding-bottom: 18px !important;
        border-top-color: rgba(155, 64, 70, .30) !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total th::before,
      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:nth-last-child(2) th::before {
        color: #deb0ac;
        content: "Total";
        font-size: 11px;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total :is(.amount, .amount bdi),
      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:nth-last-child(2) :is(.amount, .amount bdi) {
        font-size: 27px !important;
        font-weight: 680 !important;
        letter-spacing: -.045em;
      }

      body.rgv-card-wallet-payment-page :is(.woocommerce-error, .woocommerce-message, .woocommerce-info),
      body.rgv-card-wallet-payment-page .psc-payment-message:not(:empty) {
        margin: 0 0 14px !important;
        padding: 12px 14px !important;
        border-width: 1px !important;
        border-radius: 12px !important;
        font-size: 11px !important;
        line-height: 1.45 !important;
      }

      body.rgv-card-wallet-payment-page .psc-payment-message:empty {
        display: none !important;
      }

      @media (max-width: 960px) {
        body.rgv-card-wallet-payment-page .rgv-payment-intro,
        body.rgv-card-wallet-payment-page .woocommerce > #psc-research-checkout[data-psc-step="complete"] {
          width: 100% !important;
          max-width: none;
        }

        body.rgv-card-wallet-payment-page form#order_review,
        body.rgv-card-wallet-payment-page .woocommerce-order-pay #order_review {
          padding-right: 0;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table {
          width: 100% !important;
          margin-bottom: 16px !important;
        }
      }

      @media (max-width: 700px) {
        body.rgv-card-wallet-payment-page .rgv-pay-nav__inner {
          width: calc(100% - 28px);
          min-height: 58px;
        }

        body.rgv-card-wallet-payment-page .rgv-pay-nav__brand,
        body.rgv-card-wallet-payment-page .rgv-pay-nav__brand img {
          width: 94px;
        }

        body.rgv-card-wallet-payment-page .woocommerce {
          width: calc(100% - 20px) !important;
          margin: 20px auto 42px !important;
        }

        body.rgv-card-wallet-payment-page .rgv-payment-intro {
          margin-bottom: 16px !important;
        }

        body.rgv-card-wallet-payment-page .rgv-payment-intro h1 {
          font-size: clamp(33px, 10vw, 40px) !important;
        }

        body.rgv-card-wallet-payment-page .rgv-payment-intro__copy {
          margin-top: 9px !important;
          font-size: 11.5px !important;
        }

        body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-body {
          min-height: 58px;
          padding: 10px 11px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review > #payment > ul.payment_methods {
          padding: 18px 15px 13px !important;
          border-radius: 17px 17px 0 0 !important;
        }

        body.rgv-card-wallet-payment-page form#order_review > :is(#psc-checkout-root, #psc-checkout) {
          padding: 2px 15px 15px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row,
        body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row:has(#place_order) {
          padding: 14px 15px 17px !important;
          border-radius: 0 0 17px 17px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table {
          border-radius: 17px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table thead th:first-child {
          padding: 18px 14px 16px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody :is(th, td) {
          padding: 13px 10px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-name {
          padding-left: 12px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table .rgv-order-product {
          grid-template-columns: 42px minmax(0, 1fr);
          gap: 9px;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table .rgv-order-product__media {
          width: 42px;
          height: 42px;
          border-radius: 10px;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-subtotal {
          width: 80px !important;
          font-size: 12px !important;
        }

        body.rgv-card-wallet-payment-page #place_order {
          min-height: 54px;
        }
      }

      /*
       * RGVPRIME checkout v9 — visual layer only.
       *
       * No element is removed, cloned or relocated by JavaScript. WooCommerce
       * and PRISM keep their original form controls, IDs and event handlers;
       * this layer only establishes the final art direction and responsive
       * layout.
       */
      body.rgv-card-wallet-payment-page {
        --rgv-v9-bg: #070708;
        --rgv-v9-panel: #101014;
        --rgv-v9-panel-soft: #131317;
        --rgv-v9-input: #0b0b0e;
        --rgv-v9-line: rgba(255, 255, 255, .105);
        --rgv-v9-line-soft: rgba(255, 255, 255, .065);
        --rgv-v9-text: #f4f2ef;
        --rgv-v9-muted: #929199;
        --rgv-v9-red: #9d2635;
        --rgv-v9-red-bright: #c23b4c;
        background:
          radial-gradient(52rem 28rem at 8% -10%, rgba(172, 32, 52, .105), transparent 70%),
          radial-gradient(40rem 34rem at 100% 72%, rgba(100, 22, 36, .055), transparent 70%),
          var(--rgv-v9-bg) !important;
        color: var(--rgv-v9-text) !important;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav {
        border-bottom: 1px solid var(--rgv-v9-line-soft) !important;
        background: rgba(7, 7, 8, .88) !important;
        backdrop-filter: blur(22px) saturate(125%);
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__inner {
        width: min(1120px, calc(100% - 48px));
        min-height: 68px;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__brand,
      body.rgv-card-wallet-payment-page .rgv-pay-nav__brand img {
        width: 104px;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__brand img {
        height: 30px;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__back {
        min-height: 38px;
        padding: 0 14px;
        border: 1px solid var(--rgv-v9-line) !important;
        border-radius: 10px;
        background: rgba(255, 255, 255, .018) !important;
        color: #cbc9c7 !important;
        font-size: 10px;
        font-weight: 560;
        letter-spacing: -.005em;
      }

      body.rgv-card-wallet-payment-page .rgv-pay-nav__back:hover {
        border-color: rgba(255, 255, 255, .20) !important;
        background: rgba(255, 255, 255, .04) !important;
        color: #fff !important;
      }

      body.rgv-card-wallet-payment-page .woocommerce {
        width: min(1120px, calc(100% - 48px)) !important;
        max-width: 1120px !important;
        margin: 40px auto 76px !important;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro {
        width: calc(100% - 390px);
        max-width: 690px;
        margin: 0 0 24px !important;
        padding: 0 !important;
        border: 0 !important;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro h1 {
        max-width: none;
        color: var(--rgv-v9-text) !important;
        font-family: "RGV Sora", Sora, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        font-size: clamp(34px, 3.4vw, 44px) !important;
        font-weight: 690 !important;
        letter-spacing: -.058em !important;
        line-height: 1.02 !important;
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro h1::after {
        display: inline-block;
        width: 7px;
        height: 7px;
        margin: 0 0 5px 10px;
        border-radius: 50%;
        background: var(--rgv-v9-red-bright);
        box-shadow: 0 0 0 5px rgba(194, 59, 76, .10);
        content: "";
      }

      body.rgv-card-wallet-payment-page .rgv-payment-intro__copy {
        max-width: 530px;
        margin: 10px 0 0 !important;
        color: var(--rgv-v9-muted) !important;
        font-size: 12px !important;
        line-height: 1.6 !important;
      }

      body.rgv-card-wallet-payment-page .woocommerce > #psc-research-checkout[data-psc-step="complete"] {
        width: calc(100% - 390px) !important;
        margin: 0 0 12px !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-shell {
        overflow: hidden;
        border: 1px solid rgba(117, 188, 132, .19) !important;
        border-radius: 15px !important;
        background:
          linear-gradient(90deg, rgba(55, 111, 67, .095), rgba(16, 16, 20, .98) 48%) !important;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, .025) !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-body {
        min-height: 62px;
        padding: 10px 14px !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] h2 {
        color: #91d19e !important;
        font-size: 8px !important;
        font-weight: 720 !important;
        letter-spacing: .08em !important;
        text-transform: uppercase;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-checkmark {
        width: 32px !important;
        height: 32px !important;
        border-color: rgba(117, 188, 132, .42) !important;
        background: rgba(117, 188, 132, .075) !important;
        color: #7ac98b !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-recognized strong {
        color: #efeeeb !important;
        font-size: 12px !important;
        font-weight: 650 !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-recognized div > span {
        color: #8e9098 !important;
        font-size: 9px !important;
      }

      body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] [data-action="edit"] {
        min-height: 34px !important;
        padding: 0 12px !important;
        border: 1px solid var(--rgv-v9-line) !important;
        border-radius: 9px !important;
        background: rgba(255, 255, 255, .02) !important;
        color: #cfceca !important;
        font-size: 9px !important;
        font-weight: 600 !important;
      }

      body.rgv-card-wallet-payment-page form#order_review,
      body.rgv-card-wallet-payment-page .woocommerce-order-pay #order_review {
        position: relative;
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) !important;
        grid-template-rows: auto auto auto !important;
        min-height: 0;
        padding-right: 390px;
        column-gap: 0 !important;
        row-gap: 0 !important;
        overflow: visible !important;
      }

      body.rgv-card-wallet-payment-page form#order_review > #payment {
        display: contents !important;
      }

      body.rgv-card-wallet-payment-page form#order_review > #payment > ul.payment_methods {
        grid-column: 1;
        grid-row: 1;
        padding: 22px 22px 13px !important;
        border: 1px solid var(--rgv-v9-line) !important;
        border-bottom: 0 !important;
        border-radius: 19px 19px 0 0 !important;
        background:
          linear-gradient(135deg, rgba(157, 38, 53, .07), transparent 38%),
          var(--rgv-v9-panel) !important;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, .025), 0 22px 66px rgba(0, 0, 0, .18) !important;
      }

      body.rgv-card-wallet-payment-page #payment .payment_method_psc > label {
        gap: 12px;
        margin: 0 !important;
        color: var(--rgv-v9-text) !important;
        font-size: 15px !important;
        font-weight: 680 !important;
        letter-spacing: -.03em;
      }

      body.rgv-card-wallet-payment-page #payment .payment_method_psc > label::before {
        flex: 0 0 38px;
        width: 38px;
        height: 38px;
        border: 1px solid rgba(194, 59, 76, .38) !important;
        border-radius: 11px;
        background:
          linear-gradient(#d98088, #d98088) 10px 12px / 18px 2px no-repeat,
          linear-gradient(#d98088, #d98088) 10px 21px / 9px 2px no-repeat,
          rgba(157, 38, 53, .12) !important;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, .035);
      }

      body.rgv-card-wallet-payment-page form#order_review > :is(#psc-checkout-root, #psc-checkout) {
        grid-column: 1;
        grid-row: 2;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 0 22px 18px !important;
        overflow: visible !important;
        border: 0 !important;
        border-right: 1px solid var(--rgv-v9-line) !important;
        border-left: 1px solid var(--rgv-v9-line) !important;
        border-radius: 0 !important;
        background: var(--rgv-v9-panel) !important;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page form#order_review > #psc-checkout-root > .psc-checkout,
      body.rgv-card-wallet-payment-page form#order_review > #psc-checkout {
        --psc-surface: var(--rgv-v9-panel);
        --psc-surface-2: var(--rgv-v9-panel-soft);
        --psc-text: var(--rgv-v9-text);
        --psc-text-muted: var(--rgv-v9-muted);
        --psc-border: var(--rgv-v9-line);
        --psc-accent: #b63546;
        --psc-accent-text: #fff;
        --psc-banner-bg: rgba(157, 38, 53, .10);
        --psc-banner-border: rgba(194, 59, 76, .38);
        --psc-banner-text: var(--rgv-v9-text);
        --psc-input-bg: var(--rgv-v9-input);
        --psc-input-text: var(--rgv-v9-text);
        --psc-input-border: #34343b;
        --psc-focus: #df7681;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 15px !important;
        overflow: visible !important;
        border: 1px solid var(--rgv-v9-line-soft) !important;
        border-radius: 13px !important;
        background: var(--rgv-v9-input) !important;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, .018) !important;
      }

      body.rgv-card-wallet-payment-page form#order_review :is(#psc-checkout-root, #psc-checkout) :where(*) {
        min-width: 0;
        max-width: 100%;
      }

      body.rgv-card-wallet-payment-page form#order_review :is(#psc-checkout-root, #psc-checkout) iframe {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        border: 0 !important;
      }

      body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row,
      body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row:has(#place_order) {
        grid-column: 1;
        grid-row: 3;
        width: 100%;
        min-width: 0;
        margin: 0 !important;
        padding: 15px 22px 22px !important;
        border: 1px solid var(--rgv-v9-line) !important;
        border-top: 0 !important;
        border-radius: 0 0 19px 19px !important;
        background: var(--rgv-v9-panel) !important;
        box-shadow: 0 28px 70px rgba(0, 0, 0, .25) !important;
      }

      body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row::before {
        margin: 0 0 15px;
        border-top: 1px solid var(--rgv-v9-line-soft);
      }

      body.rgv-card-wallet-payment-page #place_order {
        min-height: 56px;
        border: 1px solid #bc4250 !important;
        border-radius: 11px !important;
        background: linear-gradient(180deg, #a6303f, #892431) !important;
        color: #fff !important;
        font-size: 12.5px !important;
        font-weight: 730 !important;
        letter-spacing: -.012em;
        box-shadow: 0 16px 36px rgba(131, 30, 43, .27), inset 0 1px 0 rgba(255, 255, 255, .15) !important;
      }

      body.rgv-card-wallet-payment-page #place_order:hover {
        background: linear-gradient(180deg, #b73a4a, #962a38) !important;
        box-shadow: 0 18px 40px rgba(131, 30, 43, .34), inset 0 1px 0 rgba(255, 255, 255, .17) !important;
        transform: translateY(-1px);
      }

      body.rgv-card-wallet-payment-page #place_order:active {
        transform: translateY(0);
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table {
        position: absolute;
        top: 0;
        right: 0;
        width: 366px !important;
        min-width: 0;
        overflow: hidden;
        border: 1px solid var(--rgv-v9-line) !important;
        border-radius: 19px !important;
        background: var(--rgv-v9-panel) !important;
        box-shadow: 0 30px 78px rgba(0, 0, 0, .28) !important;
        table-layout: fixed;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table thead {
        background:
          linear-gradient(110deg, rgba(157, 38, 53, .16), rgba(16, 16, 20, .98) 72%) !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table thead th:first-child {
        padding: 20px 17px 18px !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table thead th:first-child::before {
        color: var(--rgv-v9-text) !important;
        content: "Your order";
        font-size: 17px !important;
        font-weight: 690 !important;
        letter-spacing: -.04em !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody :is(th, td) {
        padding-top: 14px !important;
        padding-bottom: 14px !important;
        border-bottom: 1px solid var(--rgv-v9-line-soft) !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-name {
        padding-left: 15px !important;
        color: #efeeeb !important;
        font-size: 11.5px !important;
        font-weight: 650 !important;
        line-height: 1.35 !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table .rgv-order-product {
        grid-template-columns: 48px minmax(0, 1fr);
        gap: 11px;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table .rgv-order-product__media {
        width: 48px;
        height: 48px;
        border: 1px solid rgba(255, 255, 255, .095);
        border-radius: 12px;
        background:
          radial-gradient(circle at 35% 20%, rgba(255, 255, 255, .06), transparent 55%),
          #0a0a0d;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table .rgv-order-product__image {
        padding: 5px;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-quantity {
        width: 42px !important;
        color: #9a9ca3 !important;
        font-size: 9px !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-quantity strong {
        min-width: 27px;
        height: 21px;
        padding: 0 6px;
        border-color: rgba(255, 255, 255, .08);
        background: rgba(255, 255, 255, .018);
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-subtotal {
        width: 80px !important;
        padding-right: 15px !important;
        color: #f6f4f1 !important;
        font-size: 11.5px !important;
        font-weight: 680 !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:not(.order-total):not(:nth-last-child(2)) :is(th, td) {
        padding-top: 7px !important;
        padding-bottom: 7px !important;
        border-bottom: 0 !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:first-child :is(th, td) {
        padding-top: 15px !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:not(.order-total):not(:nth-last-child(2)) th {
        color: #8f8f97 !important;
        font-size: 9.5px !important;
        font-weight: 520 !important;
        text-transform: none !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:not(.order-total):not(:nth-last-child(2)) td {
        color: #e7e5e2 !important;
        font-size: 10px !important;
        font-weight: 650 !important;
        line-height: 1.4 !important;
        text-align: right !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total,
      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:nth-last-child(2) {
        background: linear-gradient(100deg, rgba(157, 38, 53, .18), rgba(157, 38, 53, .065)) !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total :is(th, td),
      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:nth-last-child(2) :is(th, td) {
        padding-top: 16px !important;
        padding-bottom: 16px !important;
        border-top: 1px solid rgba(194, 59, 76, .24) !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total th::before,
      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:nth-last-child(2) th::before {
        color: #d9aaa9;
        content: "Total due";
        font-size: 10px;
        font-weight: 660;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total td,
      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:nth-last-child(2) td {
        width: 122px !important;
        min-width: 122px !important;
        padding-right: 15px !important;
        white-space: nowrap !important;
      }

      body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total :is(.amount, .amount bdi),
      body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:nth-last-child(2) :is(.amount, .amount bdi) {
        display: inline-block;
        color: #fff !important;
        font-size: 25px !important;
        font-weight: 700 !important;
        letter-spacing: -.05em;
        line-height: 1 !important;
        white-space: nowrap !important;
      }

      body.rgv-card-wallet-payment-page :is(.woocommerce-error, .woocommerce-message, .woocommerce-info),
      body.rgv-card-wallet-payment-page .psc-payment-message:not(:empty) {
        margin: 0 0 12px !important;
        padding: 11px 13px !important;
        border: 1px solid rgba(194, 59, 76, .34) !important;
        border-radius: 11px !important;
        background: rgba(157, 38, 53, .10) !important;
        color: #f0cfcb !important;
        font-size: 10.5px !important;
        font-weight: 560 !important;
        line-height: 1.45 !important;
        box-shadow: none !important;
      }

      body.rgv-card-wallet-payment-page .psc-payment-message:empty {
        display: none !important;
      }

      @media (max-width: 980px) {
        body.rgv-card-wallet-payment-page .woocommerce {
          width: min(720px, calc(100% - 40px)) !important;
        }

        body.rgv-card-wallet-payment-page .rgv-payment-intro,
        body.rgv-card-wallet-payment-page .woocommerce > #psc-research-checkout[data-psc-step="complete"] {
          width: 100% !important;
          max-width: none;
        }

        body.rgv-card-wallet-payment-page form#order_review,
        body.rgv-card-wallet-payment-page .woocommerce-order-pay #order_review {
          grid-template-rows: auto auto auto auto !important;
          padding-right: 0;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table {
          position: static;
          grid-column: 1;
          grid-row: 4;
          width: 100% !important;
          margin: 14px 0 0 !important;
        }

        body.rgv-card-wallet-payment-page form#order_review > #payment > ul.payment_methods {
          grid-row: 1;
        }

        body.rgv-card-wallet-payment-page form#order_review > :is(#psc-checkout-root, #psc-checkout) {
          grid-row: 2;
        }

        body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row,
        body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row:has(#place_order) {
          grid-row: 3;
        }
      }

      @media (max-width: 700px) {
        body.rgv-card-wallet-payment-page .rgv-pay-nav__inner {
          width: calc(100% - 28px);
          min-height: 60px;
        }

        body.rgv-card-wallet-payment-page .rgv-pay-nav__brand,
        body.rgv-card-wallet-payment-page .rgv-pay-nav__brand img {
          width: 92px;
        }

        body.rgv-card-wallet-payment-page .rgv-pay-nav__back {
          min-height: 34px;
          padding: 0 10px;
          font-size: 9px;
        }

        body.rgv-card-wallet-payment-page .woocommerce {
          width: calc(100% - 20px) !important;
          margin: 24px auto 44px !important;
        }

        body.rgv-card-wallet-payment-page .rgv-payment-intro {
          margin-bottom: 18px !important;
        }

        body.rgv-card-wallet-payment-page .rgv-payment-intro h1 {
          font-size: clamp(31px, 9.4vw, 38px) !important;
        }

        body.rgv-card-wallet-payment-page .rgv-payment-intro h1::after {
          width: 6px;
          height: 6px;
          margin-bottom: 4px;
        }

        body.rgv-card-wallet-payment-page .rgv-payment-intro__copy {
          margin-top: 9px !important;
          font-size: 11px !important;
        }

        body.rgv-card-wallet-payment-page #psc-research-checkout[data-psc-step="complete"] .psc-r-body {
          min-height: 58px;
          padding: 9px 11px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review > #payment > ul.payment_methods {
          padding: 18px 14px 11px !important;
          border-radius: 16px 16px 0 0 !important;
        }

        body.rgv-card-wallet-payment-page form#order_review > :is(#psc-checkout-root, #psc-checkout) {
          padding: 0 14px 14px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review > #psc-checkout-root > .psc-checkout,
        body.rgv-card-wallet-payment-page form#order_review > #psc-checkout {
          padding: 12px !important;
          border-radius: 11px !important;
        }

        body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row,
        body.rgv-card-wallet-payment-page form#order_review > #payment > .form-row:has(#place_order) {
          padding: 13px 14px 16px !important;
          border-radius: 0 0 16px 16px !important;
        }

        body.rgv-card-wallet-payment-page #place_order {
          min-height: 53px;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table {
          border-radius: 16px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table thead th:first-child {
          padding: 17px 13px 15px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody :is(th, td) {
          padding: 12px 8px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-name {
          padding-left: 10px !important;
          font-size: 10.5px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table .rgv-order-product {
          grid-template-columns: 40px minmax(0, 1fr);
          gap: 8px;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table .rgv-order-product__media {
          width: 40px;
          height: 40px;
          border-radius: 10px;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-quantity {
          width: 35px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table tbody td.product-subtotal {
          width: 70px !important;
          padding-right: 10px !important;
          font-size: 10.5px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot :is(th, td) {
          padding-right: 11px !important;
          padding-left: 11px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total td,
        body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:nth-last-child(2) td {
          width: 112px !important;
          min-width: 112px !important;
          padding-right: 11px !important;
        }

        body.rgv-card-wallet-payment-page #order_review > table.shop_table tr.order-total :is(.amount, .amount bdi),
        body.rgv-card-wallet-payment-page #order_review > table.shop_table tfoot tr:nth-last-child(2) :is(.amount, .amount bdi) {
          font-size: 23px !important;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        body.rgv-card-wallet-payment-page *,
        body.rgv-card-wallet-payment-page *::before,
        body.rgv-card-wallet-payment-page *::after {
          scroll-behavior: auto !important;
          transition: none !important;
          animation: none !important;
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

    $target = $this->storefront_receipt_url($order);
    if (!$target) {
      return;
    }

    echo '<p class="rgv-storefront-return"><a href="' . esc_url($target) . '">Return to RGVPRIME</a></p>';
    echo '<script>window.setTimeout(function(){window.location.replace(' . wp_json_encode(esc_url_raw($target)) . ');},900);</script>';
  }

  private function storefront_receipt_url($order) {
    if (!$order instanceof WC_Order) {
      return '';
    }

    $storefront = $this->storefront_url();
    if (!$storefront) {
      return '';
    }

    return add_query_arg([
      'card_payment' => 'success',
      'order_id' => $order->get_id(),
      'order_key' => $order->get_order_key(),
    ], trailingslashit($storefront) . 'checkout');
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
