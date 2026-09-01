<?php
/**
 * Plugin Name: ORBIT Relay for WooCommerce
 * Plugin URI:  https://orbit.example/
 * Description: Secure commerce synchronization layer between RGVPRIME WooCommerce and the ORBIT platform.
 * Version:     1.4.4
 * Author:      ORBIT
 * Requires at least: 6.5
 * Requires PHP: 8.1
 * WC requires at least: 8.5
 * WC tested up to: 10.1
 * Text Domain: orbit-relay
 */

defined( 'ABSPATH' ) || exit;

define( 'ORBIT_RELAY_VERSION', '1.4.4' );
define( 'ORBIT_RELAY_FILE', __FILE__ );
define( 'ORBIT_RELAY_DIR', plugin_dir_path( __FILE__ ) );
define( 'ORBIT_RELAY_URL', plugin_dir_url( __FILE__ ) );

require_once ORBIT_RELAY_DIR . 'includes/class-orbit-relay-logger.php';
require_once ORBIT_RELAY_DIR . 'includes/class-orbit-relay-secret-store.php';
require_once ORBIT_RELAY_DIR . 'includes/class-orbit-relay-auth.php';
require_once ORBIT_RELAY_DIR . 'includes/class-orbit-relay-orders.php';
require_once ORBIT_RELAY_DIR . 'includes/class-orbit-relay-card-checkout.php';
require_once ORBIT_RELAY_DIR . 'includes/class-orbit-relay-coupon-guard.php';
require_once ORBIT_RELAY_DIR . 'includes/class-orbit-relay-health.php';
require_once ORBIT_RELAY_DIR . 'includes/class-orbit-relay-rest.php';
require_once ORBIT_RELAY_DIR . 'includes/class-orbit-relay-admin.php';
require_once ORBIT_RELAY_DIR . 'includes/class-orbit-relay.php';

register_activation_hook( __FILE__, array( 'ORBIT_Relay', 'activate' ) );

add_action(
    'before_woocommerce_init',
    static function () {
        if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
            \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
        }
    }
);

add_action(
    'plugins_loaded',
    static function () {
        ORBIT_Relay::instance()->init();
    }
);
