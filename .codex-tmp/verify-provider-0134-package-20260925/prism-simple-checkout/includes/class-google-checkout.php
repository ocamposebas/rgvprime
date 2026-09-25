<?php
namespace PrismSimpleCheckout;
defined( 'ABSPATH' ) || exit;

/** Google authenticates centrally; only PRISM evidence enters the Woo session. */
final class Google_Checkout {
	private const SESSION_FLOW = 'psc_google_flow';
	private const SESSION_RESUME = 'psc_google_resume';

	public function hooks(): void {
		foreach ( array( 'research_bootstrap', 'google_start' ) as $action ) {
			add_action( 'wp_ajax_psc_' . $action, array( $this, 'ajax_' . $action ) );
			add_action( 'wp_ajax_nopriv_psc_' . $action, array( $this, 'ajax_' . $action ) );
		}
		add_action( 'woocommerce_api_psc_google_return', array( $this, 'handle_return' ) );
	}

	public static function return_url(): string {
		return home_url( '/?wc-api=psc_google_return' );
	}

	private static function origin( string $url ): string {
		$parts = wp_parse_url( $url );
		if ( ! is_array( $parts ) || empty( $parts['scheme'] ) || empty( $parts['host'] ) || isset( $parts['user'] ) || isset( $parts['pass'] ) ) { return ''; }
		$scheme = strtolower( $parts['scheme'] );
		$port = (int) ( $parts['port'] ?? ( 'https' === $scheme ? 443 : 80 ) );
		return $scheme . '://' . strtolower( $parts['host'] ) . ':' . $port;
	}

	private function session(): void {
		nocache_headers();
		if ( function_exists( 'wc_load_cart' ) && ( ! WC()->session || ! WC()->customer ) ) { wc_load_cart(); }
		if ( ! WC()->session || ! WC()->customer ) { wp_send_json_error( array( 'message' => __( 'Your verification session is unavailable. Reload this page.', 'prism-simple-checkout' ) ), 503 ); }
		WC()->session->set_customer_session_cookie( true );
	}

	private static function post_field( string $key ): string {
		return sanitize_text_field( wp_unslash( is_scalar( $_POST[ $key ] ?? null ) ? (string) $_POST[ $key ] : '' ) );
	}

	private static function error( string $message, string $code = 'google_unavailable', int $status = 400 ): void {
		wp_send_json_error( array( 'code' => $code, 'message' => $message ), $status );
	}

	/** Fresh nonces and private return state are never embedded in cacheable HTML. */
	public function ajax_research_bootstrap(): void {
		$source = (string) ( $_SERVER['HTTP_ORIGIN'] ?? $_SERVER['HTTP_REFERER'] ?? '' );
		$allowed = '' !== $source && hash_equals( self::origin( home_url( '/' ) ), self::origin( $source ) );
		$allowed = (bool) apply_filters( 'psc_research_bootstrap_origin_allowed', $allowed, $source );
		if ( '1' !== (string) ( $_SERVER['HTTP_X_PSC_BOOTSTRAP'] ?? '' ) || ! $allowed ) {
			self::error( __( 'Open checkout on this store to continue.', 'prism-simple-checkout' ), 'invalid_origin', 403 );
		}
		$this->session();
		$resume = WC()->session->get( self::SESSION_RESUME );
		if ( ! is_array( $resume ) || (int) ( $resume['expires'] ?? 0 ) <= time() ) { self::clear_resume(); $resume = null; }
		wp_send_json_success( array( 'nonce' => wp_create_nonce( 'psc_checkout' ), 'google_enabled' => $this->enabled(), 'resume' => $resume ) );
	}

	private function enabled(): bool {
		$creds = Credential_Store::get();
		if ( ! $creds || 'https' !== wp_parse_url( self::return_url(), PHP_URL_SCHEME ) ) { return false; }
		$key = 'psc_google_' . md5( $creds['site_id'] . '|' . $creds['service_url'] . '|' . self::return_url() );
		$config = get_transient( $key );
		if ( ! is_array( $config ) ) {
			$config = Plugin::instance()->service_client()->google_config();
			if ( is_wp_error( $config ) ) { return false; }
			set_transient( $key, $config, 60 );
		}
		return true === ( $config['google_enabled'] ?? false ) && hash_equals( self::return_url(), (string) ( $config['auth_return_url'] ?? '' ) );
	}

