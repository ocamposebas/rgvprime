import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  getMysteryRewardState,
  normalizeMysteryPromotion,
} from "../src/lib/mysteryVialPromotion.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [
  bootstrap,
  engine,
  readme,
  proxy,
  checkout,
  checkoutCss,
  zelle,
  relay,
  orbitCard,
  packageScript,
] = await Promise.all([
  read("wordpress-plugin/rgv-mystery-vial-promotion/rgv-mystery-vial-promotion.php"),
  read("wordpress-plugin/rgv-mystery-vial-promotion/includes/class-rgv-mystery-vial-promotion.php"),
  read("wordpress-plugin/rgv-mystery-vial-promotion/readme.txt"),
  read("src/pages/api/mystery-vials.js"),
  read("src/components/checkout/RgvCheckout.jsx"),
  read("src/components/checkout/RgvCheckout.clean.css"),
  read("wordpress-plugin/rgv-zelle-checkout/rgv-zelle-checkout.php"),
  read("wordpress-plugin/orbit-relay/includes/class-orbit-relay-card-checkout.php"),
  read("wordpress-plugin/rgv-orbit-card-checkout/rgv-orbit-card-checkout.php"),
  read("scripts/package-mystery-vial-promotion.ps1"),
]);

for (const expected of [
  "Plugin Name: RGV Mystery Vial Promotion",
  "Version: 1.0.0",
  "Requires Plugins: woocommerce",
  "declare_compatibility( 'custom_order_tables'",
  "rgv_mystery_vials_apply_to_order",
]) {
  assert(bootstrap.includes(expected), `Plugin bootstrap is missing: ${expected}`);
}

for (const expected of [
  "inventory_limit'   => 150",
  "tier_one_spend'    => 60.0",
  "tier_two_spend'    => 150.0",
  "RGV-MYSTERY-VIAL",
  "Mystery Vial Complimentary",
  "set_virtual( false )",
  "set_catalog_visibility( 'hidden' )",
  "woocommerce_before_order_object_save",
  "woocommerce_checkout_order_created",
  "woocommerce_rest_insert_shop_order_object",
  "SELECT GET_LOCK",
  "SELECT RELEASE_LOCK",
  "state IN ('allocated','consumed')",
  "net_merchandise_subtotal",
  "$item->get_total()",
  "$order->get_discount_total()",
  "_rgv_mystery_vial_gift",
  "rgv-mystery/v1",
  "Cache-Control",
  "visible to Pirate Ship as a physical order item",
]) {
  assert(engine.includes(expected), `Promotion engine is missing: ${expected}`);
}

assert(
  !engine.includes("set_manage_stock( true )"),
  "Woo stock must not double-decrement the transaction-safe campaign ledger",
);
assert(
  readme.includes("Pirate Ship") && readme.includes("SKU RGV-MYSTERY-VIAL"),
  "Fulfillment documentation is incomplete",
);
assert(
  proxy.includes("/wp-json/rgv-mystery/v1/status") && proxy.includes('"no-store'),
  "Headless live-inventory proxy is missing",
);

for (const bridge of [zelle, relay, orbitCard]) {
  assert(
    bridge.includes("rgv_mystery_vials_apply_to_order"),
    "A custom checkout path does not apply the authoritative gift before stock reservation",
  );
}

for (const expected of [
  'fetch("/api/mystery-vials"',
  "getMysteryRewardState",
  "Limited 150-vial drop",
  "$60 net · 1 vial",
  "$150 net · 2 vials",
  "Confirmed when the order is created · while supplies last",
  "mysteryReward.productSku",
]) {
  assert(checkout.includes(expected), `Checkout experience is missing: ${expected}`);
}

for (const expected of [
  ".rgvx-mystery-promo",
  ".rgvx-mystery-vials",
  ".rgvx-summary-item--mystery",
  "@media (prefers-reduced-motion: reduce)",
]) {
  assert(checkoutCss.includes(expected), `Checkout styling is missing: ${expected}`);
}

const livePromotion = normalizeMysteryPromotion({
  active: true,
  available: true,
  inventory_limit: 150,
  remaining: 150,
  tiers: [
    { minimum: 60, quantity: 1 },
    { minimum: 150, quantity: 2 },
  ],
});

assert.equal(getMysteryRewardState(59.99, livePromotion).quantity, 0);
assert.equal(getMysteryRewardState(60, livePromotion).quantity, 1);
assert.equal(getMysteryRewardState(149.99, livePromotion).quantity, 1);
assert.equal(getMysteryRewardState(150, livePromotion).quantity, 2);
assert.equal(
  getMysteryRewardState(150, { ...livePromotion, remaining: 1 }).quantity,
  1,
  "Checkout must not promise two vials when only one remains",
);
assert.equal(
  getMysteryRewardState(150, { ...livePromotion, active: false }).quantity,
  0,
);
assert.equal(getMysteryRewardState(45, livePromotion).amountToNext, 15);
assert.equal(getMysteryRewardState(100, livePromotion).amountToNext, 50);

assert(packageScript.includes("rgv-mystery-vial-promotion-1.0.0.zip"));
assert(packageScript.includes("rgv-mystery-vial-promotion/$relativePath"));

console.log(
  "Mystery Vial promotion verification passed (net tiers, 150-vial ledger, WooCommerce fulfillment item, Pirate Ship SKU, and checkout UX).",
);

