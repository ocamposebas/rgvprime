<?php
/**
 * Plugin Name: RGV eDebit Guard
 * Description: Tracks eDebit payment lifecycles, expires abandoned pending orders, and exposes key-protected status/cancel endpoints for the RGVPRIME checkout.
 * Version: 1.1.0
 * Author: RGVPRIME LLC
 * Requires Plugins: woocommerce
 * Requires PHP: 7.4
 * WC requires at least: 8.2
 * WC tested up to: 10.1
 */

defined( 'ABSPATH' ) || exit;

add_action(
    'before_woocommerce_init',
    static function (): void {
        if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
            \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
        }
    }
);

final class RGV_Edebit_Guard {
    private const VERSION = '1.1.0';
    private const REST_NAMESPACE = 'rgv-edebit/v1';
    private const GATEWAY_ID = 'edd_draft_yodlee_gateway';
    private const EXPIRY_SECONDS = HOUR_IN_SECONDS;
    private const EXPIRY_HOOK = 'rgv_edebit_guard_expire_order';
    private const SWEEP_HOOK = 'rgv_edebit_guard_sweep';
    private const LIFECYCLE_META = '_rgv_edebit_lifecycle';
    private const INITIATED_AT_META = '_rgv_edebit_initiated_at';
    private const EXPIRED_AT_META = '_rgv_edebit_expired_at';
    private const ADMIN_COLUMN = 'rgv_edebit_lifecycle';
    private const DISCOUNT_RATE = 0.08;
    private const DISCOUNT_META = '_rgv_edebit_discount_applied';
    private const DISCOUNT_AMOUNT_META = '_rgv_edebit_discount_amount';
    private static $discounting_orders = array();

    public static function init(): void {
        add_action( 'rest_api_init', array( __CLASS__, 'register_rest_routes' ) );
        add_action( 'woocommerce_update_order', array( __CLASS__, 'maybe_apply_discount' ), 20, 2 );
        add_action( 'woocommerce_checkout_order_processed', array( __CLASS__, 'maybe_apply_discount' ), 20, 3 );
        add_action( 'woocommerce_order_status_pending', array( __CLASS__, 'maybe_apply_discount' ), 20, 1 );
        add_action( 'woocommerce_new_order', array( __CLASS__, 'maybe_initialize_order' ), 30, 2 );
        add_action( 'woocommerce_checkout_order_processed', array( __CLASS__, 'maybe_initialize_order' ), 30, 1 );
        add_action( 'woocommerce_order_status_pending', array( __CLASS__, 'maybe_initialize_order' ), 30, 1 );
        add_action( 'woocommerce_payment_complete', array( __CLASS__, 'mark_confirmed' ), 30, 1 );
        add_action( 'woocommerce_order_status_changed', array( __CLASS__, 'track_status_change' ), 30, 4 );
        add_action( self::EXPIRY_HOOK, array( __CLASS__, 'expire_order' ), 10, 1 );
        add_action( self::SWEEP_HOOK, array( __CLASS__, 'sweep_abandoned_orders' ) );
        add_filter( 'woocommerce_email_enabled_cancelled_order', array( __CLASS__, 'suppress_expiry_email' ), 10, 2 );
        add_action( 'woocommerce_admin_order_data_after_order_details', array( __CLASS__, 'render_admin_lifecycle' ) );
        add_filter( 'manage_edit-shop_order_columns', array( __CLASS__, 'add_admin_column' ), 25 );
        add_action( 'manage_shop_order_posts_custom_column', array( __CLASS__, 'render_classic_admin_column' ), 25, 2 );
        add_filter( 'manage_woocommerce_page_wc-orders_columns', array( __CLASS__, 'add_admin_column' ), 25 );
        add_action( 'manage_woocommerce_page_wc-orders_custom_column', array( __CLASS__, 'render_hpos_admin_column' ), 25, 2 );
        add_action( 'admin_head', array( __CLASS__, 'admin_styles' ) );

        if ( ! wp_next_scheduled( self::SWEEP_HOOK ) ) {
            wp_schedule_event( time() + 5 * MINUTE_IN_SECONDS, 'hourly', self::SWEEP_HOOK );
        }
    }

