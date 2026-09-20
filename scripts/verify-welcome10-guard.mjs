import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [plugin, readme, checkout, proxy, popup, orbitGuard, packageScript] = await Promise.all([
  read("wordpress-plugin/rgv-welcome10-guard/rgv-welcome10-guard.php"),
  read("wordpress-plugin/rgv-welcome10-guard/readme.txt"),
  read("src/components/checkout/RgvCheckout.jsx"),
  read("src/pages/api/checkout/[action].js"),
  read("src/components/marketing/WelcomeDiscountPopup.astro"),
  read("wordpress-plugin/orbit-relay/includes/class-orbit-relay-coupon-guard.php"),
  read("scripts/package-welcome10-guard.ps1"),
]);

for (const expected of [
  "Plugin Name: RGV WELCOME10 First Order Guard",
  "Version: 1.0.0",
  "DEFAULT_CODES = array( 'WELCOME10' )",
  "woocommerce_coupon_get_usage_limit_per_user",
  "woocommerce_coupon_is_valid",
  "enforce_first_order_eligibility",
  "wc_get_is_paid_statuses()",
  "array( 'refunded' )",
  "'customer_id' => $customer_id",
  "'billing_email' => $email",
  "complianceAcceptance",
  "hash_equals( $expected, $provided )",
  "custom_order_tables",
  "FIRST_ORDER_MESSAGE",
]) assert(plugin.includes(expected), `Standalone WELCOME10 guard is missing: ${expected}`);

assert(readme.includes("first WooCommerce purchase"), "Standalone plugin documentation must state the first-purchase rule");
assert(checkout.includes('return "/api/checkout/coupon-validate"'), "Checkout coupon validation must use the authenticated proxy");
assert(proxy.includes('"coupon-validate": "/wp-json/rgv/v1/validate-coupon"'), "The authenticated coupon proxy route is missing");
assert(popup.includes("10% off your first order"), "Welcome offer UI must explain first-order eligibility");
assert(!orbitGuard.includes("enforce_first_order_eligibility"), "First-order eligibility must not remain coupled to ORBIT Relay");
assert(packageScript.includes("rgv-welcome10-guard-1.0.0.zip"), "Standalone plugin packaging target is incorrect");

console.log("WELCOME10 Guard verification passed (standalone first-order enforcement, authenticated identity, HPOS queries). ");

