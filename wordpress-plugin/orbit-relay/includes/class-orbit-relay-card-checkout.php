<?php

defined( 'ABSPATH' ) || exit;

final class ORBIT_Relay_Card_Checkout {
    private static string $request_id = '';
    private const REQUEST_LOCK_TTL = 180;
    private const REQUEST_RESULT_TTL = 600;
    private const RATE_LIMIT_WINDOW = 600;
    private const RATE_LIMIT_MAX_REQUESTS = 30;
    private const MAX_ORDER_ITEMS = 50;
    private const MAX_ITEM_QUANTITY = 100;
    private const FREE_SHIPPING_MINIMUM = 200.0;
    private const SHIPPING_RATES = array(
        'ups_2_day_air' => array(
            'title' => 'UPS Shipping',
            'cost'  => 15.0,
        ),
        'usps_ground_advantage' => array(
            'title' => 'USPS Ground',
            'cost'  => 8.0,
        ),
        'usps_priority' => array(
            'title' => 'USPS Priority Mail',
            'cost'  => 12.0,
        ),
    );

    public static function init(): void {
        add_filter( 'rest_pre_serve_request', array( __CLASS__, 'send_cors_headers' ), 10, 4 );
    }

    private static function start_request(): void {
        self::$request_id = function_exists( 'wp_generate_uuid4' ) ? wp_generate_uuid4() : bin2hex( random_bytes( 16 ) );
    }

    public static function authorize( WP_REST_Request $request ) {
        unset( $request );

        $origin = isset( $_SERVER['HTTP_ORIGIN'] )
            ? sanitize_url( wp_unslash( $_SERVER['HTTP_ORIGIN'] ) )
            : '';

        if ( $origin && self::is_allowed_origin( $origin ) ) {
            return true;
        }

        $referer = isset( $_SERVER['HTTP_REFERER'] )
            ? sanitize_url( wp_unslash( $_SERVER['HTTP_REFERER'] ) )
            : '';

        if ( $referer && self::is_allowed_origin( $referer ) ) {
            return true;
        }

        return new WP_Error(
            'orbit_card_checkout_origin_rejected',
            'Secure card checkout must be started from the configured storefront.',
            array( 'status' => 403 )
        );
    }

    public static function send_cors_headers( $served, $result, $request, $server ) {
        unset( $result, $server );

        if ( ! $request instanceof WP_REST_Request || ! in_array( $request->get_route(), array( '/orbit/v1/card-quote', '/orbit/v1/card-checkout' ), true ) ) {
            return $served;
        }

        $origin = isset( $_SERVER['HTTP_ORIGIN'] )
            ? sanitize_url( wp_unslash( $_SERVER['HTTP_ORIGIN'] ) )
            : '';

        if ( $origin && self::is_allowed_origin( $origin ) ) {
            header( 'Access-Control-Allow-Origin: ' . $origin );
            header( 'Access-Control-Allow-Credentials: true' );
            header( 'Access-Control-Allow-Methods: POST, OPTIONS' );
            header( 'Access-Control-Allow-Headers: Content-Type' );
            header( 'Vary: Origin', false );
        }

        return $served;
    }

    public static function quote( WP_REST_Request $request ) {
        self::start_request();
        if ( ! headers_sent() ) {
            nocache_headers();
        }
        if ( ! ORBIT_Relay::is_woocommerce_available() ) {
            return self::response( false, 'Checkout is temporarily unavailable.', 503 );
        }
        if ( false === strpos( strtolower( (string) $request->get_header( 'content-type' ) ), 'application/json' ) ) {
            return self::response( false, 'Invalid checkout request format.', 415 );
        }
        $rate_limit = self::enforce_rate_limit( 'quote', 60 );
        if ( is_wp_error( $rate_limit ) ) {
            return self::response( false, $rate_limit->get_error_message(), 429 );
        }

        $data = $request->get_json_params();
        $data = is_array( $data ) ? $data : array();
        $items = isset( $data['items'] ) && is_array( $data['items'] ) ? $data['items'] : array();
        $billing = isset( $data['billing'] ) && is_array( $data['billing'] ) ? $data['billing'] : array();
        $shipping = isset( $data['shipping'] ) && is_array( $data['shipping'] ) ? $data['shipping'] : $billing;
        $validation = self::validate_items( $items );
        if ( is_wp_error( $validation ) ) {
            return self::response( false, $validation->get_error_message(), 400 );
        }

        try {
            $order = self::build_quote_order( $data, $items, $billing, $shipping );
            $expires_at = time() + 600;
            $configuration = self::orbit_checkout_configuration();
            if ( is_wp_error( $configuration ) ) {
                return self::response( false, $configuration->get_error_message(), 503 );
            }
            return self::response( true, '', 200, array_merge(
                self::quote_payload( $order, $data, $items, $expires_at ),
                $configuration
            ) );
        } catch ( Throwable $error ) {
            ORBIT_Relay_Logger::log(
                'ORBIT_CARD_QUOTE_EXCEPTION',
                '',
                array(
                    'exception_class'   => get_class( $error ),
                    'exception_message' => self::safe_exception_message( $error ),
                    'exception_code'    => $error->getCode(),
                    'file'              => wp_basename( wp_normalize_path( $error->getFile() ) ),
                    'line'              => $error->getLine(),
                ),
                'error'
            );

            return self::response( false, 'Unable to calculate the current checkout total.', 400 );
        }
    }