    public static function activate(): void {
        if ( ! wp_next_scheduled( self::SWEEP_HOOK ) ) {
            wp_schedule_event( time() + MINUTE_IN_SECONDS, 'hourly', self::SWEEP_HOOK );
        }
    }

    public static function deactivate(): void {
        wp_clear_scheduled_hook( self::SWEEP_HOOK );
    }

    public static function register_rest_routes(): void {
        register_rest_route(
            self::REST_NAMESPACE,
            '/order-status',
            array(
                'methods'             => WP_REST_Server::CREATABLE,
                'callback'            => array( __CLASS__, 'rest_order_status' ),
                'permission_callback' => '__return_true',
            )
        );

        register_rest_route(
            self::REST_NAMESPACE,
            '/cancel-pending',
            array(
                'methods'             => WP_REST_Server::CREATABLE,
                'callback'            => array( __CLASS__, 'rest_cancel_pending' ),
                'permission_callback' => '__return_true',
            )
        );
    }

    private static function request_order( WP_REST_Request $request ) {
        $body = $request->get_json_params();
        $body = is_array( $body ) ? $body : array();
        $order_id = absint( $body['orderId'] ?? $body['order_id'] ?? 0 );
        $order_key = sanitize_text_field( (string) ( $body['orderKey'] ?? $body['order_key'] ?? '' ) );
        $order = $order_id ? wc_get_order( $order_id ) : false;

        if (
            ! $order instanceof WC_Order ||
            ! self::is_edebit_order( $order ) ||
            '' === $order_key ||
            ! hash_equals( (string) $order->get_order_key(), $order_key )
        ) {
            return new WP_Error( 'rgv_edebit_order_not_found', 'Bank payment order was not found.', array( 'status' => 404 ) );
        }

        return $order;
    }

    public static function rest_order_status( WP_REST_Request $request ) {
        $order = self::request_order( $request );
        if ( is_wp_error( $order ) ) return $order;

        $lifecycle = self::lifecycle( $order );
        $messages = array(
            'confirmed' => 'Your bank payment was confirmed and the order is being processed.',
            'cancelled' => 'The bank payment was cancelled. Your cart remains available.',
            'expired'   => 'The incomplete bank payment expired. Your cart remains available.',
            'failed'    => 'The bank payment failed and no additional attempt was started.',
            'pending'   => 'The bank payment has not been confirmed yet. Check your email or order history before retrying.',
        );

        return rest_ensure_response(
            array(
                'success'          => true,
                'orderId'          => $order->get_id(),
                'orderStatus'      => $order->get_status(),
                'lifecycle'        => $lifecycle,
                'paymentConfirmed' => 'confirmed' === $lifecycle,
                'message'          => $messages[ $lifecycle ] ?? $messages['pending'],
            )
        );
    }

    public static function rest_cancel_pending( WP_REST_Request $request ) {
        if ( ! self::valid_internal_secret( $request ) ) {
            return new WP_Error( 'rgv_edebit_forbidden', 'Secure checkout authorization is required.', array( 'status' => 401 ) );
        }

        $order = self::request_order( $request );
        if ( is_wp_error( $order ) ) return $order;

        if ( $order->is_paid() ) {
            return rest_ensure_response(
                array(
                    'success'   => true,
                    'lifecycle' => 'confirmed',
                    'message'   => 'Payment was already confirmed; the order was not cancelled.',
                )
            );
        }

        if ( 'pending' !== $order->get_status() ) {
            return new WP_Error(
                'rgv_edebit_not_cancellable',
                'This bank payment is no longer safely cancellable. Check the order before retrying.',
                array( 'status' => 409 )
            );
        }

        self::cancel_as( $order, 'cancelled', 'Customer replaced an incomplete eDebit attempt before starting another.' );

        return rest_ensure_response(
            array(
                'success'   => true,
                'lifecycle' => 'cancelled',
                'message'   => 'The previous incomplete bank payment was cancelled.',
            )
        );
    }

