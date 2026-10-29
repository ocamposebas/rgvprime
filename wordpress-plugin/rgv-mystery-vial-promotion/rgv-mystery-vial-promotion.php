<?php
/**
 * Plugin Name: RGV Mystery Vial Promotion
 * Description: Awards complimentary Mystery Vials by net merchandise spend and records them as physical WooCommerce order items for fulfillment.
 * Version: 1.0.0
 * Author: RGVPRIME LLC
 * Requires at least: 6.5
 * Requires PHP: 7.4
 * Requires Plugins: woocommerce
 * WC requires at least: 8.2
 * WC tested up to: 10.1
 * Text Domain: rgv-mystery-vials
 * License: GPLv2 or later
 */

defined( 'ABSPATH' ) || exit;

define( 'RGV_MYSTERY_VIALS_VERSION', '1.0.0' );
define( 'RGV_MYSTERY_VIALS_FILE', __FILE__ );
define( 'RGV_MYSTERY_VIALS_PATH', plugin_dir_path( __FILE__ ) );
define( 'RGV_MYSTERY_VIALS_URL', plugin_dir_url( __FILE__ ) );

require_once RGV_MYSTERY_VIALS_PATH . 'includes/class-rgv-mystery-vial-promotion.php';

register_activation_hook( __FILE__, array( 'RGV_Mystery_Vial_Promotion', 'activate' ) );

add_action(
	'before_woocommerce_init',
	static function (): void {
		if ( class_exists( '\\Automattic\\WooCommerce\\Utilities\\FeaturesUtil' ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
		}
	}
);

/**
 * Public bridge used by the custom RGV checkout plugins before stock is held.
 *
 * @param WC_Order|int $order Order object or ID.
 * @return int Quantity awarded.
 */
function rgv_mystery_vials_apply_to_order( $order ): int {
	return RGV_Mystery_Vial_Promotion::apply_to_order( $order );
}

add_action( 'plugins_loaded', array( 'RGV_Mystery_Vial_Promotion', 'init' ) );
