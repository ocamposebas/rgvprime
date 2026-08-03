<?php

defined('ABSPATH') || exit;

final class RGV_COA_Admin {
    const MENU_SLUG = 'rgv-coa-library';

    public static function hooks() {
        add_action('admin_menu', [__CLASS__, 'menu']);
        add_action('admin_enqueue_scripts', [__CLASS__, 'assets']);
        add_action('admin_post_rgv_coa_save', [__CLASS__, 'save']);
        add_action('admin_post_rgv_coa_delete', [__CLASS__, 'delete']);
        add_action('admin_post_rgv_coa_save_settings', [__CLASS__, 'save_settings']);
    }

    private static function capability() {
        return class_exists('WooCommerce') ? 'manage_woocommerce' : 'manage_options';
    }

    public static function menu() {
        $capability = self::capability();

        add_menu_page(
            __('COA Library', 'rgv-coa-library'),
            __('COA Library', 'rgv-coa-library'),
            $capability,
            self::MENU_SLUG,
            [__CLASS__, 'library_page'],
            'dashicons-media-document',
            56
        );

        add_submenu_page(self::MENU_SLUG, __('Library', 'rgv-coa-library'), __('Library', 'rgv-coa-library'), $capability, self::MENU_SLUG, [__CLASS__, 'library_page']);
        add_submenu_page(self::MENU_SLUG, __('Add New COA', 'rgv-coa-library'), __('Add New', 'rgv-coa-library'), $capability, self::MENU_SLUG . '-edit', [__CLASS__, 'edit_page']);
        add_submenu_page(self::MENU_SLUG, __('Settings', 'rgv-coa-library'), __('Settings', 'rgv-coa-library'), $capability, self::MENU_SLUG . '-settings', [__CLASS__, 'settings_page']);
    }

    public static function assets($hook) {
        if (false === strpos((string) $hook, self::MENU_SLUG)) {
            return;
        }

        wp_enqueue_media();
        wp_enqueue_style('rgv-coa-admin', RGV_COA_URL . 'assets/admin.css', [], RGV_COA_VERSION);
        wp_enqueue_script('rgv-coa-admin', RGV_COA_URL . 'assets/admin.js', ['jquery'], RGV_COA_VERSION, true);

        if (class_exists('WooCommerce')) {
            wp_enqueue_style('woocommerce_admin_styles');
            wp_enqueue_script('wc-enhanced-select');
        }

        wp_localize_script('rgv-coa-admin', 'rgvCoaAdmin', [
            'mediaTitle' => __('Choose a COA PDF', 'rgv-coa-library'),
            'mediaButton' => __('Use this PDF', 'rgv-coa-library'),
        ]);
    }

    private static function authorize($nonce_action = '') {
        if (!current_user_can(self::capability())) {
            wp_die(esc_html__('You do not have permission to manage the COA Library.', 'rgv-coa-library'));
        }

        if ($nonce_action) {
            check_admin_referer($nonce_action);
        }
    }

    private static function page_url($page = '', $args = []) {
        $slug = self::MENU_SLUG . ($page ? '-' . $page : '');
        return add_query_arg($args, admin_url('admin.php?page=' . $slug));
    }

    private static function header($active, $title, $description) {
        $tabs = [
            'library' => ['label' => __('Library', 'rgv-coa-library'), 'url' => self::page_url()],
            'edit' => ['label' => __('Add New', 'rgv-coa-library'), 'url' => self::page_url('edit')],
            'settings' => ['label' => __('Settings', 'rgv-coa-library'), 'url' => self::page_url('settings')],
        ];
        ?>
        <div class="rgv-coa-shell">
            <header class="rgv-coa-hero">
                <div>
                    <span class="rgv-coa-eyebrow"><?php esc_html_e('Certificate management', 'rgv-coa-library'); ?></span>
                    <h1><?php echo esc_html($title); ?></h1>
                    <p><?php echo esc_html($description); ?></p>
                </div>
                <div class="rgv-coa-mark" aria-hidden="true">COA</div>
            </header>
            <nav class="rgv-coa-tabs" aria-label="<?php esc_attr_e('COA Library navigation', 'rgv-coa-library'); ?>">
                <?php foreach ($tabs as $key => $tab) : ?>
                    <a class="<?php echo $key === $active ? 'is-active' : ''; ?>" href="<?php echo esc_url($tab['url']); ?>">
                        <?php echo esc_html(strtoupper($tab['label'])); ?>
                    </a>
                <?php endforeach; ?>
            </nav>
        <?php
    }