    public static function maybe_apply_discount( $order_id, $context = false, $possible_order = false ): void {
        $order_id = absint( $order_id );
        if ( ! $order_id || isset( self::$discounting_orders[ $order_id ] ) ) return;

        $order = $context instanceof WC_Order
            ? $context
            : ( $possible_order instanceof WC_Order ? $possible_order : wc_get_order( $order_id ) );

        if (
            ! $order instanceof WC_Order ||
            ! self::is_edebit_order( $order ) ||
            $order->is_paid() ||
            $order->get_meta( self::DISCOUNT_META, true )
        ) return;

        $eligible_subtotal = 0.0;
        foreach ( $order->get_items( 'line_item' ) as $item ) {
            $eligible_subtotal += max( 0.0, (float) $item->get_total() );
        }
        if ( $eligible_subtotal <= 0 ) return;

        $discount = round( $eligible_subtotal * self::DISCOUNT_RATE, wc_get_price_decimals() );
        if ( $discount <= 0 ) return;

        self::$discounting_orders[ $order_id ] = true;

        try {
            $fee = new WC_Order_Item_Fee();
            $fee->set_name( 'eDebit savings (8%)' );
            $fee->set_amount( -$discount );
            $fee->set_total( -$discount );
            $fee->set_tax_status( 'none' );
            $fee->add_meta_data( '_rgv_edebit_discount_line', 1, true );
            $order->add_item( $fee );
            $order->update_meta_data( self::DISCOUNT_META, 1 );
            $order->update_meta_data( self::DISCOUNT_AMOUNT_META, wc_format_decimal( $discount ) );
            $order->update_meta_data( '_rgv_edebit_discount_rate', self::DISCOUNT_RATE );
            $order->calculate_totals( false );
            $order->add_order_note( sprintf( 'eDebit discount applied: 8%% (%s).', wp_strip_all_tags( wc_price( $discount, array( 'currency' => $order->get_currency() ) ) ) ) );
            $order->save();
        } finally {
            unset( self::$discounting_orders[ $order_id ] );
        }
    }

    public static function maybe_initialize_order( $order_id, $order = false ): void {
        $order = $order instanceof WC_Order ? $order : wc_get_order( $order_id );
        if ( ! $order instanceof WC_Order || ! self::is_edebit_order( $order ) || $order->is_paid() ) return;

        if ( '' === (string) $order->get_meta( self::LIFECYCLE_META, true ) ) {
            $order->update_meta_data( self::LIFECYCLE_META, 'initiated' );
            $order->update_meta_data( self::INITIATED_AT_META, gmdate( 'c' ) );
            $order->save();
        }

        $timestamp = time() + self::EXPIRY_SECONDS;
        if ( ! wp_next_scheduled( self::EXPIRY_HOOK, array( $order->get_id() ) ) ) {
            wp_schedule_single_event( $timestamp, self::EXPIRY_HOOK, array( $order->get_id() ) );
        }
    }

    public static function mark_confirmed( int $order_id ): void {
        $order = wc_get_order( $order_id );
        if ( ! $order instanceof WC_Order || ! self::is_edebit_order( $order ) ) return;

        self::set_lifecycle( $order, 'confirmed' );
        wp_clear_scheduled_hook( self::EXPIRY_HOOK, array( $order_id ) );
    }

    public static function track_status_change( int $order_id, string $from, string $to, $order ): void {
        $order = $order instanceof WC_Order ? $order : wc_get_order( $order_id );
        if ( ! $order instanceof WC_Order || ! self::is_edebit_order( $order ) ) return;

        if ( $order->is_paid() || in_array( $to, array( 'processing', 'completed' ), true ) ) {
            self::mark_confirmed( $order_id );
            return;
        }

        if ( 'failed' === $to ) self::set_lifecycle( $order, 'failed' );
        if ( 'cancelled' === $to && 'expired' !== (string) $order->get_meta( self::LIFECYCLE_META, true ) ) {
            self::set_lifecycle( $order, 'cancelled' );
        }

        if ( in_array( $to, array( 'failed', 'cancelled', 'refunded' ), true ) ) {
            wp_clear_scheduled_hook( self::EXPIRY_HOOK, array( $order_id ) );
        }
    }

