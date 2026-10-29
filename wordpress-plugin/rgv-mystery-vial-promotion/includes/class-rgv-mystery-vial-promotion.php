<?php
/**
 * Mystery Vial campaign engine.
 *
 * @package RGV_Mystery_Vials
 */

defined( 'ABSPATH' ) || exit;

final class RGV_Mystery_Vial_Promotion {
	private const SETTINGS_OPTION = 'rgv_mystery_vial_settings';
	private const PRODUCT_OPTION = 'rgv_mystery_vial_product_id';
	private const DB_VERSION_OPTION = 'rgv_mystery_vial_db_version';
	private const SETUP_ERROR_OPTION = 'rgv_mystery_vial_setup_error';
	private const DB_VERSION = '1.0.0';
	private const MENU_SLUG = 'rgv-mystery-vials';
	private const REST_NAMESPACE = 'rgv-mystery/v1';
	private const LOCK_NAME = 'rgv_mystery_vial_allocation_v1';
	private const GIFT_ITEM_META = '_rgv_mystery_vial_gift';
	private const SKU = 'RGV-MYSTERY-VIAL';

	/** @var array<string,mixed>|null */
	private static $settings = null;

	/** @var bool */
	private static $reconciling = false;

	/**
	 * Install the ledger and initial campaign configuration.
	 */
	public static function activate(): void {
		if ( false === get_option( self::SETTINGS_OPTION, false ) ) {
			add_option( self::SETTINGS_OPTION, self::defaults(), '', false );
		}

		self::install_schema();

		if ( class_exists( 'WooCommerce' ) && class_exists( 'WC_Product_Simple' ) ) {
			self::safe_ensure_product();
		}
	}