    private static function footer() {
        echo '</div>';
    }

    public static function library_page() {
        self::authorize();

        $filter = sanitize_key(wp_unslash($_GET['status'] ?? 'all'));
        $search = sanitize_text_field(wp_unslash($_GET['s'] ?? ''));
        $args = [
            'post_type' => RGV_COA_Post_Type::POST_TYPE,
            'post_status' => 'publish',
            'posts_per_page' => 100,
            'orderby' => ['menu_order' => 'ASC', 'date' => 'DESC'],
        ];

        if ($search) {
            $args['s'] = $search;
        }

        if (in_array($filter, ['current', 'history'], true)) {
            $args['meta_query'] = [[
                'key' => RGV_COA_Post_Type::META_PREFIX . 'status',
                'value' => $filter,
            ]];
        }

        $query = new WP_Query($args);
        $counts = self::counts();
        self::header('library', __('COA Library', 'rgv-coa-library'), __('Manage every certificate, product connection, and shipping status from one organized workspace.', 'rgv-coa-library'));
        self::notice();
        ?>
        <section class="rgv-coa-stats">
            <div><span><?php esc_html_e('Current Shipping', 'rgv-coa-library'); ?></span><strong><?php echo esc_html(number_format_i18n($counts['current'])); ?></strong></div>
            <div><span><?php esc_html_e('History', 'rgv-coa-library'); ?></span><strong><?php echo esc_html(number_format_i18n($counts['history'])); ?></strong></div>
            <div><span><?php esc_html_e('Total Certificates', 'rgv-coa-library'); ?></span><strong><?php echo esc_html(number_format_i18n($counts['total'])); ?></strong></div>
        </section>

        <section class="rgv-coa-panel">
            <div class="rgv-coa-toolbar">
                <form method="get" class="rgv-coa-search">
                    <input type="hidden" name="page" value="<?php echo esc_attr(self::MENU_SLUG); ?>">
                    <input type="hidden" name="status" value="<?php echo esc_attr($filter); ?>">
                    <span class="dashicons dashicons-search" aria-hidden="true"></span>
                    <input type="search" name="s" value="<?php echo esc_attr($search); ?>" placeholder="<?php esc_attr_e('Search product, batch, or report ID…', 'rgv-coa-library'); ?>">
                    <button class="button"><?php esc_html_e('Search', 'rgv-coa-library'); ?></button>
                </form>
                <a class="rgv-coa-primary" href="<?php echo esc_url(self::page_url('edit')); ?>"><span class="dashicons dashicons-plus-alt2"></span><?php esc_html_e('Add COA', 'rgv-coa-library'); ?></a>
            </div>
            <div class="rgv-coa-filters">
                <?php foreach (['all' => __('All', 'rgv-coa-library'), 'current' => __('Current Shipping', 'rgv-coa-library'), 'history' => __('History', 'rgv-coa-library')] as $key => $label) : ?>
                    <a class="<?php echo $filter === $key ? 'is-active' : ''; ?>" href="<?php echo esc_url(self::page_url('', ['status' => $key, 's' => $search])); ?>"><?php echo esc_html($label); ?></a>
                <?php endforeach; ?>
            </div>

            <?php if ($query->have_posts()) : ?>
                <div class="rgv-coa-table-wrap">
                    <table class="rgv-coa-table">
                        <thead><tr><th><?php esc_html_e('Certificate', 'rgv-coa-library'); ?></th><th><?php esc_html_e('Batch / Results', 'rgv-coa-library'); ?></th><th><?php esc_html_e('Linked Products', 'rgv-coa-library'); ?></th><th><?php esc_html_e('Placement', 'rgv-coa-library'); ?></th><th><span class="screen-reader-text"><?php esc_html_e('Actions', 'rgv-coa-library'); ?></span></th></tr></thead>
                        <tbody>
                        <?php while ($query->have_posts()) : $query->the_post(); $post_id = get_the_ID(); self::record_row($post_id); endwhile; ?>
                        </tbody>
                    </table>
                </div>
            <?php else : ?>
                <div class="rgv-coa-empty">
                    <span class="dashicons dashicons-media-document"></span>
                    <h2><?php esc_html_e('No certificates found', 'rgv-coa-library'); ?></h2>
                    <p><?php esc_html_e('Add your first COA or adjust the current filters.', 'rgv-coa-library'); ?></p>
                    <a class="rgv-coa-primary" href="<?php echo esc_url(self::page_url('edit')); ?>"><?php esc_html_e('Add your first COA', 'rgv-coa-library'); ?></a>
                </div>
            <?php endif; wp_reset_postdata(); ?>
        </section>
        <?php
        self::footer();
    }

