<?php

defined('ABSPATH') || exit;

final class RGV_COA_REST_API {
    const NAMESPACE = 'rgv-coa/v1';
    const CACHE_KEY = 'rgv_coa_library_payload_v1';

    public static function hooks() {
        add_action('rest_api_init', [__CLASS__, 'register_routes']);
        add_action('save_post_' . RGV_COA_Post_Type::POST_TYPE, [__CLASS__, 'clear_cache']);
        add_action('deleted_post', [__CLASS__, 'maybe_clear_cache']);
        add_action('update_option_rgv_coa_settings', [__CLASS__, 'clear_cache']);
    }

    public static function clear_cache() {
        delete_transient(self::CACHE_KEY);
    }

    public static function maybe_clear_cache($post_id) {
        if (RGV_COA_Post_Type::POST_TYPE === get_post_type($post_id)) {
            self::clear_cache();
        }
    }

    public static function register_routes() {
        register_rest_route(self::NAMESPACE, '/library', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [__CLASS__, 'library'],
            'permission_callback' => '__return_true',
        ]);

        register_rest_route(self::NAMESPACE, '/product/(?P<id>\d+)', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [__CLASS__, 'product'],
            'permission_callback' => '__return_true',
            'args' => [
                'id' => ['sanitize_callback' => 'absint'],
                'variation_id' => ['sanitize_callback' => 'absint'],
            ],
        ]);

        register_rest_route(self::NAMESPACE, '/health', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => function () {
                return rest_ensure_response([
                    'ok' => true,
                    'plugin' => 'RGV COA Library',
                    'version' => RGV_COA_VERSION,
                ]);
            },
            'permission_callback' => '__return_true',
        ]);
    }

    private static function settings() {
        return wp_parse_args(get_option('rgv_coa_settings', []), [
            'company_name' => 'RGVPRIME LLC',
            'company_aliases' => "RGVPrime\nRGV Elite\nRGVElite\nRGVE",
        ]);
    }

    private static function all_posts() {
        return get_posts([
            'post_type' => RGV_COA_Post_Type::POST_TYPE,
            'post_status' => 'publish',
            'posts_per_page' => -1,
            'orderby' => ['menu_order' => 'ASC', 'date' => 'DESC'],
            'no_found_rows' => true,
            'suppress_filters' => false,
        ]);
    }

    private static function record($post) {
        $id = (int) $post->ID;
        $product_name = RGV_COA_Post_Type::meta($id, 'product_name', $post->post_title);
        $group_key = RGV_COA_Post_Type::meta($id, 'group_key');

        if (!$group_key) {
            $group_key = sanitize_title($product_name);
        }

        return [
            'id' => $id,
            'code' => RGV_COA_Post_Type::meta($id, 'report_code'),
            'lot' => RGV_COA_Post_Type::meta($id, 'batch'),
            'batch' => RGV_COA_Post_Type::meta($id, 'batch'),
            'product' => $product_name,
            'sku' => RGV_COA_Post_Type::meta($id, 'sku'),
            'url' => RGV_COA_Post_Type::document_url($id),
            'status' => RGV_COA_Post_Type::sanitize_status(RGV_COA_Post_Type::meta($id, 'status')),
            'purity' => RGV_COA_Post_Type::meta($id, 'purity'),
            'quantity' => RGV_COA_Post_Type::meta($id, 'quantity'),
            'lab_name' => RGV_COA_Post_Type::meta($id, 'lab_name'),
            'sample_id' => RGV_COA_Post_Type::meta($id, 'sample_id'),
            'test_method' => RGV_COA_Post_Type::meta($id, 'test_method'),
            'test_date' => RGV_COA_Post_Type::meta($id, 'test_date'),
            'report_date' => RGV_COA_Post_Type::meta($id, 'report_date'),
            'group_key' => $group_key,
            'canonical_key' => $group_key,
            'product_ids' => RGV_COA_Post_Type::product_ids($id),
            'aliases' => RGV_COA_Post_Type::aliases($id),
            'notes' => wp_kses_post(get_post_meta($id, RGV_COA_Post_Type::META_PREFIX . 'notes', true)),
            'updated_at' => get_post_modified_time('c', true, $post),
        ];
    }

    private static function all_records() {
        return array_values(array_map([__CLASS__, 'record'], self::all_posts()));
    }

    public static function library() {
        $cached = get_transient(self::CACHE_KEY);
        if (is_array($cached)) {
            return self::response($cached);
        }

        $settings = self::settings();
        $aliases = preg_split('/\r\n|\r|\n/', (string) $settings['company_aliases']);
        $aliases = array_values(array_filter(array_map('trim', $aliases)));
        $records = self::all_records();
        $history_by_group = [];
        $current = [];

        foreach ($records as $record) {
            if ('history' === $record['status']) {
                $history_by_group[$record['group_key']][] = $record;
            } else {
                $current[] = $record;
            }
        }

        $files = array_map(function ($record) use ($history_by_group) {
            $record['history'] = array_values($history_by_group[$record['group_key']] ?? []);
            return $record;
        }, $current);

        usort($files, function ($a, $b) {
            return strnatcasecmp($a['product'], $b['product']);
        });

        $payload = [
            'companies' => [[
                'name' => sanitize_text_field($settings['company_name']),
                'aliases' => $aliases,
                'files' => $files,
            ]],
            'items' => $records,
            'meta' => [
                'current_shipping' => count($current),
                'history' => count($records) - count($current),
                'total' => count($records),
                'generated_at' => gmdate('c'),
            ],
        ];

        set_transient(self::CACHE_KEY, $payload, 5 * MINUTE_IN_SECONDS);
        return self::response($payload);
    }

    public static function product(WP_REST_Request $request) {
        $ids = array_values(array_filter(array_unique([
            absint($request['id']),
            absint($request->get_param('variation_id')),
        ])));

        $items = array_values(array_filter(self::all_records(), function ($record) use ($ids) {
            return 'current' === $record['status'] && (bool) array_intersect($ids, $record['product_ids']);
        }));

        usort($items, function ($a, $b) {
            return strcmp((string) $b['report_date'], (string) $a['report_date']);
        });

        return self::response([
            'product_id' => absint($request['id']),
            'variation_id' => absint($request->get_param('variation_id')),
            'items' => $items,
            'count' => count($items),
        ]);
    }

    private static function response($data) {
        $response = rest_ensure_response($data);
        $response->header('Cache-Control', 'public, max-age=60, s-maxage=300');
        return $response;
    }
}

