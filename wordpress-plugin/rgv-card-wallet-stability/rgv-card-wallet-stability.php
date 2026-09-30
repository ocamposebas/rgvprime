<?php
/**
 * Plugin Name: RGV Card & Wallet Payment Stability
 * Description: Expires abandoned card and wallet orders while preserving in-flight payment attempts.
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

  public static function bootstrap() {
    add_filter('cron_schedules', [self::class, 'cron_schedules']);
    add_action('init', [self::class, 'ensure_cleanup_schedule']);
    add_action(self::SWEEP_HOOK, [self::class, 'sweep_abandoned_orders']);
    add_action(self::EXPIRY_HOOK, [self::class, 'expire_abandoned_order'], 10, 1);
    add_action('woocommerce_after_order_object_save', [self::class, 'maybe_schedule_order_expiry'], 30, 1);
    add_action('woocommerce_payment_complete', [self::class, 'clear_order_expiry'], 30, 1);
    add_action('woocommerce_order_status_changed', [self::class, 'handle_status_change'], 30, 4);
    add_filter('woocommerce_email_enabled_cancelled_order', [self::class, 'suppress_abandoned_email'], 10, 2);
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
}

register_activation_hook(__FILE__, [RGV_Card_Wallet_Payment_Stability::class, 'activate']);
register_deactivation_hook(__FILE__, [RGV_Card_Wallet_Payment_Stability::class, 'deactivate']);
RGV_Card_Wallet_Payment_Stability::bootstrap();
