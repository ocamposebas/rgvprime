<?php
/**
 * Plugin Name: RGV Rush Processing Orders
 * Description: Highlights WooCommerce orders that purchased the 5% Rush Processing option.
 * Version: 1.0.0
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

final class RGV_Rush_Processing_Orders {
    private const COLUMN_KEY = 'rgv_rush_processing';
    private const REQUESTED_META = '_rgv_priority_processing';
    private const PAID_META = '_rgv_rush_processing_paid';
    private const NOTED_META = '_rgv_rush_processing_paid_noted';

    public static function init(): void {
        // Classic order list.
        add_filter( 'manage_edit-shop_order_columns', array( __CLASS__, 'add_column' ), 20 );
        add_action( 'manage_shop_order_posts_custom_column', array( __CLASS__, 'render_classic_column' ), 20, 2 );

        // HPOS order list.
        add_filter( 'manage_woocommerce_page_wc-orders_columns', array( __CLASS__, 'add_column' ), 20 );
        add_action( 'manage_woocommerce_page_wc-orders_custom_column', array( __CLASS__, 'render_hpos_column' ), 20, 2 );

        add_action( 'admin_head', array( __CLASS__, 'admin_styles' ) );
        add_action( 'admin_footer', array( __CLASS__, 'admin_row_highlighter' ) );
        add_action( 'woocommerce_admin_order_data_after_order_details', array( __CLASS__, 'render_order_banner' ) );

        // Persist a paid marker as soon as WooCommerce confirms payment.
        add_action( 'woocommerce_payment_complete', array( __CLASS__, 'mark_rush_paid' ), 20 );
        add_action( 'woocommerce_order_status_processing', array( __CLASS__, 'mark_rush_paid' ), 20 );
        add_action( 'woocommerce_order_status_completed', array( __CLASS__, 'mark_rush_paid' ), 20 );
    }

    public static function add_column( array $columns ): array {
        $result = array();
        $inserted = false;

        foreach ( $columns as $key => $label ) {
            if ( ! $inserted && in_array( $key, array( 'order_status', 'order_total' ), true ) ) {
                $result[ self::COLUMN_KEY ] = 'Rush';
                $inserted = true;
            }
            $result[ $key ] = $label;
        }

        if ( ! $inserted ) $result[ self::COLUMN_KEY ] = 'Rush';
        return $result;
    }

    public static function render_classic_column( string $column, int $post_id ): void {
        if ( self::COLUMN_KEY !== $column ) return;
        self::render_badge( wc_get_order( $post_id ) );
    }

    public static function render_hpos_column( string $column, $order ): void {
        if ( self::COLUMN_KEY !== $column ) return;
        self::render_badge( $order instanceof WC_Order ? $order : wc_get_order( $order ) );
    }

    private static function render_badge( $order ): void {
        if ( ! $order instanceof WC_Order || ! self::rush_requested( $order ) ) {
            echo '<span class="rgv-rush-empty">—</span>';
            return;
        }

        $paid = self::rush_paid( $order );
        printf(
            '<span class="rgv-rush-badge %1$s" data-rgv-rush="%2$s" title="%3$s">%4$s</span>',
            $paid ? 'is-paid' : 'is-pending',
            $paid ? 'paid' : 'pending',
            esc_attr( $paid ? 'Rush Processing was paid.' : 'Rush Processing requested; payment is not confirmed yet.' ),
            esc_html( $paid ? '⚡ RUSH PAID' : '⚡ RUSH PENDING' )
        );
    }

    private static function rush_requested( WC_Order $order ): bool {
        $meta = strtolower( trim( (string) $order->get_meta( self::REQUESTED_META, true ) ) );
        if ( in_array( $meta, array( 'yes', '1', 'true', 'on' ), true ) ) return true;

        foreach ( $order->get_items( 'fee' ) as $fee ) {
            $name = strtolower( wp_strip_all_tags( (string) $fee->get_name() ) );
            $matches = false !== strpos( $name, 'priority processing' ) ||
                false !== strpos( $name, 'rush processing' ) ||
                false !== strpos( $name, 'skip the line' );

            if ( $matches && (float) $fee->get_total() > 0 ) return true;
        }

        return false;
    }

    private static function rush_paid( WC_Order $order ): bool {
        return 'yes' === (string) $order->get_meta( self::PAID_META, true ) || $order->is_paid();
    }

    public static function mark_rush_paid( int $order_id ): void {
        $order = wc_get_order( $order_id );
        if ( ! $order instanceof WC_Order || ! self::rush_requested( $order ) ) return;

        $order->update_meta_data( self::PAID_META, 'yes' );
        $order->update_meta_data( '_rgv_rush_processing_paid_at', gmdate( 'c' ) );

        if ( 'yes' !== (string) $order->get_meta( self::NOTED_META, true ) ) {
            $order->update_meta_data( self::NOTED_META, 'yes' );
            $order->add_order_note( '⚡ Rush Processing (+5%) was paid. Prioritize processing; carrier delivery times are not guaranteed.' );
        }

        $order->save();
    }

    public static function render_order_banner( $order ): void {
        if ( ! $order instanceof WC_Order || ! self::rush_requested( $order ) ) return;

        $paid = self::rush_paid( $order );
        ?>
        <div class="rgv-rush-order-banner <?php echo $paid ? 'is-paid' : 'is-pending'; ?>">
            <strong><?php echo esc_html( $paid ? '⚡ RUSH PROCESSING PAID' : '⚡ RUSH PROCESSING REQUESTED' ); ?></strong>
            <span><?php echo esc_html( $paid ? 'Move this order to the front of the processing queue.' : 'Do not rush until payment is confirmed.' ); ?></span>
            <small>Processing speed only. Carrier delivery times are not guaranteed.</small>
        </div>
        <?php
    }

    public static function admin_styles(): void {
        $screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
        if ( ! $screen || ! in_array( $screen->id, array( 'edit-shop_order', 'shop_order', 'woocommerce_page_wc-orders' ), true ) ) return;
        ?>
        <style>
            th.column-rgv_rush_processing, td.column-rgv_rush_processing { width: 132px; }
            .rgv-rush-badge { display:inline-flex; align-items:center; border-radius:999px; padding:5px 9px; font-size:10px; font-weight:800; line-height:1; letter-spacing:.04em; white-space:nowrap; }
            .rgv-rush-badge.is-paid { border:1px solid #e65100; background:#ff6d00; color:#fff; box-shadow:0 3px 12px rgba(230,81,0,.24); }
            .rgv-rush-badge.is-pending { border:1px solid #dba617; background:#fff4c2; color:#664d00; }
            .rgv-rush-empty { color:#a7aaad; }
            tr.rgv-rush-paid > th, tr.rgv-rush-paid > td { background:#fff4e8 !important; }
            tr.rgv-rush-paid > th:first-child, tr.rgv-rush-paid > td:first-child { box-shadow:inset 5px 0 0 #ff6d00; }
            tr.rgv-rush-pending > th, tr.rgv-rush-pending > td { background:#fffbed !important; }
            .rgv-rush-order-banner { clear:both; display:grid; gap:4px; margin:18px 0 8px; border-radius:8px; padding:14px 16px; }
            .rgv-rush-order-banner.is-paid { border:2px solid #ef6c00; background:#fff3e0; color:#6d2b00; }
            .rgv-rush-order-banner.is-pending { border:1px solid #dba617; background:#fff9db; color:#5f4900; }
            .rgv-rush-order-banner strong { font-size:15px; }
            .rgv-rush-order-banner span { font-weight:600; }
            .rgv-rush-order-banner small { opacity:.78; }
        </style>
        <?php
    }

    public static function admin_row_highlighter(): void {
        $screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
        if ( ! $screen || ! in_array( $screen->id, array( 'edit-shop_order', 'woocommerce_page_wc-orders' ), true ) ) return;
        ?>
        <script>
            document.querySelectorAll('.rgv-rush-badge[data-rgv-rush]').forEach(function (badge) {
                var row = badge.closest('tr');
                if (row) row.classList.add(badge.dataset.rgvRush === 'paid' ? 'rgv-rush-paid' : 'rgv-rush-pending');
            });
        </script>
        <?php
    }
}

add_action(
    'plugins_loaded',
    static function (): void {
        if ( class_exists( 'WooCommerce' ) ) RGV_Rush_Processing_Orders::init();
    }
);
