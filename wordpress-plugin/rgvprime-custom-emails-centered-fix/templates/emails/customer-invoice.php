<?php
/**
 * Customer invoice email - RGVPRIME custom.
 */

defined('ABSPATH') || exit;

do_action('woocommerce_email_header', $email_heading, $email);

$payment_url = '';
if (isset($order) && $order instanceof WC_Order) {
    $payment_url = $order->get_checkout_payment_url();
}
?>
<?php if ($payment_url && $order->needs_payment()) : ?>
    <p><a class="rgv-button" href="<?php echo esc_url($payment_url); ?>">Pay Securely</a></p>
<?php endif; ?>

<div class="rgv-email-card rgv-order-card">
    <?php do_action('woocommerce_email_order_details', $order, $sent_to_admin, $plain_text, $email); ?>
</div>

<div class="rgv-email-card rgv-customer-card">
    <?php
    do_action('woocommerce_email_order_meta', $order, $sent_to_admin, $plain_text, $email);
    do_action('woocommerce_email_customer_details', $order, $sent_to_admin, $plain_text, $email);
    ?>
</div>

<?php
if ($additional_content) {
    echo wp_kses_post(wpautop(wptexturize($additional_content)));
}

do_action('woocommerce_email_footer', $email);
