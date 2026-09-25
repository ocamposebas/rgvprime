<?php
namespace PrismSimpleCheckout;
defined( 'ABSPATH' ) || exit;
/** Authenticated-at-rest storage for the per-site service credential. */
final class Credential_Store {
	public const OPTION_KEY = 'psc_site_credentials';
	private const PREFIX = 'g1:';
	private const AAD = 'prism-simple-checkout/site-credential/v1';
	private static $diagnostic = 'never_configured';
	public static function store( array $data ): bool {
		$site_id = trim( (string) ( $data['site_id'] ?? '' ) );
		$secret = (string) ( $data['site_credential'] ?? '' );
		$encrypted = self::encrypt( $secret );
		if ( '' === $site_id || '' === $secret || '' === $encrypted || PSC_PAYMENT_CONTRACT !== (string) ( $data['payment_contract'] ?? '' ) ) {
			return false;
		}
		return update_option(
			self::OPTION_KEY,
			array(
				'site_id'             => $site_id,
				'site_credential_enc' => $encrypted,
				'service_url'         => untrailingslashit( (string) ( $data['service_url'] ?? '' ) ),
				'payment_contract'    => (string) ( $data['payment_contract'] ?? PSC_PAYMENT_CONTRACT ),
				'home_url'            => self::current_home(),
				'salt_fingerprint'    => self::salt_fingerprint(),
				'stored_at'           => gmdate( 'c' ),
			),
			false
		);
	}
	public static function get(): ?array {
		self::$diagnostic = 'never_configured';
		$raw = get_option( self::OPTION_KEY, null );
		if ( ! is_array( $raw ) ) { return null; }
		$has_home = array_key_exists( 'home_url', $raw );
		$has_salt = array_key_exists( 'salt_fingerprint', $raw );
		if ( $has_home xor $has_salt ) {
			self::$diagnostic = 'credential_corrupt';
			return null;
		}
		$legacy = ! $has_home;
		if ( $legacy ) {
			self::$diagnostic = 'legacy_unpinned';
			return null;
		}
		$home_moved = ! hash_equals( self::current_home(), (string) $raw['home_url'] );
		$salts_changed = ! hash_equals( self::salt_fingerprint(), (string) $raw['salt_fingerprint'] );
		if ( $home_moved || $salts_changed ) {
			self::$diagnostic = $home_moved && $salts_changed ? 'home_and_salts_changed' : ( $home_moved ? 'home_moved' : 'salts_changed' );
			return null;
		}
		$secret = self::decrypt( (string) ( $raw['site_credential_enc'] ?? '' ) );
		if ( '' === $secret ) {
			self::$diagnostic = 'credential_corrupt';
			return null;
		}
		if ( '' === trim( (string) ( $raw['site_id'] ?? '' ) ) || PSC_PAYMENT_CONTRACT !== (string) ( $raw['payment_contract'] ?? '' ) ) {
			self::$diagnostic = 'credential_corrupt';
			return null;
		}
		self::$diagnostic = '';
		return array(
			'site_id'          => (string) $raw['site_id'],
			'site_credential'  => $secret,
			'service_url'      => (string) ( $raw['service_url'] ?? '' ),
			'payment_contract' => (string) ( $raw['payment_contract'] ?? PSC_PAYMENT_CONTRACT ),
		);
	}
	public static function diagnostic_code(): string {
		self::get();
		return (string) self::$diagnostic;
	}
	public static function pin_legacy_for_current_home(): bool {
		$raw = get_option( self::OPTION_KEY, null );
		if ( ! is_array( $raw ) || array_key_exists( 'home_url', $raw ) || array_key_exists( 'salt_fingerprint', $raw ) ) {
			return false;
		}
		$site_id = trim( (string) ( $raw['site_id'] ?? '' ) );
		$secret = self::decrypt( (string) ( $raw['site_credential_enc'] ?? '' ) );
		if ( '' === $site_id || '' === trim( $secret ) || PSC_PAYMENT_CONTRACT !== (string) ( $raw['payment_contract'] ?? '' ) ) {
			return false;
		}
		$raw['home_url'] = self::current_home();
		$raw['salt_fingerprint'] = self::salt_fingerprint();
		return update_option( self::OPTION_KEY, $raw, false );
	}
	private static function current_home(): string {
		return untrailingslashit( (string) home_url( '/' ) );
	}
	private static function salt_fingerprint(): string {
		return hash( 'sha256', self::key() );
	}
	public static function is_configured(): bool {
		return null !== self::get();
	}
	public static function encrypt( string $plaintext ): string {
		if ( '' === $plaintext || ! function_exists( 'openssl_encrypt' ) ) {
			return '';
		}
		$nonce = random_bytes( 12 );
		$tag = '';
		$ciphertext = openssl_encrypt( $plaintext, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $nonce, $tag, self::AAD, 16 );
		if ( false === $ciphertext || 16 !== strlen( $tag ) ) {
			return '';
		}
		return self::PREFIX . rtrim( strtr( base64_encode( $nonce . $tag . $ciphertext ), '+/', '-_' ), '=' );
	}
	public static function decrypt( string $blob ): string {
		if ( ! str_starts_with( $blob, self::PREFIX ) || ! function_exists( 'openssl_decrypt' ) ) {
			return '';
		}
		$encoded = substr( $blob, strlen( self::PREFIX ) );
		$encoded .= str_repeat( '=', ( 4 - strlen( $encoded ) % 4 ) % 4 );
		$raw = base64_decode( strtr( $encoded, '-_', '+/' ), true );
		if ( false === $raw || strlen( $raw ) < 29 ) {
			return '';
		}
		$plain = openssl_decrypt( substr( $raw, 28 ), 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, substr( $raw, 0, 12 ), substr( $raw, 12, 16 ), self::AAD );
		return false === $plain ? '' : $plain;
	}
	private static function key(): string {
		$salts = array( AUTH_KEY, SECURE_AUTH_KEY, AUTH_SALT, SECURE_AUTH_SALT, self::AAD );
		return hash( 'sha256', implode( '|', $salts ), true );
	}
}
