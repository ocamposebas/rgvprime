<?php

defined( 'ABSPATH' ) || exit;

final class ORBIT_Relay_Hosted_Checkout {
    private const NAMESPACE = 'orbit-payments/v1';
    private const SESSION_PATTERN = '/^(?:ops|ors)_[A-Za-z0-9_-]{6,160}$/';

    public static function init(): void {
        add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
    }

    public static function register_routes(): void {
        register_rest_route( self::NAMESPACE, '/health', array(
            'methods' => WP_REST_Server::READABLE,
            'callback' => array( __CLASS__, 'health' ),
            'permission_callback' => '__return_true',
        ) );
        register_rest_route( self::NAMESPACE, '/orders/(?P<order_id>\d+)', array(
            'methods' => WP_REST_Server::READABLE,
            'callback' => array( __CLASS__, 'order' ),
            'permission_callback' => array( __CLASS__, 'authorize' ),
        ) );
        register_rest_route( self::NAMESPACE, '/events', array(
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => array( __CLASS__, 'event' ),
            'permission_callback' => array( __CLASS__, 'authorize' ),
        ) );
        register_rest_route( 'orbit/v1', '/card-hosted-status', array(
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => array( __CLASS__, 'status' ),
            'permission_callback' => '__return_true',
        ) );
    }

    public static function connect( string $api_url, string $storefront_url, string $connection_code ) {
        $api_url = self::canonical_origin( $api_url );
        $storefront_url = self::canonical_origin( $storefront_url );
        if ( is_wp_error( $api_url ) || is_wp_error( $storefront_url ) ) {
            return new WP_Error( 'orbit_hosted_url_invalid', 'Enter valid HTTPS ORBIT and storefront origins.' );
        }
        if ( ! preg_match( '/^orb_(?:test|live)_[A-Za-z0-9_-]{12,}$/', $connection_code ) ) {
            return new WP_Error( 'orbit_hosted_code_invalid', 'The ORBIT connection code is invalid or expired.' );
        }
        $body = wp_json_encode( array(
            'connection_code' => $connection_code,
            'site_url' => home_url( '/' ),
            'storefront_url' => $storefront_url,
            'callback_url' => rest_url( self::NAMESPACE . '/events' ),
            'health_url' => rest_url( self::NAMESPACE . '/health' ),
            'plugin_version' => ORBIT_RELAY_VERSION,
            'wordpress_version' => get_bloginfo( 'version' ),
            'woocommerce_version' => defined( 'WC_VERSION' ) ? WC_VERSION : '',
        ), JSON_UNESCAPED_SLASHES );
        $response = wp_remote_post( $api_url . '/v1/woocommerce/installations/exchange', array(
            'timeout' => 20,
            'redirection' => 0,
            'headers' => array( 'Accept' => 'application/json', 'Content-Type' => 'application/json' ),
            'body' => $body,
            'data_format' => 'body',
        ) );
        if ( is_wp_error( $response ) ) return new WP_Error( 'orbit_hosted_connect_transport', 'WordPress could not reach ORBIT.' );
        $status = (int) wp_remote_retrieve_response_code( $response );
        $data = json_decode( (string) wp_remote_retrieve_body( $response ), true );
        if ( $status < 200 || $status >= 300 || ! is_array( $data ) ) {
            return new WP_Error( 'orbit_hosted_connect_rejected', sanitize_text_field( (string) ( $data['error'] ?? 'ORBIT rejected the connection.' ) ) );
        }
        $merchant = sanitize_text_field( (string) ( $data['merchant_id'] ?? '' ) );
        $installation = sanitize_text_field( (string) ( $data['installation_id'] ?? '' ) );
        $secret = trim( (string) ( $data['installation_secret'] ?? '' ) );
        if ( ! preg_match( '/^mrc_[A-Za-z0-9_-]{6,}$/', $merchant ) || ! preg_match( '/^ins_[A-Za-z0-9_-]{6,}$/', $installation ) || ! preg_match( '/^[A-Za-z0-9_-]{32,128}$/', $secret ) ) {
            return new WP_Error( 'orbit_hosted_connect_response', 'ORBIT returned an invalid installation configuration.' );
        }
        if ( ! ORBIT_Relay_Hosted_Secret_Store::set( $secret ) ) {
            return new WP_Error( 'orbit_hosted_secret_store', 'WordPress could not securely store the ORBIT installation secret.' );
        }
        update_option( 'orbit_relay_api_url', $api_url, false );
        update_option( 'orbit_relay_storefront_url', $storefront_url, false );
        update_option( 'orbit_relay_merchant_id', $merchant, false );
        update_option( 'orbit_relay_hosted_installation_id', $installation, false );
        update_option( 'orbit_relay_environment', 'live' === ( $data['environment'] ?? '' ) ? 'production' : 'staging', false );
        update_option( 'orbit_relay_enabled', '1', false );
        return true;
    }

