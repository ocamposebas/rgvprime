<?php
/**
 * Customer new account email - RGVPRIME custom.
 */

defined('ABSPATH') || exit;

do_action('woocommerce_email_header', $email_heading, $email);
?>
<div class="rgv-email-card">
    <h2>Account Details</h2>
    <p>Username: <strong><?php echo esc_html($user_login); ?></strong></p>
    <?php if ('yes' === get_option('woocommerce_registration_generate_password') && $password_generated && $set_password_url) : ?>
        <p>Set your password to access your account and view your orders.</p>
        <p><a class="rgv-button" href="<?php echo esc_url($set_password_url); ?>">Set Password</a></p>
    <?php endif; ?>
</div>

<?php
if ($additional_content) {
    echo wp_kses_post(wpautop(wptexturize($additional_content)));
}

do_action('woocommerce_email_footer', $email);
