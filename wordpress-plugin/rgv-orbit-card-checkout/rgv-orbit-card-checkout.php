<?php
/**
 * Plugin Name: RGV ORBIT Card Checkout
 * Description: Embedded ORBIT credit and debit card checkout for WooCommerce.
 * Version: 1.0.1
 * Author: RGVPRIME LLC
 * Requires Plugins: woocommerce
 */

if (!defined('ABSPATH')) exit;

final class RGV_ORBIT_Card_Checkout {
  const REST_NAMESPACE = 'rgv/v1';
  const REQUEST_LOCK_TTL = 180;
  const REQUEST_RESULT_TTL = 86400;
  const ORDER_RATE_LIMIT_MAX = 10;
  const STATUS_RATE_LIMIT_MAX = 60;
  const RATE_LIMIT_WINDOW = 600;
  const MAX_ORDER_ITEMS = 50;
  const MAX_ITEM_QUANTITY = 100;
  const FREE_SHIPPING_MINIMUM = 200.0;
  const ORDER_PROCESSING_FEE_RATE = 0.03;
  const PRIORITY_PROCESSING_FEE_RATE = 0.05;
  const SHIPPING_RATES = [
    'ups_2_day_air' => ['title' => 'UPS Shipping', 'cost' => 15.0],
    'ups_expedited' => ['title' => 'UPS Shipping', 'cost' => 45.0, 'free_shipping_eligible' => false],
    'usps_ground_advantage' => ['title' => 'USPS Ground', 'cost' => 8.0],
    'usps_priority' => ['title' => 'USPS Priority Mail', 'cost' => 12.0],
  ];

  public function __construct() {
    add_action('rest_api_init', [$this, 'register_routes']);
  }

  public function register_routes() {
    register_rest_route(self::REST_NAMESPACE, '/orbit-card-config', [
      'methods' => WP_REST_Server::READABLE,
      'callback' => [$this, 'get_card_config'],
      'permission_callback' => '__return_true',
    ]);
    register_rest_route(self::REST_NAMESPACE, '/orbit-card-order', [
      'methods' => WP_REST_Server::CREATABLE,
      'callback' => [$this, 'create_card_order'],
      'permission_callback' => '__return_true',
    ]);
    register_rest_route(self::REST_NAMESPACE, '/orbit-card-status', [
      'methods' => WP_REST_Server::CREATABLE,
      'callback' => [$this, 'get_card_status'],
      'permission_callback' => '__return_true',
    ]);
    register_rest_route(self::REST_NAMESPACE, '/orbit-card-events', [
      'methods' => WP_REST_Server::CREATABLE,
      'callback' => [$this, 'handle_card_event'],
      'permission_callback' => '__return_true',
    ]);
  }

  private function get_client_ip() {
    foreach ([$_SERVER['HTTP_CF_CONNECTING_IP'] ?? '', $_SERVER['REMOTE_ADDR'] ?? ''] as $candidate) {
      $ip = trim(sanitize_text_field(wp_unslash((string) $candidate)));
      if ($ip && filter_var($ip, FILTER_VALIDATE_IP)) return $ip;
    }
    return 'unknown';
  }

  private function enforce_rate_limit($namespace, $maximum) {
    $key = 'rgv_orbit_card_rate_' . substr(hash('sha256', sanitize_key($namespace) . '|' . $this->get_client_ip()), 0, 32);
    $state = get_transient($key);
    if (!is_array($state) || (int) ($state['started_at'] ?? 0) + self::RATE_LIMIT_WINDOW <= time()) {
      $state = ['count' => 0, 'started_at' => time()];
    }
    if ((int) $state['count'] >= max(1, absint($maximum))) {
      return new WP_Error('rgv_orbit_card_rate_limited', 'Too many requests. Please wait a few minutes and try again.');
    }
    $state['count'] = (int) ($state['count'] ?? 0) + 1;
    set_transient($key, $state, self::RATE_LIMIT_WINDOW);
    return true;
  }

  private function setting($constant_name, $environment_name, $option_name) {
    $candidates = [
      getenv($environment_name),
      $_ENV[$environment_name] ?? '',
      $_SERVER[$environment_name] ?? '',
      defined($constant_name) ? constant($constant_name) : '',
      get_option($option_name, ''),
    ];
    foreach ($candidates as $candidate) {
      $candidate = trim((string) $candidate);
      if ($candidate !== '') return $candidate;
    }
    return '';
  }

  private function official_exchange_rate($manual_rate = 0.0) {
    if ($manual_rate > 0) {
      return ['rate' => $manual_rate, 'source' => 'manual_override', 'valid_until' => ''];
    }

    $cached = get_transient('rgv_orbit_card_official_trm');
    if (is_array($cached) && (float) ($cached['rate'] ?? 0) > 0) return $cached;

    $bogota_now = new DateTimeImmutable('now', new DateTimeZone('America/Bogota'));
    $today = $bogota_now->format('Y-m-d');
    $where = "vigenciadesde <= '{$today}T23:59:59' AND vigenciahasta >= '{$today}T00:00:00'";
    $url = 'https://www.datos.gov.co/resource/mcec-87by.json?%24select=valor%2Cvigenciadesde%2Cvigenciahasta' .
      '&%24where=' . rawurlencode($where) . '&%24order=vigenciadesde%20DESC&%24limit=1';
    $response = wp_remote_get($url, [
      'timeout' => 12,
      'redirection' => 0,
      'headers' => ['Accept' => 'application/json'],
    ]);

    if (!is_wp_error($response) && (int) wp_remote_retrieve_response_code($response) === 200) {
      $rows = json_decode((string) wp_remote_retrieve_body($response), true);
      $row = is_array($rows) && is_array($rows[0] ?? null) ? $rows[0] : [];
      $rate = (float) ($row['valor'] ?? 0);
      $valid_from = sanitize_text_field((string) ($row['vigenciadesde'] ?? ''));
      $valid_until = sanitize_text_field((string) ($row['vigenciahasta'] ?? ''));
      $valid_from_time = $valid_from ? strtotime($valid_from . ' America/Bogota') : false;
      $valid_until_time = $valid_until ? strtotime($valid_until . ' America/Bogota') : false;

      if ($rate >= 500 && $rate <= 20000 && $valid_from_time && $valid_until_time &&
        $valid_from_time <= time() + DAY_IN_SECONDS && $valid_until_time >= time() - DAY_IN_SECONDS) {
        $result = [
          'rate' => $rate,
          'source' => 'superfinanciera_trm',
          'valid_until' => $valid_until,
          'fetched_at' => time(),
        ];
        set_transient('rgv_orbit_card_official_trm', $result, 6 * HOUR_IN_SECONDS);
        update_option('rgv_orbit_card_last_official_trm', $result, false);
        return $result;
      }
    }

    $last_known = get_option('rgv_orbit_card_last_official_trm', []);
    if (is_array($last_known) && (float) ($last_known['rate'] ?? 0) >= 500 &&
      (int) ($last_known['fetched_at'] ?? 0) >= time() - 3 * DAY_IN_SECONDS) {
      $last_known['source'] = 'superfinanciera_trm_cached';
      return $last_known;
    }

    return ['rate' => 0.0, 'source' => 'unavailable', 'valid_until' => ''];
  }

