<?php
/**
 * Customer reset password email - RGVPRIME custom.
 */

defined('ABSPATH') || exit;

$reset_url = '';
$user_id = isset($user_data->ID) ? absint($user_data->ID) : 0;

if (!empty($reset_key) && !empty($user_login)) {
    $reset_url = add_query_arg(
        array(
            'key' => $reset_key,
            'id' => $user_id,
            'login' => rawurlencode($user_login),
        ),
        wc_get_endpoint_url('lost-password', '', wc_get_page_permalink('myaccount'))
    );
}

do_action('woocommerce_email_header', $email_heading, $email);
?>
<div class="rgv-email-card">
    <h2>Password Reset Request</h2>
    <p>Username: <strong><?php echo esc_html($user_login); ?></strong></p>
    <?php if ($reset_url) : ?>
        <p><a class="rgv-button" href="<?php echo esc_url($reset_url); ?>">Reset Password</a></p>
    <?php endif; ?>
    <p>If you did not request this, you can safely ignore this email.</p>
</div>

<?php
if ($additional_content) {
    echo wp_kses_post(wpautop(wptexturize($additional_content)));
}

do_action('woocommerce_email_footer', $email);
