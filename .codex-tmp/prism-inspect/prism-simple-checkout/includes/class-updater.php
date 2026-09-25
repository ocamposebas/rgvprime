<?php
/** Fail-closed signed static updater; never runs on shopper paths. */

namespace PrismSimpleCheckout;

if ( ! defined( 'ABSPATH' ) && ! defined( 'PSC_UPDATER_STANDALONE_TEST' ) ) {
	return;
}

final class Updater {
	public const SLUG = 'prism-simple-checkout';
	public const PLUGIN_BASENAME = 'prism-simple-checkout/prism-simple-checkout.php';
	public const UPDATE_URI = 'https://updates.groundsetter.com/prism-simple-checkout';
	public const MANIFEST_URL = 'https://updates.groundsetter.com/prism-simple-checkout/manifest.json';
	public const TRUSTED_ARTIFACT_HOST = 'updates.groundsetter.com';
	public const UPDATE_PUBLIC_KEY = 'PSC_UPDATE_PUBLIC_KEY_PLACEHOLDER';
	public const PAYLOAD_FIELDS = array( 'artifact_url', 'migration_set_hash', 'payment_contract_max', 'payment_contract_min', 'plugin_tree_hash', 'requires_php', 'requires_wc', 'requires_wp', 'slug', 'tested_wp', 'version', 'worker_hash', 'zip_sha256', 'zip_size' );

	public const MANIFEST_TRANSIENT = 'psc_verified_update_manifest_v1';
	private const UNCONFIGURED_PUBLIC_KEY_PARTS = array( 'PSC_UPDATE_PUBLIC_', 'KEY_PLACEHOLDER' );
	private static bool $hooked = false;
	private string $public_key;
	private bool $crypto_available;
	private string $payment_contract;
	private ?array $validated_manifest = null;

	public function __construct( ?string $public_key = null, ?bool $crypto_available = null, ?string $payment_contract = null ) {
		$this->public_key = $public_key ?? self::UPDATE_PUBLIC_KEY;
		$this->crypto_available = $crypto_available ?? function_exists( 'sodium_crypto_sign_verify_detached' );
		$this->payment_contract = $payment_contract ?? ( defined( 'PSC_PAYMENT_CONTRACT' ) ? (string) PSC_PAYMENT_CONTRACT : 'psc-payment-1' );
	}

	public function hooks(): void {
		if ( ( defined( 'PSC_MANUAL_UPDATES' ) && PSC_MANUAL_UPDATES ) || ( defined( 'PSC_VERIFICATION_ONLY' ) && PSC_VERIFICATION_ONLY ) ) {
			if ( ! self::$hooked && function_exists( 'add_filter' ) ) {
				self::$hooked = true;
				add_filter( 'auto_update_plugin', static function ( $update, $item ) { return ( $item->plugin ?? '' ) === plugin_basename( PSC_PLUGIN_FILE ) ? false : $update; }, 100, 2 );
				add_filter( 'site_transient_update_plugins', static function ( $value ) {
					if ( is_object( $value ) ) { unset( $value->response[ plugin_basename( PSC_PLUGIN_FILE ) ] ); }
					return $value;
				}, 100 );
			}
			return;
		}
		if ( self::$hooked || ! function_exists( 'add_filter' ) ) {
			return;
		}
		self::$hooked = true;
		$host = function_exists( 'wp_parse_url' ) ? wp_parse_url( self::UPDATE_URI, PHP_URL_HOST ) : parse_url( self::UPDATE_URI, PHP_URL_HOST );
		add_filter( 'update_plugins_' . $host, array( $this, 'filter_update' ), 10, 4 );
		add_filter( 'upgrader_pre_download', array( $this, 'pre_download' ), 10, 4 );
	}

	public static function canonical_payload( array $fields ): string {
		$payload = array();
		foreach ( self::PAYLOAD_FIELDS as $key ) {
			if ( ! array_key_exists( $key, $fields ) ) {
				return '';
			}
			$payload[ $key ] = $fields[ $key ];
		}
		$encoded = function_exists( 'wp_json_encode' ) ? wp_json_encode( $payload, JSON_UNESCAPED_SLASHES ) : json_encode( $payload, JSON_UNESCAPED_SLASHES );
		return (string) $encoded;
	}

