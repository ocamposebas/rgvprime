<?php
/**
 * Plugin Name: RGV Customer Portal API
 * Description: Secure customer portal endpoints for Astro + WooCommerce.
 * Version: 1.1.0
 * Author: RGVPRIME RESEARCH LLC
 */

if (!defined('ABSPATH')) {
  exit;
}

define('RGVP_NAMESPACE', 'rgv-portal/v1');
define('RGVP_SESSION_META', '_rgvp_sessions');
define('RGVP_SESSION_DAYS', 7);

add_action('rest_api_init', function () {
  register_rest_route(RGVP_NAMESPACE, '/register', [
    'methods' => 'POST',
    'callback' => 'rgvp_register',
    'permission_callback' => 'rgvp_secret_permission',
  ]);

  register_rest_route(RGVP_NAMESPACE, '/login', [
    'methods' => 'POST',
    'callback' => 'rgvp_login',
    'permission_callback' => 'rgvp_secret_permission',
  ]);

  register_rest_route(RGVP_NAMESPACE, '/me', [
    'methods' => 'GET',
    'callback' => 'rgvp_me',
    'permission_callback' => 'rgvp_secret_permission',
  ]);

  register_rest_route(RGVP_NAMESPACE, '/logout', [
    'methods' => 'POST',
    'callback' => 'rgvp_logout',
    'permission_callback' => 'rgvp_secret_permission',
  ]);

  register_rest_route(RGVP_NAMESPACE, '/forgot-password', [
    'methods' => 'POST',
    'callback' => 'rgvp_forgot_password',
    'permission_callback' => 'rgvp_secret_permission',
  ]);

  register_rest_route(RGVP_NAMESPACE, '/reset-password', [
    'methods' => 'POST',
    'callback' => 'rgvp_reset_password',
    'permission_callback' => 'rgvp_secret_permission',
  ]);

  register_rest_route(RGVP_NAMESPACE, '/update-profile', [
    'methods' => 'POST',
    'callback' => 'rgvp_update_profile',
    'permission_callback' => 'rgvp_secret_permission',
  ]);
});

function rgvp_get_portal_secret() {
  if (defined('RGV_PORTAL_SECRET') && RGV_PORTAL_SECRET) {
    return trim((string) RGV_PORTAL_SECRET);
  }

  $env_secret = getenv('PORTAL_API_SECRET');

  if ($env_secret) {
    return trim((string) $env_secret);
  }

  if (!empty($_ENV['PORTAL_API_SECRET'])) {
    return trim((string) $_ENV['PORTAL_API_SECRET']);
  }

  if (!empty($_SERVER['PORTAL_API_SECRET'])) {
    return trim((string) $_SERVER['PORTAL_API_SECRET']);
  }

  return '';
}

function rgvp_secret_permission(WP_REST_Request $request) {
  $secret = rgvp_get_portal_secret();

  if (!$secret) {
    return new WP_Error(
      'portal_secret_missing',
      'Portal secret is not configured.',
      ['status' => 500]
    );
  }

  $incoming = $request->get_header('x-rgv-portal-secret');

  if (!$incoming || !hash_equals($secret, trim((string) $incoming))) {
    return new WP_Error(
      'portal_forbidden',
      'Forbidden.',
      ['status' => 403]
    );
  }

  return true;
}

function rgvp_response($data, $status = 200) {
  return new WP_REST_Response($data, $status);
}

function rgvp_error($message, $status = 400, $code = 'portal_error') {
  return new WP_Error($code, $message, ['status' => $status]);
}

function rgvp_clean_email($value) {
  return sanitize_email(strtolower(trim((string) $value)));
}

function rgvp_password_valid($password) {
  if (!is_string($password)) {
    return false;
  }

  return strlen($password) >= 10;
}

function rgvp_find_user_by_login_or_email($login) {
  $login = trim((string) $login);

  if (!$login) {
    return null;
  }

  if (is_email($login)) {
    return get_user_by('email', rgvp_clean_email($login));
  }

  return get_user_by('login', sanitize_user($login));
}

function rgvp_rate_key($prefix, $value) {
  $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
  return $prefix . '_' . md5(strtolower(trim((string) $value)) . '|' . $ip);
}

function rgvp_too_many_attempts($key, $limit = 8) {
  $count = (int) get_transient($key);
  return $count >= $limit;
}