    public static function create_session( WC_Order $order ): WP_REST_Response {
        if ( ! ORBIT_Relay::hosted_configured() ) return self::response( false, 'ORBIT hosted checkout is not connected.', 503 );
        $path = '/v1/woocommerce/checkout-sessions';
        $storefront = ORBIT_Relay::storefront_url();
        $return_url = add_query_arg( array( 'orbit_checkout' => 'success', 'order_id' => $order->get_id(), 'order_key' => $order->get_order_key() ), $storefront . '/checkout/' );
        $cancel_url = add_query_arg( array( 'orbit_checkout' => 'cancel', 'order_id' => $order->get_id(), 'order_key' => $order->get_order_key() ), $storefront . '/checkout/' );
        $items = array();
        foreach ( $order->get_items() as $item ) {
            if ( ! $item instanceof WC_Order_Item_Product ) continue;
            $items[] = array( 'name' => wp_strip_all_tags( $item->get_name() ), 'quantity' => (int) $item->get_quantity() );
        }
        $payload = array(
            'platform' => 'woocommerce',
            'merchant_id' => ORBIT_Relay::merchant_id(),
            'installation_id' => ORBIT_Relay::hosted_installation_id(),
            'order' => array(
                'id' => $order->get_id(),
                'number' => (string) $order->get_order_number(),
                'key' => (string) $order->get_order_key(),
                'currency' => strtoupper( (string) $order->get_currency() ),
                'amount_minor' => ORBIT_Relay_Orders::decimal_to_minor( (string) $order->get_total(), strtoupper( (string) $order->get_currency() ) ),
                'items' => $items,
                'customer' => array( 'email' => (string) $order->get_billing_email(), 'name' => trim( $order->get_formatted_billing_full_name() ) ),
            ),
            'return_url' => $return_url,
            'cancel_url' => $cancel_url,
            'callback_url' => rest_url( self::NAMESPACE . '/events' ),
            'idempotency_key' => 'orbit-order-' . $order->get_id() . '-' . substr( hash( 'sha256', (string) $order->get_order_key() ), 0, 24 ),
        );
        $result = self::signed_post( $path, $payload );
        if ( is_wp_error( $result ) ) return self::response( false, $result->get_error_message(), (int) ( $result->get_error_data()['status'] ?? 502 ) );
        $session_id = sanitize_text_field( (string) ( $result['id'] ?? '' ) );
        $checkout_url = esc_url_raw( (string) ( $result['checkout_url'] ?? '' ) );
        $expires_at = sanitize_text_field( (string) ( $result['expires_at'] ?? '' ) );
        $parsed = wp_parse_url( $checkout_url );
        if ( ! preg_match( self::SESSION_PATTERN, $session_id ) || 'https' !== strtolower( (string) ( $parsed['scheme'] ?? '' ) ) || empty( $parsed['host'] ) ) {
            return self::response( false, 'ORBIT returned an invalid hosted checkout URL.', 502 );
        }
        $order->update_meta_data( '_orbit_hosted_session_id', $session_id );
        $order->update_meta_data( '_orbit_hosted_expires_at', $expires_at );
        $order->update_meta_data( '_orbit_payment_status', 'redirected' );
        $order->add_order_note( 'Customer redirected to the ORBIT hosted payment page.' );
        $order->save();
        return self::response( true, '', 200, array(
            'hostedCheckout' => true,
            'redirectUrl' => $checkout_url,
            'expiresAt' => $expires_at,
            'orderId' => $order->get_id(),
            'orderNumber' => $order->get_order_number(),
            'orderKey' => $order->get_order_key(),
            'currency' => strtoupper( (string) $order->get_currency() ),
            'total' => (string) $order->get_total(),
        ) );
    }

