<?php
/**
 * Plugin Name: RGV WELCOME10 First Order Guard
 * Description: Restricts WELCOME10 to one redemption and to customers without a prior paid or refunded WooCommerce order.
 * Version: 1.0.0
 * Author: RGVPRIME LLC
 * Requires Plugins: woocommerce
 * Requires PHP: 7.4
 * WC requires at least: 8.5
 * Text Domain: rgv-welcome10-guard
 */

defined( 'ABSPATH' ) || exit;

final class RGV_Welcome10_Guard {
    private const VERSION = '1.0.0';
    private const DEFAULT_CODES = array( 'WELCOME10' );
    private const FIRST_ORDER_MESSAGE = 'WELCOME10 is reserved for your first order. This account or billing email already has a previous purchase.';
    private const VERIFY_ERROR_MESSAGE = 'We could not verify first-order eligibility right now. Please try again shortly.';

    private static string $request_email = '';
    private static int $request_customer_id = 0;
    private static array $validation_errors = array();

    public static function init(): void {
        add_filter(
            'rest_request_before_callbacks',
            array( __CLASS__, 'capture_rest_identity' ),
            5,
            3
        );

        add_filter(
            'woocommerce_coupon_get_usage_limit_per_user',
            array( __CLASS__, 'force_single_use_limit' ),
            30,
            2
        );

        add_filter(
            'woocommerce_coupon_is_valid',
            array( __CLASS__, 'enforce_first_order_eligibility' ),
            30,
            3
        );

        add_filter(
            'woocommerce_coupon_error',
            array( __CLASS__, 'explain_coupon_rejection' ),
            30,
            3
        );

        add_action( 'woocommerce_init', array( __CLASS__, 'persist_coupon_limit' ), 40 );
    }

    public static function declare_hpos_compatibility(): void {
        if ( class_exists( '\\Automattic\\WooCommerce\\Utilities\\FeaturesUtil' ) ) {
            \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility(
                'custom_order_tables',
                __FILE__,
                true
            );
        }
    }

    /**
     * Capture the authenticated storefront identity before a custom WooCommerce
     * REST route validates or applies the coupon.
     *
     * @param mixed           $response Early REST response, if any.
     * @param mixed           $handler  Matched REST handler.
     * @param WP_REST_Request $request  Current REST request.
     * @return mixed
     */
    public static function capture_rest_identity( $response, $handler, $request ) {
        if ( ! $request instanceof WP_REST_Request ) {
            return $response;
        }

        $params = $request->get_json_params();
        if ( ! is_array( $params ) ) {
            $params = $request->get_params();
        }

        $trusted_proxy = self::is_trusted_storefront_request();
        $acceptance = is_array( $params['complianceAcceptance'] ?? null )
            ? $params['complianceAcceptance']
            : array();

        if ( $trusted_proxy ) {
            self::$request_customer_id = absint( $acceptance['userId'] ?? 0 );
        }

        $candidates = array(
            $trusted_proxy ? ( $acceptance['userEmail'] ?? '' ) : '',
            $params['customer_email'] ?? '',
            $params['billing_email'] ?? '',
            $params['email'] ?? '',
            is_array( $params['billing'] ?? null ) ? ( $params['billing']['email'] ?? '' ) : '',
            is_array( $params['billing_address'] ?? null ) ? ( $params['billing_address']['email'] ?? '' ) : '',
            is_array( $params['shipping'] ?? null ) ? ( $params['shipping']['email'] ?? '' ) : '',
        );

        foreach ( $candidates as $candidate ) {
            $email = strtolower( sanitize_email( (string) $candidate ) );
            if ( $email && is_email( $email ) ) {
                self::$request_email = $email;
                break;
            }
        }

        return $response;
    }

    /**
     * @param mixed     $limit  Current per-customer usage limit.
     * @param WC_Coupon $coupon Coupon being read.
     */
    public static function force_single_use_limit( $limit, $coupon ): int {
        return self::is_protected_coupon( $coupon ) ? 1 : max( 0, (int) $limit );
    }

