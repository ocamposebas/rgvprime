import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [cardStability, zelle, relay, orbitCard, cardBackend] = await Promise.all([
  read("wordpress-plugin/rgv-card-wallet-stability/rgv-card-wallet-stability.php"),
  read("wordpress-plugin/rgv-zelle-checkout/rgv-zelle-checkout.php"),
  read("wordpress-plugin/orbit-relay/includes/class-orbit-relay-card-checkout.php"),
  read("wordpress-plugin/rgv-orbit-card-checkout/rgv-orbit-card-checkout.php"),
  read("src/lib/cardWalletCheckout.js"),
]);

for (const [name, source] of Object.entries({ cardStability, zelle, relay, orbitCard })) {
  assert(source.includes("wc_reserve_stock_for_order"), `${name} must reserve inventory before payment.`);
  assert(source.includes("_rgv_stock_reservation_applied"), `${name} must record a successful inventory hold.`);
  assert(source.includes("woocommerce_order_hold_stock_minutes"), `${name} must enforce a nonzero hold window.`);
}

assert(cardStability.includes("rest_request_after_callbacks"), "Card & Wallets REST-created orders must be intercepted before their response is returned.");
assert(cardStability.includes("woocommerce_before_pay_action"), "Card & Wallets must renew its stock hold immediately before every payment attempt.");
assert(cardStability.includes("ensure_stock_before_payment"), "Card & Wallets retry payments must repeat the atomic stock check.");
assert(cardStability.includes("'status' => 409"), "Card & Wallets must reject a second checkout when stock cannot be reserved.");
assert(cardStability.includes("$order->update_status(\n        'failed'"), "An unreserved Card & Wallets order must be failed before payment.");

const zelleReserve = zelle.indexOf("wc_reserve_stock_for_order($order)");
const zelleComplete = zelle.indexOf("$this->complete_checkout_request($request_option_name, $order->get_id())");
assert(zelleReserve !== -1 && zelleReserve < zelleComplete, "Zelle must reserve stock before exposing a completed checkout request.");
assert(zelle.includes("], 409);"), "Zelle must return an inventory conflict before showing payment instructions.");

const relayPopulateStart = relay.indexOf("private static function populate_pending_order");
const relayReserve = relay.indexOf("wc_reserve_stock_for_order( $order )", relayPopulateStart);
const relayPopulateReturn = relay.indexOf("return $order;", relayReserve);
const relayPopulateCall = relay.indexOf("self::populate_pending_order(");
const relayPayment = relay.indexOf("return self::prepare_orbit_payment( $order )", relayPopulateCall);
assert(relayPopulateStart !== -1 && relayReserve > relayPopulateStart && relayPopulateReturn > relayReserve, "ORBIT Relay must reserve stock while creating its pending order.");
assert(relayPopulateCall !== -1 && relayPayment > relayPopulateCall, "ORBIT Relay must finish its stock-reserving order creation before preparing payment.");

const orbitReserve = orbitCard.indexOf("wc_reserve_stock_for_order($order)");
const orbitSubmit = orbitCard.indexOf("$processor_submitted = true");
assert(orbitReserve !== -1 && orbitReserve < orbitSubmit, "Standalone ORBIT must reserve stock before submitting the charge.");
assert(orbitCard.includes("wc_release_stock_for_order($order)"), "Standalone ORBIT must release its hold when pre-payment checkout fails.");

assert(cardBackend.includes('status: "pending"'), "The storefront order must remain pending while its atomic stock hold is active.");
assert(!cardBackend.includes("set_paid: true"), "The storefront must not mark an unpaid order as paid to manipulate stock.");

console.log("Stock reservation verification passed for Card & Wallets, Zelle, ORBIT Relay, and standalone ORBIT.");
