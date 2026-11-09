<?php
/**
 * Plugin Name: RGVPRIME New Arrival Emails
 * Plugin URI: https://rgvprimellc.com/
 * Description: Detects newly published WooCommerce products and lets administrators create, preview, test, queue and send polished new-arrival email campaigns.
 * Version: 1.3.0
 * Author: RGVPRIME LLC
 * Requires at least: 6.5
 * Requires PHP: 8.0
 * Requires Plugins: woocommerce
 * Text Domain: rgvprime-new-arrivals
 */

defined( 'ABSPATH' ) || exit;

final class RGVPRIME_New_Arrivals_Email {
    const VERSION = '1.3.0';
    const OPTION_KEY = 'rgvne_settings';
    const CRON_HOOK = 'rgvne_process_campaign_batch';
    const AS_GROUP = 'rgvprime-new-arrivals';

    private static $instance = null;

    public static function instance() {
        if ( null === self::$instance ) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        register_activation_hook( __FILE__, array( __CLASS__, 'activate' ) );

        add_action( 'plugins_loaded', array( $this, 'plugins_loaded' ) );
        add_action( 'transition_post_status', array( $this, 'detect_new_product' ), 10, 3 );

        add_action( 'admin_menu', array( $this, 'admin_menu' ) );
        add_action( 'admin_enqueue_scripts', array( $this, 'admin_assets' ) );
        add_action( 'admin_init', array( $this, 'handle_admin_actions' ) );
        add_action( 'admin_notices', array( $this, 'dependency_notice' ) );
        add_action( 'wp_ajax_rgvne_live_preview', array( $this, 'handle_live_preview' ) );
        add_action( 'wp_ajax_rgvne_import_wc_customers_batch', array( $this, 'handle_import_wc_customers_batch' ) );

        add_action( self::CRON_HOOK, array( $this, 'process_campaign_batch' ), 10, 1 );

        add_shortcode( 'rgvprime_new_arrival_signup', array( $this, 'signup_shortcode' ) );
        add_action( 'init', array( $this, 'handle_signup' ) );
        add_action( 'template_redirect', array( $this, 'handle_unsubscribe' ) );
    }

    public static function activate() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';

        $charset = $wpdb->get_charset_collate();
        $subscribers = $wpdb->prefix . 'rgvne_subscribers';
        $campaigns   = $wpdb->prefix . 'rgvne_campaigns';
        $queue       = $wpdb->prefix . 'rgvne_queue';

