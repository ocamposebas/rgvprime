<?php
/**
 * Plugin Name: RGV Storefront Card & Wallet Return
 * Description: Keeps card and wallet checkout customer-facing copy neutral and returns paid storefront orders to the Astro receipt page.
 * Version: 2.1.0
 * Author: RGVPRIME LLC
 * Requires at least: 6.5
 * Requires PHP: 8.1
 * WC requires at least: 8.5
 * WC tested up to: 10.9
 */

defined('ABSPATH') || exit;

final class RGV_Storefront_Card_Wallet_Return {
  const VERSION = '2.1.0';
  const PAYMENT_METHOD = 'psc';

  public function __construct() {
    add_filter('woocommerce_gateway_title', [$this, 'gateway_title'], 100, 2);
    add_filter('woocommerce_gateway_description', [$this, 'gateway_description'], 100, 2);
    add_filter('woocommerce_order_get_payment_method_title', [$this, 'order_payment_title'], 100, 2);
    add_filter('gettext', [$this, 'neutral_frontend_copy'], 100, 3);
    add_filter('woocommerce_order_get_customer_id', [$this, 'allow_bearer_payment_session'], 1000, 2);
    add_filter('user_has_cap', [$this, 'allow_storefront_payment_link'], 1000, 4);
    add_filter('body_class', [$this, 'payment_page_body_class'], 100);
    add_action('wp_enqueue_scripts', [$this, 'neutralize_frontend_branding'], 100);
    add_action('before_woocommerce_pay_form', [$this, 'render_payment_header'], 5, 0);
    add_action('woocommerce_thankyou', [$this, 'return_paid_storefront_order'], 1000);
  }

  public function gateway_title($title, $gateway_id) {
    return self::PAYMENT_METHOD === (string) $gateway_id ? 'Card & Wallets' : $title;
  }

  public function gateway_description($description, $gateway_id) {
    if (self::PAYMENT_METHOD !== (string) $gateway_id) {
      return $description;
    }

    return 'Complete research verification, then pay securely with card, Link, Apple Pay, or Google Pay when available.';
  }

  public function order_payment_title($title, $order) {
    if ($order instanceof WC_Order && self::PAYMENT_METHOD === $order->get_payment_method()) {
      return 'Card & Wallets';
    }

    return $title;
  }

  public function allow_storefront_payment_link($allcaps, $caps, $args, $user) {
    if (($caps[0] ?? '') !== 'pay_for_order') {
      return $allcaps;
    }

    $order_id = absint($args[2] ?? 0);
    $provided_key = $this->payment_request_order_key();
    if (!$order_id || !$provided_key) {
      return $allcaps;
    }

    $order = wc_get_order($order_id);
    if (!$this->is_storefront_card_wallet_order($order) || !$order->needs_payment()) {
      return $allcaps;
    }

    if (hash_equals((string) $order->get_order_key(), (string) $provided_key)) {
      $allcaps['pay_for_order'] = true;
    }

    return $allcaps;
  }

  public function allow_bearer_payment_session($customer_id, $order) {
    if (
      (int) $customer_id < 1 ||
      !$this->is_storefront_card_wallet_order($order) ||
      !$order->needs_payment()
    ) {
      return $customer_id;
    }

    $request_order_id = $this->payment_request_order_id();
    $provided_key = $this->payment_request_order_key();
    if (
      $request_order_id === (int) $order->get_id() &&
      $provided_key &&
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

  public function render_payment_header() {
    if (!$this->is_storefront_payment_request()) {
      return;
    }

    echo '<section class="rgv-payment-intro" aria-labelledby="rgv-payment-title">';
    echo '<p class="rgv-payment-intro__eyebrow">RGVPRIME &middot; Secure payment</p>';
    echo '<h1 id="rgv-payment-title">Complete your payment</h1>';
    echo '<p class="rgv-payment-intro__copy">Review your order, then pay securely by card or an available wallet.</p>';
    echo '<div class="rgv-payment-intro__trust" aria-label="Checkout protections">';
    echo '<span>Encrypted checkout</span><span>Your order is reserved</span>';
    echo '</div></section>';
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
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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

      @media (max-width: 700px) {
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

    $target = add_query_arg([
      'card_payment' => 'success',
      'order_id' => $order->get_id(),
      'order_key' => $order->get_order_key(),
    ], trailingslashit($storefront) . 'checkout');

    echo '<p class="rgv-storefront-return"><a href="' . esc_url($target) . '">Return to RGVPRIME</a></p>';
    echo '<script>window.setTimeout(function(){window.location.replace(' . wp_json_encode(esc_url_raw($target)) . ');},900);</script>';
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
