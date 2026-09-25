<?php
namespace PrismSimpleCheckout;

defined( 'ABSPATH' ) || exit;

/**
 * Session-free reconciliation for held PRISM orders (1.0.10.11).
 *
 * WHY THIS EXISTS
 * ---------------
 * When a confirm call to the PRISM service returns no usable answer (transport
 * timeout, 5xx, 408/409/429), Gateway::handle_confirm_error() deliberately refuses to
 * mint a second PaymentIntent: it writes an order note, keeps the attempt, and shows
 * the buyer Buyer_Copy::CONFIRM_PENDING. That hold is correct — it is what stops a
 * double charge.
 *
 * The gap was that nothing resolved the hold on its own. Rest_Routes::reconcile_pending_confirm()
 * is reached ONLY from ajax_create_attempt, i.e. only if the same buyer, in the same
 * WooCommerce session, starts another checkout. A buyer who closes the tab leaves the
 * order in wc-pending until WooCommerce's own hold-stock cron cancels it. The webhook
 * path is the other backstop, and it is not guaranteed to be wired up for a given
 * merchant account.
 *
 * This sweep is that missing trigger. It runs on WP-Cron, asks the service for the
 * true state of each held payment, and routes the answer through the SAME idempotent
 * Completion::maybe_complete() the live path uses. It touches no session and no cart,
 * because everything it needs (payment id, attempt id, claim key/owner/fence) is
 * already persisted on the order by Gateway::process_payment() before confirm.
 *
 * It also holds a reconciling order out of WooCommerce's unpaid-order auto-cancel for
 * a bounded window, so the buyer's order is not cancelled underneath an answer that is
 * still in flight — and it recovers orders that were already cancelled that way before
 * the payment turned out to be good.
 */
final class Reconciler {

	public const CRON_HOOK    = 'psc_reconcile_sweep';
	public const SCHEDULE     = 'psc_five_minutes';

	/** Per-order bookkeeping (never money — money stays in Completion's meta). */
	public const META_ATTEMPTS = '_psc_reconcile_attempts';
	public const META_LAST     = '_psc_reconcile_last';
	public const META_GAVE_UP  = '_psc_reconcile_gave_up';
	public const META_STARTED = '_psc_reconcile_started_at';
	private const CURSOR_OPTION = 'psc_reconcile_cursor';

	/** Orders reconciled per run. Bounds outbound HTTP from one cron tick. */
	private const BATCH = 20;

	/** How long a pending order is held out of Woo's unpaid auto-cancel. */
	private const HOLD_WINDOW = 7200; // 2 hours.
	private const ASYNC_HOLD_WINDOW = 604800; // 7 days for a real processing payment.

	/** How long after creation a cancelled order is still worth re-checking. */
	private const RECOVER_WINDOW = 604800; // 7 days.

	/** Stop asking the service after this many fruitless attempts. */
	private const MAX_ATTEMPTS = 24;
	private const ASYNC_MAX_ATTEMPTS = 2016; // Every 5 minutes for 7 days.

	public function hooks(): void {
		if ( defined( 'PSC_VERIFICATION_ONLY' ) && PSC_VERIFICATION_ONLY ) { return; }
		add_filter( 'cron_schedules', array( $this, 'add_schedule' ) );
		add_action( 'init', array( $this, 'ensure_scheduled' ) );
		add_action( self::CRON_HOOK, array( $this, 'run_sweep' ) );
		// Do not let Woo cancel an order out from under an answer still in flight.
		add_filter( 'woocommerce_cancel_unpaid_order', array( $this, 'allow_unpaid_cancel' ), 10, 2 );
	}

	/**
	 * @param array<string,array{interval:int,display:string}> $schedules
	 * @return array<string,array{interval:int,display:string}>
	 */
	public function add_schedule( $schedules ) {
		if ( ! is_array( $schedules ) ) {
			return $schedules;
		}
		$schedules[ self::SCHEDULE ] = array(
			'interval' => 300,
			'display'  => __( 'Every 5 minutes (PRISM reconciliation)', 'prism-simple-checkout' ),
		);
		return $schedules;
	}

	/** Self-healing: an upgrade without re-activation still gets the sweep scheduled. */
	public function ensure_scheduled(): void {
		if ( defined( 'PSC_VERIFICATION_ONLY' ) && PSC_VERIFICATION_ONLY ) { return; }
		if ( ! wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_event( time() + 60, self::SCHEDULE, self::CRON_HOOK );
		}
	}

