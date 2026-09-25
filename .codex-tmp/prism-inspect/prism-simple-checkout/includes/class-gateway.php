<?php
namespace PrismSimpleCheckout;
defined( 'ABSPATH' ) || exit;
/** Classic Woo adapter; Woo creates/binds the order before the service confirms. */
class Gateway extends \WC_Payment_Gateway {
	public const ORDER_CONFLICT_HOLD_META = '_psc_order_conflict_hold';
	/** Native order-details/account links must not bypass pending-payment recovery. */
	public static function filter_order_actions( $actions, $order ) {
		if ( ! $order instanceof \WC_Order || PSC_GATEWAY_ID !== $order->get_payment_method() || $order->is_paid() ) { return $actions; }
		$order->read_meta_data( true );
		$identity = Completion::recovery_identity( $order );
		$conflict = $order->get_meta( self::ORDER_CONFLICT_HOLD_META, true );
		if ( '' === $identity[ Completion::META_PAYMENT_ID ] && ! $conflict ) { return $actions; }
		$terminal = ! $conflict && '' !== $identity[ Completion::META_ATTEMPT_ID ]
			&& hash_equals( $identity[ Completion::META_ATTEMPT_ID ], (string) $order->get_meta( '_psc_terminal_attempt_id', true ) )
			&& Plugin::instance()->checkout_claim()->allows_completion_after_release(
				$identity[ Completion::META_CLAIM_KEY ], $identity[ Completion::META_CLAIM_OWNER ],
				(int) $identity[ Completion::META_CLAIM_FENCE ], (int) $identity['order_id'], $identity[ Completion::META_PAYMENT_ID ]
			);
		if ( ! $terminal ) { unset( $actions['pay'], $actions['cancel'] ); }
		return $actions;
	}
	public function __construct() {
		$this->id = PSC_GATEWAY_ID;
		$this->method_title = __( 'PRISM Fall Checkout', 'prism-simple-checkout' );
		$this->method_description = __( 'Verified research checkout through the PRISM service.', 'prism-simple-checkout' );
		$this->has_fields = true;
		$this->supports = PSC_VERIFICATION_ONLY ? array( 'products' ) : array( 'products', 'refunds' );
		$this->init_form_fields();
		$this->init_settings();
		$this->title = $this->get_option( 'title', __( 'PRISM Secure Checkout', 'prism-simple-checkout' ) );
		$this->description = $this->get_option( 'description', '' );
		$this->enabled = $this->get_option( 'enabled', 'no' );
		add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'process_admin_options' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_assets' ) );
		add_action( 'woocommerce_thankyou', array( $this, 'maybe_pull_thankyou' ) );
		add_action( 'woocommerce_before_thankyou', array( $this, 'render_recovery_status' ) );
	}
	/** Order-key access or this buyer's existing session supplies recovery identity. */
	private function recovery_context(): ?array {
		$session = function_exists( 'WC' ) && WC()->session ? WC()->session : null;
		$saved = $session ? $session->get( 'psc_recovery' ) : null;
		$id = function_exists( 'get_query_var' ) ? absint( get_query_var( 'order-received', 0 ) ) : 0;
		if ( $id ) {
			$key = sanitize_text_field( wp_unslash( (string) ( $_GET['key'] ?? '' ) ) );
		} else {
			$id = is_array( $saved ) ? absint( $saved['orderId'] ?? 0 ) : 0;
			$key = is_array( $saved ) ? (string) ( $saved['orderKey'] ?? '' ) : '';
		}
		$order = $id ? wc_get_order( $id ) : null;
		if ( ! $order || '' === $key || ! hash_equals( $order->get_order_key(), $key ) || PSC_GATEWAY_ID !== $order->get_payment_method()
			|| $order->get_meta( self::ORDER_CONFLICT_HOLD_META, true ) ) { return null; }
		$order->read_meta_data( true );
		$identity = Completion::recovery_identity( $order );
		if ( $order->is_paid() && 'yes' === (string) $order->get_meta( Completion::META_COMPLETED, true ) ) {
			Rest_Routes::clear_matching_recovery( $identity );
			return null;
		}
		if ( '' === $identity[ Completion::META_PAYMENT_ID ] ) { return null; }
		return array( 'orderId' => $id, 'orderKey' => $key, 'paymentId' => $identity[ Completion::META_PAYMENT_ID ] );
	}
	public function render_recovery_status( $order_id ): void {
		if ( PSC_VERIFICATION_ONLY ) { return; }
		$context = $this->recovery_context();
		if ( ! $context || (int) $context['orderId'] !== absint( $order_id ) ) { return; }
		echo '<section class="psc-recovery-status" aria-label="' . esc_attr__( 'Payment status', 'prism-simple-checkout' ) . '"><p id="psc-recovery-message" role="status" aria-live="polite" aria-atomic="true">' . esc_html__( 'Checking your payment status…', 'prism-simple-checkout' ) . '</p><button type="button" class="button" id="psc-recovery-check">' . esc_html__( 'Check payment status', 'prism-simple-checkout' ) . '</button> <a class="button" id="psc-recovery-retry" hidden>' . esc_html__( 'Try another payment method', 'prism-simple-checkout' ) . '</a></section>';
	}

