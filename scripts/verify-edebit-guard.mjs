import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [checkout, proxy, plugin] = await Promise.all([
  read("src/components/checkout/RgvCheckout.jsx"),
  read("src/pages/api/checkout/[action].js"),
  read("wordpress-plugin/rgv-edebit-guard/rgv-edebit-guard.php"),
]);

assert(checkout.includes('useState("")'), "eDebit must not be selected by default");
assert(checkout.includes("Ready to connect your bank?"), "eDebit confirmation dialog is missing");
assert(checkout.includes("Continue order #"), "pending eDebit resume control is missing");
assert(checkout.includes("getEdebitStatusEndpoint"), "server-authoritative eDebit status verification is missing");
assert(checkout.includes("checkoutAttemptId: edebitCheckoutAttemptIdRef.current"), "eDebit attempt identifier is missing");
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

console.log("eDebit Guard verification passed (explicit choice, confirmation, reuse, authoritative status, safe expiry). ");
