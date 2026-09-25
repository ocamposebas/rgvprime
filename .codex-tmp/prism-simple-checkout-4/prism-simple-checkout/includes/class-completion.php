<?php
namespace PrismSimpleCheckout;
defined( 'ABSPATH' ) || exit;
/** Idempotent, claim-fenced transition from service payment state to paid Woo order. */
final class Completion {
	public const META_ATTEMPT_ID = '_psc_attempt_id';
	public const META_PAYMENT_ID = '_psc_payment_id';
	public const META_CART_FINGERPRINT = '_psc_cart_fingerprint';
	public const META_AMOUNT_MINOR = '_psc_amount_minor';
	public const META_CURRENCY = '_psc_currency';
	public const META_ACCOUNT = '_psc_connected_account';
	public const META_FEE_MINOR = '_psc_fee_minor';
	public const META_COMPLETED = '_psc_payment_completed';
	public const META_CLAIM_KEY = '_psc_claim_key';
	public const META_CLAIM_OWNER = '_psc_claim_owner';
	public const META_CLAIM_FENCE = '_psc_claim_fence';
	public const META_TERMINAL_ATTEMPTS = '_psc_terminal_attempts';
	public function maybe_complete( $order, array $payment, array $guard = array() ): bool {
		if ( ! is_object( $order ) || $order->get_meta( Gateway::ORDER_CONFLICT_HOLD_META, true )
			|| ! $this->identity_matches( $order, $payment ) ) { return false; }
		$key = (string) ( $guard['claim_key'] ?? '' );
		$owner = (string) ( $guard['owner_token'] ?? '' );
		$fence = (int) ( $guard['fence'] ?? 0 );
		$order_id = (int) $order->get_id();
		$payment_id = (string) $payment['payment_id'];
		$claim = Plugin::instance()->checkout_claim();
		$released = false;
		if ( '' !== $key && ! $claim->assert_bound_order( $key, $owner, $fence, $order_id ) ) {
			if ( ! $claim->allows_completion_after_release( $key, $owner, $fence, $order_id, $payment_id ) ) { return false; }
			$released = true;
		}
		$stale_paid = $order->is_paid() || 'yes' === (string) $order->get_meta( self::META_COMPLETED, true );
		if ( ! $stale_paid && 'succeeded' !== (string) ( $payment['status'] ?? '' ) ) { return false; }
		if ( '' === $key ) {
			if ( $stale_paid ) {
				$stored = (string) $order->get_meta( self::META_PAYMENT_ID, true );
				return '' === $stored || hash_equals( $stored, $payment_id );
			}
			$lease = bin2hex( random_bytes( 16 ) );
		} else {
			$lease = $released
				? $claim->begin_released_completion( $key, $owner, $fence, $order_id, $payment_id )
				: $claim->begin_completion( $key, $owner, $fence, $order_id, $payment_id );
		}
		if ( 'complete' === $lease ) { return true; }
		if ( ! is_string( $lease ) || '' === $lease ) { return false; }
		$fresh = function_exists( 'wc_get_order' ) ? wc_get_order( $order_id ) : false;
		if ( is_object( $fresh ) ) { $fresh->read_meta_data( true ); }
		if ( ! is_object( $fresh ) || $fresh->get_meta( Gateway::ORDER_CONFLICT_HOLD_META, true )
			|| ! $this->identity_matches( $fresh, $payment ) ) {
			if ( '' !== $key ) { $claim->abort_completion( $key, $lease ); }
			return false;
		}
		$order = $fresh;
		if ( $order->is_paid() || 'yes' === (string) $order->get_meta( self::META_COMPLETED, true ) ) {
			$stored = (string) $order->get_meta( self::META_PAYMENT_ID, true );
			if ( '' !== $stored && ! hash_equals( $stored, $payment_id ) ) {
				if ( '' !== $key ) { $claim->abort_completion( $key, $lease ); }
				return false;
			}
			if ( '' !== $key && ! $claim->finish_completion( $key, $lease, $payment_id, (string) ( $guard['outbox_id'] ?? '' ) ) ) {
				$this->record_finish_cas_loss( $order, $payment_id );
			}
			return true;
		}
		if ( 'succeeded' !== (string) ( $payment['status'] ?? '' ) ) {
			if ( '' !== $key ) { $claim->abort_completion( $key, $lease ); }
			return false;
		}
		$order->update_meta_data( self::META_PAYMENT_ID, $payment_id );
		$order->update_meta_data( self::META_FEE_MINOR, (int) ( $payment['fee_minor'] ?? 0 ) );
		$order->save();
		if ( '' !== $key && ! $claim->renew_completion( $key, $lease ) ) {
			$claim->abort_completion( $key, $lease );
			return false;
		}
		// Close the race with a late-success conflict arriving while the service
		// confirmation was in flight. Re-read immediately before Woo is marked paid.
		$latest = function_exists( 'wc_get_order' ) ? wc_get_order( $order_id ) : false;
		if ( ! is_object( $latest ) ) {
			if ( '' !== $key ) { $claim->abort_completion( $key, $lease ); }
			return false;
		}
		$latest->read_meta_data( true );
		if ( $latest->get_meta( Gateway::ORDER_CONFLICT_HOLD_META, true )
			|| ! $this->identity_matches( $latest, $payment ) ) {
			if ( '' !== $key ) { $claim->abort_completion( $key, $lease ); }
			return false;
		}
		$order = $latest;
		if ( true !== $order->payment_complete( $payment_id ) ) {
			if ( '' !== $key ) { $claim->abort_completion( $key, $lease ); }
			return false;
		}
		$order->update_meta_data( self::META_COMPLETED, 'yes' );
		$order->add_order_note( 'PRISM payment succeeded: ' . $payment_id );
		$order->save();
		if ( '' !== $key && ! $claim->finish_completion( $key, $lease, $payment_id, (string) ( $guard['outbox_id'] ?? '' ) ) ) {
			$this->record_finish_cas_loss( $order, $payment_id );
		}
		return true;
	}