    private static function counts() {
        $counts = ['current' => 0, 'history' => 0, 'total' => 0];
        $ids = get_posts([
            'post_type' => RGV_COA_Post_Type::POST_TYPE,
            'post_status' => 'publish',
            'posts_per_page' => -1,
            'fields' => 'ids',
            'no_found_rows' => true,
        ]);

        foreach ($ids as $id) {
            $status = RGV_COA_Post_Type::sanitize_status(RGV_COA_Post_Type::meta($id, 'status'));
            $counts[$status]++;
            $counts['total']++;
        }

        return $counts;
    }

    private static function record_row($post_id) {
        $status = RGV_COA_Post_Type::sanitize_status(RGV_COA_Post_Type::meta($post_id, 'status'));
        $products = self::product_labels(RGV_COA_Post_Type::product_ids($post_id));
        $edit_url = self::page_url('edit', ['coa_id' => $post_id]);
        $delete_url = wp_nonce_url(admin_url('admin-post.php?action=rgv_coa_delete&coa_id=' . $post_id), 'rgv_coa_delete_' . $post_id);
        $document_url = RGV_COA_Post_Type::document_url($post_id);
        ?>
        <tr>
            <td>
                <div class="rgv-coa-record-title"><span class="dashicons dashicons-pdf"></span><div><strong><?php echo esc_html(RGV_COA_Post_Type::meta($post_id, 'product_name', get_the_title($post_id))); ?></strong><small><?php echo esc_html(RGV_COA_Post_Type::meta($post_id, 'report_code', __('No report ID', 'rgv-coa-library'))); ?></small></div></div>
            </td>
            <td><strong><?php echo esc_html(RGV_COA_Post_Type::meta($post_id, 'batch', '—')); ?></strong><small><?php echo esc_html(self::result_summary($post_id)); ?></small></td>
            <td><div class="rgv-coa-product-tags"><?php foreach ($products as $product) : ?><span><?php echo esc_html($product); ?></span><?php endforeach; ?><?php if (!$products) : ?><em><?php esc_html_e('Not linked', 'rgv-coa-library'); ?></em><?php endif; ?></div></td>
            <td><span class="rgv-coa-status rgv-coa-status--<?php echo esc_attr($status); ?>"><?php echo esc_html('history' === $status ? __('History', 'rgv-coa-library') : __('Current Shipping', 'rgv-coa-library')); ?></span></td>
            <td><div class="rgv-coa-actions"><?php if ($document_url) : ?><a href="<?php echo esc_url($document_url); ?>" target="_blank" rel="noopener" title="<?php esc_attr_e('Open PDF', 'rgv-coa-library'); ?>"><span class="dashicons dashicons-external"></span></a><?php endif; ?><a href="<?php echo esc_url($edit_url); ?>" title="<?php esc_attr_e('Edit', 'rgv-coa-library'); ?>"><span class="dashicons dashicons-edit"></span></a><a class="is-delete" data-rgv-delete href="<?php echo esc_url($delete_url); ?>" title="<?php esc_attr_e('Move to Trash', 'rgv-coa-library'); ?>"><span class="dashicons dashicons-trash"></span></a></div></td>
        </tr>
        <?php
    }