    public static function handle( WP_REST_Request $request ) {
        self::start_request();
        if ( ! headers_sent() ) {
            nocache_headers();
        }

        if ( ! ORBIT_Relay::is_woocommerce_available() || ! function_exists( 'wc_create_order' ) ) {
            return self::response( false, 'WooCommerce is not available.', 503 );
        }

        if ( ! ORBIT_Relay::enabled() ) {
            return self::response( false, 'ORBIT Relay is disabled.', 503 );
        }

        if ( false === strpos( strtolower( (string) $request->get_header( 'content-type' ) ), 'application/json' ) ) {
            return self::response( false, 'Invalid checkout request format.', 415 );
        }

        $rate_limit = self::enforce_rate_limit();
        if ( is_wp_error( $rate_limit ) ) {
            return self::response( false, $rate_limit->get_error_message(), 429 );
        }

        $data = $request->get_json_params();
        $data = is_array( $data ) ? $data : array();
        $items = isset( $data['items'] ) && is_array( $data['items'] ) ? $data['items'] : array();
        $billing = isset( $data['billing'] ) && is_array( $data['billing'] ) ? $data['billing'] : array();
        $shipping = isset( $data['shipping'] ) && is_array( $data['shipping'] ) ? $data['shipping'] : $billing;
        $validation = self::validate_order_payload( $items, $billing, $shipping );

        if ( is_wp_error( $validation ) ) {
            return self::response( false, $validation->get_error_message(), 400, array( 'errorCode' => $validation->get_error_code() ) );
        }

        $compliance = self::validate_compliance( $data );
        if ( is_wp_error( $compliance ) ) {
            return self::response( false, $compliance->get_error_message(), 400, array( 'errorCode' => $compliance->get_error_code() ) );
        }

        $confirmation_token_id = sanitize_text_field( (string) ( $data['confirmationTokenId'] ?? '' ) );
        $checkout_attempt_id = sanitize_text_field( (string) ( $data['checkoutAttemptId'] ?? '' ) );
        $quote_id = sanitize_text_field( (string) ( $data['quoteId'] ?? '' ) );
        $quote_expires_at = absint( $data['quoteExpiresAt'] ?? 0 );
        if (
            ! preg_match( '/^ctoken_[A-Za-z0-9_]{8,200}$/', $confirmation_token_id ) ||
            ! preg_match( '/^[A-Za-z0-9_-]{16,128}$/', $checkout_attempt_id ) ||
            ! preg_match( '/^orb_quote_[a-f0-9]{32}$/', $quote_id ) ||
            $quote_expires_at <= time() ||
            $quote_expires_at > time() + 900
        ) {
            return self::response( false, 'The secure checkout session is invalid or expired. Refresh and try again.', 400 );
        }

        try {
            $current_quote_order = self::build_quote_order( $data, $items, $billing, $shipping );
            $current_quote = self::quote_payload( $current_quote_order, $data, $items, $quote_expires_at );
            if ( ! hash_equals( $current_quote['quoteId'], $quote_id ) ) {
                return self::response( false, 'Your order total changed. Review the updated checkout before paying.', 409, array( 'quoteChanged' => true ) );
            }
        } catch ( Throwable $error ) {
            ORBIT_Relay_Logger::log(
                'ORBIT_CARD_REVALIDATION_EXCEPTION',
                '',
                array(
                    'request_id'       => self::$request_id,
                    'exception_class'  => get_class( $error ),
                    'exception_message'=> self::safe_exception_message( $error ),
                ),
                'error'
            );
            return self::response( false, 'Unable to revalidate the current checkout total.', 400, array( 'errorCode' => 'quote_revalidation_failed' ) );
        }

        $request_key = self::build_request_key( $data, $items, $billing, $shipping );
        $option_name = '_orbit_card_req_' . substr( $request_key, 0, 40 );
        $claim = self::claim_request( $option_name );
        $owns_lock = ! empty( $claim['acquired'] );
        $order = null;

        if ( ! $owns_lock ) {
            $order = self::existing_request_order( $option_name, true );

            if ( ! $order ) {
                return self::response(
                    false,
                    'Your card order is already being prepared. Please do not press Pay again.',
                    409,
                    array( 'processing' => true )
                );
            }

            $stored_key = (string) $order->get_meta( '_orbit_card_checkout_request_key', true );
            $stored_total_minor = ORBIT_Relay_Orders::decimal_to_minor( (string) $order->get_total(), strtoupper( (string) $order->get_currency() ) );
            if ( ! hash_equals( $request_key, $stored_key ) || $order->is_paid() || ! $order->needs_payment() || $stored_total_minor !== (int) $current_quote['totalMinor'] ) {
                return self::response( false, 'The previous payment session no longer matches this checkout. Refresh and try again.', 409, array( 'errorCode' => 'stale_checkout_order' ) );
            }
        }

        try {
            if ( ! $order ) {
                $order = wc_create_order();
                $order = self::populate_pending_order( $order, $data, $items, $billing, $shipping, $request_key );
                $prepared_total_minor = ORBIT_Relay_Orders::decimal_to_minor( (string) $order->get_total(), strtoupper( (string) $order->get_currency() ) );
                if ( $prepared_total_minor !== (int) $current_quote['totalMinor'] ) {
                    throw new RuntimeException( 'The persisted order total did not match the signed checkout quote.' );
                }
                self::complete_request( $option_name, $order->get_id() );
            }
        } catch ( Throwable $error ) {
            if ( $owns_lock ) {
                delete_option( $option_name );
            }

            if ( $order instanceof WC_Order && $order->get_id() ) {
                ORBIT_Relay_Coupon_Guard::release_card_checkout_claim(
                    (string) $order->get_meta( '_orbit_coupon_claim_option', true ),
                    $order->get_id()
                );
                $order->update_status( 'failed', 'ORBIT card checkout preparation failed before payment.' );
            }

            ORBIT_Relay_Logger::log(
                'ORBIT_CARD_CHECKOUT_ERROR',
                $error->getMessage(),
                array( 'order_id' => $order instanceof WC_Order ? $order->get_id() : 0, 'request_id' => self::$request_id ),
                'error'
            );

            return self::response( false, 'Unable to prepare the WooCommerce card order.', 500 );
        }

        try {
            return self::prepare_orbit_payment( $order );
        } catch ( Throwable $error ) {
            ORBIT_Relay_Logger::log(
                'ORBIT_CARD_PAYMENT_PREPARE_ERROR',
                $error->getMessage(),
                array( 'order_id' => $order->get_id(), 'request_id' => self::$request_id ),
                'error'
            );
            return self::response( false, 'ORBIT card payment is temporarily unavailable. Please try again.', 503 );
        }
    }

