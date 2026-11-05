<?php
/**
 * Plugin Name: RGVPRIME eDebit Order Endpoint
 * Description: Creates WooCommerce orders from the RGVPRIME custom frontend checkout and returns the eDebit hosted-payment redirect URL.
 * Version: 1.2.1
 * Author: RGVPRIME LLC
 * Requires Plugins: woocommerce
 */

if (! defined('ABSPATH')) {
    exit;
}

final class RGVPRIME_Edebit_Order_Endpoint {
    const VERSION = '1.2.1';

    /** New REST namespace used by RGVPRIME. */
    const NAMESPACE = 'rgvprime/v1';

    /**
     * Temporary compatibility namespace.
     * Existing frontend code using /wp-json/phase/v1/... will keep working.
     */
    const LEGACY_NAMESPACE = 'phase/v1';

    /** RGVPRIME frontend checkout URL. */
    const FRONTEND_CHECKOUT_URL = 'https://rgvprimellc.com/checkout/';

    /** Technical gateway ID. Do not rename unless the eDebit plugin changes it. */
    const DEFAULT_GATEWAY_ID = 'edd_draft_yodlee_gateway';

    /** Standard shipping becomes free at this subtotal after the promotion ends. */
    const FREE_SHIPPING_MINIMUM = 200.0;

    /** Sunday, November 8, 2026 at 11:00 p.m. in America/Bogota. */
    const FREE_SHIPPING_PROMOTION_ENDS_AT = '2026-11-09T04:00:00Z';

    const SHIPPING_RATES = [
        'ups_2_day_air' => [
            'title' => 'UPS Shipping',
            'cost'  => 15.0,
        ],
        'ups_expedited' => [
            'title'                  => 'UPS 45',
            'cost'                   => 45.0,
            'free_shipping_eligible' => false,
        ],
        'usps_ground_advantage' => [
            'title' => 'USPS Ground',
            'cost'  => 8.0,
        ],
        'usps_priority' => [
            'title' => 'USPS Priority Mail',
            'cost'  => 12.0,
        ],
    ];

    public static function init() {
        add_action('rest_api_init', [__CLASS__, 'register_routes']);
    }

    public static function register_routes() {
        $namespaces = array_unique([
            self::NAMESPACE,
            self::LEGACY_NAMESPACE,
        ]);

        foreach ($namespaces as $namespace) {
            register_rest_route($namespace, '/health', [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [__CLASS__, 'health'],
                'permission_callback' => '__return_true',
            ]);

            register_rest_route($namespace, '/payment-gateways', [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [__CLASS__, 'payment_gateways'],
                'permission_callback' => '__return_true',
            ]);

            register_rest_route($namespace, '/create-edebit-order', [
                'methods'             => WP_REST_Server::CREATABLE,
                'callback'            => [__CLASS__, 'create_order'],
                'permission_callback' => '__return_true',
            ]);
        }
    }

    public static function health() {
        return rest_ensure_response([
            'success'          => true,
            'plugin'           => 'RGVPRIME eDebit Order Endpoint',
            'version'          => self::VERSION,
            'namespace'        => self::NAMESPACE,
            'legacyNamespace'  => self::LEGACY_NAMESPACE,
            'gatewayId'        => self::DEFAULT_GATEWAY_ID,
            'checkoutReturnUrl'=> self::FRONTEND_CHECKOUT_URL,
        ]);
    }

    public static function payment_gateways() {
        if (! class_exists('WooCommerce')) {
            return new WP_Error(
                'woocommerce_missing',
                'WooCommerce is not active.',
                ['status' => 500]
            );
        }

        if (! function_exists('WC')) {
            return new WP_Error(
                'woocommerce_unavailable',
                'WooCommerce is unavailable.',
                ['status' => 500]
            );
        }

        $gateways = WC()->payment_gateways()->payment_gateways();
        $payload  = [];

        foreach ($gateways as $id => $gateway) {
            $supports = [];

            foreach (['products', 'refunds', 'tokenization', 'subscriptions'] as $feature) {
                $supports[$feature] = method_exists($gateway, 'supports')
                    ? (bool) $gateway->supports($feature)
                    : false;
            }

            $payload[] = [
                'id'           => $id,
                'title'        => method_exists($gateway, 'get_title')
                    ? $gateway->get_title()
                    : ($gateway->title ?? ''),
                'method_title' => $gateway->method_title ?? '',
                'enabled'      => $gateway->enabled ?? 'no',
                'supports'     => $supports,
            ];
        }

        return rest_ensure_response([
            'success'           => true,
            'version'           => self::VERSION,
            'gateways'          => $payload,
            'currentGatewayId'  => self::DEFAULT_GATEWAY_ID,
        ]);
    }

