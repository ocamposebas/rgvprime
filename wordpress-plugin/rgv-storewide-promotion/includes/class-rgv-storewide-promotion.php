<?php
/**
 * Storewide promotion engine.
 *
 * @package RGV_Storewide_Promotion
 */

defined( 'ABSPATH' ) || exit;

final class RGV_Storewide_Promotion {
	private const OPTION_KEY = 'rgv_storewide_promotion';
	private const MENU_SLUG = 'rgv-storewide-promotion';
	private const REST_NAMESPACE = 'rgv-promotion/v1';

	/** @var array<string,mixed>|null */
	private static $settings = null;

	/** @var bool */
	private static $native_banner_printed = false;

	public static function activate(): void {
		if ( false === get_option( self::OPTION_KEY, false ) ) {
			add_option( self::OPTION_KEY, self::defaults(), '', false );
		}
	}

	public static function init(): void {
		add_action( 'admin_notices', array( __CLASS__, 'woocommerce_notice' ) );

		if ( ! class_exists( 'WooCommerce' ) ) {
			return;
		}

		add_action( 'admin_menu', array( __CLASS__, 'admin_menu' ), 30 );
		add_action( 'admin_post_rgv_save_storewide_promotion', array( __CLASS__, 'save_settings' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'admin_assets' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( RGV_PROMOTION_FILE ), array( __CLASS__, 'plugin_action_links' ) );

		add_action( 'rest_api_init', array( __CLASS__, 'register_rest_routes' ) );

		add_filter( 'woocommerce_product_get_price', array( __CLASS__, 'discount_product_price' ), 9999, 2 );
		add_filter( 'woocommerce_product_variation_get_price', array( __CLASS__, 'discount_product_price' ), 9999, 2 );
		add_filter( 'woocommerce_variation_prices_price', array( __CLASS__, 'discount_variation_price' ), 9999, 3 );
		add_filter( 'woocommerce_product_is_on_sale', array( __CLASS__, 'mark_product_on_sale' ), 9999, 2 );
		add_filter( 'woocommerce_get_variation_prices_hash', array( __CLASS__, 'variation_prices_hash' ), 9999, 3 );

		add_action( 'woocommerce_new_order', array( __CLASS__, 'record_campaign_on_order' ), 20, 2 );
		add_action( 'woocommerce_admin_order_data_after_order_details', array( __CLASS__, 'render_order_campaign' ) );

		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'frontend_assets' ) );
		add_action( 'wp_body_open', array( __CLASS__, 'render_native_banner' ), 5 );
		add_action( 'wp_footer', array( __CLASS__, 'render_native_banner_fallback' ), 5 );
	}

	/**
	 * @return array<string,mixed>
	 */
	private static function defaults(): array {
		return array(
			'enabled'          => false,
			'discount_percent' => 10.0,
			'starts_at'        => 0,
			'ends_at'          => 0,
			'eyebrow'          => 'LIMITED-TIME OFFER',
			'headline'         => '10% OFF STOREWIDE',
			'cta_label'        => 'SHOP NOW',
			'cta_url'          => '/shop',
			'show_native'      => true,
		);
	}

	/**
	 * @return array<string,mixed>
	 */
	public static function settings(): array {
		if ( null === self::$settings ) {
			$stored         = get_option( self::OPTION_KEY, array() );
			$stored         = is_array( $stored ) ? $stored : array();
			self::$settings = wp_parse_args( $stored, self::defaults() );
		}

		return self::$settings;
	}

	public static function campaign_status( ?int $now = null ): string {
		$settings = self::settings();
		$now      = null === $now ? time() : $now;

		if ( empty( $settings['enabled'] ) ) {
			return 'disabled';
		}

		$starts_at = absint( $settings['starts_at'] );
		$ends_at   = absint( $settings['ends_at'] );

		if ( $starts_at > 0 && $now < $starts_at ) {
			return 'scheduled';
		}

		if ( $ends_at <= 0 || $now >= $ends_at ) {
			return 'expired';
		}

		return 'active';
	}

	public static function is_active(): bool {
		return 'active' === self::campaign_status();
	}

	public static function woocommerce_notice(): void {
		if ( class_exists( 'WooCommerce' ) || ! current_user_can( 'activate_plugins' ) ) {
			return;
		}

		echo '<div class="notice notice-error"><p><strong>RGV Storewide Promotion</strong> requires WooCommerce to be installed and active.</p></div>';
	}

	public static function admin_menu(): void {
		add_submenu_page(
			'woocommerce',
			'Storewide Promotion',
			'Storewide Promotion',
			'manage_woocommerce',
			self::MENU_SLUG,
			array( __CLASS__, 'render_admin_page' )
		);
	}

	public static function plugin_action_links( array $links ): array {
		array_unshift(
			$links,
			sprintf(
				'<a href="%s">%s</a>',
				esc_url( admin_url( 'admin.php?page=' . self::MENU_SLUG ) ),
				esc_html__( 'Settings', 'rgv-storewide-promotion' )
			)
		);

		return $links;
	}

	public static function admin_assets( string $hook_suffix ): void {
		if ( 'woocommerce_page_' . self::MENU_SLUG !== $hook_suffix ) {
			return;
		}

		wp_enqueue_style(
			'rgv-storewide-promotion-admin',
			RGV_PROMOTION_URL . 'assets/admin.css',
			array(),
			RGV_PROMOTION_VERSION
		);
	}

	private static function parse_local_datetime( string $value ): int {
		$value = sanitize_text_field( wp_unslash( $value ) );

		if ( '' === $value ) {
			return 0;
		}

		try {
			$date = new DateTimeImmutable( $value, wp_timezone() );
			return $date->getTimestamp();
		} catch ( Exception $exception ) {
			return 0;
		}
	}

	private static function datetime_input_value( int $timestamp ): string {
		return $timestamp > 0 ? wp_date( 'Y-m-d\TH:i', $timestamp, wp_timezone() ) : '';
	}

	public static function save_settings(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'You are not allowed to manage this promotion.', 'rgv-storewide-promotion' ) );
		}

		check_admin_referer( 'rgv_save_storewide_promotion' );

		$enabled   = isset( $_POST['enabled'] );
		$starts_at = self::parse_local_datetime( isset( $_POST['starts_at'] ) ? (string) $_POST['starts_at'] : '' );
		$ends_at   = self::parse_local_datetime( isset( $_POST['ends_at'] ) ? (string) $_POST['ends_at'] : '' );
		$discount  = isset( $_POST['discount_percent'] ) ? (float) wc_format_decimal( wp_unslash( $_POST['discount_percent'] ) ) : 10.0;
		$discount  = max( 0.01, min( 99.0, $discount ) );

		$errors = array();

		if ( $enabled && $ends_at <= 0 ) {
			$errors[] = 'Choose an end date before activating the promotion.';
		}

		if ( $enabled && $ends_at > 0 && $ends_at <= time() ) {
			$errors[] = 'The end date must be in the future.';
		}

		if ( $starts_at > 0 && $ends_at > 0 && $starts_at >= $ends_at ) {
			$errors[] = 'The start date must be earlier than the end date.';
		}

		if ( ! empty( $errors ) ) {
			set_transient( 'rgv_promotion_errors_' . get_current_user_id(), $errors, MINUTE_IN_SECONDS );
			wp_safe_redirect( admin_url( 'admin.php?page=' . self::MENU_SLUG . '&rgv_status=error' ) );
			exit;
		}

		$headline = isset( $_POST['headline'] ) ? sanitize_text_field( wp_unslash( $_POST['headline'] ) ) : '';
		$eyebrow  = isset( $_POST['eyebrow'] ) ? sanitize_text_field( wp_unslash( $_POST['eyebrow'] ) ) : '';
		$cta      = isset( $_POST['cta_label'] ) ? sanitize_text_field( wp_unslash( $_POST['cta_label'] ) ) : '';
		$cta_url  = isset( $_POST['cta_url'] ) ? esc_url_raw( wp_unslash( $_POST['cta_url'] ) ) : '';

		$next = array(
			'enabled'          => $enabled,
			'discount_percent' => $discount,
			'starts_at'        => $starts_at,
			'ends_at'          => $ends_at,
			'eyebrow'          => '' !== $eyebrow ? $eyebrow : 'LIMITED-TIME OFFER',
			'headline'         => '' !== $headline ? $headline : self::format_percent( $discount ) . ' OFF STOREWIDE',
			'cta_label'        => '' !== $cta ? $cta : 'SHOP NOW',
			'cta_url'          => '' !== $cta_url ? $cta_url : '/shop',
			'show_native'      => isset( $_POST['show_native'] ),
		);

		update_option( self::OPTION_KEY, $next, false );
		self::$settings = $next;
		wc_delete_product_transients();

		wp_safe_redirect( admin_url( 'admin.php?page=' . self::MENU_SLUG . '&rgv_status=saved' ) );
		exit;
	}

	private static function format_percent( float $percent ): string {
		return rtrim( rtrim( number_format( $percent, 2, '.', '' ), '0' ), '.' ) . '%';
	}

	private static function status_label( string $status ): string {
		$labels = array(
			'active'    => 'Active now',
			'scheduled' => 'Scheduled',
			'expired'   => 'Expired',
			'disabled'  => 'Paused',
		);

		return $labels[ $status ] ?? 'Paused';
	}

	public static function render_admin_page(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}

		$settings = self::settings();
		$status   = self::campaign_status();
		$errors   = get_transient( 'rgv_promotion_errors_' . get_current_user_id() );
		delete_transient( 'rgv_promotion_errors_' . get_current_user_id() );
		?>
		<div class="wrap rgv-promotion-admin">
			<div class="rgv-promotion-admin__header">
				<div>
					<p class="rgv-promotion-admin__kicker">RGVPRIME / WooCommerce</p>
					<h1>Storewide Promotion</h1>
					<p>Schedule one clear offer. Prices and the countdown turn on and off together.</p>
				</div>
				<span class="rgv-status rgv-status--<?php echo esc_attr( $status ); ?>"><?php echo esc_html( self::status_label( $status ) ); ?></span>
			</div>

			<?php if ( 'saved' === ( $_GET['rgv_status'] ?? '' ) ) : // phpcs:ignore WordPress.Security.NonceVerification.Recommended ?>
				<div class="notice notice-success is-dismissible"><p>Promotion settings saved. Product caches were refreshed.</p></div>
			<?php endif; ?>

			<?php if ( is_array( $errors ) ) : ?>
				<div class="notice notice-error"><p><?php echo esc_html( implode( ' ', $errors ) ); ?></p></div>
			<?php endif; ?>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="rgv_save_storewide_promotion">
				<?php wp_nonce_field( 'rgv_save_storewide_promotion' ); ?>

				<div class="rgv-promotion-grid">
					<main class="rgv-promotion-card">
						<section class="rgv-promotion-section">
							<div class="rgv-toggle-row">
								<div>
									<h2>Campaign</h2>
									<p>Enable this only when the offer is ready to be public.</p>
								</div>
								<label class="rgv-switch">
									<input type="checkbox" name="enabled" value="1" <?php checked( ! empty( $settings['enabled'] ) ); ?>>
									<span aria-hidden="true"></span>
									<strong>Enabled</strong>
								</label>
							</div>
						</section>

						<section class="rgv-promotion-section">
							<h2>Offer details</h2>
							<div class="rgv-fields rgv-fields--two">
								<label>
									<span>Discount</span>
									<div class="rgv-input-suffix"><input type="number" name="discount_percent" min="0.01" max="99" step="0.01" required value="<?php echo esc_attr( $settings['discount_percent'] ); ?>"><b>%</b></div>
									<small>Applied to the product's current price.</small>
								</label>
								<label>
									<span>Small label</span>
									<input type="text" name="eyebrow" maxlength="40" value="<?php echo esc_attr( $settings['eyebrow'] ); ?>">
								</label>
							</div>
							<label class="rgv-field-wide">
								<span>Main announcement</span>
								<input type="text" name="headline" maxlength="80" required value="<?php echo esc_attr( $settings['headline'] ); ?>">
							</label>
						</section>

						<section class="rgv-promotion-section">
							<h2>Schedule</h2>
							<p class="rgv-section-note">Times use <strong><?php echo esc_html( wp_timezone_string() ); ?></strong>. Leave the start empty to begin as soon as you enable it.</p>
							<div class="rgv-fields rgv-fields--two">
								<label><span>Starts</span><input type="datetime-local" name="starts_at" value="<?php echo esc_attr( self::datetime_input_value( absint( $settings['starts_at'] ) ) ); ?>"></label>
								<label><span>Ends</span><input type="datetime-local" name="ends_at" required value="<?php echo esc_attr( self::datetime_input_value( absint( $settings['ends_at'] ) ) ); ?>"></label>
							</div>
						</section>

						<section class="rgv-promotion-section">
							<h2>Call to action</h2>
							<div class="rgv-fields rgv-fields--two">
								<label><span>Button label</span><input type="text" name="cta_label" maxlength="24" value="<?php echo esc_attr( $settings['cta_label'] ); ?>"></label>
								<label><span>Button URL</span><input type="text" name="cta_url" value="<?php echo esc_attr( $settings['cta_url'] ); ?>" placeholder="/shop"></label>
							</div>
							<label class="rgv-check"><input type="checkbox" name="show_native" value="1" <?php checked( ! empty( $settings['show_native'] ) ); ?>> Also show the banner on the WordPress theme storefront.</label>
						</section>
					</main>

					<aside>
						<div class="rgv-promotion-card rgv-summary">
							<p class="rgv-summary__label">Current configuration</p>
							<strong class="rgv-summary__discount"><?php echo esc_html( self::format_percent( (float) $settings['discount_percent'] ) ); ?></strong>
							<span>off storewide</span>
							<dl>
								<div><dt>Status</dt><dd><?php echo esc_html( self::status_label( $status ) ); ?></dd></div>
								<div><dt>Pricing</dt><dd>Automatic</dd></div>
								<div><dt>Expiration</dt><dd><?php echo absint( $settings['ends_at'] ) ? esc_html( wp_date( 'M j, Y · g:i a', absint( $settings['ends_at'] ), wp_timezone() ) ) : 'Not set'; ?></dd></div>
							</dl>
							<p class="rgv-summary__help">The storefront reads the public campaign endpoint. You do not need to edit product prices or remove the sale manually.</p>
						</div>
						<?php submit_button( 'Save promotion', 'primary large', 'submit', false ); ?>
					</aside>
				</div>
			</form>
		</div>
		<?php
	}

	public static function discount_product_price( $price, $product ) {
		if ( ! self::should_filter_prices() || '' === $price || null === $price ) {
			return $price;
		}

		return self::discount_value( $price );
	}

	public static function discount_variation_price( $price, $variation, $parent_product ) {
		if ( ! self::should_filter_prices() || '' === $price || null === $price ) {
			return $price;
		}

		return self::discount_value( $price );
	}

	private static function should_filter_prices(): bool {
		if ( ! self::is_active() ) {
			return false;
		}

		if ( is_admin() && ! wp_doing_ajax() && ! ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
			return false;
		}

		return true;
	}

	private static function discount_value( $price ): string {
		$base = (float) $price;
		$rate = (float) self::settings()['discount_percent'];

		if ( $base <= 0 || $rate <= 0 ) {
			return (string) $price;
		}

		return wc_format_decimal( $base * ( 1 - ( $rate / 100 ) ), wc_get_price_decimals() );
	}

	public static function mark_product_on_sale( bool $on_sale, $product ): bool {
		if ( self::should_filter_prices() && is_a( $product, 'WC_Product' ) && (float) $product->get_regular_price( 'edit' ) > 0 ) {
			return true;
		}

		return $on_sale;
	}

	public static function variation_prices_hash( array $hash, $product, bool $for_display ): array {
		$settings = self::settings();
		$hash['rgv_promotion'] = array(
			'status'   => self::campaign_status(),
			'percent'  => (float) $settings['discount_percent'],
			'starts_at'=> absint( $settings['starts_at'] ),
			'ends_at'  => absint( $settings['ends_at'] ),
		);

		return $hash;
	}

	public static function record_campaign_on_order( int $order_id, $order = null ): void {
		if ( ! self::is_active() ) {
			return;
		}

		$order = $order instanceof WC_Order ? $order : wc_get_order( $order_id );

		if ( ! $order instanceof WC_Order || $order->get_meta( '_rgv_promotion_percent', true ) ) {
			return;
		}

		$settings = self::settings();
		$order->update_meta_data( '_rgv_promotion_percent', (float) $settings['discount_percent'] );
		$order->update_meta_data( '_rgv_promotion_headline', (string) $settings['headline'] );
		$order->update_meta_data( '_rgv_promotion_ends_at', absint( $settings['ends_at'] ) );
		$order->save_meta_data();
	}

	public static function render_order_campaign( $order ): void {
		if ( ! $order instanceof WC_Order ) {
			return;
		}

		$percent = (float) $order->get_meta( '_rgv_promotion_percent', true );

		if ( $percent <= 0 ) {
			return;
		}

		printf(
			'<p class="form-field form-field-wide"><strong>Storewide promotion:</strong> %1$s applied to product prices when this order was created.</p>',
			esc_html( self::format_percent( $percent ) )
		);
	}

	public static function register_rest_routes(): void {
		register_rest_route(
			self::REST_NAMESPACE,
			'/current',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'rest_current_campaign' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	public static function rest_current_campaign( WP_REST_Request $request ): WP_REST_Response {
		$response = rest_ensure_response( self::public_campaign_data() );
		$response->header( 'Cache-Control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=60' );

		return $response;
	}

	/**
	 * @return array<string,mixed>
	 */
	private static function public_campaign_data(): array {
		$settings = self::settings();
		$status   = self::campaign_status();
		$now      = time();

		return array(
			'active'           => 'active' === $status,
			'status'           => $status,
			'discount_percent' => (float) $settings['discount_percent'],
			'eyebrow'          => (string) $settings['eyebrow'],
			'headline'         => (string) $settings['headline'],
			'cta_label'        => (string) $settings['cta_label'],
			'cta_url'          => (string) $settings['cta_url'],
			'starts_at'        => absint( $settings['starts_at'] ) > 0 ? gmdate( 'c', absint( $settings['starts_at'] ) ) : null,
			'ends_at'          => absint( $settings['ends_at'] ) > 0 ? gmdate( 'c', absint( $settings['ends_at'] ) ) : null,
			'server_time'      => gmdate( 'c', $now ),
			'remaining_seconds'=> 'active' === $status ? max( 0, absint( $settings['ends_at'] ) - $now ) : 0,
		);
	}

	public static function frontend_assets(): void {
		$settings = self::settings();

		if ( ! self::is_active() || empty( $settings['show_native'] ) ) {
			return;
		}

		wp_enqueue_style( 'rgv-storewide-promotion', RGV_PROMOTION_URL . 'assets/frontend.css', array(), RGV_PROMOTION_VERSION );
		wp_enqueue_script( 'rgv-storewide-promotion', RGV_PROMOTION_URL . 'assets/frontend.js', array(), RGV_PROMOTION_VERSION, true );
	}

	public static function render_native_banner_fallback(): void {
		if ( ! self::$native_banner_printed ) {
			self::render_native_banner();
		}
	}

	public static function render_native_banner(): void {
		$settings = self::settings();

		if ( self::$native_banner_printed || ! self::is_active() || empty( $settings['show_native'] ) ) {
			return;
		}

		self::$native_banner_printed = true;
		?>
		<aside class="rgv-promo-banner" data-rgv-promotion data-ends-at="<?php echo esc_attr( gmdate( 'c', absint( $settings['ends_at'] ) ) ); ?>" data-server-time="<?php echo esc_attr( gmdate( 'c' ) ); ?>" aria-label="Limited-time promotion">
			<div class="rgv-promo-banner__inner">
				<div class="rgv-promo-banner__copy">
					<span><?php echo esc_html( $settings['eyebrow'] ); ?></span>
					<strong><?php echo esc_html( $settings['headline'] ); ?></strong>
				</div>
				<div class="rgv-promo-banner__timer" aria-hidden="true">
					<b data-rgv-days>00</b><small>d</small><b data-rgv-hours>00</b><small>h</small><b data-rgv-minutes>00</b><small>m</small><b data-rgv-seconds>00</b><small>s</small>
				</div>
				<a href="<?php echo esc_url( $settings['cta_url'] ); ?>"><?php echo esc_html( $settings['cta_label'] ); ?></a>
				<span class="screen-reader-text" data-rgv-accessible-time>Offer ends <?php echo esc_html( wp_date( 'F j, Y \a\t g:i a T', absint( $settings['ends_at'] ), wp_timezone() ) ); ?>.</span>
			</div>
		</aside>
		<?php
	}
}