	private function checkout_url( string $url ): string {
		if ( ! hash_equals( self::origin( home_url( '/' ) ), self::origin( $url ) ) || wp_parse_url( $url, PHP_URL_FRAGMENT ) ) { return ''; }
		$query_string = (string) wp_parse_url( $url, PHP_URL_QUERY );
		if ( '' !== $query_string ) {
			parse_str( $query_string, $query );
			if ( array_diff( array_keys( $query ), array( 'key', 'pay_for_order' ) ) || ! is_string( $query['key'] ?? null ) || 'true' !== ( $query['pay_for_order'] ?? '' ) ) { return ''; }
			$parts = explode( '/', trim( (string) wp_parse_url( $url, PHP_URL_PATH ), '/' ) );
			$id = end( $parts );
			if ( ! ctype_digit( $id ) ) { return ''; }
			$order = Rest_Routes::pay_order_context( (int) $id, $query['key'] );
			if ( ! $order || is_wp_error( $order ) ) { return ''; }
			$canonical = $order->get_checkout_payment_url();
			return untrailingslashit( (string) wp_parse_url( $url, PHP_URL_PATH ) ) === untrailingslashit( (string) wp_parse_url( $canonical, PHP_URL_PATH ) ) ? $canonical : '';
		}
		$page_id = url_to_postid( $url );
		$page = $page_id ? get_post( $page_id ) : null;
		if ( ! $page || 'publish' !== $page->post_status ) { return ''; }
		$content = (string) $page->post_content;
		return $page_id === wc_get_page_id( 'checkout' ) || has_shortcode( $content, 'prism_research_checkout' ) || has_shortcode( $content, 'woocommerce_checkout' ) || has_block( 'woocommerce/checkout', $content ) ? esc_url_raw( $url ) : '';
	}

	private function draft(): array {
		$raw = $_POST['draft'] ?? '';
		$draft = is_string( $raw ) && strlen( $raw ) <= 12000 ? json_decode( wp_unslash( $raw ), true ) : null;
		$category = is_array( $draft ) ? ( $draft['category'] ?? '' ) : '';
		if ( 'independent' !== $category ) {
			self::error( __( 'Use email verification for University or Institution / laboratory.', 'prism-simple-checkout' ), 'google_independent_only', 403 );
		}
		if ( PSC_TERMS_VERSION !== ( $draft['terms_version'] ?? '' ) || ! is_string( $draft['terms_hash'] ?? null ) || ! hash_equals( PSC_TERMS_HASH, $draft['terms_hash'] ) ) {
			self::error( __( 'Refresh the page and review the current purchase declarations.', 'prism-simple-checkout' ), 'declarations_required' );
		}
		$details = is_array( $draft ) ? ( $draft['details_attestation'] ?? null ) : null;
		$fresh = is_array( $details ) && 2 === count( $details ) && true === ( $details['accepted'] ?? null ) && Research_Checkout::AGREEMENT_VERSION === ( $details['version'] ?? null );
		$saved = is_array( $details ) && 1 === count( $details ) && is_string( $details['record_id'] ?? null ) && preg_match( '/^[0-9a-f-]{36}$/i', $details['record_id'] );
		if ( ( ! $fresh && ! $saved ) || ! Legal::terms_valid() ) {
			self::error( __( 'Choose your researcher type and accept the Researcher Agreement.', 'prism-simple-checkout' ), 'details_attestation_required' );
		}
		foreach ( array( 'age', 'research', 'terms' ) as $key ) {
			if ( true !== ( $draft['declarations'][ $key ] ?? null ) ) { self::error( __( 'Accept all three declarations before continuing.', 'prism-simple-checkout' ) ); }
		}
		$organization = null;
		$edits = array();
		foreach ( array( 'name', 'email', 'category', 'organization' ) as $key ) { $edits[ $key ] = true === ( $draft['profileEdits'][ $key ] ?? null ); }
		$result = array( 'name' => sanitize_text_field( substr( (string) ( $draft['name'] ?? '' ), 0, 200 ) ), 'email' => sanitize_email( (string) ( $draft['email'] ?? '' ) ), 'category' => $category, 'organization' => $organization, 'declarations' => array( 'age' => true, 'research' => true, 'terms' => true ), 'terms_version' => PSC_TERMS_VERSION, 'terms_hash' => PSC_TERMS_HASH, 'details_attestation' => $details, 'profileEdits' => $edits, 'remember' => true === ( $draft['remember'] ?? null ) );
		if ( ! empty( $draft['declarations_source_record_id'] ) ) {
			$source = $draft['declarations_source_record_id'];
			$accepted_at = $draft['declarations_accepted_at'] ?? null;
			if ( ! $saved || ! is_string( $source ) || ! hash_equals( strtolower( $details['record_id'] ), strtolower( $source ) ) || ! is_string( $accepted_at ) || false === strtotime( $accepted_at ) ) {
				self::error( __( 'Review the declarations for your current details before continuing.', 'prism-simple-checkout' ), 'declarations_required' );
			}
			$result['declarations_source_record_id'] = strtolower( $source );
			$result['declarations_accepted_at'] = $accepted_at;
		}
		return $result;
	}