    private static function result_summary($post_id) {
        $parts = array_filter([
            RGV_COA_Post_Type::meta($post_id, 'purity') ? RGV_COA_Post_Type::meta($post_id, 'purity') . ' purity' : '',
            RGV_COA_Post_Type::meta($post_id, 'quantity'),
        ]);
        return $parts ? implode(' · ', $parts) : __('Results not entered', 'rgv-coa-library');
    }

    private static function product_labels($ids) {
        $labels = [];
        foreach ($ids as $id) {
            $product = function_exists('wc_get_product') ? wc_get_product($id) : null;
            $labels[] = $product ? wp_strip_all_tags($product->get_formatted_name()) : sprintf(__('Product #%d', 'rgv-coa-library'), $id);
        }
        return $labels;
    }

    public static function edit_page() {
        self::authorize();
        $post_id = absint($_GET['coa_id'] ?? 0);
        $post = $post_id ? get_post($post_id) : null;

        if ($post_id && (!$post || RGV_COA_Post_Type::POST_TYPE !== $post->post_type)) {
            wp_die(esc_html__('COA record not found.', 'rgv-coa-library'));
        }

        $is_edit = (bool) $post;
        self::header('edit', $is_edit ? __('Edit COA', 'rgv-coa-library') : __('Add New COA', 'rgv-coa-library'), __('Upload the laboratory document, enter its results, and choose exactly where it belongs.', 'rgv-coa-library'));
        self::notice();
        ?>
        <form class="rgv-coa-editor" method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <input type="hidden" name="action" value="rgv_coa_save">
            <input type="hidden" name="coa_id" value="<?php echo esc_attr($post_id); ?>">
            <?php wp_nonce_field('rgv_coa_save'); ?>

            <div class="rgv-coa-editor-main">
                <section class="rgv-coa-card">
                    <div class="rgv-coa-card-heading"><span>01</span><div><h2><?php esc_html_e('Certificate identity', 'rgv-coa-library'); ?></h2><p><?php esc_html_e('The information customers use to identify the correct batch.', 'rgv-coa-library'); ?></p></div></div>
                    <div class="rgv-coa-fields rgv-coa-fields--2">
                        <?php self::input($post_id, 'product_name', __('Product name', 'rgv-coa-library'), true, 'Retatrutide 30mg'); ?>
                        <?php self::input($post_id, 'sku', __('SKU', 'rgv-coa-library'), false, 'RGV-R3TA-30MG'); ?>
                        <?php self::input($post_id, 'report_code', __('Certificate / Report ID', 'rgv-coa-library'), true, 'RGVE2607030546'); ?>
                        <?php self::input($post_id, 'batch', __('Batch / Lot number', 'rgv-coa-library'), true, 'RT30-2501-01'); ?>
                    </div>
                </section>

                <section class="rgv-coa-card">
                    <div class="rgv-coa-card-heading"><span>02</span><div><h2><?php esc_html_e('Laboratory results', 'rgv-coa-library'); ?></h2><p><?php esc_html_e('Capture the key values shown on the original report.', 'rgv-coa-library'); ?></p></div></div>
                    <div class="rgv-coa-fields rgv-coa-fields--2">
                        <?php self::input($post_id, 'purity', __('Purity', 'rgv-coa-library'), false, '99.82%'); ?>
                        <?php self::input($post_id, 'quantity', __('Tested quantity / content', 'rgv-coa-library'), false, '30.14 mg'); ?>
                        <?php self::input($post_id, 'lab_name', __('Laboratory name', 'rgv-coa-library'), false, 'Laboratory name'); ?>
                        <?php self::input($post_id, 'sample_id', __('Sample ID', 'rgv-coa-library'), false, 'Sample reference'); ?>
                        <?php self::input($post_id, 'test_method', __('Test method', 'rgv-coa-library'), false, 'HPLC / MS'); ?>
                        <?php self::input($post_id, 'test_date', __('Test date', 'rgv-coa-library'), false, '', 'date'); ?>
                        <?php self::input($post_id, 'report_date', __('Report date', 'rgv-coa-library'), false, '', 'date'); ?>
                    </div>
                    <label class="rgv-coa-field rgv-coa-field--full"><span><?php esc_html_e('Certificate notes', 'rgv-coa-library'); ?></span><textarea name="notes" rows="4" placeholder="<?php esc_attr_e('Optional notes that may be shared through the public API…', 'rgv-coa-library'); ?>"><?php echo esc_textarea(get_post_meta($post_id, RGV_COA_Post_Type::META_PREFIX . 'notes', true)); ?></textarea></label>
                </section>

                <section class="rgv-coa-card">
                    <div class="rgv-coa-card-heading"><span>03</span><div><h2><?php esc_html_e('WooCommerce product linker', 'rgv-coa-library'); ?></h2><p><?php esc_html_e('Connect this certificate by product ID. Variations can be selected independently.', 'rgv-coa-library'); ?></p></div></div>
                    <?php self::product_selector($post_id); ?>
                    <div class="rgv-coa-fields rgv-coa-fields--2 rgv-coa-advanced">
                        <?php self::input($post_id, 'group_key', __('Library group', 'rgv-coa-library'), false, 'retatrutide-30mg'); ?>
                        <label class="rgv-coa-field"><span><?php esc_html_e('Search aliases', 'rgv-coa-library'); ?></span><textarea name="aliases" rows="3" placeholder="R3ta 30mg&#10;Reta 30mg"><?php echo esc_textarea(implode("\n", RGV_COA_Post_Type::aliases($post_id))); ?></textarea><small><?php esc_html_e('One alias per line. The group connects Current Shipping records to their History.', 'rgv-coa-library'); ?></small></label>
                    </div>
                </section>
            </div>

            <aside class="rgv-coa-editor-side">
                <section class="rgv-coa-card rgv-coa-sticky-card">
                    <h2><?php esc_html_e('Placement', 'rgv-coa-library'); ?></h2>
                    <?php $status = RGV_COA_Post_Type::sanitize_status(RGV_COA_Post_Type::meta($post_id, 'status')); ?>
                    <div class="rgv-coa-placement">
                        <label class="<?php echo 'current' === $status ? 'is-selected' : ''; ?>"><input type="radio" name="status" value="current" <?php checked($status, 'current'); ?>><span class="rgv-coa-radio-icon"><span class="dashicons dashicons-products"></span></span><strong><?php esc_html_e('Current Shipping', 'rgv-coa-library'); ?></strong><small><?php esc_html_e('Shown directly on linked product pages.', 'rgv-coa-library'); ?></small></label>
                        <label class="<?php echo 'history' === $status ? 'is-selected' : ''; ?>"><input type="radio" name="status" value="history" <?php checked($status, 'history'); ?>><span class="rgv-coa-radio-icon"><span class="dashicons dashicons-backup"></span></span><strong><?php esc_html_e('History', 'rgv-coa-library'); ?></strong><small><?php esc_html_e('Shown inside the History section only.', 'rgv-coa-library'); ?></small></label>
                    </div>

                    <hr>
                    <h2><?php esc_html_e('Certificate PDF', 'rgv-coa-library'); ?></h2>
                    <?php self::document_uploader($post_id); ?>

                    <div class="rgv-coa-publish-actions">
                        <button type="submit" class="rgv-coa-primary rgv-coa-primary--wide"><?php echo esc_html($is_edit ? __('Update COA', 'rgv-coa-library') : __('Publish COA', 'rgv-coa-library')); ?></button>
                        <a href="<?php echo esc_url(self::page_url()); ?>"><?php esc_html_e('Cancel', 'rgv-coa-library'); ?></a>
                    </div>
                </section>
            </aside>
        </form>
        <?php
        self::footer();
    }