	/**
	 * Persist the canonical payment id for a signed non-terminal service event.
	 *
	 * Confirm writes pending_<attempt> before the network call so an ambiguous
	 * response is recoverable. A processing/requires_action callback must replace
	 * that marker with the real payment id; otherwise every later poll asks the
	 * service for the synthetic marker and the buyer remains stuck forever.
	 */
	public function accept_progress( $order, array $payment, array $guard = array() ): bool {
		$status = (string) ( $payment['status'] ?? '' );
		if ( ! in_array( $status, array( 'creating', 'requires_action', 'processing', 'attention' ), true )
			|| ! is_object( $order ) || $order->get_meta( Gateway::ORDER_CONFLICT_HOLD_META, true )
			|| ! $this->identity_matches( $order, $payment ) ) {
			return false;
		}
		$key        = (string) ( $guard['claim_key'] ?? '' );
		$owner      = (string) ( $guard['owner_token'] ?? '' );
		$fence      = (int) ( $guard['fence'] ?? 0 );
		$order_id   = (int) $order->get_id();
		$payment_id = (string) ( $payment['payment_id'] ?? '' );
		if ( '' === $key || '' === $owner || $fence < 1 || $order_id < 1 || '' === $payment_id ) {
			return false;
		}
		$claim = Plugin::instance()->checkout_claim();
		if ( ! $claim->assert_bound_order( $key, $owner, $fence, $order_id ) ) {
			return false;
		}
		$lease = $claim->begin_completion( $key, $owner, $fence, $order_id, $payment_id );
		if ( 'complete' === $lease ) {
			return true;
		}
		if ( ! is_string( $lease ) || '' === $lease ) {
			return false;
		}
		try {
			$fresh = function_exists( 'wc_get_order' ) ? wc_get_order( $order_id ) : false;
			if ( ! is_object( $fresh ) ) {
				return false;
			}
			$fresh->read_meta_data( true );
			if ( ! $this->identity_matches( $fresh, $payment )
				|| $fresh->get_meta( Gateway::ORDER_CONFLICT_HOLD_META, true )
				|| $fresh->is_paid() || 'yes' === (string) $fresh->get_meta( self::META_COMPLETED, true ) ) {
				return false;
			}
			$stored = (string) $fresh->get_meta( self::META_PAYMENT_ID, true );
			if ( '' !== $stored && ! hash_equals( $stored, $payment_id ) ) {
				$attempt_id = (string) ( $payment['attempt_id'] ?? '' );
				if ( ! str_starts_with( $stored, 'pending_' )
					|| '' === $attempt_id || ! hash_equals( substr( $stored, 8 ), $attempt_id ) ) {
					return false;
				}
			}
			if ( ! $claim->renew_completion( $key, $lease ) ) {
				return false;
			}
			$fresh->update_meta_data( self::META_PAYMENT_ID, $payment_id );
			$fresh->update_meta_data( self::META_FEE_MINOR, (int) ( $payment['fee_minor'] ?? 0 ) );
			$fresh->save();
			$verified = wc_get_order( $order_id );
			if ( ! is_object( $verified ) ) {
				return false;
			}
			$verified->read_meta_data( true );
			return hash_equals( $payment_id, (string) $verified->get_meta( self::META_PAYMENT_ID, true ) )
				&& $this->identity_matches( $verified, $payment );
		} finally {
			$claim->abort_completion( $key, $lease );
		}
	}
	/** Capture before an HTTP lookup; never borrow a guard from a subsequently reused order. */
	public static function recovery_identity( $order ): array {
		$identity = array( 'order_id' => (int) $order->get_id() );
		foreach ( array( self::META_PAYMENT_ID, self::META_ATTEMPT_ID, '_psc_confirmation_operation_id', self::META_ACCOUNT, self::META_CURRENCY, self::META_AMOUNT_MINOR, self::META_CART_FINGERPRINT, self::META_CLAIM_KEY, self::META_CLAIM_OWNER, self::META_CLAIM_FENCE ) as $key ) {
			$identity[ $key ] = (string) $order->get_meta( $key, true );
		}
		return $identity;
	}