	public function validate_manifest( array $manifest, array $ctx = array() ) {
		if ( ( $manifest['schema_version'] ?? null ) !== 1 ) {
			return self::err( 'update_malformed', 'schema_version must be integer 1' );
		}
		foreach ( self::PAYLOAD_FIELDS as $field ) {
			if ( ! array_key_exists( $field, $manifest ) ) {
				return self::err( 'update_malformed', 'missing field ' . $field );
			}
		}
		if ( ! is_string( $manifest['signed_payload'] ?? null ) || ! is_string( $manifest['signature'] ?? null ) ) {
			return self::err( 'update_malformed', 'signed_payload/signature required' );
		}
		if ( 1 !== preg_match( '/^[0-9a-f]{128}$/', (string) $manifest['signature'] ) ) {
			return self::err( 'update_malformed', 'signature must be 128 lowercase hex' );
		}
		if ( 1 !== preg_match( '/^[0-9a-f]{64}$/', (string) $manifest['zip_sha256'] ) ) {
			return self::err( 'update_malformed', 'zip_sha256 must be 64 lowercase hex' );
		}
		if ( ! is_int( $manifest['zip_size'] ) || $manifest['zip_size'] <= 0 ) {
			return self::err( 'update_malformed', 'zip_size must be positive int' );
		}
		foreach ( array( 'plugin_tree_hash', 'worker_hash', 'migration_set_hash' ) as $field ) {
			if ( ! self::valid_evidence_hash( $manifest[ $field ] ?? null ) ) {
				return self::err( 'update_malformed', $field . ' must be a non-placeholder sha256' );
			}
		}
		if ( self::SLUG !== (string) $manifest['slug'] ) {
			return self::err( 'update_wrong_slug', 'slug is not prism-simple-checkout' );
		}

		$canonical = self::canonical_payload( $manifest );
		if ( '' === $canonical || $canonical !== $manifest['signed_payload'] ) {
			return self::err( 'update_payload_not_canonical', 'signed_payload is not canonical' );
		}
		$payload = json_decode( (string) $manifest['signed_payload'], true );
		if ( ! is_array( $payload ) ) {
			return self::err( 'update_payload_json', 'signed_payload is not JSON' );
		}
		foreach ( self::PAYLOAD_FIELDS as $field ) {
			if ( ! array_key_exists( $field, $payload ) || $payload[ $field ] !== $manifest[ $field ] ) {
				return self::err( 'update_payload_mismatch', 'signed_payload mismatch for ' . $field );
			}
		}

		$parts = function_exists( 'wp_parse_url' ) ? wp_parse_url( (string) $manifest['artifact_url'] ) : parse_url( (string) $manifest['artifact_url'] );
		if ( ! is_array( $parts ) || 'https' !== strtolower( (string) ( $parts['scheme'] ?? '' ) ) || self::TRUSTED_ARTIFACT_HOST !== strtolower( (string) ( $parts['host'] ?? '' ) ) ) {
			return self::err( 'update_insecure_download', 'artifact_url is not trusted HTTPS host' );
		}

		$versions = array(
			'wp'  => (string) ( $ctx['wp_version'] ?? ( function_exists( 'get_bloginfo' ) ? get_bloginfo( 'version' ) : '6.4' ) ),
			'php' => (string) ( $ctx['php_version'] ?? PHP_VERSION ),
			'wc'  => (string) ( $ctx['wc_version'] ?? self::woo_version() ),
		);
		if ( '' === $versions['wc'] ) {
			return self::err( 'update_wc_unknown', 'Installed WooCommerce version is unavailable' );
		}
		foreach ( array( 'wp' => 'WordPress', 'php' => 'PHP', 'wc' => 'WooCommerce' ) as $key => $label ) {
			if ( version_compare( $versions[ $key ], (string) $manifest[ 'requires_' . $key ], '<' ) ) {
				return self::err( 'update_requires_' . $key, $label . ' too old' );
			}
		}
		if ( ! self::contract_in_range( $this->payment_contract, (string) $manifest['payment_contract_min'], (string) $manifest['payment_contract_max'] ) ) {
			return self::err( 'update_payment_contract', 'payment contract outside range' );
		}
		if ( ! $this->crypto_available ) {
			return self::err( 'update_crypto_missing', 'libsodium required' );
		}

		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode
		$key = base64_decode( $this->public_key, true );
		if ( implode( '', self::UNCONFIGURED_PUBLIC_KEY_PARTS ) === $this->public_key || false === $key || 32 !== strlen( $key ) ) {
			return self::err( 'update_key_unconfigured', 'update public key is not configured' );
		}
		$signature = hex2bin( (string) $manifest['signature'] );
		if ( false === $signature || ! sodium_crypto_sign_verify_detached( $signature, (string) $manifest['signed_payload'], $key ) ) {
			return self::err( 'update_bad_signature', 'manifest signature verification failed' );
		}
		return true;
	}