    private static function input($post_id, $key, $label, $required = false, $placeholder = '', $type = 'text') {
        $value = RGV_COA_Post_Type::meta($post_id, $key);
        ?>
        <label class="rgv-coa-field"><span><?php echo esc_html($label); ?><?php if ($required) : ?><b aria-hidden="true">*</b><?php endif; ?></span><input type="<?php echo esc_attr($type); ?>" name="<?php echo esc_attr($key); ?>" value="<?php echo esc_attr($value); ?>" placeholder="<?php echo esc_attr($placeholder); ?>" <?php echo $required ? 'required' : ''; ?>></label>
        <?php
    }

    private static function product_selector($post_id) {
        $ids = RGV_COA_Post_Type::product_ids($post_id);
        if (class_exists('WooCommerce')) :
            ?>
            <label class="rgv-coa-field rgv-coa-field--full"><span><?php esc_html_e('Linked products and variations', 'rgv-coa-library'); ?><b>*</b></span><select class="wc-product-search" multiple="multiple" style="width:100%" name="product_ids[]" data-placeholder="<?php esc_attr_e('Search by product name, SKU, or ID…', 'rgv-coa-library'); ?>" data-action="woocommerce_json_search_products_and_variations">
                <?php foreach ($ids as $id) : $product = wc_get_product($id); if (!$product) continue; ?><option value="<?php echo esc_attr($id); ?>" selected><?php echo esc_html(wp_strip_all_tags($product->get_formatted_name())); ?></option><?php endforeach; ?>
            </select><small><?php esc_html_e('Current Shipping COAs appear only on these linked product or variation pages.', 'rgv-coa-library'); ?></small></label>
            <?php
        else :
            ?>
            <label class="rgv-coa-field rgv-coa-field--full"><span><?php esc_html_e('WooCommerce product IDs', 'rgv-coa-library'); ?></span><input type="text" name="product_ids_manual" value="<?php echo esc_attr(implode(',', $ids)); ?>" placeholder="123, 456"><small><?php esc_html_e('Enter comma-separated IDs. Install WooCommerce to enable visual product search.', 'rgv-coa-library'); ?></small></label>
            <?php
        endif;
    }

