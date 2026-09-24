<?php
/**
 * Plugin Name: RGV Storefront Card & Wallet Return
 * Description: Keeps card and wallet checkout customer-facing copy neutral and returns paid storefront orders to the Astro receipt page.
 * Version: 2.0.5
 * Author: RGVPRIME LLC
 * Requires at least: 6.5
 * Requires PHP: 8.1
 * WC requires at least: 8.5
 * WC tested up to: 10.9
 */

defined('ABSPATH') || exit;

final class RGV_Storefront_Card_Wallet_Return {
  const VERSION = '2.0.5';
  const PAYMENT_METHOD = 'psc';

  public function __construct() {
    add_filter('woocommerce_gateway_title', [$this, 'gateway_title'], 100, 2);
    add_filter('woocommerce_gateway_description', [$this, 'gateway_description'], 100, 2);
    add_filter('woocommerce_order_get_payment_method_title', [$this, 'order_payment_title'], 100, 2);
    add_filter('gettext', [$this, 'neutral_frontend_copy'], 100, 3);
    add_filter('woocommerce_order_get_customer_id', [$this, 'allow_bearer_payment_session'], 1000, 2);
    add_filter('user_has_cap', [$this, 'allow_storefront_payment_link'], 1000, 4);
    add_action('wp_enqueue_scripts', [$this, 'neutralize_frontend_branding'], 100);
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