  private function settings($load_exchange_rate = false) {
    $public_key = $this->setting('RGV_WOMPI_PUBLIC_KEY', 'WOMPI_PUBLIC_KEY', 'rgv_wompi_public_key');
    $private_key = $this->setting('RGV_WOMPI_PRIVATE_KEY', 'WOMPI_PRIVATE_KEY', 'rgv_wompi_private_key');
    $integrity_secret = $this->setting('RGV_WOMPI_INTEGRITY_SECRET', 'WOMPI_INTEGRITY_SECRET', 'rgv_wompi_integrity_secret');
    $events_secret = $this->setting('RGV_WOMPI_EVENTS_SECRET', 'WOMPI_EVENTS_SECRET', 'rgv_wompi_events_secret');
    $manual_rate = (float) $this->setting('RGV_WOMPI_COP_PER_USD', 'WOMPI_COP_PER_USD', 'rgv_wompi_cop_per_usd');
    $test_mode = strpos($public_key, 'pub_test_') === 0;
    $public_valid = (bool) preg_match('/^pub_(?:test|prod)_[A-Za-z0-9]+$/', $public_key);
    $private_valid = (bool) preg_match('/^prv_(?:test|prod)_[A-Za-z0-9]+$/', $private_key);
    $environment_matches = $test_mode ? strpos($private_key, 'prv_test_') === 0 : strpos($private_key, 'prv_prod_') === 0;
    $credentials_configured = $public_valid && $private_valid && $environment_matches &&
      $integrity_secret !== '' && $events_secret !== '';
    $exchange_rate = $load_exchange_rate && $credentials_configured
      ? $this->official_exchange_rate($manual_rate)
      : ['rate' => $manual_rate, 'source' => $manual_rate > 0 ? 'manual_override' : 'not_loaded', 'valid_until' => ''];

    return [
      'public_key' => $public_key,
      'private_key' => $private_key,
      'integrity_secret' => $integrity_secret,
      'events_secret' => $events_secret,
      'cop_per_usd' => (float) $exchange_rate['rate'],
      'exchange_rate_source' => (string) $exchange_rate['source'],
      'exchange_rate_valid_until' => (string) ($exchange_rate['valid_until'] ?? ''),
      'environment' => $test_mode ? 'sandbox' : 'production',
      'base_url' => $test_mode ? 'https://sandbox.wompi.co/v1' : 'https://production.wompi.co/v1',
      'configured' => $credentials_configured && (!$load_exchange_rate || (float) $exchange_rate['rate'] > 0),
    ];
  }

  private function json_request($method, $url, $headers = [], $body = null) {
    $args = [
      'method' => strtoupper($method),
      'timeout' => 25,
      'redirection' => 0,
      'headers' => array_merge(['Accept' => 'application/json'], $headers),
    ];
    if ($body !== null) {
      $args['headers']['Content-Type'] = 'application/json';
      $args['body'] = wp_json_encode($body);
      $args['data_format'] = 'body';
    }
    $response = wp_remote_request($url, $args);
    if (is_wp_error($response)) return $response;

    $status = (int) wp_remote_retrieve_response_code($response);
    $decoded = json_decode((string) wp_remote_retrieve_body($response), true);
    $decoded = is_array($decoded) ? $decoded : [];
    if ($status < 200 || $status >= 300) {
      $message = sanitize_text_field((string) (
        $decoded['error']['reason'] ?? $decoded['error']['message'] ?? $decoded['message'] ?? 'The card processor rejected the request.'
      ));
      return new WP_Error('rgv_orbit_card_api_error', $message, ['status' => $status]);
    }
    return $decoded;
  }

  private function merchant_info($settings) {
    $cache_key = 'rgv_orbit_card_merchant_' . substr(hash('sha256', $settings['public_key']), 0, 24);
    $cached = get_transient($cache_key);
    if (is_array($cached)) return $cached;
    $result = $this->json_request('GET', $settings['base_url'] . '/merchants/info', [
      'x-merchant-public-key' => $settings['public_key'],
    ]);
    if (!is_wp_error($result)) set_transient($cache_key, $result, 10 * MINUTE_IN_SECONDS);
    return $result;
  }

