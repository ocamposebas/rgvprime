<?php
/**
 * Plugin Name: Loyalty Program
 * Description: Points and store-credit rewards for WooCommerce customers.
 * Version: 1.0.0
 * Author: RGVPRIME LLC
 * Requires Plugins: woocommerce
 * Text Domain: rgv-loyalty
 */

defined('ABSPATH') || exit;

final class RGV_Loyalty_Program {
    const VERSION = '1.0.0';
    const OPTION = 'rgv_loyalty_settings';
    const BALANCE_META = '_rgv_loyalty_points';
    const HISTORY_META = '_rgv_loyalty_history';
    const ORDER_POINTS_META = '_rgv_loyalty_points_awarded';
    const COUPON_OWNER_META = '_rgv_loyalty_customer_id';
    const COUPON_POINTS_META = '_rgv_loyalty_points_spent';

    public static function boot() {
        static $instance = null;
        if (!$instance) {
            $instance = new self();
        }
        return $instance;
    }

    private function __construct() {
        add_action('admin_menu', [$this, 'admin_menu']);
        add_action('admin_init', [$this, 'register_settings']);
        add_action('admin_post_rgv_loyalty_adjust', [$this, 'admin_adjust']);
        add_action('woocommerce_order_status_completed', [$this, 'award_order']);
        add_action('woocommerce_order_status_cancelled', [$this, 'reverse_order']);
        add_action('woocommerce_order_status_refunded', [$this, 'reverse_order']);
        add_action('woocommerce_order_status_failed', [$this, 'reverse_order']);
        add_action('woocommerce_order_status_processing', [$this, 'award_processing_order']);
        add_action('woocommerce_order_refunded', [$this, 'sync_partial_refund'], 10, 2);
        add_action('woocommerce_order_status_changed', [$this, 'restore_redeemed_coupon'], 10, 4);
        add_action('rest_api_init', [$this, 'register_routes']);
        add_filter('rest_post_dispatch', [$this, 'add_loyalty_to_portal_response'], 10, 3);
        add_filter('manage_users_columns', [$this, 'user_column']);
        add_filter('manage_users_custom_column', [$this, 'user_column_value'], 10, 3);
    }

    public function settings() {
        return wp_parse_args(get_option(self::OPTION, []), [
            'points_per_dollar' => 1,
            'minimum_points' => 1000,
            'points_per_reward' => 1000,
            'reward_value' => 25,
            'award_processing' => 0,
        ]);
    }

    public function register_settings() {
        register_setting('rgv_loyalty', self::OPTION, [
            'sanitize_callback' => function ($value) {
                return [
                    'points_per_dollar' => max(0.01, (float) ($value['points_per_dollar'] ?? 1)),
                    'minimum_points' => max(1, absint($value['minimum_points'] ?? 1000)),
                    'points_per_reward' => max(1, absint($value['points_per_reward'] ?? 1000)),
                    'reward_value' => max(0.01, (float) ($value['reward_value'] ?? 25)),
                    'award_processing' => empty($value['award_processing']) ? 0 : 1,
                ];
            },
        ]);
    }

    public function get_balance($user_id) {
        return max(0, (int) get_user_meta($user_id, self::BALANCE_META, true));
    }

    private function set_balance($user_id, $balance) {
        update_user_meta($user_id, self::BALANCE_META, max(0, (int) $balance));
    }

    private function history($user_id) {
        $history = get_user_meta($user_id, self::HISTORY_META, true);
        return is_array($history) ? $history : [];
    }

    private function transaction($user_id, $points, $type, $description, $reference = '') {
        $before = $this->get_balance($user_id);
        $after = max(0, $before + (int) $points);
        $this->set_balance($user_id, $after);

        $history = $this->history($user_id);
        array_unshift($history, [
            'id' => wp_generate_uuid4(),
            'date' => current_time('mysql', true),
            'points' => $after - $before,
            'balance' => $after,
            'type' => sanitize_key($type),
            'description' => sanitize_text_field($description),
            'reference' => sanitize_text_field($reference),
        ]);
        update_user_meta($user_id, self::HISTORY_META, array_slice($history, 0, 250));
        return $after;
    }

    private function eligible_order_total($order) {
        $total = (float) $order->get_total();
        $shipping = (float) $order->get_shipping_total() + (float) $order->get_shipping_tax();
        return max(0, $total - $shipping);
    }

    private function order_points($order) {
        $settings = $this->settings();
        return max(0, (int) floor($this->eligible_order_total($order) * (float) $settings['points_per_dollar']));
    }

    public function award_processing_order($order_id) {
        if (!empty($this->settings()['award_processing'])) {
            $this->award_order($order_id);
        }
    }

