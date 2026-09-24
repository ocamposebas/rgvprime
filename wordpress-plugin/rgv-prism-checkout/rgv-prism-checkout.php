<?php
/**
 * Plugin Name: RGV PRISM Checkout Handoff
 * Description: Creates protected guest WooCommerce orders and hands payment off to PRISM Secure Checkout.
 * Version: 1.0.0
 * Author: RGVPRIME LLC
 * Requires at least: 6.5
 * Requires PHP: 8.1
 * WC requires at least: 8.5
 * WC tested up to: 10.1
 */

defined('ABSPATH') || exit;

final class RGV_Prism_Checkout_Handoff {
  const REST_NAMESPACE = 'rgv-prism/v1';
  const REQUEST_LOCK_TTL = 180;
  const REQUEST_RESULT_TTL = 600;
  const RATE_LIMIT_WINDOW = 600;
  const RATE_LIMIT_MAX_REQUESTS = 10;
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
  }

  public function register_routes() {
    register_rest_route(self::REST_NAMESPACE, '/order', [
      'methods' => WP_REST_Server::CREATABLE,
      'callback' => [$this, 'create_order'],
      'permission_callback' => '__return_true',
    ]);
  }

  public function create_order(WP_REST_Request $request) {
    if (!class_exists('WooCommerce') || !function_exists('wc_create_order')) {
      return $this->error_response('WooCommerce is not available.', 500);
    }

    $content_type = strtolower((string) $request->get_header('content-type'));
    if (strpos($content_type, 'application/json') === false) {
      return $this->error_response('Invalid checkout request format.', 415);
    }

    $rate_limit = $this->enforce_rate_limit();
    if (is_wp_error($rate_limit)) {
      return $this->error_response($rate_limit->get_error_message(), 429);
    }

    $data = $request->get_json_params();
    if (!is_array($data)) {
      $data = [];
    }

    $compliance = $this->validate_compliance_acceptance($request, $data);
    if (is_wp_error($compliance)) {
      return $this->error_response(
        $compliance->get_error_message(),
        (int) ($compliance->get_error_data()['status'] ?? 400)
      );
    }

    $items = isset($data['items']) && is_array($data['items']) ? $data['items'] : [];
    $billing = isset($data['billing']) && is_array($data['billing']) ? $data['billing'] : [];
    $shipping = isset($data['shipping']) && is_array($data['shipping']) ? $data['shipping'] : $billing;
    $validation = $this->validate_order_payload($items, $billing, $shipping);
    if (is_wp_error($validation)) {
      return $this->error_response($validation->get_error_message(), 400);
    }

    $request_key = $this->build_request_key($request, $data, $items, $billing, $shipping);
    $lock_name = '_rgv_prism_req_' . substr($request_key, 0, 40);
    $claim = $this->claim_request($lock_name);

    if (empty($claim['acquired'])) {
      $existing_order = $this->get_existing_order($lock_name, true);
      if ($existing_order) {
        return $this->format_order_response($existing_order, true);
      }

      return new WP_REST_Response([
        'success' => false,
        'processing' => true,
        'message' => 'Your order is already being processed. Please do not press Pay again.',
      ], 409);
    }

    $order = null;

    try {
      $order = wc_create_order([
        'status' => 'pending',
        'customer_id' => 0,
        'created_via' => 'rgv_custom_checkout',
      ]);
      if (is_wp_error($order)) {
        throw new Exception($order->get_error_message());
      }

      $order->set_address($this->clean_address($billing), 'billing');
      $order->set_address($this->clean_address($shipping), 'shipping');
      $order->set_customer_id(0);
      $order->set_payment_method('psc');
      $order->set_payment_method_title('PRISM Secure Checkout');
      $order->set_created_via('rgv_custom_checkout');
      $order->update_meta_data('_rgv_payment_source', 'rgv_custom_checkout_prism');
      $order->update_meta_data('_rgv_checkout_request_key', $request_key);
      $order->update_meta_data(
        '_rgv_policy_acknowledged_at',
        sanitize_text_field($data['policyAcknowledgedAt'] ?? current_time('mysql'))
      );
      $this->store_compliance_evidence($order, $compliance);

      if ($compliance['user_id'] > 0) {
        $order->update_meta_data('_rgv_storefront_user', (string) $compliance['user_id']);
      }

      $subtotal = 0.0;
      foreach ($items as $item) {
        $subtotal += $this->add_order_item($order, $item);
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
          $order->add_order_note(sprintf(
            'Coupon %s could not be applied: %s',
            $coupon,
            $coupon_error->getMessage()
          ));
        }
      }

      $shipping_method = $this->get_shipping_method_details(
        $data,
        $subtotal >= self::FREE_SHIPPING_MINIMUM
      );
      $shipping_item = new WC_Order_Item_Shipping();
      $shipping_item->set_method_title($shipping_method['title']);
      $shipping_item->set_method_id($shipping_method['id']);
      $shipping_item->set_total((float) $shipping_method['cost']);
      $order->add_item($shipping_item);

      $order->calculate_totals();
      $this->add_processing_fees($order, $data);
      $this->flag_possible_misuse($order, $items, $billing, $shipping, $compliance);

      // Keep order-pay available to the storefront account without requiring a WordPress login.
      $order->set_customer_id(0);
      $order->set_status('pending');
      // Equivalent to WooCommerce REST `set_paid: false`; PRISM completes payment later.
      $order->set_date_paid(null);
      $order->save();

      $this->complete_request($lock_name, $order->get_id());
      return $this->format_order_response($order, false);
    } catch (Exception $error) {
      $context = ['error' => $error->getMessage()];
      if ($order instanceof WC_Order && $order->get_id()) {
        $context['order_id'] = $order->get_id();
      }
      $this->log_error('PRISM order creation failed.', $context);
      delete_option($lock_name);

      return $this->error_response('Unable to create the PRISM order. Please try again.', 500);
    }
  }

  private function error_response($message, $status) {
    return new WP_REST_Response([
      'success' => false,
      'message' => $message,
    ], $status);
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
      if ($candidate !== '') {
        return $candidate;
      }
    }

    return '';
  }

  private function validate_compliance_acceptance(WP_REST_Request $request, array $data) {
    $secret = $this->compliance_secret();
    $provided = (string) $request->get_header('x-rgv-compliance-secret');
    if ($secret === '' || $provided === '' || !hash_equals($secret, $provided)) {
      return new WP_Error(
        'rgv_prism_session_required',
        'This order must be submitted through the secure storefront checkout.',
        ['status' => 401]
      );
    }

    foreach (['ageConfirmed', 'researchUseAcknowledged', 'termsAccepted'] as $field) {
      if (($data[$field] ?? null) !== true) {
        return new WP_Error(
          'rgv_prism_compliance_required',
          'The 21+, Research Use Only, and Terms confirmations are required.',
          ['status' => 400]
        );
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
      return new WP_Error(
        'rgv_prism_compliance_invalid',
        'Compliance acceptance evidence is invalid or expired.',
        ['status' => 400]
      );
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
  }

  private function enforce_rate_limit() {
    $ip = $this->get_client_ip();
    $key = 'rgv_prism_rate_' . substr(hash('sha256', $ip), 0, 32);
    $state = get_transient($key);
    if (!is_array($state) || (int) ($state['expires_at'] ?? 0) <= time()) {
      $state = [
        'count' => 0,
        'expires_at' => time() + self::RATE_LIMIT_WINDOW,
      ];
    }

    if ((int) $state['count'] >= self::RATE_LIMIT_MAX_REQUESTS) {
      return new WP_Error('rgv_prism_rate_limit', 'Too many checkout attempts. Please wait and try again.');
    }

    $state['count'] = (int) $state['count'] + 1;
    set_transient($key, $state, self::RATE_LIMIT_WINDOW);
    return true;
  }

  private function get_client_ip() {
    $candidates = [
      $_SERVER['HTTP_CF_CONNECTING_IP'] ?? '',
      $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '',
      $_SERVER['REMOTE_ADDR'] ?? '',
    ];

    foreach ($candidates as $candidate) {
      $candidate = trim(explode(',', (string) $candidate)[0]);
      if (filter_var($candidate, FILTER_VALIDATE_IP)) {
        return $candidate;
      }
    }

    return 'unknown';
  }

  private function build_request_key(WP_REST_Request $request, array $data, array $items, array $billing, array $shipping) {
    $provided = sanitize_text_field((string) $request->get_header('idempotency-key'));
    if (!$provided) {
      foreach (['requestId', 'request_id', 'idempotencyKey', 'idempotency_key'] as $field) {
        if (!empty($data[$field])) {
          $provided = sanitize_text_field((string) $data[$field]);
          break;
        }
      }
    }

    if ($provided) {
      return hash('sha256', $provided);
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

    return hash('sha256', wp_json_encode([
      'email' => strtolower(sanitize_email($billing['email'] ?? $shipping['email'] ?? '')),
      'address' => sanitize_text_field((string) ($shipping['address_1'] ?? $billing['address_1'] ?? '')),
      'postcode' => sanitize_text_field((string) ($shipping['postcode'] ?? $billing['postcode'] ?? '')),
      'coupon' => $this->clean_coupon($data['coupon'] ?? $data['couponCode'] ?? ''),
      'priority_processing' => $this->priority_processing_requested($data),
      'items' => $normalized_items,
    ]));
  }

  private function claim_request($option_name) {
    $existing = get_option($option_name, null);
    if (is_array($existing) && (int) ($existing['expires_at'] ?? 0) <= time()) {
      delete_option($option_name);
      $existing = null;
    }
    if (is_array($existing)) {
      return ['acquired' => false, 'state' => $existing];
    }

    $state = [
      'status' => 'processing',
      'order_id' => 0,
      'created_at' => time(),
      'expires_at' => time() + self::REQUEST_LOCK_TTL,
    ];

    return [
      'acquired' => add_option($option_name, $state, '', 'no'),
      'state' => $state,
    ];
  }

  private function complete_request($option_name, $order_id) {
    update_option($option_name, [
      'status' => 'completed',
      'order_id' => absint($order_id),
      'created_at' => time(),
      'expires_at' => time() + self::REQUEST_RESULT_TTL,
    ], false);
  }

  private function get_existing_order($option_name, $wait_for_processing = false) {
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

  private function validate_order_payload(array $items, array $billing, array $shipping) {
    if (!$items) {
      return new WP_Error('rgv_prism_empty_items', 'No valid cart items were received.');
    }
    if (count($items) > self::MAX_ORDER_ITEMS) {
      return new WP_Error('rgv_prism_too_many_items', 'Too many cart items were received.');
    }

    foreach ([$billing, $shipping] as $address) {
      $country = strtoupper(sanitize_text_field($address['country'] ?? ''));
      $state = strtoupper(sanitize_text_field($address['state'] ?? ''));
      if ($country === 'PR' || $state === 'PR') {
        return new WP_Error('rgv_prism_destination', 'Shipping to Puerto Rico is not available.');
      }
    }

    foreach (['first_name', 'last_name', 'email', 'phone', 'address_1', 'city', 'state', 'postcode', 'country'] as $field) {
      if (empty($shipping[$field]) && empty($billing[$field])) {
        return new WP_Error('rgv_prism_missing_field', 'Complete all required checkout fields.');
      }
    }

    $email = sanitize_email($billing['email'] ?? $shipping['email'] ?? '');
    if (!$email || !is_email($email)) {
      return new WP_Error('rgv_prism_invalid_email', 'A valid email is required.');
    }

    foreach ($items as $item) {
      if (!is_array($item)) {
        return new WP_Error('rgv_prism_invalid_item', 'A cart item is invalid.');
      }
      $quantity = absint($item['quantity'] ?? 0);
      if ($quantity < 1 || $quantity > self::MAX_ITEM_QUANTITY) {
        return new WP_Error('rgv_prism_invalid_quantity', 'A cart item has an invalid quantity.');
      }

      $stock = $this->validate_item_stock($item);
      if (is_wp_error($stock)) {
        return $stock;
      }
    }

    return true;
  }

  private function get_item_product(array $item) {
    $product_id = absint($item['product_id'] ?? 0);
    $variation_id = absint($item['variation_id'] ?? 0);
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

  private function validate_item_stock(array $item) {
    $product = $this->get_item_product($item);
    $quantity = max(1, absint($item['quantity'] ?? 1));
    if (!$product instanceof WC_Product || !$product->exists()) {
      return new WP_Error('rgv_prism_product_missing', 'A product in the cart could not be found.');
    }

    $name = wp_strip_all_tags($product->get_name());
    if (!$product->is_purchasable()) {
      return new WP_Error('rgv_prism_product_unavailable', sprintf('%s is no longer available for purchase.', $name));
    }
    if (!$product->is_in_stock() && !$product->backorders_allowed()) {
      return new WP_Error('rgv_prism_product_sold_out', sprintf('%s is sold out.', $name));
    }
    if (!$product->backorders_allowed() && !$product->has_enough_stock($quantity)) {
      return new WP_Error('rgv_prism_stock', sprintf('There is not enough stock available for %s.', $name));
    }

    return true;
  }

  private function add_order_item(WC_Order $order, array $item) {
    $stock = $this->validate_item_stock($item);
    if (is_wp_error($stock)) {
      throw new Exception($stock->get_error_message());
    }

    $product = $this->get_item_product($item);
    $quantity = max(1, absint($item['quantity'] ?? 1));
    $line_total = (float) wc_format_decimal((float) $product->get_price() * $quantity);
    $order->add_product($product, $quantity, [
      'subtotal' => $line_total,
      'total' => $line_total,
    ]);

    return $line_total;
  }

  private function clean_address(array $address) {
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

  private function clean_coupon($coupon) {
    $coupon = strtoupper(sanitize_text_field((string) $coupon));
    return preg_replace('/[^A-Z0-9\-_]/', '', $coupon);
  }

  private function get_shipping_method_details(array $data, $free_shipping) {
    $method = $data['shippingMethod']
      ?? $data['shipping_method']
      ?? $data['shippingMethodId']
      ?? $data['shipping_method_id']
      ?? '';
    if (is_array($method)) {
      $method = $method['id'] ?? $method['method_id'] ?? '';
    }
    $method_id = sanitize_key((string) $method);
    $details = self::SHIPPING_RATES[$method_id] ?? self::SHIPPING_RATES['usps_ground_advantage'];

    if ($free_shipping && false !== ($details['free_shipping_eligible'] ?? true)) {
      return [
        'id' => 'free_shipping',
        'title' => "Free Shipping (Order's Over $200)",
        'cost' => 0.0,
      ];
    }

    return [
      'id' => isset(self::SHIPPING_RATES[$method_id]) ? $method_id : 'usps_ground_advantage',
      'title' => sanitize_text_field((string) $details['title']),
      'cost' => max(0.0, (float) $details['cost']),
    ];
  }

  private function add_processing_fees(WC_Order $order, array $data) {
    $fee_base = max(0.0, (float) $order->get_total());
    if ($fee_base <= 0) {
      return;
    }

    $this->add_fee($order, self::ORDER_PROCESSING_FEE_NAME, $fee_base * self::ORDER_PROCESSING_FEE_RATE);
    $priority = $this->priority_processing_requested($data);
    if ($priority) {
      $this->add_fee($order, self::PRIORITY_PROCESSING_FEE_NAME, $fee_base * self::PRIORITY_PROCESSING_FEE_RATE);
      $order->add_order_note('Priority processing requested: order should enter processing within 3 hours.');
    }
    $order->update_meta_data('_rgv_priority_processing', $priority ? 'yes' : 'no');
    $order->calculate_totals();
  }

  private function add_fee(WC_Order $order, $name, $amount) {
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

  private function priority_processing_requested(array $data) {
    return (bool) filter_var(
      $data['priorityProcessing'] ?? $data['priority_processing'] ?? false,
      FILTER_VALIDATE_BOOLEAN
    );
  }

  private function flag_possible_misuse(WC_Order $order, array $items, array $billing, array $shipping, array $acceptance) {
    $signals = [];
    $total_quantity = 0;
    foreach ($items as $item) {
      $quantity = max(0, absint($item['quantity'] ?? 0));
      $total_quantity += $quantity;
      if ($quantity >= 5) {
        $signals[] = 'five_or_more_of_one_item';
      }
    }
    if ($total_quantity >= 10) {
      $signals[] = 'high_total_unit_count';
    }
    if (strtolower(sanitize_email($billing['email'] ?? '')) !== strtolower($acceptance['user_email'])) {
      $signals[] = 'account_and_billing_email_mismatch';
    }
    if (
      !empty($billing['postcode']) && !empty($shipping['postcode']) &&
      sanitize_text_field($billing['postcode']) !== sanitize_text_field($shipping['postcode'])
    ) {
      $signals[] = 'billing_and_shipping_zip_mismatch';
    }

    $signals = array_values(array_unique($signals));
    if (!$signals) {
      return;
    }

    $order->update_meta_data('_rgv_manual_misuse_review_required', 'yes');
    $order->update_meta_data('_rgv_manual_misuse_review_signals', implode(',', $signals));
    $order->add_order_note(
      'Manual misuse review required before fulfillment. Signals: ' .
      implode(', ', $signals) .
      '. Cancel the order if the review cannot establish qualified research use.'
    );
  }

  private function format_order_response(WC_Order $order, $duplicate_prevented) {
    $payment_url = esc_url_raw((string) $order->get_checkout_payment_url());
    if (!$payment_url) {
      $this->log_error('WooCommerce did not return a payment URL for a PRISM order.', [
        'order_id' => $order->get_id(),
        'status' => $order->get_status(),
        'payment_method' => $order->get_payment_method(),
      ]);

      return $this->error_response(
        'Your order was created, but PRISM did not return a payment URL. Please contact support before retrying.',
        502
      );
    }

    return new WP_REST_Response([
      'success' => true,
      'duplicate_prevented' => (bool) $duplicate_prevented,
      'payment_url' => $payment_url,
      'order' => [
        'order_id' => $order->get_id(),
        'order_number' => $order->get_order_number(),
        'status' => $order->get_status(),
        'payment_method' => $order->get_payment_method(),
        'payment_method_title' => $order->get_payment_method_title(),
        'payment_url' => $payment_url,
        'paid' => $order->is_paid(),
      ],
    ], 200);
  }

  private function log_error($message, array $context = []) {
    if (!function_exists('wc_get_logger')) {
      return;
    }

    wc_get_logger()->error($message, array_merge([
      'source' => 'rgv-prism-checkout',
    ], $context));
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
  new RGV_Prism_Checkout_Handoff();
});