	public static function unschedule(): void {
		$next = wp_next_scheduled( self::CRON_HOOK );
		while ( $next ) {
			wp_unschedule_event( $next, self::CRON_HOOK );
			$next = wp_next_scheduled( self::CRON_HOOK );
		}
	}

	/**
	 * True while PRISM still owns the outcome of this order, so Woo must not cancel it.
	 *
	 * Deliberately bounded: an order we have given up on, or one past the hold window,
	 * returns false so stock is released like any other abandoned order.
	 */
	public function holds_order( $order ): bool {
		if ( ! is_object( $order ) || ! method_exists( $order, 'get_meta' ) ) {
			return false;
		}
		if ( PSC_GATEWAY_ID !== (string) $order->get_payment_method() ) {
			return false;
		}
		if ( 'yes' === (string) $order->get_meta( self::META_GAVE_UP, true ) ) {
			return false;
		}
		if ( '' === (string) $order->get_meta( Completion::META_PAYMENT_ID, true ) ) {
			return false;
		}
		if ( 'yes' === (string) $order->get_meta( Completion::META_COMPLETED, true ) ) {
			return false;
		}
		$default = $this->is_async_processing( $order ) ? self::ASYNC_HOLD_WINDOW : self::HOLD_WINDOW;
		return $this->age_seconds( $order ) <= (int) apply_filters( 'psc_reconcile_hold_window', $default, $order );
	}

	/**
	 * Filter: woocommerce_cancel_unpaid_order.
	 *
	 * @param bool      $cancel Woo's own decision.
	 * @param \WC_Order $order  Order under consideration.
	 */
	public function allow_unpaid_cancel( $cancel, $order = null ) {
		try {
			if ( $cancel && $this->holds_order( $order ) ) {
				return false;
			}
		} catch ( \Throwable $error ) {
			unset( $error );
		}
		return $cancel;
	}

	/** Cron entry point. Never throws into WP-Cron. */
	public function run_sweep(): void {
		if ( defined( 'PSC_VERIFICATION_ONLY' ) && PSC_VERIFICATION_ONLY ) { return; }
		$lock = 'psc_reconcile_lock';
		$lease = array( 'token' => wp_generate_uuid4(), 'expires_at' => time() + 600 );
		if ( ! add_option( $lock, $lease, '', false ) ) {
			$old = get_option( $lock );
			if ( ! is_array( $old ) || (int) ( $old['expires_at'] ?? 0 ) >= time() || ! $this->delete_lock( $lock, $old ) || ! add_option( $lock, $lease, '', false ) ) { return; }
		}
		try {
			foreach ( $this->candidates() as $order ) {
				try {
					$this->reconcile_order( $order );
				} catch ( \Throwable $error ) {
					unset( $error );
				}
			}
		} catch ( \Throwable $error ) {
			unset( $error );
		} finally {
			$this->delete_lock( $lock, $lease );
		}
	}

	/**
	 * Held orders worth asking the service about.
	 *
	 * Two populations:
	 *  - wc-pending/on-hold PRISM orders still holding a payment id (the live hold), and
	 *  - recently cancelled PRISM orders that still hold one. Woo's hold-stock cron
	 *    can cancel an order minutes before the payment resolves as succeeded; those
	 *    orders are recoverable and must not be abandoned.
	 *
	 * @return list<\WC_Order>
	 */
	private function delete_lock( string $name, array $lease ): bool {
		global $wpdb;
		$deleted = (int) $wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name = %s AND option_value = %s", $name, maybe_serialize( $lease ) ) );
		if ( $deleted ) { wp_cache_delete( $name, 'options' ); }
		return 1 === $deleted;
	}

