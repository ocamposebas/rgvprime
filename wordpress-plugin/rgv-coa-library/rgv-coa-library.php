<?php
/**
 * Plugin Name: RGV COA Library
 * Description: Organized Certificate of Analysis library with WooCommerce product linking, Current Shipping records, History, and a public storefront API.
 * Version: 1.0.0
 * Author: RGVPRIME LLC
 * Requires at least: 6.4
 * Requires PHP: 7.4
 * Requires Plugins: woocommerce
 * Text Domain: rgv-coa-library
 */

defined('ABSPATH') || exit;

define('RGV_COA_VERSION', '1.0.0');
define('RGV_COA_FILE', __FILE__);
define('RGV_COA_DIR', plugin_dir_path(__FILE__));
define('RGV_COA_URL', plugin_dir_url(__FILE__));

require_once RGV_COA_DIR . 'includes/class-rgv-coa-post-type.php';
require_once RGV_COA_DIR . 'includes/class-rgv-coa-rest-api.php';
require_once RGV_COA_DIR . 'includes/class-rgv-coa-admin.php';
require_once RGV_COA_DIR . 'includes/class-rgv-coa-plugin.php';

register_activation_hook(__FILE__, ['RGV_COA_Plugin', 'activate']);
add_action('plugins_loaded', ['RGV_COA_Plugin', 'instance']);

