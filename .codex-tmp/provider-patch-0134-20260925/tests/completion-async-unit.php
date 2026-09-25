<?php
declare(strict_types=1);

namespace {
	define( 'ABSPATH', __DIR__ );
	function psc_unit_assert( bool $condition, string $message ): void {
		if ( ! $condition ) { throw new \RuntimeException( $message ); }
	}
	function wc_get_order( int $id ) { return $GLOBALS['psc_unit_orders'][ $id ] ?? false; }
}

namespace PrismSimpleCheckout {
	final class Reconciler {
		public const META_GAVE_UP = '_psc_reconcile_gave_up';
	}

	final class PSC_Unit_Claim {
		public bool $bound = true;
		public function assert_bound_order( string $key, string $owner, int $fence, int $order_id ): bool { return $this->bound && '' !== $key && '' !== $owner && $fence > 0 && $order_id > 0; }
		public function allows_completion_after_release(): bool { return false; }
		public function begin_completion() { return $this->bound ? 'lease-a' : false; }
		public function begin_released_completion() { return false; }
		public function renew_completion(): bool { return true; }
		public function release_terminal(): bool { $this->bound = false; return true; }
		public function abort_completion(): void {}
	}

	final class Plugin {
		private static ?self $instance = null;
		public PSC_Unit_Claim $claim;
		private function __construct() { $this->claim = new PSC_Unit_Claim(); }
		public static function instance(): self { return self::$instance ??= new self(); }
		public function checkout_claim(): PSC_Unit_Claim { return $this->claim; }
	}

	final class PSC_Unit_Order {
		public array $meta;
		public string $status = 'pending';
		public array $notes = array();
		public function __construct( public int $id, array $meta ) { $this->meta = $meta; }
		public function get_id(): int { return $this->id; }
		public function get_meta( string $key, bool $single = true ) { return $this->meta[ $key ] ?? ''; }
		public function update_meta_data( string $key, $value ): void { $this->meta[ $key ] = $value; }
		public function read_meta_data( bool $force = false ): void {}
		public function save(): void {}
		public function is_paid(): bool { return in_array( $this->status, array( 'processing', 'completed' ), true ); }
		public function has_status( array $statuses ): bool { return in_array( $this->status, $statuses, true ); }
		public function set_status( string $status ): void { $this->status = $status; }
		public function add_order_note( string $note ): void { $this->notes[] = $note; }
		public function get_total(): string { return '10.00'; }
	}

	require_once dirname( __DIR__ ) . '/prism-simple-checkout/includes/class-completion.php';

	function base_meta( string $attempt ): array {
		return array(
			Completion::META_ATTEMPT_ID => $attempt,
			Completion::META_PAYMENT_ID => 'pending_' . $attempt,
			Completion::META_CART_FINGERPRINT => 'fingerprint-a',
			Completion::META_AMOUNT_MINOR => 1000,
			Completion::META_CURRENCY => 'usd',
			Completion::META_ACCOUNT => 'acct_test',
			Completion::META_CLAIM_KEY => 'claim-key',
			Completion::META_CLAIM_OWNER => 'claim-owner',
			Completion::META_CLAIM_FENCE => 1,
			'_psc_confirmation_operation_id' => 'operation-a',
		);
	}

	function payment( string $attempt, string $status ): array {
		return array(
			'payment_id' => 'pi_real_' . $attempt,
			'attempt_id' => $attempt,
			'connected_account' => 'acct_test',
			'status' => $status,
			'amount_minor' => 1000,
			'fee_minor' => 50,
			'currency' => 'usd',
			'cart_fingerprint' => 'fingerprint-a',
		);
	}

	$completion = new Completion();
	$progress = new PSC_Unit_Order( 71, base_meta( 'attempt-progress' ) );
	$GLOBALS['psc_unit_orders'][71] = $progress;
	$guard = array( 'claim_key' => 'claim-key', 'owner_token' => 'claim-owner', 'fence' => 1 );
	\psc_unit_assert( true === $completion->accept_progress( $progress, payment( 'attempt-progress', 'processing' ), $guard ), 'Valid processing callback was rejected.' );
	\psc_unit_assert( 'pi_real_attempt-progress' === $progress->get_meta( Completion::META_PAYMENT_ID, true ), 'Processing did not replace provisional payment id.' );
	\psc_unit_assert( 'processing' === $progress->get_meta( Completion::META_STATUS, true ), 'Processing status was not persisted.' );
	\psc_unit_assert( 'on-hold' === $progress->status && ! $progress->is_paid(), 'Processing order was not held safely.' );
	\psc_unit_assert( false === $completion->accept_progress( $progress, payment( 'other-attempt', 'processing' ), $guard ), 'Mismatched attempt was accepted.' );

	Plugin::instance()->claim = new PSC_Unit_Claim();
	$terminal = new PSC_Unit_Order( 72, base_meta( 'attempt-terminal' ) );
	$GLOBALS['psc_unit_orders'][72] = $terminal;
	$identity = Completion::recovery_identity( $terminal );
	$failed = payment( 'attempt-terminal', 'failed' );
	\psc_unit_assert( true === $completion->finish_unpaid( $terminal, $identity, $failed ), 'Real failed payment was not released.' );
	\psc_unit_assert( 'failed' === $terminal->status && 'failed' === $terminal->get_meta( Completion::META_STATUS, true ), 'Terminal failure was not persisted.' );
	\psc_unit_assert( 'pi_real_attempt-terminal' === $terminal->get_meta( Completion::META_PAYMENT_ID, true ), 'Terminal failure did not persist real payment id.' );
	\psc_unit_assert( true === $completion->finish_unpaid( $terminal, Completion::recovery_identity( $terminal ), $failed ), 'Duplicate terminal callback was not idempotently acknowledged.' );

	echo "completion async unit tests: OK\n";
}