  private function tokenization_key($settings) {
    $cache_key = 'rgv_orbit_card_token_key_' . substr(hash('sha256', $settings['public_key']), 0, 24);
    $cached = get_transient($cache_key);
    if (is_string($cached) && $cached !== '') return $cached;
    $result = $this->json_request('GET', $settings['base_url'] . '/tokens/keys/tokenization', [
      'Authorization' => 'Bearer ' . $settings['public_key'],
    ]);
    if (is_wp_error($result)) return $result;
    $public_key = trim((string) ($result['data']['publicKey'] ?? $result['data']['public_key'] ?? ''));
    if (strpos($public_key, 'BEGIN PUBLIC KEY') === false) {
      return new WP_Error('rgv_orbit_card_token_key_missing', 'The card processor did not return its tokenization key.');
    }
    set_transient($cache_key, $public_key, HOUR_IN_SECONDS);
    return $public_key;
  }

  private function contracts($merchant_info) {
    $data = is_array($merchant_info['data'] ?? null) ? $merchant_info['data'] : [];
    $policy = is_array($data['presigned_acceptance'] ?? null) ? $data['presigned_acceptance'] : [];
    $personal = is_array($data['presigned_personal_data_auth'] ?? null) ? $data['presigned_personal_data_auth'] : [];
    return [
      'acceptance_token' => (string) ($policy['acceptance_token'] ?? ''),
      'acceptance_url' => esc_url_raw((string) ($policy['permalink'] ?? '')),
      'personal_auth_token' => (string) ($personal['acceptance_token'] ?? ''),
      'personal_auth_url' => esc_url_raw((string) ($personal['permalink'] ?? '')),
    ];
  }

  public function get_card_config(WP_REST_Request $request) {
    unset($request);
    if (!headers_sent()) nocache_headers();
    $settings = $this->settings(true);
    if (!$settings['configured']) {
      return new WP_REST_Response(['success' => false, 'configured' => false, 'message' => 'ORBIT card payments are not configured yet.'], 503);
    }
    $merchant_info = $this->merchant_info($settings);
    $tokenization_key = $this->tokenization_key($settings);
    if (is_wp_error($merchant_info) || is_wp_error($tokenization_key)) {
      return new WP_REST_Response(['success' => false, 'configured' => false, 'message' => 'ORBIT card security is temporarily unavailable.'], 503);
    }
    $contracts = $this->contracts($merchant_info);
    if (!$contracts['acceptance_url'] || !$contracts['personal_auth_url']) {
      return new WP_REST_Response(['success' => false, 'configured' => false, 'message' => 'Card acceptance documents are unavailable.'], 503);
    }
    return new WP_REST_Response([
      'success' => true,
      'configured' => true,
      'environment' => $settings['environment'],
      'baseUrl' => $settings['base_url'],
      'publicKey' => $settings['public_key'],
      'tokenizationPublicKey' => $tokenization_key,
      'copPerUsd' => $settings['cop_per_usd'],
      'exchangeRateSource' => $settings['exchange_rate_source'],
      'exchangeRateValidUntil' => $settings['exchange_rate_valid_until'],
      'contracts' => [
        'acceptanceUrl' => $contracts['acceptance_url'],
        'personalAuthUrl' => $contracts['personal_auth_url'],
      ],
    ], 200);
  }

  private function compliance_secret() {
    $candidates = [
      defined('RGV_COMPLIANCE_SIGNING_SECRET') ? RGV_COMPLIANCE_SIGNING_SECRET : '',
      defined('RGV_PORTAL_API_SECRET') ? RGV_PORTAL_API_SECRET : '',
      getenv('COMPLIANCE_SIGNING_SECRET'),
      getenv('PORTAL_API_SECRET'),
      get_option('rgv_compliance_signing_secret', ''),
      get_option('rgv_portal_api_secret', ''),
      get_option('rgv_portal_secret', ''),
    ];
    foreach ($candidates as $candidate) {
      $candidate = trim((string) $candidate);
      if ($candidate !== '') return $candidate;
    }
    return '';
  }

  private function validate_compliance(WP_REST_Request $request, array $data) {
    $secret = $this->compliance_secret();
    $provided = (string) $request->get_header('x-rgv-compliance-secret');
    if (!$secret || !$provided || !hash_equals($secret, $provided)) {
      return new WP_Error('rgv_orbit_card_session_required', 'This order must be submitted through the secure storefront checkout.', ['status' => 401]);
    }
    foreach (['ageConfirmed', 'researchUseAcknowledged', 'termsAccepted'] as $field) {
      if (($data[$field] ?? null) !== true) {
        return new WP_Error('rgv_orbit_card_compliance_required', 'The 21+, Research Use Only, and Terms confirmations are required.', ['status' => 400]);
      }
    }
    $acceptance = is_array($data['complianceAcceptance'] ?? null) ? $data['complianceAcceptance'] : [];
    $email = sanitize_email($acceptance['userEmail'] ?? $acceptance['email'] ?? '');
    $initial_at = sanitize_text_field((string) ($acceptance['acceptedAt'] ?? ''));
    $final_at = sanitize_text_field((string) ($acceptance['finalAcceptedAt'] ?? ''));
    $policy_version = sanitize_text_field((string) ($acceptance['policyVersion'] ?? ''));
    $text_version = sanitize_text_field((string) ($acceptance['textVersion'] ?? ''));
    if (
      $policy_version !== 'rgv-ruo-terms-2026-08-31-v1' ||
      $text_version !== 'checkout-certification-2026-08-31-v1' ||
      !$email || !is_email($email) || !$initial_at || !strtotime($initial_at) ||
      !$final_at || !strtotime($final_at) || abs(time() - strtotime($final_at)) > 600
    ) return new WP_Error('rgv_orbit_card_compliance_invalid', 'Compliance acceptance evidence is invalid or expired.', ['status' => 400]);

    return [
      'policy_version' => $policy_version,
      'text_version' => $text_version,
      'accepted_at' => gmdate('c', strtotime($initial_at)),
      'final_accepted_at' => gmdate('c', strtotime($final_at)),
      'user_id' => absint($acceptance['userId'] ?? 0),
      'user_email' => $email,
      'ip' => sanitize_text_field((string) ($acceptance['requestIp'] ?? $acceptance['ip'] ?? 'unknown')),
    ];
  }