    private static function document_uploader($post_id) {
        $attachment_id = absint(get_post_meta($post_id, RGV_COA_Post_Type::META_PREFIX . 'attachment_id', true));
        $url = RGV_COA_Post_Type::document_url($post_id);
        ?>
        <div class="rgv-coa-upload <?php echo $url ? 'has-file' : ''; ?>" data-rgv-upload>
            <input type="hidden" name="attachment_id" value="<?php echo esc_attr($attachment_id); ?>" data-rgv-attachment>
            <span class="dashicons dashicons-cloud-upload"></span>
            <strong data-rgv-file-name><?php echo esc_html($url ? wp_basename($url) : __('No PDF selected', 'rgv-coa-library')); ?></strong>
            <small><?php esc_html_e('PDF files are stored safely in the WordPress Media Library.', 'rgv-coa-library'); ?></small>
            <button type="button" class="button" data-rgv-choose><?php echo esc_html($url ? __('Replace PDF', 'rgv-coa-library') : __('Choose PDF', 'rgv-coa-library')); ?></button>
            <button type="button" class="button-link-delete" data-rgv-remove <?php echo $url ? '' : 'hidden'; ?>><?php esc_html_e('Remove file', 'rgv-coa-library'); ?></button>
        </div>
        <label class="rgv-coa-field rgv-coa-url-field"><span><?php esc_html_e('Or external PDF URL', 'rgv-coa-library'); ?></span><input type="url" name="document_url" value="<?php echo esc_attr(RGV_COA_Post_Type::meta($post_id, 'document_url')); ?>" placeholder="https://…/certificate.pdf"></label>
        <?php
    }