	private function candidates(): array {
		if ( ! function_exists( 'wc_get_orders' ) ) { return array(); }
		$cursor = get_option( self::CURSOR_OPTION, array() );
		$cursor = is_array( $cursor ) ? $cursor : array();
		$sets = array(
			'pending' => array( 'status' => array( 'wc-pending', 'wc-on-hold' ) ),
			'recent' => array( 'status' => array( 'wc-cancelled', 'wc-failed' ), 'date_created' => '>' . gmdate( 'Y-m-d H:i:s', time() - (int) apply_filters( 'psc_reconcile_recover_window', self::RECOVER_WINDOW ) ) ),
		);
		$pages = array(); $loads = array( 'pending' => 0, 'recent' => 0 ); $done = array(); $seen = array(); $out = array();
		$deadline = microtime( true ) + 5;
		$take = function ( string $name, int $limit ) use ( &$cursor, &$pages, &$loads, &$done, &$seen, &$out, $sets, $deadline ): void {
			$count = 0;
			while ( $count < $limit && empty( $done[ $name ] ) && microtime( true ) < $deadline ) {
				$page = max( 1, (int) ( $cursor[ $name ]['page'] ?? 1 ) );
				$index = max( 0, (int) ( $cursor[ $name ]['index'] ?? 0 ) );
				if ( ! isset( $pages[ $name ][ $page ] ) ) {
					if ( $loads[ $name ] >= 2 ) { break; }
					++$loads[ $name ];
					$rows = wc_get_orders( array_merge( $sets[ $name ], array( 'limit' => 100, 'page' => $page, 'payment_method' => PSC_GATEWAY_ID, 'orderby' => 'ID', 'order' => 'ASC', 'return' => 'objects' ) ) );
					$pages[ $name ][ $page ] = is_array( $rows ) ? array_values( $rows ) : array();
				}
				$rows = $pages[ $name ][ $page ];
				if ( $index >= count( $rows ) ) {
					if ( count( $rows ) < 100 ) { $cursor[ $name ] = array( 'page' => 1, 'index' => 0 ); $done[ $name ] = true; }
					else { $cursor[ $name ] = array( 'page' => $page + 1, 'index' => 0 ); }
					continue;
				}
				$order = $rows[ $index ];
				$cursor[ $name ] = array( 'page' => $page, 'index' => $index + 1 );
				if ( ! is_object( $order ) || ! method_exists( $order, 'get_id' ) || isset( $seen[ $order->get_id() ] ) || ! $this->needs_reconcile( $order ) ) { continue; }
				$seen[ $order->get_id() ] = true; $out[] = $order; ++$count;
			}
		};
		$take( 'pending', intdiv( self::BATCH, 2 ) );
		$take( 'recent', intdiv( self::BATCH, 2 ) );
		foreach ( array_keys( $sets ) as $name ) { $take( $name, self::BATCH - count( $out ) ); }
		update_option( self::CURSOR_OPTION, $cursor, false );
		return $out;
	}

	/** Is this an order PRISM held and has not yet resolved? */
	private function needs_reconcile( $order ): bool {
		if ( PSC_GATEWAY_ID !== (string) $order->get_payment_method() ) {
			return false;
		}
		if ( '' === (string) $order->get_meta( Completion::META_PAYMENT_ID, true ) ) {
			return false;
		}
		if ( 'yes' === (string) $order->get_meta( Completion::META_COMPLETED, true ) ) {
			return false;
		}
		if ( 'yes' === (string) $order->get_meta( self::META_GAVE_UP, true ) ) {
			return false;
		}
		// A conflict hold is an explicit manual-review state — never auto-resolve it.
		if ( $order->get_meta( Gateway::ORDER_CONFLICT_HOLD_META, true ) ) {
			return false;
		}
		if ( $order->is_paid() ) {
			return false;
		}
		if ( $this->is_async_processing( $order )
			&& $this->age_seconds( $order ) > (int) apply_filters( 'psc_reconcile_async_window', self::ASYNC_HOLD_WINDOW, $order ) ) {
			return false;
		}
		return (int) $order->get_meta( self::META_ATTEMPTS, true ) < $this->max_attempts( $order );
	}