  private function store_compliance(WC_Order $order, array $acceptance) {
    $order->update_meta_data('_rgv_compliance_order_id', $order->get_id());
    $order->update_meta_data('_rgv_compliance_policy_version', $acceptance['policy_version']);
    $order->update_meta_data('_rgv_compliance_text_version', $acceptance['text_version']);
    $order->update_meta_data('_rgv_compliance_initial_accepted_at_utc', $acceptance['accepted_at']);
    $order->update_meta_data('_rgv_compliance_final_accepted_at_utc', $acceptance['final_accepted_at']);
    $order->update_meta_data('_rgv_compliance_user_id', $acceptance['user_id']);
    $order->update_meta_data('_rgv_compliance_user_email', $acceptance['user_email']);
    $order->update_meta_data('_rgv_compliance_ip', $acceptance['ip']);
    $order->update_meta_data('_rgv_age_21_certified', 'yes');
    $order->update_meta_data('_rgv_research_use_only_accepted', 'yes');
    $order->update_meta_data('_rgv_terms_accepted', 'yes');
    if ($acceptance['user_id'] > 0) $order->set_customer_id($acceptance['user_id']);
  }

  private function clean_coupon($coupon) {
    return preg_replace('/[^A-Z0-9\-_]/', '', strtoupper(sanitize_text_field((string) $coupon)));
  }

  private function priority_requested($data) {
    return (bool) filter_var($data['priorityProcessing'] ?? $data['priority_processing'] ?? false, FILTER_VALIDATE_BOOLEAN);
  }

  private function request_key(WP_REST_Request $request, $data, $items, $billing, $shipping) {
    $provided = sanitize_text_field((string) $request->get_header('idempotency-key'));
    if (!$provided) {
      foreach (['requestId', 'request_id', 'idempotencyKey', 'idempotency_key'] as $field) {
        if (!empty($data[$field])) { $provided = sanitize_text_field((string) $data[$field]); break; }
      }
    }
    if ($provided) return hash('sha256', $provided);
    $normalized_items = [];
    foreach ($items as $item) {
      $normalized_items[] = [
        'product_id' => absint($item['product_id'] ?? 0),
        'variation_id' => absint($item['variation_id'] ?? 0),
        'quantity' => max(1, absint($item['quantity'] ?? 1)),
      ];
    }
    usort($normalized_items, static function ($left, $right) { return strcmp(wp_json_encode($left), wp_json_encode($right)); });
    return hash('sha256', wp_json_encode([
      'email' => strtolower(sanitize_email($billing['email'] ?? $shipping['email'] ?? '')),
      'phone' => preg_replace('/\D+/', '', (string) ($billing['phone'] ?? $shipping['phone'] ?? '')),
      'address' => sanitize_text_field((string) ($shipping['address_1'] ?? $billing['address_1'] ?? '')),
      'postcode' => sanitize_text_field((string) ($shipping['postcode'] ?? $billing['postcode'] ?? '')),
      'coupon' => $this->clean_coupon($data['coupon'] ?? $data['couponCode'] ?? ''),
      'priority' => $this->priority_requested($data),
      'items' => $normalized_items,
    ]));
  }

  private function claim_request($option_name) {
    $existing = get_option($option_name, null);
    if (is_array($existing) && (int) ($existing['expires_at'] ?? 0) <= time()) {
      delete_option($option_name);
      $existing = null;
    }
    if (is_array($existing)) return false;
    return add_option($option_name, [
      'status' => 'processing',
      'order_id' => 0,
      'created_at' => time(),
      'expires_at' => time() + self::REQUEST_LOCK_TTL,
    ], '', 'no');
  }

  private function complete_request($option_name, $order_id) {
    update_option($option_name, [
      'status' => 'completed',
      'order_id' => absint($order_id),
      'created_at' => time(),
      'expires_at' => time() + self::REQUEST_RESULT_TTL,
    ], false);
  }

  private function existing_order($option_name) {
    for ($attempt = 0; $attempt < 10; $attempt++) {
      $state = get_option($option_name, []);
      $order = !empty($state['order_id']) ? wc_get_order(absint($state['order_id'])) : null;
      if ($order) return $order;
      if ($attempt < 9) usleep(200000);
    }
    return null;
  }

  private function get_product($item) {
    $product_id = absint($item['product_id'] ?? 0);
    $variation_id = absint($item['variation_id'] ?? 0);
    if ($variation_id > 0) {
      $variation = wc_get_product($variation_id);
      return $variation instanceof WC_Product && $variation->is_type('variation') &&
        (!$product_id || (int) $variation->get_parent_id() === $product_id) ? $variation : null;
    }
    return $product_id > 0 ? wc_get_product($product_id) : null;
  }

  private function validate_stock($item) {
    $product = $this->get_product($item);
    $quantity = max(1, absint($item['quantity'] ?? 1));
    if (!$product instanceof WC_Product || !$product->exists()) return new WP_Error('rgv_orbit_card_product_missing', 'A product in the cart could not be found.');
    $name = wp_strip_all_tags($product->get_name());
    if (!$product->is_purchasable()) return new WP_Error('rgv_orbit_card_product_unavailable', sprintf('%s is no longer available.', $name));
    if (!$product->is_in_stock() && !$product->backorders_allowed()) return new WP_Error('rgv_orbit_card_sold_out', sprintf('%s is sold out.', $name));
    if (!$product->backorders_allowed() && !$product->has_enough_stock($quantity)) {
      return new WP_Error('rgv_orbit_card_stock', sprintf('Only %d unit(s) of %s are available.', max(0, (int) $product->get_stock_quantity()), $name));
    }
    return true;
  }