    private static function populate_pending_order( WC_Order $order, array $data, array $items, array $billing, array $shipping, string $request_key ): WC_Order {
        $order->set_address( self::clean_address( $billing ), 'billing' );
        $order->set_address( self::clean_address( $shipping ), 'shipping' );
        $order->set_payment_method( 'orbit_card' );
        $order->set_payment_method_title( 'Card via ORBIT / Stripe' );
        $order->set_created_via( 'orbit_relay_card_checkout' );
        $order->update_meta_data( '_orbit_payment_source', 'rgv_custom_checkout_orbit_card' );
        $order->update_meta_data( '_orbit_policy_acknowledged_at', current_time( 'mysql', true ) );
        $order->update_meta_data( '_orbit_policy_version', 'rgv-checkout-compliance-v1' );
        $order->update_meta_data( '_orbit_age_confirmed', 'yes' );
        $order->update_meta_data( '_orbit_research_use_acknowledged', 'yes' );
        $order->update_meta_data( '_orbit_terms_accepted', 'yes' );
        $order->update_meta_data( '_orbit_refund_policy_accepted', 'yes' );
        $order->update_meta_data( '_orbit_final_sale_policy_accepted', 'yes' );
        $order->update_meta_data( '_orbit_card_checkout_request_key', $request_key );
        $order->update_meta_data( '_orbit_checkout_quote_id', sanitize_text_field( (string) ( $data['quoteId'] ?? '' ) ) );

        if ( is_user_logged_in() ) {
            $order->set_customer_id( get_current_user_id() );
        }

        $subtotal = 0.0;
        foreach ( $items as $item ) {
            $subtotal += self::add_order_item( $order, $item );
        }

        if ( $subtotal <= 0 ) {
            throw new RuntimeException( 'No valid order items were added.' );
        }

        $coupon_code = self::clean_coupon( $data['couponCode'] ?? $data['coupon'] ?? '' );
        $coupon_free_shipping = false;

        if ( $coupon_code ) {
            $coupon_claim = ORBIT_Relay_Coupon_Guard::claim_card_checkout( $coupon_code, (string) $order->get_billing_email(), $order->get_id() );
            if ( is_wp_error( $coupon_claim ) ) {
                throw new RuntimeException( $coupon_claim->get_error_message() );
            }
            if ( is_string( $coupon_claim ) ) {
                $order->update_meta_data( '_orbit_coupon_claim_option', $coupon_claim );
            }
            $coupon_result = $order->apply_coupon( $coupon_code );
            if ( is_wp_error( $coupon_result ) ) {
                throw new RuntimeException( $coupon_result->get_error_message() );
            }

            $coupon = new WC_Coupon( $coupon_code );
            $coupon_free_shipping = (bool) $coupon->get_free_shipping();
            $order->add_order_note( sprintf( 'Coupon %s was verified by WooCommerce for ORBIT card checkout.', $coupon_code ) );
        }

        $free_shipping_minimum = max(
            0,
            (float) apply_filters( 'orbit_relay_card_free_shipping_minimum', self::FREE_SHIPPING_MINIMUM )
        );
        $shipping_method = self::shipping_method(
            $data,
            $subtotal >= $free_shipping_minimum || $coupon_free_shipping
        );
        $shipping_item = new WC_Order_Item_Shipping();
        $shipping_item->set_method_title( $shipping_method['title'] );
        $shipping_item->set_method_id( $shipping_method['id'] );
        $shipping_item->set_total( $shipping_method['cost'] );
        $order->add_item( $shipping_item );
        $order->calculate_totals();

        if ( (float) $order->get_total() <= 0 ) {
            throw new RuntimeException( 'This order does not require a card payment.' );
        }

        $order->set_status( 'pending' );
        $order->save();

        if ( function_exists( 'wc_reserve_stock_for_order' ) ) {
            wc_reserve_stock_for_order( $order );
        }

        return $order;
    }