	public function verify_zip_file( string $path, string $expected_sha256, int $expected_size ) {
		if ( ! is_file( $path ) || filesize( $path ) !== $expected_size ) {
			return self::err( 'update_zip_size_mismatch', 'ZIP size mismatch' );
		}
		return hash_file( 'sha256', $path ) === $expected_sha256 ? true : self::err( 'update_hash_mismatch', 'ZIP sha256 mismatch' );
	}

	/**
	 * Bind ZIP archive contents to the signed manifest after SHA/size checks.
	 * Verifies: single root slug, plugin header Version, plugin_tree_hash over archive files.
	 *
	 * Tree hash algorithm (canonical, matches certification/lib/package-zip.mjs hashTree):
	 *   sorted relative paths under the slug root; for each path: update(sha256, path + "\0" + bytes + "\0").
	 *
	 * @param string $path     Path to downloaded ZIP.
	 * @param array  $manifest Validated signed manifest fields.
	 * @return true|\WP_Error
	 */
	public function verify_zip_contents( string $path, array $manifest ) {
		if ( ! class_exists( '\ZipArchive' ) ) {
			return self::err( 'update_zip_unavailable', 'ZipArchive extension is required' );
		}
		$zip = new \ZipArchive();
		if ( true !== $zip->open( $path ) ) {
			return self::err( 'update_zip_open', 'Unable to open ZIP archive' );
		}
		try {
			$slug = self::SLUG;
			$expected_version = (string) ( $manifest['version'] ?? '' );
			$expected_tree = (string) ( $manifest['plugin_tree_hash'] ?? '' );
			$files = array(); // rel => contents
			$root_dirs = array();
			for ( $i = 0; $i < $zip->numFiles; $i++ ) {
				$name = $zip->getNameIndex( $i );
				if ( false === $name || '' === $name ) {
					continue;
				}
				// Normalize separators; reject absolute / traversal.
				$name = str_replace( '\\', '/', $name );
				if ( 0 === strpos( $name, '/' ) || false !== strpos( $name, '..' ) ) {
					return self::err( 'update_zip_path', 'ZIP contains unsafe path: ' . $name );
				}
				$parts = explode( '/', $name, 2 );
				$root = $parts[0];
				if ( '' === $root ) {
					return self::err( 'update_zip_slug', 'ZIP entry missing root slug' );
				}
				$root_dirs[ $root ] = true;
				// Directory markers end with /
				if ( substr( $name, -1 ) === '/' ) {
					continue;
				}
				if ( $slug !== $root ) {
					return self::err( 'update_zip_slug', 'ZIP root slug is not ' . $slug );
				}
				$rel = isset( $parts[1] ) ? $parts[1] : '';
				if ( '' === $rel ) {
					return self::err( 'update_zip_path', 'ZIP contains bare root file outside plugin tree' );
				}
				$contents = $zip->getFromIndex( $i );
				if ( false === $contents ) {
					return self::err( 'update_zip_read', 'Unable to read ZIP entry: ' . $name );
				}
				$files[ $rel ] = $contents;
			}
			if ( count( $root_dirs ) !== 1 || ! isset( $root_dirs[ $slug ] ) ) {
				return self::err( 'update_zip_slug', 'ZIP must contain exactly one root directory: ' . $slug );
			}
			if ( empty( $files ) ) {
				return self::err( 'update_zip_empty', 'ZIP contains no plugin files' );
			}
			$main_rel = $slug . '.php';
			if ( ! isset( $files[ $main_rel ] ) ) {
				return self::err( 'update_zip_main_missing', 'ZIP missing ' . $slug . '/' . $main_rel );
			}
			if ( ! preg_match( '/^\s*\*\s*Version:\s*(\S+)/m', $files[ $main_rel ], $m ) ) {
				return self::err( 'update_zip_version_header', 'Plugin header Version is missing' );
			}
			if ( $expected_version !== $m[1] ) {
				return self::err( 'update_zip_version_mismatch', 'Plugin header Version does not match manifest' );
			}
			$tree = self::hash_plugin_tree( $files );
			if ( ! hash_equals( $expected_tree, $tree ) ) {
				return self::err( 'update_tree_hash_mismatch', 'plugin_tree_hash does not match archive contents' );
			}
			return true;
		} finally {
			$zip->close();
		}
	}

