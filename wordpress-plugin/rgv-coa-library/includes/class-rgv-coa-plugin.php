<?php

defined('ABSPATH') || exit;

final class RGV_COA_Plugin {
    private static $instance;

    public static function instance() {
        if (!self::$instance) {
            self::$instance = new self();
        }

        return self::$instance;
    }

    public static function activate() {
        RGV_COA_Post_Type::register();
        flush_rewrite_rules();

        if (!get_option('rgv_coa_settings')) {
            add_option('rgv_coa_settings', [
                'company_name' => 'RGVPRIME LLC',
                'company_aliases' => "RGVPrime\nRGV Elite\nRGVElite\nRGVE",
            ]);
        }
    }

    private function __construct() {
        RGV_COA_Post_Type::hooks();
        RGV_COA_REST_API::hooks();
        RGV_COA_Admin::hooks();

        add_action('admin_notices', [$this, 'woocommerce_notice']);
    }

    public function woocommerce_notice() {
        if (class_exists('WooCommerce') || !current_user_can('activate_plugins')) {
            return;
        }

        echo '<div class="notice notice-warning"><p>';
        echo esc_html__('RGV COA Library is active, but WooCommerce is required for product linking.', 'rgv-coa-library');
        echo '</p></div>';
    }
}

