<?php
namespace PrismSimpleCheckout;
defined( 'ABSPATH' ) || exit;
/** Nonce-protected buyer actions and the signed service callback. */
final class Rest_Routes {
	public const NAMESPACE = 'psc/v1';
	public function hooks(): void {
		if ( ! PSC_VERIFICATION_ONLY ) { add_action( 'rest_api_init', array( $this, 'register_rest' ) ); }
		$actions = array( 'otp_challenge', 'otp_verify', 'accept_legal', 'create_attempt', 'sync_wallet', 'poll_payment', 'express_bootstrap', 'device_hydrate' );
		if ( PSC_VERIFICATION_ONLY ) { $actions = array( 'otp_challenge', 'otp_verify', 'device_hydrate' ); }
		foreach ( $actions as $action ) {
			foreach ( array( 'wp_ajax_', 'wp_ajax_nopriv_' ) as $prefix ) {
				add_action( $prefix . 'psc_' . $action, array( $this, 'ajax_' . $action ) );
			}
		}
		if ( PSC_VERIFICATION_ONLY ) { return; }
		add_action( 'woocommerce_store_api_checkout_update_order_from_request', array( $this, 'capture_blocks_data' ), 10, 2 );
		add_action( 'woocommerce_checkout_update_order_review', array( $this, 'capture_classic_extensions' ), 20 );
	}
	public function register_rest(): void {
		if ( PSC_VERIFICATION_ONLY ) { return; }
		register_rest_route( self::NAMESPACE, '/callback', array( 'methods' => 'POST', 'callback' => array( $this, 'handle_callback' ), 'permission_callback' => '__return_true' ) );
	}
	public function capture_blocks_data( $order, $request ): void {
		$raw = is_object( $request ) && method_exists( $request, 'get_param' ) ? $request->get_param( 'payment_data' ) : array();
		$data = array();
		foreach ( is_array( $raw ) ? $raw : array() as $key => $value ) {
			if ( is_array( $value ) && isset( $value['key'] ) ) {
				$data[ (string) $value['key'] ] = sanitize_text_field( (string) ( $value['value'] ?? '' ) );
			} elseif ( is_string( $key ) ) {
				$data[ $key ] = sanitize_text_field( (string) $value );
			}
		}
		if ( WC()->session ) {
			WC()->session->set( 'psc_blocks_payment_data', $data );
		}
		$extensions = is_object( $request ) && method_exists( $request, 'get_param' ) ? $request->get_param( 'extensions' ) : array();
		if ( is_array( $extensions ) ) { Cart_Fingerprint::remember_extension_fields( (array) apply_filters( 'psc_fingerprint_extension_fields', $extensions, $extensions ) ); }
	}
	public function capture_classic_extensions( string $post_data ): void {
		parse_str( $post_data, $posted );
		$fields = array();
		if ( function_exists( 'WC' ) && WC() && method_exists( WC(), 'checkout' ) ) {
			foreach ( (array) WC()->checkout()->get_checkout_fields() as $group ) {
				foreach ( array_keys( (array) $group ) as $key ) {
					if ( isset( $posted[ $key ] ) && ! preg_match( '/^(billing|shipping)_/', (string) $key ) ) { $fields[ $key ] = $posted[ $key ]; }
				}
			}
		}
		Cart_Fingerprint::remember_extension_fields( (array) apply_filters( 'psc_fingerprint_extension_fields', $fields, $posted ) );
	}
	public function handle_callback( $request ) {
		if ( PSC_VERIFICATION_ONLY ) { return new \WP_REST_Response( array( 'error' => 'psc_verification_only', 'ok' => false ), 403 ); }
		$raw = (string) $request->get_body();
		$headers = array();
		foreach ( array( Service_Client::HEADER_SITE, Service_Client::HEADER_TIMESTAMP, Service_Client::HEADER_NONCE, Service_Client::HEADER_CONTRACT, Service_Client::HEADER_SIGNATURE ) as $name ) {
			$headers[ $name ] = $request->get_header( $name );
		}
		// Sign path must match what the service used (registered rest_url path + query).
		$sign_path = Service_Client::callback_sign_path();
		$verified = Plugin::instance()->service_client()->verify_callback( $raw, $headers, $sign_path );
		if ( is_wp_error( $verified ) ) {
			return new \WP_REST_Response( array( 'error' => $verified->get_error_code(), 'ok' => false ), 401 );
		}
		$data = json_decode( $raw, true );
		if ( ! $this->callback_valid( $data ) ) {
			return new \WP_REST_Response( array( 'error' => 'bad_schema', 'ok' => false ), 400 );
		}
		$creds = Credential_Store::get();
		if ( ! $creds || ! hash_equals( $creds['site_id'], (string) $data['site_id'] ) ) {
			return new \WP_REST_Response( array( 'error' => 'site_mismatch', 'ok' => false ), 403 );
		}
		$order = wc_get_order( (int) $data['woo_order_id'] );
		if ( ! $order || PSC_GATEWAY_ID !== (string) $order->get_payment_method() || ! hash_equals( hash( 'sha256', (string) $order->get_order_key() ), (string) $data['woo_order_key_hash'] ) ) {
			return new \WP_REST_Response( array( 'error' => 'order_mismatch', 'ok' => false ), 404 );
		}
		if ( $order->get_meta( Gateway::ORDER_CONFLICT_HOLD_META, true ) ) {
			return new \WP_REST_Response( array( 'error' => 'order_conflict_hold', 'ok' => false ), 409 );
		}
		Service_Client::observe_fee( (array) $data['payment'], $order, 'callback' );
		$guard = $this->guard_for_order( $order );
		$guard['outbox_id'] = (string) $data['outbox_id'];
		$done = Plugin::instance()->completion()->maybe_complete( $order, (array) $data['payment'], $guard );
		// Explicit ack body: service requires {"ok":true} before marking outbox delivered.
		return new \WP_REST_Response( array( 'ok' => (bool) $done ), $done ? 200 : 409 );
	}
	public function ajax_otp_challenge(): void {
		$this->nonce();
		$email = sanitize_email( wp_unslash( (string) ( $_POST['email'] ?? '' ) ) );
		if ( ! is_email( $email ) ) {
			wp_send_json_error( array( 'message' => 'Invalid billing email.' ), 400 );
		}
		$plugin = Plugin::instance();
		$prior = $plugin->attempt_state()->get_attempt();
		if ( $plugin->attempt_state()->invalidate_email( $email ) && $prior ) { $this->release_attempt( $prior ); }
		WC()->session->set( Research_Checkout::SESSION_RECORD, null );
		$result = Plugin::instance()->service_client()->create_otp_challenge( wp_generate_uuid4(), $email );
		if ( is_wp_error( $result ) ) {
			$mapped = Buyer_Copy::otp_challenge_error( $result );
			wp_send_json_error( array( 'code' => $mapped['code'], 'message' => $mapped['message'] ), $mapped['status'] );
		}
		$dispatch = (string) ( $result['dispatch_state'] ?? '' );
		if ( 'reserved' === $dispatch ) {
			wp_send_json_error(
				array(
					'code'           => 'otp_send_rejected',
					'message'        => Buyer_Copy::OTP_SEND_REJECTED,
					'dispatch_state' => 'reserved',
				),
				422
			);
		}
		wp_send_json_success(
			array(
				'challenge_id'   => $result['challenge_id'],
				'expires_at'     => $result['expires_at'],
				'dispatch_state' => $dispatch,
			)
		);
	}
	public function ajax_otp_verify(): void {
		$this->nonce();
		$state = Plugin::instance()->attempt_state();
		$prior_grant = $state->get_device_grant() ?: $state->read_device_cookie();
		$result = Plugin::instance()->service_client()->verify_otp(
			sanitize_text_field( wp_unslash( (string) ( $_POST['challenge_id'] ?? '' ) ) ),
			sanitize_text_field( wp_unslash( (string) ( $_POST['code'] ?? '' ) ) ),
			! empty( $_POST['remember_device'] ),
			$prior_grant
		);
		if ( is_wp_error( $result ) ) {
			$mapped = Buyer_Copy::otp_verify_error( $result );
			wp_send_json_error( array( 'code' => $mapped['code'], 'message' => $mapped['message'] ), $mapped['status'] );
		}
		$email = strtolower( sanitize_email( (string) ( $result['email'] ?? '' ) ) );
		if ( ! is_email( $email ) || ! WC()->customer ) {
			wp_send_json_error( array( 'message' => 'Verification response invalid.' ), 502 );
		}
		$prior = $state->get_attempt();
		if ( $state->invalidate_email( $email ) && $prior ) { $this->release_attempt( $prior ); }
		WC()->customer->set_billing_email( $email );
		WC()->customer->save();
		$state->set_email_verification( (string) $result['email_verification'], $email, (string) ( $result['expires_at'] ?? '' ) );
		if ( ! empty( $result['device_grant'] ) ) {
			$state->set_device_grant( (string) $result['device_grant'], $email );
		} elseif ( empty( $_POST['remember_device'] ) ) {
			$state->clear_device_cookie();
		}
		wp_send_json_success( array( 'email' => $email, 'expires_at' => $result['expires_at'], 'remembered' => ! empty( $result['device_grant'] ), 'researcher' => Research_Checkout::valid_record( $result['researcher'] ?? null, $email ) ? $result['researcher'] : null ) );
	}
	public function ajax_device_hydrate(): void {
		$this->nonce();
		$state = Plugin::instance()->attempt_state();
		$grant = $state->read_device_cookie() ?: $state->get_device_grant();
		if ( ! $grant ) {
			wp_send_json_success( array( 'remembered' => false ) );
		}
		$result = Plugin::instance()->service_client()->touch_device_grant( $grant );
		if ( is_wp_error( $result ) ) {
			$status = (int) ( is_array( $result->get_error_data() ) ? ( $result->get_error_data()['status'] ?? 0 ) : 0 );
			if ( 401 === $status ) {
				$state->clear_device_cookie();
			}
			wp_send_json_success( array( 'remembered' => false ) );
		}
		$email = strtolower( sanitize_email( (string) ( $result['email'] ?? '' ) ) );
		if ( ! is_email( $email ) ) {
			wp_send_json_success( array( 'remembered' => false ) );
		}
		$requested_email = strtolower( sanitize_email( wp_unslash( (string) ( $_POST['email'] ?? '' ) ) ) );
		if ( '' !== $requested_email && ! hash_equals( $email, $requested_email ) ) { wp_send_json_success( array( 'remembered' => false, 'researcher' => null ) ); }
		$state->set_device_grant( $grant, $email );
		wp_send_json_success( array( 'remembered' => true, 'email' => $email, 'researcher' => Research_Checkout::valid_record( $result['researcher'] ?? null, $email ) ? $result['researcher'] : null ) );
	}
	/** Null on a cart checkout; an authorized unpaid WC_Order on order-pay. */
	public static function pay_order_context( ?int $order_id = null, ?string $order_key = null ) {
		$id = $order_id ?? absint( $_POST['order_id'] ?? ( function_exists( 'get_query_var' ) ? get_query_var( 'order-pay', 0 ) : 0 ) );
		if ( $id < 1 ) { return null; }
		$key = $order_key ?? sanitize_text_field( wp_unslash( (string) ( $_POST['order_key'] ?? $_GET['key'] ?? '' ) ) );
		$order = wc_get_order( $id );
		if ( ! $order || '' === $key || ! hash_equals( (string) $order->get_order_key(), $key ) ) { return new \WP_Error( 'order_identity_mismatch', 'This payment link is invalid.' ); }
		$customer_id = (int) $order->get_customer_id();
		if ( $customer_id > 0 && $customer_id !== (int) get_current_user_id() ) { return new \WP_Error( 'order_login_required', 'Sign in to the account that owns this order.' ); }
		if ( ! $order->needs_payment() || $order->is_paid() ) { return new \WP_Error( 'order_not_payable', 'This order does not need payment.' ); }
		if ( $order->get_meta( Gateway::ORDER_CONFLICT_HOLD_META, true ) ) { return new \WP_Error( 'order_conflict', 'This order requires payment review before another attempt.' ); }
		return $order;
	}
	public static function pay_order_fields( $order ): array {
		$payload = Cart_Fingerprint::payment_order_payload( $order );
		$fields = array( 'billing_email' => (string) $payload['email'] );
		foreach ( array( 'billing', 'shipping' ) as $group ) {
			foreach ( (array) $payload[ $group ] as $key => $value ) { $fields[ $group . '_' . $key ] = $value; }
		}
		return $fields;
	}
	private static function pay_order_policy(): array {
		return array( 'native_fields_intact' => true, 'package_selections' => array(), 'hide_native_fields' => false, 'hide_extension_fields' => false, 'native_fallback' => false, 'wallet_populate_core' => false, 'needs_shipping' => false, 'phone_required' => false, 'shipping_rates' => array() );
	}

