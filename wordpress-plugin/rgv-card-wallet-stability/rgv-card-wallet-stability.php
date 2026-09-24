<?php
/**
 * Plugin Name: RGV Card & Wallet Payment Stability
 * Description: Reserves additional PHP memory only for the hosted card and wallet payment flow.
 * Version: 1.1.0
 * Author: RGVPRIME LLC
 * Requires at least: 6.5
 * Requires PHP: 8.1
 */

defined('ABSPATH') || exit;

final class RGV_Card_Wallet_Payment_Stability {
  private const TARGET_MEMORY_LIMIT = '512M';
  private const TARGET_MEMORY_BYTES = 536870912;
  private const VERSION = '1.1.0';
  private const TRACE_FILE = WP_CONTENT_DIR . '/rgv-card-wallet-payment-trace.json';

  private static $trace_started_at = 0.0;
  private static $trace_stage = 'bootstrap';
  private static $last_query_shape = '';
  private static $last_query_stack = [];

  public static function bootstrap() {
    add_action('rest_api_init', [self::class, 'register_status_route']);

    if (!self::is_card_wallet_payment_request()) {
      return;
    }

    $current = function_exists('wp_convert_hr_to_bytes')
      ? (int) wp_convert_hr_to_bytes((string) ini_get('memory_limit'))
      : 0;

    // A value below zero means PHP has no memory ceiling. Leave it unchanged.
    if ($current >= 0 && $current < self::TARGET_MEMORY_BYTES) {
      @ini_set('memory_limit', self::TARGET_MEMORY_LIMIT);
    }

    if (self::is_card_wallet_payment_submission()) {
      self::start_trace();
    }
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
      'version' => self::VERSION,
      'current_limit' => $limit,
      'target_met' => $bytes < 0 || $bytes >= self::TARGET_MEMORY_BYTES,
      'last_payment_trace' => self::read_trace(),
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

  private static function is_card_wallet_payment_submission() {
    $request_method = isset($_SERVER['REQUEST_METHOD']) && is_string($_SERVER['REQUEST_METHOD'])
      ? strtoupper(wp_unslash($_SERVER['REQUEST_METHOD']))
      : '';
    $request_uri = isset($_SERVER['REQUEST_URI']) && is_string($_SERVER['REQUEST_URI'])
      ? wp_unslash($_SERVER['REQUEST_URI'])
      : '';
    $payment_method = isset($_POST['payment_method']) && is_string($_POST['payment_method'])
      ? sanitize_key(wp_unslash($_POST['payment_method']))
      : '';

    return 'POST' === $request_method &&
      false !== strpos($request_uri, '/checkout/order-pay/') &&
      'psc' === $payment_method &&
      isset($_POST['woocommerce_pay']);
  }

  private static function start_trace() {
    self::$trace_started_at = microtime(true);
    self::$trace_stage = 'payment_post_started';

    add_filter('query', [self::class, 'capture_query'], PHP_INT_MAX, 1);
    add_action('woocommerce_before_pay_action', [self::class, 'mark_before_pay_action'], PHP_INT_MAX, 0);
    add_action('woocommerce_before_order_object_save', [self::class, 'mark_before_order_save'], PHP_INT_MAX, 1);
    add_action('woocommerce_after_order_object_save', [self::class, 'mark_after_order_save'], PHP_INT_MAX, 1);
    add_action('shutdown', [self::class, 'finish_trace'], 0);
  }

  public static function capture_query($query) {
    if (!is_string($query)) {
      return $query;
    }

    self::$last_query_shape = self::redact_query($query);
    self::$last_query_stack = self::safe_stack();
    self::$trace_stage = 'database_query';
    return $query;
  }

  public static function mark_before_pay_action() {
    self::$trace_stage = 'before_pay_action';
  }

  public static function mark_before_order_save($order) {
    if ($order instanceof WC_Order && 'psc' === (string) $order->get_payment_method()) {
      self::$trace_stage = 'before_order_save';
    }
  }

  public static function mark_after_order_save($order) {
    if ($order instanceof WC_Order && 'psc' === (string) $order->get_payment_method()) {
      self::$trace_stage = 'after_order_save';
    }
  }

  public static function finish_trace() {
    $last_error = error_get_last();
    $fatal_types = [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR, E_RECOVERABLE_ERROR];
    $is_fatal = is_array($last_error) && in_array((int) ($last_error['type'] ?? 0), $fatal_types, true);

    $payload = [
      'captured_at_utc' => gmdate('c'),
      'result' => $is_fatal ? 'fatal' : 'completed',
      'elapsed_seconds' => round(max(0, microtime(true) - self::$trace_started_at), 3),
      'last_stage' => self::$trace_stage,
      'last_query_shape' => self::$last_query_shape,
      'last_query_stack' => self::$last_query_stack,
      'fatal' => $is_fatal ? [
        'type' => (int) ($last_error['type'] ?? 0),
        'message' => self::redact_error_message((string) ($last_error['message'] ?? '')),
        'file' => basename((string) ($last_error['file'] ?? '')),
        'line' => (int) ($last_error['line'] ?? 0),
      ] : null,
      'peak_memory_mb' => round(memory_get_peak_usage(true) / 1048576, 1),
    ];

    $encoded = wp_json_encode($payload, JSON_UNESCAPED_SLASHES);
    if (is_string($encoded)) {
      @file_put_contents(self::TRACE_FILE, $encoded, LOCK_EX);
    }
  }

  private static function read_trace() {
    if (!is_readable(self::TRACE_FILE)) {
      return null;
    }

    $raw = @file_get_contents(self::TRACE_FILE);
    $decoded = is_string($raw) ? json_decode($raw, true) : null;
    return is_array($decoded) ? $decoded : null;
  }

  private static function redact_query($query) {
    $shape = preg_replace("/'(?:''|[^'])*'/s", '?', $query);
    $shape = preg_replace('/\b(?:0x[0-9a-f]+|\d+(?:\.\d+)?)\b/i', '?', (string) $shape);
    $shape = preg_replace('/\s+/', ' ', (string) $shape);
    return substr(trim((string) $shape), 0, 1200);
  }

  private static function safe_stack() {
    $stack = [];
    foreach (debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 16) as $frame) {
      $stack[] = [
        'file' => basename((string) ($frame['file'] ?? '')),
        'line' => (int) ($frame['line'] ?? 0),
        'call' => (string) ($frame['class'] ?? '') . (string) ($frame['type'] ?? '') . (string) ($frame['function'] ?? ''),
      ];
    }
    return $stack;
  }

  private static function redact_error_message($message) {
    $message = preg_replace('#/[^\s]+/#', '/[path]/', (string) $message);
    return substr((string) $message, 0, 500);
  }
}

RGV_Card_Wallet_Payment_Stability::bootstrap();
