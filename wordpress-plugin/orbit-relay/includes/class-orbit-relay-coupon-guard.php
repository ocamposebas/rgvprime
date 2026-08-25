<?php

defined( 'ABSPATH' ) || exit;

/**
 * Enforces customer-level limits for public promotional coupons.
 *
 * The limit is applied through the WooCommerce coupon getter so every
 * checkout path sees it, including standard checkout, ORBIT quotes/orders,
 * and custom manual-payment orders that call WC_Order::apply_coupon().
 */
final class ORBIT_Relay_Coupon_Guard {
    private const DEFAULT_SINGLE_USE_CODES = array( 'WELCOME10' );

    public static function init(): void {
        add_filter(
            'woocommerce_coupon_get_usage_limit_per_user',
            array( __CLASS__, 'force_single_use_limit' ),
            20,
            2
        );

        add_action( 'woocommerce_init', array( __CLASS__, 'persist_coupon_limits' ), 30 );
    }

    /**
     * Force protected coupons to one redemption per WooCommerce customer or
     * guest billing email, even if the saved coupon setting changes later.
     *
     * @param mixed     $limit  Current per-user limit.
     * @param WC_Coupon $coupon Coupon being read.
     */
    public static function force_single_use_limit( $limit, $coupon ): int {
        if ( self::is_protected_coupon( $coupon ) ) {
            return 1;
        }

        return max( 0, (int) $limit );
    }

    /**
     * Store the rule in WooCommerce so the admin screen and integrations also
     * report the correct setting.
     */
    public static function persist_coupon_limits(): void {
        foreach ( self::single_use_codes() as $code ) {
            $coupon_id = wc_get_coupon_id_by_code( $code );

            if ( ! $coupon_id ) {
                continue;
            }

            $coupon = new WC_Coupon( $coupon_id );

            if ( 1 === (int) $coupon->get_usage_limit_per_user( 'edit' ) ) {
                continue;
            }

            $coupon->set_usage_limit_per_user( 1 );
            $coupon->save();

            ORBIT_Relay_Logger::log(
                'WELCOME_COUPON_LIMIT_ENFORCED',
                sprintf( 'Coupon %s is now limited to one use per customer.', $code ),
                array( 'coupon_id' => $coupon_id )
            );
        }
    }

    /**
     * @param mixed $coupon Coupon instance supplied by WooCommerce.
     */
    private static function is_protected_coupon( $coupon ): bool {
        return $coupon instanceof WC_Coupon && in_array(
            self::normalize_code( $coupon->get_code() ),
            self::single_use_codes(),
            true
        );
    }

    /**
     * Allow additional one-use promotional codes without another release.
     *
     * @return string[]
     */
    private static function single_use_codes(): array {
        $codes = apply_filters(
            'orbit_relay_single_use_coupon_codes',
            self::DEFAULT_SINGLE_USE_CODES
        );

        if ( ! is_array( $codes ) ) {
            $codes = self::DEFAULT_SINGLE_USE_CODES;
        }

        return array_values(
            array_unique(
                array_filter(
                    array_map( array( __CLASS__, 'normalize_code' ), $codes )
                )
            )
        );
    }

    /**
     * @param mixed $code Coupon code.
     */
    private static function normalize_code( $code ): string {
        return strtoupper(
            preg_replace(
                '/[^A-Z0-9\-_]/',
                '',
                sanitize_text_field( (string) $code )
            )
        );
    }
}
