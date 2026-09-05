import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [checkout, cardForm, proxy, configProxy, statusProxy, wordpress, zelle] = await Promise.all([
  read("src/components/checkout/RgvCheckout.jsx"),
  read("src/components/checkout/OrbitSecureCardPayment.jsx"),
  read("src/pages/api/checkout/[action].js"),
  read("src/pages/api/checkout/orbit-card-config.js"),
  read("src/pages/api/checkout/orbit-card-status.js"),
  read("wordpress-plugin/rgv-orbit-card-checkout/rgv-orbit-card-checkout.php"),
  read("wordpress-plugin/rgv-zelle-checkout/rgv-zelle-checkout.php"),
]);

for (const method of ['id: "orbit_secure"', 'id: "edebit"', 'id: "zelle"']) {
  assert(checkout.includes(method), `Checkout payment method is missing: ${method}`);
}
assert(checkout.includes("const LEGACY_ORBIT_CARD_CHECKOUT_VISIBLE = false"), "The legacy ORBIT/Stripe form must remain hidden");
assert(checkout.includes("WOMPI_CARD_MAX_ORDER_USD_CENTS = 15000"), "The embedded ORBIT card form must have a $150 USD visibility limit");
assert(checkout.includes('method.id !== "orbit_secure" || wompiCardAvailable'), "The ORBIT card option must be hidden above its order limit");
assert(checkout.includes('badge: "ORBIT"'), "The visible card method must use the ORBIT brand");
assert(!checkout.includes('badge: "Wompi"'), "Wompi must not appear as the visible card brand");
assert(cardForm.includes("cardToken") && checkout.includes("...secureCard"), "The secure card token must enter the protected order request");
assert(!checkout.includes("secureCard.cvc") && !checkout.includes("secureCard.number"), "Raw card fields must not enter the order request");

for (const expected of [
  'alg: "RSA-OAEP-256"',
  'enc: "A256GCM"',
  '`${config.baseUrl}/tokens/cards`',
  "JSON.stringify({ payload })",
  'autoComplete="cc-number" inputMode="numeric"',
  'autoComplete="cc-csc" inputMode="numeric" type="password"',
]) assert(cardForm.includes(expected), `Secure embedded card form is missing: ${expected}`);

for (const forbidden of ["RGV_WOMPI_PRIVATE_KEY", "WOMPI_PRIVATE_KEY", "RGV_WOMPI_INTEGRITY_SECRET", "RGV_WOMPI_EVENTS_SECRET"]) {
  assert(!cardForm.includes(forbidden), `A processor secret leaked into the browser component: ${forbidden}`);
  assert(!checkout.includes(forbidden), `A processor secret leaked into checkout: ${forbidden}`);
}

assert(proxy.includes('"orbit-card-order": "/wp-json/rgv/v1/orbit-card-order"'), "Protected ORBIT order proxy is missing");
assert(configProxy.includes("/wp-json/rgv/v1/orbit-card-config"), "ORBIT public configuration proxy is missing");
assert(statusProxy.includes("requireApprovedSession(context)"), "ORBIT status checks must require an approved session");
assert(statusProxy.includes("X-RGV-Compliance-Secret"), "ORBIT status checks must authenticate to WordPress");

for (const expected of [
  "Plugin Name: RGV ORBIT Card Checkout",
  "RGV_WOMPI_PRIVATE_KEY",
  "RGV_WOMPI_INTEGRITY_SECRET",
  "RGV_WOMPI_EVENTS_SECRET",
  "RGV_WOMPI_COP_PER_USD",
  "'/tokens/keys/tokenization'",
  "'/transactions'",
  "'payment_method_type' => 'CARD'",
  "'currency' => 'COP'",
  "'accept_personal_auth'",
  "MAX_CARD_ORDER_USD_CENTS = 15000",
  "hash('sha256', $reference . $amount_cop_cents . 'COP' . $settings['integrity_secret'])",
  "verificationRequired",
  "transaction.updated",
  "x-event-checksum",
]) assert(wordpress.includes(expected), `Standalone ORBIT card plugin is missing: ${expected}`);

assert(wordpress.includes("$processor_submitted = true"), "Processor submission state must be tracked for uncertain responses");
assert(wordpress.includes("Do not retry it yet"), "Uncertain responses must block blind retries");
assert(wordpress.includes("getenv($environment_name)") && wordpress.includes("$_ENV[$environment_name]") && wordpress.includes("$_SERVER[$environment_name]"), "WordPress must read processor credentials from environment variables");
assert(wordpress.includes("www.datos.gov.co/resource/mcec-87by.json") && wordpress.includes("superfinanciera_trm"), "The plugin must obtain the official current TRM automatically");
assert(wordpress.includes("6 * HOUR_IN_SECONDS") && wordpress.includes("3 * DAY_IN_SECONDS"), "The official TRM must use bounded caching and a recent fallback");
assert(!zelle.includes("wompi-card-order") && !zelle.includes("RGV_WOMPI_PRIVATE_KEY"), "The Zelle plugin must not contain the card processor integration");

console.log("ORBIT card checkout verification passed (standalone plugin, embedded tokenization, protected APIs, webhooks, and retry safety).");
