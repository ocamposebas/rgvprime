<?php
namespace PrismSimpleCheckout;
defined( 'ABSPATH' ) || exit;

/** Public, status-only diagnostics for the external read-only watchdog. */
final class Monitor_Status {
	public const NAMESPACE = 'psc/v1';

	public function hooks(): void {
		add_action( 'rest_api_init', array( $this, 'register_rest' ) );
	}

	public function register_rest(): void {
		register_rest_route(
			self::NAMESPACE,
			'/status',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'handle_status' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	public function handle_status( $request = null ) {
		unset( $request );
		$woo_loaded      = $this->woo_loaded();
		$credential      = $this->credential_state();
		$gateway_enabled = $this->gateway_enabled();
		$local_db        = $this->local_db();
		$available       = ! ( defined( 'PSC_VERIFICATION_ONLY' ) && PSC_VERIFICATION_ONLY ) && $woo_loaded && $gateway_enabled && 'ok' === $credential;

		$response = new \WP_REST_Response(
			array(
				'schema'                    => 'psc-status-1',
				'generated_at'              => gmdate( 'c' ),
				'plugin_version'            => (string) PSC_VERSION,
				'payment_contract'          => (string) PSC_PAYMENT_CONTRACT,
				'woo_loaded'                => $woo_loaded,
				'credential_state'          => $credential,
				'gateway'                   => array(
					'enabled'         => $gateway_enabled,
					'available'       => $available,
					'new_money_ready' => $available
						&& $local_db['claim_schema_ready']
						&& ! $local_db['migration_blocked']
						&& $local_db['version'] >= (int) PSC_DB_VERSION,
				),
				'local_db'                  => $local_db,
				'callback_route_registered' => $this->callback_route_registered(),
				'integrity_flags'           => $this->integrity_flags( $woo_loaded ),
			),
			200
		);
		$response->header( 'Cache-Control', 'no-store' );
		$response->header( 'X-Robots-Tag', 'noindex, nofollow' );
		return $response;
	}

	private function woo_loaded(): bool {
		return class_exists( 'WooCommerce' )
			&& class_exists( 'WC_Payment_Gateway' )
			&& function_exists( 'did_action' )
			&& did_action( 'woocommerce_loaded' ) > 0;
	}

	private function credential_state(): string {
		try {
			$code = Credential_Store::diagnostic_code();
		} catch ( \Throwable $error ) {
			unset( $error );
			return 'unknown';
		}
		if ( '' === $code ) {
			return 'ok';
		}
		if ( 'never_configured' === $code ) {
			return 'missing';
		}
		if ( in_array( $code, array( 'home_moved', 'salts_changed', 'home_and_salts_changed' ), true ) ) {
			return 'conflict';
		}
		if ( in_array( $code, array( 'legacy_unpinned', 'legacy_unreadable', 'credential_corrupt', 'pin_failed' ), true ) ) {
			return 'invalid';
		}
		return 'unknown';
	}

	private function gateway_enabled(): bool {
		try {
			$settings = get_option( 'woocommerce_' . PSC_GATEWAY_ID . '_settings', array() );
		} catch ( \Throwable $error ) {
			unset( $error );
			return false;
		}
		$settings = is_array( $settings ) ? $settings : array();
		return 'yes' === (string) ( $settings['enabled'] ?? 'yes' );
	}

	/** @return array{version:int,claim_schema_ready:bool,migration_blocked:bool} */
	private function local_db(): array {
		$version = 0;
		$ready   = false;
		$blocked = true;
		try {
			$version = (int) get_option( Lifecycle::DB_VERSION_OPTION, 0 );
			$ready   = Checkout_Claim::schema_ready();
			$blocked = false !== get_option( Lifecycle::MIGRATION_BLOCKED_OPTION, false );
		} catch ( \Throwable $error ) {
			unset( $error );
		}
		return array(
			'version'            => $version,
			'claim_schema_ready' => $ready,
			'migration_blocked'  => $blocked,
		);
	}

	private function callback_route_registered(): bool {
		global $wp_rest_server;
		if ( ! is_object( $wp_rest_server ) || ! method_exists( $wp_rest_server, 'get_routes' ) ) {
			return false;
		}
		try {
			$routes = $wp_rest_server->get_routes();
		} catch ( \Throwable $error ) {
			unset( $error );
			return false;
		}
		return is_array( $routes ) && isset( $routes[ '/' . Rest_Routes::NAMESPACE . '/callback' ] );
	}

	/** @return array{fee_mismatch:bool,completion_cas_loss:bool,order_conflict_hold:bool} */
	private function integrity_flags( bool $woo_loaded ): array {
		$fee_mismatch        = false;
		$completion_cas_loss = false;
		try {
			$stored = get_option( Settings::ADMIN_ALERTS_OPTION, array() );
			foreach ( array_keys( is_array( $stored ) ? $stored : array() ) as $code ) {
				$code = (string) $code;
				$fee_mismatch        = $fee_mismatch || str_starts_with( $code, 'fee_' );
				$completion_cas_loss = $completion_cas_loss || str_starts_with( $code, 'completion_cas_' );
			}
		} catch ( \Throwable $error ) {
			unset( $error );
		}
		return array(
			'fee_mismatch'        => $fee_mismatch,
			'completion_cas_loss' => $completion_cas_loss,
			'order_conflict_hold' => $this->order_conflict_hold( $woo_loaded ),
		);
	}

	private function order_conflict_hold( bool $woo_loaded ): bool {
		if ( ! $woo_loaded || ! function_exists( 'wc_get_orders' ) ) {
			return false;
		}
		try {
			$args = array( 'limit' => 1, 'return' => 'ids' );
			$hpos = class_exists( '\Automattic\WooCommerce\Utilities\OrderUtil' )
				&& \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled();
			if ( $hpos ) {
				$args['meta_query'] = array( array( 'key' => Gateway::ORDER_CONFLICT_HOLD_META, 'compare' => 'EXISTS' ) );
			} else {
				$args['meta_key'] = Gateway::ORDER_CONFLICT_HOLD_META;
				$args['meta_compare'] = 'EXISTS';
			}
			$orders = wc_get_orders( $args );
		} catch ( \Throwable $error ) {
			unset( $error );
			return false;
		}
		return ! empty( $orders );
	}
}