	/**
	 * Pull canonical payment state on order-received when the callback outbox
	 * has not completed the Woo order yet. Reuses Completion::maybe_complete.
	 * Does not ack the outbox.
	 */
	public function maybe_pull_thankyou( $order_id ): void {
		if ( PSC_VERIFICATION_ONLY ) { return; }
		$order = wc_get_order( absint( $order_id ) );
		// FIX (1.0.10.0): remember the order so EVERY refusal below is recorded on the order
		// itself. Until now failure() only called wc_add_notice(), so a blocked payment left a
		// Pending order with no trace at all — which is why merchants report "stuck orders and
		// I have no error message". Field evidence: Puratek 2026-08-27, 132 Pending orders,
		// zero order notes explaining any of them.
		$this->psc_note_order = ( $order instanceof \WC_Order ) ? $order : null;
		if ( ! $order || PSC_GATEWAY_ID !== (string) $order->get_payment_method() ) {
			return;
		}
		if ( 'yes' === (string) $order->get_meta( Completion::META_COMPLETED, true ) ) {
			if ( $order->is_paid() ) { Rest_Routes::clear_matching_recovery( Completion::recovery_identity( $order ) ); }
			return;
		}
		$payment_id = (string) $order->get_meta( Completion::META_PAYMENT_ID, true );
		if ( '' === $payment_id ) {
			return;
		}
		if ( $order->get_meta( self::ORDER_CONFLICT_HOLD_META, true ) ) {
			return;
		}
		$result = Plugin::instance()->service_client()->get_payment( $payment_id );
		if ( is_wp_error( $result ) ) {
			return;
		}
		Service_Client::observe_fee( $result, $order, 'thankyou' );
		$guard = array(
			'claim_key'   => (string) $order->get_meta( Completion::META_CLAIM_KEY, true ),
			'owner_token' => (string) $order->get_meta( Completion::META_CLAIM_OWNER, true ),
			'fence'       => (int) $order->get_meta( Completion::META_CLAIM_FENCE, true ),
		);
		if ( Plugin::instance()->completion()->maybe_complete( $order, $result, $guard ) ) {
			Rest_Routes::clear_matching_recovery( Completion::recovery_identity( $order ) );
		}
	}
	public function init_form_fields() {
		$this->form_fields = array(
			'enabled' => array( 'title' => __( 'Enable/Disable', 'prism-simple-checkout' ), 'type' => 'checkbox', 'label' => __( 'Enable PRISM Simple Checkout', 'prism-simple-checkout' ), 'default' => 'no' ),
			'title' => array( 'title' => __( 'Title', 'prism-simple-checkout' ), 'type' => 'text', 'default' => __( 'PRISM Secure Checkout', 'prism-simple-checkout' ) ),
			'description' => array( 'title' => __( 'Description', 'prism-simple-checkout' ), 'type' => 'textarea', 'default' => '' ),
			'theme' => array(
				'title'   => __( 'Checkout theme', 'prism-simple-checkout' ),
				'type'    => 'select',
				'default' => 'auto',
				'desc_tip' => true,
				'description' => __( 'auto detects page background; light/dark force the PRISM shell skin and wordmark.', 'prism-simple-checkout' ),
				'options' => array(
					'auto'  => __( 'Auto (detect from page)', 'prism-simple-checkout' ),
					'light' => __( 'Light', 'prism-simple-checkout' ),
					'dark'  => __( 'Dark', 'prism-simple-checkout' ),
				),
			),
			'layout' => array(
				'title'   => __( 'Checkout layout', 'prism-simple-checkout' ),
				'type'    => 'select',
				'default' => 'wallet_first',
				'desc_tip' => true,
				'description' => __( 'Wallet-first puts PRISM and the express wallets at the top and reveals billing only for card payments. Standard keeps WooCommerce\'s usual order — customer details first, then PRISM, then the order review and payment. Express wallets are available in both.', 'prism-simple-checkout' ),
				'options' => array(
					'wallet_first' => __( 'Wallet-first (PRISM at top)', 'prism-simple-checkout' ),
					'standard'     => __( 'Standard (customer details first)', 'prism-simple-checkout' ),
				),
			),
		);
	}