	/**
	 * Register runtime hooks.
	 */
	public static function init(): void {
		add_action( 'admin_notices', array( __CLASS__, 'woocommerce_notice' ) );
		add_action( 'admin_notices', array( __CLASS__, 'setup_error_notice' ) );

		if ( ! class_exists( 'WooCommerce' ) ) {
			return;
		}

		self::maybe_upgrade();
		self::safe_ensure_product();

		add_action( 'admin_menu', array( __CLASS__, 'admin_menu' ), 35 );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'admin_assets' ) );
		add_action( 'admin_post_rgv_save_mystery_vials', array( __CLASS__, 'save_settings' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( RGV_MYSTERY_VIALS_FILE ), array( __CLASS__, 'plugin_action_links' ) );
		add_action( 'rest_api_init', array( __CLASS__, 'register_rest_routes' ) );

		// Cover standard checkout, Store API checkout, REST-created orders, and the
		// custom RGV checkout bridges before inventory reservation occurs.
		add_action( 'woocommerce_before_order_object_save', array( __CLASS__, 'before_order_save' ), 8, 2 );
		add_action( 'woocommerce_checkout_order_created', array( __CLASS__, 'checkout_order_created' ), 5, 1 );
		add_action( 'woocommerce_store_api_checkout_order_processed', array( __CLASS__, 'checkout_order_created' ), 5, 1 );
		add_action( 'woocommerce_rest_insert_shop_order_object', array( __CLASS__, 'rest_order_inserted' ), 5, 3 );

		add_action( 'woocommerce_payment_complete', array( __CLASS__, 'payment_complete' ), 5, 1 );
		add_action( 'woocommerce_order_status_changed', array( __CLASS__, 'order_status_changed' ), 5, 4 );
		add_action( 'woocommerce_before_delete_order', array( __CLASS__, 'before_delete_order' ), 5, 1 );

		add_filter( 'woocommerce_is_purchasable', array( __CLASS__, 'prevent_direct_purchase' ), 20, 2 );
		add_filter( 'woocommerce_product_is_visible', array( __CLASS__, 'hide_product' ), 20, 2 );
		add_filter( 'woocommerce_add_to_cart_validation', array( __CLASS__, 'block_direct_add_to_cart' ), 20, 3 );

		add_action( 'woocommerce_admin_order_data_after_order_details', array( __CLASS__, 'render_order_award' ) );
	}

	/**
	 * @return array<string,mixed>
	 */
	private static function defaults(): array {
		return array(
			'enabled'           => true,
			'inventory_limit'   => 150,
			'tier_one_spend'    => 60.0,
			'tier_one_quantity' => 1,
			'tier_two_spend'    => 150.0,
			'tier_two_quantity' => 2,
			'product_name'      => 'Mystery Vial Complimentary',
			'product_sku'       => self::SKU,
		);
	}

	/**
	 * @return array<string,mixed>
	 */
	public static function settings(): array {
		if ( null === self::$settings ) {
			$stored = get_option( self::SETTINGS_OPTION, array() );
			self::$settings = wp_parse_args( is_array( $stored ) ? $stored : array(), self::defaults() );
		}

		return self::$settings;
	}

	private static function table_name(): string {
		global $wpdb;
		return $wpdb->prefix . 'rgv_mystery_vial_awards';
	}

	private static function install_schema(): void {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$table = self::table_name();
		$charset_collate = $wpdb->get_charset_collate();
		$sql = "CREATE TABLE {$table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			order_id bigint(20) unsigned NOT NULL,
			quantity smallint(5) unsigned NOT NULL DEFAULT 0,
			state varchar(20) NOT NULL DEFAULT 'allocated',
			net_subtotal decimal(18,4) NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY order_id (order_id),
			KEY state (state)
		) {$charset_collate};";

		dbDelta( $sql );
		update_option( self::DB_VERSION_OPTION, self::DB_VERSION, false );
	}

	private static function maybe_upgrade(): void {
		if ( self::DB_VERSION !== (string) get_option( self::DB_VERSION_OPTION, '' ) ) {
			self::install_schema();
		}
	}

	public static function woocommerce_notice(): void {
		if ( class_exists( 'WooCommerce' ) || ! current_user_can( 'activate_plugins' ) ) {
			return;
		}

		echo '<div class="notice notice-error"><p><strong>RGV Mystery Vial Promotion</strong> requires WooCommerce.</p></div>';
	}

	public static function setup_error_notice(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}

		$error = get_option( self::SETUP_ERROR_OPTION, array() );
		if ( ! is_array( $error ) || empty( $error['message'] ) ) {
			return;
		}

		echo '<div class="notice notice-error"><p><strong>RGV Mystery Vial Promotion:</strong> ' . esc_html( (string) $error['message'] ) . '</p></div>';
	}

	private static function safe_ensure_product() {
		try {
			$product = self::ensure_product();
			if ( $product instanceof WC_Product ) {
				delete_option( self::SETUP_ERROR_OPTION );
			}
			return $product;
		} catch ( Throwable $error ) {
			update_option(
				self::SETUP_ERROR_OPTION,
				array(
					'message' => 'The fulfillment product could not be prepared. The campaign is paused until this is resolved.',
					'detail'  => sanitize_text_field( $error->getMessage() ),
					'time'    => gmdate( 'c' ),
				),
				false
			);
			if ( function_exists( 'wc_get_logger' ) ) {
				wc_get_logger()->error(
					'Mystery Vial product setup failed: ' . $error->getMessage(),
					array( 'source' => 'rgv-mystery-vials' )
				);
			}
			return false;
		}
	}

	/**
	 * Create or repair the hidden physical fulfillment product.
	 */
	private static function ensure_product() {
		if ( ! class_exists( 'WC_Product_Simple' ) ) {
			return false;
		}

		$product_id = absint( get_option( self::PRODUCT_OPTION, 0 ) );
		$product = $product_id ? wc_get_product( $product_id ) : false;
		$sku_product_id = absint( wc_get_product_id_by_sku( self::SKU ) );

		// The stored option can be stale after an interrupted activation. Always
		// prefer the product that already owns the fulfillment SKU so WooCommerce
		// never receives a duplicate-SKU assignment.
		if ( $sku_product_id > 0 && ( ! $product instanceof WC_Product || $product->get_id() !== $sku_product_id ) ) {
			$product_id = $sku_product_id;
			$product = wc_get_product( $product_id );
		}

		if ( ! $product instanceof WC_Product ) {
			$product = new WC_Product_Simple();
		}

		$settings = self::settings();
		$product->set_name( sanitize_text_field( (string) $settings['product_name'] ) );
		$product->set_status( 'publish' );
		$product->set_catalog_visibility( 'hidden' );
		$product->set_regular_price( '0' );
		$product->set_sale_price( '' );
		$product->set_price( '0' );
		$product->set_tax_status( 'none' );
		$product->set_virtual( false );
		$product->set_manage_stock( false );
		$product->set_stock_status( 'instock' );
		$product->set_backorders( 'no' );
		$product->set_sold_individually( false );
		$product->set_description( 'Complimentary physical Mystery Vial awarded automatically by the limited RGVPRIME promotion.' );

		if ( self::SKU !== (string) $product->get_sku( 'edit' ) ) {
			$product->set_sku( self::SKU );
		}

		$product_id = $product->get_id();
		if ( $product_id <= 0 || $product->get_changes() ) {
			$product_id = $product->save();
		}
		update_option( self::PRODUCT_OPTION, $product_id, false );

		return $product;
	}

	private static function product_id(): int {
		return absint( get_option( self::PRODUCT_OPTION, 0 ) );
	}

	public static function prevent_direct_purchase( bool $purchasable, $product ): bool {
		return $product instanceof WC_Product && self::product_id() === $product->get_id() ? false : $purchasable;
	}

	public static function hide_product( bool $visible, int $product_id ): bool {
		return self::product_id() === $product_id ? false : $visible;
	}

	public static function block_direct_add_to_cart( bool $valid, int $product_id, int $quantity ): bool {
		unset( $quantity );
		if ( self::product_id() === $product_id ) {
			wc_add_notice( 'Mystery Vials are complimentary and are added automatically to eligible orders.', 'notice' );
			return false;
		}

		return $valid;
	}

	/**
	 * Calculate product spend after discounts, before shipping, fees, and tax.
	 */
	private static function net_merchandise_subtotal( WC_Order $order ): float {
		$line_total = 0.0;
		$line_subtotal = 0.0;

		foreach ( $order->get_items( 'line_item' ) as $item ) {
			if ( ! $item instanceof WC_Order_Item_Product || self::is_gift_item( $item ) ) {
				continue;
			}
			$line_total += max( 0.0, (float) $item->get_total() );
			$line_subtotal += max( 0.0, (float) $item->get_subtotal() );
		}

		// Standard checkout stores coupon discounts in line totals. Some REST
		// order paths provide a coupon line while leaving product totals at their
		// pre-coupon value. Taking the lower authoritative result handles both
		// representations without ever subtracting the same coupon twice.
		$subtotal_after_order_discount = max( 0.0, $line_subtotal - max( 0.0, (float) $order->get_discount_total() ) );
		$net = min( $line_total, $subtotal_after_order_discount );

		return (float) wc_format_decimal( $net, wc_get_price_decimals() );
	}

	private static function desired_quantity( float $net_subtotal ): int {
		$settings = self::settings();
		if ( empty( $settings['enabled'] ) ) {
			return 0;
		}

		if ( $net_subtotal + 0.0001 >= (float) $settings['tier_two_spend'] ) {
			return max( 0, absint( $settings['tier_two_quantity'] ) );
		}

		if ( $net_subtotal + 0.0001 >= (float) $settings['tier_one_spend'] ) {
			return max( 0, absint( $settings['tier_one_quantity'] ) );
		}

		return 0;
	}

	private static function has_merchandise( WC_Order $order ): bool {
		foreach ( $order->get_items( 'line_item' ) as $item ) {
			if ( $item instanceof WC_Order_Item_Product && ! self::is_gift_item( $item ) ) {
				return true;
			}
		}
		return false;
	}

	private static function is_gift_item( WC_Order_Item_Product $item ): bool {
		return 'yes' === (string) $item->get_meta( self::GIFT_ITEM_META, true ) || self::product_id() === $item->get_product_id();
	}

	private static function order_is_closed( WC_Order $order ): bool {
		return $order->has_status( array( 'failed', 'cancelled', 'refunded', 'trash' ) );
	}

	private static function order_consumes_allocation( WC_Order $order ): bool {
		return $order->is_paid() || $order->has_status( array( 'processing', 'completed' ) );
	}

	/**
	 * Award or reconcile a Mystery Vial line on an order.
	 *
	 * @param WC_Order|int $order Order object or ID.
	 * @return int Quantity awarded.
	 */
	public static function apply_to_order( $order ): int {
		$order = $order instanceof WC_Order ? $order : wc_get_order( absint( $order ) );
		if ( ! $order instanceof WC_Order || $order->get_id() <= 0 || self::$reconciling || ! self::has_merchandise( $order ) ) {
			return 0;
		}

		self::$reconciling = true;
		$net_subtotal = self::net_merchandise_subtotal( $order );
		$desired = self::order_is_closed( $order ) ? 0 : self::desired_quantity( $net_subtotal );
		$consumed = self::order_consumes_allocation( $order );
		$previous = self::allocation_for_order( $order->get_id() );

		try {
			$quantity = self::allocate_quantity( $order->get_id(), $desired, $net_subtotal, $consumed );
			self::sync_order_item( $order, $quantity, $net_subtotal );
			self::$reconciling = false;
			return $quantity;
		} catch ( Throwable $error ) {
			self::restore_allocation( $order->get_id(), $previous );
			self::$reconciling = false;
			if ( function_exists( 'wc_get_logger' ) ) {
				wc_get_logger()->error(
					'Mystery Vial award could not be synchronized: ' . $error->getMessage(),
					array( 'source' => 'rgv-mystery-vials', 'order_id' => $order->get_id() )
				);
			}
			return 0;
		}
	}

	/**
	 * Concurrency-safe allocation. Active and consumed rows both count toward
	 * the 150-vial cap. Released rows do not.
	 */
	private static function allocate_quantity( int $order_id, int $desired, float $net_subtotal, bool $consumed ): int {
		global $wpdb;
		$table = self::table_name();

		if ( ! self::acquire_lock() ) {
			$existing = self::allocation_for_order( $order_id );
			return $existing && in_array( $existing['state'], array( 'allocated', 'consumed' ), true ) ? absint( $existing['quantity'] ) : 0;
		}

		try {
			$existing = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE order_id = %d", $order_id ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared

			if ( is_array( $existing ) && 'consumed' === (string) $existing['state'] ) {
				return absint( $existing['quantity'] );
			}

			$limit = max( 0, absint( self::settings()['inventory_limit'] ) );
			$used_elsewhere = absint(
				$wpdb->get_var(
					$wpdb->prepare(
						"SELECT COALESCE(SUM(quantity), 0) FROM {$table} WHERE state IN ('allocated','consumed') AND order_id <> %d", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
						$order_id
					)
				)
			);

			$quantity = min( max( 0, $desired ), max( 0, $limit - $used_elsewhere ) );
			$state = $quantity > 0 ? ( $consumed ? 'consumed' : 'allocated' ) : 'released';
			$now = current_time( 'mysql', true );

			if ( is_array( $existing ) ) {
				$wpdb->update(
					$table,
					array(
						'quantity'     => $quantity,
						'state'        => $state,
						'net_subtotal' => $net_subtotal,
						'updated_at'   => $now,
					),
					array( 'order_id' => $order_id ),
					array( '%d', '%s', '%f', '%s' ),
					array( '%d' )
				);
			} elseif ( $quantity > 0 ) {
				$wpdb->insert(
					$table,
					array(
						'order_id'     => $order_id,
						'quantity'     => $quantity,
						'state'        => $state,
						'net_subtotal' => $net_subtotal,
						'created_at'   => $now,
						'updated_at'   => $now,
					),
					array( '%d', '%d', '%s', '%f', '%s', '%s' )
				);
			}

			return $quantity;
		} finally {
			self::release_lock();
		}
	}

	private static function acquire_lock(): bool {
		global $wpdb;
		return '1' === (string) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', self::LOCK_NAME, 5 ) );
	}

	private static function release_lock(): void {
		global $wpdb;
		$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', self::LOCK_NAME ) );
	}

	/**
	 * @return array<string,mixed>|null
	 */
	private static function allocation_for_order( int $order_id ): ?array {
		global $wpdb;
		$table = self::table_name();
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE order_id = %d", $order_id ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		return is_array( $row ) ? $row : null;
	}

	/**
	 * Restore the prior ledger state if the WooCommerce order item write fails.
	 *
	 * @param array<string,mixed>|null $previous Previous row.
	 */
	private static function restore_allocation( int $order_id, ?array $previous ): void {
		global $wpdb;
		$table = self::table_name();
		if ( ! self::acquire_lock() ) {
			return;
		}

		try {
			if ( $previous ) {
				$wpdb->update(
					$table,
					array(
						'quantity'     => absint( $previous['quantity'] ),
						'state'        => sanitize_key( (string) $previous['state'] ),
						'net_subtotal' => (float) $previous['net_subtotal'],
						'updated_at'   => current_time( 'mysql', true ),
					),
					array( 'order_id' => $order_id ),
					array( '%d', '%s', '%f', '%s' ),
					array( '%d' )
				);
			} else {
				$wpdb->delete( $table, array( 'order_id' => $order_id ), array( '%d' ) );
			}
		} finally {
			self::release_lock();
		}
	}

	private static function sync_order_item( WC_Order $order, int $quantity, float $net_subtotal ): void {
		$product = self::safe_ensure_product();
		if ( $quantity > 0 && ! $product instanceof WC_Product ) {
			throw new RuntimeException( 'Mystery Vial fulfillment product is unavailable.' );
		}

		$gift_items = array();
		foreach ( $order->get_items( 'line_item' ) as $item_id => $item ) {
			if ( $item instanceof WC_Order_Item_Product && self::is_gift_item( $item ) ) {
				$gift_items[ $item_id ] = $item;
			}
		}

		if ( $quantity <= 0 ) {
			foreach ( array_keys( $gift_items ) as $item_id ) {
				$order->remove_item( $item_id );
			}
			$order->delete_meta_data( '_rgv_mystery_vial_quantity' );
			$order->delete_meta_data( '_rgv_mystery_vial_net_subtotal' );
			return;
		}

		$item = reset( $gift_items );
		if ( ! $item instanceof WC_Order_Item_Product ) {
			$item = new WC_Order_Item_Product();
			$item->set_product( $product );
			$order->add_item( $item );
		}

		$item->set_name( sanitize_text_field( (string) self::settings()['product_name'] ) );
		$item->set_quantity( $quantity );
		$item->set_subtotal( 0 );
		$item->set_total( 0 );
		$item->set_subtotal_tax( 0 );
		$item->set_total_tax( 0 );
		$item->add_meta_data( self::GIFT_ITEM_META, 'yes', true );
		$item->add_meta_data( '_rgv_mystery_vial_sku', self::SKU, true );
		$item->add_meta_data( '_rgv_mystery_vial_campaign', 'limited-150', true );
		$item->save();

		$kept_id = $item->get_id();
		foreach ( array_keys( $gift_items ) as $item_id ) {
			if ( (int) $item_id !== (int) $kept_id ) {
				$order->remove_item( $item_id );
			}
		}

		$order->update_meta_data( '_rgv_mystery_vial_quantity', $quantity );
		$order->update_meta_data( '_rgv_mystery_vial_net_subtotal', $net_subtotal );
		$order->update_meta_data( '_rgv_mystery_vial_sku', self::SKU );

		if ( 'yes' !== (string) $order->get_meta( '_rgv_mystery_vial_note_added', true ) ) {
			$order->add_order_note(
				sprintf(
					'Mystery Vial promotion: %d complimentary vial(s) awarded at a net merchandise subtotal of %s. Fulfillment SKU: %s.',
					$quantity,
					wc_price( $net_subtotal ),
					self::SKU
				)
			);
			$order->update_meta_data( '_rgv_mystery_vial_note_added', 'yes' );
		}
	}

	public static function before_order_save( $order, $data_store ): void {
		unset( $data_store );
		if ( $order instanceof WC_Order ) {
			self::apply_to_order( $order );
		}
	}

	public static function checkout_order_created( $order ): void {
		if ( ! $order instanceof WC_Order ) {
			return;
		}
		self::apply_to_order( $order );
		if ( ! self::$reconciling ) {
			self::$reconciling = true;
			$order->save();
			self::$reconciling = false;
		}
	}

	public static function rest_order_inserted( $order, $request, $creating ): void {
		unset( $request );
		if ( $creating && $order instanceof WC_Order ) {
			self::checkout_order_created( $order );
		}
	}

	public static function payment_complete( int $order_id ): void {
		$order = wc_get_order( $order_id );
		if ( $order instanceof WC_Order ) {
			self::apply_to_order( $order );
			self::mark_consumed( $order_id );
		}
	}

	public static function order_status_changed( int $order_id, string $from, string $to, $order ): void {
		unset( $from );
		$order = $order instanceof WC_Order ? $order : wc_get_order( $order_id );
		if ( ! $order instanceof WC_Order ) {
			return;
		}

		if ( in_array( $to, array( 'processing', 'completed' ), true ) ) {
			self::apply_to_order( $order );
			self::mark_consumed( $order_id );
			return;
		}

		if ( in_array( $to, array( 'failed', 'cancelled', 'refunded' ), true ) ) {
			self::release_unconsumed( $order );
		}
	}

	private static function mark_consumed( int $order_id ): void {
		global $wpdb;
		$wpdb->update(
			self::table_name(),
			array( 'state' => 'consumed', 'updated_at' => current_time( 'mysql', true ) ),
			array( 'order_id' => $order_id, 'state' => 'allocated' ),
			array( '%s', '%s' ),
			array( '%d', '%s' )
		);
	}

	private static function release_unconsumed( WC_Order $order ): void {
		global $wpdb;
		$row = self::allocation_for_order( $order->get_id() );
		if ( ! $row || 'allocated' !== (string) $row['state'] ) {
			return;
		}

		if ( self::acquire_lock() ) {
			try {
				$wpdb->update(
					self::table_name(),
					array( 'quantity' => 0, 'state' => 'released', 'updated_at' => current_time( 'mysql', true ) ),
					array( 'order_id' => $order->get_id(), 'state' => 'allocated' ),
					array( '%d', '%s', '%s' ),
					array( '%d', '%s' )
				);
			} finally {
				self::release_lock();
			}
		}

		if ( ! self::$reconciling ) {
			self::$reconciling = true;
			self::sync_order_item( $order, 0, self::net_merchandise_subtotal( $order ) );
			$order->save();
			self::$reconciling = false;
		}
	}

	public static function before_delete_order( int $order_id ): void {
		$order = wc_get_order( $order_id );
		if ( $order instanceof WC_Order ) {
			self::release_unconsumed( $order );
		}
	}

	/**
	 * @return array<string,int>
	 */
	private static function counts(): array {
		global $wpdb;
		$table = self::table_name();
		$rows = $wpdb->get_results( "SELECT state, COALESCE(SUM(quantity), 0) AS quantity FROM {$table} GROUP BY state", ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$counts = array( 'allocated' => 0, 'consumed' => 0, 'released' => 0 );

		foreach ( is_array( $rows ) ? $rows : array() as $row ) {
			$state = sanitize_key( (string) ( $row['state'] ?? '' ) );
			if ( array_key_exists( $state, $counts ) ) {
				$counts[ $state ] = absint( $row['quantity'] ?? 0 );
			}
		}

		$counts['limit'] = max( 0, absint( self::settings()['inventory_limit'] ) );
		$counts['used'] = $counts['allocated'] + $counts['consumed'];
		$counts['remaining'] = max( 0, $counts['limit'] - $counts['used'] );
		return $counts;
	}

	public static function register_rest_routes(): void {
		register_rest_route(
			self::REST_NAMESPACE,
			'/status',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'rest_status' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	public static function rest_status( WP_REST_Request $request ): WP_REST_Response {
		unset( $request );
		$settings = self::settings();
		$counts = self::counts();
		$product = self::safe_ensure_product();
		$response = rest_ensure_response(
			array(
				'active'          => ! empty( $settings['enabled'] ),
				'available'       => ! empty( $settings['enabled'] ) && $counts['remaining'] > 0 && $product instanceof WC_Product,
				'inventory_limit' => $counts['limit'],
				'remaining'       => $counts['remaining'],
				'product_name'    => (string) $settings['product_name'],
				'product_sku'     => self::SKU,
				'product_id'      => $product instanceof WC_Product ? $product->get_id() : 0,
				'tiers'           => array(
					array( 'minimum' => (float) $settings['tier_one_spend'], 'quantity' => absint( $settings['tier_one_quantity'] ) ),
					array( 'minimum' => (float) $settings['tier_two_spend'], 'quantity' => absint( $settings['tier_two_quantity'] ) ),
				),
				'calculation'     => 'discounted_merchandise_subtotal_before_shipping_fees_and_tax',
				'updated_at'      => gmdate( 'c' ),
			)
		);
		$response->header( 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0' );
		return $response;
	}

	public static function admin_menu(): void {
		add_submenu_page(
			'woocommerce',
			'Mystery Vials',
			'Mystery Vials',
			'manage_woocommerce',
			self::MENU_SLUG,
			array( __CLASS__, 'render_admin_page' )
		);
	}

	public static function admin_assets( string $hook_suffix ): void {
		if ( 'woocommerce_page_' . self::MENU_SLUG !== $hook_suffix ) {
			return;
		}
		wp_enqueue_style( 'rgv-mystery-vials-admin', RGV_MYSTERY_VIALS_URL . 'assets/admin.css', array(), RGV_MYSTERY_VIALS_VERSION );
	}

	public static function plugin_action_links( array $links ): array {
		array_unshift( $links, '<a href="' . esc_url( admin_url( 'admin.php?page=' . self::MENU_SLUG ) ) . '">Configure</a>' );
		return $links;
	}

	public static function save_settings(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'You are not allowed to manage this campaign.', 'rgv-mystery-vials' ) );
		}
		check_admin_referer( 'rgv_save_mystery_vials' );

		$tier_one = max( 0.01, (float) wc_format_decimal( wp_unslash( $_POST['tier_one_spend'] ?? 60 ) ) );
		$tier_two = max( 0.01, (float) wc_format_decimal( wp_unslash( $_POST['tier_two_spend'] ?? 150 ) ) );
		$limit = max( 1, absint( $_POST['inventory_limit'] ?? 150 ) );
		$counts = self::counts();
		$errors = array();

		if ( $tier_two <= $tier_one ) {
			$errors[] = 'The second tier must be higher than the first tier.';
		}
		if ( $limit < $counts['used'] ) {
			$errors[] = sprintf( 'Inventory cannot be lower than the %d vials already allocated or consumed.', $counts['used'] );
		}

		if ( $errors ) {
			set_transient( 'rgv_mystery_errors_' . get_current_user_id(), $errors, MINUTE_IN_SECONDS );
			wp_safe_redirect( admin_url( 'admin.php?page=' . self::MENU_SLUG . '&rgv_status=error' ) );
			exit;
		}

		$next = array(
			'enabled'           => isset( $_POST['enabled'] ),
			'inventory_limit'   => $limit,
			'tier_one_spend'    => $tier_one,
			'tier_one_quantity' => 1,
			'tier_two_spend'    => $tier_two,
			'tier_two_quantity' => 2,
			'product_name'      => 'Mystery Vial Complimentary',
			'product_sku'       => self::SKU,
		);

		update_option( self::SETTINGS_OPTION, $next, false );
		self::$settings = $next;
		self::safe_ensure_product();

		wp_safe_redirect( admin_url( 'admin.php?page=' . self::MENU_SLUG . '&rgv_status=saved' ) );
		exit;
	}

	public static function render_admin_page(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}

		global $wpdb;
		$settings = self::settings();
		$counts = self::counts();
		$product = self::safe_ensure_product();
		$errors = get_transient( 'rgv_mystery_errors_' . get_current_user_id() );
		delete_transient( 'rgv_mystery_errors_' . get_current_user_id() );
		$table = self::table_name();
		$recent = $wpdb->get_results( "SELECT * FROM {$table} ORDER BY updated_at DESC LIMIT 30", ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		?>
		<div class="wrap rgv-mystery-admin">
			<header class="rgv-mystery-admin__hero">
				<div>
					<p class="rgv-mystery-admin__kicker">RGVPRIME / Limited fulfillment campaign</p>
					<h1>Mystery Vial Promotion</h1>
					<p>One vial at $<?php echo esc_html( number_format_i18n( (float) $settings['tier_one_spend'], 2 ) ); ?> net, two at $<?php echo esc_html( number_format_i18n( (float) $settings['tier_two_spend'], 2 ) ); ?> net. Every award is a fulfillment-ready WooCommerce line item.</p>
				</div>
				<span class="rgv-mystery-admin__status"><?php echo ! empty( $settings['enabled'] ) ? 'Campaign active' : 'Campaign paused'; ?></span>
			</header>

			<?php if ( 'saved' === ( $_GET['rgv_status'] ?? '' ) ) : // phpcs:ignore WordPress.Security.NonceVerification.Recommended ?>
				<div class="notice notice-success is-dismissible"><p>Campaign settings saved.</p></div>
			<?php endif; ?>
			<?php if ( is_array( $errors ) && $errors ) : ?>
				<div class="notice notice-error"><p><?php echo esc_html( implode( ' ', $errors ) ); ?></p></div>
			<?php endif; ?>

			<div class="rgv-mystery-admin__grid">
				<form class="rgv-mystery-card" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="rgv_save_mystery_vials">
					<?php wp_nonce_field( 'rgv_save_mystery_vials' ); ?>
					<div class="rgv-mystery-toggle">
						<div><h2>Campaign rules</h2><p>Eligibility uses discounted product subtotal only.</p></div>
						<label><input type="checkbox" name="enabled" value="1" <?php checked( ! empty( $settings['enabled'] ) ); ?>> <strong>Enabled</strong></label>
					</div>
					<div class="rgv-mystery-fields">
						<label><span>Total campaign inventory</span><input type="number" name="inventory_limit" min="<?php echo esc_attr( max( 1, $counts['used'] ) ); ?>" step="1" value="<?php echo esc_attr( $settings['inventory_limit'] ); ?>"><small>Starts at 150 and never oversells.</small></label>
						<label><span>First vial threshold ($)</span><input type="number" name="tier_one_spend" min="0.01" step="0.01" value="<?php echo esc_attr( $settings['tier_one_spend'] ); ?>"><small>Awards exactly one vial.</small></label>
						<label><span>Two-vial threshold ($)</span><input type="number" name="tier_two_spend" min="0.01" step="0.01" value="<?php echo esc_attr( $settings['tier_two_spend'] ); ?>"><small>Awards two vials total, not three.</small></label>
					</div>
					<?php submit_button( 'Save campaign' ); ?>
				</form>

				<aside class="rgv-mystery-card rgv-mystery-product">
					<div class="rgv-mystery-stats">
						<div class="rgv-mystery-stat rgv-mystery-stat--remaining"><span>Remaining</span><strong><?php echo esc_html( $counts['remaining'] ); ?></strong></div>
						<div class="rgv-mystery-stat"><span>Reserved</span><strong><?php echo esc_html( $counts['allocated'] ); ?></strong></div>
						<div class="rgv-mystery-stat"><span>Consumed</span><strong><?php echo esc_html( $counts['consumed'] ); ?></strong></div>
					</div>
					<h2>Fulfillment product</h2>
					<p>This standard physical order line is what WooCommerce and Pirate Ship receive.</p>
					<dl>
						<div><dt>Name</dt><dd><?php echo esc_html( (string) $settings['product_name'] ); ?></dd></div>
						<div><dt>SKU</dt><dd><code><?php echo esc_html( self::SKU ); ?></code></dd></div>
						<div><dt>Product ID</dt><dd><?php echo $product instanceof WC_Product ? esc_html( $product->get_id() ) : 'Unavailable'; ?></dd></div>
						<div><dt>Visibility</dt><dd>Hidden physical product · $0.00</dd></div>
						<div><dt>Pirate Ship</dt><dd>Order item name, SKU, and quantity ready for import.</dd></div>
					</dl>
				</aside>

				<section class="rgv-mystery-card rgv-mystery-audit">
					<h2>Recent allocation audit</h2>
					<p>Allocated orders reserve inventory; paid Processing/Completed orders consume it; failed or cancelled unpaid orders release it.</p>
					<table class="widefat striped">
						<thead><tr><th>Order</th><th>Quantity</th><th>Net merchandise</th><th>State</th><th>Updated (UTC)</th></tr></thead>
						<tbody>
						<?php if ( ! $recent ) : ?><tr><td colspan="5">No Mystery Vials have been allocated yet.</td></tr><?php endif; ?>
						<?php foreach ( $recent as $row ) : ?>
							<tr>
								<td><a href="<?php echo esc_url( admin_url( 'admin.php?page=wc-orders&action=edit&id=' . absint( $row['order_id'] ) ) ); ?>">#<?php echo esc_html( $row['order_id'] ); ?></a></td>
								<td><?php echo esc_html( $row['quantity'] ); ?></td>
								<td><?php echo wp_kses_post( wc_price( (float) $row['net_subtotal'] ) ); ?></td>
								<td><span class="rgv-mystery-pill"><?php echo esc_html( $row['state'] ); ?></span></td>
								<td><?php echo esc_html( $row['updated_at'] ); ?></td>
							</tr>
						<?php endforeach; ?>
						</tbody>
					</table>
				</section>
			</div>
		</div>
		<?php
	}

	public static function render_order_award( $order ): void {
		if ( ! $order instanceof WC_Order ) {
			return;
		}
		$quantity = absint( $order->get_meta( '_rgv_mystery_vial_quantity', true ) );
		if ( $quantity <= 0 ) {
			return;
		}
		printf(
			'<p class="form-field form-field-wide"><strong>Mystery Vial promotion:</strong> %1$d complimentary vial(s) · SKU <code>%2$s</code> · visible to Pirate Ship as a physical order item.</p>',
			$quantity,
			esc_html( self::SKU )
		);
	}
}