  private function validate_payload($items, $billing, $shipping) {
    if (!$items || count($items) > self::MAX_ORDER_ITEMS) return new WP_Error('rgv_orbit_card_items', 'The cart is empty or has too many items.');
    foreach ([$billing, $shipping] as $address) {
      if (strtoupper(sanitize_text_field($address['country'] ?? '')) === 'PR' || strtoupper(sanitize_text_field($address['state'] ?? '')) === 'PR') {
        return new WP_Error('rgv_orbit_card_destination', 'Shipping to Puerto Rico is not available.');
      }
    }
    foreach (['first_name', 'last_name', 'email', 'phone', 'address_1', 'city', 'state', 'postcode', 'country'] as $field) {
      if (empty($shipping[$field]) && empty($billing[$field])) return new WP_Error('rgv_orbit_card_field', 'Complete all required contact and shipping fields.');
    }
    $email = sanitize_email($billing['email'] ?? $shipping['email'] ?? '');
    if (!$email || !is_email($email)) return new WP_Error('rgv_orbit_card_email', 'A valid email is required.');
    foreach ($items as $item) {
      if (!is_array($item)) return new WP_Error('rgv_orbit_card_item', 'A cart item is invalid.');
      $quantity = absint($item['quantity'] ?? 0);
      if ($quantity < 1 || $quantity > self::MAX_ITEM_QUANTITY) return new WP_Error('rgv_orbit_card_quantity', 'A cart item has an invalid quantity.');
      $stock = $this->validate_stock($item);
      if (is_wp_error($stock)) return $stock;
    }
    return true;
  }

  private function clean_address($address) {
    return [
      'first_name' => sanitize_text_field($address['first_name'] ?? ''),
      'last_name' => sanitize_text_field($address['last_name'] ?? ''),
      'company' => sanitize_text_field($address['company'] ?? ''),
      'email' => sanitize_email($address['email'] ?? ''),
      'phone' => sanitize_text_field($address['phone'] ?? ''),
      'address_1' => sanitize_text_field($address['address_1'] ?? ''),
      'address_2' => sanitize_text_field($address['address_2'] ?? ''),
      'city' => sanitize_text_field($address['city'] ?? ''),
      'state' => sanitize_text_field($address['state'] ?? ''),
      'postcode' => sanitize_text_field($address['postcode'] ?? ''),
      'country' => sanitize_text_field($address['country'] ?? 'US'),
    ];
  }

  private function add_product(WC_Order $order, $item) {
    $stock = $this->validate_stock($item);
    if (is_wp_error($stock)) throw new Exception($stock->get_error_message());
    $product = $this->get_product($item);
    $quantity = max(1, absint($item['quantity'] ?? 1));
    $total = (float) wc_format_decimal((float) $product->get_price() * $quantity);
    $order->add_product($product, $quantity, ['subtotal' => $total, 'total' => $total]);
    return $total;
  }

  private function shipping($data, $free) {
    $rates = apply_filters('rgv_orbit_card_shipping_rates', self::SHIPPING_RATES);
    if (!is_array($rates)) $rates = self::SHIPPING_RATES;
    $value = $data['shippingMethod'] ?? $data['shipping_method'] ?? '';
    if (is_array($value)) $value = $value['id'] ?? $value['method_id'] ?? '';
    $id = sanitize_key((string) $value);
    $selected = isset($rates[$id]) && is_array($rates[$id]) ? $rates[$id] : ($rates['usps_ground_advantage'] ?? self::SHIPPING_RATES['usps_ground_advantage']);
    if ($free && false !== ($selected['free_shipping_eligible'] ?? true)) {
      return ['id' => 'free_shipping', 'title' => "Free Shipping (Order's Over $200)", 'cost' => 0.0];
    }
    return [
      'id' => $id && isset($rates[$id]) ? $id : 'usps_ground_advantage',
      'title' => sanitize_text_field((string) ($selected['title'] ?? 'Shipping')),
      'cost' => max(0, (float) ($selected['cost'] ?? 8)),
    ];
  }

  private function add_fee(WC_Order $order, $name, $amount) {
    $amount = (float) wc_format_decimal($amount, wc_get_price_decimals());
    if ($amount <= 0) return;
    $fee = new WC_Order_Item_Fee();
    $fee->set_name($name);
    $fee->set_amount($amount);
    $fee->set_total($amount);
    $fee->set_tax_status('none');
    $order->add_item($fee);
  }

  private function add_fees(WC_Order $order, $data) {
    $base = max(0.0, (float) $order->get_total());
    if ($base <= 0) return;
    $standard = max(0.0, (float) apply_filters('rgv_orbit_card_processing_fee_rate', self::ORDER_PROCESSING_FEE_RATE));
    $priority = max(0.0, (float) apply_filters('rgv_orbit_card_priority_fee_rate', self::PRIORITY_PROCESSING_FEE_RATE));
    $priority_requested = $this->priority_requested($data);
    $this->add_fee($order, 'Service & Processing', $base * $standard);
    if ($priority_requested) {
      $this->add_fee($order, 'Priority Processing (within 3 hours)', $base * $priority);
      $order->add_order_note('Priority processing requested: order should enter processing within 3 hours.');
    }
    $order->update_meta_data('_rgv_priority_processing', $priority_requested ? 'yes' : 'no');
    $order->calculate_totals();
  }

  private function flag_review(WC_Order $order, $items, $billing, $shipping, $acceptance) {
    $signals = [];
    $quantity = 0;
    foreach ($items as $item) {
      $item_quantity = max(0, absint($item['quantity'] ?? 0));
      $quantity += $item_quantity;
      if ($item_quantity >= 5) $signals[] = 'five_or_more_of_one_item';
    }
    if ($quantity >= 10) $signals[] = 'high_total_unit_count';
    if (strtolower(sanitize_email($billing['email'] ?? '')) !== strtolower($acceptance['user_email'])) $signals[] = 'account_and_billing_email_mismatch';
    if (!empty($billing['postcode']) && !empty($shipping['postcode']) && sanitize_text_field($billing['postcode']) !== sanitize_text_field($shipping['postcode'])) {
      $signals[] = 'billing_and_shipping_zip_mismatch';
    }
    $signals = array_values(array_unique($signals));
    if (!$signals) return;
    $order->update_meta_data('_rgv_manual_misuse_review_required', 'yes');
    $order->update_meta_data('_rgv_manual_misuse_review_signals', implode(',', $signals));
    $order->add_order_note('Manual misuse review required before fulfillment. Signals: ' . implode(', ', $signals) . '. Cancel the order if the review cannot establish qualified research use.');
    $order->set_status('on-hold');
  }