	/** Sanitized merchant theme preference: auto|light|dark. */
	public function get_theme_preference(): string {
		$theme = strtolower( (string) $this->get_option( 'theme', 'auto' ) );
		return in_array( $theme, array( 'auto', 'light', 'dark' ), true ) ? $theme : 'auto';
	}
	/** Sanitized merchant layout preference: wallet_first|standard. */
	public function get_layout_preference(): string {
		return self::layout_preference();
	}
	/**
	 * Static reader for code paths without a gateway instance (Legal renders the shell on
	 * woocommerce_before_checkout_form). Reads the saved gateway option directly.
	 */
	public static function layout_preference(): string {
		$settings = get_option( 'woocommerce_' . PSC_GATEWAY_ID . '_settings', array() );
		$layout   = is_array( $settings ) ? strtolower( (string) ( $settings['layout'] ?? 'wallet_first' ) ) : 'wallet_first';
		return 'standard' === $layout ? 'standard' : 'wallet_first';
	}
	public function is_available() {
		if ( PSC_VERIFICATION_ONLY ) { return false; }
		return parent::is_available() && Credential_Store::is_configured();
	}
	public function enqueue_assets(): void {
		if ( PSC_VERIFICATION_ONLY ) { return; }
		if ( ! function_exists( 'is_checkout' ) || ! is_checkout() ) {
			return;
		}
		$css_ver = PSC_VERSION . '.' . (string) ( @filemtime( PSC_PLUGIN_DIR . 'assets/css/checkout.css' ) ?: 0 );
		$js_ver  = PSC_VERSION . '.' . (string) ( @filemtime( PSC_PLUGIN_DIR . 'assets/js/classic-checkout.js' ) ?: 0 );
		$ctl_ver = PSC_VERSION . '.' . (string) ( @filemtime( PSC_PLUGIN_DIR . 'assets/js/checkout-controller.js' ) ?: 0 );
		wp_enqueue_style( 'psc-checkout', PSC_PLUGIN_URL . 'assets/css/checkout.css', array(), $css_ver );
		wp_enqueue_script( 'stripe-js', 'https://js.stripe.com/v3/', array(), null, true );
		wp_enqueue_script( 'psc-checkout-controller', PSC_PLUGIN_URL . 'assets/js/checkout-controller.js', array(), $ctl_ver, true );
		wp_enqueue_script( 'psc-classic-checkout', PSC_PLUGIN_URL . 'assets/js/classic-checkout.js', array( 'jquery', 'stripe-js', 'psc-checkout-controller' ), $js_ver, true );
		$pay_order = Rest_Routes::pay_order_context();
		if ( is_wp_error( $pay_order ) ) { $pay_order = null; }
		wp_localize_script(
			'psc-classic-checkout',
			'pscCheckout',
			array(
				'ajaxUrl' => admin_url( 'admin-ajax.php' ), 'nonce' => wp_create_nonce( 'psc_checkout' ), 'gatewayId' => PSC_GATEWAY_ID,
				'fieldPolicy' => Plugin::instance()->field_policy()->native_surface_snapshot(),
				'recovery' => $this->recovery_context(),
				'fontUrl' => PSC_PLUGIN_URL . 'assets/fonts/inter-variable.woff2',
				'orderPay' => $pay_order ? array( 'orderId' => (int) $pay_order->get_id(), 'orderKey' => (string) $pay_order->get_order_key(), 'fields' => Rest_Routes::pay_order_fields( $pay_order ) ) : null,
				'theme' => $this->get_theme_preference(),
				'layout' => $this->get_layout_preference(),
			)
		);
	}
	public function payment_fields() {
		if ( '' !== $this->description ) {
			echo '<p class="psc-gateway-description">' . esc_html( $this->description ) . '</p>';
		}
		Plugin::instance()->legal()->render_checkout_fields();
	}
	public function validate_fields() {
		$pay_order = Rest_Routes::pay_order_context();
		if ( is_wp_error( $pay_order ) ) { wc_add_notice( $pay_order->get_error_message(), 'error' ); return false; }
		$email = $pay_order ? (string) $pay_order->get_billing_email() : sanitize_email( wp_unslash( (string) ( $_POST['billing_email'] ?? ( WC()->customer ? WC()->customer->get_billing_email() : '' ) ) ) );
		$evidence = Research_Checkout::payment_evidence( $email );
		if ( is_wp_error( $evidence ) ) { wc_add_notice( $evidence->get_error_message(), 'error' ); return false; }
		return true;
	}

