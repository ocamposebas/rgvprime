<?php
namespace PrismSimpleCheckout;
defined( 'ABSPATH' ) || exit;
/** One-time activation exchange; the generic ZIP never contains a site secret. */
final class Settings {
	public const PAGE_SLUG = 'psc-settings';
	public const ADMIN_ALERTS_OPTION = 'psc_admin_alerts';
	public function hooks(): void {
		add_action( 'admin_menu', array( $this, 'register_menu' ) );
		add_action( 'admin_post_psc_activate', array( $this, 'handle_activation' ) );
		add_action( 'admin_post_psc_finish_connection', array( $this, 'handle_finish_connection' ) );
		// Cheap re-register when permalinks change so plain/custom REST prefixes keep delivery working.
		add_action( 'update_option_permalink_structure', array( $this, 'maybe_reregister_callback' ), 20, 0 );
		add_action( 'update_option_rewrite_rules', array( $this, 'maybe_reregister_callback' ), 20, 0 );
		add_action( 'admin_notices', array( $this, 'render_admin_alerts' ) );
		add_action( 'admin_notices', array( $this, 'credential_notice' ) );
	}
	public function credential_notice(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) { return; }
		$code = Credential_Store::diagnostic_code();
		$messages = array(
			'home_moved' => 'PRISM credentials belong to a different site URL. This appears to be a cloned or moved database. Checkout is disabled; activate this site with its own PRISM credential.',
			'salts_changed' => 'PRISM credentials cannot be used because the WordPress security salts changed. Checkout is disabled. Restore the prior salts, or contact PRISM support to rotate and reactivate this site credential.',
			'home_and_salts_changed' => 'PRISM detected both a different site URL and different WordPress salts. Checkout is disabled. Treat this as a clone and activate it with a separate PRISM credential.',
			'legacy_unpinned' => 'PRISM checkout is disabled until an operator explicitly pins the legacy credential on the verified production site or reactivates with its own credential.',
			'legacy_unreadable' => 'The legacy PRISM credential is unreadable. Checkout is disabled. Restore the prior WordPress salts or contact PRISM support to rotate the credential.',
			'credential_corrupt' => 'The stored PRISM credential is incomplete or damaged. Checkout is disabled. Contact PRISM support and reactivate this site.',
			'pin_failed' => 'PRISM could not pin the legacy credential to this site because the WordPress option could not be updated. Checkout is disabled. Restore database write access and reload.',
		);
		if ( isset( $messages[ $code ] ) ) {
			echo '<div class="notice notice-error"><p>' . esc_html( $messages[ $code ] ) . '</p></div>';
		}
	}
	public static function raise_admin_alert( string $code, string $message, array $context = array() ): void {
		$context = array_merge( array( 'source' => 'prism-simple-checkout' ), $context );
		$logged = false;
		try {
			if ( function_exists( 'wc_get_logger' ) ) {
				wc_get_logger()->critical( $message, $context );
				$logged = true;
			}
		} catch ( \Throwable $error ) {
			unset( $error );
		}
		if ( ! $logged ) {
			try { error_log( $message . ' ' . (string) wp_json_encode( $context ) ); } catch ( \Throwable $error ) { unset( $error ); }
		}
		$alerts = array();
		try {
			$stored = get_option( self::ADMIN_ALERTS_OPTION, array() );
			$alerts = is_array( $stored ) ? $stored : array();
		} catch ( \Throwable $error ) {
			unset( $error );
		}
		$alerts[ $code ] = array( 'message' => $message, 'context' => $context, 'created_at' => time() );
		try {
			update_option( self::ADMIN_ALERTS_OPTION, $alerts, false );
		} catch ( \Throwable $error ) {
			unset( $error );
			try { error_log( $message . ' ' . (string) wp_json_encode( $context ) ); } catch ( \Throwable $fallback_error ) { unset( $fallback_error ); }
		}
	}
	public function render_admin_alerts(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) { return; }
		try {
			$alerts = get_option( self::ADMIN_ALERTS_OPTION, array() );
		} catch ( \Throwable $error ) {
			unset( $error );
			return;
		}
		foreach ( is_array( $alerts ) ? $alerts : array() as $alert ) {
			$message = is_array( $alert ) ? (string) ( $alert['message'] ?? '' ) : '';
			if ( '' !== $message ) { echo '<div class="notice notice-error"><p>' . esc_html( $message ) . '</p></div>'; }
		}
	}
	/** Canonical callback URL the service should POST to. */
	public static function canonical_callback_url(): string {
		if ( function_exists( 'rest_url' ) ) {
			return (string) rest_url( 'psc/v1/callback' );
		}
		return home_url( '/wp-json/psc/v1/callback' );
	}
	/** Best-effort re-register; never blocks admin if service is unreachable. */
	public function maybe_reregister_callback(): void {
		if ( PSC_VERIFICATION_ONLY ) { return; }
		if ( ! Credential_Store::get() ) {
			return;
		}
		$client = new Service_Client();
		$client->register_callback_url( self::canonical_callback_url() );
	}
	public function register_menu(): void {
		add_submenu_page( 'woocommerce', __( 'PRISM Fall Checkout', 'prism-simple-checkout' ), __( 'PRISM Checkout', 'prism-simple-checkout' ), 'manage_woocommerce', self::PAGE_SLUG, array( $this, 'render_page' ) );
	}
	public function render_page(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) { return; }
		$creds = Credential_Store::get();
		echo '<div class="wrap"><h1>' . esc_html__( 'PRISM Fall Checkout', 'prism-simple-checkout' ) . '</h1>';
		if ( $creds ) {
			echo '<p>' . esc_html__( 'This site is activated; its credential is encrypted with authenticated encryption.', 'prism-simple-checkout' ) . '</p><dl><dt>Site ID</dt><dd>' . esc_html( $creds['site_id'] ) . '</dd><dt>Service URL</dt><dd>' . esc_html( $creds['service_url'] ) . '</dd><dt>Payment contract</dt><dd>' . esc_html( $creds['payment_contract'] ) . '</dd></dl>';
			$status = get_option( 'psc_connection_status', array() );
			if ( is_array( $status ) && ( $status['site_id'] ?? '' ) === $creds['site_id'] ) {
				echo '<p>' . esc_html( (string) ( $status['message'] ?? '' ) ) . ' ' . esc_html( (string) ( $status['checked_at'] ?? '' ) ) . '</p>';
			}
			echo '<p>After your PRISM operator permits this Site ID, verify the connection here. This does not enable the payment gateway or submit a payment.</p><form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '"><input type="hidden" name="action" value="psc_finish_connection">';
			wp_nonce_field( 'psc_finish_connection', 'psc_connection_nonce' );
			echo '<p><label for="psc_expected_account">Expected live Stripe account</label> <input name="psc_expected_account" id="psc_expected_account" pattern="acct_[A-Za-z0-9]+" required autocomplete="off"></p>';
			submit_button( __( 'Finish connection', 'prism-simple-checkout' ) );
			echo '</form><p><a href="' . esc_url( admin_url( 'admin.php?page=wc-settings&tab=checkout&section=psc' ) ) . '">Checkout appearance and payment settings</a></p>';
		} else {
			echo '<p>' . esc_html__( 'Enter the one-time activation token issued for this store.', 'prism-simple-checkout' ) . '</p><form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '"><input type="hidden" name="action" value="psc_activate">';
			wp_nonce_field( 'psc_activate', 'psc_activate_nonce' );
			echo '<p><label for="psc_service_url">Service URL</label> <input type="url" name="psc_service_url" id="psc_service_url" value="' . esc_attr( defined( 'PSC_FALL_SERVICE_URL' ) ? PSC_FALL_SERVICE_URL : '' ) . '" required readonly class="large-text"></p><p><label for="psc_activation_token">One-time token</label> <input type="password" name="psc_activation_token" id="psc_activation_token" required autocomplete="off"></p>';
			submit_button( __( 'Activate site', 'prism-simple-checkout' ) );
			echo '</form>';
		}
		echo '</div>';
	}
	public function handle_activation(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) { wp_die( esc_html__( 'Forbidden', 'prism-simple-checkout' ) ); }
		check_admin_referer( 'psc_activate', 'psc_activate_nonce' );
		// Repeated submissions must not replace an already stored site identity.
		if ( Credential_Store::get() ) { wp_die( esc_html__( 'This site is already activated. Use Finish connection.', 'prism-simple-checkout' ) ); }
		$token = sanitize_text_field( wp_unslash( (string) ( $_POST['psc_activation_token'] ?? '' ) ) );
		$base = esc_url_raw( wp_unslash( (string) ( $_POST['psc_service_url'] ?? '' ) ) );
		$callback = self::canonical_callback_url();
		$result = strlen( $token ) >= 32 && $base ? ( new Service_Client() )->exchange_activation( $token, home_url( '/' ), hash( 'sha256', home_url( '/' ) . '|' . AUTH_KEY ), $base, $callback ) : new \WP_Error( 'psc_activation', 'Invalid activation request.' );
		$ok = $this->complete_activation( is_wp_error( $result ) ? $result : (array) $result );
		wp_safe_redirect( admin_url( 'admin.php?page=' . self::PAGE_SLUG . ( $ok ? '&psc_activated=1' : '&psc_error=1' ) ) );
		exit;
	}
	public function handle_finish_connection(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) { wp_die( esc_html__( 'Forbidden', 'prism-simple-checkout' ) ); }
		check_admin_referer( 'psc_finish_connection', 'psc_connection_nonce' );
		$expected = sanitize_text_field( wp_unslash( (string) ( $_POST['psc_expected_account'] ?? '' ) ) );
		$result = $this->finish_connection( $expected );
		$creds = Credential_Store::get();
		update_option( 'psc_connection_status', array( 'site_id' => $creds['site_id'] ?? '', 'checked_at' => gmdate( 'c' ),
			'ok' => ! is_wp_error( $result ), 'message' => is_wp_error( $result ) ? $result->get_error_message()
				: 'Production connection verified for ' . $expected . '. Research verification, callback, Google return and wallet domain are configured. Buyer checkout still needs its actual browser check.' ), false );
		wp_safe_redirect( admin_url( 'admin.php?page=' . self::PAGE_SLUG ) );
		exit;
	}
	/** Registration uses the same signed service methods as the existing operator bridge. */
	public function finish_connection( string $expected ) {
		$creds = Credential_Store::get();
		if ( ! $creds || ! preg_match( '/^acct_[A-Za-z0-9]+$/', $expected ) ) {
			return new \WP_Error( 'psc_connection', 'An activated site and its expected Stripe account are required.' );
		}
		$client = new Service_Client();
		$surface = $client->fetch_express_surface();
		if ( is_wp_error( $surface ) || ( $surface['service_mode'] ?? '' ) !== 'production'
			|| ( $surface['verification_mode'] ?? '' ) !== 'research'
			|| ! str_starts_with( (string) ( $surface['publishable_key'] ?? '' ), 'pk_live_' )
			|| ( $surface['connected_account'] ?? '' ) !== $expected ) {
			return new \WP_Error( 'psc_connection', 'Live account or research connection is not confirmed. The operator must check this Site ID and its hub permission; preserve the current activation.' );
		}
		$callback_url = self::canonical_callback_url();
		$auth_url = Google_Checkout::return_url();
		$callback = $client->register_callback_url( $callback_url );
		if ( is_wp_error( $callback ) || ( $callback['site_id'] ?? '' ) !== $creds['site_id'] || ( $callback['callback_url'] ?? '' ) !== $callback_url ) {
			return new \WP_Error( 'psc_connection', 'Callback registration was not confirmed. Resolve the connection and retry this same site.' );
		}
		$auth = $client->register_auth_return_url( $auth_url );
		if ( is_wp_error( $auth ) || ( $auth['site_id'] ?? '' ) !== $creds['site_id'] || ( $auth['auth_return_url'] ?? '' ) !== $auth_url ) {
			return new \WP_Error( 'psc_connection', 'Google return registration was not confirmed. Resolve the connection and retry this same site.' );
		}
		$google = $client->google_config();
		if ( is_wp_error( $google ) || ( $google['google_enabled'] ?? false ) !== true || ( $google['auth_return_url'] ?? '' ) !== $auth_url ) {
			return new \WP_Error( 'psc_connection', 'Google authentication is not ready for this exact return URL.' );
		}
		( new Wallet_Domains() )->ensure_now( 'manual' );
		$wallet = get_option( Wallet_Domains::OPTION_KEY, array() );
		if ( ! is_array( $wallet ) || empty( $wallet['ok'] ) || ( $wallet['domain'] ?? '' ) !== strtolower( (string) wp_parse_url( home_url( '/' ), PHP_URL_HOST ) ) ) {
			return new \WP_Error( 'psc_connection', 'The wallet domain is not confirmed active. Resolve its reported status and retry this same site.' );
		}
		return true;
	}

	/**
	 * Store credentials first, then lifecycle wallet-domain ensure with the new site credential.
	 * Extracted for focused tests without weakening nonce/capability checks on the HTTP handler.
	 *
	 * @param array|\WP_Error $result Exchange payload or error.
	 */
	public function complete_activation( $result ): bool {
		if ( is_wp_error( $result ) || ! is_array( $result ) ) {
			return false;
		}
		if ( ! Credential_Store::store( $result ) ) {
			return false;
		}
		if ( PSC_VERIFICATION_ONLY ) { return true; }
		// Ensure only after credentials exist so HMAC can sign.
		if ( class_exists( __NAMESPACE__ . '\\Wallet_Domains' ) ) {
			if ( Wallet_Domains::ensure_after_activation() ) {
				update_option( Wallet_Domains::ENSURED_VERSION_OPTION, (string) PSC_VERSION, false );
			}
		}
		return true;
	}
}