        $sql1 = "CREATE TABLE {$subscribers} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            email varchar(191) NOT NULL,
            first_name varchar(100) NOT NULL DEFAULT '',
            status varchar(20) NOT NULL DEFAULT 'active',
            source varchar(50) NOT NULL DEFAULT 'manual',
            token char(64) NOT NULL,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY email (email),
            UNIQUE KEY token (token),
            KEY status (status)
        ) {$charset};";

        $sql2 = "CREATE TABLE {$campaigns} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            subject text NOT NULL,
            preheader text NOT NULL,
            heading text NOT NULL,
            description longtext NOT NULL,
            cta_text varchar(100) NOT NULL DEFAULT 'Explore new arrivals',
            items longtext NOT NULL,
            status varchar(20) NOT NULL DEFAULT 'draft',
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            sent_count bigint(20) unsigned NOT NULL DEFAULT 0,
            failed_count bigint(20) unsigned NOT NULL DEFAULT 0,
            PRIMARY KEY  (id),
            KEY status (status)
        ) {$charset};";

        $sql3 = "CREATE TABLE {$queue} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            campaign_id bigint(20) unsigned NOT NULL,
            email varchar(191) NOT NULL,
            first_name varchar(100) NOT NULL DEFAULT '',
            status varchar(20) NOT NULL DEFAULT 'pending',
            attempts tinyint(3) unsigned NOT NULL DEFAULT 0,
            last_error text NULL,
            created_at datetime NOT NULL,
            sent_at datetime NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY campaign_email (campaign_id,email),
            KEY campaign_status (campaign_id,status)
        ) {$charset};";

        dbDelta( $sql1 );
        dbDelta( $sql2 );
        dbDelta( $sql3 );

        $defaults = array(
            'logo_id'      => 0,
            'logo_url'     => '',
            'accent_color' => '#a00000',
            'batch_size'   => 20,
        );
        if ( ! get_option( self::OPTION_KEY ) ) {
            add_option( self::OPTION_KEY, $defaults, '', false );
        }
    }

    public function plugins_loaded() {
        if ( class_exists( 'WooCommerce' ) ) {
            add_action( 'woocommerce_checkout_after_customer_details', array( $this, 'checkout_optin_field' ) );
            add_action( 'woocommerce_checkout_create_order', array( $this, 'save_checkout_optin' ), 10, 2 );
            add_action( 'woocommerce_checkout_order_processed', array( $this, 'subscribe_from_order' ), 10, 3 );
        }
    }

    private function tables() {
        global $wpdb;
        return array(
            'subscribers' => $wpdb->prefix . 'rgvne_subscribers',
            'campaigns'   => $wpdb->prefix . 'rgvne_campaigns',
            'queue'       => $wpdb->prefix . 'rgvne_queue',
        );
    }

    private function settings() {
        $defaults = array(
            'logo_id'      => 0,
            'logo_url'     => '',
            'accent_color' => '#a00000',
            'batch_size'   => 20,
        );
        return wp_parse_args( get_option( self::OPTION_KEY, array() ), $defaults );
    }

    public function dependency_notice() {
        if ( current_user_can( 'manage_woocommerce' ) && ! class_exists( 'WooCommerce' ) ) {
            echo '<div class="notice notice-error"><p><strong>RGVPRIME New Arrival Emails:</strong> WooCommerce must be active.</p></div>';
        }
    }

    public function detect_new_product( $new_status, $old_status, $post ) {
        if ( 'product' !== $post->post_type || 'publish' !== $new_status || 'publish' === $old_status ) {
            return;
        }

        if ( wp_is_post_revision( $post->ID ) || wp_is_post_autosave( $post->ID ) ) {
            return;
        }

        if ( get_post_meta( $post->ID, '_rgvne_detected_once', true ) ) {
            return;
        }

        update_post_meta( $post->ID, '_rgvne_detected_once', gmdate( 'c' ) );
        update_post_meta( $post->ID, '_rgvne_new_arrival_pending', '1' );
        update_post_meta( $post->ID, '_rgvne_detected_at', current_time( 'mysql' ) );
    }

    public function admin_menu() {
        add_submenu_page(
            'woocommerce',
            'New Arrival Emails',
            'New Arrival Emails',
            'manage_woocommerce',
            'rgvprime-new-arrivals',
            array( $this, 'render_admin_page' )
        );
    }

    public function admin_assets( $hook ) {
        if ( false === strpos( $hook, 'rgvprime-new-arrivals' ) ) {
            return;
        }
        wp_enqueue_style( 'rgvne-admin', plugins_url( 'assets/admin.css', __FILE__ ), array(), self::VERSION );
        wp_enqueue_script( 'rgvne-admin', plugins_url( 'assets/admin.js', __FILE__ ), array(), self::VERSION, true );
        wp_localize_script( 'rgvne-admin', 'RGVNE_PREVIEW', array(
            'ajaxUrl' => admin_url( 'admin-ajax.php' ),
            'nonce'   => wp_create_nonce( 'rgvne_live_preview' ),
        ) );
        wp_localize_script( 'rgvne-admin', 'RGVNE_WC_IMPORT', array(
            'ajaxUrl' => admin_url( 'admin-ajax.php' ),
            'nonce'   => wp_create_nonce( 'rgvne_wc_import' ),
        ) );
    }

    private function admin_url( $args = array() ) {
        return add_query_arg( $args, admin_url( 'admin.php?page=rgvprime-new-arrivals' ) );
    }

    public function render_admin_page() {
        if ( ! current_user_can( 'manage_woocommerce' ) ) {
            return;
        }

        $tab  = isset( $_GET['tab'] ) ? sanitize_key( wp_unslash( $_GET['tab'] ) ) : 'arrivals';
        $view = isset( $_GET['view'] ) ? sanitize_key( wp_unslash( $_GET['view'] ) ) : '';

        echo '<div class="wrap rgvne-wrap">';
        echo '<div class="rgvne-hero"><div><span class="rgvne-kicker">RGVPRIME LLC</span><h1>New Arrival Emails</h1><p>Detect new products, build a premium launch email, preview it live, test it, import subscribers, and send safely in batches.</p></div><div class="rgvne-badge">v' . esc_html( self::VERSION ) . '</div></div>';

        $this->render_admin_notice_from_query();

        echo '<nav class="nav-tab-wrapper rgvne-tabs">';
        $tabs = array( 'arrivals' => 'New Arrivals', 'campaigns' => 'Campaigns', 'subscribers' => 'Subscribers', 'settings' => 'Design & Queue' );
        foreach ( $tabs as $key => $label ) {
            $class = ( $tab === $key ) ? 'nav-tab nav-tab-active' : 'nav-tab';
            echo '<a class="' . esc_attr( $class ) . '" href="' . esc_url( $this->admin_url( array( 'tab' => $key ) ) ) . '">' . esc_html( $label ) . '</a>';
        }
        echo '</nav>';

        if ( 'campaigns' === $tab && in_array( $view, array( 'new', 'edit' ), true ) ) {
            $this->render_campaign_editor();
        } elseif ( 'campaigns' === $tab ) {
            $this->render_campaigns();
        } elseif ( 'subscribers' === $tab ) {
            $this->render_subscribers();
        } elseif ( 'settings' === $tab ) {
            $this->render_settings();
        } else {
            $this->render_arrivals();
        }

        echo '</div>';
    }

    private function render_admin_notice_from_query() {
        if ( empty( $_GET['rgvne_notice'] ) ) {
            return;
        }
        $notice = sanitize_key( wp_unslash( $_GET['rgvne_notice'] ) );
        if ( 'omnisend_imported' === $notice ) {
            $active  = absint( $_GET['active'] ?? 0 );
            $unsub   = absint( $_GET['unsub'] ?? 0 );
            $invalid = absint( $_GET['invalid'] ?? 0 );
            printf(
                '<div class="notice notice-success is-dismissible"><p>Omnisend import complete: <strong>%1$d</strong> active contacts imported/updated, <strong>%2$d</strong> unsubscribed or suppressed contacts, <strong>%3$d</strong> invalid/skipped rows.</p></div>',
                $active,
                $unsub,
                $invalid
            );
            return;
        }
        $map = array(
            'saved'        => array( 'success', 'Campaign saved.' ),
            'test_sent'    => array( 'success', 'Test email sent successfully through the site mail transport.' ),
            'test_invalid' => array( 'error', 'Enter a valid email address in “Send test to”.' ),
            'test_failed'  => array( 'error', 'The test email could not be handed to WordPress mail. Check your SMTP/mail logs.' ),
            'queued'       => array( 'success', 'Campaign queued. Delivery will continue in controlled batches.' ),
            'subscriber'  => array( 'success', 'Subscriber saved.' ),
            'imported'    => array( 'success', 'Eligible WooCommerce customers imported into the subscriber list.' ),
            'wc_import_use_batch' => array( 'warning', 'The WooCommerce importer was upgraded. Reload this page and use the batch import button.' ),
            'settings'    => array( 'success', 'Settings saved.' ),
            'archived'    => array( 'success', 'New-arrival item archived.' ),
            'error'       => array( 'error', 'Something could not be completed. Check the details and try again.' ),
        );
        if ( isset( $map[ $notice ] ) ) {
            printf( '<div class="notice notice-%1$s is-dismissible"><p>%2$s</p></div>', esc_attr( $map[ $notice ][0] ), esc_html( $map[ $notice ][1] ) );
        }
    }

    private function get_recent_products( $days = 7 ) {
        $days = max( 1, absint( $days ) );
        return get_posts( array(
            'post_type'      => 'product',
            'post_status'    => 'publish',
            'posts_per_page' => 100,
            'orderby'        => 'date',
            'order'          => 'DESC',
            'date_query'     => array(
                array(
                    'after'     => $days . ' days ago',
                    'inclusive' => true,
                    'column'    => 'post_date',
                ),
            ),
        ) );
    }

    private function product_card_data( $product_id ) {
        $product = function_exists( 'wc_get_product' ) ? wc_get_product( $product_id ) : null;
        if ( ! $product ) {
            return null;
        }
        $image = wp_get_attachment_image_url( $product->get_image_id(), 'woocommerce_thumbnail' );
        if ( ! $image ) {
            $image = function_exists( 'wc_placeholder_img_src' ) ? wc_placeholder_img_src( 'woocommerce_thumbnail' ) : '';
        }
        $short = $product->get_short_description();
        if ( ! $short ) {
            $short = wp_trim_words( wp_strip_all_tags( $product->get_description() ), 28 );
        }
        return array(
            'id'          => $product_id,
            'name'        => $product->get_name(),
            'description' => wp_trim_words( wp_strip_all_tags( $short ), 34 ),
            'url'         => $product->get_permalink(),
            'image'       => $image,
            'price_html'  => $product->get_price_html(),
        );
    }

    private function render_arrivals() {
        $products = $this->get_recent_products( 7 );
        echo '<div class="rgvne-section-head"><div><h2>Products added in the last 7 days</h2><p>Every published WooCommerce product from the last 7 days appears here automatically, including products created before this plugin was installed.</p></div></div>';

        if ( ! $products ) {
            echo '<div class="rgvne-empty"><div class="rgvne-empty-icon">✓</div><h3>No products from the last 7 days</h3><p>Publish a WooCommerce product and it will appear here automatically for 7 days.</p></div>';
            return;
        }

        echo '<form method="get" action="' . esc_url( admin_url( 'admin.php' ) ) . '">';
        echo '<input type="hidden" name="page" value="rgvprime-new-arrivals"><input type="hidden" name="tab" value="campaigns"><input type="hidden" name="view" value="new">';
        echo '<div class="rgvne-grid">';
        foreach ( $products as $post ) {
            $data = $this->product_card_data( $post->ID );
            if ( ! $data ) { continue; }
            $published = get_the_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), $post->ID );
            echo '<label class="rgvne-product-card">';
            echo '<input type="checkbox" name="products[]" value="' . absint( $post->ID ) . '">';
            echo '<div class="rgvne-product-image"><img src="' . esc_url( $data['image'] ) . '" alt=""></div>';
            echo '<div class="rgvne-product-copy"><span class="rgvne-pill">NEW</span><h3>' . esc_html( $data['name'] ) . '</h3><p>' . esc_html( $data['description'] ) . '</p><small>Published ' . esc_html( $published ) . '</small></div>';
            echo '</label>';
        }
        echo '</div>';
        echo '<div class="rgvne-sticky-actions"><span>Select one or more products.</span><button class="button button-primary button-hero">Create email campaign</button></div>';
        echo '</form>';
    }

    private function render_campaigns() {
        global $wpdb;
        $t = $this->tables();
        $campaigns = $wpdb->get_results( "SELECT * FROM {$t['campaigns']} ORDER BY id DESC LIMIT 100" ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared

        echo '<div class="rgvne-section-head"><div><h2>Campaigns</h2><p>Drafts, queued sends, and completed new-arrival announcements.</p></div><a class="button button-primary" href="' . esc_url( $this->admin_url( array( 'tab' => 'campaigns', 'view' => 'new' ) ) ) . '">New campaign</a></div>';

        if ( ! $campaigns ) {
            echo '<div class="rgvne-empty"><h3>No campaigns yet</h3><p>Create one from a detected product or start a new campaign here.</p></div>';
            return;
        }

        echo '<div class="rgvne-table-card"><table class="widefat striped"><thead><tr><th>ID</th><th>Subject</th><th>Status</th><th>Sent</th><th>Failed</th><th>Updated</th><th>Actions</th></tr></thead><tbody>';
        foreach ( $campaigns as $c ) {
            $status_class = 'rgvne-status-' . sanitize_html_class( $c->status );
            $edit = $this->admin_url( array( 'tab' => 'campaigns', 'view' => 'edit', 'id' => absint( $c->id ) ) );
            $preview = wp_nonce_url( $this->admin_url( array( 'rgvne_action' => 'preview', 'campaign_id' => absint( $c->id ) ) ), 'rgvne_preview_' . absint( $c->id ) );
            echo '<tr><td>#' . absint( $c->id ) . '</td><td><strong>' . esc_html( $c->subject ) . '</strong></td><td><span class="rgvne-status ' . esc_attr( $status_class ) . '">' . esc_html( ucfirst( $c->status ) ) . '</span></td><td>' . absint( $c->sent_count ) . '</td><td>' . absint( $c->failed_count ) . '</td><td>' . esc_html( $c->updated_at ) . '</td><td><a href="' . esc_url( $edit ) . '">Edit</a> · <a target="_blank" href="' . esc_url( $preview ) . '">Preview</a></td></tr>';
        }
        echo '</tbody></table></div>';
    }

    private function get_campaign( $id ) {
        global $wpdb;
        $t = $this->tables();
        return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['campaigns']} WHERE id = %d", $id ) );
    }

    private function render_campaign_editor() {
        $id = isset( $_GET['id'] ) ? absint( $_GET['id'] ) : 0;
        $campaign = $id ? $this->get_campaign( $id ) : null;
        $selected_ids = array();
        $items = array();

        if ( $campaign ) {
            $items = json_decode( $campaign->items, true );
            if ( ! is_array( $items ) ) { $items = array(); }
            $selected_ids = array_map( 'absint', wp_list_pluck( $items, 'id' ) );
        } elseif ( ! empty( $_GET['products'] ) ) {
            $raw = (array) $_GET['products'];
            $selected_ids = array_values( array_filter( array_map( 'absint', $raw ) ) );
            foreach ( $selected_ids as $pid ) {
                $data = $this->product_card_data( $pid );
                if ( $data ) { $items[] = $data; }
            }
        }

        $subject     = $campaign ? $campaign->subject : 'New arrivals are here — RGVPRIME LLC';
        $preheader   = $campaign ? $campaign->preheader : 'Explore the latest additions now available from RGVPRIME LLC.';
        $heading     = $campaign ? $campaign->heading : 'New arrivals. Now available.';
        $description = $campaign ? $campaign->description : 'Fresh additions have just landed. Explore the newest products now available in the RGVPRIME LLC catalog.';
        $cta_text    = $campaign ? $campaign->cta_text : 'Explore new arrivals';
        $status      = $campaign ? $campaign->status : 'draft';

        echo '<div class="rgvne-editor-head"><div><a href="' . esc_url( $this->admin_url( array( 'tab' => 'campaigns' ) ) ) . '">← Back to campaigns</a><h2>' . ( $campaign ? 'Edit campaign #' . absint( $id ) : 'Create campaign' ) . '</h2></div>';
        if ( $campaign ) {
            $preview = wp_nonce_url( $this->admin_url( array( 'rgvne_action' => 'preview', 'campaign_id' => $id ) ), 'rgvne_preview_' . $id );
            echo '<a class="button" target="_blank" href="' . esc_url( $preview ) . '">Open preview</a>';
        }
        echo '</div>';

        echo '<form method="post" class="rgvne-editor-form">';
        wp_nonce_field( 'rgvne_save_campaign', 'rgvne_nonce' );
        echo '<input type="hidden" name="rgvne_action" value="save_campaign"><input type="hidden" name="campaign_id" value="' . absint( $id ) . '">';
        echo '<div class="rgvne-editor-layout"><div class="rgvne-main-column">';

        echo '<div class="rgvne-card"><h3>Email copy</h3><div class="rgvne-field"><label>EMAIL SUBJECT <span>Inbox subject line</span></label><input type="text" name="subject" maxlength="180" required value="' . esc_attr( $subject ) . '"></div>';
        echo '<div class="rgvne-field"><label>PREHEADER <span>Small preview text after the subject</span></label><input type="text" name="preheader" maxlength="220" value="' . esc_attr( $preheader ) . '"></div>';
        echo '<div class="rgvne-field"><label>EMAIL TITLE <span>Main title inside the email</span></label><input type="text" name="heading" maxlength="180" required value="' . esc_attr( $heading ) . '"></div>';
        echo '<div class="rgvne-field"><label>EMAIL DESCRIPTION <span>Main message shown above the products</span></label><textarea name="description" rows="5" required>' . esc_textarea( $description ) . '</textarea></div>';
        echo '<div class="rgvne-field"><label>CTA BUTTON TEXT</label><input type="text" name="cta_text" maxlength="100" value="' . esc_attr( $cta_text ) . '"></div></div>';

        echo '<div class="rgvne-card"><div class="rgvne-card-title-row"><div><h3>Products in this email</h3><p>You can override the display title and description without changing the WooCommerce product itself.</p></div></div>';

        $available = $this->get_recent_products( 7 );
        $candidate_ids = array_unique( array_merge( $selected_ids, array_map( function( $p ) { return $p->ID; }, $available ) ) );
        if ( ! $candidate_ids ) {
            echo '<p>No products published in the last 7 days are available. Publish a product or open an existing campaign that already contains products.</p>';
        }

        foreach ( $candidate_ids as $pid ) {
            $base = $this->product_card_data( $pid );
            if ( ! $base ) { continue; }
            $existing = null;
            foreach ( $items as $item ) {
                if ( absint( $item['id'] ?? 0 ) === absint( $pid ) ) { $existing = $item; break; }
            }
            $checked = in_array( absint( $pid ), $selected_ids, true );
            $display_title = $existing['display_title'] ?? $base['name'];
            $display_desc  = $existing['display_description'] ?? $base['description'];
            echo '<div class="rgvne-item-editor">';
            echo '<label class="rgvne-item-toggle"><input type="checkbox" name="product_ids[]" value="' . absint( $pid ) . '" ' . checked( $checked, true, false ) . '> Include</label>';
            echo '<img src="' . esc_url( $base['image'] ) . '" alt="">';
            echo '<div><strong>' . esc_html( $base['name'] ) . '</strong><div class="rgvne-mini-grid"><input type="text" name="item_title[' . absint( $pid ) . ']" value="' . esc_attr( $display_title ) . '" placeholder="Display title"><textarea name="item_desc[' . absint( $pid ) . ']" rows="3" placeholder="Display description">' . esc_textarea( $display_desc ) . '</textarea></div></div>';
            echo '</div>';
        }
        echo '</div>';

        echo '</div><aside class="rgvne-side-column"><div class="rgvne-card rgvne-side-card"><h3>Campaign controls</h3><div class="rgvne-state-line"><span>Status</span><strong>' . esc_html( ucfirst( $status ) ) . '</strong></div>';
        echo '<button type="submit" class="button button-primary button-hero rgvne-full">Save campaign</button>';
        echo '<p class="description">The preview updates while you edit. You can send a test to any valid email address before launching.</p></div>';

        echo '<div class="rgvne-card rgvne-side-card rgvne-preview-card"><div class="rgvne-preview-head"><div><h3>Live email preview</h3><p>Uses the same HTML that will be sent through WordPress/SMTP.</p></div><div class="rgvne-preview-switch"><button type="button" class="button button-small is-active" data-rgvne-preview-size="desktop">Desktop</button><button type="button" class="button button-small" data-rgvne-preview-size="mobile">Mobile</button></div></div><div class="rgvne-preview-stage"><div class="rgvne-preview-loading">Building preview…</div><iframe id="rgvne-live-preview" title="Email preview" sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe></div></div>';

        echo '<div class="rgvne-card rgvne-side-card"><h3>Send a test</h3><p>Enter the exact inbox where you want to receive the test. It uses the same HTML and your existing WordPress SMTP transport.</p><label class="rgvne-test-label" for="rgvne-test-email">SEND TEST TO</label><input id="rgvne-test-email" type="email" name="test_email" value="' . esc_attr( wp_get_current_user()->user_email ) . '" placeholder="name@example.com" autocomplete="email"><button type="submit" name="rgvne_secondary_action" value="test" class="button rgvne-full">Send test email</button><p class="description">For a brand-new campaign, clicking this first saves it as a draft, then sends the test.</p></div>';

        if ( $campaign && 'draft' === $status ) {
            echo '<div class="rgvne-card rgvne-side-card rgvne-danger-zone"><h3>Launch campaign</h3><p>This sends to every <strong>active subscriber</strong>. Duplicate addresses are automatically prevented.</p><label class="rgvne-confirm"><input type="checkbox" name="confirm_send" value="1"> I reviewed the preview and recipients.</label><button type="submit" name="rgvne_secondary_action" value="launch" class="button button-primary rgvne-full">Queue live campaign</button></div>';
        }
        echo '</aside></div></form>';
    }

    private function sanitize_campaign_items( $product_ids, $titles, $descs ) {
        $items = array();
        foreach ( array_unique( array_map( 'absint', (array) $product_ids ) ) as $pid ) {
            $base = $this->product_card_data( $pid );
            if ( ! $base ) { continue; }
            $base['display_title'] = isset( $titles[ $pid ] ) ? sanitize_text_field( wp_unslash( $titles[ $pid ] ) ) : $base['name'];
            $base['display_description'] = isset( $descs[ $pid ] ) ? sanitize_textarea_field( wp_unslash( $descs[ $pid ] ) ) : $base['description'];
            $items[] = $base;
        }
        return $items;
    }

    public function handle_admin_actions() {
        // admin-ajax.php also runs admin_init. Never let an AJAX preview request
        // fall through to normal form actions such as save_campaign/test/launch.
        if ( wp_doing_ajax() ) {
            return;
        }

        if ( ! is_admin() || ! current_user_can( 'manage_woocommerce' ) ) {
            return;
        }

        $action = '';
        if ( isset( $_POST['rgvne_action'] ) ) {
            $action = sanitize_key( wp_unslash( $_POST['rgvne_action'] ) );
        } elseif ( isset( $_GET['rgvne_action'] ) ) {
            $action = sanitize_key( wp_unslash( $_GET['rgvne_action'] ) );
        }

        if ( 'save_campaign' === $action ) {
            $this->handle_save_campaign();
        } elseif ( 'preview' === $action ) {
            $this->handle_preview();
        } elseif ( 'add_subscriber' === $action ) {
            $this->handle_add_subscriber();
        } elseif ( 'import_customers' === $action ) {
            $this->handle_import_customers();
        } elseif ( 'import_omnisend' === $action ) {
            $this->handle_import_omnisend();
        } elseif ( 'save_settings' === $action ) {
            $this->handle_save_settings();
        } elseif ( 'archive_arrival' === $action ) {
            $this->handle_archive_arrival();
        }
    }

    private function handle_save_campaign() {
        check_admin_referer( 'rgvne_save_campaign', 'rgvne_nonce' );
        global $wpdb;
        $t = $this->tables();

        $id          = isset( $_POST['campaign_id'] ) ? absint( $_POST['campaign_id'] ) : 0;
        $subject     = sanitize_text_field( wp_unslash( $_POST['subject'] ?? '' ) );
        $preheader   = sanitize_text_field( wp_unslash( $_POST['preheader'] ?? '' ) );
        $heading     = sanitize_text_field( wp_unslash( $_POST['heading'] ?? '' ) );
        $description = sanitize_textarea_field( wp_unslash( $_POST['description'] ?? '' ) );
        $cta_text    = sanitize_text_field( wp_unslash( $_POST['cta_text'] ?? 'Explore new arrivals' ) );
        $items       = $this->sanitize_campaign_items( $_POST['product_ids'] ?? array(), $_POST['item_title'] ?? array(), $_POST['item_desc'] ?? array() );

        if ( ! $subject || ! $heading || ! $description || ! $items ) {
            wp_safe_redirect( $this->admin_url( array( 'tab' => 'campaigns', 'view' => $id ? 'edit' : 'new', 'id' => $id, 'rgvne_notice' => 'error' ) ) );
            exit;
        }

        $data = array(
            'subject'     => $subject,
            'preheader'   => $preheader,
            'heading'     => $heading,
            'description' => $description,
            'cta_text'    => $cta_text,
            'items'       => wp_json_encode( $items ),
            'updated_at'  => current_time( 'mysql' ),
        );

        if ( $id ) {
            $existing_campaign = $this->get_campaign( $id );
            if ( ! $existing_campaign ) {
                wp_safe_redirect( $this->admin_url( array( 'tab' => 'campaigns', 'rgvne_notice' => 'error' ) ) );
                exit;
            }
            if ( 'draft' === $existing_campaign->status ) {
                $wpdb->update( $t['campaigns'], $data, array( 'id' => $id ) );
            }
        } else {
            $data['created_at'] = current_time( 'mysql' );
            $data['status'] = 'draft';
            $wpdb->insert( $t['campaigns'], $data );
            $id = absint( $wpdb->insert_id );
        }

        $secondary = sanitize_key( wp_unslash( $_POST['rgvne_secondary_action'] ?? '' ) );
        if ( 'test' === $secondary ) {
            $email = sanitize_email( wp_unslash( $_POST['test_email'] ?? '' ) );
            $campaign = $this->get_campaign( $id );

            if ( ! $email || ! is_email( $email ) ) {
                wp_safe_redirect( $this->admin_url( array( 'tab' => 'campaigns', 'view' => 'edit', 'id' => $id, 'rgvne_notice' => 'test_invalid' ) ) );
                exit;
            }

            if ( $campaign && $this->send_campaign_email( $campaign, $email, 'Test', true ) ) {
                wp_safe_redirect( $this->admin_url( array( 'tab' => 'campaigns', 'view' => 'edit', 'id' => $id, 'rgvne_notice' => 'test_sent' ) ) );
            } else {
                wp_safe_redirect( $this->admin_url( array( 'tab' => 'campaigns', 'view' => 'edit', 'id' => $id, 'rgvne_notice' => 'test_failed' ) ) );
            }
            exit;
        }

        if ( 'launch' === $secondary ) {
            if ( empty( $_POST['confirm_send'] ) ) {
                wp_safe_redirect( $this->admin_url( array( 'tab' => 'campaigns', 'view' => 'edit', 'id' => $id, 'rgvne_notice' => 'error' ) ) );
                exit;
            }
            $ok = $this->queue_campaign( $id );
            wp_safe_redirect( $this->admin_url( array( 'tab' => 'campaigns', 'view' => 'edit', 'id' => $id, 'rgvne_notice' => $ok ? 'queued' : 'error' ) ) );
            exit;
        }

        wp_safe_redirect( $this->admin_url( array( 'tab' => 'campaigns', 'view' => 'edit', 'id' => $id, 'rgvne_notice' => 'saved' ) ) );
        exit;
    }

    private function handle_preview() {
        $id = isset( $_GET['campaign_id'] ) ? absint( $_GET['campaign_id'] ) : 0;
        check_admin_referer( 'rgvne_preview_' . $id );
        $campaign = $this->get_campaign( $id );
        if ( ! $campaign ) {
            wp_die( 'Campaign not found.' );
        }
        nocache_headers();
        header( 'Content-Type: text/html; charset=' . get_bloginfo( 'charset' ) );
        echo $this->email_html( $campaign, 'Sebastian', true ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
        exit;
    }

    private function queue_campaign( $campaign_id ) {
        global $wpdb;
        $t = $this->tables();
        $campaign = $this->get_campaign( $campaign_id );
        if ( ! $campaign || 'draft' !== $campaign->status ) {
            return false;
        }

        $subscribers = $wpdb->get_results( "SELECT email, first_name FROM {$t['subscribers']} WHERE status = 'active' ORDER BY id ASC" ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
        if ( ! $subscribers ) {
            return false;
        }

        foreach ( $subscribers as $s ) {
            $wpdb->query( $wpdb->prepare(
                "INSERT IGNORE INTO {$t['queue']} (campaign_id,email,first_name,status,attempts,created_at) VALUES (%d,%s,%s,'pending',0,%s)",
                $campaign_id,
                sanitize_email( $s->email ),
                sanitize_text_field( $s->first_name ),
                current_time( 'mysql' )
            ) );
        }

        $wpdb->update( $t['campaigns'], array( 'status' => 'queued', 'updated_at' => current_time( 'mysql' ) ), array( 'id' => $campaign_id ) );

        $items = json_decode( $campaign->items, true );
        if ( is_array( $items ) ) {
            foreach ( $items as $item ) {
                if ( ! empty( $item['id'] ) ) {
                    update_post_meta( absint( $item['id'] ), '_rgvne_new_arrival_pending', '0' );
                }
            }
        }

        $this->schedule_batch( $campaign_id, 1 );
        return true;
    }

    private function schedule_batch( $campaign_id, $delay = 60 ) {
        if ( function_exists( 'as_schedule_single_action' ) ) {
            as_schedule_single_action( time() + max( 1, absint( $delay ) ), self::CRON_HOOK, array( $campaign_id ), self::AS_GROUP, true );
        } elseif ( ! wp_next_scheduled( self::CRON_HOOK, array( $campaign_id ) ) ) {
            wp_schedule_single_event( time() + max( 1, absint( $delay ) ), self::CRON_HOOK, array( $campaign_id ) );
        }
    }

    public function process_campaign_batch( $campaign_id ) {
        global $wpdb;
        $campaign_id = absint( $campaign_id );
        if ( ! $campaign_id ) { return; }

        $lock_key = 'rgvne_lock_' . $campaign_id;
        if ( get_transient( $lock_key ) ) { return; }
        set_transient( $lock_key, 1, 5 * MINUTE_IN_SECONDS );

        $t = $this->tables();
        $campaign = $this->get_campaign( $campaign_id );
        if ( ! $campaign || ! in_array( $campaign->status, array( 'queued', 'sending' ), true ) ) {
            delete_transient( $lock_key );
            return;
        }

        $settings = $this->settings();
        $batch_size = max( 5, min( 100, absint( $settings['batch_size'] ) ) );
        $wpdb->update( $t['campaigns'], array( 'status' => 'sending', 'updated_at' => current_time( 'mysql' ) ), array( 'id' => $campaign_id ) );

        $rows = $wpdb->get_results( $wpdb->prepare(
            "SELECT * FROM {$t['queue']} WHERE campaign_id = %d AND status IN ('pending','retry') AND attempts < 3 ORDER BY id ASC LIMIT %d",
            $campaign_id,
            $batch_size
        ) );

        foreach ( $rows as $row ) {
            $attempts = absint( $row->attempts ) + 1;
            $sent = $this->send_campaign_email( $campaign, $row->email, $row->first_name, false );
            if ( $sent ) {
                $wpdb->update( $t['queue'], array( 'status' => 'sent', 'attempts' => $attempts, 'last_error' => '', 'sent_at' => current_time( 'mysql' ) ), array( 'id' => $row->id ) );
            } else {
                $new_status = $attempts >= 3 ? 'failed' : 'retry';
                $wpdb->update( $t['queue'], array( 'status' => $new_status, 'attempts' => $attempts, 'last_error' => 'wp_mail returned false.' ), array( 'id' => $row->id ) );
            }
        }

        $sent_count   = absint( $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$t['queue']} WHERE campaign_id = %d AND status = 'sent'", $campaign_id ) ) );
        $failed_count = absint( $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$t['queue']} WHERE campaign_id = %d AND status = 'failed'", $campaign_id ) ) );
        $remaining    = absint( $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$t['queue']} WHERE campaign_id = %d AND status IN ('pending','retry') AND attempts < 3", $campaign_id ) ) );

        $wpdb->update( $t['campaigns'], array( 'sent_count' => $sent_count, 'failed_count' => $failed_count, 'updated_at' => current_time( 'mysql' ) ), array( 'id' => $campaign_id ) );

        delete_transient( $lock_key );

        if ( $remaining > 0 ) {
            $this->schedule_batch( $campaign_id, 60 );
        } else {
            $wpdb->update( $t['campaigns'], array( 'status' => 'complete', 'updated_at' => current_time( 'mysql' ) ), array( 'id' => $campaign_id ) );
        }
    }

    private function send_campaign_email( $campaign, $email, $first_name = '', $is_test = false ) {
        $email = sanitize_email( $email );
        if ( ! is_email( $email ) ) { return false; }

        $subject = ( $is_test ? '[TEST] ' : '' ) . $campaign->subject;
        $message = $this->email_html( $campaign, $first_name, $is_test, $email );

        // Intentionally do not set From, SMTP host, username, password, port, encryption or authentication here.
        // wp_mail() is allowed to flow through the site's existing SMTP/mail transport exactly as configured.
        $headers = array( 'Content-Type: text/html; charset=UTF-8' );
        return (bool) wp_mail( $email, $subject, $message, $headers );
    }

    public function handle_live_preview() {
        check_ajax_referer( 'rgvne_live_preview', 'nonce' );

        if ( ! current_user_can( 'manage_woocommerce' ) ) {
            wp_send_json_error( array( 'message' => 'Permission denied.' ), 403 );
        }

        $subject     = sanitize_text_field( wp_unslash( $_POST['subject'] ?? 'New arrivals are here — RGVPRIME LLC' ) );
        $preheader   = sanitize_text_field( wp_unslash( $_POST['preheader'] ?? '' ) );
        $heading     = sanitize_text_field( wp_unslash( $_POST['heading'] ?? 'New arrivals. Now available.' ) );
        $description = sanitize_textarea_field( wp_unslash( $_POST['description'] ?? '' ) );
        $cta_text    = sanitize_text_field( wp_unslash( $_POST['cta_text'] ?? 'Explore new arrivals' ) );
        $items       = $this->sanitize_campaign_items( $_POST['product_ids'] ?? array(), $_POST['item_title'] ?? array(), $_POST['item_desc'] ?? array() );

        $campaign = (object) array(
            'subject'     => $subject,
            'preheader'   => $preheader,
            'heading'     => $heading,
            'description' => $description,
            'cta_text'    => $cta_text,
            'items'       => wp_json_encode( $items ),
        );

        wp_send_json_success( array(
            'html' => $this->email_html( $campaign, 'Sebastian', true ),
        ) );
    }

    private function subscriber_token_for_email( $email ) {
        global $wpdb;
        $t = $this->tables();
        $token = $wpdb->get_var( $wpdb->prepare( "SELECT token FROM {$t['subscribers']} WHERE email = %s LIMIT 1", $email ) );
        return $token ? $token : '';
    }

    private function email_logo_url() {
        return plugins_url( 'assets/rgvprime-email-logo-white.png', __FILE__ );
    }

    private function email_html( $campaign, $first_name = '', $is_preview = false, $recipient_email = '' ) {
        $settings = $this->settings();
        $items = json_decode( $campaign->items, true );
        if ( ! is_array( $items ) ) { $items = array(); }

        $logo_url = $this->email_logo_url();
        $accent = sanitize_hex_color( $settings['accent_color'] ) ?: '#a00000';
        $shop_url = function_exists( 'wc_get_page_permalink' ) ? wc_get_page_permalink( 'shop' ) : home_url( '/shop/' );
        $name = $first_name ? $first_name : '';
        $greeting = $name ? 'Hi ' . $name . ',' : 'Hello,';

        $unsubscribe = '';
        if ( $recipient_email && ! $is_preview ) {
            $token = $this->subscriber_token_for_email( $recipient_email );
            if ( $token ) {
                $unsubscribe = add_query_arg( 'rgvprime_unsubscribe', rawurlencode( $token ), home_url( '/' ) );
            }
        }

        ob_start();
        ?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title><?php echo esc_html( $campaign->subject ); ?></title>
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0!important;padding:0!important;background:#eceef1;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased}
table{border-spacing:0;border-collapse:collapse}img{border:0;display:block;max-width:100%}.shell{background:#eceef1}.main{background:#ffffff}.copy{color:#171719}.muted{color:#68686f}.product-card{background:#f7f7f8;border:1px solid #e3e5e8}.product-image-bg{background:#ffffff}.benefit-card{background:#ffffff;border:1px solid #e5e6e9}.rule{border-top:1px solid #e4e5e8}.footer{color:#7a7b82}.dark-lock{background:#0b0b0d!important;color:#ffffff!important}.white-lock{background:#ffffff!important;background-image:linear-gradient(#ffffff,#ffffff)!important;color:#171719!important}
@media (prefers-color-scheme:dark){body{background:#090a0c!important}.shell{background:#090a0c!important}.main,.white-lock{background:#101114!important;background-image:linear-gradient(#101114,#101114)!important}.copy{color:#efefed!important}.muted{color:#92949a!important}.product-card,.benefit-card{background:#17181b!important;border-color:#303136!important}.product-image-bg{background:#ffffff!important}.rule{border-color:#2b2c31!important}.footer{color:#777980!important}.dark-lock{background:#090a0c!important;background-image:linear-gradient(#090a0c,#090a0c)!important;color:#ffffff!important}}
[data-ogsc] body,[data-ogsc] .shell{background:#090a0c!important}[data-ogsc] .main,[data-ogsc] .white-lock{background:#101114!important;background-image:linear-gradient(#101114,#101114)!important}[data-ogsc] .copy{color:#efefed!important}[data-ogsc] .muted{color:#92949a!important}[data-ogsc] .product-card,[data-ogsc] .benefit-card{background:#17181b!important;border-color:#303136!important}[data-ogsc] .rule{border-color:#2b2c31!important}[data-ogsc] .footer{color:#777980!important}[data-ogsc] .dark-lock{background:#090a0c!important;color:#ffffff!important}
@media screen and (max-width:640px){.outer{padding:14px 8px!important}.pad{padding-left:22px!important;padding-right:22px!important}.hero-title{font-size:34px!important;line-height:38px!important}.product-img-cell,.product-copy-cell{display:block!important;width:100%!important;box-sizing:border-box!important}.product-img-cell{padding:18px 18px 0!important}.product-copy-cell{padding:16px 18px 20px!important}.product-image{width:100%!important;max-width:260px!important;height:auto!important;margin:0 auto!important}.brand-logo{width:190px!important}.benefit-col{display:block!important;width:100%!important;padding:0 0 10px!important}.cta-cell a{display:block!important;text-align:center!important}}
</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent"><?php echo esc_html( $campaign->preheader ); ?>&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" class="shell" bgcolor="#eceef1" style="width:100%;background:#eceef1"><tr><td align="center" class="outer" style="padding:32px 14px">
<table role="presentation" width="100%" style="max-width:720px;width:100%">
<tr><td style="height:5px;background:<?php echo esc_attr( $accent ); ?>;border-radius:20px 20px 0 0;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td class="dark-lock" bgcolor="#0b0b0d" style="background:#0b0b0d;padding:28px 40px 24px;color:#ffffff">
<table role="presentation" width="100%"><tr><td>
<img class="brand-logo" src="<?php echo esc_url( $logo_url ); ?>" alt="RGVPRIME LLC" width="214" style="display:block;width:214px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none">
</td><td align="right" valign="middle" style="font-size:10px;line-height:14px;letter-spacing:1.7px;font-weight:800;color:#b9bbc0;text-transform:uppercase">New product release</td></tr></table>
</td></tr>
<tr><td class="main white-lock" bgcolor="#ffffff" style="background:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);border-radius:0 0 20px 20px;overflow:hidden">
<table role="presentation" width="100%">
<tr><td class="pad" style="padding:38px 46px 10px">
<div class="muted" style="font-size:13px;line-height:20px;color:#6e7076;margin-bottom:18px"><?php echo esc_html( $greeting ); ?></div>
<div style="font-size:11px;line-height:16px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:<?php echo esc_attr( $accent ); ?>;margin-bottom:10px">Just landed</div>
<h1 class="copy hero-title" style="margin:0;color:#141416;font-size:44px;line-height:48px;letter-spacing:-1.7px;font-weight:900"><?php echo esc_html( $campaign->heading ); ?></h1>
<p class="muted" style="margin:18px 0 0;color:#66686e;font-size:16px;line-height:26px;max-width:590px"><?php echo nl2br( esc_html( $campaign->description ) ); ?></p>
</td></tr>
<tr><td class="pad" style="padding:24px 46px 8px">
<?php foreach ( $items as $index => $item ) :
    $title = $item['display_title'] ?? $item['name'] ?? '';
    $desc = $item['display_description'] ?? $item['description'] ?? '';
    $url = $item['url'] ?? $shop_url;
    $image = $item['image'] ?? '';
    $price = $item['price_html'] ?? '';
?>
<table role="presentation" width="100%" class="product-card" bgcolor="#f7f7f8" style="width:100%;background:#f7f7f8;border:1px solid #e3e5e8;border-radius:16px;margin-bottom:16px;overflow:hidden">
<tr>
<td class="product-img-cell" width="184" valign="middle" style="width:184px;padding:16px">
<table role="presentation" width="100%"><tr><td class="product-image-bg" align="center" style="background:#ffffff;border-radius:12px;padding:8px">
<?php if ( $image ) : ?><a href="<?php echo esc_url( $url ); ?>" style="text-decoration:none"><img class="product-image" src="<?php echo esc_url( $image ); ?>" width="144" height="144" style="width:144px;height:144px;object-fit:contain;border-radius:8px;background:#ffffff" alt="<?php echo esc_attr( $title ); ?>"></a><?php endif; ?>
</td></tr></table>
</td>
<td class="product-copy-cell" valign="middle" style="padding:22px 24px 22px 4px">
<div style="font-size:10px;line-height:14px;font-weight:900;letter-spacing:1.8px;color:<?php echo esc_attr( $accent ); ?>;margin-bottom:8px">NEW ARRIVAL · <?php echo esc_html( str_pad( (string) ( $index + 1 ), 2, '0', STR_PAD_LEFT ) ); ?></div>
<div class="copy" style="font-size:22px;line-height:27px;font-weight:900;color:#171719;margin-bottom:8px"><?php echo esc_html( $title ); ?></div>
<?php if ( $desc ) : ?><div class="muted" style="font-size:13px;line-height:20px;color:#6c6e74"><?php echo esc_html( $desc ); ?></div><?php endif; ?>
<?php if ( $price ) : ?><div class="copy" style="margin-top:12px;font-size:15px;line-height:20px;font-weight:900;color:#202125"><?php echo wp_kses_post( $price ); ?></div><?php endif; ?>
<div style="margin-top:14px"><a href="<?php echo esc_url( $url ); ?>" style="font-size:12px;line-height:16px;font-weight:800;color:<?php echo esc_attr( $accent ); ?>;text-decoration:none">View product &rarr;</a></div>
</td>
</tr></table>
<?php endforeach; ?>
</td></tr>
<tr><td class="pad white-lock" bgcolor="#ffffff" style="padding:12px 46px 18px;background:#ffffff;background-image:linear-gradient(#ffffff,#ffffff)">
<table role="presentation" width="100%" style="width:100%"><tr>
<td class="benefit-col" width="50%" valign="top" style="width:50%;padding:0 6px 0 0">
<table role="presentation" width="100%" class="benefit-card" bgcolor="#ffffff" style="width:100%;background:#ffffff;border:1px solid #e5e6e9;border-radius:14px"><tr><td style="padding:18px 18px 17px">
<div style="font-size:10px;line-height:14px;font-weight:900;letter-spacing:1.6px;color:<?php echo esc_attr( $accent ); ?>;margin-bottom:7px">REWARDS</div>
<div class="copy" style="font-size:16px;line-height:21px;font-weight:900;color:#171719;margin-bottom:5px">Earn points on every order</div>
<div class="muted" style="font-size:12px;line-height:18px;color:#6b6d73">Every completed order earns points you can use toward future rewards.</div>
</td></tr></table>
</td>
<td class="benefit-col" width="50%" valign="top" style="width:50%;padding:0 0 0 6px">
<table role="presentation" width="100%" class="benefit-card" bgcolor="#ffffff" style="width:100%;background:#ffffff;border:1px solid #e5e6e9;border-radius:14px"><tr><td style="padding:18px 18px 17px">
<div style="font-size:10px;line-height:14px;font-weight:900;letter-spacing:1.6px;color:<?php echo esc_attr( $accent ); ?>;margin-bottom:7px">NEW TO RGVPRIME?</div>
<div class="copy" style="font-size:16px;line-height:21px;font-weight:900;color:#171719;margin-bottom:5px">Get 10% off your first order</div>
<div class="muted" style="font-size:12px;line-height:18px;color:#6b6d73">New customers can unlock 10% off their first RGVPRIME order.</div>
</td></tr></table>
</td>
</tr></table>
</td></tr>
<tr><td class="pad cta-cell white-lock" align="center" bgcolor="#ffffff" style="padding:12px 46px 42px;background:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);text-align:center">
<table role="presentation" align="center" style="margin:0 auto"><tr><td align="center" bgcolor="<?php echo esc_attr( $accent ); ?>" style="background:<?php echo esc_attr( $accent ); ?>;border-radius:999px;box-shadow:0 8px 22px rgba(120,0,0,.16)"><a href="<?php echo esc_url( $shop_url ); ?>" style="display:inline-block;padding:16px 30px;color:#ffffff;text-decoration:none;font-weight:900;font-size:14px;line-height:18px;letter-spacing:.15px"><?php echo esc_html( $campaign->cta_text ); ?> &nbsp;&rarr;</a></td></tr></table>
<div class="muted" style="margin-top:10px;font-size:10px;line-height:15px;color:#8a8b91">Explore the latest additions to the RGVPRIME catalog.</div>
</td></tr>
<tr><td class="rule" style="border-top:1px solid #e4e5e8;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td class="pad footer white-lock" bgcolor="#ffffff" style="padding:24px 46px 32px;background:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);color:#7a7b82;font-size:11px;line-height:18px">
<strong class="copy" style="color:#2d2e32">RGVPRIME LLC</strong><br>
New-arrival updates from the RGVPRIME LLC catalog. You are receiving this because this address is subscribed to product updates.
<?php if ( $unsubscribe ) : ?><br><a href="<?php echo esc_url( $unsubscribe ); ?>" style="color:<?php echo esc_attr( $accent ); ?>;text-decoration:underline">Unsubscribe from new-arrival emails</a><?php endif; ?>
</td></tr>
</table>
</td></tr></table>
</td></tr></table>
</body></html><?php
        return ob_get_clean();
    }

    private function upsert_subscriber( $email, $first_name = '', $source = 'manual', $status = 'active', $authoritative_status = false ) {
        global $wpdb;
        $t = $this->tables();
        $email = sanitize_email( $email );
        if ( ! is_email( $email ) ) { return false; }

        $existing = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['subscribers']} WHERE email = %s", $email ) );
        $now = current_time( 'mysql' );
        if ( $existing ) {
            // Bulk imports normally never re-subscribe a locally unsubscribed address.
            // Exception: an Omnisend CSV with an explicit Email subscription status is treated
            // as authoritative so a fresh export can repair/synchronize previous import mistakes.
            $bulk_import = in_array( $source, array( 'woocommerce-import', 'omnisend-import' ), true );
            if ( $authoritative_status && 'omnisend-import' === $source ) {
                $next_status = sanitize_key( $status );
            } else {
                $next_status = ( 'unsubscribed' === $existing->status && $bulk_import && 'active' === sanitize_key( $status ) ) ? 'unsubscribed' : sanitize_key( $status );
            }
            $wpdb->update( $t['subscribers'], array(
                'first_name' => sanitize_text_field( $first_name ),
                'status'     => $next_status,
                'source'     => sanitize_key( $source ),
                'updated_at' => $now,
            ), array( 'id' => $existing->id ) );
            return true;
        }

        return false !== $wpdb->insert( $t['subscribers'], array(
            'email'      => $email,
            'first_name' => sanitize_text_field( $first_name ),
            'status'     => sanitize_key( $status ),
            'source'     => sanitize_key( $source ),
            'token'      => hash( 'sha256', wp_generate_password( 64, true, true ) . '|' . $email . '|' . microtime( true ) ),
            'created_at' => $now,
            'updated_at' => $now,
        ) );
    }

    private function render_subscribers() {
        global $wpdb;
        $t = $this->tables();
        $active = absint( $wpdb->get_var( "SELECT COUNT(*) FROM {$t['subscribers']} WHERE status='active'" ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
        $unsub = absint( $wpdb->get_var( "SELECT COUNT(*) FROM {$t['subscribers']} WHERE status='unsubscribed'" ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
        $rows = $wpdb->get_results( "SELECT * FROM {$t['subscribers']} ORDER BY id DESC LIMIT 200" ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared

        echo '<div class="rgvne-stat-grid"><div class="rgvne-stat"><span>Active subscribers</span><strong>' . $active . '</strong></div><div class="rgvne-stat"><span>Unsubscribed</span><strong>' . $unsub . '</strong></div><div class="rgvne-stat"><span>Signup shortcode</span><code>[rgvprime_new_arrival_signup]</code></div></div>';

        echo '<div class="rgvne-two-col"><div class="rgvne-card"><h3>Add subscriber</h3><form method="post">';
        wp_nonce_field( 'rgvne_add_subscriber', 'rgvne_nonce' );
        echo '<input type="hidden" name="rgvne_action" value="add_subscriber"><div class="rgvne-field"><label>Email</label><input type="email" name="email" required></div><div class="rgvne-field"><label>First name</label><input type="text" name="first_name"></div><button class="button button-primary">Add subscriber</button></form></div>';

        echo '<div class="rgvne-card"><h3>Import WooCommerce customers</h3><p>Imports unique billing emails from paid orders into the active subscriber list. The import runs in small background-style batches so a large order history cannot crash the page.</p><form id="rgvne-wc-import-form">';
        echo '<label class="rgvne-confirm"><input id="rgvne-wc-import-confirm" type="checkbox" name="permission_confirm" value="1" required> I confirm these customers may receive marketing/product-update emails.</label><button type="submit" class="button" id="rgvne-wc-import-button">Import eligible customers</button>';
        echo '<div id="rgvne-wc-import-progress" style="display:none;margin-top:14px;padding:12px 14px;border:1px solid #dcdcde;border-radius:8px;background:#fff"><strong id="rgvne-wc-import-status">Preparing import…</strong><div style="height:7px;background:#ececef;border-radius:999px;margin-top:9px;overflow:hidden"><div id="rgvne-wc-import-bar" style="width:4%;height:100%;background:#a00000;border-radius:999px;transition:width .2s ease"></div></div><div id="rgvne-wc-import-meta" style="margin-top:8px;font-size:12px;color:#646970"></div></div>';
        echo '</form></div></div>';

        echo '<div class="rgvne-card" style="margin-top:18px"><h3>Import Omnisend contacts</h3><p>Export your contacts from Omnisend as CSV and upload the file here. Email/name columns are detected automatically. Omnisend&#39;s explicit Email subscription status is treated as the source of truth; Email consent yes/no is metadata only. Explicit unsubscribed, suppressed, bounced or opted-out statuses remain protected.</p><form method="post" enctype="multipart/form-data">';
        wp_nonce_field( 'rgvne_import_omnisend', 'rgvne_nonce' );
        echo '<input type="hidden" name="rgvne_action" value="import_omnisend">';
        echo '<div class="rgvne-field"><label>Omnisend CSV</label><input type="file" name="omnisend_file" accept=".csv,text/csv,text/plain"></div>';
        echo '<div class="rgvne-field"><label>Or paste a contact list <span>optional</span></label><textarea name="omnisend_paste" rows="6" placeholder="email@example.com, First name&#10;another@example.com, Another name"></textarea><p class="description">Use one contact per line. CSV upload is preferred because subscription status can be respected when Omnisend includes it.</p></div>';
        echo '<label class="rgvne-confirm"><input type="checkbox" name="permission_confirm" value="1" required> I confirm I am importing contacts that are permitted to receive these product-update emails.</label>';
        echo '<button class="button button-primary">Import Omnisend contacts</button></form></div>';

        echo '<div class="rgvne-table-card"><table class="widefat striped"><thead><tr><th>Email</th><th>Name</th><th>Status</th><th>Source</th><th>Updated</th></tr></thead><tbody>';
        foreach ( $rows as $row ) {
            echo '<tr><td>' . esc_html( $row->email ) . '</td><td>' . esc_html( $row->first_name ) . '</td><td>' . esc_html( ucfirst( $row->status ) ) . '</td><td>' . esc_html( $row->source ) . '</td><td>' . esc_html( $row->updated_at ) . '</td></tr>';
        }
        echo '</tbody></table></div>';
    }

    private function handle_add_subscriber() {
        check_admin_referer( 'rgvne_add_subscriber', 'rgvne_nonce' );
        $ok = $this->upsert_subscriber( wp_unslash( $_POST['email'] ?? '' ), wp_unslash( $_POST['first_name'] ?? '' ), 'manual', 'active' );
        wp_safe_redirect( $this->admin_url( array( 'tab' => 'subscribers', 'rgvne_notice' => $ok ? 'subscriber' : 'error' ) ) );
        exit;
    }

    private function handle_import_customers() {
        // Legacy non-AJAX route retained only so old cached admin pages cannot trigger
        // the former long-running synchronous importer.
        check_admin_referer( 'rgvne_import_customers', 'rgvne_nonce' );
        wp_safe_redirect( $this->admin_url( array( 'tab' => 'subscribers', 'rgvne_notice' => 'wc_import_use_batch' ) ) );
        exit;
    }

    public function handle_import_wc_customers_batch() {
        check_ajax_referer( 'rgvne_wc_import', 'nonce' );

        if ( ! current_user_can( 'manage_woocommerce' ) ) {
            wp_send_json_error( array( 'message' => 'Permission denied.' ), 403 );
        }
        if ( ! function_exists( 'wc_get_orders' ) ) {
            wp_send_json_error( array( 'message' => 'WooCommerce order functions are unavailable.' ), 500 );
        }

        $page  = max( 1, absint( $_POST['page'] ?? 1 ) );
        $start = ! empty( $_POST['start'] );
        $user_id = get_current_user_id();
        $state_key = 'rgvne_wcimp_' . $user_id;

        if ( $start || 1 === $page ) {
            delete_transient( $state_key );
            $state = array(
                'seen'      => array(),
                'imported'  => 0,
                'skipped'   => 0,
                'processed' => 0,
            );
        } else {
            $state = get_transient( $state_key );
            if ( ! is_array( $state ) ) {
                $state = array( 'seen' => array(), 'imported' => 0, 'skipped' => 0, 'processed' => 0 );
            }
        }

        $paid_statuses = function_exists( 'wc_get_is_paid_statuses' ) ? wc_get_is_paid_statuses() : array( 'processing', 'completed' );
        if ( empty( $paid_statuses ) || ! is_array( $paid_statuses ) ) {
            $paid_statuses = array( 'processing', 'completed' );
        }

        $limit = 75;
        try {
            $result = wc_get_orders( array(
                'limit'    => $limit,
                'page'     => $page,
                'paginate' => true,
                'status'   => $paid_statuses,
                'orderby'  => 'date',
                'order'    => 'DESC',
                'return'   => 'objects',
            ) );
        } catch ( \Throwable $e ) {
            error_log( '[RGVPRIME New Arrival Emails] WooCommerce customer import query failed: ' . $e->getMessage() );
            wp_send_json_error( array(
                'message' => 'WooCommerce could not read this batch of orders. The error was logged, and no subscriber data was removed.',
            ), 500 );
        }

        $orders = array();
        $max_pages = $page;
        if ( is_object( $result ) && isset( $result->orders ) ) {
            $orders = is_array( $result->orders ) ? $result->orders : array();
            $max_pages = max( $page, absint( $result->max_num_pages ?? $page ) );
        } elseif ( is_array( $result ) ) {
            // Defensive fallback for custom WooCommerce data stores.
            $orders = $result;
            $max_pages = count( $orders ) >= $limit ? $page + 1 : $page;
        }

        foreach ( $orders as $order ) {
            $state['processed']++;
            try {
                if ( ! is_object( $order ) || ! is_callable( array( $order, 'get_billing_email' ) ) ) {
                    $state['skipped']++;
                    continue;
                }

                $email = sanitize_email( (string) $order->get_billing_email() );
                if ( ! is_email( $email ) ) {
                    $state['skipped']++;
                    continue;
                }

                $hash = md5( strtolower( $email ) );
                if ( isset( $state['seen'][ $hash ] ) ) {
                    continue;
                }
                $state['seen'][ $hash ] = 1;

                $first_name = is_callable( array( $order, 'get_billing_first_name' ) ) ? (string) $order->get_billing_first_name() : '';
                if ( $this->upsert_subscriber( $email, $first_name, 'woocommerce-import', 'active' ) ) {
                    $state['imported']++;
                } else {
                    $state['skipped']++;
                }
            } catch ( \Throwable $e ) {
                $state['skipped']++;
                error_log( '[RGVPRIME New Arrival Emails] Skipped one WooCommerce order during customer import: ' . $e->getMessage() );
            }
        }

        // Hard cap keeps a malformed/custom data store from creating an endless loop.
        $done = empty( $orders ) || $page >= $max_pages || $page >= 100;

        if ( $done ) {
            delete_transient( $state_key );
        } else {
            set_transient( $state_key, $state, HOUR_IN_SECONDS );
        }

        $progress = $max_pages > 0 ? min( 100, (int) round( ( $page / $max_pages ) * 100 ) ) : 100;
        if ( $done ) { $progress = 100; }

        wp_send_json_success( array(
            'done'       => $done,
            'nextPage'   => $page + 1,
            'page'       => $page,
            'maxPages'   => $max_pages,
            'progress'   => $progress,
            'processed'  => absint( $state['processed'] ),
            'imported'   => absint( $state['imported'] ),
            'skipped'    => absint( $state['skipped'] ),
        ) );
    }

    private function normalize_csv_header( $value ) {
        $value = preg_replace( '/^\xEF\xBB\xBF/', '', (string) $value );
        return strtolower( preg_replace( '/[^a-z0-9]+/i', '', trim( $value ) ) );
    }

    private function classify_omnisend_status( $value, $context = 'subscription_status' ) {
        $value = strtolower( trim( (string) $value ) );
        $compact = preg_replace( '/[^a-z0-9]+/', '', $value );
        if ( '' === $compact ) { return 'active'; }

        if ( 'subscription_status' === $context ) {
            $active_tokens = array( 'subscribed', 'active', 'enabled', 'optedin', 'optin', 'true', 'yes', '1' );
            foreach ( $active_tokens as $token ) {
                if ( $compact === $token ) { return 'active'; }
            }

            $blocked_tokens = array( 'unsubscribed', 'nonsubscribed', 'optedout', 'optout', 'suppressed', 'bounced', 'bounce', 'inactive', 'disabled' );
            foreach ( $blocked_tokens as $token ) {
                if ( false !== strpos( $compact, $token ) ) { return 'unsubscribed'; }
            }
            return 'active';
        }

        // Omnisend's Email consent yes/no is metadata and is not the current subscription status.
        $blocked_tokens = array( 'unsubscribed', 'optedout', 'optout', 'suppressed', 'bounced', 'bounce' );
        foreach ( $blocked_tokens as $token ) {
            if ( false !== strpos( $compact, $token ) ) { return 'unsubscribed'; }
        }
        return 'active';
    }

    private function import_omnisend_row( $email, $first_name, $status, &$active, &$unsub, &$invalid, $authoritative_status = false ) {
        global $wpdb;
        $t = $this->tables();

        $email = sanitize_email( $email );
        if ( ! is_email( $email ) ) {
            $invalid++;
            return;
        }
        $status = ( 'unsubscribed' === $status ) ? 'unsubscribed' : 'active';
        if ( $this->upsert_subscriber( $email, sanitize_text_field( $first_name ), 'omnisend-import', $status, $authoritative_status ) ) {
            $final_status = $wpdb->get_var( $wpdb->prepare( "SELECT status FROM {$t['subscribers']} WHERE email = %s LIMIT 1", $email ) );
            if ( 'unsubscribed' === $final_status ) { $unsub++; } else { $active++; }
        } else {
            $invalid++;
        }
    }

    private function handle_import_omnisend() {
        check_admin_referer( 'rgvne_import_omnisend', 'rgvne_nonce' );
        if ( empty( $_POST['permission_confirm'] ) ) {
            wp_safe_redirect( $this->admin_url( array( 'tab' => 'subscribers', 'rgvne_notice' => 'error' ) ) );
            exit;
        }

        $active = 0;
        $unsub = 0;
        $invalid = 0;
        $processed_source = false;

        if ( ! empty( $_FILES['omnisend_file']['tmp_name'] ) && UPLOAD_ERR_OK === (int) ( $_FILES['omnisend_file']['error'] ?? UPLOAD_ERR_NO_FILE ) ) {
            $processed_source = true;
            $tmp = $_FILES['omnisend_file']['tmp_name'];
            $fh = fopen( $tmp, 'r' );
            if ( $fh ) {
                $sample = fgets( $fh );
                rewind( $fh );
                $delims = array( ',' => substr_count( (string) $sample, ',' ), ';' => substr_count( (string) $sample, ';' ), "\t" => substr_count( (string) $sample, "\t" ) );
                arsort( $delims );
                $delimiter = (string) array_key_first( $delims );
                if ( 0 === reset( $delims ) ) { $delimiter = ','; }

                $header = fgetcsv( $fh, 0, $delimiter );
                if ( is_array( $header ) ) {
                    $normalized = array_map( array( $this, 'normalize_csv_header' ), $header );
                    $email_index = null;
                    $first_index = null;
                    $subscription_status_index = null;
                    $consent_index = null;
                    $optout_date_index = null;
                    foreach ( $normalized as $i => $key ) {
                        if ( null === $email_index && in_array( $key, array( 'email', 'emailaddress', 'contactemail', 'primaryemail' ), true ) ) { $email_index = $i; }
                        if ( null === $first_index && in_array( $key, array( 'firstname', 'first', 'givenname' ), true ) ) { $first_index = $i; }
                        if ( null === $subscription_status_index && in_array( $key, array( 'emailsubscriptionstatus', 'subscriptionstatus', 'emailstatus' ), true ) ) { $subscription_status_index = $i; }
                        if ( null === $consent_index && in_array( $key, array( 'emailconsent', 'emailoptin' ), true ) ) { $consent_index = $i; }
                        if ( null === $optout_date_index && in_array( $key, array( 'emailoptoutdate', 'optoutdate', 'emailunsubscribeddate' ), true ) ) { $optout_date_index = $i; }
                    }
                    if ( null === $email_index ) {
                        foreach ( $normalized as $i => $key ) {
                            if ( false !== strpos( $key, 'email' ) && false === strpos( $key, 'status' ) ) { $email_index = $i; break; }
                        }
                    }

                    $header_is_contact = isset( $header[0] ) && is_email( sanitize_email( $header[0] ) );
                    if ( $header_is_contact ) {
                        $this->import_omnisend_row( $header[0], $header[1] ?? '', 'active', $active, $unsub, $invalid );
                        $email_index = 0;
                        $first_index = isset( $header[1] ) ? 1 : null;
                        $subscription_status_index = null;
                        $consent_index = null;
                        $optout_date_index = null;
                    }

                    $rows = 0;
                    while ( ( $row = fgetcsv( $fh, 0, $delimiter ) ) !== false && $rows < 100000 ) {
                        $rows++;
                        if ( null === $email_index ) { $invalid++; continue; }
                        $email = $row[ $email_index ] ?? '';
                        $first = ( null !== $first_index ) ? ( $row[ $first_index ] ?? '' ) : '';

                        $authoritative_status = false;
                        $status = 'active';

                        if ( null !== $subscription_status_index ) {
                            $status_raw = $row[ $subscription_status_index ] ?? '';
                            $status = $this->classify_omnisend_status( $status_raw, 'subscription_status' );
                            $authoritative_status = '' !== trim( (string) $status_raw );
                        } elseif ( null !== $optout_date_index && '' !== trim( (string) ( $row[ $optout_date_index ] ?? '' ) ) ) {
                            $status = 'unsubscribed';
                            $authoritative_status = true;
                        } elseif ( null !== $consent_index ) {
                            $status = $this->classify_omnisend_status( $row[ $consent_index ] ?? '', 'consent' );
                        }

                        $this->import_omnisend_row( $email, $first, $status, $active, $unsub, $invalid, $authoritative_status );
                    }
                }
                fclose( $fh );
            }
        }

        $paste = trim( wp_unslash( $_POST['omnisend_paste'] ?? '' ) );
        if ( $paste ) {
            $processed_source = true;
            $lines = preg_split( '/\r\n|\r|\n/', $paste );
            foreach ( array_slice( $lines, 0, 50000 ) as $line ) {
                $line = trim( $line );
                if ( '' === $line ) { continue; }
                $parts = preg_split( '/[,;\t]+/', $line, 2 );
                $this->import_omnisend_row( $parts[0] ?? '', $parts[1] ?? '', 'active', $active, $unsub, $invalid );
            }
        }

        if ( ! $processed_source ) {
            wp_safe_redirect( $this->admin_url( array( 'tab' => 'subscribers', 'rgvne_notice' => 'error' ) ) );
            exit;
        }

        wp_safe_redirect( $this->admin_url( array( 'tab' => 'subscribers', 'rgvne_notice' => 'omnisend_imported', 'active' => $active, 'unsub' => $unsub, 'invalid' => $invalid ) ) );
        exit;
    }

    public function checkout_optin_field() {
        if ( ! function_exists( 'woocommerce_form_field' ) ) { return; }
        echo '<div class="rgvne-checkout-optin">';
        woocommerce_form_field( 'rgvne_marketing_optin', array(
            'type'  => 'checkbox',
            'class' => array( 'form-row-wide' ),
            'label' => 'Email me when new RGVPRIME LLC products arrive.',
        ), WC()->checkout()->get_value( 'rgvne_marketing_optin' ) );
        echo '</div>';
    }

    public function save_checkout_optin( $order, $data ) {
        if ( ! empty( $_POST['rgvne_marketing_optin'] ) ) {
            $order->update_meta_data( '_rgvne_marketing_optin', 'yes' );
        }
    }

    public function subscribe_from_order( $order_id, $posted_data, $order ) {
        if ( $order && 'yes' === $order->get_meta( '_rgvne_marketing_optin' ) ) {
            $this->upsert_subscriber( $order->get_billing_email(), $order->get_billing_first_name(), 'checkout-optin', 'active' );
        }
    }

    public function handle_signup() {
        if ( empty( $_POST['rgvne_public_signup'] ) ) { return; }
        if ( empty( $_POST['rgvne_signup_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['rgvne_signup_nonce'] ) ), 'rgvne_public_signup' ) ) {
            return;
        }
        if ( empty( $_POST['rgvne_signup_consent'] ) ) { return; }
        $email = sanitize_email( wp_unslash( $_POST['rgvne_signup_email'] ?? '' ) );
        $name  = sanitize_text_field( wp_unslash( $_POST['rgvne_signup_name'] ?? '' ) );
        if ( $this->upsert_subscriber( $email, $name, 'shortcode', 'active' ) ) {
            set_transient( 'rgvne_signup_' . md5( wp_get_session_token() . $email ), 1, 60 );
            wp_safe_redirect( add_query_arg( 'rgvne_subscribed', '1', wp_get_referer() ?: home_url( '/' ) ) );
            exit;
        }
    }

    public function signup_shortcode() {
        $success = ! empty( $_GET['rgvne_subscribed'] );
        ob_start();
        if ( $success ) {
            echo '<div class="rgvne-signup-success">You’re subscribed. We’ll email you when new products arrive.</div>';
        }
        ?>
        <form method="post" class="rgvne-signup-form" style="max-width:520px;padding:24px;border:1px solid rgba(127,127,127,.25);border-radius:14px">
            <?php wp_nonce_field( 'rgvne_public_signup', 'rgvne_signup_nonce' ); ?>
            <input type="hidden" name="rgvne_public_signup" value="1">
            <div style="margin-bottom:12px"><label style="display:block;font-size:12px;font-weight:700;margin-bottom:6px">First name</label><input style="width:100%" type="text" name="rgvne_signup_name" autocomplete="given-name"></div>
            <div style="margin-bottom:12px"><label style="display:block;font-size:12px;font-weight:700;margin-bottom:6px">Email</label><input style="width:100%" type="email" name="rgvne_signup_email" required autocomplete="email"></div>
            <label style="display:block;font-size:12px;line-height:1.5;margin-bottom:14px"><input type="checkbox" name="rgvne_signup_consent" value="1" required> I agree to receive new-product and store update emails. I can unsubscribe at any time.</label>
            <button type="submit">Notify me about new arrivals</button>
        </form>
        <?php
        return ob_get_clean();
    }

    public function handle_unsubscribe() {
        if ( empty( $_GET['rgvprime_unsubscribe'] ) ) { return; }
        $token = sanitize_text_field( wp_unslash( $_GET['rgvprime_unsubscribe'] ) );
        if ( ! preg_match( '/^[a-f0-9]{64}$/', $token ) ) { return; }

        global $wpdb;
        $t = $this->tables();
        $row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['subscribers']} WHERE token = %s LIMIT 1", $token ) );
        if ( $row ) {
            $wpdb->update( $t['subscribers'], array( 'status' => 'unsubscribed', 'updated_at' => current_time( 'mysql' ) ), array( 'id' => $row->id ) );
        }

        status_header( 200 );
        nocache_headers();
        ?><!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed — RGVPRIME LLC</title></head><body style="margin:0;background:#080808;color:#fff;font-family:Arial,sans-serif"><div style="max-width:560px;margin:12vh auto;padding:28px"><div style="height:4px;background:#a00000;border-radius:8px 8px 0 0"></div><div style="background:#121214;padding:38px;border-radius:0 0 14px 14px"><div style="font-size:12px;letter-spacing:2px;font-weight:800;color:#c8c8cc">RGVPRIME LLC</div><h1 style="font-size:34px;margin:18px 0 12px">You’re unsubscribed.</h1><p style="color:#b2b2b7;line-height:1.65">You will no longer receive new-arrival email campaigns from us.</p><a href="<?php echo esc_url( home_url( '/' ) ); ?>" style="display:inline-block;margin-top:14px;color:#fff;background:#a00000;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">Return to store</a></div></div></body></html><?php
        exit;
    }

    private function render_settings() {
        $s = $this->settings();
        echo '<div class="rgvne-section-head"><div><h2>Design & queue</h2><p>Review the optimized email branding and choose campaign pacing. SMTP remains fully managed by your existing WordPress SMTP configuration.</p></div></div>';
        echo '<div class="rgvne-card rgvne-smtp-lock"><h3>SMTP configuration is untouched</h3><p>This plugin does <strong>not</strong> store or override SMTP host, username, password, port, encryption, authentication, From Email, or From Name. Every campaign is passed to <code>wp_mail()</code>, so your existing SMTP plugin/configuration remains the single source of truth.</p></div>';
        echo '<form method="post" class="rgvne-card rgvne-settings-form">';
        wp_nonce_field( 'rgvne_save_settings', 'rgvne_nonce' );
        echo '<input type="hidden" name="rgvne_action" value="save_settings">';

        $email_logo = $this->email_logo_url();
        echo '<div class="rgvne-field"><label>EMAIL LOGO <span>Optimized brand asset</span></label>';
        echo '<div style="padding:22px;background:#0b0b0d;border-radius:14px;max-width:360px"><img src="' . esc_url( $email_logo ) . '" alt="RGVPRIME LLC" style="display:block;width:240px;max-width:100%;height:auto"></div>';
        echo '<p class="description">This is your original RGVPRIME logo cleaned and optimized to only a few KB, bundled inside the plugin. No Media Library upload is required. The email header stays dark in both Light and Dark modes so the white logo always remains readable.</p></div>';

        echo '<div class="rgvne-field"><label>ACCENT COLOR</label><input type="text" name="accent_color" value="' . esc_attr( $s['accent_color'] ) . '" pattern="#[0-9a-fA-F]{6}"></div>';
        echo '<div class="rgvne-field"><label>BATCH SIZE</label><input type="number" name="batch_size" min="5" max="100" value="' . absint( $s['batch_size'] ) . '"><p class="description">Recipients processed per queue run. This changes campaign pacing only; it does not change SMTP configuration.</p></div>';
        echo '<button class="button button-primary">Save settings</button></form>';
    }

    private function handle_save_settings() {
        check_admin_referer( 'rgvne_save_settings', 'rgvne_nonce' );
        $settings = array(
            'logo_id'      => 0,
            'logo_url'     => '',
            'accent_color' => sanitize_hex_color( wp_unslash( $_POST['accent_color'] ?? '#a00000' ) ) ?: '#a00000',
            'batch_size'   => max( 5, min( 100, absint( $_POST['batch_size'] ?? 20 ) ) ),
        );
        update_option( self::OPTION_KEY, $settings, false );
        wp_safe_redirect( $this->admin_url( array( 'tab' => 'settings', 'rgvne_notice' => 'settings' ) ) );
        exit;
    }

    private function handle_archive_arrival() {
        $pid = isset( $_GET['product_id'] ) ? absint( $_GET['product_id'] ) : 0;
        check_admin_referer( 'rgvne_archive_' . $pid );
        update_post_meta( $pid, '_rgvne_new_arrival_pending', '0' );
        wp_safe_redirect( $this->admin_url( array( 'tab' => 'arrivals', 'rgvne_notice' => 'archived' ) ) );
        exit;
    }
}

RGVPRIME_New_Arrivals_Email::instance();
