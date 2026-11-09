<?php
/**
 * Plugin Name: RGVPRIME Custom Woo Emails
 * Description: Unified WooCommerce transactional emails with the RGVPRIME storefront design and dark-mode protection.
 * Version: 2.0.0
 * Author: RGVPRIME LLC
 * Text Domain: rgvprime-custom-emails
 */

defined('ABSPATH') || exit;

define('RGVPRIME_EMAILS_VERSION', '2.0.0');
define('RGVPRIME_EMAILS_PATH', plugin_dir_path(__FILE__));
define('RGVPRIME_EMAILS_URL', plugin_dir_url(__FILE__));

define('RGVPRIME_EMAIL_FROM', 'sales@rgvprimellc.com');
define('RGVPRIME_EMAIL_FROM_NAME', 'RGVPRIME LLC');
define('RGVPRIME_EMAIL_LOGO', 'https://th9llsxpg16laoh4.public.blob.vercel-storage.com/orgs/acc_614e82d26faf/images/e38eb1cf-7878-4976-b4ea-2b86cab2cb0c');
define('RGVPRIME_TRACK_ORDER_URL', 'https://rgvprimellc.com/track-order');

add_action('woocommerce_email_header', function ($heading, $email = null) {
    $GLOBALS['rgvprime_email_context'] = is_object($email) ? $email : null;
}, 1, 2);

add_action('woocommerce_email_footer', function () {
    unset($GLOBALS['rgvprime_email_context']);
}, 9999);

add_filter('wp_mail_from', function ($from) {
    return RGVPRIME_EMAIL_FROM;
}, 9999);

add_filter('wp_mail_from_name', function ($name) {
    return RGVPRIME_EMAIL_FROM_NAME;
}, 9999);

add_filter('woocommerce_email_footer_text', function ($footer_text) {
    return 'RGVPRIME LLC — Research Use Only. Please do not include product-sensitive notes in payment descriptions.';
}, 9999);

add_filter('woocommerce_email_base_color', function () {
    return '#d92832';
}, 9999);

add_filter('woocommerce_email_background_color', function () {
    return '#eeefec';
}, 9999);

add_filter('woocommerce_email_body_background_color', function () {
    return '#ffffff';
}, 9999);

add_filter('woocommerce_email_text_color', function () {
    return '#18191b';
}, 9999);

/**
 * Keep RGVPRIME HTML email colors stable when a mail client changes theme.
 * The actual message still carries solid bgcolor attributes for older clients.
 */
add_filter('wp_mail', function ($args) {
    $message = isset($args['message']) ? (string) $args['message'] : '';

    if ($message === '' || stripos($message, '<html') === false || stripos($message, 'rgvprime') === false) {
        return $args;
    }

    $color_lock = '<meta name="color-scheme" content="light dark" />'
        . '<meta name="supported-color-schemes" content="light dark" />'
        . '<style>:root{color-scheme:light dark!important;supported-color-schemes:light dark!important}</style>';

    if (stripos($message, 'name="supported-color-schemes"') !== false) {
        $message = preg_replace('/<meta\s+name=["\'](?:color-scheme|supported-color-schemes)["\'][^>]*>/i', '', $message);
    }

    if (stripos($message, '<head') !== false) {
        $message = preg_replace('/(<head\b[^>]*>)/i', '$1' . $color_lock, $message, 1);
    } else {
        $message = preg_replace('/(<html\b[^>]*>)/i', '$1<head>' . $color_lock . '</head>', $message, 1);
    }

    $args['message'] = $message;
    return $args;
}, 9999);

add_filter('woocommerce_locate_template', function ($template, $template_name, $template_path) {
    if (strpos($template_name, 'emails/') !== 0) {
        return $template;
    }

    $custom_template = RGVPRIME_EMAILS_PATH . 'templates/' . $template_name;

    if (file_exists($custom_template)) {
        return $custom_template;
    }

    return $template;
}, 20, 3);

