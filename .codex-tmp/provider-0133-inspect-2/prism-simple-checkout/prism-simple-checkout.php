<?php
/**
 * Plugin Name:       PRISM Fall Checkout
 * Description:       PRISM research verification, secure checkout, and purchase records.
 * Version:           0.1.3.3
 * Requires at least: 6.4
 * Requires PHP:      8.1
 * Requires Plugins:  woocommerce
 * WC requires at least: 8.0
 * WC tested up to:   10.9
 * Author:            Groundsetter
 * Update URI:        false
 * License:           Proprietary
 * Text Domain:       prism-simple-checkout
 */
defined( 'ABSPATH' ) || exit;
if ( version_compare( PHP_VERSION, '8.1', '<' ) ) {
	add_action( 'admin_notices', static function (): void {
		echo '<div class="notice notice-error"><p>' . esc_html__( 'PRISM Simple Checkout requires PHP 8.1 or higher.', 'prism-simple-checkout' ) . '</p></div>';
	} );
	return;
}
defined( 'PSC_VERSION' ) || define( 'PSC_VERSION', '0.1.3.3' );
defined( 'PSC_VERIFICATION_ONLY' ) || define( 'PSC_VERIFICATION_ONLY', false );
defined( 'PSC_RESEARCH_CHECKOUT' ) || define( 'PSC_RESEARCH_CHECKOUT', true );
defined( 'PSC_MANUAL_UPDATES' ) || define( 'PSC_MANUAL_UPDATES', true );
// Public production endpoint, not a secret. Preserve an explicitly configured pin.
if ( PSC_MANUAL_UPDATES && ! defined( 'PSC_FALL_SERVICE_URL' ) ) {
	define( 'PSC_FALL_SERVICE_URL', 'https://prism-fall-checkout-production.austin-159.workers.dev' );
}
defined( 'PSC_PLUGIN_FILE' ) || define( 'PSC_PLUGIN_FILE', __FILE__ );
defined( 'PSC_PLUGIN_DIR' ) || define( 'PSC_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
defined( 'PSC_PLUGIN_URL' ) || define( 'PSC_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
defined( 'PSC_PAYMENT_CONTRACT' ) || define( 'PSC_PAYMENT_CONTRACT', 'psc-payment-1' );
defined( 'PSC_GATEWAY_ID' ) || define( 'PSC_GATEWAY_ID', 'psc' );
defined( 'PSC_TERMS_VERSION' ) || define( 'PSC_TERMS_VERSION', '2026.08.03-1' );
defined( 'PSC_TERMS_HASH' ) || define( 'PSC_TERMS_HASH', '097ebbed19e5f580d5a82fe43b922b4de7a3cd9968274f379fc7d6ed98083f3c' );
defined( 'PSC_TERMS_FILE' ) || define( 'PSC_TERMS_FILE', PSC_PLUGIN_DIR . 'assets/legal/checkout-terms-2026.08.03-1.md' );
defined( 'PSC_DB_VERSION' ) || define( 'PSC_DB_VERSION', 1 );
$psc_files = array( 'credential-store', 'service-client', 'buyer-copy', 'cart-fingerprint', 'address-canonical', 'checkout-claim', 'attempt-state', 'legal', 'field-policy', 'completion', 'reconciler', 'refunds', 'settings', 'rest-routes', 'research-checkout', 'google-checkout', 'lifecycle', 'monitor-status', 'wallet-domains', 'updater', 'plugin' );
foreach ( $psc_files as $psc_name ) {
	require_once PSC_PLUGIN_DIR . 'includes/class-' . $psc_name . '.php';
}
( new \PrismSimpleCheckout\Monitor_Status() )->hooks();
if ( ! PSC_VERIFICATION_ONLY ) {
	( new \PrismSimpleCheckout\Wallet_Domains() )->hooks();
	\PrismSimpleCheckout\Wallet_Domains::maybe_ensure_on_upgrade();
}
add_action( 'woocommerce_blocks_payment_method_type_registration', static function (): void {
	require_once PSC_PLUGIN_DIR . 'includes/class-blocks-payment-method.php';
}, 5 );
add_action( 'before_woocommerce_init', static function (): void {
	if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', PSC_PLUGIN_FILE, true );
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'cart_checkout_blocks', PSC_PLUGIN_FILE, true );
	}
} );
register_activation_hook( __FILE__, array( \PrismSimpleCheckout\Plugin::class, 'activate' ) );
register_deactivation_hook( __FILE__, array( \PrismSimpleCheckout\Plugin::class, 'deactivate' ) );
add_action( 'plugins_loaded', static function (): void {
	if ( function_exists( 'get_option' ) ) {
		\PrismSimpleCheckout\Lifecycle::boot();
	}
	( new \PrismSimpleCheckout\Updater() )->hooks();
	if ( class_exists( 'WooCommerce' ) && class_exists( 'WC_Payment_Gateway' ) ) {
		require_once PSC_PLUGIN_DIR . 'includes/class-gateway.php';
		\PrismSimpleCheckout\Plugin::boot();
	}
}, 20 );