function rgvp_increment_attempts($key) {
  $count = (int) get_transient($key);
  set_transient($key, $count + 1, 15 * MINUTE_IN_SECONDS);
}

function rgvp_clear_attempts($key) {
  delete_transient($key);
}

function rgvp_create_username($email) {
  $base = sanitize_user(current(explode('@', $email)), true);

  if (!$base) {
    $base = 'customer';
  }

  $username = $base;
  $index = 1;

  while (username_exists($username)) {
    $username = $base . $index;
    $index++;
  }

  return $username;
}

function rgvp_session_hash($token) {
  return hash_hmac('sha256', $token, wp_salt('auth'));
}

function rgvp_get_sessions($user_id) {
  $sessions = get_user_meta($user_id, RGVP_SESSION_META, true);

  if (!is_array($sessions)) {
    return [];
  }

  $now = time();

  foreach ($sessions as $id => $session) {
    if (empty($session['expires']) || (int) $session['expires'] < $now) {
      unset($sessions[$id]);
    }
  }

  update_user_meta($user_id, RGVP_SESSION_META, $sessions);

  return $sessions;
}

function rgvp_create_session($user_id) {
  $session_id = bin2hex(random_bytes(16));
  $token = bin2hex(random_bytes(32));
  $expires = time() + (RGVP_SESSION_DAYS * DAY_IN_SECONDS);

  $sessions = rgvp_get_sessions($user_id);

  $sessions[$session_id] = [
    'hash' => rgvp_session_hash($token),
    'created' => time(),
    'expires' => $expires,
    'ip' => $_SERVER['REMOTE_ADDR'] ?? '',
    'agent' => substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 220),
  ];

  update_user_meta($user_id, RGVP_SESSION_META, $sessions);

  return [
    'token' => $user_id . ':' . $session_id . ':' . $token,
    'expires' => $expires,
  ];
}

function rgvp_auth_user_from_request(WP_REST_Request $request) {
  $header = $request->get_header('authorization');

  if (!$header || stripos($header, 'Bearer ') !== 0) {
    return null;
  }

  $raw = trim(substr($header, 7));
  $parts = explode(':', $raw);

  if (count($parts) !== 3) {
    return null;
  }

  [$user_id, $session_id, $token] = $parts;

  $user_id = absint($user_id);

  if (!$user_id || !$session_id || !$token) {
    return null;
  }

  $sessions = rgvp_get_sessions($user_id);

  if (empty($sessions[$session_id])) {
    return null;
  }

  $session = $sessions[$session_id];

  if (!hash_equals($session['hash'], rgvp_session_hash($token))) {
    return null;
  }

  $user = get_user_by('id', $user_id);

  if (!$user) {
    return null;
  }

  return [
    'user' => $user,
    'session_id' => $session_id,
  ];
}

function rgvp_destroy_session($user_id, $session_id) {
  $sessions = rgvp_get_sessions($user_id);

  if (isset($sessions[$session_id])) {
    unset($sessions[$session_id]);
    update_user_meta($user_id, RGVP_SESSION_META, $sessions);
  }
}

function rgvp_user_payload($user) {
  return [
    'id' => $user->ID,
    'email' => $user->user_email,
    'display_name' => $user->display_name,
    'first_name' => get_user_meta($user->ID, 'first_name', true),
    'last_name' => get_user_meta($user->ID, 'last_name', true),
    'billing_phone' => get_user_meta($user->ID, 'billing_phone', true),
    'billing_address_1' => get_user_meta($user->ID, 'billing_address_1', true),
    'billing_address_2' => get_user_meta($user->ID, 'billing_address_2', true),
    'billing_city' => get_user_meta($user->ID, 'billing_city', true),
    'billing_state' => get_user_meta($user->ID, 'billing_state', true),
    'billing_postcode' => get_user_meta($user->ID, 'billing_postcode', true),
    'billing_country' => get_user_meta($user->ID, 'billing_country', true),
  ];
}

function rgvp_order_payload($order) {
  $items = [];

  foreach ($order->get_items() as $item) {
    $items[] = [
      'name' => $item->get_name(),
      'quantity' => $item->get_quantity(),
      'total' => $item->get_total(),
    ];
  }

  return [
    'id' => $order->get_id(),
    'number' => $order->get_order_number(),
    'status' => $order->get_status(),
    'total' => $order->get_total(),
    'currency' => $order->get_currency(),
    'date' => $order->get_date_created() ? $order->get_date_created()->date('Y-m-d H:i:s') : null,
    'payment_method' => $order->get_payment_method_title(),
    'items' => $items,
  ];
}

