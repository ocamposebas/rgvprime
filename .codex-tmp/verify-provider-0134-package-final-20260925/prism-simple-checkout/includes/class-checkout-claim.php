<?php
namespace PrismSimpleCheckout;
defined( 'ABSPATH' ) || exit;
/** Atomic pre-order ownership plus an independent settlement lease. */
final class Checkout_Claim {
	public const TABLE_SUFFIX = 'psc_checkout_claims';
	public const COMPLETION_ACQUIRE_SECONDS = 60;
	public const COMPLETION_RUN_SECONDS = 300;
	private const REQUIRED_COLUMNS = array(
		'claim_key',
		'owner_token',
		'fence',
		'expires_at',
		'order_id',
		'completion_token',
		'completion_expires_at',
		'completed_payment_id',
		'last_outbox_id',
		'created_at',
	);
	public static function install_table(): bool {
		global $wpdb;
		if ( ! function_exists( 'dbDelta' ) ) {
			require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		}
		$table = self::table_name();
		$sql = "CREATE TABLE {$table} (
			claim_key varchar(191) NOT NULL,
			owner_token varchar(64) NOT NULL,
			fence bigint(20) unsigned NOT NULL DEFAULT 1,
			expires_at bigint(20) unsigned NOT NULL,
			order_id bigint(20) unsigned NULL,
			completion_token varchar(64) NULL,
			completion_expires_at bigint(20) unsigned NULL,
			completed_payment_id varchar(191) NULL,
			last_outbox_id varchar(64) NULL,
			created_at bigint(20) unsigned NOT NULL,
			PRIMARY KEY  (claim_key),
			KEY expires_at (expires_at),
			KEY order_id (order_id)
		) {$wpdb->get_charset_collate()};";
		dbDelta( $sql );
		return self::schema_ready();
	}
	public static function missing_columns(): array {
		global $wpdb;
		$columns = $wpdb->get_col( 'SHOW COLUMNS FROM ' . self::table_name(), 0 ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$columns = is_array( $columns ) ? array_map( 'strval', $columns ) : array();
		return array_values( array_diff( self::REQUIRED_COLUMNS, $columns ) );
	}
	public static function schema_ready(): bool {
		return array() === self::missing_columns();
	}
	public static function table_name(): string {
		global $wpdb;
		return $wpdb->prefix . self::TABLE_SUFFIX;
	}
	public static function make_key( string $session_id, string $fingerprint ): string {
		return substr( $session_id, 0, 120 ) . ':' . $fingerprint;
	}
	public function acquire( string $key, string $owner, int $ttl = 120 ): array {
		global $wpdb;
		$now = time();
		$expires = $now + max( 15, $ttl );
		$row = $this->row( $key );
		if ( ! $row ) {
			$ok = $wpdb->insert(
				self::table_name(),
				array( 'claim_key' => $key, 'owner_token' => $owner, 'fence' => 1, 'expires_at' => $expires, 'order_id' => null, 'created_at' => $now ),
				array( '%s', '%s', '%d', '%d', '%d', '%d' )
			);
			return false === $ok ? array( 'ok' => false, 'code' => 'claim_held' ) : array( 'ok' => true, 'fence' => 1, 'owner' => $owner );
		}
		if ( ! empty( $row->order_id ) || ( (int) $row->expires_at >= $now && (string) $row->owner_token !== $owner ) ) {
			return array( 'ok' => false, 'code' => 'claim_held' );
		}
		$old = (int) $row->fence;
		$fence = $old + 1;
		$expiry_clause = (string) $row->owner_token === $owner ? '' : $wpdb->prepare( ' AND expires_at < %d', $now );
		$sql = $wpdb->prepare(
			"UPDATE " . self::table_name() . " SET owner_token = %s, fence = %d, expires_at = %d WHERE claim_key = %s AND fence = %d{$expiry_clause} AND order_id IS NULL",
			$owner,
			$fence,
			$expires,
			$key,
			$old
		);
		return 1 === (int) $wpdb->query( $sql ) ? array( 'ok' => true, 'fence' => $fence, 'owner' => $owner ) : array( 'ok' => false, 'code' => 'claim_held' );
	}
	public function bind_order( string $key, string $owner, int $fence, int $order_id ): bool {
		global $wpdb;
		$sql = $wpdb->prepare(
			'UPDATE ' . self::table_name() . ' SET order_id = %d WHERE claim_key = %s AND owner_token = %s AND fence = %d AND (order_id IS NULL OR order_id = %d)',
			$order_id,
			$key,
			$owner,
			$fence,
			$order_id
		);
		$updated = $wpdb->query( $sql );
		if ( 1 === $updated || ( 0 === $updated && $this->assert_bound_order( $key, $owner, $fence, $order_id ) ) ) {
			return true;
		}
		// H10: Woo reminted a different order id for the same session/cycle — rebind
		// only when the prior order is superseded and no completed/in-flight payment.
		return $this->rebind_superseded_order( $key, $owner, $fence, $order_id );
	}

	/**
	 * Rebind claim when the previously bound order is cancelled/failed/missing and
	 * the claim is not holding a completed payment or in-flight confirmation lease.
	 */
	public function rebind_superseded_order( string $key, string $owner, int $fence, int $new_order_id ): bool {
		$row = $this->row( $key );
		if ( ! $row || (string) $row->owner_token !== $owner || (int) $row->fence !== $fence ) {
			return false;
		}
		if ( ! empty( $row->completed_payment_id ) ) {
			return false;
		}
		$now = time();
		if ( ! empty( $row->completion_token ) && (int) ( $row->completion_expires_at ?? 0 ) >= $now ) {
			return false; // in-flight confirmation lease
		}
		$prior_id = (int) ( $row->order_id ?? 0 );
		if ( $prior_id <= 0 || $prior_id === $new_order_id ) {
			return false;
		}
		if ( ! self::order_is_superseded( $prior_id ) ) {
			return false;
		}
		if ( self::order_confirm_dispatched( $prior_id ) ) {
			return false;
		}
		global $wpdb;
		$sql = $wpdb->prepare(
			'UPDATE ' . self::table_name() . ' SET order_id = %d, completion_token = NULL, completion_expires_at = NULL
			 WHERE claim_key = %s AND owner_token = %s AND fence = %d AND order_id = %d
			   AND completed_payment_id IS NULL
			   AND (completion_token IS NULL OR completion_expires_at < %d)',
			$new_order_id,
			$key,
			$owner,
			$fence,
			$prior_id,
			$now
		);
		return 1 === (int) $wpdb->query( $sql );
	}

	/** True when a bound order can no longer receive payment (cancelled/failed/missing). */
	public static function order_is_superseded( int $order_id ): bool {
		if ( $order_id <= 0 || ! function_exists( 'wc_get_order' ) ) {
			return true;
		}
		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			return true;
		}
		if ( method_exists( $order, 'has_status' ) && $order->has_status( array( 'cancelled', 'failed', 'trash', 'refunded' ) ) ) {
			return true;
		}
		// Paid / processing claims must never be rebound.
		if ( method_exists( $order, 'is_paid' ) && $order->is_paid() ) {
			return false;
		}
		$status = method_exists( $order, 'get_status' ) ? (string) $order->get_status() : '';
		return in_array( $status, array( 'cancelled', 'failed', 'trash', 'refunded' ), true );
	}
	/** True when the prior order may already have dispatched confirmation. */
	public static function order_confirm_dispatched( int $order_id ): bool {
		if ( $order_id <= 0 || ! function_exists( 'wc_get_order' ) ) {
			return true;
		}
		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			return true;
		}
		return '' !== (string) $order->get_meta( '_psc_confirmation_operation_id', true );
	}
	public function release_unbound( string $key, string $owner, int $fence ): bool {
		global $wpdb;
		$sql = $wpdb->prepare(
			'UPDATE ' . self::table_name() . " SET owner_token = '', expires_at = 0 WHERE claim_key = %s AND owner_token = %s AND fence = %d AND order_id IS NULL",
			$key, $owner, $fence
		);
		return 1 === (int) $wpdb->query( $sql );
	}

	/** Release a bound claim after a deterministic reject so the same cart can retry.
	 *  'released' = row freed; 'busy' = completion live/complete (NEVER rotate);
	 *  'gone' = row missing/not ours/unbound (safe to rotate — nothing held). */
	public function release_bound( string $key, string $owner, int $fence, int $order_id ): string {
		global $wpdb;
		$now = time();
		$sql = $wpdb->prepare(
			'UPDATE ' . self::table_name() . " SET owner_token = '', expires_at = 0, order_id = NULL
			 WHERE claim_key = %s AND owner_token = %s AND fence = %d AND order_id = %d
			   AND completed_payment_id IS NULL
			   AND (completion_token IS NULL OR completion_expires_at < %d)",
			$key, $owner, $fence, $order_id, $now
		);
		if ( 1 === (int) $wpdb->query( $sql ) ) {
			return 'released';
		}
		$row = $this->row( $key );
		if ( ! $row || (string) $row->owner_token !== $owner || (int) $row->fence !== $fence
			|| (int) ( $row->order_id ?? 0 ) !== $order_id ) {
			return 'gone';
		}
		return 'busy'; // completed_payment_id set or live completion lease
	}
	/** Release only the terminalization lease that performed guarded Woo bookkeeping. */
	public function release_terminal( string $key, string $owner, int $fence, int $order_id, string $token ): bool {
		global $wpdb;
		$sql = $wpdb->prepare(
			'UPDATE ' . self::table_name() . " SET owner_token = '', expires_at = 0, order_id = NULL, completion_token = NULL, completion_expires_at = NULL
			 WHERE claim_key = %s AND owner_token = %s AND fence = %d AND order_id = %d
			 AND completion_token = %s AND completion_expires_at >= %d AND completed_payment_id IS NULL",
			$key, $owner, $fence, $order_id, $token, time()
		);
		return 1 === (int) $wpdb->query( $sql );
	}

	public function assert_owner( string $key, string $owner, int $fence ): bool {
		$row = $this->row( $key );
		return $row && (string) $row->owner_token === $owner && (int) $row->fence === $fence;
	}
	public function assert_bound_order( string $key, string $owner, int $fence, int $order_id ): bool {
		$row = $this->row( $key );
		return $row && (string) $row->owner_token === $owner && (int) $row->fence === $fence && (int) $row->order_id === $order_id;
	}

	/**
	 * After release_bound, owner_token='' and order_id=NULL. Late Stripe success must still
	 * complete the Woo order (audit #3). Missing claim or busy/foreign bind = false.
	 */
	public function allows_completion_after_release( string $key, string $owner, int $fence, int $order_id, string $payment_id ): bool {
		$row = $this->row( $key );
		if ( ! $row ) {
			// Never bound / unknown key — keep hard fail (stale guard).
			return false;
		}
		// Already completed for this PI (idempotent callback after finish_completion).
		if ( ! empty( $row->completed_payment_id ) ) {
			return hash_equals( (string) $row->completed_payment_id, $payment_id )
				&& (int) ( $row->order_id ?? 0 ) === $order_id;
		}
		// Fully released by terminal_pending_cleanup (or equivalent).
		if ( '' === (string) $row->owner_token && (int) ( $row->order_id ?? 0 ) === 0 ) {
			return true;
		}
		// Still owned / bound / completion lease — not an orphaned late-success path.
		return false;
	}
	/** Atomically reclaim a fully released row and persist its completion lease. */
	public function begin_released_completion( string $key, string $owner, int $fence, int $order_id, string $payment_id ) {
		if ( '' === $key || '' === $owner || $fence < 1 || $order_id < 1 || '' === $payment_id ) {
			return false;
		}
		global $wpdb;
		$token = bin2hex( random_bytes( 16 ) );
		$now = time();
		$expires = $now + self::COMPLETION_ACQUIRE_SECONDS;
		$sql = $wpdb->prepare(
			'UPDATE ' . self::table_name() . " SET owner_token = %s, expires_at = %d, order_id = %d, completion_token = %s, completion_expires_at = %d
			 WHERE claim_key = %s AND fence = %d AND owner_token = '' AND order_id IS NULL
			   AND completed_payment_id IS NULL
			   AND (completion_token IS NULL OR completion_expires_at < %d)",
			$owner, $expires, $order_id, $token, $expires, $key, $fence, $now
		);
		return 1 === (int) $wpdb->query( $sql ) ? $token : false;
	}
	/** Returns a lease token, "complete" for a duplicate, or false for a competing/stale callback. */
	public function begin_completion( string $key, string $owner, int $fence, int $order_id, string $payment_id ) {
		global $wpdb;
		$row = $this->row( $key );
		if ( ! $row || ! $this->assert_bound_order( $key, $owner, $fence, $order_id ) ) {
			return false;
		}
		if ( ! empty( $row->completed_payment_id ) ) {
			return hash_equals( (string) $row->completed_payment_id, $payment_id ) ? 'complete' : false;
		}
		$token = bin2hex( random_bytes( 16 ) );
		$now = time();
		$sql = $wpdb->prepare(
			'UPDATE ' . self::table_name() . ' SET completion_token = %s, completion_expires_at = %d WHERE claim_key = %s AND owner_token = %s AND fence = %d AND order_id = %d AND completed_payment_id IS NULL AND (completion_token IS NULL OR completion_expires_at < %d)',
			$token,
			$now + self::COMPLETION_ACQUIRE_SECONDS,
			$key,
			$owner,
			$fence,
			$order_id,
			$now
		);
		return 1 === (int) $wpdb->query( $sql ) ? $token : false;
	}
	public function renew_completion( string $key, string $token ): bool {
		global $wpdb;
		$now = time();
		$sql = $wpdb->prepare(
			'UPDATE ' . self::table_name() . ' SET completion_expires_at = %d WHERE claim_key = %s AND completion_token = %s AND completed_payment_id IS NULL AND completion_expires_at >= %d',
			$now + self::COMPLETION_RUN_SECONDS, $key, $token, $now
		);
		return 1 === (int) $wpdb->query( $sql );
	}
	public function finish_completion( string $key, string $token, string $payment_id, string $outbox_id = '' ): bool {
		global $wpdb;
		$now = time();
		$sql = $wpdb->prepare(
			'UPDATE ' . self::table_name() . ' SET completed_payment_id = %s, last_outbox_id = %s, completion_token = NULL, completion_expires_at = NULL WHERE claim_key = %s AND completion_token = %s AND completed_payment_id IS NULL AND completion_expires_at >= %d',
			$payment_id, $outbox_id, $key, $token, $now
		);
		return 1 === (int) $wpdb->query( $sql );
	}

	/** Release a completion lease after payment_complete() fails so poll/callback can retry. */
	public function abort_completion( string $key, string $token ): bool {
		global $wpdb;
		$sql = $wpdb->prepare(
			'UPDATE ' . self::table_name() . ' SET completion_token = NULL, completion_expires_at = NULL WHERE claim_key = %s AND completion_token = %s AND completed_payment_id IS NULL',
			$key,
			$token
		);
		return 1 === (int) $wpdb->query( $sql );
	}
	private function row( string $key ) {
		global $wpdb;
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . self::table_name() . ' WHERE claim_key = %s', $key ) );
	}
}
