<?php
namespace PrismSimpleCheckout;
defined( 'ABSPATH' ) || exit;
/** Durable refund intent ledger: only unresolved retries reuse an operation id. */
final class Refunds {
	public const META_OPERATIONS = '_psc_refund_operations';
	public function process( $order, $amount = null, string $reason = '' ) {
		if ( defined( 'PSC_VERIFICATION_ONLY' ) && PSC_VERIFICATION_ONLY ) { return new \WP_Error( 'psc_verification_only', Research_Checkout::PAYMENT_DISABLED ); }
		$order_id = $order ? (int) $order->get_id() : 0;
		$lock = $order_id > 0 ? $this->acquire_lock( $order_id ) : null;
		if ( null === $lock ) {
			return new \WP_Error( 'psc_refund_busy', 'Another refund for this order is already in progress. Retry after it finishes.' );
		}
		try {
			// The order may have been loaded before another refund acquired this lock.
			$order->read_meta_data( true );
			return $this->process_locked( $order, $amount, $reason );
		} finally {
			$this->release_lock( $order_id, $lock );
		}
	}
	private function process_locked( $order, $amount, string $reason ) {
		$payment_id = $order ? (string) $order->get_meta( Completion::META_PAYMENT_ID, true ) : '';
		if ( '' === $payment_id ) {
			return new \WP_Error( 'psc_refund', 'No PRISM payment on order.' );
		}
		if ( null === $amount ) {
			$amount = $order->get_remaining_refund_amount();
		}
		// #2: convert with the *order* currency (not the store default).
		$currency = strtolower( (string) $order->get_currency() );
		$minor = Cart_Fingerprint::total_to_minor( (string) $amount, null, $currency );
		if ( $minor < 1 ) {
			return new \WP_Error( 'psc_refund', 'Invalid refund amount.' );
		}
		$operations = $order->get_meta( self::META_OPERATIONS, true );
		$operations = is_array( $operations ) ? $operations : array();
		$operation_id = '';
		$blocked_id = '';
		foreach ( $operations as $id => $record ) {
			if ( ! is_array( $record ) || ! in_array( (string) ( $record['status'] ?? '' ), array( 'pending', 'attention' ), true ) ) {
				continue;
			}
			$has_basis = array_key_exists( 'amount_minor', $record ) && array_key_exists( 'reason', $record ) && array_key_exists( 'currency', $record ) && '' !== (string) $record['currency'];
			if ( $has_basis && $minor === (int) $record['amount_minor'] && hash_equals( $currency, strtolower( (string) $record['currency'] ) ) ) {
				$operation_id = (string) $id;
				break;
			}
			if ( '' === $blocked_id ) {
				$blocked_id = (string) $id;
			}
		}
		if ( '' === $operation_id && '' !== $blocked_id ) {
			return new \WP_Error( 'psc_refund_unresolved_identity', sprintf( 'Refund operation %s is unresolved and its saved identity cannot be matched. Resolve it before starting another refund.', $blocked_id ) );
		}
		if ( '' === $operation_id ) {
			$operation_id = wp_generate_uuid4();
			$operations[ $operation_id ] = array( 'amount_minor' => $minor, 'reason' => substr( (string) $reason, 0, 500 ), 'currency' => $currency, 'status' => 'pending', 'created_at' => gmdate( 'c' ) );
			$this->save( $order, $operations );
		}
		$minor = (int) $operations[ $operation_id ]['amount_minor'];
		$frozen_reason = (string) $operations[ $operation_id ]['reason'];
		$result = Plugin::instance()->service_client()->create_refund(
			array( 'operation_id' => $operation_id, 'payment_id' => $payment_id, 'woo_order_id' => (int) $order->get_id(), 'amount_minor' => $minor, 'reason' => $frozen_reason )
		);
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		$status = (string) ( $result['status'] ?? '' );
		$fee_refund = (string) ( $result['application_fee_refund_id'] ?? '' );
		$fee = (int) ( $result['fee_reversal_minor'] ?? -1 );
		$reversed = 0;
		foreach ( $operations as $record ) { if ( 'succeeded' === ( $record['status'] ?? '' ) ) { $reversed += (int) ( $record['fee_reversal_minor'] ?? 0 ); } }
		$original_fee = (int) $order->get_meta( Completion::META_FEE_MINOR, true );
		if ( ! hash_equals( $operation_id, (string) ( $result['operation_id'] ?? '' ) ) || $minor !== (int) ( $result['amount_minor'] ?? 0 ) || ! in_array( $status, array( 'pending', 'succeeded', 'failed', 'attention' ), true ) || $fee < 0 || ( $original_fee > 0 && $reversed + $fee > $original_fee ) || ( 'succeeded' === $status && ( ( $fee > 0 && ! str_starts_with( $fee_refund, 'fr_' ) ) || ( 0 === $fee && '' !== $fee_refund ) ) ) ) {
			$operations[ $operation_id ]['status'] = 'attention';
			$this->save( $order, $operations );
			return new \WP_Error( 'psc_refund_truth', 'Refund response did not match the Woo intent.' );
		}
		$operations[ $operation_id ] += array( 'amount_minor' => $minor );
		$operations[ $operation_id ] = array_merge(
			$operations[ $operation_id ],
			array(
				'refund_id' => (string) ( $result['refund_id'] ?? '' ),
				'status' => $status,
				'fee_reversal_minor' => $fee,
				'application_fee_refund_id' => $fee_refund,
				'updated_at' => gmdate( 'c' ),
			)
		);
		$this->save( $order, $operations );
		if ( 'succeeded' !== $status ) {
			return new \WP_Error( 'psc_refund_pending', 'Refund is not yet confirmed.' );
		}
		$order->add_order_note( sprintf( 'PRISM refund %s amount_minor=%d fee_reversal_minor=%d', (string) $result['refund_id'], $minor, (int) $result['fee_reversal_minor'] ) );
		$order->save();
		return true;
	}
	private function acquire_lock( int $order_id ): ?string {
		$name = 'psc_refund_lock_' . $order_id;
		$token = wp_generate_uuid4();
		$value = array( 'token' => $token, 'expires_at' => time() + 60 );
		if ( add_option( $name, $value, '', false ) ) {
			return $token;
		}
		$current = get_option( $name, array() );
		if ( is_array( $current ) && (int) ( $current['expires_at'] ?? 0 ) < time() ) {
			delete_option( $name );
			return add_option( $name, $value, '', false ) ? $token : null;
		}
		return null;
	}
	private function release_lock( int $order_id, string $token ): void {
		$name = 'psc_refund_lock_' . $order_id;
		$current = get_option( $name, array() );
		if ( is_array( $current ) && hash_equals( $token, (string) ( $current['token'] ?? '' ) ) ) {
			delete_option( $name );
		}
	}
	private function save( $order, array $operations ): void {
		$order->update_meta_data( self::META_OPERATIONS, $operations );
		$order->save();
	}
}