    public static function expire_order( int $order_id ): void {
        $order = wc_get_order( $order_id );
        if (
            ! $order instanceof WC_Order ||
            ! self::is_edebit_order( $order ) ||
            $order->is_paid() ||
            'pending' !== $order->get_status()
        ) return;

        $created = $order->get_date_created();
        if ( $created && $created->getTimestamp() + self::EXPIRY_SECONDS > time() ) {
            wp_schedule_single_event( $created->getTimestamp() + self::EXPIRY_SECONDS, self::EXPIRY_HOOK, array( $order_id ) );
            return;
        }

        self::cancel_as( $order, 'expired', 'Incomplete eDebit payment expired automatically after 60 minutes.' );
    }

    public static function sweep_abandoned_orders(): void {
        if ( ! function_exists( 'wc_get_orders' ) ) return;

        $orders = wc_get_orders(
            array(
                'status'       => array( 'pending' ),
                'limit'        => 100,
                'orderby'      => 'date',
                'order'        => 'ASC',
                'date_created' => '<' . ( time() - self::EXPIRY_SECONDS ),
                'return'       => 'objects',
            )
        );

        foreach ( $orders as $order ) {
            if ( $order instanceof WC_Order && self::is_edebit_order( $order ) ) {
                self::expire_order( $order->get_id() );
            }
        }
    }

    private static function cancel_as( WC_Order $order, string $lifecycle, string $note ): void {
        $order->update_meta_data( self::LIFECYCLE_META, $lifecycle );
        if ( 'expired' === $lifecycle ) $order->update_meta_data( self::EXPIRED_AT_META, gmdate( 'c' ) );
        $order->save();
        $order->update_status( 'cancelled', $note, false );
        wp_clear_scheduled_hook( self::EXPIRY_HOOK, array( $order->get_id() ) );
    }

    private static function set_lifecycle( WC_Order $order, string $lifecycle ): void {
        if ( $lifecycle === (string) $order->get_meta( self::LIFECYCLE_META, true ) ) return;
        $order->update_meta_data( self::LIFECYCLE_META, $lifecycle );
        $order->update_meta_data( '_rgv_edebit_' . $lifecycle . '_at', gmdate( 'c' ) );
        $order->save();
    }

    private static function lifecycle( WC_Order $order ): string {
        if ( $order->is_paid() || in_array( $order->get_status(), array( 'processing', 'completed' ), true ) ) return 'confirmed';

        $stored = sanitize_key( (string) $order->get_meta( self::LIFECYCLE_META, true ) );
        if ( in_array( $stored, array( 'confirmed', 'cancelled', 'expired', 'failed' ), true ) ) return $stored;
        if ( 'failed' === $order->get_status() ) return 'failed';
        if ( 'cancelled' === $order->get_status() ) return 'cancelled';
        return 'pending';
    }

    private static function is_edebit_order( WC_Order $order ): bool {
        if ( self::GATEWAY_ID === $order->get_payment_method() ) return true;
        $source = strtolower( (string) $order->get_meta( '_rgv_payment_source', true ) );
        return false !== strpos( $source, 'edebit' );
    }

    private static function compliance_secret(): string {
        $candidates = array(
            defined( 'RGV_COMPLIANCE_SIGNING_SECRET' ) ? RGV_COMPLIANCE_SIGNING_SECRET : '',
            defined( 'RGV_PORTAL_API_SECRET' ) ? RGV_PORTAL_API_SECRET : '',
            getenv( 'COMPLIANCE_SIGNING_SECRET' ),
            getenv( 'PORTAL_API_SECRET' ),
            get_option( 'rgv_compliance_signing_secret', '' ),
            get_option( 'rgv_portal_api_secret', '' ),
            get_option( 'rgv_portal_secret', '' ),
        );

        foreach ( $candidates as $candidate ) {
            $candidate = trim( (string) $candidate );
            if ( '' !== $candidate ) return $candidate;
        }
        return '';
    }

    private static function valid_internal_secret( WP_REST_Request $request ): bool {
        $expected = self::compliance_secret();
        $provided = (string) $request->get_header( 'x-rgv-compliance-secret' );
        return '' !== $expected && '' !== $provided && hash_equals( $expected, $provided );
    }

    public static function suppress_expiry_email( bool $enabled, $order ): bool {
        if (
            $order instanceof WC_Order &&
            self::is_edebit_order( $order ) &&
            'expired' === (string) $order->get_meta( self::LIFECYCLE_META, true )
        ) return false;
        return $enabled;
    }

