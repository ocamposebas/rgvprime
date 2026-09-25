<?php
namespace PrismSimpleCheckout;
defined( 'ABSPATH' ) || exit;

/**
 * Lifecycle-only Stripe Payment Method Domain ensure.
 * Never runs on the shopper checkout hot path.
 */
final class Wallet_Domains {
	public const OPTION_KEY = 'psc_wallet_domain_status';
	public const ENSURED_VERSION_OPTION = 'psc_wallet_domain_ensured_version';

	public function hooks(): void {
		if ( defined( 'PSC_VERIFICATION_ONLY' ) && PSC_VERIFICATION_ONLY ) { return; }
		add_action( 'admin_notices', array( $this, 'admin_notice' ) );
		add_action( 'admin_post_psc_retry_wallet_setup', array( $this, 'retry_setup' ) );
		add_action( 'update_option_home', array( $this, 'on_siteurl_change' ), 10, 0 );
		add_action( 'update_option_siteurl', array( $this, 'on_siteurl_change' ), 10, 0 );
	}

	/**
	 * @return bool True only when an authenticated ensure request was attempted.
	 */
	public static function ensure_after_activation(): bool {
		return ( new self() )->ensure_now( 'activation' );
	}

	/**
	 * Existing bound site upgrading to 1.0.4+: one lifecycle ensure.
	 * No credentials → no request and no version marker.
	 */
	public static function maybe_ensure_on_upgrade(): void {
		if ( ! function_exists( 'get_option' ) || ! function_exists( 'update_option' ) ) {
			return;
		}
		if ( ! Credential_Store::get() ) {
			return;
		}
		$ensured = (string) get_option( self::ENSURED_VERSION_OPTION, '' );
		if ( '' === $ensured || ( ( defined( 'PSC_MANUAL_UPDATES' ) && PSC_MANUAL_UPDATES ) && 'fall-payments-1' !== $ensured ) || ( ! ( defined( 'PSC_MANUAL_UPDATES' ) && PSC_MANUAL_UPDATES ) && version_compare( (string) PSC_VERSION, '1.0.4', '>=' ) && version_compare( $ensured, '1.0.4', '<' ) ) ) {
			if ( ( new self() )->ensure_now( 'upgrade' ) ) {
				update_option( self::ENSURED_VERSION_OPTION, ( defined( 'PSC_MANUAL_UPDATES' ) && PSC_MANUAL_UPDATES ) ? 'fall-payments-1' : (string) PSC_VERSION, false );
			}
		}
	}

	public function on_siteurl_change(): void {
		delete_option( self::OPTION_KEY );
		if ( $this->ensure_now( 'siteurl_change' ) ) {
			update_option( self::ENSURED_VERSION_OPTION, ( defined( 'PSC_MANUAL_UPDATES' ) && PSC_MANUAL_UPDATES ) ? 'fall-payments-1' : (string) PSC_VERSION, false );
		}
	}

	/**
	 * @param string $reason activation|upgrade|siteurl_change|manual
	 * @return bool True when an authenticated request was made (success or failure cached).
	 */
	public function ensure_now( string $reason = 'manual' ): bool {
		if ( defined( 'PSC_VERIFICATION_ONLY' ) && PSC_VERIFICATION_ONLY ) { return false; }
		if ( ! Credential_Store::get() ) {
			return false;
		}
		$site_url = home_url( '/' );
		$result   = ( new Service_Client() )->ensure_wallet_domain( $site_url );
		if ( is_wp_error( $result ) ) {
			update_option(
				self::OPTION_KEY,
				array(
					'ok'      => false,
					'reason'  => $reason,
					'error'   => $result->get_error_code(),
					'message' => $result->get_error_message(),
					'at'      => gmdate( 'c' ),
				),
				false
			);
			return true;
		}
		if ( ! self::response_valid( $result, $site_url ) ) {
			update_option(
				self::OPTION_KEY,
				array(
					'ok'     => false,
					'reason' => $reason,
					'error'  => 'psc_schema',
					'at'     => gmdate( 'c' ),
				),
				false
			);
			return true;
		}
		$enabled = ! empty( $result['enabled'] );
		$apple   = (string) $result['apple_pay_status'];
		// Green only when domain enabled AND Apple Pay status is exactly active.
		$ok = $enabled && ( 'active' === $apple );
		update_option(
			self::OPTION_KEY,
			array(
				'ok'               => $ok,
				'reason'           => $reason,
				'domain'           => (string) $result['domain'],
				'action'           => (string) $result['action'],
				'enabled'          => $enabled,
				'apple_pay_status' => $apple,
				'at'               => gmdate( 'c' ),
			),
			false
		);
		return true;
	}