    private static function clean_string($value) {
        return sanitize_text_field(is_scalar($value) ? (string) $value : '');
    }

    private static function clean_email($value) {
        return sanitize_email(is_scalar($value) ? (string) $value : '');
    }

    private static function clean_price($value) {
        if (is_string($value)) {
            $value = preg_replace('/[^0-9.\-]/', '', $value);
        }

        $number = is_numeric($value) ? (float) $value : 0;

        return max(0, $number);
    }

    private static function normalize_address($data) {
        $data = is_array($data) ? $data : [];

        return [
            'first_name' => self::clean_string($data['first_name'] ?? $data['firstName'] ?? ''),
            'last_name'  => self::clean_string($data['last_name'] ?? $data['lastName'] ?? ''),
            'company'    => self::clean_string($data['company'] ?? ''),
            'email'      => self::clean_email($data['email'] ?? ''),
            'phone'      => self::clean_string($data['phone'] ?? ''),
            'address_1'  => self::clean_string($data['address_1'] ?? $data['address1'] ?? ''),
            'address_2'  => self::clean_string($data['address_2'] ?? $data['address2'] ?? ''),
            'city'       => self::clean_string($data['city'] ?? ''),
            'state'      => self::clean_string($data['state'] ?? ''),
            'postcode'   => self::clean_string($data['postcode'] ?? $data['zip'] ?? $data['postalCode'] ?? ''),
            'country'    => strtoupper(self::clean_string($data['country'] ?? 'US')),
        ];
    }

    private static function get_request_json(WP_REST_Request $request) {
        $params = $request->get_json_params();

        return is_array($params) ? $params : [];
    }

    private static function get_gateway($gateway_id) {
        $gateways = WC()->payment_gateways()->payment_gateways();

        return $gateways[$gateway_id] ?? null;
    }

    private static function add_transition_meta($order, $new_key, $legacy_key, $value) {
        $order->update_meta_data($new_key, $value);

        if ($legacy_key && $legacy_key !== $new_key) {
            $order->update_meta_data($legacy_key, $value);
        }
    }

    private static function is_free_shipping_promotion_active() {
        return time() < strtotime(self::FREE_SHIPPING_PROMOTION_ENDS_AT);
    }

    private static function shipping_details($body, $subtotal, $coupon_free_shipping) {
        $rates = apply_filters('rgvprime_edebit_shipping_rates', self::SHIPPING_RATES);

        if (! is_array($rates)) {
            $rates = self::SHIPPING_RATES;
        }

        $method = $body['shippingMethod']
            ?? $body['shipping_method']
            ?? $body['shippingMethodId']
            ?? $body['shipping_method_id']
            ?? '';

        if (is_array($method)) {
            $method = $method['id'] ?? $method['method_id'] ?? '';
        }

        $method_id = sanitize_key((string) $method);

        if (! isset($rates[$method_id]) || ! is_array($rates[$method_id])) {
            $method_id = 'usps_ground_advantage';
        }

        $rate = isset($rates[$method_id]) && is_array($rates[$method_id])
            ? $rates[$method_id]
            : self::SHIPPING_RATES['usps_ground_advantage'];
        $promotion_active = self::is_free_shipping_promotion_active();
        $minimum = max(0, (float) apply_filters(
            'rgvprime_edebit_free_shipping_minimum',
            self::FREE_SHIPPING_MINIMUM
        ));
        $free_eligible = false !== ($rate['free_shipping_eligible'] ?? true);
        $is_free = $free_eligible && (
            $promotion_active
            || (float) $subtotal >= $minimum
            || $coupon_free_shipping
        );

        if ($is_free) {
            $title = $promotion_active
                ? 'Free Shipping (Limited-Time Promotion)'
                : ($coupon_free_shipping
                    ? 'Free Shipping (Coupon)'
                    : 'Free Shipping (Orders Over $200)');

            return [
                'id'               => 'free_shipping',
                'selected_id'      => $method_id,
                'title'            => $title,
                'cost'             => 0.0,
                'promotion_active' => $promotion_active,
            ];
        }

        return [
            'id'               => $method_id,
            'selected_id'      => $method_id,
            'title'            => self::clean_string($rate['title'] ?? 'Shipping'),
            'cost'             => max(0, (float) ($rate['cost'] ?? 0)),
            'promotion_active' => $promotion_active,
        ];
    }

