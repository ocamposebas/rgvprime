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
		add_filter( 'woocommerce_product_get_sale_price', array( __CLASS__, 'discount_product_price' ), 9999, 2 );
		add_filter( 'woocommerce_product_variation_get_sale_price', array( __CLASS__, 'discount_product_price' ), 9999, 2 );
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
			'scope'            => 'announcement',
			'product_id'       => 0,
			'discount_percent' => 0.0,
			'starts_at'        => 0,
			'ends_at'          => 0,
			'eyebrow'          => 'ANNOUNCEMENT',
			'headline'         => 'WELCOME TO RGVPRIME',
			'cta_label'        => '',
			'cta_url'          => '',
			'show_countdown'   => false,
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
			if ( ! array_key_exists( 'scope', $stored ) ) {
				$stored['scope'] = 'storewide';
			}
			if ( ! array_key_exists( 'show_countdown', $stored ) ) {
				$stored['show_countdown'] = absint( $stored['ends_at'] ?? 0 ) > 0;
			}
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

		if ( 'product' === (string) $settings['scope'] && ! self::campaign_product( $settings ) instanceof WC_Product ) {
			return 'invalid';
		}

		$starts_at = absint( $settings['starts_at'] );
		$ends_at   = absint( $settings['ends_at'] );

		if ( $starts_at > 0 && $now < $starts_at ) {
			return 'scheduled';
		}

		if ( $ends_at > 0 && $now >= $ends_at ) {
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

		echo '<div class="notice notice-error"><p><strong>RGV Ofertas y Anuncios</strong> necesita WooCommerce activo.</p></div>';
	}

	public static function admin_menu(): void {
		add_submenu_page(
			'woocommerce',
			'Ofertas y anuncios',
			'Ofertas y anuncios',
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
				esc_html__( 'Configurar', 'rgv-storewide-promotion' )
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
		wp_enqueue_script(
			'rgv-storewide-promotion-admin',
			RGV_PROMOTION_URL . 'assets/admin.js',
			array(),
			RGV_PROMOTION_VERSION,
			true
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
		$scope     = isset( $_POST['scope'] ) ? sanitize_key( wp_unslash( $_POST['scope'] ) ) : 'announcement';
		$scope     = in_array( $scope, array( 'announcement', 'product', 'storewide' ), true ) ? $scope : 'announcement';
		$product_id = isset( $_POST['product_id'] ) ? absint( $_POST['product_id'] ) : 0;
		$starts_at = self::parse_local_datetime( isset( $_POST['starts_at'] ) ? (string) $_POST['starts_at'] : '' );
		$ends_at   = self::parse_local_datetime( isset( $_POST['ends_at'] ) ? (string) $_POST['ends_at'] : '' );
		$discount  = isset( $_POST['discount_percent'] ) ? (float) wc_format_decimal( wp_unslash( $_POST['discount_percent'] ) ) : 10.0;
		$discount  = 'announcement' === $scope ? 0.0 : max( 0.01, min( 99.0, $discount ) );
		$show_countdown = isset( $_POST['show_countdown'] );

		$errors = array();
		$target_product = $product_id > 0 ? wc_get_product( $product_id ) : false;

		if ( 'product' === $scope && ! $target_product instanceof WC_Product ) {
			$errors[] = 'Selecciona el producto que tendrá el descuento.';
		}

		if ( 'product' === $scope && $target_product instanceof WC_Product && $target_product->is_type( 'variation' ) ) {
			$product_id     = $target_product->get_parent_id();
			$target_product = wc_get_product( $product_id );
		}

		if ( 'product' === $scope && ! $target_product instanceof WC_Product && empty( $errors ) ) {
			$errors[] = 'El producto seleccionado ya no está disponible.';
		}

		if ( $enabled && $show_countdown && $ends_at <= 0 ) {
			$errors[] = 'Para mostrar el contador debes seleccionar una fecha de finalización.';
		}

		if ( $enabled && $ends_at > 0 && $ends_at <= time() ) {
			$errors[] = 'La fecha de finalización debe estar en el futuro.';
		}

		if ( $starts_at > 0 && $ends_at > 0 && $starts_at >= $ends_at ) {
			$errors[] = 'La fecha de inicio debe ser anterior a la fecha de finalización.';
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

		if ( 'product' === $scope && '/shop' === untrailingslashit( $cta_url ) ) {
			$cta_url = '';
		}

		$is_storewide_default = 1 === preg_match( '/^\d+(?:\.\d+)?% OFF STOREWIDE$/i', $headline );
		if ( '' === $headline || ( 'product' === $scope && $is_storewide_default ) ) {
			$headline = self::default_headline( $discount, $scope, $target_product );
		}

		if ( 'announcement' === $scope && '' === $headline ) {
			$headline = 'WELCOME TO RGVPRIME';
		}

		$next = array(
			'enabled'          => $enabled,
			'scope'            => $scope,
			'product_id'       => 'product' === $scope ? $product_id : 0,
			'discount_percent' => $discount,
			'starts_at'        => $starts_at,
			'ends_at'          => $ends_at,
			'eyebrow'          => '' !== $eyebrow ? $eyebrow : ( 'announcement' === $scope ? 'ANNOUNCEMENT' : 'LIMITED-TIME OFFER' ),
			'headline'         => $headline,
			'cta_label'        => $cta,
			'cta_url'          => $cta_url,
			'show_countdown'   => $show_countdown,
			'show_native'      => isset( $_POST['show_native'] ),
		);

		update_option( self::OPTION_KEY, $next, false );
		self::$settings = $next;
		wc_delete_product_transients();

		wp_safe_redirect( admin_url( 'admin.php?page=' . self::MENU_SLUG . '&rgv_status=saved' ) );
		exit;
	}

	private static function default_headline( float $discount, string $scope, $product = false ): string {
		if ( 'announcement' === $scope ) {
			return 'WELCOME TO RGVPRIME';
		}

		if ( 'product' === $scope && $product instanceof WC_Product ) {
			return wp_html_excerpt( self::format_percent( $discount ) . ' OFF ' . wp_strip_all_tags( $product->get_name() ), 80, '' );
		}

		return self::format_percent( $discount ) . ' OFF STOREWIDE';
	}

	private static function format_percent( float $percent ): string {
		return rtrim( rtrim( number_format( $percent, 2, '.', '' ), '0' ), '.' ) . '%';
	}

	private static function campaign_product( ?array $settings = null ) {
		$settings = is_array( $settings ) ? $settings : self::settings();

		if ( 'product' !== (string) $settings['scope'] || absint( $settings['product_id'] ) <= 0 ) {
			return false;
		}

		return wc_get_product( absint( $settings['product_id'] ) );
	}

	private static function campaign_target_label( ?array $settings = null ): string {
		$settings = is_array( $settings ) ? $settings : self::settings();
		$product  = self::campaign_product( $settings );

		if ( $product instanceof WC_Product ) {
			return $product->get_name();
		}

		return 'announcement' === (string) $settings['scope'] ? 'Solo mensaje' : 'Toda la tienda';
	}

	private static function is_discount_campaign( ?array $settings = null ): bool {
		$settings = is_array( $settings ) ? $settings : self::settings();

		return in_array( (string) $settings['scope'], array( 'product', 'storewide' ), true );
	}

	private static function campaign_cta_url( ?array $settings = null ): string {
		$settings = is_array( $settings ) ? $settings : self::settings();
		$custom   = trim( (string) $settings['cta_url'] );

		if ( '' !== $custom ) {
			return $custom;
		}

		$product = self::campaign_product( $settings );

		if ( $product instanceof WC_Product ) {
			return $product->get_permalink();
		}

		return 'storewide' === (string) $settings['scope'] || '' !== (string) $settings['cta_label'] ? '/shop' : '';
	}

	private static function status_label( string $status ): string {
		$labels = array(
			'active'    => 'Publicado',
			'scheduled' => 'Programado',
			'expired'   => 'Finalizado',
			'invalid'   => 'Producto no disponible',
			'disabled'  => 'Desactivado',
		);

		return $labels[ $status ] ?? 'Desactivado';
	}

	public static function render_admin_page(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}

		$settings = self::settings();
		$status   = self::campaign_status();
		$scope    = in_array( (string) $settings['scope'], array( 'announcement', 'product', 'storewide' ), true ) ? (string) $settings['scope'] : 'announcement';
		$product  = self::campaign_product( $settings );
		$products = wc_get_products(
			array(
				'status'  => array( 'publish', 'private' ),
				'limit'   => -1,
				'orderby' => 'name',
				'order'   => 'ASC',
				'return'  => 'objects',
			)
		);
		$products = is_array( $products ) ? array_filter( $products, static function ( $item ) { return $item instanceof WC_Product; } ) : array();
		$errors   = get_transient( 'rgv_promotion_errors_' . get_current_user_id() );
		delete_transient( 'rgv_promotion_errors_' . get_current_user_id() );
		?>
		<div class="wrap rgv-promotion-admin">
			<div class="rgv-promotion-admin__header">
				<div>
					<p class="rgv-promotion-admin__kicker">RGVPRIME / WooCommerce</p>
					<h1>Ofertas y anuncios</h1>
					<p>Publica un mensaje o activa un descuento desde una sola pantalla.</p>
				</div>
				<span class="rgv-status rgv-status--<?php echo esc_attr( $status ); ?>"><?php echo esc_html( self::status_label( $status ) ); ?></span>
			</div>

			<?php if ( 'saved' === ( $_GET['rgv_status'] ?? '' ) ) : // phpcs:ignore WordPress.Security.NonceVerification.Recommended ?>
				<div class="notice notice-success is-dismissible"><p>Los cambios se guardaron correctamente y la tienda fue actualizada.</p></div>
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
									<h2>Publicar banner</h2>
									<p>Actívalo cuando el mensaje esté listo para aparecer en la web.</p>
								</div>
								<label class="rgv-switch">
									<input type="checkbox" name="enabled" value="1" <?php checked( ! empty( $settings['enabled'] ) ); ?>>
									<span aria-hidden="true"></span>
									<strong>Activo</strong>
								</label>
							</div>
						</section>

						<section class="rgv-promotion-section">
							<h2>1. ¿Qué quieres publicar?</h2>
							<div class="rgv-campaign-types">
								<label>
									<input type="radio" name="scope" value="announcement" data-rgv-promotion-scope <?php checked( 'announcement', $scope ); ?>>
									<span><strong>Solo un mensaje</strong><small>Ejemplo: “Llegó más stock” o “Feliz lunes”. No cambia precios.</small></span>
								</label>
								<label>
									<input type="radio" name="scope" value="product" data-rgv-promotion-scope <?php checked( 'product', $scope ); ?>>
									<span><strong>Oferta de un producto</strong><small>Descuenta un producto y todas sus presentaciones.</small></span>
								</label>
								<label>
									<input type="radio" name="scope" value="storewide" data-rgv-promotion-scope <?php checked( 'storewide', $scope ); ?>>
									<span><strong>Oferta de toda la tienda</strong><small>Aplica el mismo descuento a todos los productos.</small></span>
								</label>
							</div>

							<label class="rgv-field-wide rgv-product-target" data-rgv-product-target <?php echo 'product' === $scope ? '' : 'hidden'; ?>>
								<span>Selecciona el producto</span>
								<select name="product_id">
									<option value="">Seleccionar producto…</option>
									<?php foreach ( $products as $available_product ) : ?>
										<option value="<?php echo esc_attr( $available_product->get_id() ); ?>" <?php selected( absint( $settings['product_id'] ), $available_product->get_id() ); ?>><?php echo esc_html( $available_product->get_name() . ' (#' . $available_product->get_id() . ')' ); ?></option>
									<?php endforeach; ?>
								</select>
								<small>Esta lista se carga directamente desde WooCommerce. Si un producto no aparece, revisa que esté publicado.</small>
							</label>
						</section>

						<section class="rgv-promotion-section">
							<h2>2. Escribe el mensaje</h2>
							<div class="rgv-fields rgv-fields--two">
								<label data-rgv-discount-field <?php echo 'announcement' === $scope ? 'hidden' : ''; ?>>
									<span>Porcentaje de descuento</span>
									<div class="rgv-input-suffix"><input type="number" name="discount_percent" min="0.01" max="99" step="0.01" value="<?php echo esc_attr( max( 0.01, (float) $settings['discount_percent'] ) ); ?>"><b>%</b></div>
									<small>El precio cambia automáticamente mientras la oferta esté activa.</small>
								</label>
								<label>
									<span>Etiqueta pequeña</span>
									<input type="text" name="eyebrow" maxlength="40" value="<?php echo esc_attr( $settings['eyebrow'] ); ?>">
									<small>Ejemplos: NUEVO STOCK, FELIZ LUNES, OFERTA ESPECIAL.</small>
								</label>
							</div>
							<label class="rgv-field-wide">
								<span>Mensaje principal</span>
								<input type="text" name="headline" maxlength="80" required value="<?php echo esc_attr( $settings['headline'] ); ?>">
								<small>Ejemplo: “Llegó más stock de RG-TZ 60mg”.</small>
							</label>
						</section>

						<section class="rgv-promotion-section">
							<h2>3. Duración</h2>
							<p class="rgv-section-note">Horario: <strong><?php echo esc_html( wp_timezone_string() ); ?></strong>. Las fechas son opcionales. Si no pones final, seguirá visible hasta que lo desactives.</p>
							<div class="rgv-fields rgv-fields--two">
								<label><span>Comienza</span><input type="datetime-local" name="starts_at" value="<?php echo esc_attr( self::datetime_input_value( absint( $settings['starts_at'] ) ) ); ?>"></label>
								<label><span>Finaliza</span><input type="datetime-local" name="ends_at" data-rgv-ends-at value="<?php echo esc_attr( self::datetime_input_value( absint( $settings['ends_at'] ) ) ); ?>"></label>
							</div>
							<label class="rgv-check"><input type="checkbox" name="show_countdown" value="1" data-rgv-countdown <?php checked( ! empty( $settings['show_countdown'] ) ); ?>> Mostrar contador regresivo en el banner.</label>
						</section>

						<section class="rgv-promotion-section">
							<h2>4. Botón opcional</h2>
							<div class="rgv-fields rgv-fields--two">
								<label><span>Texto del botón</span><input type="text" name="cta_label" maxlength="24" value="<?php echo esc_attr( $settings['cta_label'] ); ?>" placeholder="Ejemplo: VER PRODUCTO"></label>
								<label><span>Enlace</span><input type="text" name="cta_url" value="<?php echo esc_attr( $settings['cta_url'] ); ?>" placeholder="Automático"></label>
							</div>
							<p class="rgv-section-note rgv-section-note--after">Deja ambos campos vacíos si no quieres botón. En una oferta individual, el enlace puede quedar vacío y abrirá el producto automáticamente.</p>
							<label class="rgv-check"><input type="checkbox" name="show_native" value="1" <?php checked( ! empty( $settings['show_native'] ) ); ?>> Mostrar también en las páginas normales de WordPress.</label>
						</section>
					</main>

					<aside>
						<div class="rgv-promotion-card rgv-summary">
							<p class="rgv-summary__label">Configuración actual</p>
							<strong class="rgv-summary__discount"><?php echo esc_html( 'announcement' === $scope ? 'MENSAJE' : self::format_percent( (float) $settings['discount_percent'] ) ); ?></strong>
							<span><?php echo esc_html( self::campaign_target_label( $settings ) ); ?></span>
							<dl>
								<div><dt>Estado</dt><dd><?php echo esc_html( self::status_label( $status ) ); ?></dd></div>
								<div><dt>Tipo</dt><dd><?php echo esc_html( self::campaign_target_label( $settings ) ); ?></dd></div>
								<div><dt>Precio</dt><dd><?php echo esc_html( self::is_discount_campaign( $settings ) ? 'Descuento automático' : 'Sin cambios' ); ?></dd></div>
								<div><dt>Finaliza</dt><dd><?php echo absint( $settings['ends_at'] ) ? esc_html( wp_date( 'M j, Y · g:i a', absint( $settings['ends_at'] ), wp_timezone() ) ) : 'Hasta desactivarlo'; ?></dd></div>
							</dl>
							<p class="rgv-summary__help">El banner aparece al guardar. Si es una oferta, los precios vuelven a la normalidad cuando termine o se desactive.</p>
						</div>
						<?php submit_button( 'Guardar y publicar', 'primary large', 'submit', false ); ?>
					</aside>
				</div>
			</form>
		</div>
		<?php
	}

	public static function discount_product_price( $price, $product ) {
		if ( ! self::should_filter_prices() || ! self::product_matches_campaign( $product ) || '' === $price || null === $price ) {
			return $price;
		}

		return self::discount_value( $price );
	}

	public static function discount_variation_price( $price, $variation, $parent_product ) {
		if ( ! self::should_filter_prices() || ! self::product_matches_campaign( $variation ) || '' === $price || null === $price ) {
			return $price;
		}

		return self::discount_value( $price );
	}

	private static function should_filter_prices(): bool {
		if ( ! self::is_active() || ! self::is_discount_campaign() ) {
			return false;
		}

		if ( is_admin() && ! wp_doing_ajax() && ! ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
			return false;
		}

		return true;
	}

	private static function product_matches_campaign( $product, ?array $settings = null ): bool {
		$settings = is_array( $settings ) ? $settings : self::settings();

		if ( 'storewide' === (string) $settings['scope'] ) {
			return true;
		}

		if ( 'product' !== (string) $settings['scope'] ) {
			return false;
		}

		if ( ! $product instanceof WC_Product ) {
			return false;
		}

		$target_id = absint( $settings['product_id'] );
		$product_id = $product->get_id();
		$parent_id = $product->is_type( 'variation' ) ? $product->get_parent_id() : 0;

		return $target_id > 0 && ( $target_id === $product_id || $target_id === $parent_id );
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
		if ( self::should_filter_prices() && self::product_matches_campaign( $product ) && (float) $product->get_regular_price( 'edit' ) > 0 ) {
			return true;
		}

		return $on_sale;
	}

	public static function variation_prices_hash( array $hash, $product, bool $for_display ): array {
		$settings = self::settings();
		$hash['rgv_promotion'] = array(
			'status'   => self::campaign_status(),
			'scope'    => (string) $settings['scope'],
			'product_id' => absint( $settings['product_id'] ),
			'applies'  => self::product_matches_campaign( $product, $settings ),
			'percent'  => (float) $settings['discount_percent'],
			'starts_at'=> absint( $settings['starts_at'] ),
			'ends_at'  => absint( $settings['ends_at'] ),
		);

		return $hash;
	}

	public static function record_campaign_on_order( int $order_id, $order = null ): void {
		if ( ! self::is_active() || ! self::is_discount_campaign() ) {
			return;
		}

		$order = $order instanceof WC_Order ? $order : wc_get_order( $order_id );

		if ( ! $order instanceof WC_Order || $order->get_meta( '_rgv_promotion_percent', true ) ) {
			return;
		}

		$settings = self::settings();
		$order->update_meta_data( '_rgv_promotion_percent', (float) $settings['discount_percent'] );
		$order->update_meta_data( '_rgv_promotion_scope', (string) $settings['scope'] );
		$order->update_meta_data( '_rgv_promotion_product_id', absint( $settings['product_id'] ) );
		$order->update_meta_data( '_rgv_promotion_product_name', self::campaign_target_label( $settings ) );
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

		$scope  = (string) $order->get_meta( '_rgv_promotion_scope', true );
		$target = (string) $order->get_meta( '_rgv_promotion_product_name', true );
		$target = 'product' === $scope && '' !== $target ? $target : 'the store';

		printf(
			'<p class="form-field form-field-wide"><strong>Promotion:</strong> %1$s configured for %2$s when this order was created.</p>',
			esc_html( self::format_percent( $percent ) ),
			esc_html( $target )
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

		$product = self::campaign_product( $settings );

		return array(
			'active'           => 'active' === $status,
			'status'           => $status,
			'scope'            => (string) $settings['scope'],
			'product_id'       => absint( $settings['product_id'] ),
			'product_name'     => $product instanceof WC_Product ? $product->get_name() : '',
			'discount_percent' => self::is_discount_campaign( $settings ) ? (float) $settings['discount_percent'] : 0.0,
			'eyebrow'          => (string) $settings['eyebrow'],
			'headline'         => (string) $settings['headline'],
			'cta_label'        => (string) $settings['cta_label'],
			'cta_url'          => self::campaign_cta_url( $settings ),
			'show_countdown'   => ! empty( $settings['show_countdown'] ) && absint( $settings['ends_at'] ) > 0,
			'starts_at'        => absint( $settings['starts_at'] ) > 0 ? gmdate( 'c', absint( $settings['starts_at'] ) ) : null,
			'ends_at'          => absint( $settings['ends_at'] ) > 0 ? gmdate( 'c', absint( $settings['ends_at'] ) ) : null,
			'server_time'      => gmdate( 'c', $now ),
			'remaining_seconds'=> 'active' === $status && absint( $settings['ends_at'] ) > 0 ? max( 0, absint( $settings['ends_at'] ) - $now ) : 0,
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

		$ends_at       = absint( $settings['ends_at'] );
		$show_countdown = ! empty( $settings['show_countdown'] ) && $ends_at > 0;
		$cta_label      = trim( (string) $settings['cta_label'] );
		$cta_url        = self::campaign_cta_url( $settings );
		self::$native_banner_printed = true;
		?>
		<aside class="rgv-promo-banner" data-rgv-promotion data-ends-at="<?php echo $ends_at > 0 ? esc_attr( gmdate( 'c', $ends_at ) ) : ''; ?>" data-server-time="<?php echo esc_attr( gmdate( 'c' ) ); ?>" aria-label="Store announcement">
			<div class="rgv-promo-banner__inner">
				<div class="rgv-promo-banner__copy">
					<span><?php echo esc_html( $settings['eyebrow'] ); ?></span>
					<strong><?php echo esc_html( $settings['headline'] ); ?></strong>
				</div>
				<?php if ( $show_countdown ) : ?>
					<div class="rgv-promo-banner__timer" aria-hidden="true">
						<b data-rgv-days>00</b><small>d</small><b data-rgv-hours>00</b><small>h</small><b data-rgv-minutes>00</b><small>m</small><b data-rgv-seconds>00</b><small>s</small>
					</div>
				<?php endif; ?>
				<?php if ( '' !== $cta_label && '' !== $cta_url ) : ?>
					<a href="<?php echo esc_url( $cta_url ); ?>"><?php echo esc_html( $cta_label ); ?></a>
				<?php endif; ?>
				<?php if ( $ends_at > 0 ) : ?>
					<span class="screen-reader-text" data-rgv-accessible-time>Announcement ends <?php echo esc_html( wp_date( 'F j, Y \a\t g:i a T', $ends_at, wp_timezone() ) ); ?>.</span>
				<?php endif; ?>
			</div>
		</aside>
		<?php
	}
}
