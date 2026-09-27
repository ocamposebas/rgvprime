<?php
declare(strict_types=1);

define('ABSPATH', __DIR__);
define('HOUR_IN_SECONDS', 3600);
define('MINUTE_IN_SECONDS', 60);

$GLOBALS['rgv_actions'] = [];
$GLOBALS['rgv_scheduled'] = [];
$GLOBALS['rgv_orders'] = [];
$GLOBALS['rgv_sweep_orders'] = [];
$GLOBALS['rgv_options'] = [];

function add_action($hook, $callback, $priority = 10, $accepted_args = 1) { $GLOBALS['rgv_actions'][] = $hook; }
function add_filter($hook, $callback, $priority = 10, $accepted_args = 1) { $GLOBALS['rgv_actions'][] = $hook; }
function register_activation_hook($file, $callback) {}
function register_deactivation_hook($file, $callback) {}
function as_next_scheduled_action($hook, $args = [], $group = '') { return false; }
function as_schedule_single_action($timestamp, $hook, $args = [], $group = '', $unique = false) {
  $GLOBALS['rgv_scheduled'][] = compact('timestamp', 'hook', 'args', 'group', 'unique');
}
function as_schedule_recurring_action($timestamp, $interval, $hook, $args = [], $group = '', $unique = false) {
  $GLOBALS['rgv_scheduled'][] = compact('timestamp', 'interval', 'hook', 'args', 'group', 'unique');
}
function as_unschedule_all_actions($hook, $args = [], $group = '') {}
function wp_next_scheduled($hook, $args = []) { return false; }
function wp_schedule_event($timestamp, $schedule, $hook, $args = []) {}
function wp_schedule_single_event($timestamp, $hook, $args = []) {}
function wp_clear_scheduled_hook($hook, $args = []) {}
function wc_get_order($id) { return $GLOBALS['rgv_orders'][(int) $id] ?? false; }
function wc_get_orders($args) { return $GLOBALS['rgv_sweep_orders']; }
function update_option($key, $value, $autoload = null) { $GLOBALS['rgv_options'][$key] = $value; }
function get_option($key, $default = false) { return $GLOBALS['rgv_options'][$key] ?? $default; }

class WC_Order {
  public int $id;
  public string $status;
  public string $payment_method;
  public array $meta;
  public bool $paid;
  public DateTimeImmutable $created;
  public array $status_updates = [];

  public function __construct(int $id, array $options = []) {
    $this->id = $id;
    $this->status = $options['status'] ?? 'pending';
    $this->payment_method = $options['payment_method'] ?? 'psc';
    $this->meta = $options['meta'] ?? ['_rgv_payment_source' => 'rgv_custom_checkout_card_wallets'];
    $this->paid = $options['paid'] ?? false;
    $this->created = $options['created'] ?? new DateTimeImmutable('-2 hours');
  }

  public function get_id() { return $this->id; }
  public function get_status() { return $this->status; }
  public function get_payment_method() { return $this->payment_method; }
  public function get_meta($key, $single = true) { return $this->meta[$key] ?? ''; }
  public function update_meta_data($key, $value) { $this->meta[$key] = $value; }
  public function get_date_created() { return $this->created; }
  public function is_paid() { return $this->paid; }
  public function has_status($status) { return is_array($status) ? in_array($this->status, $status, true) : $this->status === $status; }
  public function save() {}
  public function update_status($status, $note = '', $manual = false) {
    $this->status = $status;
    $this->status_updates[] = compact('status', 'note', 'manual');
  }
}

function expect_true($condition, string $message): void {
  if (!$condition) throw new RuntimeException($message);
}

require __DIR__ . '/../wordpress-plugin/rgv-card-wallet-stability/rgv-card-wallet-stability.php';

$abandoned = new WC_Order(1001);
$in_flight = new WC_Order(1002, ['meta' => [
  '_rgv_payment_source' => 'rgv_custom_checkout_card_wallets',
  '_psc_payment_id' => 'pi_live_payment',
]]);
$other_source = new WC_Order(1003, ['meta' => ['_rgv_payment_source' => 'other_checkout']]);
$fresh = new WC_Order(1004, ['created' => new DateTimeImmutable('-5 minutes')]);
$GLOBALS['rgv_orders'] = [1001 => $abandoned, 1002 => $in_flight, 1003 => $other_source, 1004 => $fresh];

RGV_Card_Wallet_Payment_Stability::expire_abandoned_order(1001);
expect_true('cancelled' === $abandoned->status, 'An old order without a PRISM payment must expire.');
expect_true('yes' === ($abandoned->meta['_rgv_card_wallet_abandoned'] ?? ''), 'Expired orders must be marked as abandoned.');

RGV_Card_Wallet_Payment_Stability::expire_abandoned_order(1002);
expect_true('pending' === $in_flight->status, 'An order with a PRISM payment id must remain protected.');

RGV_Card_Wallet_Payment_Stability::expire_abandoned_order(1003);
expect_true('pending' === $other_source->status, 'A non-storefront order must remain untouched.');

RGV_Card_Wallet_Payment_Stability::maybe_schedule_order_expiry($fresh);
expect_true(
  (bool) array_filter($GLOBALS['rgv_scheduled'], static fn($action) => 'rgv_card_wallet_expire_abandoned_order' === $action['hook']),
  'A new storefront PRISM order must receive an expiry action.'
);

$sweep_abandoned = new WC_Order(1010);
$sweep_protected = new WC_Order(1011, ['meta' => [
  '_rgv_payment_source' => 'rgv_custom_checkout_card_wallets',
  '_psc_payment_id' => 'pi_protected',
]]);
$GLOBALS['rgv_orders'][1010] = $sweep_abandoned;
$GLOBALS['rgv_orders'][1011] = $sweep_protected;
$GLOBALS['rgv_sweep_orders'] = [$sweep_abandoned, $sweep_protected];

RGV_Card_Wallet_Payment_Stability::sweep_abandoned_orders();
expect_true('cancelled' === $sweep_abandoned->status, 'The sweep must expire abandoned PRISM orders.');
expect_true('pending' === $sweep_protected->status, 'The sweep must not cancel an in-flight PRISM order.');
$last_sweep = $GLOBALS['rgv_options']['rgv_card_wallet_cleanup_last_sweep'] ?? [];
expect_true(1 === ($last_sweep['expired'] ?? 0), 'The sweep must report one expired order.');
expect_true(1 === ($last_sweep['protected_in_flight'] ?? 0), 'The sweep must report one protected order.');

echo "Card & Wallet stability verification passed (abandoned cleanup, in-flight protection, scheduling).\n";