    private static function prepare_orbit_payment( WC_Order $order ): WP_REST_Response {
        $api_url = ORBIT_Relay::api_url();
        $merchant_id = ORBIT_Relay::merchant_id();
        $signing_secret = ORBIT_Relay::signing_secret();
        $parts = wp_parse_url( $api_url );
        $scheme = strtolower( (string) ( $parts['scheme'] ?? '' ) );
        $host = strtolower( (string) ( $parts['host'] ?? '' ) );
        $is_local = in_array( $host, array( 'localhost', '127.0.0.1', '::1' ), true );

        if (
            ! $merchant_id ||
            ! $signing_secret ||
            ! $host ||
            ( 'https' !== $scheme && ! ( 'http' === $scheme && $is_local ) )
        ) {
            return self::response( false, 'ORBIT Relay card checkout is not configured.', 503 );
        }

        $token_payload = array(
            'v'          => 1,
            'merchantId' => $merchant_id,
            'wooOrderId' => $order->get_id(),
            'quoteId'    => (string) $order->get_meta( '_orbit_checkout_quote_id', true ),
            'amountMinor'=> ORBIT_Relay_Orders::decimal_to_minor( (string) $order->get_total(), strtoupper( (string) $order->get_currency() ) ),
            'currency'   => strtoupper( (string) $order->get_currency() ),
            'exp'        => time() + 600,
            'nonce'      => self::base64url_encode( random_bytes( 24 ) ),
        );
        $encoded_payload = self::base64url_encode( wp_json_encode( $token_payload ) );
        $checkout_token = $encoded_payload . '.' . hash_hmac( 'sha256', $encoded_payload, $signing_secret );
        $response = wp_remote_post(
            $api_url . '/api/payments/checkout',
            array(
                'timeout'     => 25,
                'redirection' => 0,
                'sslverify'   => ! $is_local,
                'headers'     => array(
                    'Content-Type' => 'application/json',
                    'Accept'       => 'application/json',
                ),
                'body'        => wp_json_encode( array( 'checkoutToken' => $checkout_token ) ),
                'data_format' => 'body',
            )
        );

        if ( is_wp_error( $response ) ) {
            ORBIT_Relay_Logger::log(
                'ORBIT_CARD_CHECKOUT_TRANSPORT_ERROR',
                'WordPress could not reach ORBIT /api/payments/checkout.',
                array(
                    'request_id'       => self::$request_id,
                    'woo_order_id'     => $order->get_id(),
                    'wp_error_code'    => sanitize_key( (string) $response->get_error_code() ),
                    'wp_error_message' => self::safe_upstream_log_field( $response->get_error_message() ),
                ),
                'error'
            );
            return self::response( false, 'The payment service could not be reached. Please try again.', 503, array( 'errorCode' => 'orbit_transport_error' ) );
        }

        $status = (int) wp_remote_retrieve_response_code( $response );
        $body = json_decode( (string) wp_remote_retrieve_body( $response ), true );

        if ( $status < 200 || $status >= 300 ) {
            $error_data = is_array( $body ) ? $body : array();
            $nested_error = isset( $error_data['error'] ) && is_array( $error_data['error'] )
                ? $error_data['error']
                : array();
            $context = array(
                'http_status'  => $status,
                'woo_order_id' => $order->get_id(),
                'request_id'   => self::$request_id,
            );
            $error_value = is_scalar( $error_data['error'] ?? null ) ? $error_data['error'] : null;
            $code_value = $error_data['code'] ?? $nested_error['code'] ?? null;
            $message_value = $error_data['message'] ?? $nested_error['message'] ?? null;

            foreach ( array( 'error' => $error_value, 'code' => $code_value, 'message' => $message_value ) as $key => $value ) {
                if ( is_scalar( $value ) && '' !== trim( (string) $value ) ) {
                    $context[ $key ] = self::safe_orbit_error_value( (string) $value );
                }
            }

            ORBIT_Relay_Logger::log(
                'ORBIT_CARD_CHECKOUT_HTTP_ERROR',
                'ORBIT /api/payments/checkout returned a non-success response.',
                $context,
                'error'
            );
        }

        if ( $status >= 200 && $status < 300 && ! is_array( $body ) ) {
            ORBIT_Relay_Logger::log(
                'ORBIT_CARD_CHECKOUT_INVALID_JSON',
                'ORBIT returned a non-JSON success response.',
                array( 'http_status' => $status, 'woo_order_id' => $order->get_id(), 'request_id' => self::$request_id ),
                'error'
            );
        }

        if ( $status < 200 || $status >= 300 || ! is_array( $body ) ) {
            $upstream_message = is_array( $body ) ? sanitize_text_field( (string) ( $body['message'] ?? $body['error'] ?? '' ) ) : '';
            return self::response(
                false,
                $upstream_message ?: ( 409 === $status
                    ? 'This payment session is no longer valid. Refresh checkout and try again.'
                    : 'ORBIT could not prepare the secure card payment. Please try again.' ),
                in_array( $status, array( 400, 409, 422, 429, 503 ), true ) ? $status : 502,
                array(
                    'errorCode' => sanitize_key( (string) ( is_array( $body ) ? ( $body['code'] ?? 'orbit_upstream_error' ) : 'orbit_invalid_response' ) ),
                    'requestId' => sanitize_text_field( (string) ( is_array( $body ) ? ( $body['requestId'] ?? self::$request_id ) : self::$request_id ) ),
                )
            );
        }

        $transaction_id = sanitize_text_field( (string) ( $body['orbitTransactionId'] ?? '' ) );
        $client_secret = sanitize_text_field( (string) ( $body['clientSecret'] ?? '' ) );
        $connected_account_id = sanitize_text_field( (string) ( $body['connectedAccountId'] ?? '' ) );
        $publishable_key = sanitize_text_field( (string) ( $body['publishableKey'] ?? '' ) );
        $payment_method_configuration_id = sanitize_text_field( (string) ( $body['paymentMethodConfigurationId'] ?? '' ) );

        if (
            ! preg_match( '/^orb_tx_[A-Za-z0-9_-]+$/', $transaction_id ) ||
            ! preg_match( '/^pi_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+$/', $client_secret ) ||
            ! preg_match( '/^acct_[A-Za-z0-9]+$/', $connected_account_id ) ||
            ! preg_match( '/^pk_(test|live)_[A-Za-z0-9]+$/', $publishable_key ) ||
            ! preg_match( '/^pmc_[A-Za-z0-9]+$/', $payment_method_configuration_id )
        ) {
            ORBIT_Relay_Logger::log( 'ORBIT_CARD_CHECKOUT_INVALID_CONFIGURATION', '', array( 'woo_order_id' => $order->get_id(), 'request_id' => self::$request_id ), 'error' );
            return self::response( false, 'ORBIT returned an invalid card payment configuration.', 502 );
        }

        $order->update_meta_data( '_orbit_transaction_id', $transaction_id );
        $order->update_meta_data( '_orbit_card_checkout_prepared_at', gmdate( 'c' ) );
        $order->save();

        ORBIT_Relay::touch_sync();
        ORBIT_Relay_Logger::log(
            'ORBIT_CARD_CHECKOUT_PREPARED',
            'ORBIT card checkout prepared.',
            array(
                'order_id'       => $order->get_id(),
                'transaction_id' => $transaction_id,
            )
        );

        return self::response(
            true,
            '',
            200,
            array(
                'orbitTransactionId' => $transaction_id,
                'clientSecret'       => $client_secret,
                'connectedAccountId' => $connected_account_id,
                'publishableKey'     => $publishable_key,
                'paymentMethodConfigurationId' => $payment_method_configuration_id,
                'orderId'            => $order->get_id(),
                'orderNumber'        => $order->get_order_number(),
                'total'              => (string) $order->get_total(),
                'currency'           => strtoupper( (string) $order->get_currency() ),
            )
        );
    }

    private static function validate_order_payload( array $items, array $billing, array $shipping ) {
        $items_validation = self::validate_items( $items );
        if ( is_wp_error( $items_validation ) ) return $items_validation;

        $required = array(
            'first_name' => 'First name',
            'last_name'  => 'Last name',
            'email'      => 'Email',
            'phone'      => 'Phone',
            'address_1'  => 'Address',
            'city'       => 'City',
            'state'      => 'State',
            'postcode'   => 'ZIP',
            'country'    => 'Country',
        );

        foreach ( $required as $key => $label ) {
            if ( empty( $shipping[ $key ] ) && empty( $billing[ $key ] ) ) {
                return new WP_Error( 'orbit_card_missing_field', $label . ' is required.' );
            }
        }

        $email = sanitize_email( $billing['email'] ?? $shipping['email'] ?? '' );
        if ( ! $email || ! is_email( $email ) ) {
            return new WP_Error( 'orbit_card_invalid_email', 'A valid email is required.' );
        }

        return true;
    }

    private static function validate_compliance( array $data ) {
        $required = array(
            'ageConfirmed',
            'researchUseAcknowledged',
            'termsAccepted',
            'refundPolicyAccepted',
            'finalSalePolicyAccepted',
            'researchUsePolicyAccepted',
        );

        foreach ( $required as $field ) {
            if ( true !== ( $data[ $field ] ?? null ) ) {
                return new WP_Error( 'orbit_compliance_required', 'All required age, research-use, terms, and final-sale acknowledgements must be accepted.' );
            }
        }

        return true;
    }

    private static function validate_items( array $items ) {
        if ( empty( $items ) ) return new WP_Error( 'orbit_card_empty_items', 'No valid cart items were received.' );
        if ( count( $items ) > self::MAX_ORDER_ITEMS ) return new WP_Error( 'orbit_card_too_many_items', 'Too many cart items were received.' );
        foreach ( $items as $item ) {
            if ( ! is_array( $item ) ) {
                return new WP_Error( 'orbit_card_invalid_item', 'A cart item is invalid.' );
            }

            $quantity = absint( $item['quantity'] ?? 0 );
            if ( $quantity < 1 || $quantity > self::MAX_ITEM_QUANTITY ) {
                return new WP_Error( 'orbit_card_invalid_quantity', 'A cart item has an invalid quantity.' );
            }

            $stock = self::validate_stock( $item );
            if ( is_wp_error( $stock ) ) {
                return $stock;
            }
        }

        return true;
    }