    public function award_order($order_id) {
        $order = wc_get_order($order_id);
        if (!$order || !$order->get_customer_id() || $order->get_meta(self::ORDER_POINTS_META)) {
            return;
        }
        $points = $this->order_points($order);
        if ($points < 1) {
            return;
        }
        $this->transaction(
            $order->get_customer_id(),
            $points,
            'earn',
            sprintf(__('Points earned on order #%s', 'rgv-loyalty'), $order->get_order_number()),
            (string) $order_id
        );
        $order->update_meta_data(self::ORDER_POINTS_META, $points);
        $order->save();
    }

    public function reverse_order($order_id) {
        $order = wc_get_order($order_id);
        if (!$order || !$order->get_customer_id()) {
            return;
        }
        $awarded = (int) $order->get_meta(self::ORDER_POINTS_META);
        if ($awarded < 1) {
            return;
        }
        $this->transaction(
            $order->get_customer_id(),
            -$awarded,
            'reversal',
            sprintf(__('Points reversed for order #%s', 'rgv-loyalty'), $order->get_order_number()),
            (string) $order_id
        );
        $order->delete_meta_data(self::ORDER_POINTS_META);
        $order->save();
    }

    public function sync_partial_refund($order_id, $refund_id) {
        $order = wc_get_order($order_id);
        $refund = wc_get_order($refund_id);
        if (!$order || !$refund || !$order->get_customer_id() || $order->has_status('refunded')) {
            return;
        }
        $settings = $this->settings();
        $points = (int) floor(abs((float) $refund->get_total()) * (float) $settings['points_per_dollar']);
        $awarded = (int) $order->get_meta(self::ORDER_POINTS_META);
        $points = min($points, $awarded);
        if ($points < 1) {
            return;
        }
        $this->transaction(
            $order->get_customer_id(),
            -$points,
            'refund',
            sprintf(__('Points reversed for refund on order #%s', 'rgv-loyalty'), $order->get_order_number()),
            (string) $refund_id
        );
        $order->update_meta_data(self::ORDER_POINTS_META, max(0, $awarded - $points));
        $order->save();
    }

    public function summary($user_id) {
        $settings = $this->settings();
        $points = $this->get_balance($user_id);
        $minimum = (int) $settings['minimum_points'];
        $block = (int) $settings['points_per_reward'];
        $reward = (float) $settings['reward_value'];
        $redeemable_blocks = $points >= $minimum ? (int) floor($points / $block) : 0;
        return [
            'points' => $points,
            'minimum_points' => $minimum,
            'points_per_reward' => $block,
            'reward_value' => $reward,
            'redeemable_points' => $redeemable_blocks * $block,
            'redeemable_credit' => $redeemable_blocks * $reward,
            'can_redeem' => $redeemable_blocks > 0,
            'points_to_unlock' => max(0, $minimum - $points),
            'progress' => min(100, round(($points / max(1, $minimum)) * 100, 1)),
            'history' => array_slice($this->history($user_id), 0, 25),
        ];
    }

    public function register_routes() {
        register_rest_route('rgv-portal/v1', '/loyalty/redeem', [
            'methods' => 'POST',
            'callback' => [$this, 'rest_redeem'],
            'permission_callback' => '__return_true',
        ]);
    }

    private function portal_customer($request) {
        $me = new WP_REST_Request('GET', '/rgv-portal/v1/me');
        foreach (['authorization', 'x-rgv-portal-secret'] as $header) {
            $value = $request->get_header($header);
            if ($value) {
                $me->set_header($header, $value);
            }
        }
        $response = rest_do_request($me);
        if ($response->is_error()) {
            return new WP_Error('loyalty_session', __('Your session has expired.', 'rgv-loyalty'), ['status' => 401]);
        }
        $data = $response->get_data();
        $user_data = $data['user'] ?? [];
        $user = !empty($user_data['id']) ? get_user_by('id', absint($user_data['id'])) : null;
        if (!$user && !empty($user_data['email'])) {
            $user = get_user_by('email', sanitize_email($user_data['email']));
        }
        return $user ?: new WP_Error('loyalty_customer', __('Customer account not found.', 'rgv-loyalty'), ['status' => 404]);
    }

