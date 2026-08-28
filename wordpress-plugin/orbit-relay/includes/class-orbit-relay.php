<?php

defined( 'ABSPATH' ) || exit;

final class ORBIT_Relay {
    private static ?ORBIT_Relay $instance = null;

    public static function instance(): ORBIT_Relay {
        if ( null === self::$instance ) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public static function activate(): void {
        if ( '' === ORBIT_Relay_Secret_Store::get() ) {
            ORBIT_Relay_Secret_Store::set( self::generate_secret() );
        }

        add_option( 'orbit_relay_environment', 'production', '', false );
        add_option( 'orbit_relay_enabled', '0', '', false );
        add_option( 'orbit_relay_allow_test_payment_completion', '0', '', false );
        add_option( 'orbit_relay_version', ORBIT_RELAY_VERSION, '', false );
        if ( ! wp_next_scheduled( 'orbit_relay_cleanup_checkout_locks' ) ) {
            wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', 'orbit_relay_cleanup_checkout_locks' );
        }
    }

    public static function generate_secret(): string {
        return 'orbsec_' . bin2hex( random_bytes( 32 ) );
    }

    public function init(): void {
        add_action( 'orbit_relay_cleanup_checkout_locks', array( 'ORBIT_Relay_Card_Checkout', 'cleanup_expired_request_locks' ) );
        ORBIT_Relay_Coupon_Guard::init();
        ORBIT_Relay_Card_Checkout::init();
        ORBIT_Relay_REST::init();
        ORBIT_Relay_Admin::init();
    }

    public static function is_woocommerce_available(): bool {
        return class_exists( 'WooCommerce' ) && function_exists( 'wc_get_order' );
    }

    public static function merchant_id(): string {
        return trim( (string) get_option( 'orbit_relay_merchant_id', '' ) );
    }

    public static function api_url(): string {
        return untrailingslashit( trim( (string) get_option( 'orbit_relay_api_url', '' ) ) );
    }

    public static function environment(): string {
        $value = strtolower( (string) get_option( 'orbit_relay_environment', 'production' ) );
        return in_array( $value, array( 'production', 'staging' ), true ) ? $value : 'production';
    }

    public static function enabled(): bool {
        return '1' === (string) get_option( 'orbit_relay_enabled', '0' );
    }

    public static function allow_test_payment_completion(): bool {
        if ( defined( 'ORBIT_RELAY_ALLOW_TEST_PAYMENT_COMPLETION' ) ) {
            return (bool) ORBIT_RELAY_ALLOW_TEST_PAYMENT_COMPLETION;
        }
        return '1' === (string) get_option( 'orbit_relay_allow_test_payment_completion', '0' );
    }

    public static function signing_secret(): string {
        return ORBIT_Relay_Secret_Store::get();
    }

    public static function touch_request(): void {
        update_option( 'orbit_relay_last_request_at', gmdate( 'c' ), false );
    }

    public static function touch_sync(): void {
        update_option( 'orbit_relay_last_successful_sync_at', gmdate( 'c' ), false );
    }
}
