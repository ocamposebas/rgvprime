<?php
namespace PrismSimpleCheckout;
defined( 'ABSPATH' ) || exit;
/** Frozen legal text and record-bound acceptance, including authenticated saved acceptance. */
final class Legal {
	public const SESSION_EVIDENCE = 'psc_legal_evidence';

	/** @var bool Whether the big checkout shell was printed this request. */
	private $checkout_fields_rendered = false;

	public function hooks(): void {
		add_filter( 'woocommerce_checkout_show_terms', array( $this, 'suppress_native_terms' ) );
		// When PSC owns checkout assent: real removal of CSF csf_ruo field + validation (not CSS hide).
		add_filter( 'woocommerce_checkout_fields', array( $this, 'strip_csf_ruo_checkout_fields' ), 1000 );
		add_filter( 'woocommerce_form_field', array( $this, 'suppress_csf_ruo_form_field' ), 10, 4 );
		add_action( 'woocommerce_checkout_process', array( $this, 'neutralize_csf_ruo_validation' ), 999 );
		add_action( 'wp_loaded', array( $this, 'best_effort_unhook_named_csf_assent' ), 100 );
		// A merchant field we removed may still have the merchant's own validator behind it: satisfy it.
		add_action( 'woocommerce_checkout_process', array( $this, 'satisfy_suppressed_assent_fields' ), 1 );
	}