	/** Order being processed, so failure() can record the refusal reason on it. */
	private $psc_note_order = null;
	public function process_payment( $order_id ) {
		if ( PSC_VERIFICATION_ONLY ) { return $this->failure( Research_Checkout::PAYMENT_DISABLED ); }
		if ( ! Lifecycle::allows_new_money() ) {
			return $this->failure( Lifecycle::NEW_MONEY_MESSAGE );
		}
		$order = wc_get_order( absint( $order_id ) );
		$this->psc_note_order = ( $order instanceof \WC_Order ) ? $order : null;
		if ( ! $order ) { return $this->failure( 'The order is unavailable.' ); }
		if ( $order->is_paid() ) { return array( 'result' => 'success', 'redirect' => $order->get_checkout_order_received_url() ); }
		$plugin = Plugin::instance();
		$data = self::payment_data();
		$attempt = $plugin->attempt_state()->get_attempt();
		$is_order_pay = ! empty( $attempt['woo_order_id'] ) || ( function_exists( 'is_wc_endpoint_url' ) && is_wc_endpoint_url( 'order-pay' ) );
		if ( $is_order_pay ) {
			$authorized = Rest_Routes::pay_order_context( (int) $order->get_id() );
			if ( is_wp_error( $authorized ) || (int) ( $attempt['woo_order_id'] ?? 0 ) !== (int) $order->get_id() ) { return $this->failure( is_wp_error( $authorized ) ? $authorized->get_error_message() : 'Payment does not belong to this order.' ); }
		}
		$fp = $is_order_pay ? Cart_Fingerprint::from_payment_order( $order ) : Cart_Fingerprint::from_cart();
		$evidence = Research_Checkout::payment_evidence( (string) $order->get_billing_email() );
		if ( is_wp_error( $evidence ) ) { return $this->failure( $evidence->get_error_message() ); }
		$legal = $evidence['legal']; $research = $evidence['record'];
		if ( ! $attempt || ! hash_equals( (string) ( $attempt['research_record_id'] ?? '' ), (string) $research['id'] ) || ! hash_equals( (string) ( $attempt['research_record_digest'] ?? '' ), (string) $research['digest'] ) ) {
			return $this->failure( 'Research verification changed. Complete verification again before payment.' );
		}

		if ( $order->get_meta( self::ORDER_CONFLICT_HOLD_META, true ) ) {
			return $this->failure( 'This payment session belongs to an earlier order. Please refresh the page and start checkout again.' );
		}
		// The cart fingerprint is the attempt's identity end to end: the service refuses any
		// changed fingerprint at confirm (409 attempt_invalidated), so a plugin-side pass-through
		// can never succeed. Refuse honestly here; the buyer's retry re-mints the attempt.
		if ( $plugin->attempt_state()->invalidate_if_fingerprint_changed( $fp, 'process_payment' ) ) {
			// This pre-confirm refusal must not strand its unbound claim. The existing
			// owner/fence check cannot release a claim already bound to an order.
			$plugin->checkout_claim()->release_unbound( (string) ( $attempt['claim_key'] ?? '' ), (string) ( $attempt['claim_owner'] ?? '' ), (int) ( $attempt['claim_fence'] ?? 0 ) );
			return $this->failure( Buyer_Copy::CART_STALE_PAY );
		}
		if ( ! $attempt ) {
			return $this->failure( 'Payment attempt is missing. Restart verification and try again.' );
		}
		if ( ! $legal ) {
			return $this->failure( 'Research-purchase attestation is missing. Accept the terms and try again.' );
		}
		$attempt_id = (string) ( $data['psc_attempt_id'] ?? '' );
		$operation = (string) ( $data['psc_operation_id'] ?? '' );
		$token = (string) ( $data['psc_confirmation_token'] ?? '' );
		if ( ! hash_equals( (string) $attempt['attempt_id'], $attempt_id ) || ! hash_equals( (string) $attempt['operation_id'], $operation ) || ! str_starts_with( $token, 'ctoken_' ) ) {
			return $this->failure( 'Payment details are incomplete or stale.' );
		}
		if ( Cart_Fingerprint::total_to_minor( (string) $order->get_total(), null, (string) $order->get_currency() ) !== (int) $attempt['amount_minor'] || strtolower( (string) $order->get_currency() ) !== strtolower( (string) $attempt['currency'] ) ) {
			return $this->failure( 'Order total changed before payment.' );
		}
		// Log-only tripwire: charged amount vs diagnostic display base (shipping math).
		// Under Fix A, Elements amount === amount_minor (charged). Mismatch base vs charged
		// with shipping present is expected; log both for ops when identity ever drifts.
		$charged_minor = (int) $attempt['amount_minor'];
		$ship_minor = $is_order_pay ? Cart_Fingerprint::total_to_minor( (string) ( (float) $order->get_shipping_total() + (float) $order->get_shipping_tax() ), null, (string) $order->get_currency() ) : Cart_Fingerprint::selected_shipping_minor_from_cart();
		$display_base = $is_order_pay ? max( 0, $charged_minor - $ship_minor ) : Cart_Fingerprint::wallet_display_base_minor_from_cart();
		$tripwire      = array(
			'event'                      => 'psc_wallet_amount_tripwire',
			'order_id'                   => (int) $order->get_id(),
			'charged_amount_minor'       => $charged_minor,
			'wallet_display_base_minor'  => $display_base,
			'selected_shipping_minor'    => $ship_minor,
			'elements_identity'          => 'amount_minor',
		);
		try {
			if ( function_exists( 'wc_get_logger' ) ) {
				wc_get_logger()->info(
					sprintf(
						'psc_wallet_amount_tripwire order=%d charged=%d display_base=%d shipping=%d',
						(int) $order->get_id(),
						$charged_minor,
						$display_base,
						$ship_minor
					),
					array_merge( array( 'source' => 'prism-simple-checkout' ), $tripwire )
				);
			}
		} catch ( \Throwable $e ) {
			unset( $e );
		}
		// S6: final order identity (email/address/items/coupons/total) must match attempt.
		// Attempts minted after this fix store identity_digest at create_attempt time.
		// Legacy session attempts without a digest skip this gate (total/currency still enforced).
		$stored_identity = (string) ( $attempt['identity_digest'] ?? '' );
		if ( '' !== $stored_identity ) {
			$order_identity = $is_order_pay ? Cart_Fingerprint::identity_digest( Cart_Fingerprint::payment_order_payload( $order ) ) : Cart_Fingerprint::identity_from_order( $order );
			if ( ! hash_equals( $stored_identity, $order_identity ) ) {
				return $this->failure( 'Order identity changed before payment. Refresh checkout and try again.' );
			}
		}
		$order->read_meta_data( true );
		$previous_attempt = (string) $order->get_meta( Completion::META_ATTEMPT_ID, true );
		$previous_payment = (string) $order->get_meta( Completion::META_PAYMENT_ID, true );
		if ( '' !== $previous_payment && ! hash_equals( $previous_attempt, $attempt_id ) ) {
			$identity = Completion::recovery_identity( $order );
			$prior_result = $plugin->service_client()->get_payment( $previous_payment );
			if ( is_array( $prior_result ) && 'succeeded' === (string) ( $prior_result['status'] ?? '' ) ) {
				$guard = array( 'claim_key' => $identity[ Completion::META_CLAIM_KEY ], 'owner_token' => $identity[ Completion::META_CLAIM_OWNER ], 'fence' => (int) $identity[ Completion::META_CLAIM_FENCE ] );
				if ( $plugin->completion()->maybe_complete( $order, $prior_result, $guard ) ) { return array( 'result' => 'success', 'redirect' => $order->get_checkout_order_received_url() ); }
			}
			$missing = is_wp_error( $prior_result ) && 404 === (int) ( ( (array) $prior_result->get_error_data() )['status'] ?? 0 );
			if ( ( is_wp_error( $prior_result ) && ! $missing ) || ! $plugin->completion()->finish_unpaid( $order, $identity, $missing ? null : $prior_result ) ) { return $this->failure( Buyer_Copy::CONFIRM_PENDING ); }
			$order = wc_get_order( (int) $order->get_id() );
			$order->read_meta_data( true );
			if ( Completion::recovery_identity( $order ) !== $identity ) { return $this->failure( Buyer_Copy::CONFIRM_PENDING ); }
		}

		$key = (string) $attempt['claim_key'];
		$owner = (string) $attempt['claim_owner'];
		$fence = (int) $attempt['claim_fence'];
		$claim = $plugin->checkout_claim();
		if ( ! $claim->bind_order( $key, $owner, $fence, (int) $order->get_id() ) ) {
			return $this->failure( 'Another checkout submission already owns this payment.' );
		}
		// H9: persist attempt/operation BEFORE confirm so poll can reconcile timeouts.
		$provisional_payment = hash_equals( $previous_attempt, $attempt_id ) && '' !== $previous_payment ? $previous_payment : 'pending_' . $attempt_id;
		if ( ! hash_equals( $previous_attempt, $attempt_id ) ) {
			// The previous decline is resolved; this bound attempt is now awaiting confirmation.
			if ( $order->has_status( 'failed' ) ) { $order->set_status( 'pending' ); }
			$order->update_meta_data( Reconciler::META_ATTEMPTS, 0 );
			$order->delete_meta_data( Reconciler::META_LAST );
			$order->delete_meta_data( Reconciler::META_GAVE_UP );
			$order->delete_meta_data( '_psc_terminal_attempt_id' );
			$order->update_meta_data( Reconciler::META_STARTED, gmdate( 'c' ) );
		}
		$meta = array(
			Completion::META_ATTEMPT_ID => $attempt_id,
			Completion::META_CART_FINGERPRINT => $fp,
			Completion::META_AMOUNT_MINOR => (int) $attempt['amount_minor'],
			Completion::META_CURRENCY => (string) $attempt['currency'],
			Completion::META_ACCOUNT => (string) $attempt['connected_account'],
			Completion::META_CLAIM_KEY => $key,
			Completion::META_CLAIM_OWNER => $owner,
			Completion::META_CLAIM_FENCE => $fence,
			Completion::META_PAYMENT_ID => $provisional_payment,
			'_psc_confirmation_operation_id' => $operation,
			'_psc_payment_mode' => (string) $attempt['service_mode'],
			'_psc_checkout_extension_fields' => $is_order_pay ? Cart_Fingerprint::payment_order_payload( $order )['extension_fields'] : Cart_Fingerprint::payload_from_cart()['extension_fields'],
		);
		foreach ( $meta as $name => $value ) {
			$order->update_meta_data( $name, $value );
		}
		Research_Checkout::attach_order_evidence( $order, $evidence );
		$order->save();
		// Preserve the exact research-record acceptance through confirmation and recovery.
		$result = $plugin->service_client()->confirm_checkout_attempt(
			$attempt_id,
			array(
				'operation_id' => $operation,
				'fence' => (int) $attempt['fence'],
				'confirmation_token' => $token,
				'cart_fingerprint' => $fp,
				'amount_minor' => (int) $attempt['amount_minor'],
				'currency' => (string) $attempt['currency'],
				'woo_order_id' => (int) $order->get_id(),
				'woo_order_key' => (string) $order->get_order_key(),
			)
		);
		if ( is_wp_error( $result ) ) {
			return $this->handle_confirm_error( $result, $order, $attempt, $plugin, $attempt_id, $operation );
		}
		if ( ! $this->response_matches( $attempt, $result ) ) {
			return $this->failure( 'Payment confirmation identity mismatch.' );
		}
		Service_Client::observe_fee( $result, $order, 'confirm' );
		Rest_Routes::clear_matching_pending( (int) $order->get_id(), $attempt_id, $operation );
		$order->update_meta_data( Completion::META_PAYMENT_ID, (string) $result['payment_id'] );
		$order->update_meta_data( Completion::META_FEE_MINOR, (int) $result['fee_minor'] );
		$order->update_meta_data( Completion::META_STATUS, (string) $result['status'] );
		if ( 'processing' === (string) $result['status'] && ! $order->has_status( array( 'on-hold', 'processing', 'completed' ) ) ) {
			$order->set_status( 'on-hold' );
			$order->add_order_note( 'Payment submitted and awaiting asynchronous settlement.' );
		}
		$order->save();
		if ( 'requires_action' === (string) $result['status'] && ! empty( $result['client_secret'] ) ) {
			WC()->session->set(
				'psc_recovery',
				array( 'orderId' => (int) $order->get_id(), 'orderKey' => (string) $order->get_order_key(), 'paymentId' => (string) $result['payment_id'], 'clientSecret' => (string) $result['client_secret'], 'publishableKey' => (string) $attempt['publishable_key'], 'connectedAccount' => (string) $attempt['connected_account'] )
			);
		}
		$status = (string) $result['status'];
		if ( in_array( $status, array( 'failed', 'canceled' ), true ) ) {
			$identity = Completion::recovery_identity( $order );
			if ( ! $plugin->completion()->finish_unpaid( $order, $identity, $result ) ) {
				WC()->session->set( 'psc_confirm_pending', array( 'order_id' => (int) $order->get_id(), 'attempt_id' => $attempt_id, 'operation_id' => $operation ) );
				return $this->failure( Buyer_Copy::CONFIRM_PENDING );
			}
			Rest_Routes::clear_matching_recovery( $identity );
			return $this->failure( Buyer_Copy::CARD_DECLINED );
		}

		if ( 'attention' === $status ) {
			// Treat as ambiguous — keep attempt + pending so retry reconciles.
			if ( function_exists( 'WC' ) && WC()->session ) {
				WC()->session->set(
					'psc_confirm_pending',
					array(
						'order_id'     => (int) $order->get_id(),
						'attempt_id'   => $attempt_id,
						'operation_id' => $operation,
					)
				);
			}
			$order->add_order_note( 'PRISM confirmation is pending service reconciliation.' );
			$order->save();
			return $this->failure( Buyer_Copy::CONFIRM_PENDING );
		}
		if ( 'succeeded' === $status ) {
			$completed = $plugin->completion()->maybe_complete(
				$order,
				$result,
				array( 'claim_key' => $key, 'owner_token' => $owner, 'fence' => $fence )
			);
			if ( ! $completed ) {
				// Audit #1: Stripe succeeded but Woo did not finish — hold recovery like attention.
				// Without psc_confirm_pending, cart edits can mint PI B while PI A is captured.
				if ( function_exists( 'WC' ) && WC()->session ) {
					WC()->session->set(
						'psc_confirm_pending',
						array(
							'order_id'     => (int) $order->get_id(),
							'attempt_id'   => $attempt_id,
							'operation_id' => $operation,
						)
					);
				}
				$order->add_order_note( 'PRISM payment succeeded at Stripe but Woo completion is pending reconciliation.' );
				$order->save();
				return $this->failure( 'Payment is still settling. Please refresh this page in a moment.' );
			}
			WC()->session->set( 'psc_checkout_cycle', null );
			WC()->session->set( 'psc_blocks_payment_data', null );
			$plugin->attempt_state()->clear_attempt();
			Rest_Routes::clear_matching_recovery( Completion::recovery_identity( $order ) );
			return array( 'result' => 'success', 'redirect' => $order->get_checkout_order_received_url() );
		}
		if ( in_array( $status, array( 'processing', 'creating', 'requires_action' ), true ) ) {
			WC()->session->set(
				'psc_confirm_pending',
				array(
					'order_id'     => (int) $order->get_id(),
					'attempt_id'   => $attempt_id,
					'operation_id' => $operation,
				)
			);
			WC()->session->set( 'psc_checkout_cycle', null );
			WC()->session->set( 'psc_blocks_payment_data', null );
			$plugin->attempt_state()->clear_attempt();
			return array( 'result' => 'success', 'redirect' => $order->get_checkout_order_received_url() );
		}
		return $this->failure( 'Payment could not be completed.' );
	}

