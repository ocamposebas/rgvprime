<?php

defined('ABSPATH') || exit;

final class RGV_COA_Post_Type {
    const POST_TYPE = 'rgv_coa';
    const META_PREFIX = '_rgv_coa_';

    public static function hooks() {
        add_action('init', [__CLASS__, 'register']);
    }

    public static function register() {
        register_post_type(self::POST_TYPE, [
            'labels' => [
                'name' => __('COA Records', 'rgv-coa-library'),
                'singular_name' => __('COA Record', 'rgv-coa-library'),
            ],
            'public' => false,
            'show_ui' => false,
            'show_in_rest' => false,
            'supports' => ['title'],
            'capability_type' => 'post',
            'map_meta_cap' => true,
        ]);

        $text_fields = [
            'product_name', 'sku', 'report_code', 'batch', 'purity', 'quantity',
            'lab_name', 'sample_id', 'test_method', 'test_date', 'report_date',
            'group_key', 'document_url',
        ];

        foreach ($text_fields as $field) {
            register_post_meta(self::POST_TYPE, self::META_PREFIX . $field, [
                'type' => 'string',
                'single' => true,
                'sanitize_callback' => 'sanitize_text_field',
                'auth_callback' => function () {
                    return current_user_can('manage_woocommerce');
                },
            ]);
        }

        register_post_meta(self::POST_TYPE, self::META_PREFIX . 'status', [
            'type' => 'string',
            'single' => true,
            'sanitize_callback' => [__CLASS__, 'sanitize_status'],
            'auth_callback' => function () {
                return current_user_can('manage_woocommerce');
            },
        ]);
    }

    public static function sanitize_status($value) {
        return 'history' === $value ? 'history' : 'current';
    }

    public static function meta($post_id, $key, $default = '') {
        $value = get_post_meta($post_id, self::META_PREFIX . $key, true);
        return '' === $value || null === $value ? $default : $value;
    }

    public static function product_ids($post_id) {
        $ids = get_post_meta($post_id, self::META_PREFIX . 'product_ids', true);
        return array_values(array_unique(array_filter(array_map('absint', is_array($ids) ? $ids : []))));
    }

    public static function aliases($post_id) {
        $aliases = get_post_meta($post_id, self::META_PREFIX . 'aliases', true);
        return array_values(array_filter(array_map('sanitize_text_field', is_array($aliases) ? $aliases : [])));
    }

    public static function document_url($post_id) {
        $attachment_id = absint(get_post_meta($post_id, self::META_PREFIX . 'attachment_id', true));
        $url = $attachment_id ? wp_get_attachment_url($attachment_id) : '';

        return $url ?: esc_url_raw(self::meta($post_id, 'document_url'));
    }
}

