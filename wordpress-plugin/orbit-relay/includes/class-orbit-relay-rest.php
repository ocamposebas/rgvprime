<?php

defined( 'ABSPATH' ) || exit;

final class ORBIT_Relay_REST {
    public static function init(): void {
        add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
    }

    public static function register_routes(): void {
        register_rest_route(
            'orbit/v1',
            '/health',
            array(
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => array( __CLASS__, 'health' ),
                'permission_callback' => '__return_true',
            )
        );

        register_rest_route(
            'orbit/v1',
            '/card-quote',
            array(
                'methods'             => WP_REST_Server::CREATABLE,
                'callback'            => array( 'ORBIT_Relay_Card_Checkout', 'quote' ),
                'permission_callback' => array( 'ORBIT_Relay_Card_Checkout', 'authorize' ),
            )
        );

        register_rest_route(
            'orbit/v1',
            '/card-checkout',
            array(
                'methods'             => WP_REST_Server::CREATABLE,
                'callback'            => array( 'ORBIT_Relay_Card_Checkout', 'handle' ),
                'permission_callback' => array( 'ORBIT_Relay_Card_Checkout', 'authorize' ),
            )
        );

        register_rest_route(
            'orbit/v1',
            '/orders/(?P<order_id>\d+)',
            array(
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => array( __CLASS__, 'order' ),
                'permission_callback' => '__return_true',
                'args'                => array(
                    'order_id' => array(
                        'validate_callback' => static fn( $param ) => is_numeric( $param ) && (int) $param > 0,
                    ),
                ),
            )
        );

        register_rest_route(
            'orbit/v1',
            '/orders/(?P<order_id>\d+)/payment',
            array(
                'methods'             => WP_REST_Server::CREATABLE,
                'callback'            => array( __CLASS__, 'payment' ),
                'permission_callback' => '__return_true',
                'args'                => array(
                    'order_id' => array(
                        'validate_callback' => static fn( $param ) => is_numeric( $param ) && (int) $param > 0,
                    ),
                ),
            )
        );
    }

    public static function health( WP_REST_Request $request ): WP_REST_Response {
        unset( $request );
        return new WP_REST_Response( ORBIT_Relay_Health::payload(), 200 );
    }

    public static function order( WP_REST_Request $request ) {
        $auth = ORBIT_Relay_Auth::authenticate( $request );
        if ( is_wp_error( $auth ) ) {
            return $auth;
        }

        $order_id = absint( $request['order_id'] );
        $summary  = ORBIT_Relay_Orders::get_summary( $order_id );
        if ( is_wp_error( $summary ) ) {
            return $summary;
        }

        ORBIT_Relay_Logger::log( 'ORBIT_ORDER_READ', 'Order payment summary retrieved.', array( 'order_id' => $order_id ) );
        $response = new WP_REST_Response( $summary, 200 );
        $response->header( 'Cache-Control', 'no-store, private' );
        return $response;
    }

    public static function payment( WP_REST_Request $request ) {
        // This endpoint is intentionally server-to-server only. The HMAC covers
        // the exact raw body, method and URL path before any payment state changes.
        $auth = ORBIT_Relay_Auth::authenticate( $request );
        if ( is_wp_error( $auth ) ) {
            return $auth;
        }

        $body = $request->get_json_params();
        if ( ! is_array( $body ) ) {
            return new WP_Error( 'orbit_invalid_json', 'A valid JSON body is required.', array( 'status' => 400 ) );
        }

        $status          = sanitize_key( (string) ( $body['status'] ?? '' ) );
        $transaction_id  = sanitize_text_field( (string) ( $body['transaction_id'] ?? $body['transactionId'] ?? '' ) );
        $payment_reference = self::payment_reference_from_body( $body );

        if ( 'succeeded' !== $status ) {
            return new WP_Error( 'orbit_status_unsupported', 'Only a verified successful ORBIT payment may complete a WooCommerce order.', array( 'status' => 400 ) );
        }

        $result = ORBIT_Relay_Orders::complete_payment(
            absint( $request['order_id'] ),
            $transaction_id,
            $payment_reference
        );

        if ( is_wp_error( $result ) ) {
            ORBIT_Relay_Logger::log(
                'ORBIT_RELAY_ERROR',
                $result->get_error_message(),
                array( 'order_id' => absint( $request['order_id'] ) ),
                'error'
            );
            return $result;
        }

        $response = new WP_REST_Response( $result, 200 );
        $response->header( 'Cache-Control', 'no-store, private' );
        return $response;
    }

    /**
     * Support the production ORBIT contract while remaining compatible with
     * callers that name the Stripe reference slightly differently.
     */
    private static function payment_reference_from_body( array $body ): string {
        $candidates = array(
            $body['payment_reference'] ?? '',
            $body['paymentReference'] ?? '',
            $body['stripe_payment_intent_id'] ?? '',
            $body['stripePaymentIntentId'] ?? '',
            $body['payment_intent_id'] ?? '',
            $body['paymentIntentId'] ?? '',
            $body['stripe_charge_id'] ?? '',
            $body['stripeChargeId'] ?? '',
        );

        foreach ( $candidates as $candidate ) {
            $candidate = sanitize_text_field( (string) $candidate );
            if ( '' !== $candidate ) {
                return $candidate;
            }
        }

        return '';
    }
}