    private static function build_quote_order( array $data, array $items, array $billing, array $shipping ): WC_Order {
        $order = new class() extends WC_Order {
            /**
             * Quote orders must never be written to a WooCommerce data store.
             * WooCommerce total/tax methods call save() internally.
             */
            public function save() {
                return 0;
            }

            /**
             * Apply WooCommerce's discount engine without persisting the quote,
             * recording coupon usage, or firing order-created side effects.
             *
             * @param WC_Coupon $coupon Coupon to validate and apply.
            * @return true|WP_Error
             */
            public function apply_quote_coupon( WC_Coupon $coupon ) {
                $discounts = new WC_Discounts( $this );
                $discount_items = array();
                foreach ( $this->get_items() as $item_key => $order_item ) {
                    $discount_item = new stdClass();
                    $discount_item->key = $item_key;
                    $discount_item->object = $order_item;
                    $discount_item->product = $order_item->get_product();
                    $discount_item->quantity = $order_item->get_quantity();
                    $discount_item->price = wc_add_number_precision_deep( $order_item->get_subtotal() );
                    if ( $this->get_prices_include_tax() ) {
                        $discount_item->price += wc_add_number_precision_deep( $order_item->get_subtotal_tax() );
                    }
                    $discount_items[ $item_key ] = $discount_item;
                }
                $discounts->set_items( $discount_items );
                $applied = $discounts->apply_coupon( $coupon );

                if ( is_wp_error( $applied ) ) {
                    return $applied;
                }

                $data_store = $coupon->get_data_store();
                if ( $data_store && 0 === $this->get_customer_id() ) {
                    $usage_count = $data_store->get_usage_by_email( $coupon, $this->get_billing_email() );
                    if ( 0 < $coupon->get_usage_limit_per_user() && $usage_count >= $coupon->get_usage_limit_per_user() ) {
                        return new WP_Error( 'invalid_coupon', $coupon->get_coupon_error( 106 ), array( 'status' => 400 ) );
                    }
                }

                $this->set_coupon_discount_amounts( $discounts );
                $this->set_item_discount_amounts( $discounts );

                return true;
            }
        };
        $order->set_currency( get_woocommerce_currency() );
        $order->set_prices_include_tax( wc_prices_include_tax() );
        $order->set_address( self::clean_address( $billing ), 'billing' );
        $order->set_address( self::clean_address( $shipping ), 'shipping' );
        if ( is_user_logged_in() ) {
            $order->set_customer_id( get_current_user_id() );
        }
        foreach ( $items as $item ) self::add_quote_item( $order, $item );
        $subtotal = (float) $order->get_subtotal();
        $coupon_code = self::clean_coupon( $data['couponCode'] ?? $data['coupon'] ?? '' );
        $coupon_free_shipping = false;
        if ( $coupon_code ) {
            $coupon = new WC_Coupon( $coupon_code );
            $coupon_result = $order->apply_quote_coupon( $coupon );
            if ( is_wp_error( $coupon_result ) ) throw new RuntimeException( $coupon_result->get_error_message() );
            $coupon_free_shipping = (bool) $coupon->get_free_shipping();
        }
        $free_shipping_minimum = max( 0, (float) apply_filters( 'orbit_relay_card_free_shipping_minimum', self::FREE_SHIPPING_MINIMUM ) );
        $shipping_method = self::shipping_method( $data, $subtotal >= $free_shipping_minimum || $coupon_free_shipping );
        $shipping_item = new WC_Order_Item_Shipping();
        $shipping_item->set_method_title( $shipping_method['title'] );
        $shipping_item->set_method_id( $shipping_method['id'] );
        $shipping_item->set_total( $shipping_method['cost'] );
        $order->add_item( $shipping_item );
        $order->calculate_totals();
        if ( $order->get_id() ) throw new RuntimeException( 'Checkout quote unexpectedly persisted an order.' );
        foreach ( $order->get_items( array( 'line_item', 'coupon', 'shipping', 'tax' ) ) as $order_item ) {
            if ( $order_item->get_id() ) throw new RuntimeException( 'Checkout quote unexpectedly persisted an order item.' );
        }
        if ( (float) $order->get_total() <= 0 ) throw new RuntimeException( 'This order does not require payment.' );
        return $order;
    }

    private static function quote_payload( WC_Order $order, array $data, array $items, int $expires_at ): array {
        $currency = strtoupper( (string) $order->get_currency() );
        $summary_items = array();
        foreach ( $order->get_items() as $item ) {
            if ( ! $item instanceof WC_Order_Item_Product ) continue;
            $summary_items[] = array(
                'name'       => wp_strip_all_tags( $item->get_name() ),
                'quantity'   => (int) $item->get_quantity(),
                'totalMinor' => ORBIT_Relay_Orders::decimal_to_minor( (string) $item->get_total(), $currency ),
            );
        }
        $identity = array(
            'items' => array_map( static fn( $item ) => array(
                'productId' => absint( $item['product_id'] ?? 0 ),
                'variationId' => absint( $item['variation_id'] ?? 0 ),
                'quantity' => absint( $item['quantity'] ?? 0 ),
            ), $items ),
            'coupon' => self::clean_coupon( $data['couponCode'] ?? $data['coupon'] ?? '' ),
            'shipping' => self::shipping_method( $data, (float) $order->get_shipping_total() <= 0 )['id'],
            'total' => (string) $order->get_total(),
            'currency' => $currency,
            'billing' => self::clean_address( isset( $data['billing'] ) && is_array( $data['billing'] ) ? $data['billing'] : array() ),
            'shippingAddress' => self::clean_address( isset( $data['shipping'] ) && is_array( $data['shipping'] ) ? $data['shipping'] : array() ),
            'expiresAt' => $expires_at,
        );
        return array(
            'quoteId' => 'orb_quote_' . substr( hash_hmac( 'sha256', wp_json_encode( $identity ), ORBIT_Relay::signing_secret() ), 0, 32 ),
            'quoteExpiresAt' => $expires_at,
            'currency' => $currency,
            'subtotalMinor' => ORBIT_Relay_Orders::decimal_to_minor( (string) $order->get_subtotal(), $currency ),
            'discountMinor' => ORBIT_Relay_Orders::decimal_to_minor( (string) $order->get_discount_total(), $currency ),
            'shippingMinor' => ORBIT_Relay_Orders::decimal_to_minor( (string) $order->get_shipping_total(), $currency ),
            'taxMinor' => ORBIT_Relay_Orders::decimal_to_minor( (string) $order->get_total_tax(), $currency ),
            'totalMinor' => ORBIT_Relay_Orders::decimal_to_minor( (string) $order->get_total(), $currency ),
            'items' => $summary_items,
        );
    }

