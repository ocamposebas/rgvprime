<?php
/**
 * RGVPRIME hero-driven WooCommerce email header.
 */

defined('ABSPATH') || exit;

$email_heading = isset($email_heading) ? $email_heading : '';
$email_context = isset($GLOBALS['rgvprime_email_context']) && is_object($GLOBALS['rgvprime_email_context'])
    ? $GLOBALS['rgvprime_email_context']
    : null;
$email_id = $email_context && isset($email_context->id) ? (string) $email_context->id : '';
$email_order = $email_context && isset($email_context->object) && $email_context->object instanceof WC_Order
    ? $email_context->object
    : null;

$hero = array(
    'eyebrow' => 'RGVPRIME UPDATE',
    'title' => $email_heading ?: 'An update from RGVPRIME',
    'accent' => 'in detail.',
    'description' => 'A clear summary of the latest activity on your RGVPRIME account.',
    'action_label' => '',
    'action_url' => '',
);

$heroes = array(
    'customer_processing_order' => array('ORDER RECEIVED', 'Your order,', 'in detail.', 'We received your order and our team is preparing it for fulfillment.', 'Track my order', RGVPRIME_TRACK_ORDER_URL),
    'customer_on_hold_order' => array('PAYMENT REVIEW', 'Your order,', 'is securely on hold.', 'Your order is reserved while payment confirmation or manual review is completed.', 'View my order', 'https://rgvprimellc.com/account'),
    'customer_completed_order' => array('ORDER COMPLETED', 'Your order,', 'is on its way.', 'Your order has been fulfilled. Keep this email for your records and tracking updates.', 'Track my order', RGVPRIME_TRACK_ORDER_URL),
    'customer_refunded_order' => array('REFUND UPDATE', 'Your refund,', 'in detail.', 'The latest refund information for your order is included below.', 'View my account', 'https://rgvprimellc.com/account'),
    'customer_failed_order' => array('PAYMENT UPDATE', 'Let’s get your', 'order back on track.', 'The payment was not completed. Review the information below before trying again.', 'View my order', 'https://rgvprimellc.com/account'),
    'customer_invoice' => array('PAYMENT REQUIRED', 'Your order,', 'is ready for payment.', 'Review the order details and use the secure payment option below when required.', '', ''),
    'customer_note' => array('ORDER UPDATE', 'A new note,', 'for your order.', 'There is a new message regarding your RGVPRIME order.', 'View my account', 'https://rgvprimellc.com/account'),
    'customer_new_account' => array('ACCOUNT CREATED', 'Your account,', 'is ready.', 'Welcome to your private RGVPRIME customer portal.', 'Open customer portal', 'https://rgvprimellc.com/account'),
    'customer_reset_password' => array('SECURE ACCOUNT ACCESS', 'Reset your', 'account password.', 'Use the secure link in this email to choose a new password.', '', ''),
    'new_order' => array('NEW ORDER', 'A new order,', 'in detail.', 'A new RGVPRIME order is ready for review in WooCommerce.', '', ''),
    'failed_order' => array('PAYMENT FAILED', 'An order needs', 'your attention.', 'A payment attempt failed. Review the order details below.', '', ''),
    'cancelled_order' => array('ORDER CANCELLED', 'An order was', 'cancelled.', 'The cancelled order and its recorded details are included below.', '', ''),
);

if (isset($heroes[$email_id])) {
    $selected = $heroes[$email_id];
    $hero = array(
        'eyebrow' => $selected[0],
        'title' => $selected[1],
        'accent' => $selected[2],
        'description' => $selected[3],
        'action_label' => $selected[4],
        'action_url' => $selected[5],
    );
}

$order_label = 'RGVPRIME / UPDATE';
$order_date = wp_date('M d, Y');
if ($email_order) {
    $order_label = 'ORDER / ' . $email_order->get_order_number();
    $created = $email_order->get_date_created();
    if ($created) {
        $order_date = wc_format_datetime($created, 'M d, Y');
    }
}