    public static function save() {
        self::authorize('rgv_coa_save');
        $post_id = absint($_POST['coa_id'] ?? 0);
        $product_name = sanitize_text_field(wp_unslash($_POST['product_name'] ?? ''));
        $report_code = sanitize_text_field(wp_unslash($_POST['report_code'] ?? ''));
        $batch = sanitize_text_field(wp_unslash($_POST['batch'] ?? ''));
        $attachment_id = absint($_POST['attachment_id'] ?? 0);
        $document_url = esc_url_raw(wp_unslash($_POST['document_url'] ?? ''));
        $raw_product_ids = isset($_POST['product_ids']) ? (array) wp_unslash($_POST['product_ids']) : preg_split('/\s*,\s*/', wp_unslash($_POST['product_ids_manual'] ?? ''));
        $product_ids = array_values(array_unique(array_filter(array_map('absint', $raw_product_ids))));

        if (!$product_name || !$report_code || !$batch) {
            wp_die(esc_html__('Product name, Certificate / Report ID, and Batch / Lot number are required.', 'rgv-coa-library'));
        }

        if (!$attachment_id && !$document_url) {
            wp_die(esc_html__('Please choose a COA PDF or enter an external PDF URL.', 'rgv-coa-library'));
        }

        if ($attachment_id && 'application/pdf' !== get_post_mime_type($attachment_id)) {
            wp_die(esc_html__('The selected Media Library file must be a PDF.', 'rgv-coa-library'));
        }

        if (!$product_ids) {
            wp_die(esc_html__('Please link at least one WooCommerce product or variation.', 'rgv-coa-library'));
        }

        if ($post_id) {
            $post = get_post($post_id);
            if (!$post || RGV_COA_Post_Type::POST_TYPE !== $post->post_type) {
                wp_die(esc_html__('Invalid COA record.', 'rgv-coa-library'));
            }
        }

        $post_data = [
            'ID' => $post_id,
            'post_type' => RGV_COA_Post_Type::POST_TYPE,
            'post_status' => 'publish',
            'post_title' => $product_name . ' — ' . $batch . ' — ' . $report_code,
        ];
        $post_id = wp_insert_post(wp_slash($post_data), true);
        if (is_wp_error($post_id)) {
            wp_die(esc_html($post_id->get_error_message()));
        }

        $fields = ['product_name', 'sku', 'report_code', 'batch', 'purity', 'quantity', 'lab_name', 'sample_id', 'test_method', 'test_date', 'report_date', 'document_url'];
        foreach ($fields as $field) {
            $value = sanitize_text_field(wp_unslash($_POST[$field] ?? ''));
            if ('document_url' === $field) {
                $value = esc_url_raw($value);
            }
            update_post_meta($post_id, RGV_COA_Post_Type::META_PREFIX . $field, $value);
        }

        $group_key = sanitize_title(wp_unslash($_POST['group_key'] ?? '')) ?: sanitize_title($product_name);
        update_post_meta($post_id, RGV_COA_Post_Type::META_PREFIX . 'group_key', $group_key);
        update_post_meta($post_id, RGV_COA_Post_Type::META_PREFIX . 'status', RGV_COA_Post_Type::sanitize_status(wp_unslash($_POST['status'] ?? 'current')));
        update_post_meta($post_id, RGV_COA_Post_Type::META_PREFIX . 'attachment_id', $attachment_id);
        update_post_meta($post_id, RGV_COA_Post_Type::META_PREFIX . 'notes', wp_kses_post(wp_unslash($_POST['notes'] ?? '')));

        $raw_aliases = preg_split('/\r\n|\r|\n/', wp_unslash($_POST['aliases'] ?? ''));
        $aliases = array_values(array_unique(array_filter(array_map('sanitize_text_field', $raw_aliases))));
        update_post_meta($post_id, RGV_COA_Post_Type::META_PREFIX . 'aliases', $aliases);

        update_post_meta($post_id, RGV_COA_Post_Type::META_PREFIX . 'product_ids', $product_ids);

        RGV_COA_REST_API::clear_cache();
        wp_safe_redirect(self::page_url('', ['updated' => 1]));
        exit;
    }