    private static function orbit_checkout_configuration() {
        $api_url = ORBIT_Relay::api_url();
        $merchant_id = ORBIT_Relay::merchant_id();
        $secret = ORBIT_Relay::signing_secret();
        if ( ! $api_url || ! $merchant_id || ! $secret ) return new WP_Error( 'orbit_config_missing', 'Secure card payment is not configured.' );
        $payload = array( 'v' => 1, 'purpose' => 'checkout_config', 'merchantId' => $merchant_id, 'exp' => time() + 300, 'nonce' => self::base64url_encode( random_bytes( 24 ) ) );
        $encoded = self::base64url_encode( wp_json_encode( $payload ) );
        $config_token = $encoded . '.' . hash_hmac( 'sha256', $encoded, $secret );
        $response = wp_remote_post( $api_url . '/api/payments/config', array(
            'timeout' => 15,
            'redirection' => 0,
            'headers' => array( 'Content-Type' => 'application/json', 'Accept' => 'application/json' ),
            'body' => wp_json_encode( array( 'configToken' => $config_token ) ),
            'data_format' => 'body',
        ) );
        if ( is_wp_error( $response ) ) {
            $api_parts = wp_parse_url( $api_url );
            ORBIT_Relay_Logger::log(
                'ORBIT_CHECKOUT_CONFIG_HTTP_ERROR',
                '',
                array(
                    'wp_error_code'    => sanitize_key( (string) $response->get_error_code() ),
                    'wp_error_message' => self::safe_upstream_log_field( $response->get_error_message() ),
                    'orbit_api_host'   => sanitize_text_field( strtolower( (string) ( $api_parts['host'] ?? '' ) ) ),
                    'endpoint_path'    => '/api/payments/config',
                ),
                'error'
            );

            return new WP_Error( 'orbit_config_unavailable', 'Secure card payment is temporarily unavailable.' );
        }

        $http_status = (int) wp_remote_retrieve_response_code( $response );
        if ( $http_status < 200 || $http_status >= 300 ) {
            $upstream = json_decode( (string) wp_remote_retrieve_body( $response ), true );
            $log_context = array( 'http_status' => $http_status );
            if ( is_array( $upstream ) && isset( $upstream['error'] ) && is_scalar( $upstream['error'] ) ) {
                $log_context['error'] = self::safe_upstream_log_field( $upstream['error'] );
            }
            if ( is_array( $upstream ) && isset( $upstream['message'] ) && is_scalar( $upstream['message'] ) ) {
                $log_context['message'] = self::safe_upstream_log_field( $upstream['message'] );
            }
            ORBIT_Relay_Logger::log( 'ORBIT_CHECKOUT_CONFIG_UPSTREAM_ERROR', '', $log_context, 'error' );

            return new WP_Error( 'orbit_config_unavailable', 'Secure card payment is temporarily unavailable.' );
        }

        $body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
        $account = sanitize_text_field( (string) ( $body['connectedAccountId'] ?? '' ) );
        $key = sanitize_text_field( (string) ( $body['publishableKey'] ?? '' ) );
        $payment_method_configuration_id = sanitize_text_field( (string) ( $body['paymentMethodConfigurationId'] ?? '' ) );
        $has_connected_account = '' !== $account;
        $connected_account_format_valid = 1 === preg_match( '/^acct_[A-Za-z0-9]+$/', $account );
        $has_publishable_key = '' !== $key;
        $publishable_key_format_valid = 1 === preg_match( '/^pk_(test|live)_[A-Za-z0-9]+$/', $key );
        $payment_method_configuration_format_valid = 1 === preg_match( '/^pmc_[A-Za-z0-9]+$/', $payment_method_configuration_id );
        if ( ! $connected_account_format_valid || ! $publishable_key_format_valid || ! $payment_method_configuration_format_valid ) {
            ORBIT_Relay_Logger::log(
                'ORBIT_CHECKOUT_CONFIG_INVALID_RESPONSE',
                '',
                array(
                    'has_connected_account'           => $has_connected_account,
                    'connected_account_format_valid' => $connected_account_format_valid,
                    'has_publishable_key'             => $has_publishable_key,
                    'publishable_key_format_valid'    => $publishable_key_format_valid,
                    'payment_method_configuration_format_valid' => $payment_method_configuration_format_valid,
                ),
                'error'
            );

            return new WP_Error( 'orbit_config_invalid', 'Secure card payment is temporarily unavailable.' );
        }
        return array(
            'connectedAccountId' => $account,
            'publishableKey' => $key,
            'paymentMethodConfigurationId' => $payment_method_configuration_id,
        );
    }

    private static function product_from_item( array $item ) {
        $product_id = absint( $item['product_id'] ?? 0 );
        $variation_id = absint( $item['variation_id'] ?? 0 );

        if ( $variation_id > 0 ) {
            $variation = wc_get_product( $variation_id );
            if (
                $variation instanceof WC_Product &&
                $variation->is_type( 'variation' ) &&
                ( ! $product_id || (int) $variation->get_parent_id() === $product_id )
            ) {
                return $variation;
            }
            return null;
        }

        return $product_id > 0 ? wc_get_product( $product_id ) : null;
    }

    private static function validate_stock( array $item ) {
        $product = self::product_from_item( $item );
        $quantity = max( 1, absint( $item['quantity'] ?? 1 ) );

        if ( ! $product instanceof WC_Product || ! $product->exists() ) {
            return new WP_Error( 'orbit_card_product_not_found', 'A product in the cart could not be found.' );
        }

        $name = wp_strip_all_tags( $product->get_name() );
        if ( ! $product->is_purchasable() ) {
            return new WP_Error( 'orbit_card_product_unavailable', sprintf( '%s is no longer available for purchase.', $name ) );
        }
        if ( ! $product->is_in_stock() && ! $product->backorders_allowed() ) {
            return new WP_Error( 'orbit_card_product_sold_out', sprintf( '%s is sold out.', $name ) );
        }
        if ( ! $product->backorders_allowed() && ! $product->has_enough_stock( $quantity ) ) {
            return new WP_Error( 'orbit_card_insufficient_stock', sprintf( 'The requested quantity of %s is unavailable.', $name ) );
        }

        return true;
    }

