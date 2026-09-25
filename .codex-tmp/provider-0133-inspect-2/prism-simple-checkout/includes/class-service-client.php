<?php
namespace PrismSimpleCheckout;
defined( 'ABSPATH' ) || exit;
/** Exact raw-body SiteHmac client for the frozen psc-payment-1 protocol. */
final class Service_Client {
	public const HEADER_SITE = 'X-PSC-Site';
	public const HEADER_TIMESTAMP = 'X-PSC-Timestamp';
	public const HEADER_NONCE = 'X-PSC-Nonce';
	public const HEADER_CONTRACT = 'X-PSC-Contract';
	public const HEADER_SIGNATURE = 'X-PSC-Signature';
	public const TIMESTAMP_TOLERANCE = 300;
	public static function canonical_string( string $method, string $path, string $timestamp, string $nonce, string $contract, string $raw ): string {
		return implode( "\n", array( strtoupper( $method ), $path, $timestamp, $nonce, $contract, hash( 'sha256', $raw ) ) );
	}
	public static function sign( string $canonical, string $credential ): string {
		return hash_hmac( 'sha256', $canonical, $credential );
	}
	public static function expected_fee_minor( int $amount_minor ): ?int {
		if ( $amount_minor <= 0
			|| ( PHP_INT_SIZE >= 8 && $amount_minor > 9007199254740991 )
			|| $amount_minor > intdiv( PHP_INT_MAX - 5000, 300 ) ) {
			return null;
		}
		$fee = intdiv( $amount_minor * 300 + 5000, 10000 );
		return $fee > 0 && $fee < $amount_minor ? $fee : null;
	}
	public static function observe_fee( array $payment, $order, string $ingress ): void {
		try {
			$amount = (int) ( $payment['amount_minor'] ?? 0 );
			$actual = (int) ( $payment['fee_minor'] ?? -1 );
			$expected = self::expected_fee_minor( $amount );
			if ( null !== $expected && $actual === $expected ) { return; }
			$order_id = 0;
			try {
				$order_id = is_object( $order ) ? (int) $order->get_id() : 0;
			} catch ( \Throwable $error ) {
				unset( $error );
			}
			$payment_id = (string) ( $payment['payment_id'] ?? '' );
			$expected_text = null === $expected ? 'invalid amount' : (string) $expected;
			$message = sprintf( 'PRISM fee integrity mismatch on %s for order #%d / payment %s: expected %s minor units, service reported %d. Payment completion was not blocked.', $ingress, $order_id, $payment_id, $expected_text, $actual );
			try {
				if ( is_object( $order ) && method_exists( $order, 'add_order_note' ) ) { $order->add_order_note( $message ); }
			} catch ( \Throwable $error ) {
				unset( $error );
			}
			try {
				Settings::raise_admin_alert(
					'fee_' . hash( 'sha256', $order_id . '|' . $payment_id . '|' . $expected_text . '|' . $actual ),
					$message,
					array( 'event' => 'fee_integrity_mismatch', 'ingress' => $ingress, 'order_id' => $order_id, 'payment_id' => $payment_id, 'amount_minor' => $amount, 'expected_fee_minor' => $expected, 'actual_fee_minor' => $actual )
				);
			} catch ( \Throwable $error ) {
				unset( $error );
			}
		} catch ( \Throwable $error ) {
			unset( $error );
		}
	}
	public static function generate_nonce(): string {
		return bin2hex( random_bytes( 16 ) );
	}
	public function exchange_activation( string $token, string $site_url, string $fingerprint, string $base, ?string $callback_url = null ) {
		$body = array(
			'token'             => $token,
			'site_url'          => $site_url,
			'site_fingerprint'  => $fingerprint,
			'payment_contract'  => PSC_PAYMENT_CONTRACT,
		);
		if ( $callback_url ) {
			$body['callback_url'] = $callback_url;
		}
		return $this->request(
			'POST', '/v1/activations/exchange',
			$body,
			array( 200 ),
			array( 'site_id' => 'string', 'site_credential' => 'string', 'service_url' => 'string', 'payment_contract' => 'string' ),
			array( 'verification_mode' => 'string' ), untrailingslashit( $base )
		);
	}
	/** Re-register the plugin's canonical rest_url callback after permalink changes. */
	public function register_callback_url( string $callback_url ) {
		return $this->request(
			'POST', '/v1/sites/callback-url',
			array( 'callback_url' => $callback_url ),
			array( 200 ),
			array( 'site_id' => 'string', 'callback_url' => 'string' )
		);
	}
	/** Path used in HMAC for the Woo callback (pathname + optional query). */
	public static function callback_sign_path( ?string $callback_url = null ): string {
		$url = $callback_url ?: ( function_exists( 'rest_url' ) ? rest_url( 'psc/v1/callback' ) : '' );
		if ( ! $url ) {
			return '/wp-json/psc/v1/callback';
		}
		$parts = function_exists( 'wp_parse_url' ) ? wp_parse_url( $url ) : parse_url( $url );
		if ( ! is_array( $parts ) || empty( $parts['path'] ) ) {
			return '/wp-json/psc/v1/callback';
		}
		$path = (string) $parts['path'];
		if ( ! empty( $parts['query'] ) ) {
			$path .= '?' . $parts['query'];
		}
		return $path;
	}
	public function decommission_site() {
		$result = $this->request( 'POST', '/v1/sites/decommission', null, array( 200 ), array( 'site_id' => 'string', 'active' => 'bool' ) );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return false === $result['active'] ? $result : new \WP_Error( 'psc_decommission_refused', 'Service refused site decommission.' );
	}
	public function fetch_express_surface() {
		return $this->request(
			'POST', '/v1/sites/express-surface', array(), array( 200 ),
			array( 'publishable_key' => 'string', 'connected_account' => 'string', 'service_mode' => 'string' ),
			array( 'verification_mode' => 'string' )
		);
	}