    public static function persist_coupon_limit(): void {
        if ( ! class_exists( 'WC_Coupon' ) || ! function_exists( 'wc_get_coupon_id_by_code' ) ) {
            return;
        }

        foreach ( self::protected_codes() as $code ) {
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
            self::log(
                'info',
                sprintf( '%s is now limited to one redemption per customer.', $code ),
                array( 'coupon_id' => $coupon_id )
            );
        }
    }

    /**
     * @param mixed        $valid     Existing validation result.
     * @param WC_Coupon    $coupon    Coupon being validated.
     * @param WC_Discounts $discounts WooCommerce discount context.
     */
    public static function enforce_first_order_eligibility( $valid, $coupon, $discounts ): bool {
        if ( ! $valid || ! self::is_protected_coupon( $coupon ) ) {
            return (bool) $valid;
        }

        $code = self::normalize_code( $coupon->get_code() );
        unset( self::$validation_errors[ $code ] );

        $identity = self::checkout_identity( $discounts );
        if ( ! $identity['customer_id'] && ! $identity['email'] ) {
            self::$validation_errors[ $code ] = 'Enter a valid billing email so we can verify first-order eligibility.';
            return false;
        }

        try {
            if ( self::has_prior_purchase( $identity['customer_id'], $identity['email'], $identity['order_id'] ) ) {
                self::$validation_errors[ $code ] = self::FIRST_ORDER_MESSAGE;
                return false;
            }
        } catch ( Throwable $error ) {
            self::$validation_errors[ $code ] = self::VERIFY_ERROR_MESSAGE;
            self::log(
                'error',
                'WELCOME10 first-order verification failed.',
                array( 'error' => $error->getMessage() )
            );
            return false;
        }

        return true;
    }

    /**
     * @param mixed     $message    Existing WooCommerce error message.
     * @param mixed     $error_code WooCommerce coupon error code.
     * @param WC_Coupon $coupon     Coupon being validated.
     */
    public static function explain_coupon_rejection( $message, $error_code, $coupon ): string {
        if ( ! self::is_protected_coupon( $coupon ) ) {
            return (string) $message;
        }

        $code = self::normalize_code( $coupon->get_code() );
        return self::$validation_errors[ $code ] ?? (string) $message;
    }

    /**
     * @param mixed $discounts WooCommerce discount context.
     * @return array{customer_id:int,email:string,order_id:int}
     */
    private static function checkout_identity( $discounts ): array {
        $customer_id = self::$request_customer_id ?: ( is_user_logged_in() ? get_current_user_id() : 0 );
        $email = self::$request_email;
        $order_id = 0;
        $object = null;

        if ( is_object( $discounts ) && is_callable( array( $discounts, 'get_object' ) ) ) {
            $object = $discounts->get_object();
        }

        if ( $object instanceof WC_Order ) {
            $order_id = absint( $object->get_id() );
            $customer_id = absint( $object->get_customer_id() ) ?: $customer_id;
            $order_email = strtolower( sanitize_email( (string) $object->get_billing_email() ) );
            if ( ! $email && $order_email && is_email( $order_email ) ) {
                $email = $order_email;
            }
        }

        $woocommerce = function_exists( 'WC' ) ? WC() : null;
        if ( $woocommerce && $woocommerce->customer ) {
            $customer_id = absint( $woocommerce->customer->get_id() ) ?: $customer_id;
            $customer_email = strtolower( sanitize_email( (string) $woocommerce->customer->get_billing_email() ) );
            if ( ! $email && $customer_email && is_email( $customer_email ) ) {
                $email = $customer_email;
            }
        }

        if ( ! $email && isset( $_POST['billing_email'] ) ) {
            $posted_email = strtolower( sanitize_email( wp_unslash( $_POST['billing_email'] ) ) );
            if ( $posted_email && is_email( $posted_email ) ) {
                $email = $posted_email;
            }
        }

        return array(
            'customer_id' => max( 0, $customer_id ),
            'email'       => $email,
            'order_id'    => max( 0, $order_id ),
        );
    }