	/**
	 * Canonical plugin tree hash: sorted rel paths, sha256(path + NUL + bytes + NUL) stream.
	 *
	 * @param array<string,string> $files Map of relative path => file contents.
	 */
	public static function hash_plugin_tree( array $files ): string {
		$keys = array_keys( $files );
		sort( $keys, SORT_STRING );
		$ctx = hash_init( 'sha256' );
		foreach ( $keys as $rel ) {
			hash_update( $ctx, $rel );
			hash_update( $ctx, "\0" );
			hash_update( $ctx, (string) $files[ $rel ] );
			hash_update( $ctx, "\0" );
		}
		return hash_final( $ctx );
	}

	public function filter_update( $update, array $plugin_data = array(), string $plugin_file = '', array $locales = array() ) {
		if ( ( defined( 'PSC_MANUAL_UPDATES' ) && PSC_MANUAL_UPDATES ) || ( defined( 'PSC_VERIFICATION_ONLY' ) && PSC_VERIFICATION_ONLY ) ) { return false; }
		unset( $locales );
		if ( self::PLUGIN_BASENAME !== $plugin_file ) {
			return $update;
		}
		$manifest = $this->fetch_and_validate_manifest();
		if ( ! is_array( $manifest ) ) {
			return false;
		}
		$current = (string) ( $plugin_data['Version'] ?? ( defined( 'PSC_VERSION' ) ? PSC_VERSION : '0.0.0-development' ) );
		$new = (string) $manifest['version'];
		return array(
			'id' => self::UPDATE_URI, 'slug' => self::SLUG, 'version' => $new, 'new_version' => $new,
			'url' => self::UPDATE_URI, 'package' => self::is_package_newer( $new, $current ) ? (string) $manifest['artifact_url'] : '',
			'tested' => (string) $manifest['tested_wp'], 'requires_php' => (string) $manifest['requires_php'], 'autoupdate' => false,
		);
	}

	/**
	 * Package eligibility: PHP version_compare semantics.
	 * Policy (BUILD-CONTRACT): beta builds over shipped stable MUST bump the patch base
	 * (e.g. 1.0.1-beta.1 over 1.0.0). Same-base betas like 1.0.0-beta.1 are NOT newer than 1.0.0.
	 */
	public static function is_package_newer( string $candidate, string $installed ): bool {
		return version_compare( $candidate, $installed, '>' );
	}