	/**
	 * Safely close a proven unpaid attempt. A real PI requires confirmed cancellation;
	 * a missing service result is releasable only for the original pending_ marker.
	 */
	public function finish_unpaid( $order, array $identity, ?array $payment = null ): bool {
		if ( ! is_object( $order ) || $order->get_meta( Gateway::ORDER_CONFLICT_HOLD_META, true ) ) { return false; }
		$stored_id = (string) ( $identity[ self::META_PAYMENT_ID ] ?? '' );
		$pending = str_starts_with( $stored_id, 'pending_' );
		if ( '' === $stored_id || ( null === $payment && ! $pending ) ) { return false; }
		if ( null !== $payment ) {
			$status = (string) ( $payment['status'] ?? '' );
			// Both signed terminal states mean no collectible payment remains. The
			// previous condition rejected a real payment_id with status=failed even
			// though the gateway, poller and reconciler all treat failed as terminal.
			if ( ! in_array( $status, array( 'failed', 'canceled' ), true ) ) { return false; }
			if ( ! $this->identity_matches( $order, $payment ) || ! hash_equals( (string) ( $identity[ self::META_ATTEMPT_ID ] ?? '' ), (string) ( $payment['attempt_id'] ?? '' ) ) ) { return false; }
		}
		$key = (string) ( $identity[ self::META_CLAIM_KEY ] ?? '' );
		$owner = (string) ( $identity[ self::META_CLAIM_OWNER ] ?? '' );
		$fence = (int) ( $identity[ self::META_CLAIM_FENCE ] ?? 0 );
		$id = (int) ( $identity['order_id'] ?? 0 );
		if ( '' === $key || '' === $owner || $fence < 1 || $id < 1 ) { return false; }
		$claim = Plugin::instance()->checkout_claim();
		$lease = $claim->begin_completion( $key, $owner, $fence, $id, $stored_id );
		if ( false === $lease && $claim->allows_completion_after_release( $key, $owner, $fence, $id, $stored_id ) ) {
			$lease = $claim->begin_released_completion( $key, $owner, $fence, $id, $stored_id );
		}
		if ( ! is_string( $lease ) || '' === $lease || 'complete' === $lease ) {
			$fresh = wc_get_order( $id );
			if ( ! $fresh ) { return false; }
			$fresh->read_meta_data( true );
			return ! $fresh->is_paid() && self::recovery_identity( $fresh ) === $identity
				&& hash_equals( (string) $fresh->get_meta( '_psc_terminal_attempt_id', true ), (string) $identity[ self::META_ATTEMPT_ID ] )
				&& ! $claim->assert_bound_order( $key, $owner, $fence, $id );
		}
		$released = false;
		try {
			$fresh = wc_get_order( $id );
			if ( ! $fresh ) { return false; }
			$fresh->read_meta_data( true );
			if ( self::recovery_identity( $fresh ) !== $identity
				|| $fresh->get_meta( Gateway::ORDER_CONFLICT_HOLD_META, true )
				|| $fresh->is_paid() || 'yes' === (string) $fresh->get_meta( self::META_COMPLETED, true )
				|| ! $claim->renew_completion( $key, $lease ) ) { return false; }
			$fresh->update_meta_data( Reconciler::META_GAVE_UP, 'yes' );
			if ( ! $fresh->has_status( array( 'cancelled', 'failed', 'refunded' ) ) ) { $fresh->set_status( 'failed' ); }
			$fresh->save();
			$released = $claim->release_terminal( $key, $owner, $fence, $id, $lease );
			if ( ! $released ) { return false; }
			$fresh->update_meta_data( '_psc_terminal_attempt_id', (string) $identity[ self::META_ATTEMPT_ID ] );
			self::remember_terminal_attempt( $fresh, $identity, $payment );
			$status = (string) ( $payment['status'] ?? '' );
			$fresh->add_order_note(
				null === $payment
					? 'PRISM confirmed no payment was created for this attempt.'
					: ( 'failed' === $status ? 'PRISM confirmed this payment failed without collection.' : 'PRISM confirmed this payment was canceled without collection.' )
			);
			$fresh->save();
			return true;
		} finally {
			if ( ! $released ) { $claim->abort_completion( $key, $lease ); }
		}
	}