function rgvp_get_orders_for_user($user_id) {
  if (!function_exists('wc_get_orders')) {
    return [];
  }

  $orders = wc_get_orders([
    'customer_id' => $user_id,
    'limit' => 12,
    'orderby' => 'date',
    'order' => 'DESC',
    'status' => ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'],
  ]);

  return array_map('rgvp_order_payload', $orders);
}

function rgvp_public_site_url() {
  $site_url = getenv('PUBLIC_SITE_URL');

  if (!$site_url) {
    $site_url = 'https://rgvprimellc.com';
  }

  return untrailingslashit(esc_url_raw((string) $site_url));
}

function rgvp_email_document($preheader, $eyebrow, $title, $accent, $description, $body_html, $cta_label, $cta_url, $footer_note) {
  $logo = 'https://th9llsxpg16laoh4.public.blob.vercel-storage.com/orgs/acc_614e82d26faf/images/e38eb1cf-7878-4976-b4ea-2b86cab2cb0c';
  $today = wp_date('M d, Y');

  return '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    . '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>' . esc_html($preheader) . '</title>'
    . '<style>:root{color-scheme:light dark!important;supported-color-schemes:light dark!important}body{margin:0!important;padding:0!important;background:#eeefec;color:#18191b;font-family:Arial,Helvetica,sans-serif}.rgvp-hide{display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all}.rgvp-card{background:#fff;color:#18191b}.rgvp-panel{background:#f6f6f4;border-color:#dfdfdc;color:#18191b}.rgvp-footer{background:#efefec;border-color:#dbdbd8;color:#6c6d72}@media(prefers-color-scheme:dark){body,.rgvp-page{background:#090a0c!important;background-image:linear-gradient(#090a0c,#090a0c)!important;color:#efefed!important}.rgvp-card{background:#101114!important;background-image:linear-gradient(#101114,#101114)!important;color:#efefed!important;border-color:#2a2b2f!important}.rgvp-panel{background:#17181b!important;background-image:linear-gradient(#17181b,#17181b)!important;border-color:#303136!important;color:#efefed!important}.rgvp-copy{color:#b6b7bc!important}.rgvp-footer{background:#0b0c0e!important;background-image:linear-gradient(#0b0c0e,#0b0c0e)!important;border-color:#27282c!important;color:#777980!important}}@media(max-width:600px){.rgvp-outer{padding:18px 8px!important}.rgvp-hero,.rgvp-content{padding-left:21px!important;padding-right:21px!important}.rgvp-title{font-size:36px!important}.rgvp-ribbon{display:none!important}}</style></head>'
    . '<body bgcolor="#eeefec"><div class="rgvp-hide">' . esc_html($preheader) . '</div>'
    . '<table role="presentation" class="rgvp-page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eeefec" style="width:100%;background:#eeefec"><tr><td class="rgvp-outer" align="center" style="padding:30px 12px">'
    . '<table role="presentation" class="rgvp-card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:640px;background:#fff;border:1px solid #d5d5d1;border-radius:18px;overflow:hidden">'
    . '<tr><td style="height:4px;background:#a93239;font-size:0;line-height:0">&nbsp;</td></tr>'
    . '<tr><td class="rgvp-hero" bgcolor="#090a0c" style="padding:24px 38px 36px;background:#090a0c;background-image:linear-gradient(110deg,#090a0c 0%,#090a0c 68%,#5d151b 100%);color:#f6f5f2">'
    . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><img src="' . esc_url($logo) . '" width="142" alt="RGVPRIME LLC" style="display:block;width:142px;max-width:100%;height:auto;border:0"></td><td align="right" style="color:#a6a7ad;font-family:monospace;font-size:9px;font-weight:700;letter-spacing:1.4px;line-height:1.5">ACCOUNT / SECURE<br>' . esc_html(strtoupper($today)) . '</td></tr></table>'
    . '<div style="padding-top:40px"><p style="margin:0 0 13px;color:#d05b62;font-size:9px;font-weight:800;letter-spacing:2px;text-transform:uppercase">— &nbsp;' . esc_html($eyebrow) . '</p>'
    . '<h1 class="rgvp-title" style="margin:0;color:#f6f5f2;font-size:44px;line-height:.99;letter-spacing:-2px;font-weight:800">' . esc_html($title) . '<span style="display:block;margin-top:3px;color:#c43b43">' . esc_html($accent) . '</span></h1>'
    . '<p style="max-width:425px;margin:19px 0 0;padding-left:14px;border-left:2px solid #70312d;color:#afb0b5;font-size:12px;line-height:1.75">' . esc_html($description) . '</p></div></td></tr>'
    . '<tr><td class="rgvp-content rgvp-card" bgcolor="#ffffff" style="padding:26px 32px 30px;background:#fff;color:#18191b">'
    . '<table role="presentation" class="rgvp-panel" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f6f6f4" style="width:100%;background:#f6f6f4;border:1px solid #dfdfdc;border-radius:13px"><tr><td align="center" style="padding:24px">'
    . '<div class="rgvp-copy" style="color:#66676c;font-size:13px;line-height:1.65">' . wp_kses_post($body_html) . '</div>'
    . '<a href="' . esc_url($cta_url) . '" style="display:inline-block;margin-top:20px;padding:14px 20px;border:1px solid #a23a40;border-radius:10px;background:#851e25;color:#fff;text-decoration:none;font-size:11px;font-weight:800">' . esc_html($cta_label) . ' &nbsp;↗</a>'
    . '</td></tr></table></td></tr>'
    . '<tr><td class="rgvp-footer" align="center" bgcolor="#efefec" style="padding:20px 28px;background:#efefec;border-top:1px solid #dbdbd8;color:#6c6d72;font-size:9px;line-height:1.6"><strong style="color:inherit;letter-spacing:1px">RGVPRIME LLC</strong><br>' . esc_html($footer_note) . '</td></tr>'
    . '</table></td></tr></table></body></html>';
}