    public static function render_admin_lifecycle( $order ): void {
        if ( ! $order instanceof WC_Order || ! self::is_edebit_order( $order ) ) return;
        $lifecycle = self::lifecycle( $order );
        $labels = array(
            'confirmed' => 'Payment confirmed',
            'cancelled' => 'Customer cancelled',
            'expired'   => 'Abandoned / expired',
            'failed'    => 'Payment failed',
            'pending'   => 'Awaiting customer',
        );
        printf(
            '<p class="form-field form-field-wide"><strong>eDebit lifecycle:</strong> <span data-rgv-edebit-lifecycle="%1$s">%2$s</span><br><small>Only “Payment confirmed” should be treated as a completed transaction.</small></p>',
            esc_attr( $lifecycle ),
            esc_html( $labels[ $lifecycle ] ?? $labels['pending'] )
        );
    }

    public static function add_admin_column( array $columns ): array {
        $result = array();
        foreach ( $columns as $key => $label ) {
            if ( 'order_status' === $key ) $result[ self::ADMIN_COLUMN ] = 'eDebit';
            $result[ $key ] = $label;
        }
        if ( ! isset( $result[ self::ADMIN_COLUMN ] ) ) $result[ self::ADMIN_COLUMN ] = 'eDebit';
        return $result;
    }

    public static function render_classic_admin_column( string $column, int $post_id ): void {
        if ( self::ADMIN_COLUMN !== $column ) return;
        self::render_admin_badge( wc_get_order( $post_id ) );
    }

    public static function render_hpos_admin_column( string $column, $order ): void {
        if ( self::ADMIN_COLUMN !== $column ) return;
        self::render_admin_badge( $order instanceof WC_Order ? $order : wc_get_order( $order ) );
    }

    private static function render_admin_badge( $order ): void {
        if ( ! $order instanceof WC_Order || ! self::is_edebit_order( $order ) ) {
            echo '<span class="rgv-edebit-empty">—</span>';
            return;
        }

        $lifecycle = self::lifecycle( $order );
        $labels = array(
            'confirmed' => 'Confirmed',
            'cancelled' => 'Cancelled',
            'expired'   => 'Abandoned',
            'failed'    => 'Failed',
            'pending'   => 'Awaiting customer',
        );
        printf(
            '<span class="rgv-edebit-badge is-%1$s" title="Only Confirmed is a completed payment.">%2$s</span>',
            esc_attr( $lifecycle ),
            esc_html( $labels[ $lifecycle ] ?? $labels['pending'] )
        );
    }

    public static function admin_styles(): void {
        $screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
        if ( ! $screen || ! in_array( $screen->id, array( 'edit-shop_order', 'shop_order', 'woocommerce_page_wc-orders' ), true ) ) return;
        ?>
        <style>
            th.column-rgv_edebit_lifecycle, td.column-rgv_edebit_lifecycle { width: 132px; }
            .rgv-edebit-badge { display:inline-flex; border:1px solid #c3c4c7; border-radius:999px; padding:5px 9px; background:#f6f7f7; color:#3c434a; font-size:10px; font-weight:800; line-height:1.1; white-space:nowrap; }
            .rgv-edebit-badge.is-confirmed { border-color:#00a32a; background:#edfaef; color:#006b1b; }
            .rgv-edebit-badge.is-pending { border-color:#dba617; background:#fff9db; color:#664d00; }
            .rgv-edebit-badge.is-expired, .rgv-edebit-badge.is-cancelled { border-color:#a7aaad; background:#f0f0f1; color:#50575e; }
            .rgv-edebit-badge.is-failed { border-color:#d63638; background:#fcf0f1; color:#8a2424; }
            .rgv-edebit-empty { color:#a7aaad; }
        </style>
        <?php
    }
}

register_activation_hook( __FILE__, array( 'RGV_Edebit_Guard', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'RGV_Edebit_Guard', 'deactivate' ) );

add_action(
    'plugins_loaded',
    static function (): void {
        if ( class_exists( 'WooCommerce' ) ) RGV_Edebit_Guard::init();
    }
);