  private function order_response(WC_Order $order) {
    return [
      'orderId' => $order->get_id(),
      'orderNumber' => $order->get_order_number(),
      'orderKey' => $order->get_order_key(),
      'status' => $order->get_status(),
      'totalUsd' => (float) $order->get_total(),
      'amountCopInCents' => (int) $order->get_meta('_rgv_orbit_card_amount_cop_cents', true),
      'copPerUsd' => (float) $order->get_meta('_rgv_orbit_card_cop_per_usd', true),
      'transactionId' => (string) $order->get_meta('_rgv_orbit_card_transaction_id', true),
      'transactionStatus' => (string) $order->get_meta('_rgv_orbit_card_status', true),
    ];
  }

  private function find_order($transaction_id) {
    if (!$transaction_id) return null;
    $orders = wc_get_orders([
      'limit' => 1,
      'type' => 'shop_order',
      'meta_query' => [[
        'key' => '_rgv_orbit_card_transaction_id',
        'value' => $transaction_id,
        'compare' => '=',
      ]],
      'return' => 'objects',
    ]);
    return !empty($orders) && $orders[0] instanceof WC_Order ? $orders[0] : null;
  }

  private function sync_order(WC_Order $order, array $transaction) {
    $id = sanitize_text_field((string) ($transaction['id'] ?? ''));
    $reference = sanitize_text_field((string) ($transaction['reference'] ?? ''));
    $status = strtoupper(sanitize_key((string) ($transaction['status'] ?? '')));
    $amount = absint($transaction['amount_in_cents'] ?? 0);
    $currency = strtoupper(sanitize_text_field((string) ($transaction['currency'] ?? '')));
    $method = strtoupper(sanitize_text_field((string) ($transaction['payment_method_type'] ?? '')));
    $expected_id = (string) $order->get_meta('_rgv_orbit_card_transaction_id', true);
    $expected_reference = (string) $order->get_meta('_rgv_orbit_card_reference', true);
    $expected_amount = (int) $order->get_meta('_rgv_orbit_card_amount_cop_cents', true);
    if (!$id || !$expected_id || !hash_equals($expected_id, $id) || !hash_equals($expected_reference, $reference) ||
      $amount !== $expected_amount || $currency !== 'COP' || $method !== 'CARD') {
      return new WP_Error('rgv_orbit_card_transaction_mismatch', 'Card transaction verification failed.');
    }

    $order->update_meta_data('_rgv_orbit_card_status', $status);
    $order->update_meta_data('_rgv_orbit_card_last_verified_at', current_time('mysql', true));
    if ($status === 'APPROVED') {
      if (!$order->is_paid()) $order->payment_complete($id);
      if ($order->get_meta('_rgv_manual_misuse_review_required') === 'yes') {
        $order->update_status('on-hold', 'Card payment approved; order retained for required manual review.');
      }
    } elseif (in_array($status, ['DECLINED', 'VOIDED', 'ERROR'], true) && !$order->is_paid()) {
      $order->update_status('failed', 'ORBIT card payment ended with status ' . $status . '.');
    }
    $order->save();
    return true;
  }