function rgvp_send_welcome_email($user_id) {
  $user = get_user_by('id', $user_id);

  if (!$user) {
    return false;
  }

  $brand = 'RGVPRIME RESEARCH LLC';
  $site_url = rgvp_public_site_url();
  $account_url = esc_url(trailingslashit($site_url) . 'account');

  $first_name = trim((string) get_user_meta($user_id, 'first_name', true));
  $name = $first_name ?: 'there';

  $subject = 'Welcome to your RGVPRIME customer portal';

  $message = <<<HTML
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#050000;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050000;margin:0;padding:0;">
      <tr>
        <td align="center" style="padding:34px 14px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#090909;border:1px solid rgba(255,255,255,0.10);border-radius:28px;overflow:hidden;">
            <tr>
              <td style="background:linear-gradient(135deg,#160000 0%,#090909 45%,#2a0303 100%);">
                <div style="height:4px;background:linear-gradient(90deg,transparent,#dc2626,transparent);"></div>

                <div style="padding:34px 28px 24px;text-align:center;">
                  <div style="display:inline-block;padding:10px 14px;border:1px solid rgba(248,113,113,0.35);border-radius:999px;background:rgba(220,38,38,0.10);color:#fecaca;font-size:11px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;">
                    Account created
                  </div>

                  <h1 style="margin:22px 0 0;color:#ffffff;font-size:34px;line-height:1.04;letter-spacing:-1.3px;font-weight:900;">
                    Welcome to RGVPRIME
                  </h1>

                  <p style="margin:16px auto 0;max-width:470px;color:rgba(255,255,255,0.62);font-size:15px;line-height:1.7;">
                    Hi {$name}, your customer portal account has been created successfully. You can now access your private account space, manage your profile, and view your order history.
                  </p>
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:rgba(255,255,255,0.035);border:1px solid rgba(255,255,255,0.08);border-radius:22px;">
                  <tr>
                    <td style="padding:24px;text-align:center;">
                      <p style="margin:0 0 20px;color:rgba(255,255,255,0.54);font-size:14px;line-height:1.6;">
                        Your account is ready. You can sign in anytime using the email and password you created.
                      </p>

                      <a href="{$account_url}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;border-radius:16px;padding:16px 24px;font-size:12px;font-weight:900;letter-spacing:0.14em;text-transform:uppercase;box-shadow:0 18px 42px rgba(220,38,38,0.28);">
                        Open customer portal
                      </a>
                    </td>
                  </tr>
                </table>

                <div style="margin-top:28px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;">
                  <p style="margin:0;color:#ffffff;font-size:13px;font-weight:900;letter-spacing:0.12em;text-transform:uppercase;">
                    {$brand}
                  </p>

                  <p style="margin:8px 0 0;color:rgba(255,255,255,0.35);font-size:12px;">
                    Customer portal notification
                  </p>
                </div>
              </td>
            </tr>
          </table>

          <p style="margin:18px 0 0;color:rgba(255,255,255,0.28);font-size:11px;">
            This is an automated account email from {$brand}.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>
HTML;

  $message = rgvp_email_document(
    $subject,
    'ACCOUNT CREATED',
    'Your account,',
    'is ready.',
    'Welcome to your private RGVPRIME customer portal.',
    '<p style="margin:0">Hi ' . esc_html($name) . ', your account has been created successfully. You can manage your profile and view your order history at any time.</p>',
    'Open customer portal',
    $account_url,
    'Customer portal notification'
  );

  $headers = [
    'Content-Type: text/html; charset=UTF-8',
    'From: RGVPRIME RESEARCH LLC <support@rgvprimellc.com>',
  ];

  return wp_mail($user->user_email, $subject, $message, $headers);
}