	/** Return a bounded terminal-attempt tombstone used to ACK harmless late events. */
	public static function terminal_attempt( $order, string $attempt_id ): ?array {
		if ( ! is_object( $order ) || '' === $attempt_id ) {
			return null;
		}
		$entries = $order->get_meta( self::META_TERMINAL_ATTEMPTS, true );
		foreach ( is_array( $entries ) ? $entries : array() as $entry ) {
			if ( is_array( $entry ) && hash_equals( (string) ( $entry['attempt_id'] ?? '' ), $attempt_id ) ) {
				return $entry;
			}
		}
		$legacy = (string) $order->get_meta( '_psc_terminal_attempt_id', true );
		if ( '' !== $legacy && hash_equals( $legacy, $attempt_id ) ) {
			return array( 'attempt_id' => $legacy, 'status' => 'legacy_terminal' );
		}
		return null;
	}

	/** Keep only the newest eight resolved attempts; never erase them when a retry starts. */
	public static function remember_terminal_attempt( $order, array $identity, ?array $payment ): void {
		$attempt_id = (string) ( $identity[ self::META_ATTEMPT_ID ] ?? '' );
		if ( '' === $attempt_id ) {
			return;
		}
		$stored = $order->get_meta( self::META_TERMINAL_ATTEMPTS, true );
		$entries = array();
		$existing = null;
		foreach ( is_array( $stored ) ? $stored : array() as $entry ) {
			if ( ! is_array( $entry ) ) {
				continue;
			}
			if ( hash_equals( (string) ( $entry['attempt_id'] ?? '' ), $attempt_id ) ) {
				$existing = $entry;
			} else {
				$entries[] = $entry;
			}
		}
		if ( null === $payment && is_array( $existing ) ) {
			$entries[] = $existing;
		} else {
			$entries[] = array(
				'attempt_id'       => $attempt_id,
				'payment_id'       => (string) ( $payment['payment_id'] ?? $identity[ self::META_PAYMENT_ID ] ?? '' ),
				'status'           => (string) ( $payment['status'] ?? 'not_created' ),
				'connected_account'=> (string) ( $identity[ self::META_ACCOUNT ] ?? '' ),
				'amount_minor'     => (int) ( $identity[ self::META_AMOUNT_MINOR ] ?? 0 ),
				'currency'         => strtolower( (string) ( $identity[ self::META_CURRENCY ] ?? '' ) ),
				'resolved_at'      => gmdate( 'c' ),
			);
		}
		$order->update_meta_data( self::META_TERMINAL_ATTEMPTS, array_slice( $entries, -8 ) );
	}