  public function create_card_order(WP_REST_Request $request) {
    if (!class_exists('WooCommerce') || !function_exists('wc_create_order')) {
      return new WP_REST_Response(['success' => false, 'message' => 'WooCommerce is unavailable.'], 503);
    }
    $rate = $this->enforce_rate_limit('order', self::ORDER_RATE_LIMIT_MAX);
    if (is_wp_error($rate)) return new WP_REST_Response(['success' => false, 'message' => $rate->get_error_message()], 429);
    $data = $request->get_json_params();
    $data = is_array($data) ? $data : [];
    $compliance = $this->validate_compliance($request, $data);
    if (is_wp_error($compliance)) return new WP_REST_Response(['success' => false, 'message' => $compliance->get_error_message()], (int) ($compliance->get_error_data()['status'] ?? 400));
    if (($data['processorAcceptance'] ?? null) !== true || ($data['processorPersonalAuth'] ?? null) !== true) {
      return new WP_REST_Response(['success' => false, 'message' => 'Accept both card processor data policies before paying.'], 400);
    }

    $card_token = sanitize_text_field((string) ($data['cardToken'] ?? ''));
    $installments = absint($data['installments'] ?? 1);
    if (!preg_match('/^tok_(?:test|prod)_[A-Za-z0-9_]+$/', $card_token) || $installments < 1 || $installments > 36) {
      return new WP_REST_Response(['success' => false, 'message' => 'The secure card token is invalid.'], 400);
    }
    $settings = $this->settings(true);
    if (!$settings['configured']) return new WP_REST_Response(['success' => false, 'message' => 'ORBIT card payments are not configured.'], 503);
    if (($settings['environment'] === 'sandbox' && strpos($card_token, 'tok_test_') !== 0) ||
      ($settings['environment'] === 'production' && strpos($card_token, 'tok_prod_') !== 0)) {
      return new WP_REST_Response(['success' => false, 'message' => 'The card token does not match the configured environment.'], 400);
    }

    $merchant_info = $this->merchant_info($settings);
    if (is_wp_error($merchant_info)) return new WP_REST_Response(['success' => false, 'message' => 'Unable to load card acceptance tokens.'], 503);
    $contracts = $this->contracts($merchant_info);
    if (!$contracts['acceptance_token'] || !$contracts['personal_auth_token']) {
      return new WP_REST_Response(['success' => false, 'message' => 'Card acceptance tokens are unavailable.'], 503);
    }

    $items = is_array($data['items'] ?? null) ? $data['items'] : [];
    $billing = is_array($data['billing'] ?? null) ? $data['billing'] : [];
    $shipping = is_array($data['shipping'] ?? null) ? $data['shipping'] : $billing;
    $validation = $this->validate_payload($items, $billing, $shipping);
    if (is_wp_error($validation)) return new WP_REST_Response(['success' => false, 'message' => $validation->get_error_message()], 400);

    $request_key = hash('sha256', 'orbit-card|' . $this->request_key($request, $data, $items, $billing, $shipping));
    $request_option = '_rgv_orbit_card_req_' . substr($request_key, 0, 40);
    if (!$this->claim_request($request_option)) {
      $existing = $this->existing_order($request_option);
      if ($existing) {
        if (!(string) $existing->get_meta('_rgv_orbit_card_transaction_id', true)) {
          return new WP_REST_Response(array_merge([
            'success' => false,
            'verificationRequired' => true,
            'duplicatePrevented' => true,
            'message' => 'This payment was already submitted and must be verified before another attempt.',
          ], $this->order_response($existing)), 409);
        }
        return new WP_REST_Response(array_merge(['success' => true, 'duplicatePrevented' => true], $this->order_response($existing)), 200);
      }
      return new WP_REST_Response(['success' => false, 'processing' => true, 'message' => 'Your card payment is already being prepared.'], 409);
    }

    $order = null;
    $processor_submitted = false;
    try {
      $order = wc_create_order();
      $order->set_address($this->clean_address($billing), 'billing');
      $order->set_address($this->clean_address($shipping), 'shipping');
      $order->set_payment_method('rgv_orbit_card');
      $order->set_payment_method_title('ORBIT Card');
      $order->set_created_via('rgv_custom_checkout_orbit_card');
      $order->update_meta_data('_rgv_payment_source', 'rgv_custom_checkout_orbit_card');
      $order->update_meta_data('_rgv_orbit_card_request_key', $request_key);
      $this->store_compliance($order, $compliance);

      $subtotal = 0.0;
      foreach ($items as $item) $subtotal += $this->add_product($order, $item);
      if ($subtotal <= 0) throw new Exception('No valid order items were added.');
      $coupon = $this->clean_coupon($data['couponCode'] ?? $data['coupon'] ?? '');
      $coupon_free_shipping = false;
      if ($coupon) {
        $coupon_result = $order->apply_coupon($coupon);
        if (is_wp_error($coupon_result)) throw new Exception($coupon_result->get_error_message());
        $coupon_free_shipping = (bool) (new WC_Coupon($coupon))->get_free_shipping();
      }
      $shipping_details = $this->shipping($data, $subtotal >= self::FREE_SHIPPING_MINIMUM || $coupon_free_shipping);
      $shipping_item = new WC_Order_Item_Shipping();
      $shipping_item->set_method_title($shipping_details['title']);
      $shipping_item->set_method_id($shipping_details['id']);
      $shipping_item->set_total((float) $shipping_details['cost']);
      $order->add_item($shipping_item);
      $order->calculate_totals();
      $this->add_fees($order, $data);
      $this->flag_review($order, $items, $billing, $shipping, $compliance);
      $order->save();

      $total_usd = (float) $order->get_total();
      if (strtoupper((string) $order->get_currency()) !== 'USD' || $total_usd <= 0) throw new Exception('A positive USD order total is required before conversion.');
      $amount_cop_cents = (int) round($total_usd * $settings['cop_per_usd'] * 100);
      if ($amount_cop_cents <= 0) throw new Exception('The converted card charge must be positive.');
      $reference = 'RGV-' . $order->get_id() . '-' . strtoupper(wp_generate_password(8, false, false));
      $signature = hash('sha256', $reference . $amount_cop_cents . 'COP' . $settings['integrity_secret']);
      $order->update_meta_data('_rgv_orbit_card_reference', $reference);
      $order->update_meta_data('_rgv_orbit_card_amount_cop_cents', $amount_cop_cents);
      $order->update_meta_data('_rgv_orbit_card_cop_per_usd', $settings['cop_per_usd']);
      $order->update_meta_data('_rgv_orbit_card_exchange_rate_source', $settings['exchange_rate_source']);
      $order->update_meta_data('_rgv_orbit_card_exchange_rate_valid_until', $settings['exchange_rate_valid_until']);
      $order->update_meta_data('_rgv_orbit_card_environment', $settings['environment']);
      $order->save();
      $this->complete_request($request_option, $order->get_id());

      $processor_submitted = true;
      $transaction_response = $this->json_request('POST', $settings['base_url'] . '/transactions', [
        'Authorization' => 'Bearer ' . $settings['private_key'],
      ], [
        'acceptance_token' => $contracts['acceptance_token'],
        'accept_personal_auth' => $contracts['personal_auth_token'],
        'amount_in_cents' => $amount_cop_cents,
        'currency' => 'COP',
        'customer_email' => $order->get_billing_email(),
        'payment_method' => ['type' => 'CARD', 'token' => $card_token, 'installments' => $installments],
        'payment_method_type' => 'CARD',
        'reference' => $reference,
        'signature' => $signature,
        'customer_data' => [
          'full_name' => trim($order->get_formatted_billing_full_name()),
          'phone_number' => preg_replace('/[^0-9+]/', '', (string) $order->get_billing_phone()),
        ],
        'ip' => (string) $compliance['ip'],
      ]);
      if (is_wp_error($transaction_response)) {
        if ($transaction_response->get_error_code() === 'rgv_orbit_card_api_error') $processor_submitted = false;
        throw new Exception($transaction_response->get_error_message());
      }
      $transaction = is_array($transaction_response['data'] ?? null) ? $transaction_response['data'] : [];
      $transaction_id = sanitize_text_field((string) ($transaction['id'] ?? ''));
      if (!$transaction_id || !preg_match('/^[A-Za-z0-9_-]{8,191}$/', $transaction_id)) throw new Exception('The card processor did not return a valid transaction ID.');
      $order->update_meta_data('_rgv_orbit_card_transaction_id', $transaction_id);
      $order->update_meta_data('_rgv_orbit_card_status', strtoupper(sanitize_key((string) ($transaction['status'] ?? 'PENDING'))));
      $order->add_order_note('ORBIT card transaction created: ' . $transaction_id . '. COP charge: ' . wc_format_decimal($amount_cop_cents / 100, 2) . '.');
      $order->save();
      $sync = $this->sync_order($order, $transaction);
      if (is_wp_error($sync)) throw new Exception($sync->get_error_message());
      return new WP_REST_Response(array_merge(['success' => true, 'duplicatePrevented' => false], $this->order_response($order)), 200);
    } catch (Exception $error) {
      if ($processor_submitted && $order instanceof WC_Order && $order->get_id()) {
        if (!$order->is_paid()) $order->update_status('on-hold', 'Card submission had an uncertain response. Verify the processor reference before retrying or collecting another payment.');
        return new WP_REST_Response(array_merge([
          'success' => false,
          'verificationRequired' => true,
          'message' => 'The card payment was submitted, but its result could not be confirmed. Do not retry it yet.',
        ], $this->order_response($order)), 503);
      }
      delete_option($request_option);
      if ($order instanceof WC_Order && $order->get_id() && !$order->is_paid()) $order->update_status('failed', 'ORBIT checkout failed before the payment was submitted.');
      return new WP_REST_Response(['success' => false, 'message' => $error->getMessage()], 500);
    }
  }

