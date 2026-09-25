<?php
namespace PrismSimpleCheckout;
defined( 'ABSPATH' ) || exit;
/** Checkout state scoped to Woo's server-side session. */
final class Attempt_State {
	public const SESSION_ATTEMPT = 'psc_attempt';
	public const SESSION_DEVICE = 'psc_device_grant';
	public const SESSION_EMAIL_V = 'psc_email_verification';
	public const SESSION_EMAIL_V_EXPIRES = 'psc_email_verification_expires';
	public const SESSION_DEVICE_EMAIL = 'psc_device_email';
	public const SESSION_VERIFIED_EMAIL = 'psc_verified_email';
	public const COOKIE_NAME = 'psc_dg';
	public const COOKIE_TTL = 2592000; // 30 days.
	public function store_attempt( array $attempt ): void {
		if ( ! empty( $attempt['device_grant'] ) ) {
			$this->set_device_grant( (string) $attempt['device_grant'], (string) ( $attempt['email'] ?? '' ) );
		}
		$keys = array( 'attempt_id', 'fence', 'cart_fingerprint', 'identity_digest', 'amount_minor', 'currency', 'email', 'publishable_key', 'connected_account', 'expires_at', 'operation_id', 'claim_key', 'claim_owner', 'claim_fence', 'research_record_id', 'research_record_digest', 'service_mode', 'woo_order_id', 'service_order_binding' );
		$clean = array();
		foreach ( $keys as $key ) {
			$clean[ $key ] = $attempt[ $key ] ?? ( in_array( $key, array( 'fence', 'amount_minor', 'claim_fence' ), true ) ? 0 : '' );
		}
		$clean['woo_order_id'] = (int) $clean['woo_order_id'];
		$clean['fence'] = (int) $clean['fence'];
		$clean['claim_fence'] = (int) $clean['claim_fence'];
		$clean['amount_minor'] = (int) $clean['amount_minor'];
		$clean['currency'] = strtolower( (string) $clean['currency'] );
		$clean['email'] = strtolower( (string) $clean['email'] );
		// Digests only — never store raw field values for diagnostics.
		$clean['category_digests'] = is_array( $attempt['category_digests'] ?? null )
			? $attempt['category_digests']
			: Cart_Fingerprint::category_digests( Cart_Fingerprint::payload_from_cart() );
		$clean['address_field_digests'] = is_array( $attempt['address_field_digests'] ?? null )
			? $attempt['address_field_digests']
			: Cart_Fingerprint::address_field_digests( Cart_Fingerprint::payload_from_cart() );
		$this->set( self::SESSION_ATTEMPT, $clean );
	}
	public function get_attempt(): ?array {
		$value = $this->get( self::SESSION_ATTEMPT );
		if ( ! is_array( $value ) || empty( $value['attempt_id'] ) ) {
			return null;
		}
		// H8: enforce expires_at — never hand a dead attempt back to the buyer.
		if ( self::is_expired( $value ) ) {
			$this->clear_attempt();
			return null;
		}
		return $value;
	}
	/** True when expires_at is present and in the past. */
	public static function is_expired( array $attempt ): bool {
		$raw = (string) ( $attempt['expires_at'] ?? '' );
		if ( '' === $raw ) {
			return false;
		}
		$ts = strtotime( $raw );
		return false !== $ts && $ts <= time();
	}
	public function clear_attempt(): void {
		$this->set( self::SESSION_ATTEMPT, null );
	}
	public function invalidate_if_fingerprint_changed( string $fingerprint, string $context = '' ): bool {
		$attempt = $this->get_attempt();
		if ( ! $attempt || hash_equals( (string) $attempt['cart_fingerprint'], $fingerprint ) ) {
			return false;
		}
		// Privacy-safe: log only category/field NAMES that drifted — never values or digests.
		// DIAGNOSTIC (1.0.9.7): stage= names the handler that invalidated (create_attempt /
		// sync_wallet / process_payment) and fields= names the exact drifting field, so a
		// false "cart changed before payment" can be root-caused from one log line.
		$payload = Cart_Fingerprint::payload_from_cart();
		$prior = is_array( $attempt['category_digests'] ?? null ) ? $attempt['category_digests'] : array();
		$next  = Cart_Fingerprint::category_digests( $payload );
		$cats  = Cart_Fingerprint::changed_categories( $prior, $next );
		$fields = Cart_Fingerprint::changed_fields(
			is_array( $attempt['address_field_digests'] ?? null ) ? $attempt['address_field_digests'] : array(),
			Cart_Fingerprint::address_field_digests( $payload )
		);
		// DIAGNOSTIC (1.0.10.0): when the TOTAL is what moved, names alone are not enough —
		// log the authorized amount, the live amount, the delta, and every individual fee
		// line, so a toggleable checkout fee (shipping protection, insurance, tip) that
		// changes the total mid-checkout identifies itself on the first failure.
		$money_line = '';
		try {
			$live_amount = Cart_Fingerprint::amount_minor_from_cart();
			$att_amount  = (int) ( $attempt['amount_minor'] ?? 0 );
			$fee_parts   = array();
			if ( function_exists( 'WC' ) && WC() && WC()->cart ) {
				foreach ( (array) WC()->cart->get_fees() as $fee ) {
					$fee_name = is_object( $fee ) && isset( $fee->name ) ? (string) $fee->name : 'fee';
					$fee_amt  = is_object( $fee ) && isset( $fee->total ) ? (string) $fee->total : '0';
					$fee_parts[] = $fee_name . '=' . Cart_Fingerprint::total_to_minor( $fee_amt );
				}
			}
			$money_line = ' | attempt_amount=' . $att_amount
				. ' live_amount=' . $live_amount
				. ' delta=' . ( $live_amount - $att_amount )
				. ' shipping=' . Cart_Fingerprint::selected_shipping_minor_from_cart()
				. ' fees=' . ( $fee_parts ? implode( ',', $fee_parts ) : 'none' );
		} catch ( \Throwable $e ) {
			$money_line = ' | money=unavailable';
		}
		if ( function_exists( 'wc_get_logger' ) ) {
			$logger = wc_get_logger();
			if ( is_object( $logger ) && method_exists( $logger, 'info' ) ) {
				$logger->info(
					'PRISM checkout attempt invalidated; changed categories: ' . ( $cats ? implode( ',', $cats ) : 'none' )
						. ' | stage=' . ( '' !== $context ? $context : 'unknown' )
						. ' | fields=' . ( $fields ? implode( ',', $fields ) : 'none' )
						. $money_line,
					array( 'source' => 'prism-simple-checkout' )
				);
			}
		}
		$this->clear_attempt();
		return true;
	}
	public function invalidate_email( string $email ): bool {
		$email = strtolower( trim( $email ) );
		$attempt = $this->get_attempt();
		$changed = $attempt && ! hash_equals( (string) $attempt['email'], $email );
		$verified = (string) $this->get( self::SESSION_VERIFIED_EMAIL );
		if ( $changed ) {
			$this->clear_attempt();
		}
		$record = $this->get( Research_Checkout::SESSION_RECORD );
		if ( is_array( $record ) && ! hash_equals( strtolower( (string) ( $record['email'] ?? '' ) ), $email ) ) { $this->set( Research_Checkout::SESSION_RECORD, null ); }
		if ( '' !== $verified && ! hash_equals( $verified, $email ) ) {
			$this->set( self::SESSION_EMAIL_V, null );
			$this->set( self::SESSION_EMAIL_V_EXPIRES, null );
			$this->set( self::SESSION_VERIFIED_EMAIL, null );
			$changed = true;
		}
		return $changed;
	}
	public function set_email_verification( string $token, string $email = '', string $expires_at = '' ): void {
		$this->set( self::SESSION_EMAIL_V, $token );
		$this->set( self::SESSION_EMAIL_V_EXPIRES, '' !== $expires_at ? $expires_at : gmdate( 'c', time() + 1800 ) );
		if ( '' !== $email ) {
			$this->set( self::SESSION_VERIFIED_EMAIL, strtolower( $email ) );
		}
	}
	public function get_email_verification( string $email = '' ): ?string {
		$token = $this->get( self::SESSION_EMAIL_V );
		$verified = (string) $this->get( self::SESSION_VERIFIED_EMAIL );
		$expires_raw = $this->get( self::SESSION_EMAIL_V_EXPIRES );
		// 1.0.8 leftover: missing/empty ev_ expires is expired so a live device grant is preferred.
		if ( null === $expires_raw || '' === (string) $expires_raw || self::is_expired( array( 'expires_at' => (string) $expires_raw ) ) ) {
			$this->set( self::SESSION_EMAIL_V, null );
			$this->set( self::SESSION_EMAIL_V_EXPIRES, null );
			return null;
		}
		if ( '' !== $email && ( '' === $verified || ! hash_equals( $verified, strtolower( $email ) ) ) ) {
			return null;
		}
		return is_string( $token ) && '' !== $token ? $token : null;
	}
	/**
	 * Why create_attempt cannot use email/device evidence for this billing email.
	 * Returns null when a usable email_verification or device_grant is present.
	 * Distinct codes (never silent null alone):
	 * - email_mismatch — OTP/device bound to a different email than billing
	 * - email_verification_required — no OTP or device grant in session
	 */
	public function verification_block_reason( string $email = '' ): ?string {
		$email    = strtolower( trim( $email ) );
		$token    = $this->get( self::SESSION_EMAIL_V );
		$verified = strtolower( (string) $this->get( self::SESSION_VERIFIED_EMAIL ) );
		if ( is_string( $token ) && '' !== $token ) {
			if ( '' === $email ) {
				return null;
			}
			if ( '' !== $verified && ! hash_equals( $verified, $email ) ) {
				return 'email_mismatch';
			}
			if ( '' === $verified ) {
				return 'email_verification_required';
			}
			return null;
		}
		$grant = $this->get( self::SESSION_DEVICE );
		$bound = strtolower( (string) $this->get( self::SESSION_DEVICE_EMAIL ) );
		if ( is_string( $grant ) && '' !== $grant ) {
			if ( '' === $email ) {
				return null;
			}
			if ( '' !== $bound && ! hash_equals( $bound, $email ) ) {
				return 'email_mismatch';
			}
			if ( '' === $bound ) {
				return 'email_verification_required';
			}
			return null;
		}
		return 'email_verification_required';
	}
	public function set_device_grant( string $grant, string $email = '' ): void {
		$this->set( self::SESSION_DEVICE, $grant );
		if ( '' !== $email ) {
			$this->set( self::SESSION_DEVICE_EMAIL, strtolower( $email ) );
		}
		$this->write_device_cookie( $grant, time() + self::COOKIE_TTL );
	}
	public function get_device_grant( string $email = '' ): ?string {
		$grant = $this->get( self::SESSION_DEVICE );
		if ( ( ! is_string( $grant ) || '' === $grant ) ) {
			$grant = $this->read_device_cookie();
		}
		$bound = (string) $this->get( self::SESSION_DEVICE_EMAIL );
		if ( '' !== $email && ( '' === $bound || ! hash_equals( $bound, strtolower( $email ) ) ) ) {
			return null;
		}
		return is_string( $grant ) && '' !== $grant ? $grant : null;
	}
	public function read_device_cookie(): ?string {
		$value = isset( $_COOKIE[ self::COOKIE_NAME ] ) ? (string) $_COOKIE[ self::COOKIE_NAME ] : '';
		return '' !== $value ? $value : null;
	}
	public function clear_device_cookie(): void {
		$this->set( self::SESSION_DEVICE, null );
		$this->set( self::SESSION_DEVICE_EMAIL, null );
		$this->write_device_cookie( '', time() - 3600 );
		unset( $_COOKIE[ self::COOKIE_NAME ] );
	}
	private function write_device_cookie( string $value, int $expire ): void {
		$path = defined( 'COOKIEPATH' ) && COOKIEPATH ? COOKIEPATH : '/';
		$opts = array(
			'expires'  => $expire,
			'path'     => $path,
			'secure'   => function_exists( 'is_ssl' ) ? is_ssl() : true,
			'httponly' => true,
			'samesite' => 'Lax',
		);
		if ( defined( 'COOKIE_DOMAIN' ) && COOKIE_DOMAIN ) {
			$opts['domain'] = COOKIE_DOMAIN;
		}
		if ( ! headers_sent() ) {
			setcookie( self::COOKIE_NAME, $value, $opts );
		}
		if ( $expire > time() && '' !== $value ) {
			$_COOKIE[ self::COOKIE_NAME ] = $value;
		} else {
			unset( $_COOKIE[ self::COOKIE_NAME ] );
		}
		if ( isset( $GLOBALS['psc_test_cookies'] ) && is_array( $GLOBALS['psc_test_cookies'] ) ) {
			$GLOBALS['psc_test_cookies'][ self::COOKIE_NAME ] = array_merge( array( 'value' => $value ), $opts );
		}
	}
	private function get( string $key ) {
		return function_exists( 'WC' ) && WC() && WC()->session ? WC()->session->get( $key ) : null;
	}
	private function set( string $key, $value ): void {
		if ( function_exists( 'WC' ) && WC() && WC()->session ) {
			WC()->session->set( $key, $value );
		}
	}
}