	public function ajax_accept_legal(): void {
		if ( PSC_VERIFICATION_ONLY ) { wp_send_json_error( array( 'code' => 'psc_verification_only', 'message' => Research_Checkout::PAYMENT_DISABLED ), 403 ); }
		$this->nonce();
		$order = self::pay_order_context();
		if ( is_wp_error( $order ) ) { wp_send_json_error( array( 'message' => $order->get_error_message() ), 403 ); }
		$email = $order ? (string) $order->get_billing_email() : ( WC()->customer ? (string) WC()->customer->get_billing_email() : '' );
		$evidence = Research_Checkout::payment_evidence( $email );
		if ( is_wp_error( $evidence ) ) { wp_send_json_error( array( 'code' => $evidence->get_error_code(), 'message' => $evidence->get_error_message() ), 400 ); }
		// Compatibility response only: acceptance comes from the saved record, never a new timestamp.
		wp_send_json_success( array( 'version' => $evidence['legal']['version'] ) );
	}

	public function ajax_create_attempt(): void {
		if ( PSC_VERIFICATION_ONLY ) { wp_send_json_error( array( 'code' => 'psc_verification_only', 'message' => Research_Checkout::PAYMENT_DISABLED ), 403 ); }
		$this->nonce();
		$this->replay_checkout_post_data();
		if ( ! Lifecycle::allows_new_money() ) {
			wp_send_json_error( array( 'message' => Lifecycle::NEW_MONEY_MESSAGE ), 503 );
		}
		$plugin = Plugin::instance();
		$pay_order = self::pay_order_context();
		if ( is_wp_error( $pay_order ) ) { wp_send_json_error( array( 'code' => $pay_order->get_error_code(), 'message' => $pay_order->get_error_message() ), 403 ); }
		$pending = function_exists( 'WC' ) && WC()->session ? WC()->session->get( 'psc_confirm_pending' ) : null;
		if ( is_array( $pending ) && ! empty( $pending['attempt_id'] ) ) {
			$resolved = $this->reconcile_pending_confirm( $pending );
			if ( is_wp_error( $resolved ) ) {
				wp_send_json_error( array( 'message' => $resolved->get_error_message() ), (int) ( $resolved->get_error_data()['status'] ?? 409 ) );
			}
			if ( is_array( $resolved ) && ! empty( $resolved['block_new'] ) ) {
				if ( ! empty( $resolved['paid'] ) ) {
					$oid = (int) ( $resolved['order_id'] ?? 0 );
					wp_send_json_error(
						array(
							'message' => $oid > 0
								? sprintf( 'Your previous payment completed — order #%d.', $oid )
								: 'Your previous payment completed. Check your order confirmation.',
							'paid'    => true,
							'order_id'=> $oid,
							'redirect'=> (string) ( $resolved['redirect'] ?? '' ),
						),
						409
					);
				}
				wp_send_json_error( array( 'message' => 'A previous payment confirmation is still settling. Wait or refresh order status before retrying.' ), 409 );
			}
			// Genuinely failed/cleared — fall through to create a fresh attempt.
		}
		if ( $pay_order && '' !== (string) $pay_order->get_meta( Completion::META_PAYMENT_ID, true ) ) {
			$resolved = $this->reconcile_pending_confirm( array( 'order_id' => (int) $pay_order->get_id(), 'attempt_id' => (string) $pay_order->get_meta( Completion::META_ATTEMPT_ID, true ), 'operation_id' => (string) $pay_order->get_meta( '_psc_confirmation_operation_id', true ) ) );
			if ( is_wp_error( $resolved ) || ( is_array( $resolved ) && ! empty( $resolved['block_new'] ) ) ) {
				wp_send_json_error( array( 'code' => 'payment_pending', 'message' => ( is_array( $resolved ) && ! empty( $resolved['paid'] ) ) ? 'This order has already been paid.' : Buyer_Copy::CONFIRM_PENDING, 'paid' => is_array( $resolved ) && ! empty( $resolved['paid'] ), 'redirect' => $pay_order->get_checkout_order_received_url() ), 409 );
			}
		}

		// Apply current checkout identity fields before fingerprinting. Classic forms often
		// leave first/last name and phone only in the DOM until place-order; without this,
		// create_attempt fingerprints empty names and process_payment invalidates the attempt.
		if ( ! $pay_order ) { $this->sync_customer_from_request(); $this->sync_blocks_extensions_from_request(); }
		$payload = $pay_order ? Cart_Fingerprint::payment_order_payload( $pay_order ) : Cart_Fingerprint::payload_from_cart();
		$fp = $pay_order ? Cart_Fingerprint::from_payment_order( $pay_order ) : Cart_Fingerprint::from_cart();
		$prior = $plugin->attempt_state()->get_attempt();
		if ( $plugin->attempt_state()->invalidate_if_fingerprint_changed( $fp, 'create_attempt' ) && $prior ) { $this->release_attempt( $prior ); }
		$email = strtolower( trim( (string) ( $payload['email'] ?? '' ) ) );
		$evidence = Research_Checkout::payment_evidence( $email );
		if ( is_wp_error( $evidence ) ) { wp_send_json_error( array( 'code' => $evidence->get_error_code(), 'message' => $evidence->get_error_message() ), 400 ); }
		$legal = $evidence['legal'];
		$research = $evidence['record'];
		// Per-cause gate failures (1.0.5) — never conflate email / OTP / attestation into one 400.
		if ( ! is_email( $email ) ) {
			wp_send_json_error(
				array(
					'code'    => 'invalid_billing_email',
					'message' => 'Enter a valid billing email before starting payment.',
				),
				400
			);
		}
		$verification = array();
		if ( $token = $plugin->attempt_state()->get_email_verification( $email ) ) {
			$verification['email_verification'] = $token;
		} elseif ( $grant = $plugin->attempt_state()->get_device_grant( $email ) ) {
			$verification['device_grant'] = $grant;
		} elseif ( $grant = $plugin->attempt_state()->read_device_cookie() ) {
			$verification['device_grant'] = $grant;
		}
		if ( ! $verification ) {
			$v_reason = $plugin->attempt_state()->verification_block_reason( $email );
			if ( 'email_mismatch' === $v_reason ) {
				wp_send_json_error(
					array(
						'code'    => 'email_mismatch',
						'message' => 'Billing email no longer matches the verified address. Re-verify the email on this order before payment.',
					),
					400
				);
			}
			wp_send_json_error(
				array(
					'code'    => 'email_verification_required',
					'message' => 'Verify your email with the one-time code before payment.',
				),
				400
			);
		}
		if ( ! $legal ) {
			wp_send_json_error(
				array(
					'code'    => 'attestation_required',
					'message' => 'Accept the research-purchase terms before payment.',
				),
				400
			);
		}

		// Never resurrect a stale session attempt after coupon/qty/shipping churn.
		// Fingerprint invalidation above covers most cases; also refuse reuse when
		// amount_minor or currency no longer match the live cart (defense in depth).
		// get_attempt() already drops expired attempts (H8).
		if ( $current = $plugin->attempt_state()->get_attempt() ) {
			$live_amount   = (int) $payload['amount_minor'];
			$live_currency = (string) $payload['currency'];
			$same_fp       = hash_equals( (string) ( $current['cart_fingerprint'] ?? '' ), $fp );
			$same_amount   = (int) ( $current['amount_minor'] ?? 0 ) === (int) $live_amount;
			$same_currency = strtolower( (string) ( $current['currency'] ?? '' ) ) === $live_currency;
			if ( $same_fp && $same_amount && $same_currency && hash_equals( (string) ( $current['research_record_id'] ?? '' ), (string) $research['id'] ) && hash_equals( (string) ( $current['research_record_digest'] ?? '' ), (string) $research['digest'] ) ) {
				wp_send_json_success( $this->public_attempt( $current ) );
			}
			$this->release_attempt( $current );
			$plugin->attempt_state()->clear_attempt();
		}
		$amount = (int) $payload['amount_minor'];
		if ( null === Service_Client::expected_fee_minor( $amount ) ) {
			wp_send_json_error(
				array(
					'code'    => 'invalid_cart_total',
					'message' => 'Invalid cart total.',
				),
				400
			);
		}
		$session = $pay_order ? 'order-pay:' . (int) $pay_order->get_id() : ( WC()->session ? (string) WC()->session->get_customer_id() : '' );
		$cycle = (string) WC()->session->get( 'psc_checkout_cycle', '' );
		if ( '' === $cycle ) { $cycle = wp_generate_uuid4(); WC()->session->set( 'psc_checkout_cycle', $cycle ); }
		$owner = wp_generate_password( 32, false, false );
		$key = $pay_order ? Checkout_Claim::make_key( $session, hash( 'sha256', $session ) ) : Checkout_Claim::make_key( $session . ':' . $cycle, $fp );
		$local = $plugin->checkout_claim()->acquire( $key, $owner, 180 );
		if ( empty( $local['ok'] ) ) {
			wp_send_json_error(
				array(
					'code'    => 'checkout_claim_busy',
					'message' => Buyer_Copy::CHECKOUT_CLAIM_BUSY,
				),
				409
			);
		}
		$result = $plugin->service_client()->create_checkout_attempt(
			array( 'request_id' => wp_generate_uuid4(), 'woo_session_id' => $session, 'email' => $email, 'verification' => $verification, 'legal' => $legal, 'research_record' => array( 'id' => $research['id'], 'digest' => $research['digest'] ), 'cart_fingerprint' => $fp, 'amount_minor' => $amount, 'currency' => (string) $payload['currency'], 'return_url' => $pay_order ? $pay_order->get_checkout_payment_url() : wc_get_checkout_url() )
		);
		if ( is_wp_error( $result ) || $amount !== (int) ( $result['amount_minor'] ?? 0 ) ) {
			// F6: do not leak the freshly acquired claim on a create error — release it so
			// the buyer's next attempt is not locked out for the 180s claim TTL (B2 non-USD).
			$plugin->checkout_claim()->release_unbound( $key, $owner, (int) $local['fence'] );
			$amount_mismatch = ! is_wp_error( $result ) && $amount !== (int) ( $result['amount_minor'] ?? 0 );
			$error_data = is_wp_error( $result ) ? $result->get_error_data() : array();
			$service_code = is_array( $error_data ) ? (string) ( $error_data['service_code'] ?? '' ) : '';
			if ( in_array( $service_code, array( 'declarations_expired', 'legal_expired', 'verification_required', 'email_verification_required', 'email_mismatch', 'research_verification_required' ), true ) ) {
				wp_send_json_error( array( 'code' => 'legal_expired' === $service_code ? 'declarations_expired' : ( 'verification_required' === $service_code ? 'email_verification_required' : $service_code ), 'message' => 'legal_expired' === $service_code || 'declarations_expired' === $service_code ? 'Please confirm the purchase declarations again to continue.' : 'Please confirm the email for this order again.' ), 400 );
			}
			wp_send_json_error(
				array(
					'code'    => $amount_mismatch ? 'attempt_amount_mismatch' : 'create_attempt_failed',
					'message' => $amount_mismatch
						? 'Payment amount no longer matches the cart total. Refresh and try again.'
						: Buyer_Copy::CREATE_ATTEMPT_FAILED,
				),
				502
			);
		}
		$operation = wp_generate_uuid4();
		$attempt = array_merge(
			$result,
			array(
				'cart_fingerprint'  => $fp,
				'identity_digest'   => Cart_Fingerprint::identity_digest( $payload ),
				'woo_order_id'      => $pay_order ? (int) $pay_order->get_id() : 0,
				'research_record_id' => $research['id'],
				'research_record_digest' => $research['digest'],
				'category_digests'  => Cart_Fingerprint::category_digests( $payload ),
				'address_field_digests' => Cart_Fingerprint::address_field_digests( $payload ),
				'email'             => $email,
				'operation_id'      => $operation,
				'claim_key'         => $key,
				'claim_owner'       => $owner,
				'claim_fence'       => (int) $local['fence'],
			)
		);
		$plugin->attempt_state()->store_attempt( $attempt );
		wp_send_json_success( $this->public_attempt( $attempt ) );
	}

