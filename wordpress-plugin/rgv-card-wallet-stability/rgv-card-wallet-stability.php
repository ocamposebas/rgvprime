<?php
/**
 * Plugin Name: RGV Card & Wallet Payment Stability
 * Description: Stabilizes the hosted card and wallet payment flow without changing other payment methods.
 * Version: 1.3.0
 * Author: RGVPRIME LLC
 * Requires at least: 6.5
 * Requires PHP: 8.1
 */

defined('ABSPATH') || exit;

add_action('before_woocommerce_init', static function () {
  if (class_exists('Automattic\WooCommerce\Utilities\FeaturesUtil')) {
    Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
  }
});

final class RGV_Card_Wallet_Payment_Stability {
  private const TARGET_MEMORY_LIMIT = '512M';
  private const TARGET_MEMORY_BYTES = 536870912;
  private const VERSION = '1.3.0';
  private const TRACE_FILE = WP_CONTENT_DIR . '/rgv-card-wallet-payment-trace.json';
  private const PAYMENT_METHOD = 'psc';
  private const PAYMENT_SOURCE_META = '_rgv_payment_source';
  private const PAYMENT_ID_META = '_psc_payment_id';
  private const ABANDONED_META = '_rgv_card_wallet_abandoned';
  private const EXPIRY_SECONDS = HOUR_IN_SECONDS;
  private const EXPIRY_HOOK = 'rgv_card_wallet_expire_abandoned_order';
  private const SWEEP_HOOK = 'rgv_card_wallet_sweep_abandoned_orders';
  private const ACTION_GROUP = 'rgv-card-wallet-stability';
  private const SWEEP_INTERVAL = 15 * MINUTE_IN_SECONDS;
  private const SWEEP_BATCH = 100;
  private const LAST_SWEEP_OPTION = 'rgv_card_wallet_cleanup_last_sweep';

  private static $trace_started_at = 0.0;
  private static $trace_stage = 'bootstrap';
  private static $last_query_shape = '';
  private static $last_query_stack = [];
  private static $suppressed_recursive_callbacks = [];