function rgvp_register(WP_REST_Request $request) {
  $email = rgvp_clean_email($request->get_param('email'));
  $password = (string) $request->get_param('password');
  $first_name = sanitize_text_field((string) $request->get_param('first_name'));
  $last_name = sanitize_text_field((string) $request->get_param('last_name'));

  if (!is_email($email)) {
    return rgvp_error('Enter a valid email address.', 422);
  }

  if (!rgvp_password_valid($password)) {
    return rgvp_error('Password must be at least 10 characters.', 422);
  }

  if (email_exists($email)) {
    return rgvp_error('An account already exists with this email.', 409);
  }

  $username = rgvp_create_username($email);
  $user_id = wp_create_user($username, $password, $email);

  if (is_wp_error($user_id)) {
    return rgvp_error($user_id->get_error_message(), 400);
  }

  $user = new WP_User($user_id);
  $user->set_role('customer');

  wp_update_user([
    'ID' => $user_id,
    'first_name' => $first_name,
    'last_name' => $last_name,
    'display_name' => trim($first_name . ' ' . $last_name) ?: $email,
  ]);

  update_user_meta($user_id, 'billing_email', $email);
  update_user_meta($user_id, 'billing_first_name', $first_name);
  update_user_meta($user_id, 'billing_last_name', $last_name);

  if (function_exists('wp_new_user_notification')) {
    rgvp_send_welcome_email($user_id);
  }

  $session = rgvp_create_session($user_id);
  $fresh_user = get_user_by('id', $user_id);

  return rgvp_response([
    'success' => true,
    'token' => $session['token'],
    'expires' => $session['expires'],
    'user' => rgvp_user_payload($fresh_user),
    'orders' => [],
  ]);
}

function rgvp_login(WP_REST_Request $request) {
  $login = trim((string) $request->get_param('login'));
  $password = (string) $request->get_param('password');
  $rate_key = rgvp_rate_key('rgvp_login', $login);

  if (rgvp_too_many_attempts($rate_key)) {
    return rgvp_error('Too many attempts. Try again later.', 429);
  }

  if (!$login || !$password) {
    rgvp_increment_attempts($rate_key);
    return rgvp_error('Invalid email or password.', 401);
  }

  $user_lookup = rgvp_find_user_by_login_or_email($login);

  if (!$user_lookup) {
    rgvp_increment_attempts($rate_key);
    return rgvp_error('Invalid email or password.', 401);
  }

  $user = wp_authenticate($user_lookup->user_login, $password);

  if (is_wp_error($user)) {
    rgvp_increment_attempts($rate_key);
    return rgvp_error('Invalid email or password.', 401);
  }

  rgvp_clear_attempts($rate_key);

  $session = rgvp_create_session($user->ID);

  return rgvp_response([
    'success' => true,
    'token' => $session['token'],
    'expires' => $session['expires'],
    'user' => rgvp_user_payload($user),
    'orders' => rgvp_get_orders_for_user($user->ID),
  ]);
}

