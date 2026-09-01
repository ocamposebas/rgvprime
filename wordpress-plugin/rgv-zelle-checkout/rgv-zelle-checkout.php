<?php
/**
 * Plugin Name: RGV Zelle Checkout
 * Description: RGVPRIME custom checkout bridge for WooCommerce/Tagada card cart sync, manual Zelle orders, Zelle receipt upload, and admin payment approval.
 * Version: 1.3.8
 * Author: RGVPRIME LLC
 */

if (!defined('ABSPATH')) {
  exit;
}

final class RGV_Zelle_Checkout {
  const REST_NAMESPACE = 'rgv/v1';
  const REQUEST_LOCK_TTL = 180;
  const REQUEST_RESULT_TTL = 600;
  const RECEIPT_RETENTION_SECONDS = 3 * DAY_IN_SECONDS;
  const RECEIPT_DELETE_HOOK = 'rgv_delete_zelle_receipt';
  const RECEIPT_CLEANUP_HOOK = 'rgv_cleanup_expired_zelle_receipts';
  const RECEIPT_CLEANUP_VERSION = '1';
  const ORDER_RATE_LIMIT_WINDOW = 600;
  const ORDER_RATE_LIMIT_MAX_REQUESTS = 10;
  const STATUS_RATE_LIMIT_MAX_REQUESTS = 30;
  const RECEIPT_RATE_LIMIT_WINDOW = 3600;
  const RECEIPT_RATE_LIMIT_MAX_REQUESTS = 10;
  const MAX_ORDER_ITEMS = 50;
  const MAX_ITEM_QUANTITY = 100;
  const FREE_SHIPPING_MINIMUM = 200.0;
  const ORDER_PROCESSING_FEE_RATE = 0.03;
  const PRIORITY_PROCESSING_FEE_RATE = 0.05;
  const ORDER_PROCESSING_FEE_NAME = 'Service & Processing';
  const PRIORITY_PROCESSING_FEE_NAME = 'Priority Processing (within 3 hours)';
  const SHIPPING_RATES = [
    'ups_2_day_air' => [
      'title' => 'UPS Shipping',
      'cost' => 15.0,
    ],
    'ups_expedited' => [
      'title' => 'UPS Shipping',
      'cost' => 45.0,
      'free_shipping_eligible' => false,
    ],
    'usps_ground_advantage' => [
      'title' => 'USPS Ground',
      'cost' => 8.0,
    ],
    'usps_priority' => [
      'title' => 'USPS Priority Mail',
      'cost' => 12.0,
    ],
  ];

  public function __construct() {
    add_action('rest_api_init', [$this, 'register_routes']);
    add_action('wp_loaded', [$this, 'maybe_sync_checkout_cart'], 20);
    add_action('add_meta_boxes', [$this, 'register_order_meta_box']);
    add_action('admin_post_rgv_approve_zelle_payment', [$this, 'approve_zelle_payment']);
    add_action('admin_notices', [$this, 'admin_notices']);
    add_action('rgv_finalize_zelle_order', [$this, 'finalize_zelle_order_async'], 10, 1);
    add_action('rgv_send_zelle_order_emails', [$this, 'send_zelle_order_emails_async'], 10, 1);
    add_action('rgv_send_zelle_receipt_admin_email', [$this, 'send_zelle_receipt_admin_email_async'], 10, 2);
    add_action('init', [$this, 'ensure_receipt_cleanup_schedule']);
    add_action(self::RECEIPT_DELETE_HOOK, [$this, 'delete_zelle_receipt'], 10, 2);
    add_action(self::RECEIPT_CLEANUP_HOOK, [$this, 'cleanup_expired_zelle_receipts']);

    add_filter('woocommerce_email_enabled_customer_on_hold_order', [$this, 'disable_default_zelle_customer_email'], 10, 2);
    add_filter('woocommerce_email_enabled_customer_processing_order', [$this, 'disable_default_zelle_customer_email'], 10, 2);

    add_filter('rest_pre_serve_request', [$this, 'send_cors_headers'], 10, 4);
  }

  public function register_routes() {
    register_rest_route(self::REST_NAMESPACE, '/manual-zelle-order', [
      'methods' => WP_REST_Server::CREATABLE,
      'callback' => [$this, 'create_manual_zelle_order'],
      'permission_callback' => '__return_true',
    ]);

    register_rest_route(self::REST_NAMESPACE, '/finalize-zelle-order', [
      'methods' => WP_REST_Server::CREATABLE,
      'callback' => [$this, 'finalize_zelle_order_request'],
      'permission_callback' => '__return_true',
    ]);

    register_rest_route(self::REST_NAMESPACE, '/payment-proof', [
      'methods' => WP_REST_Server::CREATABLE,
      'callback' => [$this, 'upload_payment_proof'],
      'permission_callback' => '__return_true',
    ]);

    register_rest_route(self::REST_NAMESPACE, '/payment-proof-status', [
      'methods' => WP_REST_Server::CREATABLE,
      'callback' => [$this, 'get_payment_proof_status'],
      'permission_callback' => '__return_true',
    ]);
  }

  public function send_cors_headers($served, $result, $request, $server) {
    $origin = isset($_SERVER['HTTP_ORIGIN']) ? sanitize_url(wp_unslash($_SERVER['HTTP_ORIGIN'])) : '';

    if ($origin && $this->is_allowed_origin($origin)) {
      header('Access-Control-Allow-Origin: ' . $origin);
      header('Access-Control-Allow-Credentials: true');
      header('Vary: Origin', false);
    }

    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Authorization, Content-Type, X-WP-Nonce, Idempotency-Key');

    return $served;
  }

  private function is_allowed_origin($origin) {
    $host = wp_parse_url($origin, PHP_URL_HOST);

    if (!$host) {
      return false;
    }

    return $host === 'rgvprimellc.com' ||
      $host === 'www.rgvprimellc.com' ||
      $host === 'wp.rgvprimellc.com' ||
      substr($host, -strlen('.rgvprimellc.com')) === '.rgvprimellc.com' ||
      $host === 'localhost' ||
      $host === '127.0.0.1';
  }

  private function get_client_ip() {
    $candidates = [
      $_SERVER['HTTP_CF_CONNECTING_IP'] ?? '',
      $_SERVER['REMOTE_ADDR'] ?? '',
    ];

    foreach ($candidates as $candidate) {
      $ip = trim(sanitize_text_field(wp_unslash((string) $candidate)));

      if ($ip && filter_var($ip, FILTER_VALIDATE_IP)) {
        return $ip;
      }
    }

    return 'unknown';
  }

  private function enforce_rate_limit($namespace, $max_requests, $window) {
    $namespace = sanitize_key((string) $namespace);
    $max_requests = max(1, absint($max_requests));
    $window = max(60, absint($window));
    $key = 'rgv_zelle_rate_' . substr(hash('sha256', $namespace . '|' . $this->get_client_ip()), 0, 32);
    $state = get_transient($key);

    if (!is_array($state)) {
      $state = [
        'count' => 0,
        'started_at' => time(),
      ];
    }

    if ((int) ($state['started_at'] ?? 0) + $window <= time()) {
      $state = [
        'count' => 0,
        'started_at' => time(),
      ];
    }

    if ((int) ($state['count'] ?? 0) >= $max_requests) {
      return new WP_Error(
        'rgv_request_rate_limited',
        'Too many requests. Please wait a few minutes and try again.'
      );
    }

    $state['count'] = (int) ($state['count'] ?? 0) + 1;
    set_transient($key, $state, $window);

    return true;
  }

  public function disable_default_zelle_customer_email($enabled, $order) {
    if (!$order instanceof WC_Order) {
      return $enabled;
    }

    if ($this->is_rgv_zelle_order($order)) {
      return false;
    }

    return $enabled;
  }

  private function is_rgv_zelle_order($order) {
    if (!$order instanceof WC_Order) {
      return false;
    }

    return $order->get_payment_method() === 'zelle' ||
      $order->get_meta('_rgv_manual_zelle_order') === 'yes';
  }

  public function maybe_sync_checkout_cart() {
    if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
      return;
    }

    if (!function_exists('WC') || !WC()->cart) {
      return;
    }

    $should_sync =
      isset($_GET['rgv_cart_sync']) ||
      isset($_GET['phaseone_cart_sync']) ||
      isset($_GET['lab_checkout_payload']) ||
      isset($_GET['rgv_checkout_payload']) ||
      isset($_GET['lab_checkout']) ||
      isset($_GET['rgv_checkout']);

    if (!$should_sync) {
      return;
    }

    $payload = $this->get_checkout_payload_from_request();
    $legacy_items = $this->get_legacy_checkout_items_from_request();

    WC()->cart->empty_cart();

    if (!empty($payload)) {
      foreach ($payload as $item) {
        $this->add_payload_item_to_cart($item);
      }
    } elseif (!empty($legacy_items)) {
      foreach ($legacy_items as $item) {
        WC()->cart->add_to_cart((int) $item['product_id'], (int) $item['quantity']);
      }
    }

    $coupon = $this->get_request_coupon();