	/**
	 * Ask the service what actually happened, and act on the answer.
	 *
	 * Mirrors Rest_Routes::reconcile_pending_confirm() but takes its guard from order
	 * meta instead of the buyer's session, so it works with nobody on the site.
	 */
	public function reconcile_order( $order ): string {
		if ( defined( 'PSC_VERIFICATION_ONLY' ) && PSC_VERIFICATION_ONLY ) { return 'disabled'; }
		$payment_id = (string) $order->get_meta( Completion::META_PAYMENT_ID, true );
		if ( '' === $payment_id ) {
			return 'skipped';
		}
		$identity = Completion::recovery_identity( $order );
		$guard = $this->guard_from_order( $order );
		$this->note_attempt( $order );

		$result = Plugin::instance()->service_client()->get_payment( $payment_id );
		$order = wc_get_order( (int) $identity['order_id'] );
		if ( ! $order ) { return 'ambiguous'; }
		$order->read_meta_data( true );
		if ( Completion::recovery_identity( $order ) !== $identity ) { return 'stale'; }

		if ( is_wp_error( $result ) ) {
			$data   = $result->get_error_data();
			$status = (int) ( is_array( $data ) ? ( $data['status'] ?? 0 ) : 0 );
			if ( 404 === $status && Plugin::instance()->completion()->finish_unpaid( $order, $identity ) ) { return 'not_found'; }
			// Still ambiguous — leave the hold in place and try again next tick.
			$this->maybe_give_up( $order );
			return 'ambiguous';
		}

		Service_Client::observe_fee( $result, $order, 'reconcile' );
		$status = (string) ( $result['status'] ?? '' );

		if ( 'succeeded' === $status ) {
			$was_cancelled = $order->has_status( array( 'cancelled', 'failed' ) );
			$done = Plugin::instance()->completion()->maybe_complete( $order, $result, $guard );
			if ( ! $done ) {
				$this->maybe_give_up( $order );
				return 'ambiguous';
			}
			if ( $was_cancelled ) {
				$order->add_order_note( 'PRISM reconciliation: this payment completed after the order had already been cancelled as unpaid. Order restored — verify stock and fulfilment before shipping.' );
				$order->save();
				Settings::raise_admin_alert(
					'reconcile_restored_' . (int) $order->get_id(),
					sprintf( 'PRISM restored order #%d after a late-settling payment. Confirm stock and fulfilment.', (int) $order->get_id() ),
					array( 'event' => 'reconcile_restored_cancelled_order', 'order_id' => (int) $order->get_id() )
				);
			}
			return 'completed';
		}

		if ( in_array( $status, array( 'failed', 'canceled' ), true ) ) {
			return Plugin::instance()->completion()->finish_unpaid( $order, $identity, $result ) ? $status : 'pending';
		}

		// Persist a real PI/status before the next sweep; processing moves to on-hold.
		if ( in_array( $status, array( 'processing', 'creating', 'requires_action', 'attention' ), true ) ) {
			if ( ! Plugin::instance()->completion()->accept_progress( $order, $result, $guard ) ) {
				$this->maybe_give_up( $order );
				return 'ambiguous';
			}
			$order = wc_get_order( (int) $identity['order_id'] );
			if ( ! $order ) { return 'ambiguous'; }
			$order->read_meta_data( true );
		}
		// processing / creating / requires_action / attention — genuinely still settling.
		$this->maybe_give_up( $order );
		return 'pending';
	}

	/** Claim guard, taken from the order rather than the buyer's session. */
	private function guard_from_order( $order ): array {
		return array(
			'claim_key'   => (string) $order->get_meta( Completion::META_CLAIM_KEY, true ),
			'owner_token' => (string) $order->get_meta( Completion::META_CLAIM_OWNER, true ),
			'fence'       => (int) $order->get_meta( Completion::META_CLAIM_FENCE, true ),
		);
	}

	/** Record that we asked, and stop asking once the answer is clearly not coming. */
	private function maybe_give_up( $order ): void {
		$attempts = (int) $order->get_meta( self::META_ATTEMPTS, true );
		$max      = $this->max_attempts( $order );
		if ( $attempts < $max ) {
			return;
		}
		$order->update_meta_data( self::META_GAVE_UP, 'yes' );
		$order->add_order_note( 'PRISM reconciliation gave up after ' . $attempts . ' attempts without a terminal answer. Check this payment in Stripe before refunding or refulfilling.' );
		$order->save();
		Settings::raise_admin_alert(
			'reconcile_stuck_' . (int) $order->get_id(),
			sprintf( 'PRISM could not resolve order #%d after %d reconciliation attempts. Manual review required.', (int) $order->get_id(), $attempts ),
			array( 'event' => 'reconcile_exhausted', 'order_id' => (int) $order->get_id() )
		);
	}

	private function note_attempt( $order ): void {
		$order->update_meta_data( self::META_ATTEMPTS, (int) $order->get_meta( self::META_ATTEMPTS, true ) + 1 );
		$order->update_meta_data( self::META_LAST, gmdate( 'c' ) );
		$order->save();
	}

	private function is_async_processing( $order ): bool {
		return 'processing' === (string) $order->get_meta( Completion::META_STATUS, true );
	}

	private function max_attempts( $order ): int {
		$default = $this->is_async_processing( $order ) ? self::ASYNC_MAX_ATTEMPTS : self::MAX_ATTEMPTS;
		return (int) apply_filters( 'psc_reconcile_max_attempts', $default, $order );
	}

	private function age_seconds( $order ): int {
		$started = strtotime( (string) $order->get_meta( self::META_STARTED, true ) );
		if ( $started ) { return max( 0, time() - $started ); }
		$created = method_exists( $order, 'get_date_created' ) ? $order->get_date_created() : null;
		if ( ! $created || ! method_exists( $created, 'getTimestamp' ) ) {
			return 0;
		}
		return max( 0, time() - (int) $created->getTimestamp() );
	}
}