    private static function add_order_item( WC_Order $order, array $item ): float {
        $stock = self::validate_stock( $item );
        if ( is_wp_error( $stock ) ) {
            throw new RuntimeException( $stock->get_error_message() );
        }

        $product = self::product_from_item( $item );
        $quantity = max( 1, absint( $item['quantity'] ?? 1 ) );
        $line_total = (float) wc_format_decimal( (float) $product->get_price() * $quantity );
        $order->add_product(
            $product,
            $quantity,
            array(
                'subtotal' => $line_total,
                'total'    => $line_total,
            )
        );

        return $line_total;
    }

    private static function add_quote_item( WC_Order $order, array $item ): float {
        $stock = self::validate_stock( $item );
        if ( is_wp_error( $stock ) ) {
            throw new RuntimeException( $stock->get_error_message() );
        }

        $product = self::product_from_item( $item );
        $quantity = max( 1, absint( $item['quantity'] ?? 1 ) );
        $line_total = (float) wc_format_decimal( (float) $product->get_price() * $quantity );
        $is_variation = $product->is_type( 'variation' );
        $order_item = new WC_Order_Item_Product();
        $order_item->set_props(
            array(
                'name'         => $product->get_name(),
                'tax_class'    => $product->get_tax_class(),
                'product_id'   => $is_variation ? $product->get_parent_id() : $product->get_id(),
                'variation_id' => $is_variation ? $product->get_id() : 0,
                'variation'    => $is_variation ? $product->get_attributes() : array(),
                'subtotal'     => $line_total,
                'total'        => $line_total,
                'quantity'     => $quantity,
            )
        );
        $order_item->set_backorder_meta();
        $order->add_item( $order_item );

        return $line_total;
    }

    private static function safe_exception_message( Throwable $error ): string {
        $message = sanitize_text_field( wp_strip_all_tags( $error->getMessage() ) );
        $message = preg_replace( '/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', '[redacted email]', $message );
        $message = preg_replace( '/\+?\d[\d\s().\-]{7,}\d/', '[redacted phone]', (string) $message );

        return substr( (string) $message, 0, 500 );
    }

    private static function safe_upstream_log_field( $value ): string {
        $message = sanitize_text_field( wp_strip_all_tags( (string) $value ) );
        $message = preg_replace( '/\b(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]+\b/i', '[redacted key]', $message );
        $message = preg_replace( '/\bacct_[A-Za-z0-9]+\b/i', '[redacted account]', (string) $message );
        $message = preg_replace( '/\bpi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+\b/i', '[redacted payment secret]', (string) $message );
        $message = preg_replace( '/\b(?:configToken|checkoutToken)\s*[:=]\s*\S+/i', '[redacted token]', (string) $message );

        return substr( (string) $message, 0, 500 );
    }

    private static function shipping_method( array $data, bool $is_free ): array {
        if ( $is_free ) {
            return array(
                'id'    => 'free_shipping',
                'title' => 'Free Shipping',
                'cost'  => 0.0,
            );
        }

        $rates = apply_filters( 'orbit_relay_card_shipping_rates', self::SHIPPING_RATES );
        $rates = is_array( $rates ) ? $rates : self::SHIPPING_RATES;
        $method = $data['shippingMethod'] ?? $data['shipping_method'] ?? '';
        if ( is_array( $method ) ) {
            $method = $method['id'] ?? $method['method_id'] ?? '';
        }
        $method_id = sanitize_key( (string) $method );

        if ( ! isset( $rates[ $method_id ] ) || ! is_array( $rates[ $method_id ] ) ) {
            $method_id = 'usps_ground_advantage';
        }

        $rate = isset( $rates[ $method_id ] ) && is_array( $rates[ $method_id ] )
            ? $rates[ $method_id ]
            : self::SHIPPING_RATES['usps_ground_advantage'];

        return array(
            'id'    => $method_id,
            'title' => sanitize_text_field( (string) ( $rate['title'] ?? 'Shipping' ) ),
            'cost'  => max( 0, (float) ( $rate['cost'] ?? 0 ) ),
        );
    }

    private static function clean_address( array $address ): array {
        return array(
            'first_name' => sanitize_text_field( $address['first_name'] ?? '' ),
            'last_name'  => sanitize_text_field( $address['last_name'] ?? '' ),
            'company'    => sanitize_text_field( $address['company'] ?? '' ),
            'email'      => sanitize_email( $address['email'] ?? '' ),
            'phone'      => sanitize_text_field( $address['phone'] ?? '' ),
            'address_1'  => sanitize_text_field( $address['address_1'] ?? '' ),
            'address_2'  => sanitize_text_field( $address['address_2'] ?? '' ),
            'city'       => sanitize_text_field( $address['city'] ?? '' ),
            'state'      => sanitize_text_field( $address['state'] ?? '' ),
            'postcode'   => sanitize_text_field( $address['postcode'] ?? '' ),
            'country'    => strtoupper( sanitize_text_field( $address['country'] ?? 'US' ) ),
        );
    }

    private static function clean_coupon( $coupon ): string {
        return preg_replace( '/[^A-Z0-9\-_]/', '', strtoupper( sanitize_text_field( (string) $coupon ) ) );
    }

    private static function build_request_key( array $data, array $items, array $billing, array $shipping ): string {
        $normalized_items = array();
        foreach ( $items as $item ) {
            $normalized_items[] = array(
                'product_id'   => absint( $item['product_id'] ?? 0 ),
                'variation_id' => absint( $item['variation_id'] ?? 0 ),
                'quantity'     => max( 1, absint( $item['quantity'] ?? 1 ) ),
            );
        }
        usort( $normalized_items, static fn( $left, $right ) => strcmp( wp_json_encode( $left ), wp_json_encode( $right ) ) );

        $method = $data['shippingMethod'] ?? $data['shipping_method'] ?? '';
        if ( is_array( $method ) ) {
            $method = $method['id'] ?? $method['method_id'] ?? '';
        }

        return hash(
            'sha256',
            wp_json_encode(
                array(
                    'billing'  => self::clean_address( $billing ),
                    'shippingAddress' => self::clean_address( $shipping ),
                    'coupon'   => self::clean_coupon( $data['couponCode'] ?? $data['coupon'] ?? '' ),
                    'shipping' => sanitize_key( (string) $method ),
                    'items'    => $normalized_items,
                    'attempt'  => sanitize_text_field( (string) ( $data['checkoutAttemptId'] ?? '' ) ),
                    'quoteId'  => sanitize_text_field( (string) ( $data['quoteId'] ?? '' ) ),
                    'quoteExpiresAt' => absint( $data['quoteExpiresAt'] ?? 0 ),
                )
            )
        );
    }

