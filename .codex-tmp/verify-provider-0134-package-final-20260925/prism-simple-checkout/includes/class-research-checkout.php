<?php
namespace PrismSimpleCheckout;
defined( 'ABSPATH' ) || exit;
/** Shared real verification surface and site-scoped research evidence. */
final class Research_Checkout {
	public const PAYMENT_DISABLED = 'Payments are not enabled in this PRISM verification build.';
	public const SESSION_RECORD = 'psc_research_record';
	private const SESSION_SUBMISSION = 'psc_research_submission';
	public const AGREEMENT_VERSION = 'psc-research-details-v3';
	private bool $rendered = false;
	public function hooks(): void {
		( new Google_Checkout() )->hooks();
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue' ) );
		add_filter( 'body_class', array( $this, 'body_classes' ) );
		add_action( 'woocommerce_before_checkout_form', array( $this, 'render' ), 5 );
		add_action( 'before_woocommerce_pay', array( $this, 'render' ), 5 );
		add_filter( 'woocommerce_checkout_redirect_empty_cart', array( $this, 'redirect_empty_cart' ), 20 );
		add_action( 'woocommerce_before_checkout_form_cart_notices', array( $this, 'render_empty_checkout' ), 5 );
		add_filter( 'render_block_woocommerce/checkout', array( $this, 'render_blocks' ), 10, 1 );
		add_shortcode( 'prism_research_checkout', array( $this, 'shortcode' ) );
		add_action( 'admin_menu', array( $this, 'admin_menu' ) );
		add_action( 'woocommerce_checkout_order_processed', array( $this, 'classic_zero_total_order' ), PHP_INT_MAX, 3 );
		add_action( 'woocommerce_store_api_checkout_order_processed', array( $this, 'blocks_zero_total_order' ), PHP_INT_MAX, 1 );
		foreach ( array( 'research_organizations', 'research_save', 'research_invalidate' ) as $action ) {
			add_action( 'wp_ajax_psc_' . $action, array( $this, 'ajax_' . $action ) );
			add_action( 'wp_ajax_nopriv_psc_' . $action, array( $this, 'ajax_' . $action ) );
		}
	}
	/** The Fall verification entry remains available with a genuinely empty cart. */
	private function verification_checkout_entry(): bool {
		return defined( 'PSC_VERIFICATION_ONLY' ) && PSC_VERIFICATION_ONLY
			&& function_exists( 'is_checkout' ) && is_checkout()
			&& ! ( function_exists( 'is_wc_endpoint_url' ) && ( is_wc_endpoint_url( 'order-pay' ) || is_wc_endpoint_url( 'order-received' ) ) );
	}
	public function redirect_empty_cart( $redirect ): bool {
		return $this->verification_checkout_entry() ? false : (bool) $redirect;
	}
	public function render_empty_checkout(): void {
		if ( $this->verification_checkout_entry() && function_exists( 'WC' ) && WC() && WC()->cart && WC()->cart->is_empty() ) {
			$this->render();
		}
	}
	/** Fixed page styling is opt-in through a real shortcode attribute. */
	private static function fixed_theme( $attributes ): string {
		$theme = is_array( $attributes ) && is_string( $attributes['theme'] ?? null ) ? strtolower( trim( $attributes['theme'] ) ) : '';
		return in_array( $theme, array( 'light', 'dark' ), true ) ? $theme : '';
	}
	private function page_fixed_theme(): string {
		if ( ! is_singular() ) { return ''; }
		$page = get_post( get_queried_object_id() );
		if ( ! $page || ! preg_match_all( '/' . get_shortcode_regex( array( 'prism_research_checkout' ) ) . '/s', (string) $page->post_content, $matches, PREG_SET_ORDER ) ) { return ''; }
		foreach ( $matches as $match ) {
			if ( '[' === $match[1] && ']' === $match[6] ) { continue; }
			// The first rendered PRISM shortcode owns the single shared surface.
			return self::fixed_theme( shortcode_parse_atts( $match[3] ) );
		}
		return '';
	}
	public function body_classes( array $classes ): array {
		$theme = $this->page_fixed_theme();
		if ( '' !== $theme ) {
			$classes[] = 'psc-research-page';
			$classes[] = 'psc-research-page-' . $theme;
		}
		return array_values( array_unique( $classes ) );
	}
	public function enqueue(): void {
		global $post;
		$is_surface = ( function_exists( 'is_checkout' ) && is_checkout() ) || ( $post && has_shortcode( (string) $post->post_content, 'prism_research_checkout' ) );
		if ( ! $is_surface ) { return; }
		$this->enqueue_assets();
	}
	public function enqueue_assets(): void {
		$dependencies = array( 'wp-i18n' );
		if ( wp_script_is( 'wc-blocks-data', 'registered' ) ) { $dependencies[] = 'wp-data'; $dependencies[] = 'wc-blocks-data'; }
		wp_enqueue_style( 'psc-research-checkout', PSC_PLUGIN_URL . 'assets/css/research-checkout.css', array(), PSC_VERSION . '.' . filemtime( PSC_PLUGIN_DIR . 'assets/css/research-checkout.css' ) );
		wp_enqueue_script( 'psc-research-checkout', PSC_PLUGIN_URL . 'assets/js/research-checkout.js', $dependencies, PSC_VERSION . '.' . filemtime( PSC_PLUGIN_DIR . 'assets/js/research-checkout.js' ), true );
		$settings = get_option( 'woocommerce_' . PSC_GATEWAY_ID . '_settings', array() );
		$theme = strtolower( (string) ( $settings['theme'] ?? 'auto' ) );
		$agreement_file = PSC_PLUGIN_DIR . 'assets/legal/researcher-agreement-v3.json';
		$agreement = is_readable( $agreement_file ) ? json_decode( (string) file_get_contents( $agreement_file ), true ) : null;
		$pay_order = Rest_Routes::pay_order_context();
		$has_pay_order = $pay_order && ! is_wp_error( $pay_order );
		wp_localize_script( 'psc-research-checkout', 'pscResearch', array(
			'ajax_url' => admin_url( 'admin-ajax.php' ), 'nonce' => wp_create_nonce( 'psc_checkout' ),
			'theme' => in_array( $theme, array( 'auto', 'light', 'dark' ), true ) ? $theme : 'auto',
			'terms_version' => PSC_TERMS_VERSION, 'terms_hash' => PSC_TERMS_HASH,
			'terms_text' => Legal::terms_valid() ? (string) file_get_contents( PSC_TERMS_FILE ) : '',
			'researcher_agreement' => is_array( $agreement ) && self::AGREEMENT_VERSION === ( $agreement['version'] ?? '' ) ? $agreement : null,
			'privacy_url' => function_exists( 'get_privacy_policy_url' ) ? get_privacy_policy_url() : '',
			'wordmark_url_light' => PSC_PLUGIN_URL . 'assets/img/prism-wordmark-light.png',
			'wordmark_url_dark' => PSC_PLUGIN_URL . 'assets/img/prism-wordmark.png',
			'verification_only' => (bool) PSC_VERIFICATION_ONLY,
			'order_pay' => (bool) $has_pay_order,
			'order_id' => $has_pay_order ? $pay_order->get_id() : 0,
			'order_key' => $has_pay_order ? $pay_order->get_order_key() : '',
			'initial_billing' => $has_pay_order ? array( 'email' => $pay_order->get_billing_email(), 'first_name' => $pay_order->get_billing_first_name(), 'last_name' => $pay_order->get_billing_last_name() ) : null,
		) );
	}
	public function render(): void { echo $this->shortcode(); } // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Escaped markup below.
	public function render_blocks( string $content ): string { return $this->shortcode() . $content; }
	public function shortcode( $attributes = array() ): string {
		if ( $this->rendered ) { return ''; }
		$this->rendered = true;
		$this->enqueue_assets();
		$theme = self::fixed_theme( $attributes ) ?: $this->page_fixed_theme();
		$fixed_theme = '' !== $theme ? ' data-psc-fixed-theme="' . esc_attr( $theme ) . '"' : '';
		return '<section id="psc-research-checkout"' . $fixed_theme . ' aria-label="' . esc_attr__( 'PRISM research verification', 'prism-simple-checkout' ) . '"><div id="psc-research-app"><p>' . esc_html__( 'Loading PRISM verification…', 'prism-simple-checkout' ) . '</p></div><noscript>' . esc_html__( 'Enable JavaScript to confirm your email and complete research verification.', 'prism-simple-checkout' ) . '</noscript></section>';
	}
	private function nonce(): void {
		$nonce = sanitize_text_field( wp_unslash( (string) ( $_POST['nonce'] ?? '' ) ) );
		if ( ! wp_verify_nonce( $nonce, 'psc_checkout' ) ) { wp_send_json_error( array( 'code' => 'invalid_nonce', 'message' => Buyer_Copy::INVALID_NONCE ), 403 ); }
		if ( function_exists( 'wc_load_cart' ) && ( ! WC()->session || ! WC()->customer ) ) { wc_load_cart(); }
		if ( ! WC()->session || ! WC()->customer ) { wp_send_json_error( array( 'message' => 'Your verification session is unavailable. Reload this page.' ), 503 ); }
		WC()->session->set_customer_session_cookie( true );
	}
	private static function field( string $key ): string {
		return sanitize_text_field( wp_unslash( is_scalar( $_POST[ $key ] ?? null ) ? (string) $_POST[ $key ] : '' ) );
	}
	private function service_error( \WP_Error $error ): void {
		$data = (array) $error->get_error_data();
		$code = (string) ( $data['service_code'] ?? $error->get_error_code() );
		$message = (string) ( $data['message'] ?? $error->get_error_message() );
		$status = (int) ( $data['status'] ?? 502 );
		wp_send_json_error( array( 'code' => $code, 'message' => $message ?: 'PRISM could not save this verification. Please try again.' ), $status >= 400 && $status <= 599 ? $status : 502 );
	}
	public function ajax_research_organizations(): void {
		$this->nonce();
		$query = self::field( 'query' ); $category = self::field( 'category' );
		if ( strlen( $query ) < 2 || strlen( $query ) > 200 || ! in_array( $category, array( 'university', 'laboratory' ), true ) ) {
			wp_send_json_error( array( 'message' => 'Enter at least two letters and select an organization category.' ), 400 );
		}
		$result = Plugin::instance()->service_client()->research_organizations( $query, $category );
		if ( is_wp_error( $result ) ) { $this->service_error( $result ); }
		wp_send_json_success( $result );
	}
	/** Evidence is taken from the Woo session, never from a browser token. */
	public static function verification_for( string $email ): array {
		$state = Plugin::instance()->attempt_state();
		if ( $token = $state->get_email_verification( $email ) ) { return array( 'email_verification' => $token ); }
		if ( $grant = $state->get_device_grant( $email ) ) { return array( 'device_grant' => $grant ); }
		return array();
	}
	/** Editing a verified profile revokes checkout readiness, not an in-flight payment's identity. */
	public function ajax_research_invalidate(): void {
		$this->nonce();
		WC()->session->set( self::SESSION_RECORD, null );
		WC()->session->set( self::SESSION_SUBMISSION, null );
		WC()->session->set( Legal::SESSION_EVIDENCE, null );
		wp_send_json_success( array( 'ready' => false ) );
	}
	public function ajax_research_save(): void {
		$this->nonce();
		if ( PSC_TERMS_VERSION !== self::field( 'terms_version' ) || ! hash_equals( PSC_TERMS_HASH, self::field( 'terms_hash' ) ) ) {
			wp_send_json_error( array( 'code' => 'declarations_required', 'message' => 'Refresh the page and review the current purchase declarations.' ), 409 );
		}
		$request_id = self::field( 'request_id' ); $name = self::field( 'name' );
		$email = strtolower( sanitize_email( self::field( 'email' ) ) ); $category = self::field( 'category' );
		$pay_order = Rest_Routes::pay_order_context();
		if ( is_wp_error( $pay_order ) ) { $this->service_error( $pay_order ); }
		if ( $pay_order && ! hash_equals( strtolower( $pay_order->get_billing_email() ), $email ) ) {
			wp_send_json_error( array( 'code' => 'email_mismatch', 'message' => 'Confirm the email address on this order before paying.' ), 409 );
		}
		$organization_id = self::field( 'organization_id' );
		$raw_declarations = $_POST['declarations'] ?? '';
		$declarations = is_string( $raw_declarations ) ? json_decode( wp_unslash( $raw_declarations ), true ) : $raw_declarations;
		$raw_details = $_POST['details_attestation'] ?? '';
		$details = is_string( $raw_details ) ? json_decode( wp_unslash( $raw_details ), true ) : $raw_details;
		$fresh_agreement = is_array( $details ) && 2 === count( $details ) && true === ( $details['accepted'] ?? null ) && self::AGREEMENT_VERSION === ( $details['version'] ?? null );
		$saved_agreement = is_array( $details ) && 1 === count( $details ) && is_string( $details['record_id'] ?? null ) && preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $details['record_id'] );
		$declarations_source = self::field( 'declarations_source_record_id' );
		$declarations_accepted_at = self::field( 'declarations_accepted_at' );
		if ( '' !== $declarations_source && ( ! $saved_agreement || ! hash_equals( strtolower( $details['record_id'] ), strtolower( $declarations_source ) ) || false === strtotime( $declarations_accepted_at ) ) ) {
			wp_send_json_error( array( 'code' => 'declarations_required', 'message' => 'Review the declarations for your current details before continuing.' ), 400 );
		}
		if ( ! $fresh_agreement && ! $saved_agreement ) {
			wp_send_json_error( array( 'code' => 'details_attestation_required', 'message' => 'Refresh the page and accept the current Researcher Agreement on Your details.' ), 400 );
		}
		if ( ! preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $request_id ) || '' === $name || strlen( $name ) > 200 || ! is_email( $email ) || ! in_array( $category, array( 'independent', 'university', 'laboratory' ), true ) || ( 'independent' !== $category && '' === $organization_id ) ) {
			wp_send_json_error( array( 'message' => 'Complete your name, email and researcher details before continuing.' ), 400 );
		}
		foreach ( array( 'age', 'research', 'terms' ) as $key ) {
			if ( ! is_array( $declarations ) || true !== ( $declarations[ $key ] ?? null ) ) { wp_send_json_error( array( 'message' => 'Confirm all three declarations before continuing.' ), 400 ); }
		}
		$verification = self::verification_for( $email );
		if ( ! $verification ) { wp_send_json_error( array( 'code' => 'email_verification_required', 'message' => 'Confirm this email address before continuing.' ), 400 ); }
		if ( ! Legal::terms_valid() ) { wp_send_json_error( array( 'message' => 'Research terms are unavailable. Contact the store.' ), 503 ); }
		$input = array( 'request_id' => $request_id, 'name' => $name, 'email' => $email, 'category' => $category, 'organization_id' => 'independent' === $category ? null : $organization_id, 'declarations' => array( 'age' => true, 'research' => true, 'terms' => true ), 'details_attestation' => $details );
		if ( '' !== $declarations_source ) {
			$input['declarations_source_record_id'] = strtolower( $declarations_source );
			// The service authenticates this source and exact original time before reuse.
			$input['legal'] = array( 'version' => PSC_TERMS_VERSION, 'hash' => PSC_TERMS_HASH, 'accepted' => true, 'accepted_at' => $declarations_accepted_at );
		}
		$prior = WC()->session->get( self::SESSION_SUBMISSION );
		if ( is_array( $prior ) && ( $prior['input']['request_id'] ?? '' ) === $request_id ) {
			if ( $input !== $prior['input'] ) { wp_send_json_error( array( 'code' => 'request_identity_changed', 'message' => 'Your details changed. Start a new verification submission.' ), 409 ); }
			$payload = $prior['payload'];
		} else {
			$payload = $input + array( 'verification' => $verification );
			if ( '' === $declarations_source ) {
				$payload['legal'] = array( 'version' => PSC_TERMS_VERSION, 'hash' => PSC_TERMS_HASH, 'accepted' => true, 'accepted_at' => gmdate( 'c' ) );
			}
			WC()->session->set( self::SESSION_SUBMISSION, array( 'input' => $input, 'payload' => $payload ) );
		}
		$result = Plugin::instance()->service_client()->create_research_record( $payload );
		if ( is_wp_error( $result ) ) { $this->service_error( $result ); }
		$record = $result['record'] ?? null;
		if ( ! self::valid_record( $record, $email ) ) { wp_send_json_error( array( 'message' => 'PRISM returned an invalid verification record.' ), 502 ); }
		WC()->session->set( self::SESSION_RECORD, $record );
		WC()->session->set( Legal::SESSION_EVIDENCE, $record['legal'] );
		WC()->customer->set_billing_email( $email );
		$names = preg_split( '/\s+/', trim( $name ), 2 );
		WC()->customer->set_billing_first_name( $names[0] ?? '' );
		WC()->customer->set_billing_last_name( $names[1] ?? '' );
		WC()->customer->save();
		Google_Checkout::clear_resume();
		wp_send_json_success( array( 'record' => $record ) );
	}
	public static function valid_record( $record, string $email ): bool {
		return is_array( $record ) && (bool) preg_match( '/^[0-9a-f-]{36}$/i', (string) ( $record['id'] ?? '' ) )
			&& (bool) preg_match( '/^[a-f0-9]{64}$/', (string) ( $record['digest'] ?? '' ) )
			&& hash_equals( strtolower( $email ), strtolower( (string) ( $record['email'] ?? '' ) ) )
			&& is_array( $record['legal'] ?? null ) && true === ( $record['legal']['accepted'] ?? false )
			&& PSC_TERMS_VERSION === ( $record['legal']['version'] ?? '' )
			&& hash_equals( PSC_TERMS_HASH, (string) ( $record['legal']['hash'] ?? '' ) )
			&& false !== strtotime( (string) ( $record['legal']['accepted_at'] ?? '' ) );
	}
	public static function current_record( string $email ): ?array {
		$record = function_exists( 'WC' ) && WC() && WC()->session ? WC()->session->get( self::SESSION_RECORD ) : null;
		return self::valid_record( $record, $email ) ? $record : null;
	}
	/** The browser cannot supply or renew this record-bound payment evidence. */
	public static function payment_evidence( string $email ) {
		$record = self::current_record( $email );
		$legal = Plugin::instance()->legal()->get_evidence();
		$record_legal = is_array( $record ) ? ( $record['legal'] ?? null ) : null;
		if ( ! $record || ! $legal || ! is_array( $record_legal ) || ! Legal::terms_valid()
			|| $record_legal !== $legal ) {
			return new \WP_Error( 'research_verification_required', 'Confirm the purchase declarations before continuing.', array( 'status' => 409 ) );
		}
		foreach ( array( 'age', 'research', 'terms' ) as $key ) {
			if ( true !== ( $record['declarations'][ $key ] ?? null ) ) {
				return new \WP_Error( 'research_verification_required', 'Confirm all three purchase declarations.', array( 'status' => 409 ) );
			}
		}
		$agreement = $record['declarations']['details_attestation'] ?? null;
		if ( ! is_array( $agreement ) || true !== ( $agreement['accepted'] ?? null ) || self::AGREEMENT_VERSION !== ( $agreement['version'] ?? '' )
			|| false === strtotime( (string) ( $agreement['accepted_at'] ?? '' ) ) ) {
			return new \WP_Error( 'research_verification_required', 'Read and agree to the current Researcher Agreement before continuing.', array( 'status' => 409 ) );
		}
		if ( ! self::verification_for( $email ) ) {
			return new \WP_Error( 'email_verification_required', 'Confirm this email address to continue.', array( 'status' => 403 ) );
		}
		return array( 'record' => $record, 'legal' => $legal );
	}
	/** Copy the authenticated immutable record; never manufacture a new acceptance time. */
	public static function attach_order_evidence( \WC_Order $order, array $evidence ): void {
		$record = $evidence['record']; $legal = $evidence['legal'];
		foreach ( array(
			'_psc_research_record_id' => (string) $record['id'],
			'_psc_research_record_digest' => (string) $record['digest'],
			'_psc_research_record_snapshot' => wp_json_encode( $record, JSON_UNESCAPED_SLASHES ),
			'_psc_legal_version' => (string) $legal['version'],
			'_psc_legal_hash' => (string) $legal['hash'],
			'_psc_legal_accepted_at' => (string) $legal['accepted_at'],
		) as $key => $value ) { $order->update_meta_data( $key, $value ); }
	}
	public function classic_zero_total_order( $order_id, $data, \WC_Order $order ): void {
		$error = $this->save_zero_total_evidence( $order );
		if ( is_wp_error( $error ) ) { throw new \Exception( $error->get_error_message() ); }
	}
	public function blocks_zero_total_order( \WC_Order $order ): void {
		$error = $this->save_zero_total_evidence( $order );
		if ( is_wp_error( $error ) ) {
			throw new \Automattic\WooCommerce\StoreApi\Exceptions\RouteException( $error->get_error_code(), $error->get_error_message(), 409 );
		}
	}
	/** Both native checkout hooks run before Woo completes orders which do not need payment. */
	private function save_zero_total_evidence( \WC_Order $order ): ?\WP_Error {
		if ( PSC_VERIFICATION_ONLY || ! defined( 'PSC_RESEARCH_CHECKOUT' ) || ! PSC_RESEARCH_CHECKOUT || $order->is_paid()
			|| 0 !== Cart_Fingerprint::total_to_minor( (string) $order->get_total(), null, (string) $order->get_currency() ) ) { return null; }
		$enabled = array();
		foreach ( WC()->payment_gateways()->payment_gateways() as $id => $gateway ) {
			if ( 'yes' === $gateway->enabled ) { $enabled[] = $id; }
		}
		$method = (string) $order->get_payment_method();
		// Woo omits a method for free orders. Only the sole enabled gateway owns that case.
		if ( ! in_array( PSC_GATEWAY_ID, $enabled, true ) || ( '' !== $method && PSC_GATEWAY_ID !== $method )
			|| ( '' === $method && array( PSC_GATEWAY_ID ) !== $enabled ) ) { return null; }
		if ( ! Credential_Store::is_configured() ) {
			return new \WP_Error( 'research_verification_unavailable', 'Research verification is unavailable. Contact the store before continuing.' );
		}
		$evidence = self::payment_evidence( (string) $order->get_billing_email() );
		if ( is_wp_error( $evidence ) ) { return $evidence; }
		$submission = WC()->session->get( self::SESSION_SUBMISSION );
		if ( ! is_array( $submission ) || ! is_array( $submission['payload'] ?? null ) ) {
			return new \WP_Error( 'research_verification_required', 'Complete research verification before placing this order.' );
		}
		// A free order skips create_attempt. Replay the existing idempotent submission to
		// revalidate the site-bound grant (including expiry/revocation) without a PaymentIntent.
		$result = Plugin::instance()->service_client()->create_research_record( $submission['payload'] );
		if ( is_wp_error( $result ) ) { return $result; }
		$record = $result['record'] ?? null;
		if ( ! self::valid_record( $record, (string) $order->get_billing_email() )
			|| ! hash_equals( (string) $evidence['record']['id'], (string) $record['id'] )
			|| ! hash_equals( (string) $evidence['record']['digest'], (string) $record['digest'] ) ) {
			return new \WP_Error( 'research_verification_required', 'Research verification changed. Complete verification again before placing this order.' );
		}
		self::attach_order_evidence( $order, $evidence );
		$order->save();
		return null;
	}
	public function admin_menu(): void {
		add_submenu_page( 'woocommerce', __( 'PRISM research records', 'prism-simple-checkout' ), __( 'PRISM research records', 'prism-simple-checkout' ), 'manage_woocommerce', 'psc-research-records', array( $this, 'admin_page' ) );
	}
	public function admin_page(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) { wp_die( esc_html__( 'Forbidden', 'prism-simple-checkout' ) ); }
		$cursor = isset( $_GET['cursor'] ) && is_string( $_GET['cursor'] ) ? sanitize_text_field( wp_unslash( $_GET['cursor'] ) ) : null; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only pagination.
		$result = Plugin::instance()->service_client()->list_research_records( $cursor ?: null );
		echo '<div class="wrap"><h1>' . esc_html__( 'PRISM research records', 'prism-simple-checkout' ) . '</h1><p>' . esc_html__( 'Declarations, email confirmation and organization-domain matches recorded for this store.', 'prism-simple-checkout' ) . '</p>';
		if ( is_wp_error( $result ) ) { echo '<div class="notice notice-error"><p>' . esc_html( $result->get_error_message() ) . '</p></div></div>'; return; }
		echo '<table class="widefat striped"><thead><tr>';
		foreach ( array( 'Recorded', 'Researcher', 'Category', 'Organization / domain', 'Evidence', 'Order' ) as $label ) { echo '<th>' . esc_html( $label ) . '</th>'; }
		echo '</tr></thead><tbody>';
		if ( ! $result['records'] ) { echo '<tr><td colspan="6">' . esc_html__( 'No research records have been saved for this store.', 'prism-simple-checkout' ) . '</td></tr>'; }
		foreach ( $result['records'] as $record ) {
			$org = is_array( $record['organization'] ?? null ) ? $record['organization'] : array();
			$sources = array( 'google' => __( 'Google', 'prism-simple-checkout' ), 'otp' => __( 'Email code', 'prism-simple-checkout' ), 'device' => __( 'Remembered device', 'prism-simple-checkout' ) );
			$source = $sources[ $record['verification_source'] ?? '' ] ?? __( 'Email confirmation', 'prism-simple-checkout' );
			echo '<tr><td>' . esc_html( (string) ( $record['created_at'] ?? '' ) ) . '</td><td>' . esc_html( (string) ( $record['name'] ?? '' ) ) . '<br>' . esc_html( (string) ( $record['email'] ?? '' ) ) . '</td><td>' . esc_html( (string) ( $record['category'] ?? '' ) ) . '</td><td>' . esc_html( (string) ( $org['name'] ?? 'Independent' ) ) . '<br>' . esc_html( (string) ( $org['domain'] ?? '' ) ) . '</td><td><strong>' . esc_html( $source ) . '</strong><details><summary>' . esc_html( (string) ( $record['id'] ?? '' ) ) . '</summary><pre style="white-space:pre-wrap;max-width:34rem">' . esc_html( (string) wp_json_encode( $record, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ) ) . '</pre></details></td><td>';
			$order_query = array( 'limit' => 1, 'return' => 'objects' );
			$hpos = class_exists( '\Automattic\WooCommerce\Utilities\OrderUtil' ) && \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled();
			if ( $hpos ) {
				$order_query['meta_query'] = array( array( 'key' => '_psc_research_record_id', 'value' => (string) ( $record['id'] ?? '' ) ) );
			} else {
				$order_query['meta_key'] = '_psc_research_record_id';
				$order_query['meta_value'] = (string) ( $record['id'] ?? '' );
			}
			$orders = function_exists( 'wc_get_orders' ) ? wc_get_orders( $order_query ) : array();
			$order = $orders ? reset( $orders ) : null;
			if ( $order && hash_equals( (string) $order->get_meta( '_psc_research_record_id', true ), (string) $record['id'] ) && current_user_can( 'edit_shop_order', $order->get_id() ) ) { echo '<a href="' . esc_url( $order->get_edit_order_url() ) . '">' . esc_html( '#' . $order->get_order_number() ) . '</a>'; } else { echo '—'; }
			echo '</td></tr>';
		}
		echo '</tbody></table>';
		if ( ! empty( $result['next_cursor'] ) ) { echo '<p><a class="button" href="' . esc_url( add_query_arg( array( 'page' => 'psc-research-records', 'cursor' => $result['next_cursor'] ), admin_url( 'admin.php' ) ) ) . '">' . esc_html__( 'Next page', 'prism-simple-checkout' ) . '</a></p>'; }
		echo '</div>';
	}
}
