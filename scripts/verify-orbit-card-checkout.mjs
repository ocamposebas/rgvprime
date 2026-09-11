import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [
  checkout,
  cardForm,
  proxy,
  configProxy,
  statusProxy,
  embeddedPlugin,
  zellePlugin,
  relay,
  hosted,
  hostedSecret,
  admin,
] = await Promise.all([
  read("src/components/checkout/RgvCheckout.jsx"),
  read("src/components/checkout/OrbitSecureCardPayment.jsx"),
  read("src/pages/api/checkout/[action].js"),
  read("src/pages/api/checkout/orbit-card-config.js"),
  read("src/pages/api/checkout/orbit-card-status.js"),
  read("wordpress-plugin/rgv-orbit-card-checkout/rgv-orbit-card-checkout.php"),
  read("wordpress-plugin/rgv-zelle-checkout/rgv-zelle-checkout.php"),
  read("wordpress-plugin/orbit-relay/includes/class-orbit-relay-card-checkout.php"),
  read("wordpress-plugin/orbit-relay/includes/class-orbit-relay-hosted-checkout.php"),
  read("wordpress-plugin/orbit-relay/includes/class-orbit-relay-hosted-secret-store.php"),
  read("wordpress-plugin/orbit-relay/includes/class-orbit-relay-admin.php"),
]);

for (const method of ['id: "orbit_secure"', 'id: "edebit"', 'id: "zelle"']) {
  assert(checkout.includes(method), `Checkout payment method is missing: ${method}`);
}

assert(checkout.includes('const ORBIT_PAYMENT_MODE = "disabled"'), "ORBIT/Wompi must remain hidden until USD processing is selected");
assert(checkout.includes('const ORBIT_HOSTED_CHECKOUT_VISIBLE = ORBIT_PAYMENT_MODE === "hosted"'), "Hosted checkout must remain available behind the mode switch");
assert(checkout.includes('useState("edebit")'), "eDebit must be selected by default while ORBIT/Wompi is hidden");
assert(checkout.includes("ORBIT_PAYMENTS_MAX_ORDER_USD_CENTS = 60000"), "ORBIT Payments must support orders through $600 USD");
assert(checkout.includes("<OrbitSecureCardPayment"), "The embedded ORBIT card form must be mounted");
assert(checkout.includes("...secureCard"), "The tokenized embedded-card result must enter the protected order request");
assert(!checkout.includes("secureCard.cvc") && !checkout.includes("secureCard.number"), "Raw card fields must not enter the order request");
assert(proxy.includes('"orbit-card-order": "/wp-json/rgv/v1/orbit-card-order"'), "Protected embedded-card order proxy is missing");
assert(configProxy.includes("/wp-json/rgv/v1/orbit-card-config"), "Embedded-card public configuration proxy is missing");
assert(statusProxy.includes("requireApprovedSession(context)"), "Embedded-card status checks must require an approved session");
assert(statusProxy.includes("X-RGV-Compliance-Secret"), "Embedded-card status checks must authenticate to WordPress");

for (const expected of [
  'alg: "RSA-OAEP-256"',
  'enc: "A256GCM"',
  '`${config.baseUrl}/tokens/cards`',
  "JSON.stringify({ payload })",
  'autoComplete="cc-number" inputMode="numeric"',
  'autoComplete="cc-csc" inputMode="numeric" type="password"',
  "browser_color_depth",
  "browser_screen_height",
  "browser_screen_width",
  "browser_language",
  "browser_user_agent",
  "browser_tz",
  'srcDoc={threeDsHtml}',
  'sandbox="allow-forms allow-scripts"',
]) assert(cardForm.includes(expected), `Secure embedded card form is missing: ${expected}`);

