<?php
/**
 * Customer processing order email - RGVPRIME custom.
 */

defined('ABSPATH') || exit;

do_action('woocommerce_email_header', $email_heading, $email);
?>
<div class="rgv-email-card rgv-order-card">
    <?php do_action('woocommerce_email_order_details', $order, $sent_to_admin, $plain_text, $email); ?>
</div>

<div class="rgv-email-card rgv-customer-card">
    <?php
    do_action('woocommerce_email_order_meta', $order, $sent_to_admin, $plain_text, $email);
    do_action('woocommerce_email_customer_details', $order, $sent_to_admin, $plain_text, $email);
    ?>
</div>

<div class="rgv-email-notice">
    <strong>Research Use Only</strong>
    <p>All products are sold strictly for laboratory research use only.</p>
</div>

<?php
if ($additional_content) {
    echo wp_kses_post(wpautop(wptexturize($additional_content)));
}

do_action('woocommerce_email_footer', $email);