	public function ajax_google_start(): void {
		if ( ! wp_verify_nonce( self::post_field( 'nonce' ), 'psc_checkout' ) ) { self::error( Buyer_Copy::INVALID_NONCE, 'invalid_nonce', 403 ); }
		$this->session();
		if ( ! $this->enabled() ) { self::error( __( 'Google sign-in is unavailable. Use email instead or try again shortly.', 'prism-simple-checkout' ), 'google_unavailable', 503 ); }
		$checkout_url = $this->checkout_url( self::post_field( 'checkout_url' ) );
		if ( '' === $checkout_url ) { self::error( __( 'Open this store’s checkout to continue.', 'prism-simple-checkout' ), 'invalid_return_url' ); }
		$draft = $this->draft();
		$request_id = self::post_field( 'request_id' );
		if ( ! preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $request_id ) ) { self::error( __( 'Please try Google sign-in again.', 'prism-simple-checkout' ) ); }
		$flow = WC()->session->get( self::SESSION_FLOW );
		if ( ! is_array( $flow ) || ( $flow['request_id'] ?? '' ) !== $request_id || (int) ( $flow['expires'] ?? 0 ) <= time() ) {
			$flow = array( 'request_id' => $request_id, 'verifier' => bin2hex( random_bytes( 32 ) ), 'state' => bin2hex( random_bytes( 32 ) ), 'draft' => $draft, 'checkout_url' => $checkout_url, 'expires' => time() + 600, 'prior_device_grant' => Plugin::instance()->attempt_state()->get_device_grant() );
			WC()->session->set( self::SESSION_FLOW, $flow );
		} elseif ( $flow['draft'] !== $draft || $flow['checkout_url'] !== $checkout_url ) {
			self::error( __( 'Your details changed. Please start Google sign-in again.', 'prism-simple-checkout' ), 'request_identity_changed', 409 );
		}
		$payload = array( 'request_id' => $request_id, 'verifier_hash' => hash( 'sha256', $flow['verifier'] ), 'merchant_state' => $flow['state'], 'remember_device' => $draft['remember'], 'return_url' => self::return_url() );
		$prior = $flow['prior_device_grant'] ?? null;
		if ( $prior ) { $payload['prior_device_grant'] = $prior; }
		$result = Plugin::instance()->service_client()->start_google( $payload );
		if ( is_wp_error( $result ) ) { self::error( __( 'Google sign-in could not start. Try again or use email instead.', 'prism-simple-checkout' ), 'google_start_failed', 502 ); }
		$creds = Credential_Store::get();
		if ( ! $creds || ! hash_equals( self::origin( $creds['service_url'] ), self::origin( $result['url'] ) ) || '/auth/google/start' !== wp_parse_url( $result['url'], PHP_URL_PATH ) ) { self::error( __( 'Google sign-in returned an invalid address.', 'prism-simple-checkout' ), 'google_invalid_response', 502 ); }
		$flow['transaction_id'] = $result['transaction_id'];
		WC()->session->set( self::SESSION_FLOW, $flow );
		WC()->session->set( self::SESSION_RESUME, null );
		WC()->session->save_data();
		wp_send_json_success( array( 'url' => $result['url'] ) );
	}

	public function handle_return(): void {
		$this->session();
		header( 'Referrer-Policy: no-referrer' );
		$flow = WC()->session->get( self::SESSION_FLOW );
		$value = static function ( string $key ): string { return sanitize_text_field( wp_unslash( is_string( $_GET[ $key ] ?? null ) ? $_GET[ $key ] : '' ) ); }; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Verified against server-held OAuth state below.
		if ( ! is_array( $flow ) || empty( $flow['transaction_id'] ) || ! hash_equals( $flow['state'], $value( 'state' ) ) || ! hash_equals( $flow['transaction_id'], $value( 'transaction_id' ) ) ) {
			wp_die( esc_html__( 'This sign-in does not belong to your current checkout session or has expired. Return to checkout and try again.', 'prism-simple-checkout' ), esc_html__( 'PRISM sign-in', 'prism-simple-checkout' ), array( 'response' => 400 ) );
		}
		$resume = array( 'draft' => $flow['draft'], 'request_id' => $flow['request_id'], 'expires' => time() + 600, 'message' => __( 'Google sign-in was not completed. Try again or use email instead.', 'prism-simple-checkout' ) );
		$expired = (int) ( $flow['expires'] ?? 0 ) <= time();
		$eligible = 'independent' === ( $flow['draft']['category'] ?? '' );
		if ( ! $eligible ) { $resume['message'] = __( 'Use email verification for University or Institution / laboratory.', 'prism-simple-checkout' ); }
		if ( $expired ) { $resume['message'] = __( 'Google sign-in expired. Your details are still here. Try again or use email instead.', 'prism-simple-checkout' ); }
		if ( ! $expired && $eligible && isset( $flow['completed_resume'], $flow['result_hash'] ) && '' !== $value( 'result' ) && hash_equals( $flow['result_hash'], hash( 'sha256', $value( 'result' ) ) ) ) {
			$resume = $flow['completed_resume'];
		} elseif ( ! $expired && $eligible && '' !== $value( 'result' ) && '' === $value( 'error' ) ) {
			$result = Plugin::instance()->service_client()->exchange_google( array( 'transaction_id' => $flow['transaction_id'], 'result' => $value( 'result' ), 'verifier' => $flow['verifier'], 'request_id' => $flow['request_id'] ) );
			if ( ! is_wp_error( $result ) && is_email( $result['email'] ?? '' ) ) {
				$email = strtolower( sanitize_email( $result['email'] ) );
				$state = Plugin::instance()->attempt_state();
				$state->invalidate_email( $email );
				WC()->session->set( Research_Checkout::SESSION_RECORD, null );
				$requires_code = true === $result['requires_email_confirmation'];
				$valid_proof = ! empty( $result['email_verification'] ) && strtotime( (string) ( $result['expires_at'] ?? '' ) ) > time();
				if ( $requires_code || $valid_proof ) {
					$resume['identity'] = array( 'email' => $email, 'name' => sanitize_text_field( $result['name'] ), 'requires_email_confirmation' => $requires_code, 'remembered' => ! $requires_code && ! empty( $result['device_grant'] ), 'expires_at' => $requires_code ? '' : $result['expires_at'], 'researcher' => ! $requires_code && Research_Checkout::valid_record( $result['researcher'] ?? null, $email ) ? $result['researcher'] : null );
					$resume['message'] = '';
					$flow['result_hash'] = hash( 'sha256', $value( 'result' ) );
					$flow['completed_resume'] = $resume;
					WC()->session->set( self::SESSION_FLOW, $flow );
					if ( $requires_code ) {
						WC()->session->set( Attempt_State::SESSION_EMAIL_V, null );
						WC()->session->set( Attempt_State::SESSION_EMAIL_V_EXPIRES, null );
						$state->clear_device_cookie();
					} else {
						$state->set_email_verification( $result['email_verification'], $email, $result['expires_at'] );
						if ( ! empty( $result['device_grant'] ) ) { $state->set_device_grant( $result['device_grant'], $email ); }
						elseif ( ! $flow['draft']['remember'] ) { $state->clear_device_cookie(); }
						WC()->customer->set_billing_email( $email );
						WC()->customer->save();
					}
				}
			} else { $resume['message'] = __( 'Google sign-in could not be confirmed. Try again or use email instead.', 'prism-simple-checkout' ); }
		}
		WC()->session->set( self::SESSION_RESUME, $resume );
		WC()->session->save_data();
		wp_safe_redirect( apply_filters( 'psc_google_return_destination', $flow['checkout_url'], $flow['request_id'] ), 303 );
		exit;
	}

	public static function clear_resume(): void {
		if ( function_exists( 'WC' ) && WC() && WC()->session ) { WC()->session->set( self::SESSION_RESUME, null ); }
	}
}