	/**
	 * H8/H9: classify confirm failures — deterministic 4xx clean-reset vs ambiguous timeout.
	 *
	 * @param \WP_Error $result Service error.
	 * @param \WC_Order $order Order.
	 * @param array     $attempt Session attempt.
	 * @param Plugin    $plugin Plugin.
	 */
	private function handle_confirm_error( $result, $order, array $attempt, $plugin, string $attempt_id, string $operation ): array {
		$code   = $result->get_error_code();
		$data   = $result->get_error_data();
		$status = is_array( $data ) ? (int) ( $data['status'] ?? 0 ) : 0;
		$service_code = is_array( $data ) ? (string) ( $data['service_code'] ?? '' ) : '';
		if ( 'order_conflict' === $service_code ) {
			if ( function_exists( 'WC' ) && WC()->session ) {
				WC()->session->set(
					'psc_confirm_pending',
					array(
						'order_id'     => (int) $order->get_id(),
						'attempt_id'   => $attempt_id,
						'operation_id' => $operation,
						'hold_reason'  => 'order_conflict',
					)
				);
				WC()->session->set( 'psc_recovery', null );
			}
			$order->update_meta_data(
				self::ORDER_CONFLICT_HOLD_META,
				array(
					'attempt_id'   => $attempt_id,
					'operation_id' => $operation,
					'held_at'      => gmdate( 'c' ),
				)
			);
			$order->add_order_note( 'PRISM refused confirmation: this payment attempt is bound to a different order. Manual review required.' );
			$order->save();
			return $this->failure( 'This payment session belongs to an earlier order. Please refresh the page and start checkout again.' );
		}
		// Transport timeout / 5xx / provider_ambiguous → H9 path (do not mint a second PI).
		$ambiguous = ( 'psc_http_error' === $code )
			|| ( $status >= 500 )
			|| in_array( $status, array( 408, 409, 429 ), true )
			|| ( 0 === $status && 'psc_http_status' !== $code );
		if ( $ambiguous ) {
			if ( function_exists( 'WC' ) && WC()->session ) {
				WC()->session->set(
					'psc_confirm_pending',
					array(
						'order_id'     => (int) $order->get_id(),
						'attempt_id'   => $attempt_id,
						'operation_id' => $operation,
					)
				);
				WC()->session->set(
					'psc_recovery',
					array(
						'orderId'          => (int) $order->get_id(),
						'orderKey'         => (string) $order->get_order_key(),
						'paymentId'        => 'pending_' . $attempt_id,
						'publishableKey'   => (string) ( $attempt['publishable_key'] ?? '' ),
						'connectedAccount' => (string) ( $attempt['connected_account'] ?? '' ),
					)
				);
			}
			$order->add_order_note( 'PRISM confirmation is pending service reconciliation.' );
			$order->save();
			// Keep attempt + legal evidence for reconciliation (H8 legal survival + H9).
			return $this->failure( Buyer_Copy::CONFIRM_PENDING );
		}
		// Deterministic 4xx: clean reset so buyer can retry without reload (H8).
		$order->add_order_note( 'PRISM confirmation rejected (' . $status . '). Buyer may retry.' );
		$order->save();
		// F1: release decision FIRST — never rotate psc_checkout_cycle past a live claim.
		// F3 guard: a real PI on the order means an earlier confirm may have moved money.
		$identity = Completion::recovery_identity( $order );
		$released = $plugin->completion()->finish_unpaid( $order, $identity ) ? 'released' : 'busy';
		if ( 'busy' === $released ) {
			if ( function_exists( 'WC' ) && WC()->session ) {
				WC()->session->set(
					'psc_confirm_pending',
					array(
						'order_id'     => (int) $order->get_id(),
						'attempt_id'   => $attempt_id,
						'operation_id' => $operation,
					)
				);
			}
			$order->add_order_note( 'PRISM reject raced a live payment state — holding for reconciliation.' );
			$order->save();
			return $this->failure( Buyer_Copy::CONFIRM_PENDING );
		}
		// Released or gone: clear only this order/attempt's session recovery state.
		Rest_Routes::clear_matching_recovery( $identity );
		// Legal evidence intentionally kept so re-attest is not required.
		return $this->failure( Buyer_Copy::CARD_DECLINED );
	}
	public function process_refund( $order_id, $amount = null, $reason = '' ) {
		if ( PSC_VERIFICATION_ONLY ) { return new \WP_Error( 'psc_verification_only', Research_Checkout::PAYMENT_DISABLED ); }
		$order = wc_get_order( absint( $order_id ) );
		return $order ? Plugin::instance()->refunds()->process( $order, $amount, (string) $reason ) : new \WP_Error( 'psc_refund', 'Order not found.' );
	}
	public static function payment_data(): array {
		$data = function_exists( 'WC' ) && WC() && WC()->session ? WC()->session->get( 'psc_blocks_payment_data', array() ) : array();
		foreach ( array( 'psc_attest', 'psc_attempt_id', 'psc_operation_id', 'psc_confirmation_token' ) as $key ) {
			if ( isset( $_POST[ $key ] ) ) {
				$data[ $key ] = sanitize_text_field( wp_unslash( (string) $_POST[ $key ] ) );
			}
		}
		return is_array( $data ) ? $data : array();
	}
	private function response_matches( array $attempt, array $result ): bool {
		return hash_equals( (string) $attempt['attempt_id'], (string) $result['attempt_id'] )
			&& hash_equals( (string) $attempt['connected_account'], (string) $result['connected_account'] )
			&& (int) $attempt['amount_minor'] === (int) $result['amount_minor']
			&& hash_equals( strtolower( (string) $attempt['currency'] ), strtolower( (string) $result['currency'] ) );
	}
	private function failure( string $message ): array {
		wc_add_notice( __( $message, 'prism-simple-checkout' ), 'error' );
		// FIX (1.0.10.0): write the reason onto the order so the merchant can see, in the
		// order screen, exactly why a Pending order never took payment. Private note.
		try {
			if ( $this->psc_note_order instanceof \WC_Order ) {
				$this->psc_note_order->add_order_note( 'PRISM payment refused: ' . $message );
			}
		} catch ( \Throwable $e ) {
			unset( $e );
		}
		return array( 'result' => 'failure' );
	}
}
