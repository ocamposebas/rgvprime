<?php
namespace PrismSimpleCheckout;
defined( 'ABSPATH' ) || exit;
/** Lifecycle: migration-on-load runner and decommission-first uninstall. */
final class Lifecycle {
	public const DB_VERSION_OPTION = 'psc_db_version';
	public const BLOCKED_OPTION = 'psc_uninstall_blocked';
	public const MIGRATION_BLOCKED_OPTION = 'psc_migration_blocked';
	public const NEW_MONEY_MESSAGE = 'PRISM cannot accept a new payment because its database upgrade did not complete. Contact the site administrator.';
	public static function boot(): void {
		if ( defined( 'PSC_VERIFICATION_ONLY' ) && PSC_VERIFICATION_ONLY ) { return; }
		self::maybe_migrate();
		add_action( 'admin_notices', array( self::class, 'migration_notice' ) );
	}
	public static function maybe_migrate(): bool {
		$target = defined( 'PSC_DB_VERSION' ) ? (int) PSC_DB_VERSION : 1;
		$current = (int) get_option( self::DB_VERSION_OPTION, 0 );
		if ( $current < $target || ! Checkout_Claim::schema_ready() ) {
			Checkout_Claim::install_table();
		}
		$missing = Checkout_Claim::missing_columns();
		if ( $missing ) {
			update_option( self::MIGRATION_BLOCKED_OPTION, array( 'at' => gmdate( 'c' ), 'target' => $target, 'missing_columns' => $missing ), false );
			return false;
		}
		if ( $current < $target && ! update_option( self::DB_VERSION_OPTION, $target ) ) {
			update_option( self::MIGRATION_BLOCKED_OPTION, array( 'at' => gmdate( 'c' ), 'target' => $target, 'missing_columns' => array(), 'reason' => 'version_stamp_failed' ), false );
			return false;
		}
		delete_option( self::MIGRATION_BLOCKED_OPTION );
		return true;
	}
	public static function allows_new_money(): bool {
		if ( defined( 'PSC_VERIFICATION_ONLY' ) && PSC_VERIFICATION_ONLY ) { return false; }
		return Checkout_Claim::schema_ready()
			&& false === get_option( self::MIGRATION_BLOCKED_OPTION, false );
	}
	public static function migration_notice(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) { return; }
		$blocked = get_option( self::MIGRATION_BLOCKED_OPTION, false );
		if ( ! is_array( $blocked ) ) { return; }
		$missing = array_map( 'strval', (array) ( $blocked['missing_columns'] ?? array() ) );
		$detail = $missing ? 'Missing claim-table columns: ' . implode( ', ', $missing ) . '.' : 'The database version marker could not be saved.';
		echo '<div class="notice notice-error"><p>' . esc_html( 'PRISM database upgrade is incomplete. New payments are disabled. ' . $detail . ' Restore the database user’s ALTER/write permission, then reload this page. Existing-payment callback/status routes and refunds have not been disabled by this guard.' ) . '</p></div>';
	}
	public static function uninstall( ?callable $decommission = null ): bool {
		$creds = Credential_Store::get();
		$credential_issue = $creds ? '' : Credential_Store::diagnostic_code();
		if ( ! $creds && in_array( $credential_issue, array( 'salts_changed', 'legacy_unpinned', 'legacy_unreadable', 'credential_corrupt', 'pin_failed' ), true ) ) {
			update_option( self::BLOCKED_OPTION, array( 'at' => gmdate( 'c' ), 'reason' => 'psc_credentials_' . $credential_issue ), false );
			return false;
		}
		if ( $creds ) {
			$result = ( $decommission ?? static fn() => ( new Service_Client() )->decommission_site() )();
			if ( is_wp_error( $result ) || false !== ( $result['active'] ?? null ) ) {
				update_option( self::BLOCKED_OPTION, array( 'at' => gmdate( 'c' ), 'reason' => is_wp_error( $result ) ? $result->get_error_code() : 'psc_decommission_refused' ), false );
				return false;
			}
		}
		delete_option( Credential_Store::OPTION_KEY );
		delete_option( 'woocommerce_' . PSC_GATEWAY_ID . '_settings' );
		delete_transient( Updater::MANIFEST_TRANSIENT );
		delete_option( self::DB_VERSION_OPTION );
		delete_option( self::BLOCKED_OPTION );
		delete_option( self::MIGRATION_BLOCKED_OPTION );
		delete_option( 'psc_admin_alerts' );
		global $wpdb;
		$wpdb->query( 'DROP TABLE IF EXISTS ' . Checkout_Claim::table_name() ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		return true;
	}
}