    public static function authorize( WP_REST_Request $request ) {
        if ( ! ORBIT_Relay::hosted_configured() ) return new WP_Error( 'orbit_hosted_not_connected', 'ORBIT hosted checkout is not connected.', array( 'status' => 503 ) );
        $merchant = trim( (string) $request->get_header( 'x-orbit-merchant' ) );
        $installation = trim( (string) $request->get_header( 'x-orbit-installation' ) );
        $timestamp = trim( (string) $request->get_header( 'x-orbit-timestamp' ) );
        $nonce = trim( (string) $request->get_header( 'x-orbit-nonce' ) );
        $signature = strtolower( trim( (string) $request->get_header( 'x-orbit-signature' ) ) );
        if ( ! hash_equals( ORBIT_Relay::merchant_id(), $merchant ) || ! hash_equals( ORBIT_Relay::hosted_installation_id(), $installation ) || ! ctype_digit( $timestamp ) || abs( time() - (int) $timestamp ) > 300 || ! preg_match( '/^[A-Za-z0-9_-]{16,128}$/', $nonce ) ) {
            return new WP_Error( 'orbit_hosted_auth_invalid', 'ORBIT hosted authentication failed.', array( 'status' => 401 ) );
        }
        $nonce_key = 'orbit_hosted_nonce_' . hash( 'sha256', $installation . '|' . $nonce );
        if ( false !== get_transient( $nonce_key ) ) return new WP_Error( 'orbit_hosted_replay', 'Request replay rejected.', array( 'status' => 409 ) );
        $path = self::request_path();
        $canonical = implode( "\n", array( $merchant, $installation, $timestamp, $nonce, strtoupper( $request->get_method() ), $path, hash( 'sha256', (string) $request->get_body() ) ) );
        $expected = hash_hmac( 'sha256', $canonical, ORBIT_Relay::hosted_installation_secret() );
        if ( ! preg_match( '/^[a-f0-9]{64}$/', $signature ) || ! hash_equals( $expected, $signature ) ) return new WP_Error( 'orbit_hosted_signature', 'ORBIT hosted signature is invalid.', array( 'status' => 401 ) );
        set_transient( $nonce_key, 1, 600 );
        ORBIT_Relay::touch_request();
        return true;
    }

    public static function health(): WP_REST_Response {
        return self::response( true, '', 200, array( 'service' => 'orbit-payments-woocommerce', 'version' => ORBIT_RELAY_VERSION, 'connected' => ORBIT_Relay::hosted_configured() ) );
    }

    public static function order( WP_REST_Request $request ) {
        $order = wc_get_order( absint( $request['order_id'] ) );
        if ( ! $order ) return new WP_Error( 'orbit_order_not_found', 'Order not found.', array( 'status' => 404 ) );
        if ( 'orbit_card' !== $order->get_payment_method() || 'orbit_relay_card_checkout' !== $order->get_created_via() ) return new WP_Error( 'orbit_order_source_invalid', 'Order was not prepared by ORBIT Payments.', array( 'status' => 409 ) );
        $currency = strtoupper( (string) $order->get_currency() );
        $total_minor = ORBIT_Relay_Orders::decimal_to_minor( (string) $order->get_total(), $currency );
        $paid = (bool) $order->is_paid();
        $status = (string) $order->get_status();
        $date = $order->get_date_created();
        return new WP_REST_Response( array(
            'order_id' => $order->get_id(),
            'order_number' => (string) $order->get_order_number(),
            'status' => $status,
            'currency' => $currency,
            'total_minor' => $total_minor,
            'payment_required' => ! $paid && $total_minor > 0 && ! in_array( $status, array( 'cancelled', 'refunded', 'failed', 'trash' ), true ),
            'paid' => $paid,
            'date_created' => $date ? $date->date( DATE_ATOM ) : null,
            'orbit_session_id' => (string) $order->get_meta( '_orbit_hosted_session_id', true ) ?: null,
            'orbit_payment_id' => (string) $order->get_meta( '_orbit_hosted_payment_id', true ) ?: null,
        ), 200 );
    }