	/**
	 * When PSC owns assent and the buyer ticked PRISM's combined attestation (21+, research-only,
	 * experienced researcher, B2B), post the value a suppressed merchant assent field's own
	 * validator expects. Runs at priority 1 so merchant validators on the same hook see it.
	 * Explicit keys only (assent_field_keys) — never label guessing.
	 */
	public function satisfy_suppressed_assent_fields(): void {
		if ( ! $this->psc_assent_owns() || ! $this->has_purchase_evidence() ) {
			return;
		}
		foreach ( $this->assent_field_keys() as $key ) {
			if ( '' === (string) ( $_POST[ $key ] ?? '' ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Missing
				$_POST[ $key ] = '1';
			}
		}
	}

	private function has_purchase_evidence(): bool {
		$email = isset( $_POST['billing_email'] ) && is_string( $_POST['billing_email'] )
			? sanitize_email( wp_unslash( $_POST['billing_email'] ) )
			: ( function_exists( 'WC' ) && WC() && WC()->customer ? WC()->customer->get_billing_email() : '' );
		return ! is_wp_error( Research_Checkout::payment_evidence( (string) $email ) );
	}

	public function suppress_native_terms( $show ) {
		return $this->psc_assent_owns() ? false : (bool) $show;
	}

	/**
	 * True when PSC is the selected/active gateway (sole available, session, or POST).
	 * Used so the gate checkbox is the sole PEPT-24 surface and CSF csf_ruo is not required.
	 */
	public function psc_assent_owns(): bool {
		$method = '';
		if ( isset( $_POST['payment_method'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Missing -- checkout method detect only
			$method = sanitize_text_field( wp_unslash( (string) $_POST['payment_method'] ) );
		}
		if ( '' === $method && function_exists( 'WC' ) && WC() && WC()->session ) {
			$method = (string) WC()->session->get( 'chosen_payment_method', '' );
		}
		if ( '' !== $method ) {
			return PSC_GATEWAY_ID === $method;
		}
		// Paint path: sole available gateway is PSC.
		if ( ! function_exists( 'WC' ) || ! WC() ) {
			return false;
		}
		$gateways = WC()->payment_gateways();
		if ( ! $gateways || ! method_exists( $gateways, 'get_available_payment_gateways' ) ) {
			return false;
		}
		$available = $gateways->get_available_payment_gateways();
		if ( ! is_array( $available ) || ! isset( $available[ PSC_GATEWAY_ID ] ) ) {
			return false;
		}
		return 1 === count( $available );
	}

	/**
	 * Merchant assent field keys PSC replaces when it owns assent. Explicit keys only: a key on
	 * this list is also auto-satisfied for the merchant's validator (satisfy_suppressed_assent_fields).
	 * Add a site's key with the psc_assent_field_keys filter.
	 *
	 * @return string[]
	 */
	private function assent_field_keys(): array {
		$keys = array( 'csf_ruo', 'age_research_consent', 'research_disclaimer' );
		$keys = apply_filters( 'psc_assent_field_keys', $keys );
		return is_array( $keys ) ? array_map( 'strval', $keys ) : array();
	}

	/**
	 * @param string $key  Field key.
	 * @param mixed  $args Field args (unused; kept for the woocommerce_form_field call shape).
	 */
	private function is_duplicate_assent_field( string $key, $args = array() ): bool {
		unset( $args );
		return in_array( $key, $this->assent_field_keys(), true );
	}

	/**
	 * Remove csf_ruo from Woo checkout field groups when PSC owns assent.
	 *
	 * @param array $fields Checkout fields.
	 * @return array
	 */
	public function strip_csf_ruo_checkout_fields( $fields ) {
		if ( ! $this->psc_assent_owns() || ! is_array( $fields ) ) {
			return $fields;
		}
		foreach ( array( 'billing', 'shipping', 'order', 'account' ) as $group ) {
			if ( ! isset( $fields[ $group ] ) || ! is_array( $fields[ $group ] ) ) {
				continue;
			}
			foreach ( array_keys( $fields[ $group ] ) as $key ) {
				if ( $this->is_duplicate_assent_field( (string) $key, $fields[ $group ][ $key ] ) ) {
					unset( $fields[ $group ][ $key ] );
				}
			}
		}
		return $fields;
	}

	/**
	 * Live CSF renders via woocommerce_form_field( 'csf_ruo' ) on review_order_before_submit.
	 * Return empty markup when PSC owns assent so the field never enters the DOM/POST set.
	 *
	 * @param string $field Field HTML.
	 * @param string $key   Field key.
	 * @param array  $args  Field args.
	 * @param mixed  $value Value.
	 * @return string
	 */
	public function suppress_csf_ruo_form_field( $field, $key, $args, $value ) {
		if ( $this->psc_assent_owns() && $this->is_duplicate_assent_field( (string) $key, $args ) ) {
			return '';
		}
		return $field;
	}

	/**
	 * Drop CSF research-use validation errors when PSC owns assent.
	 * Does not invent csf_ruo=1; PSC validates psc_attest separately.
	 */
	public function neutralize_csf_ruo_validation(): void {
		if ( ! $this->psc_assent_owns() || ! $this->has_purchase_evidence() || ! function_exists( 'wc_get_notices' ) ) {
			return;
		}
		$all = wc_get_notices();
		if ( empty( $all['error'] ) || ! is_array( $all['error'] ) ) {
			return;
		}
		$kept = array();
		foreach ( $all['error'] as $notice ) {
			$msg = is_array( $notice ) ? (string) ( $notice['notice'] ?? '' ) : (string) $notice;
			if ( $this->is_csf_ruo_error_message( $msg ) ) {
				continue;
			}
			$kept[] = $notice;
		}
		if ( count( $kept ) === count( $all['error'] ) ) {
			return;
		}
		$all['error'] = $kept;
		if ( function_exists( 'WC' ) && WC() && WC()->session ) {
			WC()->session->set( 'wc_notices', $all );
		}
	}

	/**
	 * @param string $msg Notice text.
	 */
	private function is_csf_ruo_error_message( string $msg ): bool {
		$msg = strtolower( $msg );
		return false !== strpos( $msg, 'research-use' )
			|| false !== strpos( $msg, 'research use' )
			|| false !== strpos( $msg, 'csf_ruo' )
			|| false !== strpos( $msg, 'qualified research-use' )
			|| false !== strpos( $msg, 'research-use acknowledgement' );
	}

	/**
	 * Best-effort remove of named CSF assent callbacks (newer CSF beta). No-op if absent.
	 * Only when PSC owns assent. Never touches product notice or footer disclaimer hooks.
	 * Anonymous live RTS hooks are handled by form_field + neutralize_csf_ruo_validation.
	 */
	public function best_effort_unhook_named_csf_assent(): void {
		if ( ! function_exists( 'remove_action' ) || ! $this->psc_assent_owns() ) {
			return;
		}
		remove_action( 'woocommerce_review_order_before_submit', 'csf_render_legacy_checkout_consent' );
		remove_action( 'woocommerce_checkout_process', 'csf_validate_legacy_checkout_consent' );
	}

	public static function terms_valid(): bool {
		return is_readable( PSC_TERMS_FILE ) && hash_equals( PSC_TERMS_HASH, (string) hash_file( 'sha256', PSC_TERMS_FILE ) );
	}

	/**
	 * Whether the stacked checkout shell has already been printed this request.
	 */
	public function checkout_fields_were_rendered(): bool {
		return $this->checkout_fields_rendered;
	}

	/**
	 * Reset the per-request render guard (PHPUnit / multi-fragment isolation).
	 */
	public function reset_checkout_render_guard(): void {
		$this->checkout_fields_rendered = false;
	}

	/**
	 * Render PRISM shell once at the top of classic checkout when PSC is available.
	 */
	public function maybe_render_top_checkout(): void {
		if ( function_exists( 'is_checkout' ) && ! is_checkout() ) {
			return;
		}
		if ( $this->checkout_fields_rendered ) {
			return;
		}
		if ( ! $this->prism_available_on_checkout() ) {
			return;
		}
		echo '<div id="psc-checkout-root" class="psc-checkout-root">';
		$this->render_checkout_fields();
		echo '</div>';
	}

	/**
	 * Full stacked checkout shell. Guarded against duplicate IDs (payment_fields vs top hook).
	 */
	public function render_checkout_fields(): void {
		if ( $this->checkout_fields_rendered ) { return; }
		$this->checkout_fields_rendered = true;
		$settings = get_option( 'woocommerce_' . PSC_GATEWAY_ID . '_settings', array() );
		$theme = strtolower( (string) ( $settings['theme'] ?? 'auto' ) );
		$theme = in_array( $theme, array( 'light', 'dark', 'auto' ), true ) ? $theme : 'auto';
		$layout = Gateway::layout_preference();
		$research = defined( 'PSC_RESEARCH_CHECKOUT' ) && PSC_RESEARCH_CHECKOUT;
		echo '<div class="psc-checkout psc-checkout--research-payment psc-checkout--' . esc_attr( 'standard' === $layout ? 'standard' : 'wallet-first' ) . '" id="psc-checkout" data-psc-theme="' . esc_attr( $theme ) . '" data-psc-layout="' . esc_attr( $layout ) . '">';
		echo '<p id="psc-payment-message" class="psc-payment-message" role="alert" hidden></p>';
		echo '<div id="psc-wallet-stage" class="psc-wallet-stage"><div id="psc-express-checkout-element" class="psc-express-element"></div></div>';
		if ( ! $research ) {
			echo '<button type="button" id="psc-card-toggle" class="button psc-card-toggle">' . esc_html__( 'Pay with card', 'prism-simple-checkout' ) . '</button>';
		}
		echo '<div id="psc-card-stage" class="psc-card-stage"' . ( $research ? '' : ' hidden' ) . '><div id="psc-payment-element"></div></div>';
		echo '<p id="psc-payment-message-footer" class="psc-payment-message psc-payment-message--footer" role="alert" hidden></p>';
		echo '</div>';
	}

	public function accept_now() {
		if ( defined( 'PSC_RESEARCH_CHECKOUT' ) && PSC_RESEARCH_CHECKOUT ) {
			return $this->get_evidence() ?? new \WP_Error( 'research_verification_required', 'Confirm the purchase declarations before continuing.' );
		}
		if ( ! self::terms_valid() ) {
			return new \WP_Error( 'psc_terms', 'Terms file invalid.' );
		}
		$evidence = array( 'version' => PSC_TERMS_VERSION, 'hash' => PSC_TERMS_HASH, 'accepted' => true, 'accepted_at' => gmdate( 'c' ) );
		$this->set( $evidence );
		return $evidence;
	}

	public function get_evidence(): ?array {
		$evidence = function_exists( 'WC' ) && WC() && WC()->session ? WC()->session->get( self::SESSION_EVIDENCE ) : null;
		return is_array( $evidence ) && true === ( $evidence['accepted'] ?? false ) && PSC_TERMS_VERSION === ( $evidence['version'] ?? '' ) && hash_equals( PSC_TERMS_HASH, (string) ( $evidence['hash'] ?? '' ) ) && ! empty( $evidence['accepted_at'] ) ? $evidence : null;
	}

	public function consume_evidence(): void {
		$this->set( null );
	}

	private function set( $value ): void {
		if ( function_exists( 'WC' ) && WC() && WC()->session ) {
			WC()->session->set( self::SESSION_EVIDENCE, $value );
		}
	}

	/**
	 * True when the PRISM gateway is among available checkout methods.
	 */
	private function prism_available_on_checkout(): bool {
		if ( ! function_exists( 'WC' ) || ! WC() ) {
			return false;
		}
		$gateways = WC()->payment_gateways();
		if ( ! $gateways || ! method_exists( $gateways, 'get_available_payment_gateways' ) ) {
			return false;
		}
		$available = $gateways->get_available_payment_gateways();
		return is_array( $available ) && isset( $available[ PSC_GATEWAY_ID ] );
	}
}
