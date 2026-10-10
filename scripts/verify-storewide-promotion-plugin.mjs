import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [main, engine, proxy, navbar, navbarCss, nativeCss, adminJs, cartApi, cartContext] = await Promise.all([
  read("wordpress-plugin/rgv-storewide-promotion/rgv-storewide-promotion.php"),
  read("wordpress-plugin/rgv-storewide-promotion/includes/class-rgv-storewide-promotion.php"),
  read("src/pages/api/promotion.js"),
  read("src/components/nav/Navbar.jsx"),
  read("src/components/nav/Navbar.css"),
  read("wordpress-plugin/rgv-storewide-promotion/assets/frontend.css"),
  read("wordpress-plugin/rgv-storewide-promotion/assets/admin.js"),
  read("src/pages/api/cart/validate-stock.js"),
  read("src/components/cart/CartContext.jsx"),
]);

for (const expected of [
  "Plugin Name: RGV Ofertas y Anuncios",
  "Version: 1.3.0",
  "Requires Plugins: woocommerce",
  "declare_compatibility( 'custom_order_tables'",
]) {
  assert(main.includes(expected), `Plugin bootstrap is missing: ${expected}`);
}

for (const expected of [
  "woocommerce_product_get_price",
  "woocommerce_product_variation_get_price",
  "woocommerce_product_get_sale_price",
  "woocommerce_variation_prices_price",
  "woocommerce_get_variation_prices_hash",
  "wc_delete_product_transients",
  "rgv-promotion/v1",
  "remaining_seconds",
  "manage_woocommerce",
  "_rgv_promotion_percent",
  "_rgv_promotion_product_id",
  "product_matches_campaign",
  "wc_get_products",
  "campaign_cta_url",
  "is_discount_campaign",
  "show_countdown",
]) {
  assert(engine.includes(expected), `Promotion engine is missing: ${expected}`);
}

assert(proxy.includes("/wp-json/rgv-promotion/v1/current"), "Astro proxy endpoint is missing");
assert(proxy.includes('scope: payload?.scope === "product"'), "Promotion scope is not exposed to the storefront");
assert(proxy.includes("product_id:"), "Selected promotion product is not exposed to the storefront");
assert(adminJs.includes('scope !== "product"'), "Product targeting control is not wired up");
assert(adminJs.includes('scope === "announcement"'), "Informational announcement control is not wired up");
assert(engine.includes('value="announcement"'), "Informational announcement mode is missing");
assert(engine.includes('name="product_id"'), "Reliable native product selector is missing");
assert(!engine.includes("wc-product-search"), "Broken AJAX product selector is still present");
assert(navbar.includes("const hasCountdown"), "Optional storefront countdown is missing");
assert(navbar.includes("const hasCta"), "Optional storefront button is missing");
assert(navbar.includes("function PromotionAnnouncement()"), "Promotion countdown is missing");
assert(navbar.includes('fetch("/api/promotion"'), "Promotion countdown is not connected to the proxy");
assert(navbar.includes("<strong>{campaign.headline}</strong>"), "Promotion headline must remain prominent");
assert(navbarCss.includes("--rgv-announcement-height: 64px"), "Storefront campaign banner height is missing");
assert(nativeCss.includes("min-height: 64px"), "Native WordPress campaign banner layout is missing");
assert(cartApi.includes("price,regular_price,sale_price"), "Live cart validation must request current prices");
assert(cartContext.includes("hasReconciledPricesRef"), "Persisted cart prices are not reconciled");

console.log(
  "Promotion verification passed (informational banners, native product selection, targeted pricing, optional countdown and storefront rendering).",
);