	/**
	 * H9: Resolve an ambiguous confirm before allowing a new attempt.
	 *
	 * @param array<string,mixed> $pending Session pending record.
	 * @return array{block_new?:bool}|null|\WP_Error null/empty = cleared, may create new.
	 */
	private function reconcile_pending_confirm( array $pending ) {
		$order = wc_get_order( (int) ( $pending['order_id'] ?? 0 ) );
		if ( ! $order || 'order_conflict' === (string) ( $pending['hold_reason'] ?? '' ) || $order->get_meta( Gateway::ORDER_CONFLICT_HOLD_META, true ) ) { return array( 'block_new' => true ); }
		$order->read_meta_data( true );
		$identity = Completion::recovery_identity( $order );
		if ( ! hash_equals( (string) $identity[ Completion::META_ATTEMPT_ID ], (string) ( $pending['attempt_id'] ?? '' ) ) || ! hash_equals( (string) $identity['_psc_confirmation_operation_id'], (string) ( $pending['operation_id'] ?? '' ) ) ) { return array( 'block_new' => true ); }
		$payment_id = (string) $identity[ Completion::META_PAYMENT_ID ];
		if ( '' === $payment_id ) { return array( 'block_new' => true ); }
		$guard = $this->guard_for_order( $order );
		$result = Plugin::instance()->service_client()->get_payment( $payment_id );
		if ( is_wp_error( $result ) ) {
			$data = $result->get_error_data();
			if ( 404 === (int) ( is_array( $data ) ? ( $data['status'] ?? 0 ) : 0 ) ) { return $this->terminal_pending_cleanup( $order, $identity ); }
			return array( 'block_new' => true );
		}
		$order = wc_get_order( (int) $identity['order_id'] );
		if ( ! $order ) { return array( 'block_new' => true ); }
		$order->read_meta_data( true );
		if ( Completion::recovery_identity( $order ) !== $identity ) { return array( 'block_new' => true ); }
		Service_Client::observe_fee( $result, $order, 'reconcile' );
		$status = (string) ( $result['status'] ?? '' );
		if ( 'succeeded' === $status ) {
			if ( ! Plugin::instance()->completion()->maybe_complete( $order, $result, $guard ) ) { return array( 'block_new' => true ); }
			self::clear_matching_recovery( $identity );
			return array( 'block_new' => true, 'paid' => true, 'order_id' => (int) $order->get_id(), 'redirect' => $order->get_checkout_order_received_url() );
		}
		if ( in_array( $status, array( 'failed', 'canceled' ), true ) ) { return $this->terminal_pending_cleanup( $order, $identity, $result ); }
		return array( 'block_new' => true );
	}