function rgvp_me(WP_REST_Request $request) {
  $auth = rgvp_auth_user_from_request($request);

  if (!$auth) {
    return rgvp_error('Unauthorized.', 401);
  }

  return rgvp_response([
    'success' => true,
    'user' => rgvp_user_payload($auth['user']),
    'orders' => rgvp_get_orders_for_user($auth['user']->ID),
  ]);
}

function rgvp_logout(WP_REST_Request $request) {
  $auth = rgvp_auth_user_from_request($request);

  if ($auth) {
    rgvp_destroy_session($auth['user']->ID, $auth['session_id']);
  }

  return rgvp_response([
    'success' => true,
  ]);
}

function rgvp_forgot_password(WP_REST_Request $request) {
  $login = trim((string) $request->get_param('login'));
  $site_url = 'https://rgvprimellc.com';

  if (!$site_url) {
    $env_site_url = getenv('PUBLIC_SITE_URL');

    if ($env_site_url) {
      $site_url = esc_url_raw((string) $env_site_url);
    }
  }

  if (!$site_url) {
    $site_url = 'https://rgvprimellc.com';
  }

  $site_url = untrailingslashit($site_url);

  $user = rgvp_find_user_by_login_or_email($login);

  if (!$user) {
    return rgvp_response([
      'success' => true,
      'message' => 'If an account exists, a reset link has been sent.',
    ]);
  }

  $key = get_password_reset_key($user);

  if (is_wp_error($key)) {
    return rgvp_response([
      'success' => true,
      'message' => 'If an account exists, a reset link has been sent.',
    ]);
  }

  $reset_url = add_query_arg([
    'mode' => 'reset',
    'key' => $key,
    'login' => $user->user_login,
  ], trailingslashit($site_url) . 'account');

  $reset_url_safe = esc_url($reset_url);
  $site_url_safe = esc_url($site_url);
  $brand = 'RGVPRIME RESEARCH LLC';

  $subject = 'Reset your RGVPRIME account password';

  $message = <<<HTML
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Reset your password</title>
  </head>
  <body style="margin:0;padding:0;background:#050000;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      Use this secure link to reset your RGVPRIME account password.
    </div>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050000;margin:0;padding:0;">
      <tr>
        <td align="center" style="padding:34px 14px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#090909;border:1px solid rgba(255,255,255,0.10);border-radius:28px;overflow:hidden;">
            <tr>
              <td style="background:linear-gradient(135deg,#160000 0%,#090909 45%,#2a0303 100%);">
                <div style="height:4px;background:linear-gradient(90deg,transparent,#dc2626,transparent);"></div>

                <div style="padding:34px 28px 24px;text-align:center;">
                  <div style="display:inline-block;padding:10px 14px;border:1px solid rgba(248,113,113,0.35);border-radius:999px;background:rgba(220,38,38,0.10);color:#fecaca;font-size:11px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;">
                    Secure account recovery
                  </div>

                  <h1 style="margin:22px 0 0;color:#ffffff;font-size:34px;line-height:1.04;letter-spacing:-1.3px;font-weight:900;">
                    Reset your password
                  </h1>

                  <p style="margin:16px auto 0;max-width:460px;color:rgba(255,255,255,0.62);font-size:15px;line-height:1.7;">
                    We received a request to reset the password for your RGVPRIME customer portal. Use the secure button below to create a new password.
                  </p>
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:rgba(255,255,255,0.035);border:1px solid rgba(255,255,255,0.08);border-radius:22px;">
                  <tr>
                    <td style="padding:24px;text-align:center;">
                      <p style="margin:0 0 20px;color:rgba(255,255,255,0.54);font-size:14px;line-height:1.6;">
                        This secure link is time-sensitive and should only be used by the account owner.
                      </p>

                      <a href="{$reset_url_safe}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;border-radius:16px;padding:16px 24px;font-size:12px;font-weight:900;letter-spacing:0.14em;text-transform:uppercase;box-shadow:0 18px 42px rgba(220,38,38,0.28);">
                        Create new password
                      </a>

                      <p style="margin:22px 0 0;color:rgba(255,255,255,0.38);font-size:12px;line-height:1.6;">
                        If the button does not work, copy and paste this link into your browser:
                      </p>

                      <p style="margin:10px 0 0;word-break:break-all;color:#fecaca;font-size:12px;line-height:1.6;">
                        {$reset_url_safe}
                      </p>
                    </td>
                  </tr>
                </table>

                <p style="margin:22px 0 0;color:rgba(255,255,255,0.42);font-size:13px;line-height:1.7;text-align:center;">
                  If you did not request this password reset, you can safely ignore this email. Your current password will remain unchanged.
                </p>

                <div style="margin-top:28px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;">
                  <p style="margin:0;color:#ffffff;font-size:13px;font-weight:900;letter-spacing:0.12em;text-transform:uppercase;">
                    {$brand}
                  </p>

                  <p style="margin:8px 0 0;color:rgba(255,255,255,0.35);font-size:12px;">
                    Customer portal security notification
                  </p>

                  <p style="margin:10px 0 0;">
                    <a href="{$site_url_safe}" style="color:#fca5a5;text-decoration:none;font-size:12px;">
                      Visit website
                    </a>
                  </p>
                </div>
              </td>
            </tr>
          </table>

          <p style="margin:18px 0 0;color:rgba(255,255,255,0.28);font-size:11px;">
            This is an automated security email from {$brand}.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>
HTML;

  $message = rgvp_email_document(
    $subject,
    'SECURE ACCOUNT RECOVERY',
    'Reset your',
    'account password.',
    'Use this secure, time-sensitive link to choose a new password.',
    '<p style="margin:0">Only the account owner should use this link. If you did not request a password reset, you can safely ignore this email.</p>',
    'Create new password',
    $reset_url_safe,
    'Customer portal security notification'
  );

  $headers = [
    'Content-Type: text/html; charset=UTF-8',
    'From: RGVPRIME RESEARCH LLC <support@rgvprimellc.com>',
  ];

  wp_mail($user->user_email, $subject, $message, $headers);

  return rgvp_response([
    'success' => true,
    'message' => 'If an account exists, a reset link has been sent.',
  ]);
}