  public static function bootstrap() {
    add_action('rest_api_init', [self::class, 'register_status_route']);
    add_filter('cron_schedules', [self::class, 'cron_schedules']);
    add_action('init', [self::class, 'ensure_cleanup_schedule']);
    add_action(self::SWEEP_HOOK, [self::class, 'sweep_abandoned_orders']);
    add_action(self::EXPIRY_HOOK, [self::class, 'expire_abandoned_order'], 10, 1);
    add_action('woocommerce_after_order_object_save', [self::class, 'maybe_schedule_order_expiry'], 30, 1);
    add_action('woocommerce_payment_complete', [self::class, 'clear_order_expiry'], 30, 1);
    add_action('woocommerce_order_status_changed', [self::class, 'handle_status_change'], 30, 4);
    add_filter('woocommerce_email_enabled_cancelled_order', [self::class, 'suppress_abandoned_email'], 10, 2);

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
      'abandoned_order_cleanup' => [
        'active' => true,
        'expiry_minutes' => (int) (self::EXPIRY_SECONDS / MINUTE_IN_SECONDS),
        'interval_minutes' => (int) (self::SWEEP_INTERVAL / MINUTE_IN_SECONDS),
        'last_sweep' => get_option(self::LAST_SWEEP_OPTION, null),
      ],
    ]);
    $response->header('Cache-Control', 'no-store');
    $response->header('X-Robots-Tag', 'noindex, nofollow');
    return $response;
  }

  public static function cron_schedules($schedules) {
    if (!is_array($schedules)) $schedules = [];
    $schedules['rgv_card_wallet_quarter_hour'] = [
      'interval' => self::SWEEP_INTERVAL,
      'display' => 'Every 15 minutes (RGV Card & Wallet cleanup)',
    ];
    return $schedules;
  }

  public static function activate() {
    self::ensure_cleanup_schedule();
  }

  public static function deactivate() {
    self::unschedule_all(self::SWEEP_HOOK, []);
    self::unschedule_all(self::EXPIRY_HOOK, null);
  }

  public static function ensure_cleanup_schedule() {
    if (self::next_scheduled(self::SWEEP_HOOK, [])) return;

    $first = time() + MINUTE_IN_SECONDS;
    if (function_exists('as_schedule_recurring_action')) {
      as_schedule_recurring_action(
        $first,
        self::SWEEP_INTERVAL,
        self::SWEEP_HOOK,
        [],
        self::ACTION_GROUP,
        true
      );
      return;
    }

    wp_schedule_event($first, 'rgv_card_wallet_quarter_hour', self::SWEEP_HOOK);
  }

  public static function maybe_schedule_order_expiry($order) {
    if (!self::is_abandonable_order($order) || self::has_payment_attempt($order)) return;

    $created = $order->get_date_created();
    $expires_at = $created ? $created->getTimestamp() + self::EXPIRY_SECONDS : time() + self::EXPIRY_SECONDS;
    $expires_at = max(time() + 30, $expires_at);
    $args = [(int) $order->get_id()];
    if (self::next_scheduled(self::EXPIRY_HOOK, $args)) return;

    if (function_exists('as_schedule_single_action')) {
      as_schedule_single_action($expires_at, self::EXPIRY_HOOK, $args, self::ACTION_GROUP, true);
      return;
    }

    wp_schedule_single_event($expires_at, self::EXPIRY_HOOK, $args);
  }

  public static function clear_order_expiry($order_id) {
    self::unschedule_all(self::EXPIRY_HOOK, [(int) $order_id]);
  }

  public static function handle_status_change($order_id, $from, $to, $order) {
    unset($from);
    $order = $order instanceof WC_Order ? $order : wc_get_order($order_id);
    if (!$order instanceof WC_Order || !self::is_target_order($order)) return;

    if ('pending' === (string) $to && !$order->is_paid()) {
      self::maybe_schedule_order_expiry($order);
      return;
    }

    self::clear_order_expiry((int) $order_id);
  }

  public static function expire_abandoned_order($order_id) {
    $order = wc_get_order((int) $order_id);
    if (!self::is_abandonable_order($order) || self::has_payment_attempt($order)) {
      self::clear_order_expiry((int) $order_id);
      return;
    }

    $created = $order->get_date_created();
    if ($created && $created->getTimestamp() + self::EXPIRY_SECONDS > time()) {
      self::maybe_schedule_order_expiry($order);
      return;
    }

    $order->update_meta_data(self::ABANDONED_META, 'yes');
    $order->save();
    $order->update_status(
      'cancelled',
      'Card & Wallets checkout expired after 60 minutes without starting a PRISM payment.',
      false
    );
    self::clear_order_expiry((int) $order_id);
  }

  public static function sweep_abandoned_orders() {
    if (!function_exists('wc_get_orders')) return;

    $result = wc_get_orders([
      'status' => ['pending'],
      'payment_method' => self::PAYMENT_METHOD,
      'date_created' => '<' . (time() - self::EXPIRY_SECONDS),
      'limit' => self::SWEEP_BATCH,
      'orderby' => 'date',
      'order' => 'ASC',
      'return' => 'objects',
    ]);
    $orders = is_array($result) ? $result : [];
    $expired = 0;
    $protected = 0;

    foreach ($orders as $order) {
      if (!self::is_abandonable_order($order)) continue;
      if (self::has_payment_attempt($order)) {
        $protected++;
        continue;
      }
      self::expire_abandoned_order((int) $order->get_id());
      $expired++;
    }

    update_option(self::LAST_SWEEP_OPTION, [
      'completed_at_utc' => gmdate('c'),
      'scanned' => count($orders),
      'expired' => $expired,
      'protected_in_flight' => $protected,
    ], false);
  }

  private static function is_target_order($order) {
    if (!$order instanceof WC_Order || self::PAYMENT_METHOD !== (string) $order->get_payment_method()) return false;
    return in_array(
      (string) $order->get_meta(self::PAYMENT_SOURCE_META, true),
      ['rgv_custom_checkout_card_wallets', 'rgv_custom_checkout_prism'],
      true
    );
  }

  private static function is_abandonable_order($order) {
    return self::is_target_order($order) &&
      !$order->is_paid() &&
      $order->has_status('pending') &&
      'yes' !== (string) $order->get_meta(self::ABANDONED_META, true);
  }

  private static function has_payment_attempt($order) {
    return $order instanceof WC_Order && '' !== trim((string) $order->get_meta(self::PAYMENT_ID_META, true));
  }

  private static function next_scheduled($hook, $args) {
    if (function_exists('as_next_scheduled_action')) {
      return false !== as_next_scheduled_action($hook, $args, self::ACTION_GROUP);
    }
    return false !== wp_next_scheduled($hook, is_array($args) ? $args : []);
  }

  private static function unschedule_all($hook, $args) {
    if (function_exists('as_unschedule_all_actions')) {
      as_unschedule_all_actions($hook, $args, self::ACTION_GROUP);
    }
    if (null === $args) {
      wp_clear_scheduled_hook($hook);
    } else {
      wp_clear_scheduled_hook($hook, $args);
    }
  }

  public static function suppress_abandoned_email($enabled, $order) {
    if (
      $order instanceof WC_Order &&
      self::is_target_order($order) &&
      'yes' === (string) $order->get_meta(self::ABANDONED_META, true)
    ) {
      return false;
    }
    return $enabled;
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
    add_action('wp', [self::class, 'guard_recursive_order_snippets'], 1, 0);
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

  public static function guard_recursive_order_snippets() {
    global $wp_filter;

    $hook_name = 'woocommerce_update_order';
    $hook = $wp_filter[$hook_name] ?? null;
    if (!$hook instanceof WP_Hook || !is_array($hook->callbacks)) {
      return;
    }

    foreach ($hook->callbacks as $priority => $callbacks) {
      foreach ((array) $callbacks as $entry) {
        $callback = $entry['function'] ?? null;
        $file = self::callback_file($callback);
        if ('' === $file || false === stripos($file, 'snippet-ops.php') || false === stripos($file, "eval()'d code")) {
          continue;
        }

        if (remove_action($hook_name, $callback, (int) $priority)) {
          self::$suppressed_recursive_callbacks[] = [
            'hook' => $hook_name,
            'priority' => (int) $priority,
            'file' => basename($file),
          ];
        }
      }
    }

    if (self::$suppressed_recursive_callbacks) {
      self::$trace_stage = 'recursive_order_snippet_suppressed';
    }
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
      'suppressed_recursive_callbacks' => self::$suppressed_recursive_callbacks,
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
    foreach (debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 32) as $frame) {
      $stack[] = [
        'file' => basename((string) ($frame['file'] ?? '')),
        'line' => (int) ($frame['line'] ?? 0),
        'call' => (string) ($frame['class'] ?? '') . (string) ($frame['type'] ?? '') . (string) ($frame['function'] ?? ''),
      ];
    }
    return $stack;
  }

  private static function callback_file($callback) {
    try {
      if ($callback instanceof Closure || (is_string($callback) && function_exists($callback))) {
        $reflection = new ReflectionFunction($callback);
      } elseif (is_array($callback) && 2 === count($callback)) {
        $reflection = new ReflectionMethod($callback[0], (string) $callback[1]);
      } elseif (is_string($callback) && false !== strpos($callback, '::')) {
        [$class, $method] = explode('::', $callback, 2);
        $reflection = new ReflectionMethod($class, $method);
      } elseif (is_object($callback) && method_exists($callback, '__invoke')) {
        $reflection = new ReflectionMethod($callback, '__invoke');
      } else {
        return '';
      }

      $file = $reflection->getFileName();
      return is_string($file) ? $file : '';
    } catch (Throwable $error) {
      unset($error);
      return '';
    }
  }

  private static function redact_error_message($message) {
    $message = preg_replace('#/[^\s]+/#', '/[path]/', (string) $message);
    return substr((string) $message, 0, 500);
  }
}

register_activation_hook(__FILE__, [RGV_Card_Wallet_Payment_Stability::class, 'activate']);
register_deactivation_hook(__FILE__, [RGV_Card_Wallet_Payment_Stability::class, 'deactivate']);
RGV_Card_Wallet_Payment_Stability::bootstrap();