    public function rest_redeem($request) {
        if (!class_exists('WooCommerce')) {
            return new WP_Error('loyalty_woocommerce', __('WooCommerce is required.', 'rgv-loyalty'), ['status' => 503]);
        }
        $user = $this->portal_customer($request);
        if (is_wp_error($user)) {
            return $user;
        }
        $summary = $this->summary($user->ID);
        if (!$summary['can_redeem']) {
            return new WP_Error('loyalty_locked', sprintf(__('You need at least %d points to redeem.', 'rgv-loyalty'), $summary['minimum_points']), ['status' => 400]);
        }

        $requested = absint($request->get_param('points'));
        $points = $requested ?: (int) $summary['redeemable_points'];
        $block = (int) $summary['points_per_reward'];
        if ($points < (int) $summary['minimum_points'] || $points % $block !== 0 || $points > (int) $summary['redeemable_points']) {
            return new WP_Error('loyalty_points', __('Choose an available whole reward amount.', 'rgv-loyalty'), ['status' => 400]);
        }
        $credit = ($points / $block) * (float) $summary['reward_value'];
        $code = 'LOYALTY-' . strtoupper(wp_generate_password(10, false, false));
        $coupon = new WC_Coupon();
        $coupon->set_code($code);
        $coupon->set_discount_type('fixed_cart');
        $coupon->set_amount(wc_format_decimal($credit));
        $coupon->set_usage_limit(1);
        $coupon->set_usage_limit_per_user(1);
        $coupon->set_individual_use(true);
        $coupon->set_email_restrictions([$user->user_email]);
        $coupon->set_date_expires(strtotime('+90 days'));
        $coupon->add_meta_data(self::COUPON_OWNER_META, $user->ID, true);
        $coupon->add_meta_data(self::COUPON_POINTS_META, $points, true);
        $coupon->save();

        $this->transaction($user->ID, -$points, 'redeem', sprintf(__('Redeemed for %s store credit', 'rgv-loyalty'), wc_price($credit)), (string) $coupon->get_id());
        return new WP_REST_Response([
            'success' => true,
            'message' => __('Your store-credit code is ready.', 'rgv-loyalty'),
            'coupon' => $code,
            'credit' => $credit,
            'expires' => gmdate('Y-m-d', strtotime('+90 days')),
            'loyalty' => $this->summary($user->ID),
        ], 200);
    }

    public function restore_redeemed_coupon($order_id, $from, $to, $order) {
        if (!in_array($to, ['cancelled', 'failed', 'refunded'], true)) {
            return;
        }
        foreach ($order->get_coupon_codes() as $code) {
            $coupon = new WC_Coupon($code);
            $user_id = (int) $coupon->get_meta(self::COUPON_OWNER_META);
            $points = (int) $coupon->get_meta(self::COUPON_POINTS_META);
            if ($user_id && $points && !$coupon->get_meta('_rgv_loyalty_restored')) {
                $this->transaction($user_id, $points, 'restore', sprintf(__('Reward restored from order #%s', 'rgv-loyalty'), $order->get_order_number()), (string) $order_id);
                $coupon->update_meta_data('_rgv_loyalty_restored', 1);
                $coupon->save();
            }
        }
    }

    public function add_loyalty_to_portal_response($response, $server, $request) {
        if (!in_array($request->get_route(), [
            '/rgv-portal/v1/me',
            '/rgv-portal/v1/login',
            '/rgv-portal/v1/register',
        ], true) || is_wp_error($response)) {
            return $response;
        }
        $data = $response->get_data();
        if (!is_array($data) || empty($data['user'])) {
            return $response;
        }
        $user_id = absint($data['user']['id'] ?? 0);
        if (!$user_id && !empty($data['user']['email'])) {
            $user = get_user_by('email', sanitize_email($data['user']['email']));
            $user_id = $user ? $user->ID : 0;
        }
        if ($user_id) {
            $data['user']['loyalty'] = $this->summary($user_id);
            $data['loyalty'] = $data['user']['loyalty'];
            $response->set_data($data);
        }
        return $response;
    }

    public function admin_menu() {
        add_submenu_page('woocommerce', __('Loyalty Program', 'rgv-loyalty'), __('Loyalty Program', 'rgv-loyalty'), 'manage_woocommerce', 'rgv-loyalty', [$this, 'admin_page']);
    }

    public function user_column($columns) {
        $columns['rgv_loyalty'] = __('Loyalty points', 'rgv-loyalty');
        return $columns;
    }

    public function user_column_value($value, $column, $user_id) {
        return $column === 'rgv_loyalty' ? number_format_i18n($this->get_balance($user_id)) : $value;
    }

    public function admin_adjust() {
        if (!current_user_can('manage_woocommerce')) {
            wp_die(__('Access denied.', 'rgv-loyalty'));
        }
        check_admin_referer('rgv_loyalty_adjust');
        $user_id = absint($_POST['user_id'] ?? 0);
        $points = (int) ($_POST['points'] ?? 0);
        $note = sanitize_text_field(wp_unslash($_POST['note'] ?? 'Manual adjustment'));
        if ($user_id && $points) {
            $this->transaction($user_id, $points, 'adjustment', $note);
        }
        wp_safe_redirect(admin_url('admin.php?page=rgv-loyalty&updated=1'));
        exit;
    }

