<?php
namespace PrismSimpleCheckout;
defined( 'ABSPATH' ) || exit;
use Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType;
/** Checkout Blocks registration over the shared controller and PHP application layer. */
final class Blocks_Payment_Method extends AbstractPaymentMethodType {
	protected $name = PSC_GATEWAY_ID;
	protected $settings = array();
	public function initialize() {
		$value = get_option( 'woocommerce_psc_settings', array() );
		$this->settings = is_array( $value ) ? $value : array();
		add_filter( 'render_block_data', array( $this, 'wallet_first_fields' ), 10, 3 );
	}
	/** Only one configured gateway may own the research wallet-first layout. */
	private function wallet_first_eligible(): bool {
		if ( is_admin() || PSC_VERIFICATION_ONLY || ! defined( 'PSC_RESEARCH_CHECKOUT' ) || ! PSC_RESEARCH_CHECKOUT || 'wallet_first' !== Gateway::layout_preference()
			|| ! $this->is_active() || ! class_exists( Research_Checkout::class )
			|| ! function_exists( 'WC' ) || ! WC() ) {
			return false;
		}
		$enabled = array();
		foreach ( WC()->payment_gateways()->payment_gateways() as $id => $gateway ) {
			if ( 'yes' === $gateway->enabled ) { $enabled[] = $id; }
		}
		return array( PSC_GATEWAY_ID ) === $enabled;
	}
	/**
	 * Reorder the existing parsed payment block before Woo hydrates its children.
	 * Static fragments/null markers and every other child remain intact. Saved
	 * page content and React-owned DOM are never rewritten or reparented.
	 */
	public function wallet_first_fields( $parsed_block, $source_block, $parent_block ) {
		unset( $source_block );
		if ( 'woocommerce/checkout-fields-block' !== ( $parsed_block['blockName'] ?? '' )
			|| ! $parent_block instanceof \WP_Block || 'woocommerce/checkout' !== $parent_block->name
			|| ! $this->wallet_first_eligible() ) {
			return $parsed_block;
		}
		$children = $parsed_block['innerBlocks'] ?? array();
		$markers  = array_filter( $parsed_block['innerContent'] ?? array(), static fn( $fragment ) => null === $fragment );
		if ( count( $markers ) !== count( $children ) ) { return $parsed_block; }
		$positions = array();
		foreach ( $children as $index => $child ) {
			$name = $child['blockName'] ?? '';
			if ( in_array( $name, array( 'woocommerce/checkout-payment-block', 'woocommerce/checkout-express-payment-block', 'woocommerce/checkout-contact-information-block' ), true ) ) {
				if ( isset( $positions[ $name ] ) ) { return $parsed_block; }
				$positions[ $name ] = $index;
			}
		}
		$payment = $positions['woocommerce/checkout-payment-block'] ?? null;
		$contact = $positions['woocommerce/checkout-contact-information-block'] ?? null;
		$express = $positions['woocommerce/checkout-express-payment-block'] ?? null;
		if ( null === $payment || null === $contact || ( null !== $express && $express > $contact ) ) { return $parsed_block; }
		$payment_block = $children[ $payment ];
		array_splice( $children, $payment, 1 );
		$insert = null;
		foreach ( $children as $index => $child ) {
			if ( null !== $express && 'woocommerce/checkout-express-payment-block' === ( $child['blockName'] ?? '' ) ) { $insert = $index + 1; break; }
			if ( null === $express && 'woocommerce/checkout-contact-information-block' === ( $child['blockName'] ?? '' ) ) { $insert = $index; break; }
		}
		if ( null === $insert ) { return $parsed_block; }
		array_splice( $children, $insert, 0, array( $payment_block ) );
		$parsed_block['innerBlocks'] = $children;
		return $parsed_block;
	}
	public function is_active() {
		if ( PSC_VERIFICATION_ONLY ) { return false; }
		return 'yes' === ( $this->settings['enabled'] ?? 'yes' ) && Credential_Store::is_configured();
	}
	public function get_payment_method_script_handles() {
		if ( PSC_VERIFICATION_ONLY ) { return array(); }
		// Blocks may render on an alternate checkout page without the Classic gateway enqueue.
		wp_enqueue_style( 'psc-checkout', PSC_PLUGIN_URL . 'assets/css/checkout.css', array(), PSC_VERSION . '.' . filemtime( PSC_PLUGIN_DIR . 'assets/css/checkout.css' ) );
		wp_register_script( 'stripe-js', 'https://js.stripe.com/v3/', array(), null, true );
		wp_register_script( 'psc-checkout-controller', PSC_PLUGIN_URL . 'assets/js/checkout-controller.js', array(), PSC_VERSION . '.' . filemtime( PSC_PLUGIN_DIR . 'assets/js/checkout-controller.js' ), true );
		$blocks_ver = PSC_VERSION . '.' . (string) ( @filemtime( PSC_PLUGIN_DIR . 'assets/js/blocks-checkout.js' ) ?: 0 );
		wp_register_script(
			'psc-blocks-checkout',
			PSC_PLUGIN_URL . 'assets/js/blocks-checkout.js',
			array( 'wc-blocks-registry', 'wc-settings', 'wp-element', 'wp-data', 'wp-html-entities', 'wp-i18n', 'stripe-js', 'psc-checkout-controller' ),
			$blocks_ver,
			true
		);
		return array( 'psc-blocks-checkout' );
	}
	public function get_payment_method_data() {
		$theme = strtolower( (string) ( $this->settings['theme'] ?? 'auto' ) );
		if ( ! in_array( $theme, array( 'auto', 'light', 'dark' ), true ) ) {
			$theme = 'auto';
		}
		return array(
			'title' => __( 'PRISM Secure Checkout', 'prism-simple-checkout' ),
			'description' => __( 'Verified research payment', 'prism-simple-checkout' ),
			'supports' => array( 'products', 'refunds' ),
			'gateway_id' => PSC_GATEWAY_ID,
			'wordmark_url' => PSC_PLUGIN_URL . 'assets/img/prism-wordmark.png',
			'wordmark_url_dark' => PSC_PLUGIN_URL . 'assets/img/prism-wordmark.png',
			'wordmark_url_light' => PSC_PLUGIN_URL . 'assets/img/prism-wordmark-light.png',
			'theme' => $theme,
			'font_url' => PSC_PLUGIN_URL . 'assets/fonts/inter-variable.woff2',
			'ajax_url' => admin_url( 'admin-ajax.php' ),
			'nonce' => wp_create_nonce( 'psc_checkout' ),
			'terms_version' => PSC_TERMS_VERSION,
			'field_policy' => Plugin::instance()->field_policy()->native_surface_snapshot(),
			'wallet_first' => $this->wallet_first_eligible(),
		);
	}
}
