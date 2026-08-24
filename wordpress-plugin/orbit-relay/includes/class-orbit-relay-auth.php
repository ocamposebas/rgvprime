<?php

defined( 'ABSPATH' ) || exit;

final class ORBIT_Relay_Auth {
    public const TIMESTAMP_TOLERANCE = 300;
    public const NONCE_TTL = 600;

    public static function authenticate( WP_REST_Request $request ) {
        if ( ! ORBIT_Relay::enabled() ) {
            return new WP_Error( 'orbit_relay_disabled', 'ORBIT Relay is disabled.', array( 'status' => 503 ) );
        }

        $expected_merchant = ORBIT_Relay::merchant_id();
        $secret            = ORBIT_Relay::signing_secret();

        if ( '' === $expected_merchant || '' === $secret ) {
            return new WP_Error( 'orbit_relay_not_configured', 'ORBIT Relay is not configured.', array( 'status' => 503 ) );
        }

        $merchant  = trim( (string) $request->get_header( 'x-orbit-merchant' ) );
        $timestamp = trim( (string) $request->get_header( 'x-orbit-timestamp' ) );
        $nonce     = trim( (string) $request->get_header( 'x-orbit-nonce' ) );
        $signature = strtolower( trim( (string) $request->get_header( 'x-orbit-signature' ) ) );

        if ( '' === $merchant || '' === $timestamp || '' === $nonce || '' === $signature ) {
            self::auth_log( 'Missing authentication headers.', $merchant );
            return new WP_Error( 'orbit_auth_missing', 'Authentication headers are required.', array( 'status' => 401 ) );
        }

        if ( ! hash_equals( $expected_merchant, $merchant ) ) {
            self::auth_log( 'Merchant mismatch.', $merchant );
            return new WP_Error( 'orbit_merchant_mismatch', 'Merchant authentication failed.', array( 'status' => 403 ) );
        }

        if ( ! ctype_digit( $timestamp ) ) {
            self::auth_log( 'Malformed timestamp.', $merchant );
            return new WP_Error( 'orbit_timestamp_invalid', 'Request timestamp is invalid.', array( 'status' => 401 ) );
        }

        $request_time = (int) $timestamp;
        if ( abs( time() - $request_time ) > self::TIMESTAMP_TOLERANCE ) {
            self::auth_log( 'Expired timestamp.', $merchant );
            return new WP_Error( 'orbit_timestamp_expired', 'Request timestamp is outside the allowed window.', array( 'status' => 401 ) );
        }

        if ( ! preg_match( '/^[A-Za-z0-9_-]{16,128}$/', $nonce ) ) {
            self::auth_log( 'Malformed nonce.', $merchant );
            return new WP_Error( 'orbit_nonce_invalid', 'Request nonce is invalid.', array( 'status' => 401 ) );
        }

        $nonce_key = 'orbit_relay_nonce_' . hash( 'sha256', $merchant . '|' . $nonce );
        if ( false !== get_transient( $nonce_key ) ) {
            self::auth_log( 'Replay detected.', $merchant );
            return new WP_Error( 'orbit_replay_rejected', 'Request replay rejected.', array( 'status' => 409 ) );
        }

        $method    = strtoupper( $request->get_method() );
        $path      = self::request_path();
        $body      = (string) $request->get_body();
        $body_hash = hash( 'sha256', $body );

        $canonical = implode(
            "\n",
            array(
                $merchant,
                $timestamp,
                $nonce,
                $method,
                $path,
                $body_hash,
            )
        );

        $expected_signature = hash_hmac( 'sha256', $canonical, $secret );
        if ( ! preg_match( '/^[a-f0-9]{64}$/', $signature ) || ! hash_equals( $expected_signature, $signature ) ) {
            self::auth_log( 'Invalid signature.', $merchant );
            return new WP_Error( 'orbit_signature_invalid', 'Request signature is invalid.', array( 'status' => 401 ) );
        }

        set_transient( $nonce_key, 1, self::NONCE_TTL );
        ORBIT_Relay::touch_request();
        return true;
    }

    public static function canonical_specification(): array {
        return array(
            'algorithm'            => 'HMAC-SHA256',
            'signature_encoding'   => 'lowercase hex',
            'body_hash'            => 'SHA-256 lowercase hex of the exact raw request body',
            'timestamp'            => 'Unix seconds',
            'timestamp_tolerance'  => self::TIMESTAMP_TOLERANCE,
            'canonical_components' => array( 'merchantId', 'timestamp', 'nonce', 'HTTP method uppercase', 'URL path only', 'bodySha256' ),
            'separator'            => '\\n',
        );
    }

    private static function request_path(): string {
        $uri = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '/';
        $path = wp_parse_url( $uri, PHP_URL_PATH );
        return is_string( $path ) && '' !== $path ? $path : '/';
    }

    private static function auth_log( string $message, string $merchant ): void {
        ORBIT_Relay_Logger::log(
            'ORBIT_RELAY_AUTH_FAILED',
            $message,
            array( 'merchant_id' => $merchant ),
            'warning'
        );
    }
}