    public static function create_order(WP_REST_Request $request) {
        if (! class_exists('WooCommerce') || ! function_exists('wc_create_order')) {
            return new WP_Error(
                'woocommerce_missing',
                'WooCommerce is not active or unavailable.',
                ['status' => 500]
            );
        }

        $body  = self::get_request_json($request);
        $items = $body['items'] ?? $body['cart'] ?? [];

        if (! is_array($items) || empty($items)) {
            return new WP_Error(
                'rgvprime_missing_items',
                'No cart items were provided.',
                ['status' => 400]
            );
        }

        $billing_source  = $body['billing'] ?? $body['billingAddress'] ?? $body['customer'] ?? [];
        $shipping_source = $body['shipping'] ?? $body['shippingAddress'] ?? $billing_source;

        $billing  = self::normalize_address($billing_source);
        $shipping = self::normalize_address($shipping_source);

        if (empty($billing['email']) || ! is_email($billing['email'])) {
            return new WP_Error(
                'rgvprime_invalid_email',
                'A valid billing email is required.',
                ['status' => 400]
            );
        }

        try {
            $order = wc_create_order([
                'created_via' => 'rgvprime_custom_checkout',
            ]);

            foreach ($items as $item) {
                if (! is_array($item)) {
                    continue;
                }

                $product_id  = absint($item['productId'] ?? $item['product_id'] ?? $item['id'] ?? 0);
                $variation_id = absint($item['variationId'] ?? $item['variation_id'] ?? $item['selectedVariationId'] ?? 0);
                $quantity     = max(1, absint($item['quantity'] ?? $item['qty'] ?? 1));
                $variation_data = [];

                if (! empty($item['variation']) && is_array($item['variation'])) {
                    $variation_data = array_map('sanitize_text_field', $item['variation']);
                } elseif (! empty($item['variation_attributes']) && is_array($item['variation_attributes'])) {
                    $variation_data = array_map('sanitize_text_field', $item['variation_attributes']);
                } elseif (! empty($item['selectedAttributes']) && is_array($item['selectedAttributes'])) {
                    foreach ($item['selectedAttributes'] as $key => $value) {
                        $variation_data['attribute_' . sanitize_title($key)] = sanitize_text_field($value);
                    }
                }

                $target_id = $variation_id ?: $product_id;
                $product   = $target_id ? wc_get_product($target_id) : false;

                if (! $product) {
                    throw new Exception('Invalid product in cart. Product ID: ' . $target_id);
                }

                $order->add_product($product, $quantity, [
                    'variation_id' => $variation_id,
                    'variation'    => $variation_data,
                ]);
            }

            $order->set_address($billing, 'billing');
            $order->set_address($shipping, 'shipping');
            $order->set_customer_note(self::clean_string($body['customerNote'] ?? $body['note'] ?? ''));

            $coupon_code = wc_format_coupon_code(self::clean_string(
                $body['couponCode'] ?? $body['coupon'] ?? ''
            ));
            $coupon_free_shipping = false;

            if ($coupon_code) {
                $coupon = new WC_Coupon($coupon_code);
                $coupon_result = $order->apply_coupon($coupon_code);

                if (is_wp_error($coupon_result)) {
                    throw new Exception($coupon_result->get_error_message());
                }

                $coupon_free_shipping = (bool) $coupon->get_free_shipping();
            }

            $subtotal = (float) $order->get_subtotal();
            $shipping = self::shipping_details($body, $subtotal, $coupon_free_shipping);
            $shipping_total = (float) $shipping['cost'];
            $shipping_item = new WC_Order_Item_Shipping();
            $shipping_item->set_method_title($shipping['title']);
            $shipping_item->set_method_id($shipping['id']);
            $shipping_item->set_total($shipping_total);
            $order->add_item($shipping_item);

            self::add_transition_meta($order, '_rgvprime_shipping_method_id', '_phase_shipping_method_id', $shipping['id']);
            self::add_transition_meta($order, '_rgvprime_shipping_selected_method_id', '_phase_shipping_selected_method_id', $shipping['selected_id']);
            self::add_transition_meta($order, '_rgvprime_shipping_method_title', '_phase_shipping_method_title', $shipping['title']);
            self::add_transition_meta($order, '_rgvprime_shipping_total', '_phase_shipping_total', $shipping_total);
            $order->update_meta_data(
                '_rgvprime_free_shipping_promotion',
                $shipping['promotion_active'] && 0.0 === $shipping_total ? 'yes' : 'no'
            );

            $gateway_id = self::clean_string(
                $body['paymentMethod']
                ?? $body['gatewayId']
                ?? self::DEFAULT_GATEWAY_ID
            );

            $gateway = self::get_gateway($gateway_id);

            if (! $gateway) {
                throw new Exception('Payment gateway not found: ' . $gateway_id);
            }

            $order->set_payment_method($gateway);
            $order->set_payment_method_title(
                method_exists($gateway, 'get_title')
                    ? $gateway->get_title()
                    : ($gateway->title ?? 'Bank Transfer')
            );

            self::add_transition_meta($order, '_rgvprime_checkout_source', '_phase_checkout_source', 'custom_frontend');
            self::add_transition_meta($order, '_rgvprime_payment_gateway_id', '_phase_payment_gateway_id', $gateway_id);

            $checkout_return_url = esc_url_raw(self::FRONTEND_CHECKOUT_URL);

            /**
             * New RGVPRIME keys plus the previous Phase One keys.
             * Both plugins can communicate during the transition.
             */
            $order->update_meta_data('_rgvprime_checkout_return_url', $checkout_return_url);
            $order->update_meta_data('_rgvprime_return_url', $checkout_return_url);
            $order->update_meta_data('_rgvprime_checkout_url', $checkout_return_url);

            $order->update_meta_data('_phaseone_checkout_return_url', $checkout_return_url);
            $order->update_meta_data('_phaseone_return_url', $checkout_return_url);
            $order->update_meta_data('_phaseone_checkout_url', $checkout_return_url);
            $order->update_meta_data('_phase_checkout_return_url', $checkout_return_url);

            if (! empty($body['source'])) {
                $source = self::clean_string($body['source']);
                self::add_transition_meta($order, '_rgvprime_source', '_phase_source', $source);
            }

            $order->calculate_totals();
            $order->save();

            $fallback_payment_url = $order->get_checkout_payment_url();
            $gateway_result       = null;
            $gateway_redirect_url = '';
            $gateway_result_type  = '';

            if (method_exists($gateway, 'process_payment')) {
                $gateway_result = $gateway->process_payment($order->get_id());

                if (is_array($gateway_result)) {
                    $gateway_result_type = isset($gateway_result['result'])
                        ? (string) $gateway_result['result']
                        : '';

                    $gateway_redirect_url = isset($gateway_result['redirect'])
                        ? esc_url_raw((string) $gateway_result['redirect'])
                        : '';
                }
            }

            $final_redirect_url  = $gateway_redirect_url ?: $fallback_payment_url;
            $final_redirect_path = '';

            if ($final_redirect_url) {
                $parsed = wp_parse_url($final_redirect_url);
                $final_redirect_path = isset($parsed['path']) ? (string) $parsed['path'] : '';
            }

            $is_woocommerce_order_pay = $final_redirect_path && (
                strpos($final_redirect_path, '/checkout/order-pay/') !== false
                || strpos($final_redirect_path, '/order-pay/') !== false
            );

            $is_direct_gateway_redirect = (bool) (
                $gateway_redirect_url
                && ! $is_woocommerce_order_pay
            );

            $encoded_gateway_result = is_array($gateway_result)
                ? wp_json_encode($gateway_result)
                : '';

            self::add_transition_meta($order, '_rgvprime_gateway_process_result', '_phase_gateway_process_result', $encoded_gateway_result);
            self::add_transition_meta($order, '_rgvprime_gateway_redirect_url', '_phase_gateway_redirect_url', $gateway_redirect_url);
            self::add_transition_meta($order, '_rgvprime_direct_gateway_redirect', '_phase_direct_gateway_redirect', $is_direct_gateway_redirect ? 'yes' : 'no');
            $order->save();

            return rest_ensure_response([
                'success'                 => true,
                'version'                 => self::VERSION,
                'orderId'                 => $order->get_id(),
                'orderNumber'             => $order->get_order_number(),
                'status'                  => $order->get_status(),
                'paymentMethod'           => $gateway_id,
                'paymentTitle'            => $order->get_payment_method_title(),
                'gatewayResult'           => $gateway_result_type,
                'gatewayRedirectUrl'      => $gateway_redirect_url,
                'isDirectGatewayRedirect' => $is_direct_gateway_redirect,
                'redirectUrl'             => $final_redirect_url,
                'paymentUrl'              => $fallback_payment_url,
                'shippingMethodId'        => $shipping['id'],
                'shippingMethodTitle'     => $shipping['title'],
                'shippingTotal'           => $shipping_total,
                'freeShippingPromotion'   => $shipping['promotion_active'] && 0.0 === $shipping_total,
                'orderTotal'              => $order->get_total(),
                'orderKey'                => $order->get_order_key(),
                'checkoutReturnUrl'       => $checkout_return_url,
                'message'                 => $is_direct_gateway_redirect
                    ? 'Direct hosted gateway redirect generated.'
                    : 'Gateway did not return a direct hosted redirect. Fallback is WooCommerce order-pay URL.',
            ]);
        } catch (Throwable $e) {
            return new WP_Error(
                'rgvprime_create_order_failed',
                $e->getMessage(),
                ['status' => 500]
            );
        }
    }
}

RGVPRIME_Edebit_Order_Endpoint::init();