	public function pre_download( $reply, $package, $upgrader, array $hook_extra = array() ) {
		unset( $upgrader );
		$manifest = $this->load_cached_manifest();
		$is_ours = self::PLUGIN_BASENAME === (string) ( $hook_extra['plugin'] ?? '' );
		if ( ! $is_ours && ( ! is_array( $manifest ) || (string) ( $manifest['artifact_url'] ?? '' ) !== (string) $package ) ) {
			return $reply;
		}
		if ( ( defined( 'PSC_MANUAL_UPDATES' ) && PSC_MANUAL_UPDATES ) || ( defined( 'PSC_VERIFICATION_ONLY' ) && PSC_VERIFICATION_ONLY ) ) { return self::err( 'psc_manual_updates', 'Install the reviewed manual build to update PRISM.' ); }
		if ( self::is_error( $reply ) ) {
			return $reply;
		}
		if ( ! is_array( $manifest ) || (string) ( $manifest['artifact_url'] ?? '' ) !== (string) $package ) {
			$manifest = $this->recover_package_manifest( (string) $package );
			if ( self::is_error( $manifest ) ) { return $manifest; }
		}
		$valid = $this->validate_manifest( $manifest, $this->runtime_context() );
		if ( true !== $valid ) {
			return $valid;
		}
		if ( (string) $manifest['artifact_url'] !== (string) $package ) {
			return self::err( 'update_package_mismatch', 'Package URL does not match signed manifest' );
		}

		if ( is_string( $reply ) && '' !== $reply ) {
			$path = $reply;
		} elseif ( false !== $reply ) {
			return self::err( 'update_download_short_circuit', 'Unverifiable pre-download short circuit' );
		} elseif ( ! function_exists( 'download_url' ) ) {
			return self::err( 'update_download_unavailable', 'WordPress download_url is unavailable' );
		} else {
			$download = download_url( (string) $package, 300 );
			if ( self::is_error( $download ) ) {
				return $download;
			}
			$path = (string) $download;
		}
		$verify = $this->verify_zip_file( $path, (string) $manifest['zip_sha256'], (int) $manifest['zip_size'] );
		if ( true !== $verify ) {
			self::delete_download( $path );
			return $verify;
		}
		$contents = $this->verify_zip_contents( $path, $manifest );
		if ( true !== $contents ) {
			self::delete_download( $path );
			return $contents;
		}
		return $path;
	}

