<?php
/**
 * Plugin Name: RGV Storewide Promotion
 * Description: Schedules a storewide WooCommerce discount and publishes a synchronized countdown announcement.
 * Version: 1.0.0
 * Author: RGVPRIME LLC
 * Requires at least: 6.5
 * Requires PHP: 7.4
 * Requires Plugins: woocommerce
 * WC requires at least: 8.2
 * WC tested up to: 10.1
 * Text Domain: rgv-storewide-promotion
 * License: GPLv2 or later
 */

defined( 'ABSPATH' ) || exit;

define( 'RGV_PROMOTION_VERSION', '1.0.0' );
define( 'RGV_PROMOTION_FILE', __FILE__ );
define( 'RGV_PROMOTION_PATH', plugin_dir_path( __FILE__ ) );
define( 'RGV_PROMOTION_URL', plugin_dir_url( __FILE__ ) );

require_once RGV_PROMOTION_PATH . 'includes/class-rgv-storewide-promotion.php';

register_activation_hook( __FILE__, array( 'RGV_Storewide_Promotion', 'activate' ) );

add_action(
	'before_woocommerce_init',
	static function (): void {
		if ( class_exists( '\\Automattic\\WooCommerce\\Utilities\\FeaturesUtil' ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
		}
	}
);

add_action( 'plugins_loaded', array( 'RGV_Storewide_Promotion', 'init' ) );

