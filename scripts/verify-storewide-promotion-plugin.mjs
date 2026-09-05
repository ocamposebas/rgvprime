import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [main, engine, proxy, navbar, cartApi, cartContext] = await Promise.all([
  read("wordpress-plugin/rgv-storewide-promotion/rgv-storewide-promotion.php"),
  read("wordpress-plugin/rgv-storewide-promotion/includes/class-rgv-storewide-promotion.php"),
  read("src/pages/api/promotion.js"),
  read("src/components/nav/Navbar.jsx"),
  read("src/pages/api/cart/validate-stock.js"),
  read("src/components/cart/CartContext.jsx"),
]);

for (const expected of [
  "Plugin Name: RGV Storewide Promotion",
  "Requires Plugins: woocommerce",
  "declare_compatibility( 'custom_order_tables'",
]) {
  assert(main.includes(expected), `Plugin bootstrap is missing: ${expected}`);
}

for (const expected of [
  "woocommerce_product_get_price",
  "woocommerce_product_variation_get_price",
  "woocommerce_variation_prices_price",
  "woocommerce_get_variation_prices_hash",
  "wc_delete_product_transients",
  "rgv-promotion/v1",
  "remaining_seconds",
  "manage_woocommerce",
  "_rgv_promotion_percent",
]) {
  assert(engine.includes(expected), `Promotion engine is missing: ${expected}`);
}

assert(proxy.includes("/wp-json/rgv-promotion/v1/current"), "Astro proxy endpoint is missing");
assert(navbar.includes("function PromotionAnnouncement()"), "Promotion countdown is missing");
assert(navbar.includes('fetch("/api/promotion"'), "Promotion countdown is not connected to the proxy");
assert(cartApi.includes("price,regular_price,sale_price"), "Live cart validation must request current prices");
assert(cartContext.includes("hasReconciledPricesRef"), "Persisted cart prices are not reconciled");

console.log(
  "Storewide promotion verification passed (WooCommerce pricing, scheduling, REST countdown, cart reconciliation and HPOS metadata).",
);
