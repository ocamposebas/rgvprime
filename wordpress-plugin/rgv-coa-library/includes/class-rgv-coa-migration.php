<?php

defined('ABSPATH') || exit;

final class RGV_COA_Migration {
    const ACTION = 'rgv_coa_apply_source_truth';
    const RESULT_OPTION = 'rgv_coa_last_migration_result';

    public static function hooks() {
        add_action('admin_post_' . self::ACTION, [__CLASS__, 'handle']);
    }

    private static function authorize() {
        if (!current_user_can('manage_woocommerce')) {
            wp_die(esc_html__('You do not have permission to migrate COA records.', 'rgv-coa-library'));
        }
        check_admin_referer(self::ACTION);
    }

    private static function manifest() {
        $path = RGV_COA_DIR . 'data/coa-source-truth.json';
        if (!is_readable($path)) {
            return new WP_Error('missing_manifest', __('The source-truth manifest is missing.', 'rgv-coa-library'));
        }
        $manifest = json_decode(file_get_contents($path), true);
        if (!is_array($manifest) || empty($manifest['records'])) {
            return new WP_Error('invalid_manifest', __('The source-truth manifest is invalid.', 'rgv-coa-library'));
        }
        return $manifest;
    }

    private static function snapshot() {
        $posts = get_posts([
            'post_type' => RGV_COA_Post_Type::POST_TYPE,
            'post_status' => 'any',
            'posts_per_page' => -1,
            'orderby' => 'ID',
            'order' => 'ASC',
            'no_found_rows' => true,
        ]);
        $records = [];
        foreach ($posts as $post) {
            $records[] = [
                'post' => [
                    'ID' => (int) $post->ID,
                    'post_title' => $post->post_title,
                    'post_status' => $post->post_status,
                    'post_modified_gmt' => $post->post_modified_gmt,
                ],
                'meta' => get_post_meta($post->ID),
            ];
        }

        $stamp = gmdate('Ymd_His');
        $key = 'rgv_coa_backup_' . $stamp;
        $snapshot = [
            'created_at' => gmdate('c'),
            'plugin_version' => RGV_COA_VERSION,
            'record_count' => count($records),
            'records' => $records,
        ];
        if (!add_option($key, $snapshot, '', false)) {
            return new WP_Error('backup_failed', __('Could not create the pre-migration COA snapshot.', 'rgv-coa-library'));
        }
        return $key;
    }

    private static function document_hash($post_id, $url) {
        $attachment_id = absint(get_post_meta($post_id, RGV_COA_Post_Type::META_PREFIX . 'attachment_id', true));
        if ($attachment_id) {
            $path = get_attached_file($attachment_id);
            if ($path && is_readable($path)) {
                return hash_file('sha256', $path);
            }
        }

        $response = wp_safe_remote_get($url, [
            'timeout' => 30,
            'redirection' => 3,
            'limit_response_size' => 25 * MB_IN_BYTES,
        ]);
        if (is_wp_error($response) || 200 !== wp_remote_retrieve_response_code($response)) {
            return new WP_Error('pdf_unavailable', __('The source PDF could not be downloaded for hash verification.', 'rgv-coa-library'));
        }
        $body = wp_remote_retrieve_body($response);
        if (0 !== strpos($body, '%PDF')) {
            return new WP_Error('invalid_pdf', __('The source URL did not return a PDF.', 'rgv-coa-library'));
        }
        return hash('sha256', $body);
    }