  public function get_card_status(WP_REST_Request $request) {
    $rate = $this->enforce_rate_limit('status', self::STATUS_RATE_LIMIT_MAX);
    if (is_wp_error($rate)) return new WP_REST_Response(['success' => false, 'message' => $rate->get_error_message()], 429);
    $secret = $this->compliance_secret();
    $provided = (string) $request->get_header('x-rgv-compliance-secret');
    if (!$secret || !$provided || !hash_equals($secret, $provided)) return new WP_REST_Response(['success' => false, 'message' => 'Secure checkout session required.'], 401);
    $data = $request->get_json_params();
    $data = is_array($data) ? $data : [];
    $order = !empty($data['orderId']) ? wc_get_order(absint($data['orderId'])) : null;
    $order_key = sanitize_text_field((string) ($data['orderKey'] ?? ''));
    if (!$order || !$order_key || !hash_equals((string) $order->get_order_key(), $order_key) || $order->get_payment_method() !== 'rgv_orbit_card') {
      return new WP_REST_Response(['success' => false, 'message' => 'ORBIT card order not found.'], 404);
    }
    $settings = $this->settings();
    $transaction_id = (string) $order->get_meta('_rgv_orbit_card_transaction_id', true);
    if (!$settings['configured'] || !$transaction_id) return new WP_REST_Response(['success' => false, 'message' => 'The card transaction is not ready for verification.'], 409);
    $response = $this->json_request('GET', $settings['base_url'] . '/transactions/' . rawurlencode($transaction_id), [
      'Authorization' => 'Bearer ' . $settings['private_key'],
    ]);
    if (is_wp_error($response)) return new WP_REST_Response(['success' => false, 'message' => 'Unable to verify the ORBIT card transaction.'], 503);
    $transaction = is_array($response['data'] ?? null) ? $response['data'] : [];
    $sync = $this->sync_order($order, $transaction);
    if (is_wp_error($sync)) return new WP_REST_Response(['success' => false, 'message' => $sync->get_error_message()], 409);
    return new WP_REST_Response(array_merge(['success' => true], $this->order_response($order)), 200);
  }

  private function event_property(array $data, $path) {
    $value = $data;
    foreach (explode('.', (string) $path) as $segment) {
      if (!is_array($value) || !array_key_exists($segment, $value)) return '';
      $value = $value[$segment];
    }
    return is_bool($value) ? ($value ? 'true' : 'false') : (string) $value;
  }

  public function handle_card_event(WP_REST_Request $request) {
    $payload = $request->get_json_params();
    $payload = is_array($payload) ? $payload : [];
    $settings = $this->settings();
    $properties = is_array($payload['signature']['properties'] ?? null) ? $payload['signature']['properties'] : [];
    $provided = strtoupper(sanitize_text_field((string) ($payload['signature']['checksum'] ?? $request->get_header('x-event-checksum'))));
    $signed = '';
    foreach ($properties as $property) $signed .= $this->event_property($payload['data'] ?? [], $property);
    $signed .= (string) absint($payload['timestamp'] ?? 0);
    $expected = strtoupper(hash('sha256', $signed . $settings['events_secret']));
    if (!$settings['events_secret'] || !$provided || !hash_equals($expected, $provided)) {
      return new WP_REST_Response(['success' => false, 'message' => 'Invalid card event signature.'], 401);
    }
    if (($payload['event'] ?? '') !== 'transaction.updated') return new WP_REST_Response(['success' => true], 200);
    $transaction = is_array($payload['data']['transaction'] ?? null) ? $payload['data']['transaction'] : [];
    $order = $this->find_order(sanitize_text_field((string) ($transaction['id'] ?? '')));
    if (!$order) return new WP_REST_Response(['success' => true], 200);
    $sync = $this->sync_order($order, $transaction);
    if (is_wp_error($sync)) return new WP_REST_Response(['success' => false, 'message' => $sync->get_error_message()], 409);
    return new WP_REST_Response(['success' => true], 200);
  }
}

add_action('before_woocommerce_init', static function () {
  if (class_exists(Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
    Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
  }
});

new RGV_ORBIT_Card_Checkout();