    if ($coupon) {
      WC()->cart->apply_coupon($coupon);
    }

    WC()->cart->calculate_totals();

    if (!headers_sent()) {
      $clean_url = remove_query_arg([
        'rgv_cart_sync',
        'phaseone_cart_sync',
        'lab_checkout_payload',
        'rgv_checkout_payload',
        'lab_checkout',
        'rgv_checkout',
        'phaseone_tagada_coupon',
        'rgv_tagada_coupon',
      ]);

      wp_safe_redirect($clean_url);
      exit;
    }
  }

  private function get_checkout_payload_from_request() {
    $raw = '';

    if (!empty($_GET['rgv_checkout_payload'])) {
      $raw = sanitize_text_field(wp_unslash($_GET['rgv_checkout_payload']));
    } elseif (!empty($_GET['lab_checkout_payload'])) {
      $raw = sanitize_text_field(wp_unslash($_GET['lab_checkout_payload']));
    }

    if (!$raw) {
      return [];
    }

    $decoded = base64_decode($raw, true);

    if (!$decoded) {
      return [];
    }

    $items = json_decode($decoded, true);

    return is_array($items) ? $items : [];
  }

  private function get_legacy_checkout_items_from_request() {
    $raw = '';

    if (!empty($_GET['rgv_checkout'])) {
      $raw = sanitize_text_field(wp_unslash($_GET['rgv_checkout']));
    } elseif (!empty($_GET['lab_checkout'])) {
      $raw = sanitize_text_field(wp_unslash($_GET['lab_checkout']));
    }

    if (!$raw) {
      return [];
    }

    $items = [];

    foreach (explode(',', $raw) as $entry) {
      $parts = array_map('trim', explode(':', $entry));
      $product_id = isset($parts[0]) ? absint($parts[0]) : 0;
      $quantity = isset($parts[1]) ? absint($parts[1]) : 1;

      if ($product_id > 0 && $quantity > 0) {
        $items[] = [
          'product_id' => $product_id,
          'quantity' => $quantity,
        ];
      }
    }

    return $items;
  }

  private function add_payload_item_to_cart($item) {
    $product_id = isset($item['product_id']) ? absint($item['product_id']) : 0;
    $variation_id = isset($item['variation_id']) ? absint($item['variation_id']) : 0;
    $quantity = isset($item['quantity']) ? max(1, absint($item['quantity'])) : 1;
    $variation = [];

    if (!empty($item['variation']) && is_array($item['variation'])) {
      $variation = array_map('wc_clean', $item['variation']);
    }

    if ($variation_id > 0) {
      $variation_product = wc_get_product($variation_id);

      if ($variation_product && $variation_product->is_type('variation')) {
        $parent_id = $variation_product->get_parent_id();

        if ($parent_id > 0) {
          WC()->cart->add_to_cart($parent_id, $quantity, $variation_id, $variation);
          return;
        }
      }
    }

    if ($product_id > 0) {
      WC()->cart->add_to_cart($product_id, $quantity);
    }
  }

  private function get_request_coupon() {
    $coupon = '';

    if (!empty($_GET['rgv_tagada_coupon'])) {
      $coupon = sanitize_text_field(wp_unslash($_GET['rgv_tagada_coupon']));
    } elseif (!empty($_GET['phaseone_tagada_coupon'])) {
      $coupon = sanitize_text_field(wp_unslash($_GET['phaseone_tagada_coupon']));
    }

    return $coupon ? strtoupper(preg_replace('/[^A-Z0-9\-_]/i', '', $coupon)) : '';
  }

  private function build_checkout_request_key(WP_REST_Request $request, $data, $items, $billing, $shipping) {
    $provided_key = sanitize_text_field((string) $request->get_header('idempotency-key'));

    if (!$provided_key) {
      foreach (['requestId', 'request_id', 'idempotencyKey', 'idempotency_key'] as $field) {
        if (!empty($data[$field])) {
          $provided_key = sanitize_text_field((string) $data[$field]);
          break;
        }
      }
    }

    if ($provided_key) {
      return hash('sha256', $provided_key);
    }

    $normalized_items = [];

    foreach ($items as $item) {
      $normalized_items[] = [
        'product_id' => absint($item['product_id'] ?? 0),
        'variation_id' => absint($item['variation_id'] ?? 0),
        'quantity' => max(1, absint($item['quantity'] ?? 1)),
      ];
    }

    usort($normalized_items, static function ($left, $right) {
      return strcmp(wp_json_encode($left), wp_json_encode($right));
    });

    $fingerprint = [
      'email' => strtolower(sanitize_email($billing['email'] ?? $shipping['email'] ?? '')),
      'phone' => preg_replace('/\D+/', '', (string) ($billing['phone'] ?? $shipping['phone'] ?? '')),
      'address' => sanitize_text_field((string) ($shipping['address_1'] ?? $billing['address_1'] ?? '')),
      'postcode' => sanitize_text_field((string) ($shipping['postcode'] ?? $billing['postcode'] ?? '')),
      'coupon' => $this->clean_coupon($data['coupon'] ?? $data['couponCode'] ?? ''),
      'priority_processing' => $this->priority_processing_requested($data),
      'items' => $normalized_items,
    ];

    return hash('sha256', wp_json_encode($fingerprint));
  }

  private function get_request_lock_option_name($request_key) {
    return '_rgv_zelle_req_' . substr($request_key, 0, 40);
  }

  private function claim_checkout_request($option_name) {
    $existing = get_option($option_name, null);

    if (is_array($existing) && (int) ($existing['expires_at'] ?? 0) <= time()) {
      delete_option($option_name);
      $existing = null;
    }

    if (is_array($existing)) {
      return [
        'acquired' => false,
        'state' => $existing,
      ];
    }

    $state = [
      'status' => 'processing',
      'order_id' => 0,
      'created_at' => time(),
      'expires_at' => time() + self::REQUEST_LOCK_TTL,
    ];

    if (add_option($option_name, $state, '', 'no')) {
      return [
        'acquired' => true,
        'state' => $state,
      ];
    }

    $existing = get_option($option_name, []);

    return [
      'acquired' => false,
      'state' => is_array($existing) ? $existing : [],
    ];
  }

  private function get_existing_request_order($option_name, $wait_for_processing = false) {
    $attempts = $wait_for_processing ? 10 : 1;

    for ($attempt = 0; $attempt < $attempts; $attempt++) {
      $state = get_option($option_name, []);
      $order_id = absint($state['order_id'] ?? 0);

      if ($order_id) {
        $order = wc_get_order($order_id);

        if ($order) {
          return $order;
        }
      }

      if ($attempt + 1 < $attempts) {
        usleep(200000);
      }
    }

    return null;
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

  private function validate_compliance_acceptance(WP_REST_Request $request, array $data) {
    $secret = $this->compliance_secret();
    $provided = (string) $request->get_header('x-rgv-compliance-secret');

    if ($secret === '' || $provided === '' || !hash_equals($secret, $provided)) {
      return new WP_Error('rgv_compliance_session_required', 'This order must be submitted through the secure storefront checkout.', ['status' => 401]);
    }

    foreach (['ageConfirmed', 'researchUseAcknowledged', 'termsAccepted'] as $field) {
      if (($data[$field] ?? null) !== true) {
        return new WP_Error('rgv_compliance_required', 'The 21+, Research Use Only, and Terms confirmations are required.', ['status' => 400]);
      }
    }

    $acceptance = isset($data['complianceAcceptance']) && is_array($data['complianceAcceptance'])
      ? $data['complianceAcceptance']
      : [];
    $email = sanitize_email($acceptance['userEmail'] ?? $acceptance['email'] ?? '');
    $initial_at = sanitize_text_field((string) ($acceptance['acceptedAt'] ?? ''));
    $final_at = sanitize_text_field((string) ($acceptance['finalAcceptedAt'] ?? ''));
    $policy_version = sanitize_text_field((string) ($acceptance['policyVersion'] ?? ''));
    $text_version = sanitize_text_field((string) ($acceptance['textVersion'] ?? ''));

    if (
      $policy_version !== 'rgv-ruo-terms-2026-08-31-v1' ||
      $text_version !== 'checkout-certification-2026-08-31-v1' ||
      !$email || !is_email($email) ||
      !$initial_at || !strtotime($initial_at) ||
      !$final_at || !strtotime($final_at) ||
      abs(time() - strtotime($final_at)) > 600
    ) {
      return new WP_Error('rgv_compliance_evidence_invalid', 'Compliance acceptance evidence is invalid or expired.', ['status' => 400]);
    }

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

  private function store_compliance_evidence(WC_Order $order, array $acceptance) {
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

  private function flag_possible_misuse(WC_Order $order, array $items, array $billing, array $shipping, array $acceptance) {
    $signals = [];
    $total_quantity = 0;

    foreach ($items as $item) {
      $quantity = max(0, absint($item['quantity'] ?? 0));
      $total_quantity += $quantity;
      if ($quantity >= 5) $signals[] = 'five_or_more_of_one_item';
    }

    if ($total_quantity >= 10) $signals[] = 'high_total_unit_count';
    if (strtolower(sanitize_email($billing['email'] ?? '')) !== strtolower($acceptance['user_email'])) {
      $signals[] = 'account_and_billing_email_mismatch';
    }
    if (
      !empty($billing['postcode']) && !empty($shipping['postcode']) &&
      sanitize_text_field($billing['postcode']) !== sanitize_text_field($shipping['postcode'])
    ) $signals[] = 'billing_and_shipping_zip_mismatch';

    $signals = array_values(array_unique($signals));
    if (!$signals) return;

    $order->update_meta_data('_rgv_manual_misuse_review_required', 'yes');
    $order->update_meta_data('_rgv_manual_misuse_review_signals', implode(',', $signals));
    $order->add_order_note('Manual misuse review required before fulfillment. Signals: ' . implode(', ', $signals) . '. Cancel the order if the review cannot establish qualified research use.');
    $order->set_status('on-hold');
  }

  private function complete_checkout_request($option_name, $order_id) {
    update_option($option_name, [
      'status' => 'completed',
      'order_id' => absint($order_id),
      'created_at' => time(),
      'expires_at' => time() + self::REQUEST_RESULT_TTL,
    ], false);
  }

  private function enqueue_async_action($hook, $args) {
    if (function_exists('as_enqueue_async_action')) {
      as_enqueue_async_action($hook, array_values($args), 'rgv-zelle-checkout');
      return true;
    }

    if (!wp_next_scheduled($hook, array_values($args))) {
      return (bool) wp_schedule_single_event(time() + 1, $hook, array_values($args));
    }

    return true;
  }

  public function create_manual_zelle_order(WP_REST_Request $request) {
    if (!class_exists('WooCommerce') || !function_exists('wc_create_order')) {
      return new WP_REST_Response([
        'success' => false,
        'message' => 'WooCommerce is not available.',
      ], 500);
    }

    $content_type = strtolower((string) $request->get_header('content-type'));

    if (strpos($content_type, 'application/json') === false) {
      return new WP_REST_Response([
        'success' => false,
        'message' => 'Invalid checkout request format.',
      ], 415);
    }

    $rate_limit = $this->enforce_rate_limit(
      'create_order',
      self::ORDER_RATE_LIMIT_MAX_REQUESTS,
      self::ORDER_RATE_LIMIT_WINDOW
    );

    if (is_wp_error($rate_limit)) {
      return new WP_REST_Response([
        'success' => false,
        'message' => $rate_limit->get_error_message(),
      ], 429);
    }

    $data = $request->get_json_params();

    if (!is_array($data)) {
      $data = [];
    }

    $compliance = $this->validate_compliance_acceptance($request, $data);
    if (is_wp_error($compliance)) {
      return new WP_REST_Response([
        'success' => false,
        'message' => $compliance->get_error_message(),
      ], (int) ($compliance->get_error_data()['status'] ?? 400));
    }

    $items = isset($data['items']) && is_array($data['items']) ? $data['items'] : [];
    $billing = isset($data['billing']) && is_array($data['billing']) ? $data['billing'] : [];
    $shipping = isset($data['shipping']) && is_array($data['shipping']) ? $data['shipping'] : $billing;

    $validation = $this->validate_manual_order_payload($items, $billing, $shipping);

    if (is_wp_error($validation)) {
      return new WP_REST_Response([
        'success' => false,
        'message' => $validation->get_error_message(),
      ], 400);
    }

    $request_key = $this->build_checkout_request_key($request, $data, $items, $billing, $shipping);
    $request_option_name = $this->get_request_lock_option_name($request_key);
    $request_claim = $this->claim_checkout_request($request_option_name);
    $owns_request_lock = !empty($request_claim['acquired']);

    if (!$owns_request_lock) {
      $existing_order = $this->get_existing_request_order($request_option_name, true);

      if ($existing_order) {
        return new WP_REST_Response([
          'success' => true,
          'duplicate_prevented' => true,
          'message' => 'This order was already created.',
          'order' => $this->format_order_response($existing_order),
        ], 200);
      }

      return new WP_REST_Response([
        'success' => false,
        'processing' => true,
        'message' => 'Your order is already being processed. Please do not press Pay again.',
      ], 409);
    }

    try {
      $order = wc_create_order();

      $clean_billing = $this->clean_address($billing);
      $clean_shipping = $this->clean_address($shipping);

      $order->set_address($clean_billing, 'billing');
      $order->set_address($clean_shipping, 'shipping');
      $order->set_payment_method('zelle');
      $order->set_payment_method_title('Zelle');
      $order->set_created_via('rgv_custom_checkout');
      $order->update_meta_data('_rgv_manual_zelle_order', 'yes');
      $order->update_meta_data('_rgv_payment_source', 'rgv_custom_checkout_zelle');
      $order->update_meta_data('_rgv_policy_acknowledged_at', sanitize_text_field($data['policyAcknowledgedAt'] ?? current_time('mysql')));
      $order->update_meta_data('_rgv_checkout_request_key', $request_key);
      $this->store_compliance_evidence($order, $compliance);

      $subtotal = 0;

      foreach ($items as $item) {
        $line_total = $this->add_order_item($order, $item);
        $subtotal += $line_total;
      }

      if ($subtotal <= 0) {
        throw new Exception('No valid order items were added.');
      }

      $coupon = $this->clean_coupon($data['coupon'] ?? $data['couponCode'] ?? '');

      if ($coupon) {
        try {
          $order->apply_coupon($coupon);
          $order->add_order_note(sprintf('Coupon %s was submitted from RGV checkout.', $coupon));
        } catch (Exception $coupon_error) {
          $order->add_order_note(sprintf('Coupon %s could not be applied: %s', $coupon, $coupon_error->getMessage()));
        }
      }

      $free_shipping_minimum = max(0, (float) apply_filters(
        'rgv_zelle_free_shipping_minimum',
        self::FREE_SHIPPING_MINIMUM
      ));
      $shipping_method = $this->get_shipping_method_details(
        $data,
        $subtotal >= $free_shipping_minimum
      );
      $shipping_total = (float) $shipping_method['cost'];

      $shipping_item = new WC_Order_Item_Shipping();
      $shipping_item->set_method_title($shipping_method['title']);
      $shipping_item->set_method_id($shipping_method['id']);
      $shipping_item->set_total($shipping_total);
      $order->add_item($shipping_item);

      $order->calculate_totals();
      $this->add_processing_fees($order, $data);
      $this->flag_possible_misuse($order, $items, $billing, $shipping, $compliance);
      $order->save();

      $payment_reference = 'RGV-' . preg_replace('/[^0-9]/', '', (string) $order->get_order_number());
      $order->update_meta_data('_rgv_compliance_order_id', $order->get_id());
      $order->update_meta_data('_rgv_zelle_payment_reference', $payment_reference);
      $order->update_meta_data('_rgv_background_finalization_pending', 'yes');
      $order->save();

      $this->complete_checkout_request($request_option_name, $order->get_id());

      $response_order = $this->format_order_response($order);
      $response_order['status'] = 'on-hold';

      $this->dispatch_order_finalization($order);

      return new WP_REST_Response([
        'success' => true,
        'duplicate_prevented' => false,
        'order' => $response_order,
      ], 200);
    } catch (Exception $error) {
      if ($owns_request_lock) {
        delete_option($request_option_name);
      }

      return new WP_REST_Response([
        'success' => false,
        'message' => $error->getMessage(),
      ], 500);
    }
  }

  private function get_finalize_lock_option_name($order_id) {
    return '_rgv_zelle_finalize_' . absint($order_id);
  }

  private function claim_finalize_lock($order_id) {
    $option_name = $this->get_finalize_lock_option_name($order_id);
    $expires_at = (int) get_option($option_name, 0);

    if ($expires_at > 0 && $expires_at <= time()) {
      delete_option($option_name);
    }

    return add_option($option_name, time() + 180, '', 'no');
  }

  private function release_finalize_lock($order_id) {
    delete_option($this->get_finalize_lock_option_name($order_id));
  }

  private function build_finalize_token(WC_Order $order) {
    return hash_hmac(
      'sha256',
      $order->get_id() . '|' . $order->get_order_key(),
      wp_salt('auth')
    );
  }

  private function dispatch_order_finalization(WC_Order $order) {
    $order_id = $order->get_id();

    // Keep Action Scheduler as a reliable fallback in case the loopback request is blocked.
    $this->enqueue_async_action('rgv_finalize_zelle_order', [$order_id]);

    $payload = wp_json_encode([
      'order_id' => $order_id,
      'token' => $this->build_finalize_token($order),
    ]);

    wp_remote_post(rest_url(self::REST_NAMESPACE . '/finalize-zelle-order'), [
      'timeout' => 1,
      'blocking' => false,
      'redirection' => 0,
      'sslverify' => apply_filters('https_local_ssl_verify', false),
      'headers' => [
        'Content-Type' => 'application/json',
        'Accept' => 'application/json',
      ],
      'body' => $payload,
      'data_format' => 'body',
    ]);
  }

  public function finalize_zelle_order_request(WP_REST_Request $request) {
    $data = $request->get_json_params();

    if (!is_array($data)) {
      $data = [];
    }

    $order_id = absint($data['order_id'] ?? 0);
    $token = sanitize_text_field((string) ($data['token'] ?? ''));
    $order = $order_id ? wc_get_order($order_id) : false;

    if (!$order || !$this->is_rgv_zelle_order($order)) {
      return new WP_REST_Response([
        'success' => false,
        'message' => 'Order not found.',
      ], 404);
    }

    $expected_token = $this->build_finalize_token($order);

    if (!$token || !hash_equals($expected_token, $token)) {
      return new WP_REST_Response([
        'success' => false,
        'message' => 'Invalid background request.',
      ], 403);
    }

    $this->finalize_zelle_order_async($order_id);

    return new WP_REST_Response([
      'success' => true,
    ], 200);
  }

  public function finalize_zelle_order_async($order_id) {
    $order_id = absint($order_id);

    if (!$order_id || !$this->claim_finalize_lock($order_id)) {
      return;
    }

    try {
      $order = wc_get_order($order_id);

      if (!$order || !$this->is_rgv_zelle_order($order)) {
        return;
      }

      if ($order->has_status(['pending', 'failed'])) {
        $order->update_status(
          'on-hold',
          'RGV Zelle order created. Awaiting manual payment verification.'
        );
      }

      $this->send_zelle_order_emails_async($order_id);

      $order = wc_get_order($order_id);

      if ($order) {
        $order->delete_meta_data('_rgv_background_finalization_pending');
        $order->update_meta_data('_rgv_background_finalized_at', current_time('mysql'));
        $order->save();
      }
    } finally {
      $this->release_finalize_lock($order_id);
    }
  }

  private function validate_manual_order_payload($items, $billing, $shipping) {
    if (empty($items)) {
      return new WP_Error('rgv_empty_items', 'No valid cart items were received.');
    }

    if (count($items) > self::MAX_ORDER_ITEMS) {
      return new WP_Error('rgv_too_many_items', 'Too many cart items were received.');
    }

    $required = [
      'first_name' => 'First name',
      'last_name' => 'Last name',
      'email' => 'Email',
      'phone' => 'Phone',
      'address_1' => 'Address',
      'city' => 'City',
      'state' => 'State',
      'postcode' => 'ZIP',
      'country' => 'Country',
    ];

    foreach ($required as $key => $label) {
      if (empty($shipping[$key]) && empty($billing[$key])) {
        return new WP_Error('rgv_missing_field', $label . ' is required.');
      }
    }

    $email = sanitize_email($billing['email'] ?? $shipping['email'] ?? '');

    if (!$email || !is_email($email)) {
      return new WP_Error('rgv_invalid_email', 'A valid email is required.');
    }

    foreach ($items as $item) {
      if (!is_array($item)) {
        return new WP_Error('rgv_invalid_item', 'A cart item is invalid.');
      }

      $quantity = absint($item['quantity'] ?? 0);

      if ($quantity < 1 || $quantity > self::MAX_ITEM_QUANTITY) {
        return new WP_Error('rgv_invalid_quantity', 'A cart item has an invalid quantity.');
      }

      $stock_validation = $this->validate_order_item_stock($item);

      if (is_wp_error($stock_validation)) {
        return $stock_validation;
      }
    }

    return true;
  }

  private function get_order_item_product($item) {
    $product_id = isset($item['product_id']) ? absint($item['product_id']) : 0;
    $variation_id = isset($item['variation_id']) ? absint($item['variation_id']) : 0;

    if ($variation_id > 0) {
      $variation = wc_get_product($variation_id);

      if (
        $variation instanceof WC_Product &&
        $variation->is_type('variation') &&
        (!$product_id || (int) $variation->get_parent_id() === $product_id)
      ) {
        return $variation;
      }

      return null;
    }

    return $product_id > 0 ? wc_get_product($product_id) : null;
  }

  private function validate_order_item_stock($item) {
    $product = $this->get_order_item_product($item);
    $quantity = isset($item['quantity']) ? max(1, absint($item['quantity'])) : 1;

    if (!$product instanceof WC_Product || !$product->exists()) {
      return new WP_Error(
        'rgv_product_not_found',
        'A product in the cart could not be found.'
      );
    }

    $product_name = wp_strip_all_tags($product->get_name());

    if (!$product->is_purchasable()) {
      return new WP_Error(
        'rgv_product_unavailable',
        sprintf('%s is no longer available for purchase.', $product_name)
      );
    }

    if (!$product->is_in_stock() && !$product->backorders_allowed()) {
      return new WP_Error(
        'rgv_product_sold_out',
        sprintf('%s is sold out. Remove it from your cart before continuing.', $product_name)
      );
    }

    if (!$product->backorders_allowed() && !$product->has_enough_stock($quantity)) {
      $remaining_stock = max(0, (int) $product->get_stock_quantity());

      return new WP_Error(
        'rgv_insufficient_stock',
        sprintf(
          'Only %d unit(s) of %s are available. Update your cart before continuing.',
          $remaining_stock,
          $product_name
        )
      );
    }

    return true;
  }

  private function clean_address($address) {
    return [
      'first_name' => sanitize_text_field($address['first_name'] ?? ''),
      'last_name'  => sanitize_text_field($address['last_name'] ?? ''),
      'company'    => sanitize_text_field($address['company'] ?? ''),
      'email'      => sanitize_email($address['email'] ?? ''),
      'phone'      => sanitize_text_field($address['phone'] ?? ''),
      'address_1'  => sanitize_text_field($address['address_1'] ?? ''),
      'address_2'  => sanitize_text_field($address['address_2'] ?? ''),
      'city'       => sanitize_text_field($address['city'] ?? ''),
      'state'      => sanitize_text_field($address['state'] ?? ''),
      'postcode'   => sanitize_text_field($address['postcode'] ?? ''),
      'country'    => sanitize_text_field($address['country'] ?? 'US'),
    ];
  }

  private function clean_coupon($coupon) {
    $coupon = strtoupper(sanitize_text_field((string) $coupon));
    return preg_replace('/[^A-Z0-9\-_]/', '', $coupon);
  }

  private function add_processing_fees(WC_Order $order, $data) {
    $fee_base = max(0.0, (float) $order->get_total());

    if ($fee_base <= 0) {
      return;
    }

    $standard_rate = max(0.0, (float) apply_filters(
      'rgv_zelle_order_processing_fee_rate',
      self::ORDER_PROCESSING_FEE_RATE
    ));
    $priority_rate = max(0.0, (float) apply_filters(
      'rgv_zelle_priority_processing_fee_rate',
      self::PRIORITY_PROCESSING_FEE_RATE
    ));
    $priority_requested = $this->priority_processing_requested($data);

    $this->add_processing_fee_item($order, self::ORDER_PROCESSING_FEE_NAME, $fee_base * $standard_rate);

    if ($priority_requested) {
      $this->add_processing_fee_item($order, self::PRIORITY_PROCESSING_FEE_NAME, $fee_base * $priority_rate);
      $order->add_order_note('Priority processing requested: order should enter processing within 3 hours.');
    }

    $order->update_meta_data('_rgv_priority_processing', $priority_requested ? 'yes' : 'no');
    $order->calculate_totals();
  }

  private function add_processing_fee_item(WC_Order $order, $name, $amount) {
    $amount = (float) wc_format_decimal($amount, wc_get_price_decimals());

    if ($amount <= 0) {
      return;
    }

    $fee = new WC_Order_Item_Fee();
    $fee->set_name($name);
    $fee->set_amount($amount);
    $fee->set_total($amount);
    $fee->set_tax_status('none');
    $order->add_item($fee);
  }

  private function priority_processing_requested($data) {
    $value = $data['priorityProcessing'] ?? $data['priority_processing'] ?? false;
    return (bool) filter_var($value, FILTER_VALIDATE_BOOLEAN);
  }

  private function get_shipping_method_details($data, $is_free_shipping) {
    $shipping_methods = apply_filters('rgv_zelle_shipping_rates', self::SHIPPING_RATES);

    if (!is_array($shipping_methods)) {
      $shipping_methods = self::SHIPPING_RATES;
    }

    $method_value = $data['shippingMethod']
      ?? $data['shipping_method']
      ?? $data['shippingMethodId']
      ?? $data['shipping_method_id']
      ?? '';

    if (is_array($method_value)) {
      $method_value = $method_value['id'] ?? $method_value['method_id'] ?? '';
    }

    $method_id = sanitize_key((string) $method_value);

    if (isset($shipping_methods[$method_id]) && is_array($shipping_methods[$method_id])) {
      $shipping_method = $shipping_methods[$method_id];

      if ($is_free_shipping && false !== ($shipping_method['free_shipping_eligible'] ?? true)) {
        return [
          'id' => 'free_shipping',
          'title' => "Free Shipping (Order's Over $200)",
          'cost' => 0.0,
        ];
      }

      return [
        'id' => $method_id,
        'title' => sanitize_text_field((string) ($shipping_method['title'] ?? 'Shipping')),
        'cost' => max(0, (float) ($shipping_method['cost'] ?? 0)),
      ];
    }

    $fallback = isset($shipping_methods['usps_ground_advantage']) && is_array($shipping_methods['usps_ground_advantage'])
      ? $shipping_methods['usps_ground_advantage']
      : self::SHIPPING_RATES['usps_ground_advantage'];

    if ($is_free_shipping && false !== ($fallback['free_shipping_eligible'] ?? true)) {
      return [
        'id' => 'free_shipping',
        'title' => "Free Shipping (Order's Over $200)",
        'cost' => 0.0,
      ];
    }

    return [
      'id' => 'usps_ground_advantage',
      'title' => sanitize_text_field((string) ($fallback['title'] ?? 'USPS Ground')),
      'cost' => max(0, (float) ($fallback['cost'] ?? 8)),
    ];
  }

  private function add_order_item(WC_Order $order, $item) {
    $quantity = isset($item['quantity']) ? max(1, absint($item['quantity'])) : 1;

    $stock_validation = $this->validate_order_item_stock($item);

    if (is_wp_error($stock_validation)) {
      throw new Exception($stock_validation->get_error_message());
    }

    $product = $this->get_order_item_product($item);
    $line_total = (float) wc_format_decimal((float) $product->get_price() * $quantity);

    $order->add_product($product, $quantity, [
      'subtotal' => $line_total,
      'total' => $line_total,
    ]);

    return $line_total;
  }

  public function get_payment_proof_status(WP_REST_Request $request) {
    if (!headers_sent()) {
      nocache_headers();
    }

    if (!class_exists('WooCommerce')) {
      return new WP_REST_Response([
        'success' => false,
        'message' => 'WooCommerce is not available.',
      ], 500);
    }

    $rate_limit = $this->enforce_rate_limit(
      'payment_status',
      self::STATUS_RATE_LIMIT_MAX_REQUESTS,
      self::ORDER_RATE_LIMIT_WINDOW
    );

    if (is_wp_error($rate_limit)) {
      return new WP_REST_Response([
        'success' => false,
        'message' => $rate_limit->get_error_message(),
      ], 429);
    }

    $data = $request->get_json_params();

    if (!is_array($data)) {
      $data = [];
    }

    $order_id = absint($data['order_id'] ?? $request->get_param('order_id'));
    $order_key = sanitize_text_field($data['order_key'] ?? $request->get_param('order_key') ?? '');
    $customer_email = sanitize_email($data['customer_email'] ?? $request->get_param('customer_email') ?? '');

    if (!$order_id) {
      return new WP_REST_Response([
        'success' => false,
        'message' => 'Order ID is required.',
      ], 400);
    }

    $order = wc_get_order($order_id);

    if ($order && method_exists($order, 'read_meta_data')) {
      $order->read_meta_data(true);
    }

    if (!$order) {
      return new WP_REST_Response([
        'success' => false,
        'message' => 'Order not found.',
      ], 404);
    }

    $authorization = $this->authorize_customer_order_request($order, $order_key, $customer_email);

    if (is_wp_error($authorization)) {
      return new WP_REST_Response([
        'success' => false,
        'message' => $authorization->get_error_message(),
      ], 403);
    }

    if (!$this->is_rgv_zelle_order($order)) {
      return new WP_REST_Response([
        'success' => true,
        'is_zelle' => false,
        'order_id' => $order->get_id(),
        'order_number' => $order->get_order_number(),
      ], 200);
    }

    return new WP_REST_Response(array_merge([
      'success' => true,
      'is_zelle' => true,
      'order_id' => $order->get_id(),
      'order_number' => $order->get_order_number(),
      'payment_reference' => $this->get_zelle_payment_reference($order),
      'total' => (float) $order->get_total(),
      'currency' => $order->get_currency(),
      'order_status' => $order->get_status(),
    ], $this->get_receipt_response_data($order)), 200);
  }

  private function authorize_customer_order_request(WC_Order $order, $order_key, $customer_email) {
    $order_key = sanitize_text_field((string) $order_key);
    $customer_email = sanitize_email((string) $customer_email);

    if (!$order_key && !$customer_email) {
      return new WP_Error(
        'rgv_missing_order_verification',
        'Order verification is required.'
      );
    }

    if ($order_key && !hash_equals((string) $order->get_order_key(), (string) $order_key)) {
      return new WP_Error('rgv_invalid_order_key', 'Invalid order key.');
    }

    if ($customer_email && strtolower($order->get_billing_email()) !== strtolower($customer_email)) {
      return new WP_Error('rgv_email_mismatch', 'Email does not match this order.');
    }

    return true;
  }

  private function get_zelle_payment_reference(WC_Order $order) {
    $reference = $order->get_meta('_rgv_zelle_payment_reference');

    if (!$reference) {
      $reference = 'RGV-' . preg_replace('/[^0-9]/', '', (string) $order->get_order_number());
    }

    return $reference;
  }

  private function get_receipt_response_data(WC_Order $order) {
    $receipt_url = esc_url_raw((string) $order->get_meta('_rgv_zelle_receipt_url'));
    $receipt_status = sanitize_key((string) $order->get_meta('_rgv_zelle_receipt_status'));
    $receipt_uploaded_at = sanitize_text_field((string) $order->get_meta('_rgv_zelle_receipt_uploaded_at'));
    $receipt_deleted_at = sanitize_text_field((string) $order->get_meta('_rgv_zelle_receipt_deleted_at'));
    $receipt_uploaded = $order->get_meta('_rgv_zelle_receipt_uploaded') === 'yes' || !empty($receipt_url);

    if (!$receipt_status) {
      $receipt_status = $receipt_uploaded ? 'pending_review' : 'not_uploaded';
    }

    $receipt_approved = $receipt_status === 'approved' || in_array(
      $order->get_status(),
      ['processing', 'completed'],
      true
    );

    return [
      'receipt_uploaded' => $receipt_uploaded,
      'receipt_status' => $receipt_approved ? 'approved' : $receipt_status,
      'receipt_url' => $receipt_url,
      'receipt_uploaded_at' => $receipt_uploaded_at,
      'receipt_deleted_at' => $receipt_deleted_at,
      'can_upload' => !$receipt_uploaded && !$receipt_approved,
    ];
  }

  public function upload_payment_proof(WP_REST_Request $request) {
    if (!headers_sent()) {
      nocache_headers();
    }

    if (!class_exists('WooCommerce')) {
      return new WP_REST_Response([
        'success' => false,
        'message' => 'WooCommerce is not available.',
      ], 500);
    }

    $rate_limit = $this->enforce_rate_limit(
      'payment_upload',
      self::RECEIPT_RATE_LIMIT_MAX_REQUESTS,
      self::RECEIPT_RATE_LIMIT_WINDOW
    );

    if (is_wp_error($rate_limit)) {
      return new WP_REST_Response([
        'success' => false,
        'message' => $rate_limit->get_error_message(),
      ], 429);
    }

    $order_id = absint($request->get_param('order_id'));
    $order_key = sanitize_text_field($request->get_param('order_key') ?? '');
    $customer_email = sanitize_email($request->get_param('customer_email') ?? '');

    if (!$order_id) {
      return new WP_REST_Response([
        'success' => false,
        'message' => 'Order ID is required.',
      ], 400);
    }

    $order = wc_get_order($order_id);

    if (!$order) {
      return new WP_REST_Response([
        'success' => false,
        'message' => 'Order not found.',
      ], 404);
    }

    if (!$this->is_rgv_zelle_order($order)) {
      return new WP_REST_Response([
        'success' => false,
        'message' => 'This order is not a Zelle order.',
      ], 400);
    }

    $authorization = $this->authorize_customer_order_request($order, $order_key, $customer_email);

    if (is_wp_error($authorization)) {
      return new WP_REST_Response([
        'success' => false,
        'message' => $authorization->get_error_message(),
      ], 403);
    }

    if (empty($_FILES['receipt'])) {
      return new WP_REST_Response([
        'success' => false,
        'message' => 'Receipt file is required.',
      ], 400);
    }

    $file = $_FILES['receipt'];

    if (!empty($file['error'])) {
      return new WP_REST_Response([
        'success' => false,
        'message' => 'File upload failed.',
      ], 400);
    }

    if (!empty($file['size']) && (int) $file['size'] > 10 * 1024 * 1024) {
      return new WP_REST_Response([
        'success' => false,
        'message' => 'The receipt must be under 10MB.',
      ], 400);
    }

    $allowed = [
      'jpg|jpeg' => 'image/jpeg',
      'png' => 'image/png',
      'webp' => 'image/webp',
      'pdf' => 'application/pdf',
    ];

    require_once ABSPATH . 'wp-admin/includes/file.php';

    $upload = wp_handle_upload($file, [
      'test_form' => false,
      'mimes' => $allowed,
    ]);

    if (isset($upload['error'])) {
      return new WP_REST_Response([
        'success' => false,
        'message' => $upload['error'],
      ], 400);
    }

    $attachment_id = $this->create_attachment_from_upload($upload, $order_id);
    $receipt_url = esc_url_raw($upload['url']);
    $delete_at = time() + self::RECEIPT_RETENTION_SECONDS;

    $order->update_meta_data('_rgv_zelle_receipt_uploaded', 'yes');
    $order->update_meta_data('_rgv_zelle_receipt_url', $receipt_url);
    $order->update_meta_data('_rgv_zelle_receipt_attachment_id', $attachment_id);
    $order->update_meta_data('_rgv_zelle_receipt_file', wp_normalize_path($upload['file']));
    $order->update_meta_data('_rgv_zelle_receipt_uploaded_at', current_time('mysql'));
    $order->update_meta_data('_rgv_zelle_receipt_expires_at', $delete_at);
    $order->update_meta_data('_rgv_zelle_receipt_status', 'pending_review');
    $order->delete_meta_data('_rgv_zelle_receipt_deleted_at');
    $order->add_order_note('Customer uploaded Zelle payment receipt: ' . $receipt_url);
    $order->save();

    $this->schedule_receipt_deletion($order_id, $attachment_id, $delete_at);

    if (function_exists('wc_delete_shop_order_transients')) {
      wc_delete_shop_order_transients($order_id);
    }

    clean_post_cache($order_id);

    if (method_exists($order, 'read_meta_data')) {
      $order->read_meta_data(true);
    }

    $this->enqueue_async_action('rgv_send_zelle_receipt_admin_email', [$order_id, $receipt_url]);

    return new WP_REST_Response(array_merge([
      'success' => true,
      'message' => 'Receipt uploaded successfully.',
      'attachment_id' => $attachment_id,
    ], $this->get_receipt_response_data($order)), 200);
  }

  private function create_attachment_from_upload($upload, $order_id) {
    $attachment = [
      'post_mime_type' => $upload['type'],
      'post_title' => sanitize_file_name(basename($upload['file'])),
      'post_content' => '',
      'post_status' => 'inherit',
    ];

    $attachment_id = wp_insert_attachment($attachment, $upload['file']);

    if (!is_wp_error($attachment_id)) {
      require_once ABSPATH . 'wp-admin/includes/image.php';
      $metadata = wp_generate_attachment_metadata($attachment_id, $upload['file']);
      wp_update_attachment_metadata($attachment_id, $metadata);
      update_post_meta($attachment_id, '_rgv_zelle_order_id', $order_id);
      return $attachment_id;
    }

    return 0;
  }

  private function schedule_receipt_deletion($order_id, $attachment_id, $delete_at) {
    $args = [absint($order_id), absint($attachment_id)];
    $delete_at = max(time() + 60, absint($delete_at));

    if (function_exists('as_schedule_single_action')) {
      $action_id = as_schedule_single_action(
        $delete_at,
        self::RECEIPT_DELETE_HOOK,
        $args,
        'rgv-zelle-checkout',
        true
      );

      if ($action_id) {
        return;
      }
    }

    if (!wp_next_scheduled(self::RECEIPT_DELETE_HOOK, $args)) {
      wp_schedule_single_event($delete_at, self::RECEIPT_DELETE_HOOK, $args);
    }
  }

  public function ensure_receipt_cleanup_schedule() {
    if (!wp_next_scheduled(self::RECEIPT_CLEANUP_HOOK)) {
      wp_schedule_event(time() + 300, 'daily', self::RECEIPT_CLEANUP_HOOK);
    }

    // Run once immediately after this version is installed so receipts that
    // were uploaded by older plugin versions are also removed when expired.
    if (get_option('rgv_zelle_receipt_cleanup_version') !== self::RECEIPT_CLEANUP_VERSION) {
      update_option('rgv_zelle_receipt_cleanup_version', self::RECEIPT_CLEANUP_VERSION, false);

      if (function_exists('as_enqueue_async_action')) {
        as_enqueue_async_action(
          self::RECEIPT_CLEANUP_HOOK,
          [],
          'rgv-zelle-checkout',
          true
        );
      } else {
        wp_schedule_single_event(time() + 60, self::RECEIPT_CLEANUP_HOOK);
      }
    }
  }

  public function cleanup_expired_zelle_receipts() {
    if (get_transient('rgv_zelle_receipt_cleanup_lock')) {
      return;
    }

    set_transient('rgv_zelle_receipt_cleanup_lock', '1', 10 * MINUTE_IN_SECONDS);
    $cutoff = gmdate('Y-m-d H:i:s', time() - self::RECEIPT_RETENTION_SECONDS);

    // Process several bounded batches so large existing libraries are cleaned
    // without turning one cron request into an unbounded operation.
    for ($batch = 0; $batch < 5; $batch++) {
      $attachment_ids = get_posts([
        'post_type' => 'attachment',
        'post_status' => 'inherit',
        'posts_per_page' => 200,
        'fields' => 'ids',
        'orderby' => 'ID',
        'order' => 'ASC',
        'no_found_rows' => true,
        'meta_query' => [[
          'key' => '_rgv_zelle_order_id',
          'compare' => 'EXISTS',
        ]],
        'date_query' => [[
          'column' => 'post_date_gmt',
          'before' => $cutoff,
          'inclusive' => true,
        ]],
      ]);

      if (!$attachment_ids) {
        break;
      }

      foreach ($attachment_ids as $attachment_id) {
        $order_id = absint(get_post_meta($attachment_id, '_rgv_zelle_order_id', true));
        $this->delete_zelle_receipt($order_id, $attachment_id);
      }

      if (count($attachment_ids) < 200) {
        break;
      }
    }

    delete_transient('rgv_zelle_receipt_cleanup_lock');
  }

  public function delete_zelle_receipt($order_id, $attachment_id = 0) {
    $order_id = absint($order_id);
    $attachment_id = absint($attachment_id);
    $order = $order_id && function_exists('wc_get_order') ? wc_get_order($order_id) : false;
    $current_attachment_id = $order ? absint($order->get_meta('_rgv_zelle_receipt_attachment_id')) : 0;
    $current_url = $order ? (string) $order->get_meta('_rgv_zelle_receipt_url') : '';
    $current_file = $order ? (string) $order->get_meta('_rgv_zelle_receipt_file') : '';
    $attachment_url = $attachment_id ? (string) wp_get_attachment_url($attachment_id) : '';

    $is_current_receipt = $order && (
      ($attachment_id && $current_attachment_id === $attachment_id) ||
      (!$current_attachment_id && $current_url && $attachment_url && $current_url === $attachment_url) ||
      (!$attachment_id && !$current_attachment_id && !empty($current_file))
    );

    if ($attachment_id && get_post_type($attachment_id) === 'attachment') {
      $attachment_order_id = absint(get_post_meta($attachment_id, '_rgv_zelle_order_id', true));

      if ($attachment_order_id === $order_id || $is_current_receipt) {
        wp_delete_attachment($attachment_id, true);
      }
    }

    // This is a fallback for the rare case where WordPress accepted the upload
    // but failed while creating its Media Library attachment.
    if ($is_current_receipt && $current_file && is_file($current_file)) {
      $this->delete_receipt_file_path($current_file);
    }

    if (!$is_current_receipt) {
      return;
    }

    $receipt_status = (string) $order->get_meta('_rgv_zelle_receipt_status');
    $is_approved = $receipt_status === 'approved' || in_array(
      $order->get_status(),
      ['processing', 'completed'],
      true
    );

    $order->delete_meta_data('_rgv_zelle_receipt_url');
    $order->delete_meta_data('_rgv_zelle_receipt_attachment_id');
    $order->delete_meta_data('_rgv_zelle_receipt_file');
    $order->delete_meta_data('_rgv_zelle_receipt_expires_at');
    $order->update_meta_data('_rgv_zelle_receipt_deleted_at', current_time('mysql'));

    if (!$is_approved) {
      $order->update_meta_data('_rgv_zelle_receipt_status', 'expired_deleted');
    }

    $order->add_order_note('Zelle receipt file deleted automatically after the 3-day retention period.');
    $order->save();
  }

  private function delete_receipt_file_path($file_path) {
    $uploads = wp_get_upload_dir();
    $uploads_base = !empty($uploads['basedir']) ? realpath($uploads['basedir']) : false;
    $resolved_file = realpath($file_path);

    if (!$uploads_base || !$resolved_file) {
      return false;
    }

    $uploads_base = trailingslashit(wp_normalize_path($uploads_base));
    $resolved_file = wp_normalize_path($resolved_file);

    if (strpos($resolved_file, $uploads_base) !== 0 || !is_file($resolved_file)) {
      return false;
    }

    wp_delete_file($resolved_file);
    return !file_exists($resolved_file);
  }

  private function format_order_response(WC_Order $order) {
    $payment_reference = $this->get_zelle_payment_reference($order);
    $receipt_data = $this->get_receipt_response_data($order);

    return [
      'order_id' => $order->get_id(),
      'id' => $order->get_id(),
      'order_number' => $order->get_order_number(),
      'number' => $order->get_order_number(),
      'order_key' => $order->get_order_key(),
      'payment_reference' => $payment_reference,
      'payment_method' => $order->get_payment_method(),
      'payment_method_title' => $order->get_payment_method_title(),
      'status' => $order->get_status(),
      'total' => (float) $order->get_total(),
      'email' => $order->get_billing_email(),
      'billing' => $this->get_order_address($order, 'billing'),
      'shipping' => $this->get_order_address($order, 'shipping'),
      'items' => $this->get_order_items($order),
      'receipt_uploaded' => $receipt_data['receipt_uploaded'],
      'receipt_status' => $receipt_data['receipt_status'],
      'receipt_url' => $receipt_data['receipt_url'],
      'receipt_uploaded_at' => $receipt_data['receipt_uploaded_at'],
      'zelle_receipt' => [
        'uploaded' => $receipt_data['receipt_uploaded'],
        'status' => $receipt_data['receipt_status'],
        'url' => $receipt_data['receipt_url'],
        'uploaded_at' => $receipt_data['receipt_uploaded_at'],
        'can_upload' => $receipt_data['can_upload'],
        'payment_reference' => $payment_reference,
      ],
      'payment_details' => [
        'title' => 'Zelle',
        'recipient' => $this->zelle_recipient(),
        'recipient_extra' => $this->zelle_name(),
        'button_label' => '',
        'button_url' => '',
      ],
    ];
  }

  private function get_order_address(WC_Order $order, $type) {
    return [
      'first_name' => $order->{"get_{$type}_first_name"}(),
      'last_name' => $order->{"get_{$type}_last_name"}(),
      'company' => $order->{"get_{$type}_company"}(),
      'email' => $type === 'billing' ? $order->get_billing_email() : '',
      'phone' => $type === 'billing' ? $order->get_billing_phone() : '',
      'address_1' => $order->{"get_{$type}_address_1"}(),
      'address_2' => $order->{"get_{$type}_address_2"}(),
      'city' => $order->{"get_{$type}_city"}(),
      'state' => $order->{"get_{$type}_state"}(),
      'postcode' => $order->{"get_{$type}_postcode"}(),
      'country' => $order->{"get_{$type}_country"}(),
    ];
  }

  private function get_order_items(WC_Order $order) {
    $items = [];

    foreach ($order->get_items() as $item) {
      $product = $item->get_product();

      $items[] = [
        'product_id' => $product ? $product->get_id() : 0,
        'quantity' => $item->get_quantity(),
        'name' => $item->get_name(),
        'total' => (float) $item->get_total(),
        'line_total' => (float) $item->get_total(),
        'image' => $product ? wp_get_attachment_image_url($product->get_image_id(), 'thumbnail') : '',
      ];
    }

    return $items;
  }

  public function send_zelle_order_emails_async($order_id) {
    $order = wc_get_order(absint($order_id));

    if (!$order) {
      return;
    }

    $changed = false;

    if ($order->get_meta('_rgv_zelle_customer_email_sent') !== 'yes') {
      if ($this->send_zelle_customer_email($order)) {
        $order->update_meta_data('_rgv_zelle_customer_email_sent', 'yes');
        $order->update_meta_data('_rgv_zelle_customer_email_sent_at', current_time('mysql'));
        $changed = true;
      }
    }

    if ($order->get_meta('_rgv_zelle_admin_email_sent') !== 'yes') {
      if ($this->send_zelle_admin_email($order)) {
        $order->update_meta_data('_rgv_zelle_admin_email_sent', 'yes');
        $order->update_meta_data('_rgv_zelle_admin_email_sent_at', current_time('mysql'));
        $changed = true;
      }
    }

    if ($changed) {
      $order->save();
    }
  }

  public function send_zelle_receipt_admin_email_async($order_id, $receipt_url) {
    $order = wc_get_order(absint($order_id));

    if (!$order) {
      return;
    }

    $receipt_hash = hash('sha256', (string) $receipt_url);

    if ($order->get_meta('_rgv_zelle_receipt_email_hash') === $receipt_hash) {
      return;
    }

    if ($this->send_receipt_admin_email($order, $receipt_url)) {
      $order->update_meta_data('_rgv_zelle_receipt_email_hash', $receipt_hash);
      $order->update_meta_data('_rgv_zelle_receipt_email_sent_at', current_time('mysql'));
      $order->save();
    }
  }

  private function send_zelle_customer_email(WC_Order $order) {
    $to = $order->get_billing_email();

    if (!$to) {
      return false;
    }

    $reference = $order->get_meta('_rgv_zelle_payment_reference') ?: $order->get_order_number();
    $subject = sprintf('RGVPRIME order #%s - Zelle payment instructions', $order->get_order_number());

    $message = $this->email_wrapper(sprintf('
      <h2>Your order was received</h2>
      <p>Your order is currently on hold until your Zelle payment is verified.</p>
      <table cellpadding="8" cellspacing="0" border="0" style="width:100%%;border-collapse:collapse;margin:18px 0;background:#111;color:#fff;border-radius:12px;overflow:hidden;">
        <tr><td><strong>Order</strong></td><td>#%s</td></tr>
        <tr><td><strong>Amount to send</strong></td><td>%s</td></tr>
        <tr><td><strong>Zelle</strong></td><td>%s</td></tr>
        <tr><td><strong>Name</strong></td><td>%s</td></tr>
        <tr><td><strong>Memo</strong></td><td><strong>%s</strong></td></tr>
      </table>
      <p><strong>Important:</strong> use exactly this memo code in Zelle. Do not include product names, product details, or any extra notes.</p>
      <p>After sending your payment, return to the thank-you page and upload your receipt.</p>
    ', esc_html($order->get_order_number()), wc_price($order->get_total()), esc_html($this->zelle_recipient()), esc_html($this->zelle_name()), esc_html($reference)));

    return wp_mail($to, $subject, $message, ['Content-Type: text/html; charset=UTF-8']);
  }

  private function send_zelle_admin_email(WC_Order $order) {
    $to = get_option('admin_email');

    if (!$to) {
      return false;
    }

    $subject = sprintf('New RGV Zelle order #%s pending payment', $order->get_order_number());
    $message = sprintf(
      "A new Zelle order is pending payment verification.\n\nOrder: #%s\nTotal: %s\nCustomer: %s\nEmail: %s\n\nReview it in WooCommerce.",
      $order->get_order_number(),
      $order->get_formatted_order_total(),
      $order->get_formatted_billing_full_name(),
      $order->get_billing_email()
    );

    return wp_mail($to, $subject, $message);
  }

  private function send_receipt_admin_email(WC_Order $order, $receipt_url) {
    $to = get_option('admin_email');

    if (!$to) {
      return false;
    }

    $subject = sprintf('Zelle receipt uploaded for order #%s', $order->get_order_number());
    $message = sprintf(
      "A customer uploaded a Zelle receipt.\n\nOrder: #%s\nTotal: %s\nCustomer: %s\nReceipt: %s\n\nReview and verify the payment in WooCommerce.",
      $order->get_order_number(),
      $order->get_formatted_order_total(),
      $order->get_formatted_billing_full_name(),
      $receipt_url
    );

    return wp_mail($to, $subject, $message);
  }


  public function register_order_meta_box() {
    $screens = ['shop_order'];

    if (function_exists('wc_get_page_screen_id')) {
      $screens[] = wc_get_page_screen_id('shop-order');
    }

    $screens[] = 'woocommerce_page_wc-orders';

    foreach (array_unique(array_filter($screens)) as $screen) {
      add_meta_box(
        'rgv_zelle_payment_review',
        'RGV Zelle Payment Review',
        [$this, 'render_zelle_meta_box'],
        $screen,
        'side',
        'high'
      );
    }
  }

  public function render_zelle_meta_box($object) {
    $order = $this->get_order_from_admin_object($object);

    if (!$order || !$this->is_rgv_zelle_order($order)) {
      echo '<p style="margin:0;color:#667085;">This is not an RGV Zelle order.</p>';
      return;
    }

    $order_id = $order->get_id();
    $reference = $order->get_meta('_rgv_zelle_payment_reference');

    if (!$reference) {
      $reference = 'RGV-' . preg_replace('/[^0-9]/', '', (string) $order->get_order_number());
    }

    $receipt_url = $order->get_meta('_rgv_zelle_receipt_url');
    $attachment_id = absint($order->get_meta('_rgv_zelle_receipt_attachment_id'));
    $receipt_status = $order->get_meta('_rgv_zelle_receipt_status') ?: 'not_uploaded';
    $uploaded_at = $order->get_meta('_rgv_zelle_receipt_uploaded_at');
    $deleted_at = $order->get_meta('_rgv_zelle_receipt_deleted_at');
    $validated_at = $order->get_meta('_rgv_zelle_payment_validated_at');
    $is_approved = $receipt_status === 'approved' || in_array($order->get_status(), ['processing', 'completed'], true);

    $approve_url = wp_nonce_url(
      admin_url('admin-post.php?action=rgv_approve_zelle_payment&order_id=' . $order_id),
      'rgv_approve_zelle_payment_' . $order_id
    );

    echo '<style>
      .rgv-zelle-admin-box{display:grid;gap:12px;font-size:12px;color:#1d2939;}
      .rgv-zelle-kv{display:grid;gap:8px;margin:0;padding:0;}
      .rgv-zelle-kv div{display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid #eaecf0;padding-bottom:7px;}
      .rgv-zelle-kv dt{font-weight:700;color:#667085;}
      .rgv-zelle-kv dd{margin:0;text-align:right;font-weight:800;color:#101828;overflow-wrap:anywhere;}
      .rgv-zelle-memo{border:1px solid #fecaca;background:#fff1f2;border-radius:10px;padding:10px;color:#991b1b;font-weight:900;text-align:center;letter-spacing:.04em;}
      .rgv-zelle-receipt{border:1px solid #eaecf0;border-radius:12px;padding:10px;background:#f9fafb;}
      .rgv-zelle-receipt img{display:block;width:100%;height:auto;border-radius:10px;border:1px solid #eaecf0;background:#fff;}
      .rgv-zelle-actions{display:grid;gap:8px;}
      .rgv-zelle-actions .button{width:100%;text-align:center;justify-content:center;}
      .rgv-zelle-badge{display:inline-flex;width:max-content;border-radius:999px;padding:4px 9px;background:#fee2e2;color:#991b1b;font-weight:800;text-transform:uppercase;font-size:10px;letter-spacing:.06em;}
      .rgv-zelle-badge.ok{background:#dcfce7;color:#166534;}
    </style>';

    echo '<div class="rgv-zelle-admin-box">';
    echo '<span class="rgv-zelle-badge ' . ($is_approved ? 'ok' : '') . '">' . esc_html($is_approved ? 'Approved' : $receipt_status) . '</span>';
    echo '<div class="rgv-zelle-memo">Memo: ' . esc_html($reference) . '</div>';

    echo '<dl class="rgv-zelle-kv">';
    $this->admin_kv('Order', '#' . $order->get_order_number());
    $this->admin_kv('Status', wc_get_order_status_name($order->get_status()));
    $this->admin_kv('Total', $order->get_formatted_order_total());
    $this->admin_kv('Customer', $order->get_formatted_billing_full_name());
    $this->admin_kv('Email', $order->get_billing_email());
    $this->admin_kv('Phone', $order->get_billing_phone());
    $this->admin_kv('Zelle recipient', $this->zelle_recipient());
    $this->admin_kv('Zelle name', $this->zelle_name());
    if ($uploaded_at) {
      $this->admin_kv('Receipt uploaded', $uploaded_at);
    }
    if ($deleted_at) {
      $this->admin_kv('Receipt deleted', $deleted_at);
    }
    if ($validated_at) {
      $this->admin_kv('Validated at', $validated_at);
    }
    echo '</dl>';

    echo '<div class="rgv-zelle-receipt">';

    if ($receipt_url) {
      if ($attachment_id && wp_attachment_is_image($attachment_id)) {
        echo wp_get_attachment_image($attachment_id, 'medium', false, ['style' => 'max-width:100%;height:auto;']);
      } elseif ($this->is_image_url($receipt_url)) {
        echo '<img src="' . esc_url($receipt_url) . '" alt="Zelle payment receipt">';
      } else {
        echo '<p style="margin:0 0 8px;color:#667085;">Receipt file uploaded.</p>';
      }

      echo '<p style="margin:10px 0 0;"><a class="button" href="' . esc_url($receipt_url) . '" target="_blank" rel="noopener">Open receipt</a></p>';
    } elseif ($deleted_at) {
      echo '<p style="margin:0;color:#667085;">The receipt file was deleted automatically after 3 days to free storage space.</p>';
    } else {
      echo '<p style="margin:0;color:#667085;">No receipt has been uploaded yet.</p>';
    }

    echo '</div>';

    echo '<div class="rgv-zelle-actions">';

    if (!$is_approved) {
      echo '<a class="button button-primary" href="' . esc_url($approve_url) . '">Approve payment & mark Processing</a>';
      echo '<small style="color:#667085;line-height:1.4;">This changes the order to Processing and emails the customer that payment was validated.</small>';
    } else {
      echo '<small style="color:#166534;font-weight:800;line-height:1.4;">Payment is approved. The order is ready for processing.</small>';
    }

    echo '</div>';
    echo '</div>';
  }

  private function admin_kv($label, $value) {
    if ($value === '' || $value === null) {
      $value = '—';
    }

    echo '<div><dt>' . esc_html($label) . '</dt><dd>' . wp_kses_post($value) . '</dd></div>';
  }

  private function get_order_from_admin_object($object) {
    if ($object instanceof WC_Order) {
      return $object;
    }

    if (is_object($object) && isset($object->ID)) {
      return wc_get_order($object->ID);
    }

    $order_id = 0;

    if (!empty($_GET['id'])) {
      $order_id = absint($_GET['id']);
    } elseif (!empty($_GET['post'])) {
      $order_id = absint($_GET['post']);
    }

    return $order_id ? wc_get_order($order_id) : false;
  }

  private function is_image_url($url) {
    $path = wp_parse_url($url, PHP_URL_PATH);
    $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    return in_array($extension, ['jpg', 'jpeg', 'png', 'webp', 'gif'], true);
  }

  public function approve_zelle_payment() {
    $order_id = isset($_GET['order_id']) ? absint($_GET['order_id']) : 0;

    if (!$order_id || !wp_verify_nonce($_GET['_wpnonce'] ?? '', 'rgv_approve_zelle_payment_' . $order_id)) {
      wp_die('Invalid approval request.');
    }

    if (!current_user_can('manage_woocommerce') && !current_user_can('edit_shop_order', $order_id)) {
      wp_die('You do not have permission to approve this payment.');
    }

    $order = wc_get_order($order_id);

    if (!$order || !$this->is_rgv_zelle_order($order)) {
      wp_die('This order is not a valid RGV Zelle order.');
    }

    $receipt_url = $order->get_meta('_rgv_zelle_receipt_url');
    $admin_user = wp_get_current_user();

    $order->update_meta_data('_rgv_zelle_receipt_status', 'approved');
    $order->update_meta_data('_rgv_zelle_payment_validated_at', current_time('mysql'));
    $order->update_meta_data('_rgv_zelle_payment_validated_by', $admin_user ? $admin_user->user_login : 'admin');

    $note = 'Zelle payment approved from the RGV payment review box.';

    if ($receipt_url) {
      $note .= ' Receipt: ' . $receipt_url;
    }

    $order->add_order_note($note, false, true);
    $order->update_status('processing', 'Zelle payment validated. Order moved to processing.', true);
    $order->save();

    $this->send_payment_validated_email($order);

    $redirect = method_exists($order, 'get_edit_order_url')
      ? $order->get_edit_order_url()
      : admin_url('post.php?post=' . $order_id . '&action=edit');

    wp_safe_redirect(add_query_arg('rgv_zelle_approved', '1', $redirect));
    exit;
  }

  public function admin_notices() {
    if (empty($_GET['rgv_zelle_approved'])) {
      return;
    }

    echo '<div class="notice notice-success is-dismissible"><p>RGV Zelle payment approved. The order was changed to Processing and the customer was notified.</p></div>';
  }

  private function send_payment_validated_email(WC_Order $order) {
    $to = $order->get_billing_email();

    if (!$to) {
      return;
    }

    $subject = sprintf('RGVPRIME order #%s - Payment validated', $order->get_order_number());

    $message = $this->email_wrapper(sprintf('
      <h2>Your payment was validated</h2>
      <p>We have reviewed and validated your Zelle payment for order <strong>#%s</strong>.</p>
      <table cellpadding="8" cellspacing="0" border="0" style="width:100%%;border-collapse:collapse;margin:18px 0;background:#111;color:#fff;border-radius:12px;overflow:hidden;">
        <tr><td><strong>Order</strong></td><td>#%s</td></tr>
        <tr><td><strong>Total</strong></td><td>%s</td></tr>
        <tr><td><strong>Status</strong></td><td>Processing</td></tr>
      </table>
      <p>Your order is now being processed. You will receive additional updates when the order status changes.</p>
    ', esc_html($order->get_order_number()), esc_html($order->get_order_number()), wc_price($order->get_total())));

    wp_mail($to, $subject, $message, ['Content-Type: text/html; charset=UTF-8']);
  }

  private function email_wrapper($content) {
    return '
      <div style="margin:0;padding:28px;background:#050505;color:#ffffff;font-family:Arial,sans-serif;">
        <div style="max-width:620px;margin:0 auto;border:1px solid rgba(255,255,255,.12);border-radius:20px;background:#0b0b0b;padding:28px;">
          <p style="margin:0 0 10px;color:#ef4444;font-size:11px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;">RGVPRIME LLC</p>
          ' . $content . '
        </div>
      </div>
    ';
  }

  private function zelle_recipient() {
    if (defined('RGV_ZELLE_PAYMENT_RECIPIENT')) {
      return RGV_ZELLE_PAYMENT_RECIPIENT;
    }

    return 'sales@rgvprimellc.com';
  }

  private function zelle_name() {
    if (defined('RGV_ZELLE_PAYMENT_NAME')) {
      return RGV_ZELLE_PAYMENT_NAME;
    }

    return 'RGVPRIME LLC';
  }
}

new RGV_Zelle_Checkout();
