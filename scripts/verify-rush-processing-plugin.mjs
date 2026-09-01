import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [checkout, zelle, orbit, plugin] = await Promise.all([
  read("src/components/checkout/RgvCheckout.jsx"),
  read("wordpress-plugin/rgv-zelle-checkout/rgv-zelle-checkout.php"),
  read("wordpress-plugin/orbit-relay/includes/class-orbit-relay-card-checkout.php"),
  read("wordpress-plugin/rgv-rush-processing-orders/rgv-rush-processing-orders.php"),
]);

assert(checkout.includes("const PRIORITY_PROCESSING_FEE_RATE = 0.05"), "checkout rush rate must be 5%");
assert(checkout.includes("⚡ SKIP THE LINE — RUSH PROCESSING (+5%)"), "checkout rush label is missing");
assert(checkout.includes("Carrier delivery times are not guaranteed."), "carrier disclaimer is missing");
assert(zelle.includes("const PRIORITY_PROCESSING_FEE_RATE = 0.05"), "Zelle backend rush rate must be 5%");
assert(orbit.includes("private const PRIORITY_PROCESSING_FEE_RATE = 0.05"), "card backend rush rate must be 5%");

for (const expected of [
  "manage_edit-shop_order_columns",
  "manage_woocommerce_page_wc-orders_columns",
  "woocommerce_payment_complete",
  "_rgv_priority_processing",
  "⚡ RUSH PAID",
  "rgv-rush-paid",
  "custom_order_tables",
]) assert(plugin.includes(expected), `Rush plugin is missing: ${expected}`);

console.log("Rush Processing verification passed (5% fee, checkout copy, paid detection, HPOS/classic highlighting). ");