    public static function cleanup_expired_request_locks(): void {
        global $wpdb;

        foreach ( array( '_orbit_card_req_', '_orbit_coupon_claim_' ) as $prefix ) {
            $pattern = $wpdb->esc_like( $prefix ) . '%';
            $rows = $wpdb->get_results(
                $wpdb->prepare(
                    "SELECT option_name, option_value FROM {$wpdb->options} WHERE option_name LIKE %s LIMIT 500",
                    $pattern
                ),
                ARRAY_A
            );

            foreach ( is_array( $rows ) ? $rows : array() as $row ) {
                $state = maybe_unserialize( $row['option_value'] ?? '' );
                if ( is_array( $state ) && (int) ( $state['expires_at'] ?? 0 ) > 0 && (int) $state['expires_at'] <= time() ) {
                    delete_option( (string) $row['option_name'] );
                }
            }
        }
    }

    private static function claim_request( string $option_name ): array {
        $existing = get_option( $option_name, null );
        if ( is_array( $existing ) && (int) ( $existing['expires_at'] ?? 0 ) <= time() ) {
            delete_option( $option_name );
            $existing = null;
        }
        if ( is_array( $existing ) ) {
            return array( 'acquired' => false, 'state' => $existing );
        }

        $state = array(
            'status'     => 'processing',
            'order_id'   => 0,
            'expires_at' => time() + self::REQUEST_LOCK_TTL,
        );
        $acquired = add_option( $option_name, $state, '', 'no' );

        return array(
            'acquired' => $acquired,
            'state'    => $acquired ? $state : (array) get_option( $option_name, array() ),
        );
    }

    private static function existing_request_order( string $option_name, bool $wait ): ?WC_Order {
        $attempts = $wait ? 10 : 1;
        for ( $attempt = 0; $attempt < $attempts; $attempt++ ) {
            $state = (array) get_option( $option_name, array() );
            $order_id = absint( $state['order_id'] ?? 0 );
            if ( $order_id ) {
                $order = wc_get_order( $order_id );
                if ( $order instanceof WC_Order ) {
                    return $order;
                }
            }
            if ( $attempt + 1 < $attempts ) {
                usleep( 200000 );
            }
        }
        return null;
    }

    private static function complete_request( string $option_name, int $order_id ): void {
        update_option(
            $option_name,
            array(
                'status'     => 'completed',
                'order_id'   => $order_id,
                'expires_at' => time() + self::REQUEST_RESULT_TTL,
            ),
            false
        );
    }

    private static function enforce_rate_limit( string $bucket = 'checkout', int $maximum = self::RATE_LIMIT_MAX_REQUESTS ) {
        $ip = self::client_ip();
        $key = 'orbit_card_rate_' . sanitize_key( $bucket ) . '_' . substr( hash( 'sha256', $ip ), 0, 32 );
        $state = get_transient( $key );
        $state = is_array( $state ) ? $state : array( 'count' => 0, 'started_at' => time() );

        if ( (int) $state['started_at'] + self::RATE_LIMIT_WINDOW <= time() ) {
            $state = array( 'count' => 0, 'started_at' => time() );
        }
        if ( (int) $state['count'] >= $maximum ) {
            return new WP_Error( 'orbit_card_rate_limited', 'Too many requests. Please wait and try again.' );
        }

        $state['count']++;
        set_transient( $key, $state, self::RATE_LIMIT_WINDOW );
        return true;
    }

    private static function client_ip(): string {
        $candidates = array( $_SERVER['REMOTE_ADDR'] ?? '' );
        if ( true === apply_filters( 'orbit_relay_trust_cf_connecting_ip', false ) ) {
            array_unshift( $candidates, $_SERVER['HTTP_CF_CONNECTING_IP'] ?? '' );
        }
        foreach ( $candidates as $candidate ) {
            $candidate = trim( sanitize_text_field( wp_unslash( (string) $candidate ) ) );
            if ( $candidate && filter_var( $candidate, FILTER_VALIDATE_IP ) ) {
                return $candidate;
            }
        }
        return 'unknown';
    }

    private static function is_allowed_origin( string $origin ): bool {
        $host = strtolower( (string) wp_parse_url( $origin, PHP_URL_HOST ) );
        $allowed = (array) apply_filters(
            'orbit_relay_card_allowed_hosts',
            array( 'rgvprimellc.com', 'www.rgvprimellc.com', 'wp.rgvprimellc.com', 'localhost', '127.0.0.1', '::1', '[::1]' )
        );

        foreach ( $allowed as $allowed_host ) {
            $allowed_host = strtolower( trim( (string) $allowed_host ) );
            if (
                $allowed_host &&
                ( $host === $allowed_host || ( str_contains( $allowed_host, '.' ) && str_ends_with( $host, '.' . $allowed_host ) ) )
            ) {
                return true;
            }
        }
        return false;
    }

    private static function base64url_encode( string $value ): string {
        return rtrim( strtr( base64_encode( $value ), '+/', '-_' ), '=' );
    }

    private static function safe_orbit_error_value( string $value ): string {
        $value = sanitize_text_field( $value );
        $patterns = array(
            '/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9_]+\b/',
            '/\bwhsec_[A-Za-z0-9_]+\b/',
            '/\b(?:pi|seti|setup)_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+\b/',
            '/\borbsec_[A-Za-z0-9_-]+\b/',
            '/\b[A-Za-z0-9_-]{40,}\.[a-f0-9]{64}\b/',
        );

        return substr( (string) preg_replace( $patterns, '[REDACTED]', $value ), 0, 500 );
    }

    private static function response( bool $success, string $message, int $status, array $data = array() ): WP_REST_Response {
        $payload = array_merge( array( 'success' => $success, 'requestId' => self::$request_id ), $data );
        if ( '' !== $message ) {
            $payload['message'] = $message;
        }

        $response = new WP_REST_Response( $payload, $status );
        $response->header( 'Cache-Control', 'no-store, private' );
        $response->header( 'Referrer-Policy', 'no-referrer' );
        $response->header( 'X-ORBIT-Request-ID', self::$request_id );
        return $response;
    }
}