    private static function update_record($record) {
        $post_id = absint($record['id'] ?? 0);
        if (!$post_id || RGV_COA_Post_Type::POST_TYPE !== get_post_type($post_id)) {
            return new WP_Error('record_missing', __('The COA post does not exist.', 'rgv-coa-library'));
        }

        $current_url = RGV_COA_Post_Type::document_url($post_id);
        $expected_url = esc_url_raw($record['pdf_url'] ?? '');
        if (!$current_url || $current_url !== $expected_url) {
            return new WP_Error('source_url_mismatch', __('The stored PDF URL differs from the audited source.', 'rgv-coa-library'));
        }

        $actual_hash = self::document_hash($post_id, $current_url);
        if (is_wp_error($actual_hash)) {
            return $actual_hash;
        }
        $expected_hash = strtolower((string) ($record['source']['pdf_sha256'] ?? ''));
        if (!$expected_hash || !hash_equals($expected_hash, strtolower($actual_hash))) {
            return new WP_Error('source_hash_mismatch', __('The source PDF changed after the audit.', 'rgv-coa-library'));
        }

        $validation = RGV_COA_Integrity::validate_record($record);
        if ($validation) {
            return new WP_Error('validation_failed', wp_json_encode($validation));
        }

        $text_map = [
            'product_name' => 'product_name',
            'compound_name' => 'compound_name',
            'sku' => 'sku',
            'report_code' => 'report_code',
            'batch' => 'batch',
            'lab' => 'lab_name',
            'sample_id' => 'sample_id',
            'received_date' => 'received_date',
            'test_date' => 'test_date',
            'report_date' => 'report_date',
            'purity' => 'purity',
        ];
        foreach ($text_map as $source => $target) {
            update_post_meta(
                $post_id,
                RGV_COA_Post_Type::META_PREFIX . $target,
                sanitize_text_field($record[$source] ?? '')
            );
        }

        $aliases = RGV_COA_Integrity::remove_analyte_aliases(
            $record['aliases'] ?? [],
            $record['analytes'] ?? []
        );
        update_post_meta($post_id, RGV_COA_Post_Type::META_PREFIX . 'aliases', $aliases);
        foreach (['analytes', 'tests', 'results', 'manual_review'] as $field) {
            update_post_meta($post_id, RGV_COA_Post_Type::META_PREFIX . $field, $record[$field] ?? []);
        }
        update_post_meta($post_id, RGV_COA_Post_Type::META_PREFIX . 'notes', wp_kses_post($record['notes'] ?? ''));
        update_post_meta($post_id, RGV_COA_Post_Type::META_PREFIX . 'status', !empty($record['is_current']) ? 'current' : 'history');
        update_post_meta($post_id, RGV_COA_Post_Type::META_PREFIX . 'source_pdf_sha256', $expected_hash);
        update_post_meta($post_id, RGV_COA_Post_Type::META_PREFIX . 'parser_version', sanitize_text_field($record['source']['parser'] ?? ''));
        return true;
    }

    public static function handle() {
        self::authorize();
        @set_time_limit(0);
        $manifest = self::manifest();
        if (is_wp_error($manifest)) {
            wp_die(esc_html($manifest->get_error_message()));
        }
        $backup_key = self::snapshot();
        if (is_wp_error($backup_key)) {
            wp_die(esc_html($backup_key->get_error_message()));
        }

        $updated = [];
        $skipped = [];
        foreach ($manifest['records'] as $record) {
            $result = self::update_record($record);
            if (is_wp_error($result)) {
                $skipped[] = [
                    'id' => absint($record['id'] ?? 0),
                    'code' => $result->get_error_code(),
                    'message' => $result->get_error_message(),
                ];
            } else {
                $updated[] = absint($record['id']);
            }
        }

        $result = [
            'completed_at' => gmdate('c'),
            'backup_option' => $backup_key,
            'manifest_sha256' => hash_file('sha256', RGV_COA_DIR . 'data/coa-source-truth.json'),
            'updated' => $updated,
            'skipped' => $skipped,
        ];
        update_option(self::RESULT_OPTION, $result, false);
        update_option('rgv_coa_schema_version', 2, false);
        RGV_COA_REST_API::clear_cache();

        wp_safe_redirect(add_query_arg([
            'page' => RGV_COA_Admin::MENU_SLUG . '-settings',
            'coa_migrated' => count($updated),
            'coa_skipped' => count($skipped),
        ], admin_url('admin.php')));
        exit;
    }
}