	/**
	 * Normalize the HTTPS site_url host the same way the Worker contract does:
	 * lowercase hostname only; reject non-HTTPS, ports, credentials, paths,
	 * query/fragment, IPs, and localhost.
	 *
	 * @param string $site_url Exact site_url that was (or will be) sent.
	 * @return string|null Lowercase host, or null when invalid.
	 */
	public static function normalize_site_url_host( string $site_url ): ?string {
		$raw = trim( $site_url );
		if ( '' === $raw ) {
			return null;
		}
		$parts = wp_parse_url( $raw );
		if ( ! is_array( $parts ) ) {
			return null;
		}
		if ( ( $parts['scheme'] ?? '' ) !== 'https' ) {
			return null;
		}
		if ( ! empty( $parts['user'] ) || ! empty( $parts['pass'] ) ) {
			return null;
		}
		if ( array_key_exists( 'port', $parts ) && null !== $parts['port'] && '' !== (string) $parts['port'] ) {
			return null;
		}
		$path = (string) ( $parts['path'] ?? '' );
		if ( '' !== $path && '/' !== $path ) {
			return null;
		}
		if ( ! empty( $parts['query'] ) || ! empty( $parts['fragment'] ) ) {
			return null;
		}
		$host = strtolower( (string) ( $parts['host'] ?? '' ) );
		if ( '' === $host || 'localhost' === $host || str_ends_with( $host, '.localhost' ) ) {
			return null;
		}
		// IPv4 literal or any colon (IPv6) is rejected.
		if ( preg_match( '/^\d{1,3}(\.\d{1,3}){3}$/', $host ) || str_contains( $host, ':' ) ) {
			return null;
		}
		return $host;
	}

	/**
	 * Strict response contract before caching green.
	 * Returned domain must equal the normalized host of the exact HTTPS site_url
	 * that was sent (defaults to home_url('/') when omitted).
	 *
	 * @param mixed       $result   Service payload.
	 * @param string|null $site_url Exact site_url sent to the service.
	 */
	public static function response_valid( $result, ?string $site_url = null ): bool {
		if ( ! is_array( $result ) ) {
			return false;
		}
		if ( ( $result['schema'] ?? '' ) !== 'psc-wallet-domain-1' ) {
			return false;
		}
		$action = (string) ( $result['action'] ?? '' );
		if ( ! in_array( $action, array( 'created', 'enabled', 'noop' ), true ) ) {
			return false;
		}
		$domain = strtolower( (string) ( $result['domain'] ?? '' ) );
		if ( '' === $domain || ! is_bool( $result['enabled'] ?? null ) ) {
			return false;
		}
		$apple = (string) ( $result['apple_pay_status'] ?? '' );
		if ( '' === $apple ) {
			return false;
		}
		$sent = null !== $site_url ? $site_url : ( function_exists( 'home_url' ) ? home_url( '/' ) : '' );
		$expected = self::normalize_site_url_host( (string) $sent );
		if ( null === $expected || $domain !== $expected ) {
			return false;
		}
		return true;
	}

	/** One deliberate, authenticated retry; repeated clicks cannot create a retry loop. */
	public function retry_setup(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) { wp_die( 'Not authorized.', '', array( 'response' => 403 ) ); }
		check_admin_referer( 'psc_retry_wallet_setup' );
		if ( ! Credential_Store::get() || ( defined( 'PSC_VERIFICATION_ONLY' ) && PSC_VERIFICATION_ONLY ) ) { wp_die( 'Wallet setup is unavailable.', '', array( 'response' => 403 ) ); }
		$status = get_option( self::OPTION_KEY, array() );
		$last = is_array( $status ) ? strtotime( (string) ( $status['at'] ?? '' ) ) : false;
		if ( ! $last || $last <= time() - 60 ) {
			update_option( self::OPTION_KEY, array( 'ok' => false, 'reason' => 'manual', 'at' => gmdate( 'c' ) ), false );
			$this->ensure_now( 'manual' );
		}
		wp_safe_redirect( admin_url( 'admin.php?page=wc-settings&tab=checkout&section=' . PSC_GATEWAY_ID ) );
		exit;
	}

	public function admin_notice(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		$status = get_option( self::OPTION_KEY, null );
		if ( ! is_array( $status ) ) {
			return;
		}
		// Green: enabled + apple_pay_status exactly active (encoded in ok).
		if ( ! empty( $status['ok'] ) ) {
			return;
		}
		$code = (string) ( $status['error'] ?? '' );
		if ( 'conflict' === $code || 'domain_mismatch' === $code ) {
			$msg = 'PRISM wallet domain does not match the registered site URL. Rebind PRISM with the current HTTPS storefront URL before Apple Pay can be ready.';
		} elseif ( ! empty( $status['error'] ) ) {
			$msg = 'PRISM could not verify the Stripe Payment Method Domain for wallets. Card checkout still works; wallet readiness is not green until domain registration succeeds.';
		} else {
			$msg = 'PRISM wallet domain is not active yet. Card checkout still works; Apple Pay/Google Pay remain not-green until the domain is enabled and Apple Pay status is active.';
		}
		echo '<div class="notice notice-warning"><p>' . esc_html( $msg ) . '</p><form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		wp_nonce_field( 'psc_retry_wallet_setup' );
		echo '<input type="hidden" name="action" value="psc_retry_wallet_setup"><p><button type="submit" class="button">' . esc_html__( 'Retry wallet setup', 'prism-simple-checkout' ) . '</button></p></form></div>';
	}
}