	private function record_finish_cas_loss( $order, string $payment_id ): void {
		$order_id = 0;
		try { $order_id = (int) $order->get_id(); } catch ( \Throwable $error ) { unset( $error ); }
		try { $order->add_order_note( 'CRITICAL: PRISM completed Woo payment but lost the completion-lease final CAS. Manual review required.' ); } catch ( \Throwable $error ) { unset( $error ); }
		Settings::raise_admin_alert(
			'completion_cas_' . $order_id,
			sprintf( 'PRISM completion integrity alert for order #%d: Woo payment completed, but the claim final CAS was lost. Manual review required.', $order_id ),
			array( 'event' => 'completion_lease_cas_lost', 'order_id' => $order_id, 'payment_id' => $payment_id )
		);
	}
	private function identity_matches( $order, array $payment ): bool {
		$payment_id = (string) ( $payment['payment_id'] ?? '' );
		if ( '' === $payment_id ) {
			return false;
		}
		$stored_payment = (string) $order->get_meta( self::META_PAYMENT_ID, true );
		if ( '' !== $stored_payment && ! hash_equals( $stored_payment, $payment_id ) ) {
			// H9 provisional marker written before confirm: identity rests on the attempt id.
			if ( ! str_starts_with( $stored_payment, 'pending_' ) ) {
				return false;
			}
			$expected_attempt = substr( $stored_payment, 8 );
			$incoming_attempt = (string) ( $payment['attempt_id'] ?? '' );
			if ( '' === $incoming_attempt || ! hash_equals( $expected_attempt, $incoming_attempt ) ) {
				return false;
			}
		}
		$pairs = array(
			array( self::META_ATTEMPT_ID, 'attempt_id' ),
			array( self::META_CURRENCY, 'currency' ),
			array( self::META_ACCOUNT, 'connected_account' ),
			array( self::META_CART_FINGERPRINT, 'cart_fingerprint' ),
		);
		foreach ( $pairs as $pair ) {
			$stored = strtolower( (string) $order->get_meta( $pair[0], true ) );
			$incoming = strtolower( (string) ( $payment[ $pair[1] ] ?? '' ) );
			if ( '' !== $stored && '' !== $incoming && ! hash_equals( $stored, $incoming ) ) {
				return false;
			}
		}
		$amount = (int) ( $payment['amount_minor'] ?? 0 );
		$stored_amount = (int) $order->get_meta( self::META_AMOUNT_MINOR, true );
		if ( $amount < 1 ) {
			return false;
		}
		if ( $stored_amount > 0 ) {
			return $stored_amount === $amount;
		}
		return Cart_Fingerprint::total_to_minor( (string) $order->get_total() ) === $amount;
	}
}