    public static function event( WP_REST_Request $request ) {
        $data = $request->get_json_params();
        $data = is_array( $data ) ? $data : array();
        $order = wc_get_order( absint( $data['order_id'] ?? 0 ) );
        if ( ! $order ) return new WP_Error( 'orbit_order_not_found', 'Order not found.', array( 'status' => 404 ) );
        if ( 'orbit_card' !== $order->get_payment_method() || 'orbit_relay_card_checkout' !== $order->get_created_via() ) return new WP_Error( 'orbit_order_source_invalid', 'Order was not prepared by ORBIT Payments.', array( 'status' => 409 ) );
        $event_id = sanitize_text_field( (string) ( $data['id'] ?? '' ) );
        $session_id = sanitize_text_field( (string) ( $data['orbit_session_id'] ?? '' ) );
        $payment_id = sanitize_text_field( (string) ( $data['orbit_payment_id'] ?? '' ) );
        $stored_session = (string) $order->get_meta( '_orbit_hosted_session_id', true );
        $total_minor = ORBIT_Relay_Orders::decimal_to_minor( (string) $order->get_total(), strtoupper( (string) $order->get_currency() ) );
        if ( 'payment.succeeded' !== ( $data['type'] ?? '' ) || ! preg_match( '/^evt_[A-Za-z0-9_-]{6,160}$/', $event_id ) || ! preg_match( self::SESSION_PATTERN, $session_id ) || ! preg_match( '/^pay_[A-Za-z0-9_-]{6,160}$/', $payment_id ) || ! hash_equals( $stored_session, $session_id ) || (int) ( $data['amount_minor'] ?? 0 ) !== $total_minor || strtoupper( (string) ( $data['currency'] ?? '' ) ) !== strtoupper( (string) $order->get_currency() ) ) {
            return new WP_Error( 'orbit_hosted_event_mismatch', 'ORBIT payment event verification failed.', array( 'status' => 409 ) );
        }
        $existing_event = (string) $order->get_meta( '_orbit_hosted_event_id', true );
        $existing_payment = (string) $order->get_meta( '_orbit_hosted_payment_id', true );
        if ( $existing_event && hash_equals( $existing_event, $event_id ) ) return self::response( true, '', 200, array( 'alreadyProcessed' => true ) );
        if ( $existing_payment && ! hash_equals( $existing_payment, $payment_id ) ) return new WP_Error( 'orbit_hosted_payment_conflict', 'Order is linked to another ORBIT payment.', array( 'status' => 409 ) );
        $order->update_meta_data( '_orbit_hosted_event_id', $event_id );
        $order->update_meta_data( '_orbit_hosted_payment_id', $payment_id );
        $order->update_meta_data( '_orbit_payment_status', 'succeeded' );
        $order->update_meta_data( '_orbit_last_sync_at', gmdate( 'c' ) );
        $order->save();
        if ( ! $order->is_paid() ) $order->payment_complete( $payment_id );
        $order->add_order_note( sprintf( 'ORBIT hosted payment confirmed. Payment: %s', $payment_id ) );
        ORBIT_Relay::touch_sync();
        return self::response( true, '', 200, array( 'alreadyProcessed' => false ) );
    }

    public static function status( WP_REST_Request $request ) {
        $secret = ORBIT_Relay_Card_Checkout::compliance_secret();
        $provided = (string) $request->get_header( 'x-rgv-compliance-secret' );
        if ( '' === $secret || '' === $provided || ! hash_equals( $secret, $provided ) ) return new WP_Error( 'orbit_hosted_status_auth', 'Secure checkout session required.', array( 'status' => 401 ) );
        $data = $request->get_json_params();
        $data = is_array( $data ) ? $data : array();
        $order = wc_get_order( absint( $data['orderId'] ?? 0 ) );
        $key = sanitize_text_field( (string) ( $data['orderKey'] ?? '' ) );
        if ( ! $order || ! $key || ! hash_equals( (string) $order->get_order_key(), $key ) || 'orbit_card' !== $order->get_payment_method() ) return new WP_Error( 'orbit_hosted_status_missing', 'ORBIT Payments order not found.', array( 'status' => 404 ) );
        return self::response( true, '', 200, array(
            'orderId' => $order->get_id(),
            'orderNumber' => $order->get_order_number(),
            'orderKey' => $order->get_order_key(),
            'paid' => (bool) $order->is_paid(),
            'status' => (string) $order->get_status(),
            'total' => (string) $order->get_total(),
            'currency' => strtoupper( (string) $order->get_currency() ),
        ) );
    }

