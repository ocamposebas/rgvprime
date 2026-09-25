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
	public function maybe_complete( $order, array $payment, array $guard = array() ): bool {
		if ( ! is_object( $order ) || ! $this->identity_matches( $order, $payment ) ) { return false; }
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
		if ( ! is_object( $fresh ) || ! $this->identity_matches( $fresh, $payment ) ) {
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
		$stored_id = (string) ( $identity[ self::META_PAYMENT_ID ] ?? '' );
		$pending = str_starts_with( $stored_id, 'pending_' );
		if ( '' === $stored_id || ( null === $payment && ! $pending ) ) { return false; }
		if ( null !== $payment ) {
			$status = (string) ( $payment['status'] ?? '' );
			if ( 'canceled' !== $status && ! ( $pending && 'failed' === $status && str_starts_with( (string) ( $payment['payment_id'] ?? '' ), 'pending_' ) ) ) { return false; }
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
			if ( self::recovery_identity( $fresh ) !== $identity || $fresh->is_paid() || 'yes' === (string) $fresh->get_meta( self::META_COMPLETED, true ) || ! $claim->renew_completion( $key, $lease ) ) { return false; }
			$fresh->update_meta_data( Reconciler::META_GAVE_UP, 'yes' );
			$fresh->update_meta_data( '_psc_terminal_attempt_id', (string) $identity[ self::META_ATTEMPT_ID ] );
			$fresh->add_order_note( null === $payment ? 'PRISM confirmed no payment was created for this attempt.' : 'PRISM confirmed this payment was canceled without collection.' );
			if ( ! $fresh->has_status( array( 'cancelled', 'failed', 'refunded' ) ) ) { $fresh->set_status( 'failed' ); }
			$fresh->save();
			$released = $claim->release_terminal( $key, $owner, $fence, $id, $lease );
			return $released;
		} finally {
			if ( ! $released ) { $claim->abort_completion( $key, $lease ); }
		}
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
