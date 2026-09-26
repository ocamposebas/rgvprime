import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [checkout, proxy, plugin] = await Promise.all([
  read("src/components/checkout/RgvCheckout.jsx"),
  read("src/pages/api/checkout/[action].js"),
  read("wordpress-plugin/rgv-edebit-guard/rgv-edebit-guard.php"),
]);

assert(checkout.includes('useState("card_wallets")'), "The PRISM-backed Card & Wallets route must be the default payment method");
assert(!checkout.includes('useState("edebit")'), "eDebit must not be preselected");
assert(!checkout.includes("Ready to connect your bank?"), "eDebit must not be blocked by a confirmation dialog");
assert(checkout.includes("void continueWithEdebit()"), "eDebit must continue directly from the checkout button");
assert(checkout.includes("activeAttempt?.fingerprint === edebitAttemptFingerprint"), "pending eDebit reuse protection is missing");
assert(checkout.includes("edebitFlowSubmittingRef.current || loading"), "direct eDebit double-submit protection is missing");
assert(checkout.includes("getEdebitStatusEndpoint"), "server-authoritative eDebit status verification is missing");
assert(checkout.includes("checkoutAttemptId: edebitCheckoutAttemptIdRef.current"), "eDebit attempt identifier is missing");
assert(checkout.includes('fetch("/api/account/redeem-points"'), "checkout points redemption is missing");
assert(proxy.includes('"edebit-status": "/wp-json/rgv-edebit/v1/order-status"'), "status proxy route is missing");
assert(proxy.includes('"edebit-cancel": "/wp-json/rgv-edebit/v1/cancel-pending"'), "cancel proxy route is missing");

for (const expected of [
  "edd_draft_yodlee_gateway",
  "rgv_edebit_guard_expire_order",
  "Incomplete eDebit payment expired automatically after 60 minutes.",
  "woocommerce_email_enabled_cancelled_order",
  "manage_woocommerce_page_wc-orders_columns",
  "Awaiting customer",
  "custom_order_tables",
  "paymentConfirmed",
]) assert(plugin.includes(expected), `eDebit Guard is missing: ${expected}`);

for (const forbidden of [
  "EDEBIT_DISCOUNT_RATE",
  "edebitSavings",
  "edebitDiscount",
  "edebit_discount",
  "Save 5% with eDebit",
  "eDebit savings (5%)",
]) assert(!checkout.includes(forbidden), `The storefront still contains removed eDebit discount logic: ${forbidden}`);

for (const forbidden of [
  "DISCOUNT_RATE",
  "maybe_apply_discount",
  "_rgv_edebit_discount",
  "eDebit savings (5%)",
]) assert(!plugin.includes(forbidden), `The eDebit Guard still contains removed discount logic: ${forbidden}`);

console.log("eDebit Guard verification passed (Card & Wallets default, no eDebit discount, direct checkout, reuse, authoritative status, safe expiry). ");