    private static function signed_post( string $path, array $payload ) {
        $body = wp_json_encode( $payload, JSON_UNESCAPED_SLASHES );
        $timestamp = (string) time();
        $nonce = self::base64url( random_bytes( 24 ) );
        $canonical = implode( "\n", array( ORBIT_Relay::merchant_id(), ORBIT_Relay::hosted_installation_id(), $timestamp, $nonce, 'POST', $path, hash( 'sha256', $body ) ) );
        $response = wp_remote_post( ORBIT_Relay::api_url() . $path, array(
            'timeout' => 25,
            'redirection' => 0,
            'headers' => array(
                'Accept' => 'application/json', 'Content-Type' => 'application/json',
                'X-Orbit-Merchant' => ORBIT_Relay::merchant_id(),
                'X-Orbit-Installation' => ORBIT_Relay::hosted_installation_id(),
                'X-Orbit-Timestamp' => $timestamp,
                'X-Orbit-Nonce' => $nonce,
                'X-Orbit-Signature' => hash_hmac( 'sha256', $canonical, ORBIT_Relay::hosted_installation_secret() ),
            ),
            'body' => $body,
            'data_format' => 'body',
        ) );
        if ( is_wp_error( $response ) ) return new WP_Error( 'orbit_hosted_transport', 'The ORBIT payment page could not be reached.', array( 'status' => 503 ) );
        $status = (int) wp_remote_retrieve_response_code( $response );
        $data = json_decode( (string) wp_remote_retrieve_body( $response ), true );
        if ( $status < 200 || $status >= 300 || ! is_array( $data ) ) return new WP_Error( 'orbit_hosted_upstream', sanitize_text_field( (string) ( $data['error'] ?? 'ORBIT could not prepare the payment page.' ) ), array( 'status' => in_array( $status, array( 400, 401, 403, 409, 422, 429, 503 ), true ) ? $status : 502 ) );
        return $data;
    }

    private static function canonical_origin( string $value ) {
        $url = wp_parse_url( trim( $value ) );
        if ( ! is_array( $url ) || empty( $url['host'] ) || ! in_array( strtolower( (string) ( $url['scheme'] ?? '' ) ), array( 'https', 'http' ), true ) || ! empty( $url['user'] ) || ! empty( $url['pass'] ) || ! empty( $url['query'] ) || ! empty( $url['fragment'] ) ) return new WP_Error( 'orbit_origin_invalid' );
        $host = strtolower( (string) $url['host'] );
        $local = in_array( $host, array( 'localhost', '127.0.0.1', '::1' ), true );
        if ( 'https' !== strtolower( (string) $url['scheme'] ) && ! $local ) return new WP_Error( 'orbit_origin_https' );
        $port = isset( $url['port'] ) ? ':' . absint( $url['port'] ) : '';
        return strtolower( (string) $url['scheme'] ) . '://' . $host . $port;
    }

    private static function request_path(): string {
        $uri = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '/';
        $path = wp_parse_url( $uri, PHP_URL_PATH );
        return is_string( $path ) && '' !== $path ? $path : '/';
    }

    private static function base64url( string $value ): string { return rtrim( strtr( base64_encode( $value ), '+/', '-_' ), '=' ); }

    private static function response( bool $success, string $message, int $status, array $data = array() ): WP_REST_Response {
        $payload = array_merge( array( 'success' => $success ), $data );
        if ( '' !== $message ) $payload['message'] = $message;
        $response = new WP_REST_Response( $payload, $status );
        $response->header( 'Cache-Control', 'no-store, private' );
        $response->header( 'Referrer-Policy', 'no-referrer' );
        return $response;
    }
}