    private static function has_prior_purchase( int $customer_id, string $email, int $exclude_order_id = 0 ): bool {
        $statuses = array_values(
            array_unique(
                array_filter(
                    array_map(
                        'wc_clean',
                        (array) apply_filters(
                            'rgv_welcome10_guard_prior_order_statuses',
                            array_merge( wc_get_is_paid_statuses(), array( 'refunded' ) )
                        )
                    )
                )
            )
        );

        $base_query = array(
            'limit'   => 1,
            'return'  => 'ids',
            'status'  => $statuses,
            'orderby' => 'date',
            'order'   => 'DESC',
        );

        if ( $exclude_order_id > 0 ) {
            $base_query['exclude'] = array( $exclude_order_id );
        }

        if ( $customer_id > 0 ) {
            $account_orders = wc_get_orders(
                array_merge( $base_query, array( 'customer_id' => $customer_id ) )
            );
            if ( ! empty( $account_orders ) ) {
                return true;
            }
        }

        $email = strtolower( sanitize_email( $email ) );
        if ( $email && is_email( $email ) ) {
            $email_orders = wc_get_orders(
                array_merge( $base_query, array( 'billing_email' => $email ) )
            );
            if ( ! empty( $email_orders ) ) {
                return true;
            }
        }

        return false;
    }

    /**
     * The storefront proxy signs checkout traffic with the same secret used
     * by the compliance layer. Only signed traffic may supply an account ID.
     */
    private static function is_trusted_storefront_request(): bool {
        $provided = trim( (string) ( $_SERVER['HTTP_X_RGV_COMPLIANCE_SECRET'] ?? '' ) );
        $expected = self::compliance_secret();

        return '' !== $provided && '' !== $expected && hash_equals( $expected, $provided );
    }

    private static function compliance_secret(): string {
        $candidates = array(
            defined( 'RGV_COMPLIANCE_SIGNING_SECRET' ) ? RGV_COMPLIANCE_SIGNING_SECRET : '',
            defined( 'RGV_PORTAL_API_SECRET' ) ? RGV_PORTAL_API_SECRET : '',
            getenv( 'COMPLIANCE_SIGNING_SECRET' ),
            getenv( 'PORTAL_API_SECRET' ),
        );

        foreach ( $candidates as $candidate ) {
            $secret = trim( (string) $candidate );
            if ( '' !== $secret ) {
                return $secret;
            }
        }

        return '';
    }

    /**
     * @param mixed $coupon Coupon instance supplied by WooCommerce.
     */
    private static function is_protected_coupon( $coupon ): bool {
        return $coupon instanceof WC_Coupon && in_array(
            self::normalize_code( $coupon->get_code() ),
            self::protected_codes(),
            true
        );
    }

    /**
     * @return string[]
     */
    private static function protected_codes(): array {
        $codes = apply_filters( 'rgv_welcome10_guard_codes', self::DEFAULT_CODES );
        if ( ! is_array( $codes ) ) {
            $codes = self::DEFAULT_CODES;
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

    private static function log( string $level, string $message, array $context = array() ): void {
        if ( ! function_exists( 'wc_get_logger' ) ) {
            return;
        }

        $logger = wc_get_logger();
        $context['source'] = 'rgv-welcome10-guard';
        if ( is_callable( array( $logger, $level ) ) ) {
            $logger->{$level}( $message, $context );
        }
    }
}

add_action( 'before_woocommerce_init', array( 'RGV_Welcome10_Guard', 'declare_hpos_compatibility' ) );
add_action( 'plugins_loaded', array( 'RGV_Welcome10_Guard', 'init' ), 20 );