    public static function delete() {
        $post_id = absint($_GET['coa_id'] ?? 0);
        self::authorize('rgv_coa_delete_' . $post_id);
        if ($post_id && RGV_COA_Post_Type::POST_TYPE === get_post_type($post_id)) {
            wp_trash_post($post_id);
            RGV_COA_REST_API::clear_cache();
        }
        wp_safe_redirect(self::page_url('', ['deleted' => 1]));
        exit;
    }

    public static function settings_page() {
        self::authorize();
        $settings = wp_parse_args(get_option('rgv_coa_settings', []), ['company_name' => 'RGVPRIME LLC', 'company_aliases' => '']);
        self::header('settings', __('Library Settings', 'rgv-coa-library'), __('Configure the public library identity used by your storefront and API.', 'rgv-coa-library'));
        self::notice();
        ?>
        <form class="rgv-coa-settings" method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <input type="hidden" name="action" value="rgv_coa_save_settings"><?php wp_nonce_field('rgv_coa_save_settings'); ?>
            <section class="rgv-coa-card">
                <div class="rgv-coa-card-heading"><span>01</span><div><h2><?php esc_html_e('Library identity', 'rgv-coa-library'); ?></h2><p><?php esc_html_e('These names help customers find your certificates in the public library.', 'rgv-coa-library'); ?></p></div></div>
                <div class="rgv-coa-fields">
                    <label class="rgv-coa-field"><span><?php esc_html_e('Company / Library name', 'rgv-coa-library'); ?></span><input type="text" name="company_name" value="<?php echo esc_attr($settings['company_name']); ?>" required></label>
                    <label class="rgv-coa-field"><span><?php esc_html_e('Company search aliases', 'rgv-coa-library'); ?></span><textarea name="company_aliases" rows="7" placeholder="RGVPrime&#10;RGV Elite"><?php echo esc_textarea($settings['company_aliases']); ?></textarea><small><?php esc_html_e('One alias per line.', 'rgv-coa-library'); ?></small></label>
                </div>
                <div class="rgv-coa-api-note"><span class="dashicons dashicons-rest-api"></span><div><strong><?php esc_html_e('Public API endpoint', 'rgv-coa-library'); ?></strong><code><?php echo esc_html(rest_url(RGV_COA_REST_API::NAMESPACE . '/library')); ?></code></div></div>
                <button class="rgv-coa-primary" type="submit"><?php esc_html_e('Save Settings', 'rgv-coa-library'); ?></button>
            </section>
        </form>
        <?php
        self::footer();
    }

    public static function save_settings() {
        self::authorize('rgv_coa_save_settings');
        update_option('rgv_coa_settings', [
            'company_name' => sanitize_text_field(wp_unslash($_POST['company_name'] ?? 'RGVPRIME LLC')),
            'company_aliases' => sanitize_textarea_field(wp_unslash($_POST['company_aliases'] ?? '')),
        ]);
        RGV_COA_REST_API::clear_cache();
        wp_safe_redirect(self::page_url('settings', ['updated' => 1]));
        exit;
    }

    private static function notice() {
        if (!empty($_GET['updated'])) {
            echo '<div class="rgv-coa-notice is-success"><span class="dashicons dashicons-yes-alt"></span>' . esc_html__('Changes saved successfully.', 'rgv-coa-library') . '</div>';
        } elseif (!empty($_GET['deleted'])) {
            echo '<div class="rgv-coa-notice"><span class="dashicons dashicons-trash"></span>' . esc_html__('The certificate was moved to Trash.', 'rgv-coa-library') . '</div>';
        }
    }
}