$steps = array();
if ('customer_processing_order' === $email_id) {
    $steps = array(array('01', 'Received', 'Complete'), array('02', 'Processing', 'In progress'), array('03', 'Shipping', 'Next update'));
} elseif ('customer_on_hold_order' === $email_id) {
    $steps = array(array('01', 'Received', 'Complete'), array('02', 'Payment review', 'In progress'), array('03', 'Processing', 'Next step'));
} elseif ('customer_completed_order' === $email_id) {
    $steps = array(array('01', 'Received', 'Complete'), array('02', 'Processing', 'Complete'), array('03', 'Shipping', 'Current stage'));
}
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=<?php bloginfo('charset'); ?>" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title><?php echo esc_html($email_heading); ?></title>
</head>
<body class="rgv-email-page" bgcolor="#eeefec" style="margin:0;padding:0;background:#eeefec;color:#18191b;" <?php echo is_rtl() ? 'rightmargin="0" leftmargin="0"' : 'leftmargin="0" rightmargin="0"'; ?> marginwidth="0" topmargin="0" marginheight="0" offset="0">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#eeefec" class="rgv-email-page" style="width:100%;margin:0;padding:0;background:#eeefec;">
        <tr><td align="center" style="padding:30px 12px;">
            <div id="wrapper" style="width:100%;max-width:640px;margin:0 auto;">
                <table class="rgv-email-shell" border="0" cellpadding="0" cellspacing="0" width="640" id="template_container" align="center" bgcolor="#ffffff" style="margin:0 auto;width:100%;max-width:640px;background:#ffffff;">
                    <tr>
                        <td align="center" valign="top">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" id="template_header" bgcolor="#090a0c">
                                <tr>
                                    <td id="header_wrapper" bgcolor="#090a0c">
                                        <div class="rgv-accent-line">&nbsp;</div>
                                        <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" class="rgv-hero-top">
                                            <tr>
                                                <td align="left" valign="middle"><img class="rgv-logo" src="<?php echo esc_url(RGVPRIME_EMAIL_LOGO); ?>" width="142" alt="RGVPRIME LLC" /></td>
                                                <td align="right" valign="middle" class="rgv-order-index"><?php echo esc_html($order_label); ?><br><?php echo esc_html(strtoupper($order_date)); ?></td>
                                            </tr>
                                        </table>
                                        <div class="rgv-hero-copy">
                                            <p class="rgv-header-kicker"><span>&nbsp;</span><?php echo esc_html($hero['eyebrow']); ?></p>
                                            <h1><?php echo esc_html($hero['title']); ?><em><?php echo esc_html($hero['accent']); ?></em></h1>
                                            <p class="rgv-hero-description"><?php echo esc_html($hero['description']); ?></p>
                                            <?php if ($hero['action_label'] && $hero['action_url']) : ?>
                                                <a class="rgv-hero-action" href="<?php echo esc_url($hero['action_url']); ?>"><?php echo esc_html($hero['action_label']); ?> <b>&#8599;</b></a>
                                            <?php endif; ?>
                                        </div>
                                        <div class="rgv-hero-ribbon" aria-hidden="true"><i>&nbsp;</i></div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <?php if ($steps) : ?>
                    <tr>
                        <td class="rgv-progress-wrap" bgcolor="#ffffff">
                            <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" class="rgv-email-progress">
                                <tr>
                                    <?php foreach ($steps as $index => $step) : ?>
                                        <td width="33.33%" valign="top" class="rgv-progress-step<?php echo $index > 0 ? ' has-border' : ''; ?>">
                                            <span><?php echo esc_html($step[0]); ?></span>
                                            <strong><?php echo esc_html($step[1]); ?></strong>
                                            <small><?php echo esc_html($step[2]); ?></small>
                                        </td>
                                    <?php endforeach; ?>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <?php endif; ?>
                    <tr>
                        <td align="center" valign="top">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" id="template_body" bgcolor="#ffffff">
                                <tr>
                                    <td valign="top" id="body_content">
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr>
                                                <td valign="top">
                                                    <div id="body_content_inner">