function rgvp_reset_password(WP_REST_Request $request) {
  $login = sanitize_user((string) $request->get_param('login'));
  $key = preg_replace('/[^a-zA-Z0-9]/', '', (string) $request->get_param('key'));
  $password = (string) $request->get_param('password');

  if (!rgvp_password_valid($password)) {
    return rgvp_error('Password must be at least 10 characters.', 422);
  }

  $user = check_password_reset_key($key, $login);

  if (is_wp_error($user)) {
    return rgvp_error('This reset link is invalid or expired.', 400);
  }

  reset_password($user, $password);

  return rgvp_response([
    'success' => true,
    'message' => 'Password updated successfully.',
  ]);
}

function rgvp_update_profile(WP_REST_Request $request) {
  $auth = rgvp_auth_user_from_request($request);

  if (!$auth) {
    return rgvp_error('Unauthorized.', 401);
  }

  $user_id = $auth['user']->ID;

  $first_name = sanitize_text_field((string) $request->get_param('first_name'));
  $last_name = sanitize_text_field((string) $request->get_param('last_name'));
  $phone = sanitize_text_field((string) $request->get_param('billing_phone'));
  $address_1 = sanitize_text_field((string) $request->get_param('billing_address_1'));
  $address_2 = sanitize_text_field((string) $request->get_param('billing_address_2'));
  $city = sanitize_text_field((string) $request->get_param('billing_city'));
  $state = sanitize_text_field((string) $request->get_param('billing_state'));
  $postcode = sanitize_text_field((string) $request->get_param('billing_postcode'));
  $country = sanitize_text_field((string) $request->get_param('billing_country'));

  wp_update_user([
    'ID' => $user_id,
    'first_name' => $first_name,
    'last_name' => $last_name,
    'display_name' => trim($first_name . ' ' . $last_name) ?: $auth['user']->user_email,
  ]);

  update_user_meta($user_id, 'billing_first_name', $first_name);
  update_user_meta($user_id, 'billing_last_name', $last_name);
  update_user_meta($user_id, 'billing_phone', $phone);
  update_user_meta($user_id, 'billing_address_1', $address_1);
  update_user_meta($user_id, 'billing_address_2', $address_2);
  update_user_meta($user_id, 'billing_city', $city);
  update_user_meta($user_id, 'billing_state', $state);
  update_user_meta($user_id, 'billing_postcode', $postcode);
  update_user_meta($user_id, 'billing_country', $country);

  $user = get_user_by('id', $user_id);

  return rgvp_response([
    'success' => true,
    'user' => rgvp_user_payload($user),
  ]);
}
