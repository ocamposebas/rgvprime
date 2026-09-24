<?php
/**
 * Plugin Name: RGV Card & Wallet Payment Stability
 * Description: Reserves additional PHP memory only for the hosted card and wallet payment flow.
 * Version: 1.0.0
 * Author: RGVPRIME LLC
 * Requires at least: 6.5
 * Requires PHP: 8.1
 */

defined('ABSPATH') || exit;

final class RGV_Card_Wallet_Payment_Stability {
  private const TARGET_MEMORY_LIMIT = '512M';
  private const TARGET_MEMORY_BYTES = 536870912;

  public static function bootstrap() {
    add_action('rest_api_init', [self::class, 'register_status_route']);

    if (!self::is_card_wallet_payment_request()) {
      return;
    }

    $current = function_exists('wp_convert_hr_to_bytes')
      ? (int) wp_convert_hr_to_bytes((string) ini_get('memory_limit'))
      : 0;

    // A value below zero means PHP has no memory ceiling. Leave it unchanged.
    if ($current < 0 || $current >= self::TARGET_MEMORY_BYTES) {
      return;
    }

    @ini_set('memory_limit', self::TARGET_MEMORY_LIMIT);
  }

  public static function register_status_route() {
    register_rest_route('rgv-card-wallet/v1', '/status', [
      'methods' => 'GET',
      'callback' => [self::class, 'status'],
      'permission_callback' => '__return_true',
    ]);
  }

  public static function status() {
    $limit = (string) ini_get('memory_limit');
    $bytes = function_exists('wp_convert_hr_to_bytes')
      ? (int) wp_convert_hr_to_bytes($limit)
      : 0;
    $response = new WP_REST_Response([
      'active' => true,
      'version' => '1.0.0',
      'current_limit' => $limit,
      'target_met' => $bytes < 0 || $bytes >= self::TARGET_MEMORY_BYTES,
    ]);
    $response->header('Cache-Control', 'no-store');
    $response->header('X-Robots-Tag', 'noindex, nofollow');
    return $response;
  }

  private static function is_card_wallet_payment_request() {
    $request_uri = isset($_SERVER['REQUEST_URI']) && is_string($_SERVER['REQUEST_URI'])
      ? wp_unslash($_SERVER['REQUEST_URI'])
      : '';
    $payment_method = isset($_POST['payment_method']) && is_string($_POST['payment_method'])
      ? sanitize_key(wp_unslash($_POST['payment_method']))
      : '';
    if (false !== strpos($request_uri, '/checkout/order-pay/') && 'psc' === $payment_method) {
      return true;
    }

    $action = isset($_REQUEST['action']) && is_string($_REQUEST['action'])
      ? sanitize_key(wp_unslash($_REQUEST['action']))
      : '';
    if (0 === strpos($action, 'psc_')) {
      return true;
    }

    $rest_route = isset($_GET['rest_route']) && is_string($_GET['rest_route'])
      ? wp_unslash($_GET['rest_route'])
      : '';

    return false !== strpos($request_uri, '/wp-json/psc/') ||
      false !== strpos($request_uri, '/wp-json/rgv-card-wallet/v1/status') ||
      0 === strpos($rest_route, '/psc/') ||
      0 === strpos($rest_route, '/rgv-card-wallet/v1/status');
  }
}

RGV_Card_Wallet_Payment_Stability::bootstrap();