add_filter('woocommerce_email_styles', function ($css, $email = null) {
    $style_file = RGVPRIME_EMAILS_PATH . 'templates/emails/email-styles.php';

    if (!file_exists($style_file)) {
        return $css;
    }

    ob_start();
    include $style_file;
    $rgv_css = ob_get_clean();

    return $css . "\n" . $rgv_css;
}, 9999, 2);

/**
 * Tracking notice for customer order emails.
 *
 * Adds ONLY:
 * - A reminder to check Spam/Junk for tracking notifications.
 * - A branded "Track My Order" button.
 *
 * It is injected into the existing WooCommerce email and does not trigger
 * an additional email.
 */
function rgvprime_email_tracking_notice($order, $sent_to_admin, $plain_text, $email) {
    if ($sent_to_admin || !$order instanceof WC_Order || !is_object($email)) {
        return;
    }

    $email_id = isset($email->id) ? (string) $email->id : '';

    // Only customer-facing order emails where tracking information is relevant.
    $allowed_email_ids = array(
        'customer_on_hold_order',
        'customer_processing_order',
        'customer_completed_order',
    );

    if (!in_array($email_id, $allowed_email_ids, true)) {
        return;
    }

    // Prevent accidental duplicate rendering if a customized template fires
    // the WooCommerce hook more than once in the same request.
    static $rendered = array();
    $render_key = $order->get_id() . ':' . $email_id . ':' . ($plain_text ? 'plain' : 'html');

    if (isset($rendered[$render_key])) {
        return;
    }

    $rendered[$render_key] = true;
    $track_url = esc_url(RGVPRIME_TRACK_ORDER_URL);

    if ($plain_text) {
        echo "\nTRACK YOUR ORDER\n";
        echo "Tracking notifications can occasionally be filtered by your email provider. Please check your Spam or Junk folder.\n";
        echo "Track My Order: " . esc_url_raw(RGVPRIME_TRACK_ORDER_URL) . "\n\n";
        return;
    }
    ?>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; border-collapse:separate; border-spacing:0; margin:20px 0 4px 0;">
        <tr>
            <td style="padding:0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#17171a" class="rgv-tracking-card" style="width:100%; background-color:#17171a; border:1px solid #303035; border-radius:14px; border-collapse:separate; overflow:hidden;">
                    <tr>
                        <td style="padding:22px 24px;">
                            <p class="rgv-tracking-kicker" style="margin:0 0 8px 0; color:#ff5961 !important; font-family:Arial,Helvetica,sans-serif; font-size:10px; line-height:1.3; font-weight:800; letter-spacing:1.7px; text-transform:uppercase;">
                                Tracking Notice
                            </p>

                            <h2 class="rgv-tracking-title" style="margin:0 0 9px 0; color:#ffffff !important; font-family:Arial,Helvetica,sans-serif; font-size:20px; line-height:1.25; font-weight:800; letter-spacing:-0.02em;">
                                Track your order
                            </h2>

                            <p class="rgv-tracking-copy" style="margin:0 0 17px 0; color:#b8b8c0 !important; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.6; font-weight:400;">
                                Tracking notifications can occasionally be filtered by your email provider. Please check your <strong class="rgv-tracking-strong" style="color:#ffffff !important; font-weight:800;">Spam or Junk folder</strong>.
                            </p>

                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;">
                                <tr>
                                    <td bgcolor="#c9212c" style="background-color:#c9212c; border-radius:9px;">
                                        <a href="<?php echo esc_url($track_url); ?>" target="_blank" style="display:inline-block; padding:13px 19px; color:#ffffff !important; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:1; font-weight:800; text-decoration:none !important; border-radius:9px;">
                                            Track My Order &rarr;
                                        </a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    <?php
}
add_action('woocommerce_email_after_order_table', 'rgvprime_email_tracking_notice', 25, 4);

add_action('admin_notices', function () {
    if (!current_user_can('activate_plugins')) {
        return;
    }

    if (!class_exists('WooCommerce')) {
        echo '<div class="notice notice-warning"><p><strong>RGVPRIME Custom Woo Emails:</strong> WooCommerce must be active for these email templates to work.</p></div>';
    }
});