for (const forbidden of ["RGV_WOMPI_PRIVATE_KEY", "WOMPI_PRIVATE_KEY", "RGV_WOMPI_INTEGRITY_SECRET", "RGV_WOMPI_EVENTS_SECRET"]) {
  assert(!cardForm.includes(forbidden), `A processor secret leaked into the browser component: ${forbidden}`);
  assert(!checkout.includes(forbidden), `A processor secret leaked into checkout: ${forbidden}`);
}

for (const expected of [
  "Plugin Name: RGV ORBIT Payments Checkout",
  "RGV_WOMPI_PRIVATE_KEY",
  "RGV_WOMPI_INTEGRITY_SECRET",
  "RGV_WOMPI_EVENTS_SECRET",
  "RGV_WOMPI_COP_PER_USD",
  "'/tokens/keys/tokenization'",
  "'/transactions'",
  "MAX_CARD_ORDER_USD_CENTS = 60000",
  "'payment_method_type' => 'CARD'",
  "'currency' => 'COP'",
  "'is_three_ds' => true",
  "'browser_info' => $browser_info",
  "'three_ds_auth_type'] = 'challenge_v2'",
  "'three_ds_auth'",
  "'three_ds_method_data'",
  "hash('sha256', $reference . $amount_cop_cents . 'COP' . $settings['integrity_secret'])",
  "$processor_submitted = true",
  "Do not retry it yet",
  "verificationRequired",
  "transaction.updated",
  "x-event-checksum",
  "payment_complete",
]) assert(embeddedPlugin.includes(expected), `Embedded ORBIT payment plugin is missing: ${expected}`);
assert(checkout.includes("attempt < 150") && checkout.includes("window.setTimeout(resolve, 2000)"), "3D Secure status polling must use the documented interval and bounded five-minute window");
assert(embeddedPlugin.includes("getenv($environment_name)") && embeddedPlugin.includes("$_ENV[$environment_name]") && embeddedPlugin.includes("$_SERVER[$environment_name]"), "WordPress must read processor credentials from environment variables");
assert(embeddedPlugin.includes("www.datos.gov.co/resource/mcec-87by.json") && embeddedPlugin.includes("superfinanciera_trm"), "The plugin must obtain the official current TRM automatically");
assert(embeddedPlugin.includes("6 * HOUR_IN_SECONDS") && embeddedPlugin.includes("3 * DAY_IN_SECONDS"), "The official TRM must use bounded caching and a recent fallback");
assert(!zellePlugin.includes("orbit-card-order") && !zellePlugin.includes("RGV_WOMPI_PRIVATE_KEY"), "The Zelle plugin must remain isolated from card processing");

// Keep the hosted implementation ready for a later mode change; it is intentionally inactive today.
assert(checkout.includes("window.location.assign(redirectUrl.toString())"), "The retained hosted flow must redirect only after server approval");
assert(checkout.includes('redirectUrl.protocol !== "https:"'), "The retained hosted flow must reject non-HTTPS URLs");
assert(proxy.includes('"orbit-hosted-status": "/wp-json/orbit/v1/card-hosted-status"'), "Protected hosted-payment status proxy is missing");
assert(relay.includes("ORBIT_Relay_Hosted_Checkout::create_session"), "Relay must retain hosted session creation");
for (const expected of [
  "/v1/woocommerce/installations/exchange",
  "/v1/woocommerce/checkout-sessions",
  "X-Orbit-Installation",
  "payment.succeeded",
  "payment_complete( $payment_id )",
  "storefront_url",
]) assert(hosted.includes(expected), `Retained hosted ORBIT relay is missing: ${expected}`);
assert(hostedSecret.includes("sodium_crypto_secretbox") && hostedSecret.includes("aes-256-gcm"), "Hosted installation secret must remain encrypted at rest");
assert(admin.includes("orbit_relay_connection_code") && admin.includes("Public storefront URL"), "Hosted setup controls must remain available for later use");

console.log("ORBIT payment verification passed (Wompi hidden, 3D Secure implementation retained, eDebit default, hosted mode retained).");
