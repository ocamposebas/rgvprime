<?php
/**
 * Plugin Name: RGV Storefront Card & Wallet Return
 * Description: Provides a closed, branded card and wallet checkout handoff for the RGVPRIME storefront.
 * Version: 2.3.3
 * Author: RGVPRIME LLC
 * Requires at least: 6.5
 * Requires PHP: 8.1
 * WC requires at least: 8.5
 * WC tested up to: 10.9
 */

defined('ABSPATH') || exit;

final class RGV_Storefront_Card_Wallet_Return {
  const VERSION = '2.3.3';
  const PAYMENT_METHOD = 'psc';

  public function __construct() {
    add_filter('woocommerce_gateway_title', [$this, 'gateway_title'], 100, 2);
    add_filter('woocommerce_gateway_description', [$this, 'gateway_description'], 100, 2);
    add_filter('woocommerce_order_get_payment_method_title', [$this, 'order_payment_title'], 100, 2);
    add_filter('woocommerce_available_payment_gateways', [$this, 'card_gateway_only'], 1000);
    add_filter('option_woocommerce_psc_settings', [$this, 'force_dark_gateway_theme'], 100);
    add_filter('gettext', [$this, 'neutral_frontend_copy'], 100, 3);
    add_filter('woocommerce_order_get_customer_id', [$this, 'allow_bearer_payment_session'], 1000, 2);
    add_filter('body_class', [$this, 'payment_page_body_class'], 100);
    add_action('template_redirect', [$this, 'restrict_public_wordpress_navigation'], 1);
    add_action('wp_enqueue_scripts', [$this, 'neutralize_frontend_branding'], 100);
    add_action('wp_body_open', [$this, 'render_payment_nav'], 5, 0);
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
    if ($this->is_storefront_payment_request() || $this->is_storefront_receipt_request()) {
      wp_register_style('rgv-card-wallet-payment-page', false, [], self::VERSION);
      wp_enqueue_style('rgv-card-wallet-payment-page');
      wp_add_inline_style(
        'rgv-card-wallet-payment-page',
        $css . $this->payment_page_css() . $this->thankyou_page_css()
      );
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

  function arrangeCompletedVerification() {
    var verification = document.querySelector('#psc-research-checkout[data-psc-step="complete"]');
    var payment = document.querySelector('form#order_review #payment, .woocommerce-order-pay #order_review #payment');
    if (!verification || !payment || !payment.parentNode) return;
    if (payment.nextElementSibling !== verification) {
      payment.insertAdjacentElement('afterend', verification);
    }
  }

  function start() {
    neutralize(document.body);
    arrangeCompletedVerification();
    new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        if (mutation.type === 'characterData' && mutation.target.parentElement) {
          neutralize(mutation.target.parentElement);
        }
        mutation.addedNodes.forEach(function (node) {
          if (node.nodeType === 1) neutralize(node);
        });
      });
      arrangeCompletedVerification();
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-psc-step'] });
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
    echo '<span class="rgv-pay-nav__secure" aria-label="Secure checkout"><span aria-hidden="true">&#128274;</span> Secure checkout</span>';
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
    echo '<p class="rgv-payment-intro__eyebrow">Final secure step</p>';
    echo '<h1 id="rgv-payment-title">Complete your payment</h1>';
    echo '<p class="rgv-payment-intro__copy">Review your order, then pay securely by card or an available wallet.</p>';
    echo '<div class="rgv-payment-intro__trust" aria-label="Checkout protections">';
    echo '<span>Encrypted checkout</span><span>Your order is reserved</span>';
    echo '</div></section>';
  }

  private function payment_page_css() {
    return <<<'CSS'

      body.rgv-card-wallet-payment-page {
        --rgv-pay-bg: #050506;
        --rgv-pay-surface: #101114;
        --rgv-pay-surface-raised: #15161a;
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