	/** Lifecycle-only wallet domain ensure (never checkout hot path). */
	public function ensure_wallet_domain( string $site_url ) {
		$result = $this->request(
			'POST',
			'/v1/wallet-domains/ensure',
			array( 'site_url' => $site_url ),
			array( 200 ),
			array(
				'schema'           => 'string',
				'domain'           => 'string',
				'action'           => 'string',
				'enabled'          => 'bool',
				'apple_pay_status' => 'string',
			)
		);
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		// Strict contract beyond type map (schema, action, domain binds to sent site_url host).
		if ( ! Wallet_Domains::response_valid( $result, $site_url ) ) {
			return new \WP_Error( 'psc_schema', 'Invalid wallet domain response.' );
		}
		return $result;
	}
	public function create_otp_challenge( string $request_id, string $email ) {
		return $this->request(
			'POST', '/v1/otp/challenges', array( 'request_id' => $request_id, 'email' => $email ), array( 202 ),
			array( 'challenge_id' => 'string', 'dispatch_state' => 'string', 'expires_at' => 'string' )
		);
	}
	public function google_config() {
		return $this->request( 'GET', '/v1/auth/google/config', null, array( 200 ), array( 'google_enabled' => 'bool', 'auth_return_url' => 'nullable_string' ) );
	}
	public function register_auth_return_url( string $return_url ) {
		return $this->request( 'POST', '/v1/sites/auth-return-url', array( 'auth_return_url' => $return_url ), array( 200 ), array( 'site_id' => 'string', 'auth_return_url' => 'string' ) );
	}
	public function start_google( array $payload ) {
		return $this->request( 'POST', '/v1/auth/google/start', $payload, array( 200, 201 ), array( 'transaction_id' => 'string', 'url' => 'string', 'expires_at' => 'string' ) );
	}
	public function exchange_google( array $payload ) {
		return $this->request( 'POST', '/v1/auth/google/exchange', $payload, array( 200 ),
			array( 'email' => 'string', 'name' => 'string', 'remembered' => 'bool', 'requires_email_confirmation' => 'bool' ),
			array( 'email_verification' => 'string', 'expires_at' => 'string', 'device_grant' => 'string', 'researcher' => 'nullable_array' ) );
	}
	public function verify_otp( string $challenge_id, string $code, bool $remember, ?string $prior_grant = null ) {
		$body = array( 'challenge_id' => $challenge_id, 'code' => $code, 'remember_device' => $remember );
		if ( $prior_grant ) {
			$body['prior_device_grant'] = $prior_grant;
		}
		return $this->request(
			'POST', '/v1/otp/verifications', $body, array( 200 ),
			array( 'email_verification' => 'string', 'email' => 'string', 'expires_at' => 'string' ),
			array( 'device_grant' => 'string', 'researcher' => 'nullable_array' )
		);
	}
	public function touch_device_grant( string $device_grant ) {
		return $this->request(
			'POST',
			'/v1/device-grants/touch',
			array( 'device_grant' => $device_grant ),
			array( 200 ),
			array( 'remembered' => 'bool', 'email' => 'string' ), array( 'researcher' => 'nullable_array' )
		);
	}
	public function research_organizations( string $query, string $category ) {
		return $this->request( 'POST', '/v1/research/organizations/search', array( 'query' => $query, 'category' => $category ), array( 200 ), array( 'organizations' => 'array' ) );
	}
	public function create_research_record( array $payload ) {
		return $this->request( 'POST', '/v1/research/records', $payload, array( 200, 201 ), array( 'record' => 'array' ) );
	}
	public function list_research_records( ?string $cursor = null, int $limit = 25 ) {
		return $this->request( 'POST', '/v1/research/records/list', array( 'cursor' => $cursor, 'limit' => $limit ), array( 200 ), array( 'records' => 'array', 'next_cursor' => 'nullable_string' ) );
	}
	public function create_checkout_attempt( array $payload ) {
		$keys = array( 'request_id', 'woo_session_id', 'email', 'verification', 'legal', 'cart_fingerprint', 'amount_minor', 'currency', 'return_url', 'research_record' );
		$body = array_intersect_key( $payload, array_flip( $keys ) );
		foreach ( array( 'woo_order_id', 'woo_order_key' ) as $key ) {
			if ( ! empty( $payload[ $key ] ) ) {
				$body[ $key ] = $payload[ $key ];
			}
		}
		$body['amount_minor'] = (int) ( $body['amount_minor'] ?? 0 );
		$body['currency'] = strtolower( (string) ( $body['currency'] ?? '' ) );
		$result = $this->request(
			'POST', '/v1/checkout-attempts', $body, array( 201 ),
			array( 'attempt_id' => 'string', 'fence' => 'int', 'publishable_key' => 'string', 'connected_account' => 'string', 'service_mode' => 'string', 'amount_minor' => 'int', 'currency' => 'string', 'expires_at' => 'string' )
		);
		$mode_ok = is_array( $result )
			&& in_array( $result['service_mode'], array( 'test', 'production' ), true )
			&& (
				( 'test' === $result['service_mode'] && str_starts_with( (string) $result['publishable_key'], 'pk_test_' ) )
				|| ( 'production' === $result['service_mode'] && str_starts_with( (string) $result['publishable_key'], 'pk_live_' ) )
			)
			&& $result['fence'] > 0
			&& $result['amount_minor'] > 0
			&& str_starts_with( $result['connected_account'], 'acct_' );
		return $mode_ok ? $result : ( is_wp_error( $result ) ? $result : new \WP_Error( 'psc_schema', 'Invalid checkout-attempt identity.' ) );
	}
	public function confirm_checkout_attempt( string $attempt_id, array $payload ) {
		$body = array(
			'operation_id' => (string) ( $payload['operation_id'] ?? '' ),
			'fence' => (int) ( $payload['fence'] ?? 0 ),
			'confirmation_token' => (string) ( $payload['confirmation_token'] ?? '' ),
			'cart_fingerprint' => (string) ( $payload['cart_fingerprint'] ?? '' ),
			'amount_minor' => (int) ( $payload['amount_minor'] ?? 0 ),
			'currency' => strtolower( (string) ( $payload['currency'] ?? '' ) ),
		);
		if ( ! empty( $payload['woo_order_id'] ) ) {
			$body['woo_order_id'] = (int) $payload['woo_order_id'];
		}
		if ( ! empty( $payload['woo_order_key'] ) ) {
			$body['woo_order_key'] = (string) $payload['woo_order_key'];
		}
		$result = $this->request(
			'POST', '/v1/checkout-attempts/' . rawurlencode( $attempt_id ) . '/confirm', $body, array( 200 ), self::payment_schema(),
			array( 'application_fee_id' => 'nullable_string', 'client_secret' => 'nullable_string', 'next_action_required' => 'bool' )
		);
		return self::payment_valid( $result ) ? $result : ( is_wp_error( $result ) ? $result : new \WP_Error( 'psc_schema', 'Invalid payment state.' ) );
	}
	public function get_payment( string $payment_id ) {
		$result = $this->request(
			'GET', '/v1/payments/' . rawurlencode( $payment_id ), null, array( 200 ), self::payment_schema(),
			array( 'application_fee_id' => 'nullable_string', 'client_secret' => 'nullable_string', 'next_action_required' => 'bool' )
		);
		return self::payment_valid( $result ) ? $result : ( is_wp_error( $result ) ? $result : new \WP_Error( 'psc_schema', 'Invalid payment state.' ) );
	}
	public function create_refund( array $payload ) {
		$body = array(
			'operation_id' => (string) ( $payload['operation_id'] ?? '' ),
			'payment_id' => (string) ( $payload['payment_id'] ?? '' ),
			'woo_order_id' => (int) ( $payload['woo_order_id'] ?? 0 ),
			'amount_minor' => (int) ( $payload['amount_minor'] ?? 0 ),
		);
		if ( ! empty( $payload['reason'] ) ) {
			$body['reason'] = substr( (string) $payload['reason'], 0, 500 );
		}
		return $this->request(
			'POST', '/v1/refunds', $body, array( 200 ),
			array( 'operation_id' => 'string', 'refund_id' => 'string', 'status' => 'string', 'amount_minor' => 'int', 'fee_reversal_minor' => 'int' ),
			array( 'application_fee_refund_id' => 'string' )
		);
	}
	public function verify_callback( string $raw, array $headers, string $path = '/wp-json/psc/v1/callback' ) {
		$creds = Credential_Store::get();
		if ( ! $creds ) {
			return new \WP_Error( 'psc_not_configured', 'Site credentials missing.' );
		}
		$h = array();
		foreach ( $headers as $key => $value ) {
			$h[ strtolower( str_replace( '_', '-', (string) $key ) ) ] = is_array( $value ) ? (string) reset( $value ) : (string) $value;
		}
		$site = $h['x-psc-site'] ?? '';
		$timestamp = $h['x-psc-timestamp'] ?? '';
		$nonce = $h['x-psc-nonce'] ?? '';
		$contract = $h['x-psc-contract'] ?? '';
		$signature = strtolower( $h['x-psc-signature'] ?? '' );
		if ( ! ctype_digit( $timestamp ) || abs( time() - (int) $timestamp ) > self::TIMESTAMP_TOLERANCE || ! preg_match( '/^[0-9a-f]{16,128}$/i', $nonce ) || ! preg_match( '/^[0-9a-f]{64}$/', $signature ) ) {
			return new \WP_Error( 'bad_signature', 'Invalid callback envelope.' );
		}
		if ( ! hash_equals( $creds['site_id'], $site ) || ! hash_equals( $creds['payment_contract'], $contract ) ) {
			return new \WP_Error( 'bad_signature', 'Site or contract mismatch.' );
		}
		$expected = self::sign( self::canonical_string( 'POST', $path, $timestamp, $nonce, $contract, $raw ), $creds['site_credential'] );
		return hash_equals( $expected, $signature ) ? true : new \WP_Error( 'bad_signature', 'Callback signature mismatch.' );
	}
	public static function validate_schema( array $data, array $required, array $optional = array() ) {
		// Response contracts are additive. Unknown response fields are ignored by
		// every caller, so refusing an otherwise valid payment object here turns a
		// harmless service rollout into an ambiguous confirmation and strands the
		// Woo order behind a provisional pending_<attempt> marker.
		foreach ( $required as $key => $type ) {
			if ( ! array_key_exists( $key, $data ) || ! self::type_ok( $data[ $key ], $type ) ) {
				return new \WP_Error( 'psc_schema', 'Missing or invalid response field: ' . $key );
			}
		}
		foreach ( $optional as $key => $type ) {
			if ( array_key_exists( $key, $data ) && ! self::type_ok( $data[ $key ], $type ) ) {
				return new \WP_Error( 'psc_schema', 'Invalid response field: ' . $key );
			}
		}
		return true;
	}
	private static function payment_schema(): array {
		return array( 'payment_id' => 'string', 'attempt_id' => 'string', 'connected_account' => 'string', 'status' => 'string', 'amount_minor' => 'int', 'fee_minor' => 'int', 'currency' => 'string' );
	}
	private static function payment_valid( $value ): bool {
		return is_array( $value ) && str_starts_with( (string) $value['connected_account'], 'acct_' ) && $value['amount_minor'] > 0 && $value['fee_minor'] >= 0 && preg_match( '/^[a-z]{3}$/', $value['currency'] ) && in_array( $value['status'], array( 'creating', 'requires_action', 'processing', 'succeeded', 'failed', 'canceled', 'attention' ), true ) && ( 'requires_action' !== $value['status'] || ( true === ( $value['next_action_required'] ?? false ) && '' !== (string) ( $value['client_secret'] ?? '' ) ) );
	}
	private static function type_ok( $value, string $type ): bool {
		return ( 'array' === $type && is_array( $value ) ) || ( 'nullable_array' === $type && ( null === $value || is_array( $value ) ) ) || ( 'nullable_string' === $type && ( null === $value || is_string( $value ) ) ) || ( 'string' === $type && is_string( $value ) ) || ( 'int' === $type && is_int( $value ) ) || ( 'bool' === $type && is_bool( $value ) );
	}
	private function request( string $method, string $path, ?array $body, array $codes, array $required, array $optional = array(), string $unsigned_base = '' ) {
		if ( defined( 'PSC_VERIFICATION_ONLY' ) && PSC_VERIFICATION_ONLY ) {
			$allowed = array( '/v1/activations/exchange', '/v1/otp/challenges', '/v1/otp/verifications', '/v1/device-grants/touch', '/v1/research/organizations/search', '/v1/research/records', '/v1/research/records/list', '/v1/sites/auth-return-url', '/v1/auth/google/config', '/v1/auth/google/start', '/v1/auth/google/exchange' );
			if ( ! in_array( $path, $allowed, true ) ) {
				return new \WP_Error( 'psc_verification_only', Research_Checkout::PAYMENT_DISABLED );
			}
		}
		$raw = null === $body ? '' : (string) wp_json_encode( $body );
		$headers = array( 'Content-Type' => 'application/json' );
		if ( '' === $unsigned_base ) {
			$creds = Credential_Store::get();
			if ( ! $creds ) {
				return new \WP_Error( 'psc_not_configured', 'Site credentials missing.' );
			}
			$timestamp = (string) time();
			$nonce = self::generate_nonce();
			$contract = $creds['payment_contract'];
			$headers += array(
				self::HEADER_SITE => $creds['site_id'], self::HEADER_TIMESTAMP => $timestamp,
				self::HEADER_NONCE => $nonce, self::HEADER_CONTRACT => $contract,
				self::HEADER_SIGNATURE => self::sign( self::canonical_string( $method, $path, $timestamp, $nonce, $contract, $raw ), $creds['site_credential'] ),
			);
			$base = $creds['service_url'];
		} else {
			$base = $unsigned_base;
		}
		if ( defined( 'PSC_MANUAL_UPDATES' ) && PSC_MANUAL_UPDATES ) {
			$host = strtolower( (string) wp_parse_url( $base, PHP_URL_HOST ) );
			$approved = defined( 'PSC_FALL_SERVICE_URL' ) ? untrailingslashit( (string) PSC_FALL_SERVICE_URL ) : '';
			if ( '' === $approved || ! hash_equals( $approved, untrailingslashit( $base ) ) || 'checkout.prismpro.io' === $host ) {
				return new \WP_Error( 'psc_fall_service_required', 'Configure the dedicated PRISM Fall service URL before connecting this build.' );
			}
		}
		$args = array( 'method' => strtoupper( $method ), 'timeout' => 30, 'redirection' => 0, 'headers' => $headers );
		if ( '' !== $raw ) {
			$args['body'] = $raw;
		}
		$response = wp_remote_request( $base . $path, $args );
		if ( is_wp_error( $response ) ) {
			$transport_code = sanitize_key( (string) $response->get_error_code() );
			self::log_service_error(
				$path,
				'transport',
				array( 'transport_code' => $transport_code )
			);
			return new \WP_Error(
				'psc_http_error',
				'Service request failed.',
				array( 'transport_code' => $transport_code )
			);
		}
		$status = (int) wp_remote_retrieve_response_code( $response );
		if ( ! in_array( $status, $codes, true ) ) {
			$err_body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
			$service_code = is_array( $err_body ) ? sanitize_key( (string) ( $err_body['error'] ?? '' ) ) : '';
			self::log_service_error(
				$path,
				'http_status',
				array( 'status' => $status, 'service_code' => $service_code )
			);
			return new \WP_Error(
				'psc_http_status',
				'Unexpected service status.',
				array(
					'status'       => $status,
					'service_code' => $service_code,
				)
			);
		}
		$data = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $data ) ) {
			self::log_service_error( $path, 'invalid_json', array( 'status' => $status ) );
			return new \WP_Error( 'psc_schema', 'Service response was not an object.' );
		}
		$valid = self::validate_schema( $data, $required, $optional );
		if ( is_wp_error( $valid ) ) {
			self::log_service_error(
				$path,
				'schema',
				array( 'status' => $status, 'response_keys' => array_values( array_map( 'strval', array_keys( $data ) ) ), 'schema_error' => $valid->get_error_message() )
			);
		}
		return is_wp_error( $valid ) ? $valid : $data;
	}

	/** Log only diagnostic metadata; never log request bodies, credentials or tokens. */
	private static function log_service_error( string $path, string $kind, array $context = array() ): void {
		if ( ! function_exists( 'wc_get_logger' ) ) { return; }
		$safe_path = preg_replace( '#^/v1/checkout-attempts/[^/]+/confirm$#', '/v1/checkout-attempts/{id}/confirm', $path );
		$safe_path = preg_replace( '#^/v1/payments/[^/?]+#', '/v1/payments/{id}', (string) $safe_path );
		$safe_path = preg_replace( '/[0-9a-f]{8}-[0-9a-f-]{27,}/i', '{id}', (string) $safe_path );
		try {
			wc_get_logger()->error(
				sprintf( 'Payment service %s on %s.', $kind, (string) $safe_path ),
				array_merge( array( 'source' => 'prism-simple-checkout', 'event' => 'payment_service_error', 'kind' => $kind, 'path' => (string) $safe_path ), $context )
			);
		} catch ( \Throwable $error ) {
			unset( $error );
		}
	}
}