	private function terminal_pending_cleanup( $order, array $identity, ?array $payment = null ) {
		if ( ! Plugin::instance()->completion()->finish_unpaid( $order, $identity, $payment ) ) { return array( 'block_new' => true ); }
		self::clear_matching_recovery( $identity );
		return null;
	}
	public static function clear_matching_recovery( array $identity ): void {
		if ( ! function_exists( 'WC' ) || ! WC()->session ) { return; }
		$session = WC()->session;
		$pending = $session->get( 'psc_confirm_pending' );
		$attempt = $session->get( Attempt_State::SESSION_ATTEMPT );
		$cleared = false;
		if ( is_array( $pending ) && (int) ( $pending['order_id'] ?? 0 ) === (int) $identity['order_id'] && hash_equals( (string) ( $pending['attempt_id'] ?? '' ), (string) $identity[ Completion::META_ATTEMPT_ID ] ) && hash_equals( (string) ( $pending['operation_id'] ?? '' ), (string) $identity['_psc_confirmation_operation_id'] ) ) {
			$session->set( 'psc_confirm_pending', null ); $cleared = true;
		}
		if ( is_array( $attempt ) && hash_equals( (string) ( $attempt['attempt_id'] ?? '' ), (string) $identity[ Completion::META_ATTEMPT_ID ] ) && hash_equals( (string) ( $attempt['operation_id'] ?? '' ), (string) $identity['_psc_confirmation_operation_id'] ) ) {
			Plugin::instance()->attempt_state()->clear_attempt(); $cleared = true;
		}
		$recovery = $session->get( 'psc_recovery' );
		if ( is_array( $recovery ) && (int) ( $recovery['orderId'] ?? 0 ) === (int) $identity['order_id'] && hash_equals( (string) ( $recovery['paymentId'] ?? '' ), (string) $identity[ Completion::META_PAYMENT_ID ] ) ) { $session->set( 'psc_recovery', null ); }
		if ( $cleared ) { $session->set( 'psc_checkout_cycle', null ); $session->set( 'psc_blocks_payment_data', null ); }
	}