	/** Recover only the immutable signed manifest belonging to the offered ZIP. */
	private function recover_package_manifest( string $package ) {
		if ( ( defined( 'PSC_MANUAL_UPDATES' ) && PSC_MANUAL_UPDATES ) || ( defined( 'PSC_VERIFICATION_ONLY' ) && PSC_VERIFICATION_ONLY ) ) {
			return self::err( 'psc_manual_updates', 'Automatic updates are disabled for this build.' );
		}
		$pattern = '~^https://updates\.groundsetter\.com/prism-simple-checkout/([0-9]+(?:\.[0-9]+){2,3}(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?)/prism-simple-checkout\.zip$~D';
		if ( ! preg_match( $pattern, $package, $matches ) ) {
			return self::err( 'update_package_mismatch', 'Package URL is not an immutable PRISM release.' );
		}
		if ( ! function_exists( 'wp_safe_remote_get' ) ) { return self::err( 'update_http_unavailable', 'WordPress HTTP API is unavailable' ); }
		$url = substr( $package, 0, strrpos( $package, '/' ) + 1 ) . 'manifest.json';
		$response = wp_safe_remote_get( $url, array( 'timeout' => 15, 'redirection' => 0, 'limit_response_size' => 65536 ) );
		if ( self::is_error( $response ) ) { return $response; }
		if ( 200 !== wp_remote_retrieve_response_code( $response ) ) { return self::err( 'update_manifest_http', 'Immutable manifest endpoint did not return HTTP 200' ); }
		$manifest = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $manifest ) ) { return self::err( 'update_manifest_json', 'Immutable manifest is not valid JSON' ); }
		$valid = $this->validate_manifest( $manifest, $this->runtime_context() );
		if ( true !== $valid ) { return $valid; }
		if ( ! hash_equals( $package, (string) $manifest['artifact_url'] ) || ! hash_equals( $matches[1], (string) $manifest['version'] ) ) {
			return self::err( 'update_package_mismatch', 'Immutable manifest does not match the offered package.' );
		}
		return $manifest;
	}

	private function fetch_and_validate_manifest() {
		if ( ( defined( 'PSC_MANUAL_UPDATES' ) && PSC_MANUAL_UPDATES ) || ( defined( 'PSC_VERIFICATION_ONLY' ) && PSC_VERIFICATION_ONLY ) ) { return self::err( 'psc_verification_only', 'Automatic updates are disabled for this build.' ); }
		if ( ! function_exists( 'wp_safe_remote_get' ) ) {
			return self::err( 'update_http_unavailable', 'WordPress HTTP API is unavailable' );
		}
		$response = wp_safe_remote_get( self::MANIFEST_URL, array( 'timeout' => 15, 'redirection' => 0, 'limit_response_size' => 65536 ) );
		if ( self::is_error( $response ) ) {
			return $response;
		}
		if ( ! function_exists( 'wp_remote_retrieve_response_code' ) || 200 !== wp_remote_retrieve_response_code( $response ) ) {
			return self::err( 'update_manifest_http', 'Manifest endpoint did not return HTTP 200' );
		}
		$body = function_exists( 'wp_remote_retrieve_body' ) ? wp_remote_retrieve_body( $response ) : '';
		$manifest = json_decode( (string) $body, true );
		if ( ! is_array( $manifest ) ) {
			return self::err( 'update_manifest_json', 'Manifest response is not valid JSON' );
		}
		$valid = $this->validate_manifest( $manifest, $this->runtime_context() );
		if ( true !== $valid ) {
			return $valid;
		}
		$this->validated_manifest = $manifest;
		if ( function_exists( 'set_transient' ) ) {
			set_transient( self::MANIFEST_TRANSIENT, $manifest, 6 * 60 * 60 );
		}
		return $manifest;
	}

	private function load_cached_manifest(): ?array {
		if ( is_array( $this->validated_manifest ) ) {
			return $this->validated_manifest;
		}
		$cached = function_exists( 'get_transient' ) ? get_transient( self::MANIFEST_TRANSIENT ) : false;
		return is_array( $cached ) ? $cached : null;
	}

	private function runtime_context(): array {
		return array(
			'wp_version' => function_exists( 'get_bloginfo' ) ? (string) get_bloginfo( 'version' ) : '',
			'php_version' => PHP_VERSION,
			'wc_version' => self::woo_version(),
		);
	}

	private static function woo_version(): string {
		if ( defined( 'WC_VERSION' ) ) {
			return (string) WC_VERSION;
		}
		if ( function_exists( 'WC' ) ) {
			$woocommerce = WC();
			if ( $woocommerce && isset( $woocommerce->version ) ) {
				return (string) $woocommerce->version;
			}
		}
		if ( ! function_exists( 'get_plugins' ) && defined( 'ABSPATH' ) ) {
			$plugin_api = ABSPATH . 'wp-admin/includes/plugin.php';
			if ( is_file( $plugin_api ) ) {
				require_once $plugin_api;
			}
		}
		if ( ! function_exists( 'get_plugins' ) ) {
			return '';
		}
		$plugins = get_plugins();
		return is_array( $plugins ) && isset( $plugins['woocommerce/woocommerce.php']['Version'] ) ? (string) $plugins['woocommerce/woocommerce.php']['Version'] : '';
	}

	private static function valid_evidence_hash( $value ): bool {
		return is_string( $value ) && 1 === preg_match( '/^[0-9a-f]{64}$/', $value ) && 1 !== preg_match( '/^([0-9a-f])\1{63}$/', $value );
	}

	private static function contract_in_range( string $current, string $min, string $max ): bool {
		$semver = '/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/';
		if ( preg_match( $semver, $current ) && preg_match( $semver, $min ) && preg_match( $semver, $max ) ) {
			return version_compare( $current, $min, '>=' ) && version_compare( $current, $max, '<=' );
		}
		return $current === $min && $current === $max;
	}

	private static function is_error( $value ): bool {
		return function_exists( 'is_wp_error' ) ? is_wp_error( $value ) : $value instanceof \WP_Error;
	}

	private static function delete_download( string $path ): void {
		if ( function_exists( 'wp_delete_file' ) ) {
			wp_delete_file( $path );
		} elseif ( is_file( $path ) ) {
			unlink( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink
		}
	}

	private static function err( string $code, string $message ) {
		return class_exists( '\WP_Error' ) ? new \WP_Error( $code, $message ) : (object) array( 'errors' => array( $code => array( $message ) ), 'error_data' => array() );
	}
}
