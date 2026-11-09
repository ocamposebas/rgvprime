<?php
/**
 * Plugin Name: RGV Loyalty Program
 * Description: Secure points and store-credit rewards for WooCommerce customers.
 * Version: 1.3.0
 * Author: RGVPRIME LLC
 * Requires at least: 6.5
 * Requires PHP: 7.4
 * Requires Plugins: woocommerce
 * Text Domain: rgv-loyalty
 */

defined('ABSPATH') || exit;

final class RGV_Loyalty_Program {
    const VERSION = '1.3.0';
    const OPTION = 'rgv_loyalty_settings';
    const VERSION_OPTION = 'rgv_loyalty_version';

    const BALANCE_META = '_rgv_loyalty_points';
    const HISTORY_META = '_rgv_loyalty_history';
    const IDEMPOTENCY_META = '_rgv_loyalty_idempotency';

    // Kept for backwards compatibility with version 1.0.0.
    const ORDER_POINTS_META = '_rgv_loyalty_points_awarded';

    const REFUND_POINTS_META = '_rgv_loyalty_points_reversed';
    const COUPON_OWNER_META = '_rgv_loyalty_customer_id';
    const COUPON_POINTS_META = '_rgv_loyalty_points_spent';
    const COUPON_STATUS_META = '_rgv_loyalty_status';
    const COUPON_REDEMPTION_META = '_rgv_loyalty_redemption_id';
    const COUPON_USED_ORDER_META = '_rgv_loyalty_used_order_id';
    const COUPON_RESTORED_ORDER_META = '_rgv_loyalty_restored_order_id';
    const COUPON_REVOKED_REASON_META = '_rgv_loyalty_revoked_reason';
    const COUPON_CREATED_META = '_rgv_loyalty_created_at';

    const COUPON_STATUS_ACTIVE = 'active';
    const COUPON_STATUS_USED = 'used';
    const COUPON_STATUS_REVOKED = 'revoked';
    const COUPON_STATUS_RESTORED = 'restored';

    /** @var self|null */
    private static $instance = null;

    /** @var array<string,int> */
    private $request_users = [];

    /** @var array<int,bool> */
    private $transaction_user_ids = [];

    /** @var array<int,bool> */
    private $transaction_post_ids = [];

    public static function boot() {
        if (!self::$instance) {
            self::$instance = new self();
        }

        return self::$instance;
    }

    public static function activate() {
        if (!get_option(self::OPTION, null)) {
            add_option(self::OPTION, [
                'points_per_dollar' => 1,
                'minimum_points' => 1000,
                'points_per_reward' => 1000,
                'reward_value' => 25,
                'award_processing' => 0,
                'coupon_expiry_days' => 90,
                'email_earn' => 1,
                'email_adjustment' => 1,
                'email_redeem' => 1,
                'email_restore' => 1,
                'email_reversal' => 1,
                'email_brand_name' => 'RGVPRIME REWARDS',
                'email_account_url' => home_url('/account'),
            ], '', false);
        }

        update_option(self::VERSION_OPTION, self::VERSION, false);
    }

    private function __construct() {
        add_action('admin_menu', [$this, 'admin_menu']);
        add_action('admin_init', [$this, 'register_settings']);
        add_action('admin_notices', [$this, 'woocommerce_notice']);
        add_action('admin_enqueue_scripts', [$this, 'admin_enqueue_assets']);
        add_action('admin_post_rgv_loyalty_adjust', [$this, 'admin_adjust']);

        add_action('woocommerce_order_status_changed', [$this, 'handle_order_status_changed'], 20, 4);
        add_action('woocommerce_order_refunded', [$this, 'handle_order_refunded'], 20, 2);

        add_action('rest_api_init', [$this, 'register_routes']);
        add_filter('rest_post_dispatch', [$this, 'add_loyalty_to_portal_response'], 10, 3);

        add_filter('manage_users_columns', [$this, 'user_column']);
        add_filter('manage_users_custom_column', [$this, 'user_column_value'], 10, 3);

        add_filter('woocommerce_coupon_is_valid', [$this, 'validate_loyalty_coupon'], 20, 3);

        $this->maybe_upgrade();
    }

    private function maybe_upgrade() {
        if (get_option(self::VERSION_OPTION) !== self::VERSION) {
            update_option(self::VERSION_OPTION, self::VERSION, false);
        }
    }

    public function woocommerce_notice() {
        if (!current_user_can('activate_plugins') || class_exists('WooCommerce')) {
            return;
        }

        echo '<div class="notice notice-error"><p>';
        echo esc_html__('RGV Loyalty Program requires WooCommerce to be installed and active.', 'rgv-loyalty');
        echo '</p></div>';
    }

    public function settings() {
        return wp_parse_args(get_option(self::OPTION, []), [
            'points_per_dollar' => 1,
            'minimum_points' => 1000,
            'points_per_reward' => 1000,
            'reward_value' => 25,
            'award_processing' => 0,
            'coupon_expiry_days' => 90,
            'email_earn' => 1,
            'email_adjustment' => 1,
            'email_redeem' => 1,
            'email_restore' => 1,
            'email_reversal' => 1,
            'email_brand_name' => 'RGVPRIME REWARDS',
            'email_account_url' => home_url('/account'),
        ]);
    }

    public function sanitize_settings($value) {
        $value = is_array($value) ? $value : [];
        $block = min(100000000, max(1, absint($value['points_per_reward'] ?? 1000)));
        $minimum = min(100000000, max($block, absint($value['minimum_points'] ?? 1000)));

        // A redeem threshold that is not a whole reward block can never be reached cleanly.
        $minimum = (int) (ceil($minimum / $block) * $block);

        return [
            'points_per_dollar' => min(1000, max(0.0001, (float) ($value['points_per_dollar'] ?? 1))),
            'minimum_points' => $minimum,
            'points_per_reward' => $block,
            'reward_value' => min(100000, max(0.01, (float) ($value['reward_value'] ?? 25))),
            'award_processing' => empty($value['award_processing']) ? 0 : 1,
            'coupon_expiry_days' => min(3650, max(1, absint($value['coupon_expiry_days'] ?? 90))),
            'email_earn' => empty($value['email_earn']) ? 0 : 1,
            'email_adjustment' => empty($value['email_adjustment']) ? 0 : 1,
            'email_redeem' => empty($value['email_redeem']) ? 0 : 1,
            'email_restore' => empty($value['email_restore']) ? 0 : 1,
            'email_reversal' => empty($value['email_reversal']) ? 0 : 1,
            'email_brand_name' => sanitize_text_field((string) ($value['email_brand_name'] ?? 'RGVPRIME REWARDS')),
            'email_account_url' => esc_url_raw((string) ($value['email_account_url'] ?? home_url('/account'))),
        ];
    }

    public function register_settings() {
        register_setting('rgv_loyalty', self::OPTION, [
            'type' => 'array',
            'sanitize_callback' => [$this, 'sanitize_settings'],
            'default' => $this->settings(),
        ]);
    }

    /**
     * Balances are intentionally signed. A negative balance is loyalty debt caused by
     * refunds, chargebacks, cancellations or manual fraud adjustments after rewards were used.
     */
    public function get_balance($user_id) {
        $value = get_user_meta(absint($user_id), self::BALANCE_META, true);
        return is_numeric($value) ? (int) $value : 0;
    }

    private function set_balance_unlocked($user_id, $balance) {
        $user_id = absint($user_id);
        $balance = (int) $balance;
        $this->transaction_user_ids[$user_id] = true;

        update_user_meta($user_id, self::BALANCE_META, $balance);
        wp_cache_delete($user_id, 'user_meta');

        $stored = get_user_meta($user_id, self::BALANCE_META, true);
        if (!is_numeric($stored) || (int) $stored !== $balance) {
            throw new RuntimeException('Unable to persist the loyalty balance.');
        }
    }

    private function history($user_id) {
        $history = get_user_meta(absint($user_id), self::HISTORY_META, true);
        return is_array($history) ? $history : [];
    }

    private function transaction_unlocked($user_id, $points, $type, $description, $reference = '', $allow_negative = true) {
        $user_id = absint($user_id);
        $points = (int) $points;
        $before = $this->get_balance($user_id);
        $after = $before + $points;

        if (!$allow_negative && $after < 0) {
            return new WP_Error(
                'loyalty_insufficient_points',
                __('Your points balance changed. Refresh and try again.', 'rgv-loyalty'),
                ['status' => 409]
            );
        }

        if ($points === 0) {
            return [
                'before' => $before,
                'after' => $before,
                'applied' => 0,
            ];
        }

        $this->set_balance_unlocked($user_id, $after);

        $history = $this->history($user_id);
        array_unshift($history, [
            'id' => wp_generate_uuid4(),
            'date' => current_time('mysql', true),
            'points' => $points,
            'balance' => $after,
            'type' => sanitize_key($type),
            'description' => sanitize_text_field(wp_strip_all_tags((string) $description)),
            'reference' => sanitize_text_field((string) $reference),
        ]);

        $this->transaction_user_ids[$user_id] = true;
        $history_updated = update_user_meta($user_id, self::HISTORY_META, array_slice($history, 0, 500));
        if ($history_updated === false) {
            throw new RuntimeException('Unable to persist the loyalty history.');
        }
        wp_cache_delete($user_id, 'user_meta');

        return [
            'before' => $before,
            'after' => $after,
            'applied' => $points,
        ];
    }

    private function lock_name($user_id) {
        return substr('rgvl_' . get_current_blog_id() . '_' . absint($user_id), 0, 64);
    }

    /**
     * Serializes all mutations for one customer. MySQL named locks work across PHP workers.
     * An atomic WordPress option is used only when the database does not support GET_LOCK().
     */
    private function with_user_lock($user_id, $callback, $timeout = 8) {
        global $wpdb;

        $user_id = absint($user_id);
        if (!$user_id) {
            return new WP_Error('loyalty_customer', __('Customer account not found.', 'rgv-loyalty'), ['status' => 404]);
        }

        $name = $this->lock_name($user_id);
        $mysql_lock = $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, %d)', $name, absint($timeout)));
        $fallback_token = '';
        $fallback_option = '';