    public function admin_page() {
        if (!current_user_can('manage_woocommerce')) return;
        $settings = $this->settings();
        $search = sanitize_text_field(wp_unslash($_GET['s'] ?? ''));
        $args = ['number' => 100, 'orderby' => 'registered', 'order' => 'DESC'];
        if ($search) $args['search'] = '*' . $search . '*';
        $users = get_users($args);
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('Loyalty Program', 'rgv-loyalty'); ?></h1>
            <p><?php esc_html_e('Customers earn points from paid merchandise and unlock store credit at the configured threshold.', 'rgv-loyalty'); ?></p>
            <div style="display:grid;grid-template-columns:minmax(300px,520px) minmax(500px,1fr);gap:24px;align-items:start">
                <div class="card" style="max-width:none">
                    <h2><?php esc_html_e('Program settings', 'rgv-loyalty'); ?></h2>
                    <form method="post" action="options.php">
                        <?php settings_fields('rgv_loyalty'); ?>
                        <table class="form-table"><tbody>
                            <tr><th><label for="ppd"><?php esc_html_e('Points per $1', 'rgv-loyalty'); ?></label></th><td><input id="ppd" type="number" min=".01" step=".01" name="<?php echo esc_attr(self::OPTION); ?>[points_per_dollar]" value="<?php echo esc_attr($settings['points_per_dollar']); ?>"></td></tr>
                            <tr><th><label for="minimum"><?php esc_html_e('Minimum points to unlock', 'rgv-loyalty'); ?></label></th><td><input id="minimum" type="number" min="1" step="1" name="<?php echo esc_attr(self::OPTION); ?>[minimum_points]" value="<?php echo esc_attr($settings['minimum_points']); ?>"></td></tr>
                            <tr><th><label for="block"><?php esc_html_e('Points per reward', 'rgv-loyalty'); ?></label></th><td><input id="block" type="number" min="1" step="1" name="<?php echo esc_attr(self::OPTION); ?>[points_per_reward]" value="<?php echo esc_attr($settings['points_per_reward']); ?>"></td></tr>
                            <tr><th><label for="value"><?php esc_html_e('Credit per reward ($)', 'rgv-loyalty'); ?></label></th><td><input id="value" type="number" min=".01" step=".01" name="<?php echo esc_attr(self::OPTION); ?>[reward_value]" value="<?php echo esc_attr($settings['reward_value']); ?>"></td></tr>
                            <tr><th><?php esc_html_e('Award timing', 'rgv-loyalty'); ?></th><td><label><input type="checkbox" name="<?php echo esc_attr(self::OPTION); ?>[award_processing]" value="1" <?php checked($settings['award_processing']); ?>> <?php esc_html_e('Award at Processing (otherwise at Completed)', 'rgv-loyalty'); ?></label></td></tr>
                        </tbody></table>
                        <?php submit_button(); ?>
                    </form>
                </div>
                <div>
                    <form method="get"><input type="hidden" name="page" value="rgv-loyalty"><p class="search-box"><label class="screen-reader-text" for="loyalty-search"><?php esc_html_e('Search customers', 'rgv-loyalty'); ?></label><input id="loyalty-search" type="search" name="s" value="<?php echo esc_attr($search); ?>"><input type="submit" class="button" value="<?php esc_attr_e('Search customers', 'rgv-loyalty'); ?>"></p></form>
                    <table class="widefat striped"><thead><tr><th><?php esc_html_e('Customer', 'rgv-loyalty'); ?></th><th><?php esc_html_e('Email', 'rgv-loyalty'); ?></th><th><?php esc_html_e('Points', 'rgv-loyalty'); ?></th><th><?php esc_html_e('Redeemable credit', 'rgv-loyalty'); ?></th><th><?php esc_html_e('Adjustment', 'rgv-loyalty'); ?></th></tr></thead><tbody>
                    <?php foreach ($users as $user): $summary = $this->summary($user->ID); ?>
                        <tr><td><strong><?php echo esc_html($user->display_name); ?></strong></td><td><?php echo esc_html($user->user_email); ?></td><td><?php echo esc_html(number_format_i18n($summary['points'])); ?></td><td><?php echo wp_kses_post(wc_price($summary['redeemable_credit'])); ?></td><td>
                            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:flex;gap:5px">
                                <input type="hidden" name="action" value="rgv_loyalty_adjust"><input type="hidden" name="user_id" value="<?php echo esc_attr($user->ID); ?>"><?php wp_nonce_field('rgv_loyalty_adjust'); ?>
                                <input type="number" name="points" required placeholder="+/- points" style="width:95px"><input type="text" name="note" required placeholder="Reason" style="width:130px"><button class="button"><?php esc_html_e('Apply', 'rgv-loyalty'); ?></button>
                            </form>
                        </td></tr>
                    <?php endforeach; ?>
                    </tbody></table>
                </div>
            </div>
        </div>
        <?php
    }
}

add_action('plugins_loaded', ['RGV_Loyalty_Program', 'boot']);