	/**
	 * DIAGNOSTIC (log-only, 1.0.9.6): trace the wallet total at each step so a
	 * "Wallet total changed after authorization" failure can be root-caused from the
	 * WooCommerce logs. Paired with the bootstrap calculate_totals() fix in
	 * ajax_express_bootstrap(): the logs should now show bootstrap_pre ship=0 then
	 * bootstrap ship>0 (confirming the stale-total mechanism and that the fix took effect),
	 * and sync ship equal to bootstrap ship (no mid-sheet jump). The logging itself never
	 * alters checkout behavior or the charged amount.
	 */
	private function psc_diag_log( string $stage, array $money, array $extra = array() ): void {
		if ( ! function_exists( 'wc_get_logger' ) ) { return; }
		$amount = (int) ( $money['amount_minor'] ?? 0 );
		$base   = (int) ( $money['wallet_display_base_minor'] ?? 0 );
		$sess   = '';
		if ( function_exists( 'WC' ) && WC() && WC()->session && method_exists( WC()->session, 'get_customer_id' ) ) {
			$sess = substr( md5( (string) WC()->session->get_customer_id() ), 0, 10 );
		}
		$chosen = ( function_exists( 'WC' ) && WC() && WC()->session ) ? (array) WC()->session->get( 'chosen_shipping_methods', array() ) : array();
		$fp     = substr( (string) ( $money['cart_fingerprint'] ?? '' ), 0, 12 );
		try {
			wc_get_logger()->info(
				sprintf(
					'psc_wallet_diag stage=%s sess=%s amount=%d base=%d ship=%d chosen=%s fp=%s',
					$stage, $sess, $amount, $base, $amount - $base, implode( ',', array_map( 'strval', $chosen ) ), $fp
				),
				array_merge(
					array(
						'source'         => 'prism-simple-checkout',
						'event'          => 'psc_wallet_diag',
						'stage'          => $stage,
						'sess'           => $sess,
						'amount_minor'   => $amount,
						'base_minor'     => $base,
						'shipping_minor' => $amount - $base,
						'fingerprint'    => $fp,
						'chosen'         => implode( ',', array_map( 'strval', $chosen ) ),
					),
					$extra
				)
			);
		} catch ( \Throwable $e ) { /* diagnostic must never break checkout */ }
	}
	public function ajax_sync_wallet(): void {
		if ( PSC_VERIFICATION_ONLY ) { wp_send_json_error( array( 'code' => 'psc_verification_only', 'message' => Research_Checkout::PAYMENT_DISABLED ), 403 ); }
		$this->nonce();
		$pay_order = self::pay_order_context();
		if ( is_wp_error( $pay_order ) ) { wp_send_json_error( array( 'message' => $pay_order->get_error_message() ), 403 ); }
		if ( $pay_order ) { wp_send_json_success( array_merge( $this->order_money_payload( $pay_order ), array( 'shipping_rates' => array() ) ) ); }

		$this->replay_checkout_post_data();
		$fields = json_decode( wp_unslash( (string) ( $_POST['fields'] ?? '{}' ) ), true );
		$fields = is_array( $fields ) ? $fields : array();
		$allowed = array( 'billing_first_name', 'billing_last_name', 'billing_company', 'billing_address_1', 'billing_address_2', 'billing_city', 'billing_state', 'billing_postcode', 'billing_country', 'billing_phone', 'billing_email', 'shipping_first_name', 'shipping_last_name', 'shipping_company', 'shipping_address_1', 'shipping_address_2', 'shipping_city', 'shipping_state', 'shipping_postcode', 'shipping_country', 'shipping_phone' );
		$email = sanitize_email( (string) ( $fields['billing_email'] ?? WC()->customer->get_billing_email() ) );
		// FIX C, server side: ajax_sync_wallet is wallet-only by construction — a
		// wallet-provided email (Apple relay / hide-my-email / Link saved) never
		// replaces the session-verified identity, and must not wipe OTP evidence
		// via invalidate_email(). The native-edit re-verify path (create_attempt /
		// sync_customer_from_request) is intentionally unaffected. Field evidence:
		// Noverix 2026-08-12 — Link profile email overwrote verified billing email.
		$verified_email = strtolower( trim( (string) ( function_exists( 'WC' ) && WC() && WC()->session ? WC()->session->get( Attempt_State::SESSION_VERIFIED_EMAIL ) : '' ) ) );
		if ( '' !== $verified_email && '' !== $email && ! hash_equals( $verified_email, strtolower( $email ) ) ) {
			$email = $verified_email;
		}
		$plugin = Plugin::instance();
		$prior = $plugin->attempt_state()->get_attempt();
		if ( $plugin->attempt_state()->invalidate_email( $email ) && $prior ) { $this->release_attempt( $prior ); }
		if ( '' !== $email ) {
			$fields['billing_email'] = $email;
		}
		$ship_parts = array( 'first_name', 'last_name', 'company', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country', 'phone' );
		if ( isset( $_POST['ship_to_different_address'] ) ) {
			$ship_flag = wp_unslash( (string) $_POST['ship_to_different_address'] );
		} else {
			$shipping_nonempty = false;
			$shipping_differs  = false;
			foreach ( $ship_parts as $field ) {
				$ship_key = 'shipping_' . $field;
				if ( ! array_key_exists( $ship_key, $fields ) ) {
					continue;
				}
				$ship_val = trim( (string) $fields[ $ship_key ] );
				if ( '' !== $ship_val ) {
					$shipping_nonempty = true;
				}
				$bill_key = 'billing_' . $field;
				if ( array_key_exists( $bill_key, $fields ) ) {
					$bill_val = trim( (string) $fields[ $bill_key ] );
				} else {
					$bill_val = trim( (string) WC()->customer->{ 'get_billing_' . $field }() );
				}
				if ( $ship_val !== $bill_val ) {
					$shipping_differs = true;
				}
			}
			if ( $shipping_nonempty && $shipping_differs ) {
				$ship_flag = '1';
			} else {
				$ship_flag = (string) ( WC()->session ? WC()->session->get( 'ship_to_different_address', '' ) : '' );
			}
		}
		Address_Canonical::apply_posted_to_customer( $fields, $ship_flag );
		$rate = sanitize_text_field( wp_unslash( (string) ( $_POST['shipping_method'] ?? '' ) ) );
		if ( '' !== $rate ) {
			WC()->session->set( 'chosen_shipping_methods', array( $rate ) );
		}
		WC()->cart->calculate_shipping();
		WC()->cart->calculate_totals();
		$fingerprint = Cart_Fingerprint::from_cart();
		if ( $plugin->attempt_state()->invalidate_if_fingerprint_changed( $fingerprint, 'sync_wallet' ) && $prior ) { $this->release_attempt( $prior ); }
		$money = $this->cart_money_payload( $fingerprint );
		$this->psc_diag_log( 'sync', $money, array( 'rate' => $rate, 'ship_flag' => (string) $ship_flag ) );
		wp_send_json_success(
			array_merge(
				$money,
				array( 'shipping_rates' => Plugin::instance()->field_policy()->shipping_rates_for_wallet() )
			)
		);
	}
	public function ajax_express_bootstrap(): void {
		if ( PSC_VERIFICATION_ONLY ) { wp_send_json_error( array( 'code' => 'psc_verification_only', 'message' => Research_Checkout::PAYMENT_DISABLED ), 403 ); }
		$this->nonce();
		$this->replay_checkout_post_data();
		$pay_order = self::pay_order_context();
		if ( is_wp_error( $pay_order ) ) { wp_send_json_error( array( 'code' => $pay_order->get_error_code(), 'message' => $pay_order->get_error_message() ), 403 ); }
		if ( $pay_order ) {
			$surface = Plugin::instance()->service_client()->fetch_express_surface();
			if ( is_wp_error( $surface ) ) { wp_send_json_error( array( 'message' => 'Could not load payment options.' ), 502 ); }
			$mode = (string) ( $surface['service_mode'] ?? '' ); $pk = (string) ( $surface['publishable_key'] ?? '' );
			if ( ! ( ( 'test' === $mode && str_starts_with( $pk, 'pk_test_' ) ) || ( 'production' === $mode && str_starts_with( $pk, 'pk_live_' ) ) ) ) { wp_send_json_error( array( 'message' => 'Invalid payment configuration.' ), 502 ); }
			wp_send_json_success( array_merge( $surface, $this->order_money_payload( $pay_order ), array( 'needs_payment' => true, 'field_policy' => self::pay_order_policy() ) ) );
		}

		if ( ! function_exists( 'WC' ) || ! WC()->cart || WC()->cart->is_empty() ) {
			wp_send_json_error( array( 'message' => 'Cart is empty.' ), 400 );
		}
		// Calculate shipping in THIS request before snapshotting rates for Express mount.
		// WC()->shipping()->get_packages() is request-scoped and empty until calculate_shipping()
		// runs — without this, Apple Pay mounts with shippingRates: [] and shows display base only.
		WC()->cart->calculate_shipping();
		if ( ! WC()->cart->needs_payment() && 0 === Cart_Fingerprint::amount_minor_from_cart() ) {
			wp_send_json_success( array_merge( $this->cart_money_payload( Cart_Fingerprint::from_cart() ), array(
				'needs_payment' => false, 'field_policy' => Plugin::instance()->field_policy()->native_surface_snapshot(),
			) ) );
		}
		// DIAGNOSTIC (1.0.9.6): capture the pre-finalize total to prove the stale-total mechanism.
		// Before the fix below, amount_minor_from_cart() returned WC()->cart->get_total(), which reflects
		// only the last calculate_totals() — a cached session snapshot that can predate shipping.
		$psc_pre_amount = Cart_Fingerprint::amount_minor_from_cart();
		$psc_pre_base   = Cart_Fingerprint::wallet_display_base_minor_from_cart();
		// 1.0.8 LAW: bootstrap never runs calculate_totals() — it returns WooCommerce's authoritative
		// session total (dynamic-pricing / AJAX-priced carts). Only shipping is refreshed here.
		$surface = Plugin::instance()->service_client()->fetch_express_surface();
		if ( is_wp_error( $surface ) ) {
			wp_send_json_error( array( 'message' => 'Could not load wallets.' ), 502 );
		}
		$mode = (string) ( $surface['service_mode'] ?? '' );
		$pk   = (string) ( $surface['publishable_key'] ?? '' );
		$mode_ok = ( 'test' === $mode && str_starts_with( $pk, 'pk_test_' ) )
			|| ( 'production' === $mode && str_starts_with( $pk, 'pk_live_' ) );
		if ( ! $mode_ok ) {
			wp_send_json_error( array( 'message' => 'Invalid wallet configuration.' ), 502 );
		}
		$amount = Cart_Fingerprint::amount_minor_from_cart();
		if ( $amount <= 0 ) {
			wp_send_json_error( array( 'message' => 'Invalid cart total.' ), 400 );
		}
		// Pre-fix snapshot (stale total) then post-fix (finalized). If the fix took effect the logs
		// show bootstrap_pre ship=0 followed by bootstrap ship>0 for the same session/fingerprint.
		$this->psc_diag_log( 'bootstrap_pre', array(
			'amount_minor'              => (int) $psc_pre_amount,
			'wallet_display_base_minor' => (int) $psc_pre_base,
			'cart_fingerprint'          => '',
		) );
		$this->psc_diag_log( 'bootstrap', array(
			'amount_minor'              => $amount,
			'wallet_display_base_minor' => Cart_Fingerprint::wallet_display_base_minor_from_cart(),
			'cart_fingerprint'          => Cart_Fingerprint::from_cart(),
		) );
		wp_send_json_success( array_merge(
			array(
				'publishable_key'   => (string) $surface['publishable_key'],
				'needs_payment'     => true,
				'connected_account' => (string) $surface['connected_account'],
				'service_mode'      => $mode,
				'field_policy'      => Plugin::instance()->field_policy()->native_surface_snapshot(),
			),
			$this->cart_money_payload( Cart_Fingerprint::from_cart() )
		) );
	}
	public function ajax_poll_payment(): void {
		if ( PSC_VERIFICATION_ONLY ) { wp_send_json_error( array( 'code' => 'psc_verification_only', 'message' => Research_Checkout::PAYMENT_DISABLED ), 403 ); }
		$this->nonce();
		$order = wc_get_order( absint( $_POST['order_id'] ?? 0 ) );
		$key = sanitize_text_field( wp_unslash( (string) ( $_POST['order_key'] ?? '' ) ) );
		$payment_id = sanitize_text_field( wp_unslash( (string) ( $_POST['payment_id'] ?? '' ) ) );
		if ( ! $order || ! hash_equals( (string) $order->get_order_key(), $key ) || ! hash_equals( (string) $order->get_meta( Completion::META_PAYMENT_ID, true ), $payment_id ) ) {
			wp_send_json_error( array( 'message' => 'Order identity mismatch.' ), 403 );
		}
		if ( $order->get_meta( Gateway::ORDER_CONFLICT_HOLD_META, true ) ) {
			wp_send_json_error( array( 'message' => 'This payment session belongs to an earlier order. Please refresh the page and start checkout again.' ), 409 );
		}
		$identity = Completion::recovery_identity( $order );
		$guard = $this->guard_for_order( $order );
		$result = Plugin::instance()->service_client()->get_payment( $payment_id );
		if ( is_wp_error( $result ) ) {
			wp_send_json_error( array( 'code' => 'poll_unavailable', 'message' => Buyer_Copy::POLL_UNAVAILABLE ), 502 );
		}
		$order = wc_get_order( (int) $identity['order_id'] );
		if ( ! $order ) { wp_send_json_error( array( 'message' => Buyer_Copy::POLL_UNAVAILABLE ), 409 ); }
		$order->read_meta_data( true );
		if ( Completion::recovery_identity( $order ) !== $identity ) { wp_send_json_error( array( 'message' => 'The order payment has changed. Refresh order status.' ), 409 ); }
		Service_Client::observe_fee( $result, $order, 'poll' );
		$completed = false;
		$retry_allowed = false;
		$status = (string) ( $result['status'] ?? '' );
		if ( 'succeeded' === $status ) {
			$completed = Plugin::instance()->completion()->maybe_complete( $order, $result, $guard );
		} elseif ( in_array( $status, array( 'failed', 'canceled' ), true ) ) {
			$retry_allowed = null === $this->terminal_pending_cleanup( $order, $identity, $result );
		}
		$fresh = wc_get_order( (int) $order->get_id() );
		$completed = $completed && $fresh && $fresh->is_paid();
		$response = array( 'payment_id' => $payment_id, 'status' => $status, 'completed' => $completed );
		if ( $completed ) {
			self::clear_matching_recovery( $identity );
			$response['redirect'] = $fresh->get_checkout_order_received_url();
		} elseif ( $retry_allowed && $fresh && ! $fresh->is_paid() && $fresh->needs_payment()
			&& Completion::recovery_identity( $fresh ) === $identity ) {
			$response['retry_url'] = $fresh->get_checkout_payment_url();
		} elseif ( 'requires_action' === $status && ! empty( $result['client_secret'] ) ) {
			$saved = WC()->session ? WC()->session->get( 'psc_recovery' ) : null;
			$surface = is_array( $saved ) && (int) ( $saved['orderId'] ?? 0 ) === (int) $identity['order_id']
				&& hash_equals( (string) ( $saved['paymentId'] ?? '' ), $payment_id ) && ! empty( $saved['publishableKey'] )
				? array( 'publishable_key' => $saved['publishableKey'], 'connected_account' => $saved['connectedAccount'] ?? '' )
				: Plugin::instance()->service_client()->fetch_express_surface();
			if ( ! is_wp_error( $surface ) && hash_equals( (string) ( $surface['connected_account'] ?? '' ), (string) $identity[ Completion::META_ACCOUNT ] ) ) {
				$response['client_secret'] = (string) $result['client_secret'];
				$response['publishable_key'] = (string) $surface['publishable_key'];
				$response['connected_account'] = (string) $surface['connected_account'];
			}
		}
		wp_send_json_success( $response );
	}
	private function callback_valid( $data ): bool {
		$top = array( 'outbox_id', 'site_id', 'woo_order_id', 'woo_order_key_hash', 'payment' );
		if ( ! is_array( $data ) || array_diff( $top, array_keys( $data ) ) || array_diff( array_keys( $data ), $top ) || ! preg_match( '/^[0-9a-f-]{36}$/i', (string) $data['outbox_id'] ) || ! preg_match( '/^[0-9a-f-]{36}$/i', (string) $data['site_id'] ) || ! preg_match( '/^[a-f0-9]{64}$/', (string) $data['woo_order_key_hash'] ) || ! is_int( $data['woo_order_id'] ) || $data['woo_order_id'] < 1 || ! is_array( $data['payment'] ) ) {
			return false;
		}
		$required = array( 'payment_id', 'attempt_id', 'connected_account', 'status', 'amount_minor', 'fee_minor', 'currency' );
		$optional = array( 'application_fee_id', 'client_secret', 'next_action_required' );
		$p = $data['payment'];
		return ! array_diff( $required, array_keys( $p ) ) && ! array_diff( array_keys( $p ), array_merge( $required, $optional ) )
			&& is_string( $p['payment_id'] ) && '' !== $p['payment_id'] && preg_match( '/^[0-9a-f-]{36}$/i', (string) $p['attempt_id'] ) && str_starts_with( (string) $p['connected_account'], 'acct_' )
			&& in_array( $p['status'], array( 'creating', 'requires_action', 'processing', 'succeeded', 'failed', 'canceled', 'attention' ), true )
			&& is_int( $p['amount_minor'] ) && $p['amount_minor'] > 0 && is_int( $p['fee_minor'] ) && $p['fee_minor'] >= 0 && preg_match( '/^[a-z]{3}$/', (string) $p['currency'] );
	}
	private function guard_for_order( $order ): array {
		return array( 'claim_key' => (string) $order->get_meta( Completion::META_CLAIM_KEY, true ), 'owner_token' => (string) $order->get_meta( Completion::META_CLAIM_OWNER, true ), 'fence' => (int) $order->get_meta( Completion::META_CLAIM_FENCE, true ) );
	}
	private function release_attempt( array $attempt ): void {
		Plugin::instance()->checkout_claim()->release_unbound( (string) ( $attempt['claim_key'] ?? '' ), (string) ( $attempt['claim_owner'] ?? '' ), (int) ( $attempt['claim_fence'] ?? 0 ) );
	}
	private function public_attempt( array $attempt ): array {
		$out = array();
		foreach ( array( 'attempt_id', 'operation_id', 'publishable_key', 'connected_account', 'amount_minor', 'currency', 'expires_at', 'cart_fingerprint' ) as $key ) { $out[ $key ] = $attempt[ $key ] ?? ''; }
		$out['amount_minor'] = (int) ( $out['amount_minor'] ?? 0 );
		$order = ! empty( $attempt['woo_order_id'] ) ? self::pay_order_context( (int) $attempt['woo_order_id'] ) : null;
		if ( is_wp_error( $order ) ) { wp_send_json_error( array( 'code' => $order->get_error_code(), 'message' => $order->get_error_message() ), 403 ); }
		$out['wallet_display_base_minor'] = $order ? (int) $attempt['amount_minor'] : Cart_Fingerprint::wallet_display_base_minor_from_cart();
		$out['field_policy'] = $order ? self::pay_order_policy() : Plugin::instance()->field_policy()->native_surface_snapshot();
		$payload = $order ? Cart_Fingerprint::payment_order_payload( $order ) : Cart_Fingerprint::payload_from_cart();
		$out['billing']  = (array) ( $payload['billing'] ?? array() );
		$out['shipping'] = (array) ( $payload['shipping'] ?? array() );
		$out['email']    = (string) ( $payload['email'] ?? '' );
		return $out;
	}

	/**
	 * Money + diagnostic display base for bootstrap/sync/attempt surfaces.
	 * amount_minor is always the full Woo total (PI/fee truth AND Elements amount).
	 * wallet_display_base_minor is diagnostic only — never the Stripe Elements amount.
	 *
	 * @return array{amount_minor:int,wallet_display_base_minor:int,currency:string,cart_fingerprint:string}
	 */
	private function order_money_payload( $order ): array {
		$payload = Cart_Fingerprint::payment_order_payload( $order );
		return array( 'amount_minor' => (int) $payload['amount_minor'], 'wallet_display_base_minor' => (int) $payload['amount_minor'], 'currency' => (string) $payload['currency'], 'cart_fingerprint' => Cart_Fingerprint::from_payment_order( $order ), 'billing' => $payload['billing'], 'shipping' => $payload['shipping'], 'email' => $payload['email'] );
	}

	private function cart_money_payload( string $fingerprint ): array {
		return array(
			'amount_minor'               => Cart_Fingerprint::amount_minor_from_cart(),
			'wallet_display_base_minor'  => Cart_Fingerprint::wallet_display_base_minor_from_cart(),
			'currency'                   => strtolower( (string) get_woocommerce_currency() ),
			'cart_fingerprint'           => $fingerprint,
		);
	}
	/**
	 * FIX (1.0.10.1): make PRISM's cart calculation faithful to the real checkout submission.
	 *
	 * Replays the posted checkout form into $_POST and fires the canonical hook that
	 * conditional-fee plugins listen to, so the fees present when PRISM fingerprints the cart
	 * are the same fees WooCommerce will apply when it processes the order. Without this a
	 * checkout fee is missing at authorization and present at capture, the totals disagree,
	 * and a legitimate payment is refused.
	 *
	 * Classic only by construction: Blocks carries its own extension payload through the
	 * Store API, and no post_data is sent there, so this is inert for Blocks.
	 * Kill switch: add_filter( 'psc_replay_checkout_post_data', '__return_false' );
	 */
	private function replay_checkout_post_data(): void {
		if ( ! empty( $_POST['order_id'] ) ) { return; }
		// FIX (1.0.10.2): present this request as a CHECKOUT context before any totals are
		// calculated. Conditional-fee plugins (shipping protection, insurance, tips) only add
		// their fee during checkout — they gate on WOOCOMMERCE_CHECKOUT / is_checkout(), which
		// are false inside a plain admin-ajax request. Recalculating totals without this DROPS
		// their fee from the cart, so PRISM locked a total that was missing the fee and Woo
		// re-added it at capture. This is the same line WooCommerce's own update_order_review
		// AJAX runs for exactly this reason.
		// Field evidence (Puratek 2026-08-27T21:47:21Z, one second apart, same session):
		//   stage=bootstrap_pre amount=2143  (fee present)
		//   stage=bootstrap     amount=2094  (fee dropped by the recalculation)
		if ( function_exists( 'wc_maybe_define_constant' ) ) {
			wc_maybe_define_constant( 'WOOCOMMERCE_CHECKOUT', true );
		} elseif ( ! defined( 'WOOCOMMERCE_CHECKOUT' ) ) {
			define( 'WOOCOMMERCE_CHECKOUT', true );
		}
		if ( ! isset( $_POST['post_data'] ) || ! is_string( $_POST['post_data'] ) ) {
			return;
		}
		if ( ! apply_filters( 'psc_replay_checkout_post_data', true ) ) {
			return;
		}
		$raw = wp_unslash( (string) $_POST['post_data'] );
		if ( '' === $raw ) {
			return;
		}
		$posted = array();
		parse_str( $raw, $posted );
		if ( ! is_array( $posted ) || ! $posted ) {
			return;
		}
		// Never clobber PRISM's own request keys (action, nonce, fields, ship_to_different_address).
		foreach ( $posted as $key => $value ) {
			if ( ! array_key_exists( $key, $_POST ) ) {
				$_POST[ $key ] = $value;
			}
		}
		try {
			do_action( 'woocommerce_checkout_update_order_review', $raw );
		} catch ( \Throwable $e ) {
			unset( $e );
		}
	}
	private function nonce(): void {
		$nonce = sanitize_text_field( wp_unslash( (string) ( $_REQUEST['nonce'] ?? $_POST['nonce'] ?? '' ) ) );
		if ( ! wp_verify_nonce( $nonce, 'psc_checkout' ) ) {
			wp_send_json_error( array( 'code' => 'invalid_nonce', 'message' => Buyer_Copy::INVALID_NONCE ), 403 );
		}
		{
			if ( function_exists( 'wc_load_cart' ) && ( ! WC()->session || ! WC()->customer ) ) { wc_load_cart(); }
			if ( ! WC()->session || ! WC()->customer ) { wp_send_json_error( array( 'message' => 'Your verification session is unavailable. Reload this page.' ), 503 ); }
			WC()->session->set_customer_session_cookie( true );
		}
	}
	/** Store the Blocks extension snapshot before creating its evidence-bound fingerprint. */
	private function sync_blocks_extensions_from_request(): void {
		if ( ! array_key_exists( 'blocks_extensions', $_POST ) ) {
			return;
		}
		$raw = $_POST['blocks_extensions'];
		if ( ! is_string( $raw ) ) {
			wp_send_json_error( array( 'message' => 'Invalid checkout extension data.' ), 400 );
		}
		$decoded = json_decode( wp_unslash( $raw ), true );
		if ( JSON_ERROR_NONE !== json_last_error() || ! is_array( $decoded ) ) {
			wp_send_json_error( array( 'message' => 'Invalid checkout extension data.' ), 400 );
		}
		// Match Store API validation and normalization before hashing. Its registered
		// schema can expand an empty object (for example, order-attribution fields).
		try {
			$schema = \Automattic\WooCommerce\StoreApi\StoreApi::container()->get( \Automattic\WooCommerce\StoreApi\SchemaController::class )->get( 'checkout' );
			$args = $schema->get_endpoint_args_for_item_schema( \WP_REST_Server::CREATABLE );
			$request = new \WP_REST_Request( 'POST', '/wc/store/v1/checkout' );
			$request->set_attributes( array( 'args' => array( 'extensions' => $args['extensions'] ) ) );
			$request->set_param( 'extensions', $decoded );
			$result = $request->has_valid_params();
			if ( ! is_wp_error( $result ) ) { $result = $request->sanitize_params(); }
		} catch ( \Throwable $e ) {
			wp_send_json_error( array( 'message' => 'Checkout extension validation is unavailable. Reload and try again.' ), 503 );
		}
		if ( is_wp_error( $result ) ) { wp_send_json_error( array( 'code' => $result->get_error_code(), 'message' => $result->get_error_message() ), 400 ); }
		$decoded = (array) $request->get_param( 'extensions' );
		Cart_Fingerprint::remember_extension_fields( (array) apply_filters( 'psc_fingerprint_extension_fields', $decoded, $decoded ) );
	}
	/** Sync form identity into WC customer before fingerprinting (Woo Pay transforms). */
	private function sync_customer_from_request(): void {
		if ( ! WC()->customer ) { return; }
		$raw = array();
		if ( isset( $_POST['fields'] ) ) {
			$decoded = json_decode( wp_unslash( (string) $_POST['fields'] ), true );
			$raw = is_array( $decoded ) ? $decoded : array();
		}
		foreach ( Address_Canonical::field_keys() as $name ) {
			if ( array_key_exists( $name, $raw ) ) {
				continue;
			}
			if ( isset( $_POST[ $name ] ) ) {
				$raw[ $name ] = wp_unslash( (string) $_POST[ $name ] );
			}
		}
		$ship_flag = isset( $_POST['ship_to_different_address'] ) ? wp_unslash( (string) $_POST['ship_to_different_address'] ) : (string) ( WC()->session ? WC()->session->get( 'ship_to_different_address', '' ) : '' );
		Address_Canonical::apply_posted_to_customer( $raw, $ship_flag );
	}
}