        if ((string) $mysql_lock !== '1') {
            if ($mysql_lock !== null) {
                return new WP_Error(
                    'loyalty_busy',
                    __('Your rewards account is busy. Try again in a moment.', 'rgv-loyalty'),
                    ['status' => 409]
                );
            }

            $fallback_option = 'rgvl_lock_' . get_current_blog_id() . '_' . $user_id;
            $fallback_token = wp_generate_uuid4();
            $existing = get_option($fallback_option, []);

            if (is_array($existing) && !empty($existing['time']) && (time() - absint($existing['time'])) > 30) {
                delete_option($fallback_option);
            }

            if (!add_option($fallback_option, ['token' => $fallback_token, 'time' => time()], '', false)) {
                return new WP_Error(
                    'loyalty_busy',
                    __('Your rewards account is busy. Try again in a moment.', 'rgv-loyalty'),
                    ['status' => 409]
                );
            }
        }

        try {
            wp_cache_delete($user_id, 'user_meta');
            return call_user_func($callback);
        } finally {
            if ((string) $mysql_lock === '1') {
                $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $name));
            } elseif ($fallback_option && $fallback_token) {
                $stored = get_option($fallback_option, []);
                if (is_array($stored) && hash_equals($fallback_token, (string) ($stored['token'] ?? ''))) {
                    delete_option($fallback_option);
                }
            }
        }
    }

    /**
     * Groups user-meta, coupon-meta and order-meta mutations in one database transaction.
     */
    private function db_transaction($callback) {
        global $wpdb;

        $this->transaction_user_ids = [];
        $this->transaction_post_ids = [];

        if ($wpdb->query('START TRANSACTION') === false) {
            $this->log('error', 'Unable to start a loyalty database transaction.');
            return new WP_Error(
                'loyalty_transaction_unavailable',
                __('The rewards system could not start a safe transaction. No changes were applied.', 'rgv-loyalty'),
                ['status' => 503]
            );
        }

        try {
            $result = call_user_func($callback);

            if (is_wp_error($result)) {
                $wpdb->query('ROLLBACK');
                $this->clear_rolled_back_caches();
                return $result;
            }

            if ($wpdb->query('COMMIT') === false) {
                throw new RuntimeException('Unable to commit loyalty transaction.');
            }

            $this->transaction_user_ids = [];
            $this->transaction_post_ids = [];
            return $result;
        } catch (Throwable $error) {
            $wpdb->query('ROLLBACK');
            $this->clear_rolled_back_caches();
            $this->log('error', 'Loyalty database transaction failed.', [
                'exception' => $error->getMessage(),
            ]);

            return new WP_Error(
                'loyalty_transaction_failed',
                __('The rewards transaction could not be completed safely. No changes were applied.', 'rgv-loyalty'),
                ['status' => 500]
            );
        }
    }

    private function clear_rolled_back_caches() {
        foreach (array_keys($this->transaction_user_ids) as $user_id) {
            wp_cache_delete($user_id, 'user_meta');
            clean_user_cache($user_id);
        }

        foreach (array_keys($this->transaction_post_ids) as $post_id) {
            clean_post_cache($post_id);
        }

        $this->transaction_user_ids = [];
        $this->transaction_post_ids = [];
    }

    private function log($level, $message, array $context = []) {
        if (function_exists('wc_get_logger')) {
            $context['source'] = 'rgv-loyalty';
            wc_get_logger()->log($level, $message, $context);
        }
    }

    private function notification_enabled($event) {
        $settings = $this->settings();
        $map = [
            'earn' => 'email_earn',
            'adjustment' => 'email_adjustment',
            'redeem' => 'email_redeem',
            'restore' => 'email_restore',
            'reversal' => 'email_reversal',
        ];

        return !empty($map[$event]) && !empty($settings[$map[$event]]);
    }

    private function email_money($amount) {
        if (function_exists('wc_price')) {
            return wc_price((float) $amount, ['currency' => get_woocommerce_currency()]);
        }

        return esc_html(number_format_i18n((float) $amount, 2) . ' ' . get_woocommerce_currency());
    }

    private function email_document($preheader, $eyebrow, $title, $intro, array $rows, $cta_label = '', $cta_url = '', $footnote = '') {
        $settings = $this->settings();
        $brand = trim((string) $settings['email_brand_name']) ?: 'RGVPRIME REWARDS';
        $row_html = '';

        foreach ($rows as $row) {
            $label = esc_html((string) ($row['label'] ?? ''));
            $value = wp_kses_post((string) ($row['value'] ?? ''));
            $row_html .= '<tr>';
            $row_html .= '<td class="rgvl-label" style="padding:13px 0;border-bottom:1px solid #dfdfdc;color:#6c6d72;font-family:Arial,sans-serif;font-size:13px;line-height:20px;">' . $label . '</td>';
            $row_html .= '<td class="rgvl-value" align="right" style="padding:13px 0;border-bottom:1px solid #dfdfdc;color:#18191b;font-family:Arial,sans-serif;font-size:14px;line-height:20px;font-weight:700;">' . $value . '</td>';
            $row_html .= '</tr>';
        }

        $cta_html = '';
        if ($cta_label && $cta_url) {
            $cta_html = '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 4px;"><tr><td bgcolor="#ef2b2d" style="border-radius:10px;"><a href="' . esc_url($cta_url) . '" style="display:inline-block;padding:14px 22px;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;font-weight:800;letter-spacing:.02em;">' . esc_html($cta_label) . '</a></td></tr></table>';
        }

        $footnote_html = $footnote
            ? '<p style="margin:22px 0 0;color:#737373;font-family:Arial,sans-serif;font-size:12px;line-height:19px;">' . esc_html($footnote) . '</p>'
            : '';

        $logo = 'https://th9llsxpg16laoh4.public.blob.vercel-storage.com/orgs/acc_614e82d26faf/images/e38eb1cf-7878-4976-b4ea-2b86cab2cb0c';

        return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>' . esc_html($title) . '</title>'
            . '<style>:root{color-scheme:light dark!important;supported-color-schemes:light dark!important}body{margin:0!important;padding:0!important;background:#eeefec!important;color:#18191b!important}.rgvl-preheader{display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all}.rgvl-shell,.rgvl-content{background:#fff;color:#18191b}.rgvl-panel{background:#f6f6f4;border-color:#dfdfdc}.rgvl-copy{color:#66676c}.rgvl-footer{background:#efefec;border-color:#dbdbd8;color:#6c6d72}@media(prefers-color-scheme:dark){body,.rgvl-page{background:#090a0c!important;background-image:linear-gradient(#090a0c,#090a0c)!important;color:#efefed!important}.rgvl-shell,.rgvl-content{background:#101114!important;background-image:linear-gradient(#101114,#101114)!important;color:#efefed!important;border-color:#2a2b2f!important}.rgvl-panel{background:#17181b!important;background-image:linear-gradient(#17181b,#17181b)!important;border-color:#303136!important}.rgvl-copy,.rgvl-label{color:#b6b7bc!important}.rgvl-value{color:#fff!important;border-color:#34353a!important}.rgvl-label{border-color:#34353a!important}.rgvl-footer{background:#0b0c0e!important;background-image:linear-gradient(#0b0c0e,#0b0c0e)!important;border-color:#27282c!important;color:#777980!important}}@media(max-width:600px){.rgvl-outer{padding:18px 8px!important}.rgvl-hero,.rgvl-content{padding-left:21px!important;padding-right:21px!important}.rgvl-title{font-size:36px!important}}</style></head>'
            . '<body bgcolor="#eeefec" style="margin:0;padding:0;background:#eeefec;color:#18191b;font-family:Arial,Helvetica,sans-serif"><div class="rgvl-preheader">' . esc_html($preheader) . '</div>'
            . '<table role="presentation" class="rgvl-page" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#eeefec" style="width:100%;background:#eeefec"><tr><td class="rgvl-outer" align="center" style="padding:30px 12px">'
            . '<table role="presentation" class="rgvl-shell" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:640px;background:#fff;border:1px solid #d5d5d1;border-radius:18px;overflow:hidden">'
            . '<tr><td style="height:4px;background:#a93239;font-size:0;line-height:0">&nbsp;</td></tr><tr><td class="rgvl-hero" bgcolor="#090a0c" style="padding:24px 38px 36px;background:#090a0c;background-image:linear-gradient(110deg,#090a0c 0%,#090a0c 68%,#5d151b 100%);color:#f6f5f2">'
            . '<img src="' . esc_url($logo) . '" width="142" alt="RGVPRIME LLC" style="display:block;width:142px;max-width:100%;height:auto;border:0"><div style="padding-top:40px"><p style="margin:0 0 13px;color:#d05b62;font-size:9px;font-weight:800;letter-spacing:2px;text-transform:uppercase">— &nbsp;' . esc_html($eyebrow) . '</p>'
            . '<h1 class="rgvl-title" style="margin:0;color:#f6f5f2;font-size:44px;line-height:.99;letter-spacing:-2px;font-weight:800">Your rewards,<span style="display:block;margin-top:3px;color:#c43b43">in detail.</span></h1>'
            . '<p style="max-width:425px;margin:19px 0 0;padding-left:14px;border-left:2px solid #70312d;color:#afb0b5;font-size:12px;line-height:1.75">' . wp_kses_post($intro) . '</p></div></td></tr>'
            . '<tr><td class="rgvl-content" bgcolor="#ffffff" style="padding:26px 32px 30px;background:#fff;color:#18191b"><table role="presentation" class="rgvl-panel" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f6f6f4" style="width:100%;background:#f6f6f4;border:1px solid #dfdfdc;border-radius:13px"><tr><td style="padding:22px 24px">'
            . '<h2 style="margin:0 0 15px;color:inherit;font-size:18px;line-height:1.3">' . esc_html($title) . '</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%">' . $row_html . '</table>'
            . $cta_html . $footnote_html . '</td></tr></table></td></tr>'
            . '<tr><td class="rgvl-footer" align="center" bgcolor="#efefec" style="padding:20px 28px;background:#efefec;border-top:1px solid #dbdbd8;color:#6c6d72;font-size:9px;line-height:1.6"><strong style="letter-spacing:1px">' . esc_html($brand) . '</strong><br>This is an automated rewards notification.</td></tr>'
            . '</table></td></tr></table></body></html>';
    }

    private function send_loyalty_email($user_id, $event, array $data = []) {
        if (!$this->notification_enabled($event)) {
            return true;
        }

        $user = get_user_by('id', absint($user_id));
        if (!$user || !is_email($user->user_email)) {
            return false;
        }

        $settings = $this->settings();
        $summary = $this->summary($user->ID);
        $first_name = trim((string) get_user_meta($user->ID, 'first_name', true));
        $name = $first_name ?: $user->display_name ?: __('there', 'rgv-loyalty');
        $account_url = !empty($settings['email_account_url']) ? $settings['email_account_url'] : home_url('/account');
        $points = absint($data['points'] ?? 0);
        $balance = isset($data['balance']) ? (int) $data['balance'] : (int) $summary['points'];
        $order_number = sanitize_text_field((string) ($data['order_number'] ?? ''));
        $reason = sanitize_text_field((string) ($data['reason'] ?? ''));
        $subject = '';
        $title = '';
        $eyebrow = __('Rewards update', 'rgv-loyalty');
        $intro = '';
        $rows = [];
        $cta_label = __('View my rewards', 'rgv-loyalty');
        $cta_url = $account_url;
        $footnote = '';

        switch ($event) {
            case 'earn':
                $subject = sprintf(__('You earned %s rewards points', 'rgv-loyalty'), number_format_i18n($points));
                $title = __('New points added', 'rgv-loyalty');
                $eyebrow = __('Purchase reward', 'rgv-loyalty');
                $intro = sprintf(__('Hi %s, your qualifying purchase has been approved and new points are now available in your rewards account.', 'rgv-loyalty'), esc_html($name));
                $rows = [
                    ['label' => __('Points earned', 'rgv-loyalty'), 'value' => '+' . number_format_i18n($points)],
                    ['label' => __('Order', 'rgv-loyalty'), 'value' => $order_number ? '#' . esc_html($order_number) : '—'],
                    ['label' => __('New balance', 'rgv-loyalty'), 'value' => number_format_i18n($balance) . ' pts'],
                    ['label' => __('Redeemable credit', 'rgv-loyalty'), 'value' => $this->email_money($summary['redeemable_credit'])],
                ];
                break;

            case 'adjustment':
                $delta = (int) ($data['delta'] ?? 0);
                $positive = $delta > 0;
                $subject = $positive
                    ? sprintf(__('%s points were added to your account', 'rgv-loyalty'), number_format_i18n(abs($delta)))
                    : __('Your rewards balance was adjusted', 'rgv-loyalty');
                $title = $positive ? __('Points added by our team', 'rgv-loyalty') : __('Rewards balance adjusted', 'rgv-loyalty');
                $eyebrow = __('Manual account update', 'rgv-loyalty');
                $intro = sprintf(__('Hi %s, our team made a documented adjustment to your rewards account.', 'rgv-loyalty'), esc_html($name));
                $rows = [
                    ['label' => __('Adjustment', 'rgv-loyalty'), 'value' => ($delta > 0 ? '+' : '') . number_format_i18n($delta) . ' pts'],
                    ['label' => __('Reason', 'rgv-loyalty'), 'value' => esc_html($reason ?: __('Manual account adjustment', 'rgv-loyalty'))],
                    ['label' => __('New balance', 'rgv-loyalty'), 'value' => number_format_i18n($balance) . ' pts'],
                ];
                break;

            case 'redeem':
                $credit = (float) ($data['credit'] ?? 0);
                $coupon_code = sanitize_text_field((string) ($data['coupon'] ?? ''));
                $expires = sanitize_text_field((string) ($data['expires'] ?? ''));
                $subject = sprintf(__('Your %s reward is ready', 'rgv-loyalty'), wp_strip_all_tags($this->email_money($credit)));
                $title = __('Your reward code is ready', 'rgv-loyalty');
                $eyebrow = __('Points redeemed', 'rgv-loyalty');
                $intro = sprintf(__('Hi %s, your points were securely converted into store credit. This code is linked to your account and can be used once.', 'rgv-loyalty'), esc_html($name));
                $rows = [
                    ['label' => __('Reward code', 'rgv-loyalty'), 'value' => '<span style="font-family:monospace;font-size:16px;letter-spacing:.08em;color:inherit;">' . esc_html($coupon_code) . '</span>'],
                    ['label' => __('Store credit', 'rgv-loyalty'), 'value' => $this->email_money($credit)],
                    ['label' => __('Points used', 'rgv-loyalty'), 'value' => number_format_i18n($points) . ' pts'],
                    ['label' => __('Expires', 'rgv-loyalty'), 'value' => esc_html($expires ?: '—')],
                    ['label' => __('Remaining balance', 'rgv-loyalty'), 'value' => number_format_i18n($balance) . ' pts'],
                ];
                $cta_label = __('Shop with my reward', 'rgv-loyalty');
                $cta_url = home_url('/shop');
                $footnote = __('The code is restricted to the email address on your rewards account and cannot be combined with another loyalty reward.', 'rgv-loyalty');
                break;

            case 'restore':
                $subject = sprintf(__('%s rewards points were restored', 'rgv-loyalty'), number_format_i18n($points));
                $title = __('Reward points restored', 'rgv-loyalty');
                $eyebrow = __('Order adjustment', 'rgv-loyalty');
                $intro = sprintf(__('Hi %s, a reward attached to an order was canceled or fully refunded, so its points were returned to your account.', 'rgv-loyalty'), esc_html($name));
                $rows = [
                    ['label' => __('Points restored', 'rgv-loyalty'), 'value' => '+' . number_format_i18n($points)],
                    ['label' => __('Order', 'rgv-loyalty'), 'value' => $order_number ? '#' . esc_html($order_number) : '—'],
                    ['label' => __('New balance', 'rgv-loyalty'), 'value' => number_format_i18n($balance) . ' pts'],
                ];
                break;

            case 'reversal':
                $subject = __('Your rewards balance was updated', 'rgv-loyalty');
                $title = __('Points adjusted after an order change', 'rgv-loyalty');
                $eyebrow = __('Refund or reversal', 'rgv-loyalty');
                $intro = sprintf(__('Hi %s, points from a refunded, canceled, or reduced purchase were removed from your rewards account.', 'rgv-loyalty'), esc_html($name));
                $rows = [
                    ['label' => __('Points removed', 'rgv-loyalty'), 'value' => '−' . number_format_i18n($points)],
                    ['label' => __('Order', 'rgv-loyalty'), 'value' => $order_number ? '#' . esc_html($order_number) : '—'],
                    ['label' => __('New balance', 'rgv-loyalty'), 'value' => number_format_i18n($balance) . ' pts'],
                ];
                $footnote = __('Any unused loyalty reward funded by the affected points may be automatically revoked. A negative balance must be repaid with future earned points before another reward can be redeemed.', 'rgv-loyalty');
                break;

            default:
                return false;
        }

        $html = $this->email_document(
            $subject,
            $eyebrow,
            $title,
            $intro,
            $rows,
            $cta_label,
            $cta_url,
            $footnote
        );

        $headers = ['Content-Type: text/html; charset=UTF-8'];
        $sent = false;

        if (function_exists('WC') && WC() && WC()->mailer()) {
            $sent = WC()->mailer()->send(
                $user->user_email,
                wp_specialchars_decode($subject, ENT_QUOTES),
                $html,
                $headers,
                []
            );
        } else {
            $sent = wp_mail(
                $user->user_email,
                wp_specialchars_decode($subject, ENT_QUOTES),
                $html,
                $headers
            );
        }

        if (!$sent) {
            $this->log('error', 'Unable to send loyalty notification email.', [
                'user_id' => $user->ID,
                'event' => $event,
            ]);
        }

        return (bool) $sent;
    }

    /**
     * Merchandise only, after discounts, including its tax. Shipping and fees never earn points.
     */
    private function eligible_order_total($order) {
        $eligible = 0.0;

        foreach ($order->get_items('line_item') as $item) {
            $eligible += max(0, (float) $item->get_total() + (float) $item->get_total_tax());
        }

        return max(0, $eligible);
    }

    private function refund_merchandise_total($refund) {
        $line_total = 0.0;

        foreach ($refund->get_items('line_item') as $item) {
            $line_total += abs((float) $item->get_total() + (float) $item->get_total_tax());
        }

        if ($line_total > 0) {
            return $line_total;
        }

        // Manual amount-only refunds have no product lines. Exclude any explicit shipping and fee refunds.
        $shipping = 0.0;
        foreach ($refund->get_items('shipping') as $item) {
            $shipping += abs((float) $item->get_total() + (float) $item->get_total_tax());
        }

        $fees = 0.0;
        foreach ($refund->get_items('fee') as $item) {
            $fees += abs((float) $item->get_total() + (float) $item->get_total_tax());
        }

        return max(0, abs((float) $refund->get_total()) - $shipping - $fees);
    }

    private function refunded_merchandise_total($order) {
        $refunded = 0.0;

        foreach ($order->get_refunds() as $refund) {
            $refunded += $this->refund_merchandise_total($refund);
        }

        return min($this->eligible_order_total($order), max(0, $refunded));
    }

    private function target_order_points($order) {
        $settings = $this->settings();
        $eligible_statuses = ['completed'];

        if (!empty($settings['award_processing'])) {
            $eligible_statuses[] = 'processing';
        }

        if (!in_array($order->get_status(), $eligible_statuses, true)) {
            return 0;
        }

        $net_merchandise = max(0, $this->eligible_order_total($order) - $this->refunded_merchandise_total($order));
        return max(0, (int) floor($net_merchandise * (float) $settings['points_per_dollar']));
    }

    private function coupon_status($coupon) {
        $status = sanitize_key((string) $coupon->get_meta(self::COUPON_STATUS_META, true));

        if ($status) {
            return $status;
        }

        // Compatibility with coupons generated by version 1.0.0.
        if ($coupon->get_meta('_rgv_loyalty_restored', true)) {
            return self::COUPON_STATUS_RESTORED;
        }

        return self::COUPON_STATUS_ACTIVE;
    }

    private function invalidate_coupon_unlocked($coupon, $status, $reason, $order_id = 0) {
        if ($coupon->get_id()) {
            $this->transaction_post_ids[$coupon->get_id()] = true;
        }
        $coupon->update_meta_data(self::COUPON_STATUS_META, sanitize_key($status));
        $coupon->update_meta_data(self::COUPON_REVOKED_REASON_META, sanitize_text_field($reason));
        $coupon->set_date_expires(time() - DAY_IN_SECONDS);

        if ($status === self::COUPON_STATUS_RESTORED && $order_id) {
            $coupon->update_meta_data(self::COUPON_RESTORED_ORDER_META, absint($order_id));
            $coupon->update_meta_data('_rgv_loyalty_restored', 1);
        }

        $coupon->save();
    }

    private function customer_coupon_ids($user_id) {
        return get_posts([
            'post_type' => 'shop_coupon',
            'post_status' => ['publish', 'draft'],
            'posts_per_page' => -1,
            'fields' => 'ids',
            'orderby' => 'date',
            'order' => 'ASC',
            'no_found_rows' => true,
            'meta_query' => [
                [
                    'key' => self::COUPON_OWNER_META,
                    'value' => absint($user_id),
                    'compare' => '=',
                    'type' => 'NUMERIC',
                ],
            ],
        ]);
    }

    /**
     * Before creating loyalty debt, revoke unused active rewards and return their points.
     * Used rewards are never silently restored; their owner correctly keeps a negative balance.
     */
    private function reclaim_unspent_rewards_unlocked($user_id, $points_needed, $reason, $reference = '') {
        if (!class_exists('WC_Coupon') || $points_needed < 1) {
            return 0;
        }

        $reclaimed = 0;

        foreach ($this->customer_coupon_ids($user_id) as $coupon_id) {
            $coupon = new WC_Coupon($coupon_id);

            if ($this->coupon_status($coupon) !== self::COUPON_STATUS_ACTIVE) {
                continue;
            }

            if ((int) $coupon->get_usage_count() > 0) {
                continue;
            }

            $expires = $coupon->get_date_expires();
            if ($expires && $expires->getTimestamp() < time()) {
                continue;
            }

            $points = absint($coupon->get_meta(self::COUPON_POINTS_META, true));
            if ($points < 1) {
                continue;
            }

            $this->invalidate_coupon_unlocked(
                $coupon,
                self::COUPON_STATUS_REVOKED,
                $reason
            );

            $result = $this->transaction_unlocked(
                $user_id,
                $points,
                'coupon_revoked',
                sprintf(__('Unused reward %s was revoked and returned to points.', 'rgv-loyalty'), $coupon->get_code()),
                $reference ?: (string) $coupon_id,
                true
            );

            if (is_wp_error($result)) {
                throw new RuntimeException($result->get_error_message());
            }

            $reclaimed += $points;
            if ($reclaimed >= $points_needed) {
                break;
            }
        }

        return $reclaimed;
    }

    public function handle_order_status_changed($order_id, $from, $to, $order) {
        if (!$order instanceof WC_Order) {
            $order = wc_get_order($order_id);
        }

        if (!$order) {
            return;
        }

        $this->sync_order_points($order);

        if (in_array($to, ['processing', 'completed'], true)) {
            $this->mark_reward_coupons_used($order);
        }

        if (in_array($to, ['cancelled', 'failed', 'refunded'], true)) {
            $this->restore_reward_coupons($order, $to);
        }
    }

    public function handle_order_refunded($order_id, $refund_id) {
        $order = wc_get_order($order_id);
        $refund = wc_get_order($refund_id);

        if (!$order || !$refund) {
            return;
        }

        // This marker makes the refund event auditable and harmless if WooCommerce fires it again.
        if (!$refund->get_meta(self::REFUND_POINTS_META, true)) {
            $refund->update_meta_data(self::REFUND_POINTS_META, 'synced');
            $refund->save_meta_data();
        }

        $this->sync_order_points($order);

        $total = (float) $order->get_total();
        $refunded = abs((float) $order->get_total_refunded());
        if ($total > 0 && ($refunded + 0.01) >= $total) {
            $this->restore_reward_coupons($order, 'full_refund');
        }
    }

    private function sync_order_points($order) {
        if (!class_exists('WooCommerce') || !$order instanceof WC_Order || !$order->get_customer_id()) {
            return;
        }

        $user_id = absint($order->get_customer_id());
        $order_id = $order->get_id();

        $result = $this->with_user_lock($user_id, function () use ($user_id, $order, $order_id) {
            return $this->db_transaction(function () use ($user_id, $order, $order_id) {
                $order->read_meta_data(true);
                $current = (int) $order->get_meta(self::ORDER_POINTS_META, true);
                $target = $this->target_order_points($order);
                $delta = $target - $current;

                if ($delta === 0) {
                    return [
                        'changed' => false,
                        'delta' => 0,
                        'balance' => $this->get_balance($user_id),
                    ];
                }

                $reclaimed = 0;
                if ($delta < 0) {
                    $reclaimed = $this->reclaim_unspent_rewards_unlocked(
                        $user_id,
                        abs($delta),
                        sprintf('Points source order #%s was reduced or reversed.', $order->get_order_number()),
                        (string) $order_id
                    );
                }

                $type = $delta > 0 ? 'earn' : 'reversal';
                $description = $delta > 0
                    ? sprintf(__('Points earned on order #%s', 'rgv-loyalty'), $order->get_order_number())
                    : sprintf(__('Points reversed or adjusted for order #%s', 'rgv-loyalty'), $order->get_order_number());

                $transaction = $this->transaction_unlocked(
                    $user_id,
                    $delta,
                    $type,
                    $description,
                    (string) $order_id,
                    true
                );

                if (is_wp_error($transaction)) {
                    return $transaction;
                }

                $this->transaction_post_ids[$order_id] = true;
                $order->update_meta_data(self::ORDER_POINTS_META, $target);
                $order->save_meta_data();

                return [
                    'changed' => true,
                    'delta' => $delta,
                    'balance' => (int) $transaction['after'],
                    'reclaimed' => $reclaimed,
                ];
            });
        });

        if (is_wp_error($result)) {
            $this->log('error', 'Unable to synchronize loyalty points for an order.', [
                'order_id' => $order_id,
                'error' => $result->get_error_message(),
            ]);
            return;
        }

        if (empty($result['changed']) || empty($result['delta'])) {
            return;
        }

        $delta = (int) $result['delta'];
        $this->send_loyalty_email(
            $user_id,
            $delta > 0 ? 'earn' : 'reversal',
            [
                'points' => abs($delta),
                'balance' => (int) $result['balance'],
                'order_number' => $order->get_order_number(),
                'reclaimed' => absint($result['reclaimed'] ?? 0),
            ]
        );
    }

    private function mark_reward_coupons_used($order) {
        foreach ($order->get_coupon_codes() as $code) {
            $coupon_id = wc_get_coupon_id_by_code($code);
            if (!$coupon_id) {
                continue;
            }

            $coupon = new WC_Coupon($coupon_id);
            $owner_id = absint($coupon->get_meta(self::COUPON_OWNER_META, true));

            if (!$owner_id || !in_array($this->coupon_status($coupon), [self::COUPON_STATUS_ACTIVE, self::COUPON_STATUS_USED], true)) {
                continue;
            }

            $result = $this->with_user_lock($owner_id, function () use ($coupon_id, $order) {
                return $this->db_transaction(function () use ($coupon_id, $order) {
                    $fresh_coupon = new WC_Coupon($coupon_id);
                    $status = $this->coupon_status($fresh_coupon);

                    if (!in_array($status, [self::COUPON_STATUS_ACTIVE, self::COUPON_STATUS_USED], true)) {
                        return true;
                    }

                    $this->transaction_post_ids[$coupon_id] = true;
                    $fresh_coupon->update_meta_data(self::COUPON_STATUS_META, self::COUPON_STATUS_USED);
                    $fresh_coupon->update_meta_data(self::COUPON_USED_ORDER_META, $order->get_id());
                    $fresh_coupon->save();
                    return true;
                });
            });

            if (is_wp_error($result)) {
                $this->log('error', 'Unable to mark a loyalty coupon as used.', [
                    'coupon_id' => $coupon_id,
                    'order_id' => $order->get_id(),
                    'error' => $result->get_error_message(),
                ]);
            }
        }
    }

    private function restore_reward_coupons($order, $reason) {
        foreach ($order->get_coupon_codes() as $code) {
            $coupon_id = wc_get_coupon_id_by_code($code);
            if (!$coupon_id) {
                continue;
            }

            $coupon = new WC_Coupon($coupon_id);
            $owner_id = absint($coupon->get_meta(self::COUPON_OWNER_META, true));
            $points = absint($coupon->get_meta(self::COUPON_POINTS_META, true));

            if (!$owner_id || !$points) {
                continue;
            }

            $result = $this->with_user_lock($owner_id, function () use ($coupon_id, $owner_id, $points, $order, $reason) {
                return $this->db_transaction(function () use ($coupon_id, $owner_id, $points, $order, $reason) {
                    $fresh_coupon = new WC_Coupon($coupon_id);
                    $status = $this->coupon_status($fresh_coupon);

                    if (in_array($status, [self::COUPON_STATUS_RESTORED, self::COUPON_STATUS_REVOKED], true)) {
                        return [
                            'restored' => false,
                            'balance' => $this->get_balance($owner_id),
                        ];
                    }

                    $this->invalidate_coupon_unlocked(
                        $fresh_coupon,
                        self::COUPON_STATUS_RESTORED,
                        sprintf('Reward order #%s ended as %s.', $order->get_order_number(), sanitize_key($reason)),
                        $order->get_id()
                    );

                    $transaction = $this->transaction_unlocked(
                        $owner_id,
                        $points,
                        'restore',
                        sprintf(__('Reward restored from order #%s', 'rgv-loyalty'), $order->get_order_number()),
                        (string) $order->get_id(),
                        true
                    );

                    if (is_wp_error($transaction)) {
                        return $transaction;
                    }

                    return [
                        'restored' => true,
                        'balance' => (int) $transaction['after'],
                    ];
                });
            });

            if (is_wp_error($result)) {
                $this->log('error', 'Unable to restore a loyalty reward from an order.', [
                    'coupon_id' => $coupon_id,
                    'order_id' => $order->get_id(),
                    'error' => $result->get_error_message(),
                ]);
                continue;
            }

            if (!empty($result['restored'])) {
                $this->send_loyalty_email($owner_id, 'restore', [
                    'points' => $points,
                    'balance' => (int) $result['balance'],
                    'order_number' => $order->get_order_number(),
                    'reason' => $reason,
                ]);
            }
        }
    }

    public function summary($user_id) {
        $settings = $this->settings();
        $points = $this->get_balance($user_id);
        $minimum = (int) $settings['minimum_points'];
        $block = (int) $settings['points_per_reward'];
        $reward = (float) $settings['reward_value'];
        $positive_points = max(0, $points);
        $redeemable_blocks = $positive_points >= $minimum ? (int) floor($positive_points / $block) : 0;

        return [
            'points' => $points,
            'has_debt' => $points < 0,
            'minimum_points' => $minimum,
            'points_per_reward' => $block,
            'reward_value' => $reward,
            'redeemable_points' => $redeemable_blocks * $block,
            'redeemable_credit' => $redeemable_blocks * $reward,
            'can_redeem' => $points >= $minimum && $redeemable_blocks > 0,
            'points_to_unlock' => $points < 0 ? abs($points) + $minimum : max(0, $minimum - $points),
            'progress' => $points < 0 ? 0 : min(100, round(($points / max(1, $minimum)) * 100, 1)),
            'history' => array_slice($this->history($user_id), 0, 25),
        ];
    }

    public function register_routes() {
        register_rest_route('rgv-portal/v1', '/loyalty/redeem', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'rest_redeem'],
            'permission_callback' => [$this, 'rest_permission'],
            'args' => [
                'points' => [
                    'required' => false,
                    'sanitize_callback' => 'absint',
                    'validate_callback' => function ($value) {
                        return $value === null || is_numeric($value);
                    },
                ],
            ],
        ]);
    }

    private function request_key($request) {
        return spl_object_hash($request);
    }

    private function authenticate_portal_customer($request) {
        if (function_exists('rgvp_secret_permission') && function_exists('rgvp_auth_user_from_request')) {
            $permission = rgvp_secret_permission($request);
            if (is_wp_error($permission)) {
                return $permission;
            }

            $auth = rgvp_auth_user_from_request($request);
            if (!$auth || empty($auth['user']) || !$auth['user'] instanceof WP_User) {
                return new WP_Error('loyalty_session', __('Your session has expired.', 'rgv-loyalty'), ['status' => 401]);
            }

            return $auth['user'];
        }

        // Backwards-compatible fallback for portal implementations that do not expose helper functions.
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
        $user_data = is_array($data) ? ($data['user'] ?? []) : [];
        $user = !empty($user_data['id']) ? get_user_by('id', absint($user_data['id'])) : null;

        if (!$user && !empty($user_data['email'])) {
            $user = get_user_by('email', sanitize_email($user_data['email']));
        }

        return $user ?: new WP_Error('loyalty_customer', __('Customer account not found.', 'rgv-loyalty'), ['status' => 404]);
    }

    public function rest_permission($request) {
        $user = $this->authenticate_portal_customer($request);
        if (is_wp_error($user)) {
            return $user;
        }

        $this->request_users[$this->request_key($request)] = $user->ID;
        return true;
    }

    private function rest_customer($request) {
        $key = $this->request_key($request);
        $user_id = absint($this->request_users[$key] ?? 0);

        if ($user_id) {
            $user = get_user_by('id', $user_id);
            if ($user) {
                return $user;
            }
        }

        return $this->authenticate_portal_customer($request);
    }

    private function throttle_redemption($user_id) {
        $key = 'rgvl_redeem_' . absint($user_id);
        $attempts = (int) get_transient($key);

        if ($attempts >= 20) {
            return new WP_Error(
                'loyalty_rate_limit',
                __('Too many reward requests. Try again later.', 'rgv-loyalty'),
                ['status' => 429]
            );
        }

        set_transient($key, $attempts + 1, 10 * MINUTE_IN_SECONDS);
        return true;
    }

    private function idempotency_key($request) {
        $key = trim((string) $request->get_header('idempotency-key'));
        if (!$key || strlen($key) > 80 || !preg_match('/^[A-Za-z0-9._:-]+$/', $key)) {
            return '';
        }

        return hash('sha256', $key);
    }

    private function idempotency_records_unlocked($user_id) {
        $records = get_user_meta($user_id, self::IDEMPOTENCY_META, true);
        $records = is_array($records) ? $records : [];
        $cutoff = time() - DAY_IN_SECONDS;

        foreach ($records as $key => $record) {
            if (!is_array($record) || absint($record['created'] ?? 0) < $cutoff) {
                unset($records[$key]);
            }
        }

        return $records;
    }

    private function coupon_response($coupon, $user_id, $message = '') {
        $expires = $coupon->get_date_expires();

        return new WP_REST_Response([
            'success' => true,
            'message' => $message ?: __('Your store-credit code is ready.', 'rgv-loyalty'),
            'coupon' => $coupon->get_code(),
            'credit' => (float) $coupon->get_amount(),
            'expires' => $expires ? gmdate('Y-m-d', $expires->getTimestamp()) : null,
            'loyalty' => $this->summary($user_id),
        ], 200);
    }

    public function rest_redeem($request) {
        if (!class_exists('WooCommerce') || !class_exists('WC_Coupon')) {
            return new WP_Error('loyalty_woocommerce', __('WooCommerce is required.', 'rgv-loyalty'), ['status' => 503]);
        }

        $user = $this->rest_customer($request);
        if (is_wp_error($user)) {
            return $user;
        }

        $throttle = $this->throttle_redemption($user->ID);
        if (is_wp_error($throttle)) {
            return $throttle;
        }

        $requested = absint($request->get_param('points'));
        $idempotency_key = $this->idempotency_key($request);

        $result = $this->with_user_lock($user->ID, function () use ($user, $requested, $idempotency_key) {
            return $this->db_transaction(function () use ($user, $requested, $idempotency_key) {
                wp_cache_delete($user->ID, 'user_meta');

                $records = $this->idempotency_records_unlocked($user->ID);
                if ($idempotency_key && !empty($records[$idempotency_key]['coupon_id'])) {
                    $coupon = new WC_Coupon(absint($records[$idempotency_key]['coupon_id']));
                    $status = $this->coupon_status($coupon);

                    if (in_array($status, [self::COUPON_STATUS_ACTIVE, self::COUPON_STATUS_USED], true)) {
                        return [
                            'coupon_id' => $coupon->get_id(),
                            'replayed' => true,
                        ];
                    }

                    return new WP_Error(
                        'loyalty_idempotency_reused',
                        __('This reward request was already completed and can no longer be replayed.', 'rgv-loyalty'),
                        ['status' => 409]
                    );
                }

                $summary = $this->summary($user->ID);
                if (!$summary['can_redeem']) {
                    $message = $summary['has_debt']
                        ? __('Your rewards account has a negative balance and cannot redeem yet.', 'rgv-loyalty')
                        : sprintf(__('You need at least %d points to redeem.', 'rgv-loyalty'), $summary['minimum_points']);

                    return new WP_Error('loyalty_locked', $message, ['status' => 400]);
                }

                $points = $requested ?: (int) $summary['redeemable_points'];
                $block = (int) $summary['points_per_reward'];

                if (
                    $points < (int) $summary['minimum_points'] ||
                    $points % $block !== 0 ||
                    $points > (int) $summary['redeemable_points']
                ) {
                    return new WP_Error(
                        'loyalty_points',
                        __('Choose an available whole reward amount.', 'rgv-loyalty'),
                        ['status' => 400]
                    );
                }

                // Deduct first inside the transaction. A failure rolls back both balance and coupon.
                $transaction = $this->transaction_unlocked(
                    $user->ID,
                    -$points,
                    'redeem',
                    sprintf(__('Redeemed %d points for store credit.', 'rgv-loyalty'), $points),
                    '',
                    false
                );

                if (is_wp_error($transaction)) {
                    return $transaction;
                }

                $credit = ($points / $block) * (float) $summary['reward_value'];
                $code = $this->unique_coupon_code();
                $expiry_timestamp = strtotime('+' . absint($this->settings()['coupon_expiry_days']) . ' days');
                $redemption_id = wp_generate_uuid4();

                $coupon = new WC_Coupon();
                $coupon->set_code($code);
                $coupon->set_description(sprintf('RGV loyalty reward for user #%d. Redemption %s.', $user->ID, $redemption_id));
                $coupon->set_discount_type('fixed_cart');
                $coupon->set_amount(wc_format_decimal($credit));
                $coupon->set_usage_limit(1);
                $coupon->set_usage_limit_per_user(1);
                $coupon->set_individual_use(true);
                $coupon->set_email_restrictions([sanitize_email($user->user_email)]);
                $coupon->set_date_expires($expiry_timestamp);
                $coupon->add_meta_data(self::COUPON_OWNER_META, $user->ID, true);
                $coupon->add_meta_data(self::COUPON_POINTS_META, $points, true);
                $coupon->add_meta_data(self::COUPON_STATUS_META, self::COUPON_STATUS_ACTIVE, true);
                $coupon->add_meta_data(self::COUPON_REDEMPTION_META, $redemption_id, true);
                $coupon->add_meta_data(self::COUPON_CREATED_META, current_time('mysql', true), true);
                $coupon->save();

                if (!$coupon->get_id()) {
                    throw new RuntimeException('WooCommerce did not create the loyalty coupon.');
                }
                $this->transaction_post_ids[$coupon->get_id()] = true;

                // Attach the coupon ID to the newest redemption history item for auditability.
                $history = $this->history($user->ID);
                if (!empty($history[0]) && $history[0]['type'] === 'redeem' && empty($history[0]['reference'])) {
                    $history[0]['reference'] = (string) $coupon->get_id();
                    $this->transaction_user_ids[$user->ID] = true;
                    if (update_user_meta($user->ID, self::HISTORY_META, $history) === false) {
                        throw new RuntimeException('Unable to attach the coupon to the redemption history.');
                    }
                }

                if ($idempotency_key) {
                    $records[$idempotency_key] = [
                        'coupon_id' => $coupon->get_id(),
                        'created' => time(),
                    ];
                    $this->transaction_user_ids[$user->ID] = true;
                    if (update_user_meta($user->ID, self::IDEMPOTENCY_META, array_slice($records, -50, null, true)) === false) {
                        throw new RuntimeException('Unable to persist the redemption idempotency record.');
                    }
                }

                return [
                    'coupon_id' => $coupon->get_id(),
                    'replayed' => false,
                ];
            });
        });

        if (is_wp_error($result)) {
            return $result;
        }

        $coupon = new WC_Coupon(absint($result['coupon_id'] ?? 0));
        if (!$coupon->get_id()) {
            return new WP_Error(
                'loyalty_coupon_missing',
                __('The reward was created but could not be loaded. Contact support.', 'rgv-loyalty'),
                ['status' => 500]
            );
        }

        if (empty($result['replayed'])) {
            $expires = $coupon->get_date_expires();
            $this->send_loyalty_email($user->ID, 'redeem', [
                'points' => absint($coupon->get_meta(self::COUPON_POINTS_META, true)),
                'balance' => $this->get_balance($user->ID),
                'credit' => (float) $coupon->get_amount(),
                'coupon' => $coupon->get_code(),
                'expires' => $expires ? wp_date(get_option('date_format'), $expires->getTimestamp()) : '',
            ]);
        }

        return $this->coupon_response(
            $coupon,
            $user->ID,
            !empty($result['replayed'])
                ? __('This request was already completed. The original code is shown again.', 'rgv-loyalty')
                : __('Your store-credit code is ready.', 'rgv-loyalty')
        );
    }

    private function unique_coupon_code() {
        for ($attempt = 0; $attempt < 10; $attempt++) {
            $code = 'LOYALTY-' . strtoupper(wp_generate_password(18, false, false));
            if (!wc_get_coupon_id_by_code($code)) {
                return $code;
            }
        }

        throw new RuntimeException('Unable to generate a unique loyalty coupon code.');
    }

    /**
     * Extra ownership and fraud checks beyond WooCommerce's email restriction.
     */
    public function validate_loyalty_coupon($valid, $coupon, $discounts = null) {
        if (!$valid || !$coupon instanceof WC_Coupon) {
            return $valid;
        }

        $owner_id = absint($coupon->get_meta(self::COUPON_OWNER_META, true));
        if (!$owner_id) {
            return $valid;
        }

        $status = $this->coupon_status($coupon);
        if (in_array($status, [self::COUPON_STATUS_REVOKED, self::COUPON_STATUS_RESTORED], true)) {
            return false;
        }

        if ($this->get_balance($owner_id) < 0) {
            return false;
        }

        $current_user_id = get_current_user_id();
        $checkout_user_id = 0;
        $billing_email = '';

        // Prefer the customer attached to WooCommerce's discount context. This also
        // works for headless checkout requests when there is no WordPress login cookie.
        if (is_object($discounts) && method_exists($discounts, 'get_customer')) {
            $discount_customer = $discounts->get_customer();
            if (is_object($discount_customer)) {
                if (method_exists($discount_customer, 'get_id')) {
                    $checkout_user_id = absint($discount_customer->get_id());
                }
                if (method_exists($discount_customer, 'get_billing_email')) {
                    $billing_email = strtolower(sanitize_email((string) $discount_customer->get_billing_email()));
                }
            }
        }

        if (function_exists('WC') && WC()->customer) {
            if (!$checkout_user_id && method_exists(WC()->customer, 'get_id')) {
                $checkout_user_id = absint(WC()->customer->get_id());
            }
            if (!$billing_email && method_exists(WC()->customer, 'get_billing_email')) {
                $billing_email = strtolower(sanitize_email((string) WC()->customer->get_billing_email()));
            }
        }

        $known_user_id = $current_user_id ?: $checkout_user_id;
        if ($known_user_id && $known_user_id !== $owner_id) {
            return false;
        }

        $owner = get_user_by('id', $owner_id);
        $owner_email = $owner ? strtolower(sanitize_email((string) $owner->user_email)) : '';

        if ($billing_email && $owner_email && !hash_equals($owner_email, $billing_email)) {
            return false;
        }

        return true;
    }

    public function add_loyalty_to_portal_response($response, $server, $request) {
        if (!in_array($request->get_route(), [
            '/rgv-portal/v1/me',
            '/rgv-portal/v1/login',
            '/rgv-portal/v1/register',
        ], true) || is_wp_error($response) || !is_object($response) || !method_exists($response, 'get_data')) {
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
        if (!class_exists('WooCommerce')) {
            return;
        }

        add_submenu_page(
            'woocommerce',
            __('RGV Loyalty Program', 'rgv-loyalty'),
            __('Loyalty Program', 'rgv-loyalty'),
            'manage_woocommerce',
            'rgv-loyalty',
            [$this, 'admin_page']
        );
    }

    public function user_column($columns) {
        $columns['rgv_loyalty'] = __('Loyalty points', 'rgv-loyalty');
        return $columns;
    }

    public function user_column_value($value, $column, $user_id) {
        if ($column !== 'rgv_loyalty') {
            return $value;
        }

        $balance = $this->get_balance($user_id);
        $style = $balance < 0 ? ' style="color:#b32d2e;font-weight:700"' : '';
        return '<span' . $style . '>' . esc_html(number_format_i18n($balance)) . '</span>';
    }

    public function admin_adjust() {
        if (!current_user_can('manage_woocommerce')) {
            wp_die(esc_html__('Access denied.', 'rgv-loyalty'));
        }

        check_admin_referer('rgv_loyalty_adjust');

        $user_id = absint($_POST['user_id'] ?? 0);
        $points = (int) ($_POST['points'] ?? 0);
        $points = max(-10000000, min(10000000, $points));
        $note = sanitize_text_field(wp_unslash($_POST['note'] ?? ''));
        $redirect_args = [
            'page' => 'rgv-loyalty',
            's' => sanitize_text_field(wp_unslash($_POST['return_search'] ?? '')),
            'status' => sanitize_key(wp_unslash($_POST['return_status'] ?? 'all')),
            'paged' => max(1, absint($_POST['return_page'] ?? 1)),
        ];

        if (!$user_id || !$points || !$note) {
            $redirect_args['rgv_error'] = rawurlencode(__('Enter a valid point amount and a clear reason.', 'rgv-loyalty'));
            wp_safe_redirect(add_query_arg($redirect_args, admin_url('admin.php')));
            exit;
        }

        $result = $this->with_user_lock($user_id, function () use ($user_id, $points, $note) {
            return $this->db_transaction(function () use ($user_id, $points, $note) {
                $reclaimed = 0;
                if ($points < 0) {
                    $reclaimed = $this->reclaim_unspent_rewards_unlocked(
                        $user_id,
                        abs($points),
                        'An administrator reduced the customer loyalty balance.',
                        'admin:' . get_current_user_id()
                    );
                }

                $transaction = $this->transaction_unlocked(
                    $user_id,
                    $points,
                    'adjustment',
                    $note,
                    'admin:' . get_current_user_id(),
                    true
                );

                if (is_wp_error($transaction)) {
                    return $transaction;
                }

                return [
                    'balance' => (int) $transaction['after'],
                    'reclaimed' => $reclaimed,
                ];
            });
        });

        if (is_wp_error($result)) {
            $redirect_args['rgv_error'] = rawurlencode($result->get_error_message());
            wp_safe_redirect(add_query_arg($redirect_args, admin_url('admin.php')));
            exit;
        }

        $email_sent = $this->send_loyalty_email($user_id, 'adjustment', [
            'delta' => $points,
            'balance' => (int) $result['balance'],
            'reason' => $note,
            'reclaimed' => absint($result['reclaimed'] ?? 0),
        ]);

        if (!$email_sent && $this->notification_enabled('adjustment')) {
            $redirect_args['email_failed'] = 1;
        }

        $redirect_args['updated'] = 1;
        wp_safe_redirect(add_query_arg($redirect_args, admin_url('admin.php')));
        exit;
    }

    public function admin_enqueue_assets($hook_suffix) {
        if ($hook_suffix !== 'woocommerce_page_rgv-loyalty') {
            return;
        }

        wp_enqueue_style('dashicons');
        wp_enqueue_style(
            'rgv-loyalty-admin',
            plugin_dir_url(__FILE__) . 'assets/admin.css',
            [],
            self::VERSION
        );
    }

    private function admin_stats() {
        global $wpdb;

        $minimum = absint($this->settings()['minimum_points']);
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT
                COUNT(*) AS tracked_accounts,
                COALESCE(SUM(CASE WHEN CAST(meta_value AS SIGNED) > 0 THEN CAST(meta_value AS SIGNED) ELSE 0 END), 0) AS points_in_circulation,
                COALESCE(SUM(CASE WHEN CAST(meta_value AS SIGNED) >= %d THEN 1 ELSE 0 END), 0) AS ready_accounts,
                COALESCE(SUM(CASE WHEN CAST(meta_value AS SIGNED) < 0 THEN 1 ELSE 0 END), 0) AS debt_accounts
             FROM {$wpdb->usermeta}
             WHERE meta_key = %s",
            $minimum,
            self::BALANCE_META
        ), ARRAY_A);

        $active_rewards = 0;
        if (class_exists('WC_Coupon')) {
            $coupon_query = new WP_Query([
                'post_type' => 'shop_coupon',
                'post_status' => ['publish', 'draft'],
                'posts_per_page' => 1,
                'fields' => 'ids',
                'no_found_rows' => false,
                'meta_query' => [
                    [
                        'key' => self::COUPON_STATUS_META,
                        'value' => self::COUPON_STATUS_ACTIVE,
                        'compare' => '=',
                    ],
                ],
            ]);
            $active_rewards = absint($coupon_query->found_posts);
        }

        return [
            'tracked_accounts' => absint($row['tracked_accounts'] ?? 0),
            'points_in_circulation' => (int) ($row['points_in_circulation'] ?? 0),
            'ready_accounts' => absint($row['ready_accounts'] ?? 0),
            'debt_accounts' => absint($row['debt_accounts'] ?? 0),
            'active_rewards' => $active_rewards,
        ];
    }

    private function customer_status($summary) {
        if ((int) $summary['points'] < 0) {
            return ['label' => __('Balance due', 'rgv-loyalty'), 'class' => 'is-debt'];
        }

        if (!empty($summary['can_redeem'])) {
            return ['label' => __('Reward ready', 'rgv-loyalty'), 'class' => 'is-ready'];
        }

        if ((int) $summary['points'] > 0) {
            return ['label' => __('Earning', 'rgv-loyalty'), 'class' => 'is-earning'];
        }

        return ['label' => __('No activity', 'rgv-loyalty'), 'class' => 'is-empty'];
    }

    public function admin_page() {
        if (!current_user_can('manage_woocommerce')) {
            return;
        }

        $settings = $this->settings();
        $stats = $this->admin_stats();
        $search = sanitize_text_field(wp_unslash($_GET['s'] ?? ''));
        $status_filter = sanitize_key(wp_unslash($_GET['status'] ?? 'all'));
        $allowed_filters = ['all', 'positive', 'redeemable', 'debt'];
        if (!in_array($status_filter, $allowed_filters, true)) {
            $status_filter = 'all';
        }

        $paged = max(1, absint($_GET['paged'] ?? 1));
        $per_page = 35;
        $args = [
            'number' => $per_page,
            'paged' => $paged,
            'orderby' => 'registered',
            'order' => 'DESC',
            'count_total' => true,
            'role__in' => ['customer', 'subscriber'],
        ];

        if ($search) {
            $args['search'] = '*' . $search . '*';
            $args['search_columns'] = ['user_login', 'user_email', 'display_name'];
        }

        if ($status_filter !== 'all') {
            $comparison = '>';
            $value = 0;
            if ($status_filter === 'redeemable') {
                $comparison = '>=';
                $value = absint($settings['minimum_points']);
            } elseif ($status_filter === 'debt') {
                $comparison = '<';
                $value = 0;
            } else {
                $comparison = '>';
            }

            $args['meta_query'] = [[
                'key' => self::BALANCE_META,
                'value' => $value,
                'compare' => $comparison,
                'type' => 'NUMERIC',
            ]];
        }

        $query = new WP_User_Query($args);
        $users = $query->get_results();
        $total = (int) $query->get_total();
        $total_pages = max(1, (int) ceil($total / $per_page));
        ?>
        <div class="wrap rgvl-admin">
            <section class="rgvl-hero">
                <div>
                    <span class="rgvl-kicker"><?php esc_html_e('RGVPRIME · SECURE REWARDS', 'rgv-loyalty'); ?></span>
                    <h1><?php esc_html_e('Loyalty Command Center', 'rgv-loyalty'); ?></h1>
                    <p><?php esc_html_e('Control points, rewards, customer notifications and fraud safeguards from one polished workspace.', 'rgv-loyalty'); ?></p>
                </div>
                <div class="rgvl-hero-badges">
                    <span><i class="dashicons dashicons-shield-alt"></i><?php esc_html_e('Fraud protection active', 'rgv-loyalty'); ?></span>
                    <span><i class="dashicons dashicons-email-alt"></i><?php esc_html_e('Email notifications active', 'rgv-loyalty'); ?></span>
                    <span><i class="dashicons dashicons-database"></i><?php esc_html_e('HPOS compatible', 'rgv-loyalty'); ?></span>
                </div>
            </section>

            <?php if (!empty($_GET['updated'])): ?>
                <div class="notice notice-success is-dismissible"><p><?php esc_html_e('The loyalty account was updated and the customer notification was processed.', 'rgv-loyalty'); ?></p></div>
            <?php endif; ?>

            <?php if (!empty($_GET['settings-updated'])): ?>
                <div class="notice notice-success is-dismissible"><p><?php esc_html_e('Program settings saved.', 'rgv-loyalty'); ?></p></div>
            <?php endif; ?>

            <?php if (!empty($_GET['email_failed'])): ?>
                <div class="notice notice-warning is-dismissible"><p><?php esc_html_e('The points adjustment was saved, but WordPress could not send the customer email. Check WooCommerce logs and your SMTP provider.', 'rgv-loyalty'); ?></p></div>
            <?php endif; ?>

            <?php if (!empty($_GET['rgv_error'])): ?>
                <div class="notice notice-error"><p><?php echo esc_html(rawurldecode(wp_unslash($_GET['rgv_error']))); ?></p></div>
            <?php endif; ?>

            <section class="rgvl-stats">
                <article class="rgvl-stat">
                    <span class="dashicons dashicons-groups"></span>
                    <div><strong><?php echo esc_html(number_format_i18n($stats['tracked_accounts'])); ?></strong><small><?php esc_html_e('Tracked accounts', 'rgv-loyalty'); ?></small></div>
                </article>
                <article class="rgvl-stat">
                    <span class="dashicons dashicons-star-filled"></span>
                    <div><strong><?php echo esc_html(number_format_i18n($stats['points_in_circulation'])); ?></strong><small><?php esc_html_e('Points in circulation', 'rgv-loyalty'); ?></small></div>
                </article>
                <article class="rgvl-stat">
                    <span class="dashicons dashicons-awards"></span>
                    <div><strong><?php echo esc_html(number_format_i18n($stats['ready_accounts'])); ?></strong><small><?php esc_html_e('Customers reward-ready', 'rgv-loyalty'); ?></small></div>
                </article>
                <article class="rgvl-stat <?php echo $stats['debt_accounts'] ? 'is-alert' : ''; ?>">
                    <span class="dashicons dashicons-warning"></span>
                    <div><strong><?php echo esc_html(number_format_i18n($stats['debt_accounts'])); ?></strong><small><?php esc_html_e('Negative balances', 'rgv-loyalty'); ?></small></div>
                </article>
                <article class="rgvl-stat">
                    <span class="dashicons dashicons-tickets-alt"></span>
                    <div><strong><?php echo esc_html(number_format_i18n($stats['active_rewards'])); ?></strong><small><?php esc_html_e('Active reward codes', 'rgv-loyalty'); ?></small></div>
                </article>
            </section>

            <div class="rgvl-grid">
                <section class="rgvl-panel rgvl-settings-panel">
                    <div class="rgvl-panel-head">
                        <div><span><?php esc_html_e('Configuration', 'rgv-loyalty'); ?></span><h2><?php esc_html_e('Program controls', 'rgv-loyalty'); ?></h2></div>
                        <i class="dashicons dashicons-admin-generic"></i>
                    </div>

                    <form method="post" action="options.php" class="rgvl-settings-form">
                        <?php settings_fields('rgv_loyalty'); ?>

                        <fieldset>
                            <legend><?php esc_html_e('Reward economy', 'rgv-loyalty'); ?></legend>
                            <div class="rgvl-field-grid">
                                <label>
                                    <span><?php esc_html_e('Points per currency unit', 'rgv-loyalty'); ?></span>
                                    <input type="number" min="0.0001" max="1000" step="0.0001" name="<?php echo esc_attr(self::OPTION); ?>[points_per_dollar]" value="<?php echo esc_attr($settings['points_per_dollar']); ?>">
                                </label>
                                <label>
                                    <span><?php esc_html_e('Minimum points to unlock', 'rgv-loyalty'); ?></span>
                                    <input type="number" min="1" step="1" name="<?php echo esc_attr(self::OPTION); ?>[minimum_points]" value="<?php echo esc_attr($settings['minimum_points']); ?>">
                                </label>
                                <label>
                                    <span><?php esc_html_e('Points per reward', 'rgv-loyalty'); ?></span>
                                    <input type="number" min="1" step="1" name="<?php echo esc_attr(self::OPTION); ?>[points_per_reward]" value="<?php echo esc_attr($settings['points_per_reward']); ?>">
                                </label>
                                <label>
                                    <span><?php esc_html_e('Credit per reward', 'rgv-loyalty'); ?></span>
                                    <div class="rgvl-input-suffix"><input type="number" min="0.01" step="0.01" name="<?php echo esc_attr(self::OPTION); ?>[reward_value]" value="<?php echo esc_attr($settings['reward_value']); ?>"><b><?php echo esc_html(get_woocommerce_currency()); ?></b></div>
                                </label>
                            </div>
                        </fieldset>

                        <fieldset>
                            <legend><?php esc_html_e('Timing and validity', 'rgv-loyalty'); ?></legend>
                            <div class="rgvl-field-grid">
                                <label>
                                    <span><?php esc_html_e('Reward expiration', 'rgv-loyalty'); ?></span>
                                    <div class="rgvl-input-suffix"><input type="number" min="1" max="3650" step="1" name="<?php echo esc_attr(self::OPTION); ?>[coupon_expiry_days]" value="<?php echo esc_attr($settings['coupon_expiry_days']); ?>"><b><?php esc_html_e('days', 'rgv-loyalty'); ?></b></div>
                                </label>
                                <label class="rgvl-switch-card">
                                    <input type="checkbox" name="<?php echo esc_attr(self::OPTION); ?>[award_processing]" value="1" <?php checked($settings['award_processing']); ?>>
                                    <span class="rgvl-switch"></span>
                                    <span><strong><?php esc_html_e('Award at Processing', 'rgv-loyalty'); ?></strong><small><?php esc_html_e('Leave off to award only after Completed.', 'rgv-loyalty'); ?></small></span>
                                </label>
                            </div>
                        </fieldset>

                        <fieldset>
                            <legend><?php esc_html_e('Automatic customer emails', 'rgv-loyalty'); ?></legend>
                            <p class="rgvl-help"><?php esc_html_e('Every enabled event sends a branded, dark-mode-safe email after the database transaction is committed.', 'rgv-loyalty'); ?></p>
                            <div class="rgvl-switch-grid">
                                <?php
                                $email_toggles = [
                                    'email_earn' => [__('Points earned', 'rgv-loyalty'), __('Order points were added.', 'rgv-loyalty')],
                                    'email_adjustment' => [__('Manual adjustments', 'rgv-loyalty'), __('Points added or removed by your team.', 'rgv-loyalty')],
                                    'email_redeem' => [__('Reward created', 'rgv-loyalty'), __('Coupon code, value and expiration.', 'rgv-loyalty')],
                                    'email_restore' => [__('Reward restored', 'rgv-loyalty'), __('Points returned after cancellation or refund.', 'rgv-loyalty')],
                                    'email_reversal' => [__('Points reversed', 'rgv-loyalty'), __('Refund, cancellation or order reduction.', 'rgv-loyalty')],
                                ];
                                foreach ($email_toggles as $key => $copy):
                                ?>
                                    <label class="rgvl-switch-card">
                                        <input type="checkbox" name="<?php echo esc_attr(self::OPTION . '[' . $key . ']'); ?>" value="1" <?php checked($settings[$key]); ?>>
                                        <span class="rgvl-switch"></span>
                                        <span><strong><?php echo esc_html($copy[0]); ?></strong><small><?php echo esc_html($copy[1]); ?></small></span>
                                    </label>
                                <?php endforeach; ?>
                            </div>
                            <div class="rgvl-field-grid rgvl-email-fields">
                                <label>
                                    <span><?php esc_html_e('Email brand name', 'rgv-loyalty'); ?></span>
                                    <input type="text" maxlength="80" name="<?php echo esc_attr(self::OPTION); ?>[email_brand_name]" value="<?php echo esc_attr($settings['email_brand_name']); ?>">
                                </label>
                                <label>
                                    <span><?php esc_html_e('Rewards account URL', 'rgv-loyalty'); ?></span>
                                    <input type="url" name="<?php echo esc_attr(self::OPTION); ?>[email_account_url]" value="<?php echo esc_attr($settings['email_account_url']); ?>">
                                </label>
                            </div>
                        </fieldset>

                        <div class="rgvl-save-row">
                            <span><i class="dashicons dashicons-lock"></i><?php esc_html_e('Changes are sanitized and protected by WordPress nonces.', 'rgv-loyalty'); ?></span>
                            <?php submit_button(__('Save program settings', 'rgv-loyalty'), 'primary rgvl-primary', 'submit', false); ?>
                        </div>
                    </form>
                </section>

                <section class="rgvl-panel rgvl-customers-panel">
                    <div class="rgvl-panel-head rgvl-customer-head">
                        <div><span><?php esc_html_e('Accounts', 'rgv-loyalty'); ?></span><h2><?php esc_html_e('Customer rewards', 'rgv-loyalty'); ?></h2></div>
                        <strong><?php echo esc_html(number_format_i18n($total)); ?> <?php esc_html_e('results', 'rgv-loyalty'); ?></strong>
                    </div>

                    <form method="get" class="rgvl-toolbar">
                        <input type="hidden" name="page" value="rgv-loyalty">
                        <div class="rgvl-search"><i class="dashicons dashicons-search"></i><input type="search" name="s" value="<?php echo esc_attr($search); ?>" placeholder="<?php esc_attr_e('Search name or email…', 'rgv-loyalty'); ?>"></div>
                        <select name="status">
                            <option value="all" <?php selected($status_filter, 'all'); ?>><?php esc_html_e('All customers', 'rgv-loyalty'); ?></option>
                            <option value="positive" <?php selected($status_filter, 'positive'); ?>><?php esc_html_e('Has points', 'rgv-loyalty'); ?></option>
                            <option value="redeemable" <?php selected($status_filter, 'redeemable'); ?>><?php esc_html_e('Reward ready', 'rgv-loyalty'); ?></option>
                            <option value="debt" <?php selected($status_filter, 'debt'); ?>><?php esc_html_e('Negative balance', 'rgv-loyalty'); ?></option>
                        </select>
                        <button class="button rgvl-filter-button"><?php esc_html_e('Filter', 'rgv-loyalty'); ?></button>
                        <?php if ($search || $status_filter !== 'all'): ?><a class="button" href="<?php echo esc_url(add_query_arg(['page' => 'rgv-loyalty'], admin_url('admin.php'))); ?>"><?php esc_html_e('Clear', 'rgv-loyalty'); ?></a><?php endif; ?>
                    </form>

                    <div class="rgvl-table-wrap">
                        <table class="rgvl-table">
                            <thead><tr>
                                <th><?php esc_html_e('Customer', 'rgv-loyalty'); ?></th>
                                <th><?php esc_html_e('Status', 'rgv-loyalty'); ?></th>
                                <th><?php esc_html_e('Balance', 'rgv-loyalty'); ?></th>
                                <th><?php esc_html_e('Progress', 'rgv-loyalty'); ?></th>
                                <th><?php esc_html_e('Available credit', 'rgv-loyalty'); ?></th>
                                <th class="rgvl-action-col"><?php esc_html_e('Manage', 'rgv-loyalty'); ?></th>
                            </tr></thead>
                            <tbody>
                            <?php if (!$users): ?>
                                <tr><td colspan="6"><div class="rgvl-empty"><i class="dashicons dashicons-groups"></i><strong><?php esc_html_e('No customers found', 'rgv-loyalty'); ?></strong><span><?php esc_html_e('Try another search or status filter.', 'rgv-loyalty'); ?></span></div></td></tr>
                            <?php endif; ?>

                            <?php foreach ($users as $user):
                                $summary = $this->summary($user->ID);
                                $customer_status = $this->customer_status($summary);
                                $history = $summary['history'];
                                $latest = !empty($history[0]) ? $history[0] : null;
                            ?>
                                <tr>
                                    <td>
                                        <div class="rgvl-customer">
                                            <?php echo get_avatar($user->ID, 42, '', '', ['class' => 'rgvl-avatar']); ?>
                                            <div><strong><?php echo esc_html($user->display_name ?: $user->user_login); ?></strong><a href="mailto:<?php echo esc_attr($user->user_email); ?>"><?php echo esc_html($user->user_email); ?></a><?php if ($latest): ?><small><?php echo esc_html($latest['description']); ?></small><?php endif; ?></div>
                                        </div>
                                    </td>
                                    <td><span class="rgvl-status <?php echo esc_attr($customer_status['class']); ?>"><?php echo esc_html($customer_status['label']); ?></span></td>
                                    <td><strong class="rgvl-balance <?php echo $summary['points'] < 0 ? 'is-negative' : ''; ?>"><?php echo esc_html(number_format_i18n($summary['points'])); ?> <small>pts</small></strong></td>
                                    <td>
                                        <div class="rgvl-progress"><span style="width:<?php echo esc_attr((float) $summary['progress']); ?>%"></span></div>
                                        <small class="rgvl-progress-copy"><?php echo esc_html(number_format_i18n(max(0, $summary['points']))); ?> / <?php echo esc_html(number_format_i18n($summary['minimum_points'])); ?></small>
                                    </td>
                                    <td><strong class="rgvl-credit"><?php echo wp_kses_post(wc_price($summary['redeemable_credit'])); ?></strong></td>
                                    <td class="rgvl-action-col">
                                        <details class="rgvl-adjust">
                                            <summary><?php esc_html_e('Adjust', 'rgv-loyalty'); ?><i class="dashicons dashicons-arrow-down-alt2"></i></summary>
                                            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                                                <input type="hidden" name="action" value="rgv_loyalty_adjust">
                                                <input type="hidden" name="user_id" value="<?php echo esc_attr($user->ID); ?>">
                                                <input type="hidden" name="return_search" value="<?php echo esc_attr($search); ?>">
                                                <input type="hidden" name="return_status" value="<?php echo esc_attr($status_filter); ?>">
                                                <input type="hidden" name="return_page" value="<?php echo esc_attr($paged); ?>">
                                                <?php wp_nonce_field('rgv_loyalty_adjust'); ?>
                                                <label><span><?php esc_html_e('Point change', 'rgv-loyalty'); ?></span><input type="number" name="points" required placeholder="+500 or -250"></label>
                                                <label><span><?php esc_html_e('Customer-facing reason', 'rgv-loyalty'); ?></span><textarea name="note" required maxlength="180" rows="3" placeholder="<?php esc_attr_e('Example: Courtesy points for order support', 'rgv-loyalty'); ?>"></textarea></label>
                                                <p><i class="dashicons dashicons-email"></i><?php esc_html_e('The customer will receive an email with this reason and their new balance.', 'rgv-loyalty'); ?></p>
                                                <button class="button button-primary"><?php esc_html_e('Apply secure adjustment', 'rgv-loyalty'); ?></button>
                                            </form>
                                        </details>
                                    </td>
                                </tr>
                            <?php endforeach; ?>
                            </tbody>
                        </table>
                    </div>

                    <?php if ($total_pages > 1): ?>
                        <div class="rgvl-pagination">
                            <?php
                            echo wp_kses_post(paginate_links([
                                'base' => add_query_arg([
                                    'page' => 'rgv-loyalty',
                                    's' => $search,
                                    'status' => $status_filter,
                                    'paged' => '%#%',
                                ], admin_url('admin.php')),
                                'format' => '',
                                'current' => $paged,
                                'total' => $total_pages,
                                'prev_text' => '&lsaquo;',
                                'next_text' => '&rsaquo;',
                            ]));
                            ?>
                        </div>
                    <?php endif; ?>
                </section>
            </div>

            <section class="rgvl-security-note">
                <i class="dashicons dashicons-shield"></i>
                <div><strong><?php esc_html_e('Security behavior', 'rgv-loyalty'); ?></strong><p><?php esc_html_e('Refunds can create negative balances after a reward was used. Unused reward codes are revoked before debt is created, and simultaneous balance mutations remain serialized per customer.', 'rgv-loyalty'); ?></p></div>
            </section>
        </div>
        <?php
    }
}

register_activation_hook(__FILE__, ['RGV_Loyalty_Program', 'activate']);
add_action('plugins_loaded', ['RGV_Loyalty_Program', 'boot']);

add_action('before_woocommerce_init', function () {
    if (class_exists('Automattic\\WooCommerce\\Utilities\\FeaturesUtil')) {
        Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility(
            'custom_order_tables',
            __FILE__,
            true
        );
    }
});
