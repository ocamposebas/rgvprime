import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

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
  cardReturnPlugin,
  cardReturnScript,
  cardWalletStabilityPlugin,
  cardWalletBackend,
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
  read("wordpress-plugin/rgv-prism-checkout/rgv-prism-checkout.php"),
  read("wordpress-plugin/rgv-prism-checkout/assets/js/order-pay.js"),
  read("wordpress-plugin/rgv-card-wallet-stability/rgv-card-wallet-stability.php"),
  read("src/lib/cardWalletCheckout.js"),
  read("wordpress-plugin/orbit-relay/includes/class-orbit-relay-card-checkout.php"),
  read("wordpress-plugin/orbit-relay/includes/class-orbit-relay-hosted-checkout.php"),
  read("wordpress-plugin/orbit-relay/includes/class-orbit-relay-hosted-secret-store.php"),
  read("wordpress-plugin/orbit-relay/includes/class-orbit-relay-admin.php"),
]);

for (const method of ['id: "card_wallets"', 'id: "orbit_secure"', 'id: "edebit"', 'id: "zelle"']) {
  assert(checkout.includes(method), `Checkout payment method is missing: ${method}`);
}

assert(checkout.includes('const ORBIT_PAYMENT_MODE = "disabled"'), "ORBIT card payments must stay hidden while temporarily disabled");
assert(checkout.includes("const ZELLE_PAYMENT_VISIBLE = true"), "Zelle must be visible");
assert(proxy.includes('"zelle-order": "/wp-json/rgv/v1/manual-zelle-order"'), "The protected Zelle route is missing");
assert(proxy.includes('action === "card-wallet-order"') && proxy.includes("createCardWalletOrder"), "The protected card and wallet route is missing");
assert(proxy.includes('action !== "card-wallet-pay"') && proxy.includes("getCardWalletPaymentRedirect"), "The authenticated card and wallet payment redirect is missing");
assert(checkout.includes('const ORBIT_HOSTED_CHECKOUT_VISIBLE = ORBIT_PAYMENT_MODE === "hosted"'), "Hosted checkout must remain available behind the mode switch");
assert(checkout.includes('useState("edebit")'), "The existing eDebit default must remain unchanged");
assert(checkout.includes('description: ORBIT_EMBEDDED_CHECKOUT_VISIBLE ? "Credit or debit card"'), "The Wompi option must use concise card copy");
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
  "https://wompijs.wompi.com/libs/js/v1.js",
  "sessionId",
  "deviceID",
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
  "'session_id'",
  "'device_id'",
  "hash('sha256', $reference . $amount_cop_cents . 'COP' . $settings['integrity_secret'])",
  "$processor_submitted = true",
  "Do not retry it yet",
  "verificationRequired",
  "transaction.updated",
  "x-event-checksum",
  "payment_complete",
]) assert(embeddedPlugin.includes(expected), `Embedded ORBIT payment plugin is missing: ${expected}`);
for (const forbidden of ["'is_three_ds' => true", "three_ds_auth_type", "three_ds_method_data", "browser_info"]) {
  assert(!embeddedPlugin.includes(forbidden), `Embedded ORBIT backend must not request or relay 3D Secure data: ${forbidden}`);
}
for (const forbidden of ["<iframe", "threeDs", "browser_color_depth", "browser_user_agent"]) {
  assert(!cardForm.includes(forbidden), `Embedded ORBIT form must not open or render card-authentication UI: ${forbidden}`);
}
for (const forbidden of ["Installments", "Number of installments", "LockKeyhole", "Wompi processes the charge in COP"]) {
  assert(!cardForm.includes(forbidden), `Embedded ORBIT form must omit removed payment UI: ${forbidden}`);
}
assert(embeddedPlugin.includes("'installments' => 1"), "Wompi card payments must be submitted as one payment");
assert(!embeddedPlugin.includes("$data['installments']"), "The backend must not accept installment selection from the browser");
assert(embeddedPlugin.includes("round($total_usd * $settings['cop_per_usd'], 0, PHP_ROUND_HALF_UP) * 100"), "The USD conversion must round to a whole COP before creating minor units");
assert(embeddedPlugin.includes("$amount_cop_cents % 100 !== 0"), "The backend must reject fractional-peso card amounts before calling Wompi");
assert(!cardForm.includes('setNumber("")'), "A recoverable processor error must not force the customer to re-enter the card number");
assert(checkout.includes("attempt < 20") && checkout.includes("window.setTimeout(resolve, 1500)"), "Standard card status polling must remain bounded");
assert(embeddedPlugin.includes("getenv($environment_name)") && embeddedPlugin.includes("$_ENV[$environment_name]") && embeddedPlugin.includes("$_SERVER[$environment_name]"), "WordPress must read processor credentials from environment variables");
assert(embeddedPlugin.includes("www.datos.gov.co/resource/mcec-87by.json") && embeddedPlugin.includes("superfinanciera_trm"), "The plugin must obtain the official current TRM automatically");
assert(embeddedPlugin.includes("6 * HOUR_IN_SECONDS") && embeddedPlugin.includes("3 * DAY_IN_SECONDS"), "The official TRM must use bounded caching and a recent fallback");
assert(!zellePlugin.includes("orbit-card-order") && !zellePlugin.includes("RGV_WOMPI_PRIVATE_KEY"), "The Zelle plugin must remain isolated from card processing");
assert(!zellePlugin.includes("'/prism-order'") && !zellePlugin.includes("set_payment_method('psc')"), "PRISM must remain isolated from the Zelle plugin");
assert(!checkout.includes("PRISM") && !checkout.includes("Prism") && !checkout.includes("prism"), "The customer-facing storefront must not name the underlying provider");
for (const expected of [
  "Plugin Name: RGV Storefront Card & Wallet Return",
  "woocommerce_gateway_title",
  "Secure card payment",
  "woocommerce_thankyou",
  "allow_bearer_payment_session",
  "woocommerce_order_get_customer_id",
  "payment_request_order_id",
  "payment_request_order_key",
  "return (int) get_current_user_id()",
  "hash_equals",
  "woocommerce_available_payment_gateways",
  "restrict_public_wordpress_navigation",
  "is_storefront_receipt_request",
  "rgv-card-wallet-thankyou-page",
  "logo.webp",
  "Go to my account",
  "Back to store",
  "5000",
  "wp_doing_ajax",
  "REST_REQUEST",
  "wc-api",
  "wc-ajax",
  "rgv_reconcile_storefront_payment",
  "schedule_pending_payment_reconciliation",
  "reconcile_storefront_payment",
  "reconcile_order($order)",
  "$queued_attempt <= 20",
  "isolate_payment_order_session",
  "rgv_release_failed_payment",
  "release_failed_payment",
  "Detached stale checkout state",
]) assert(cardReturnPlugin.includes(expected), `Card and wallet return handling is missing: ${expected}`);
assert(!cardReturnPlugin.includes("add_filter('user_has_cap'"), "Card payment access must not duplicate WooCommerce's pay_for_order capability lookup");
assert(!cardReturnPlugin.includes("allow_storefront_payment_link"), "The recursive pay_for_order capability shim must remain removed");
assert(!cardReturnPlugin.toLowerCase().includes("zelle"), "The branded card checkout shell must remain isolated from Zelle");
for (const expected of [
  "paymentMethodTypes: ['card', 'us_bank_account']",
  "__rgvCardOnlyFactoryV2",
  "__rgvCardOnlyRuntimeReady",
  "__rgvGestureSubmitCaptureInstalled",
  "__rgvBeginGestureSubmit",
  "paymentMethodOrder: ['applePay', 'googlePay', 'link']",
  "wallets: { applePay: 'never', googlePay: 'never', link: 'never' }",
  "buttonHeight: 50",
  "rgv-quick-pay__divider",
  "managePendingConfirmation",
  "startPendingStatusPolling",
  "recoveryMatchesCurrentOrder",
  "currentPaymentRecovery",
  "releaseFailedPayment",
  "psc_poll_payment",
  "rgv_release_failed_payment",
  "#psc-payment-message-footer",
  "Verifying this payment\\u2026 This page will update automatically.",
  "manageVerificationRefresh",
  "managePaymentFeedback",
  "rgv-payment-inline-notice",
  "Payment cancelled \\u2014 nothing was charged",
  "Nothing was charged",
  "Never reload the entire checkout as a recovery fallback",
]) assert(cardReturnScript.includes(expected), `The hosted payment surface is missing an approved method configuration: ${expected}`);
assert(!cardReturnScript.includes("window.location.reload()"), "Pending payment recovery must never create a full-page reload loop");
assert(cardReturnPlugin.includes("__rgvGestureSubmitCaptureInstalled") && cardReturnPlugin.includes("__rgvBeginGestureSubmit"), "The early provider guard must preserve Apple Pay's trusted submit gesture");
assert(cardReturnPlugin.includes("__rgvFreshAttemptFactory") && cardReturnPlugin.includes("markAttemptForRevalidation"), "Every payment submission must revalidate its provider attempt against the current research record");

const earlyGuardMatch = cardReturnPlugin.match(/\$card_only_script = <<<'JS'\r?\n([\s\S]*?)\r?\nJS;/);
assert(earlyGuardMatch, "The early checkout guard must remain embedded before the provider initializes");
const freshAttemptCalls = [];
const earlyGuardSandbox = {
  document: { addEventListener() {} },
  setInterval(callback) { callback(); return 1; },
  clearInterval() {},
};
earlyGuardSandbox.window = earlyGuardSandbox;
earlyGuardSandbox.Stripe = function Stripe() { return { elements() { return { create() { return {}; }, submit() { return Promise.resolve({}); } }; } }; };
earlyGuardSandbox.PSCCheckoutController = {
  paymentElementOptions() { return {}; },
  expressCheckoutOptions() { return {}; },
  createController() {
    return {
      markAttemptForRevalidation() { freshAttemptCalls.push("revalidate"); },
      paymentData() { freshAttemptCalls.push("paymentData"); return Promise.resolve({}); },
    };
  },
};
vm.runInNewContext(earlyGuardMatch[1], earlyGuardSandbox);
const freshController = earlyGuardSandbox.PSCCheckoutController.createController({});
await freshController.paymentData("payment");
assert.deepEqual(freshAttemptCalls, ["revalidate", "paymentData"], "The current research record must be revalidated immediately before payment data is created");

const cardOnlyCapture = {};
const cardOnlySandbox = {
  document: { readyState: "loading", addEventListener() {} },
  setInterval() { throw new Error("The card-only guard should patch Stripe synchronously."); },
  clearInterval() {},
};
cardOnlySandbox.window = cardOnlySandbox;
cardOnlySandbox.window.PSCCheckoutController = {
  paymentElementOptions() { return { fields: { billingDetails: "never" } }; },
};
cardOnlySandbox.window.Stripe = function Stripe() {
  const elements = {};
  Object.defineProperty(elements, "submit", {
    get() {
      return function submit() {
        cardOnlyCapture.submitCalls = (cardOnlyCapture.submitCalls || 0) + 1;
        return Promise.resolve({});
      };
    },
  });
  Object.defineProperty(elements, "create", {
    get() {
      return function create(type, optionsForElement) {
        cardOnlyCapture.elementsByType ||= {};
        cardOnlyCapture.elementsByType[type] = { type, options: optionsForElement };
        return { type };
      };
    },
  });
  const stripeClient = {};
  Object.defineProperty(stripeClient, "elements", {
    get() {
      return function elementsFactory(options) {
      cardOnlyCapture.elements = options;
        return elements;
      };
    },
  });
  return stripeClient;
};
vm.runInNewContext(cardReturnScript, cardOnlySandbox);
const guardedClient = cardOnlySandbox.window.Stripe("pk_test_checkout");
const guardedElements = guardedClient.elements({ mode: "payment" });
guardedElements.create("payment", {});
guardedElements.create("expressCheckout", {});
const gestureSubmit = guardedElements.__rgvBeginGestureSubmit();
const providerSubmit = guardedElements.submit();
assert.strictEqual(providerSubmit, gestureSubmit, "The provider must consume the submit promise started by the trusted checkout gesture");
await providerSubmit;
assert.equal(cardOnlyCapture.submitCalls, 1, "Apple Pay submit must run once for the gesture/provider handoff");
await guardedElements.submit();
assert.equal(cardOnlyCapture.submitCalls, 2, "A later independent payment attempt must call Stripe submit again");
assert.equal(JSON.stringify(cardOnlyCapture.elements.paymentMethodTypes), '["card","us_bank_account"]', "Stripe Elements must receive card and US bank account methods; Link stays in Express Checkout");
assert.equal(JSON.stringify(cardOnlyCapture.elementsByType.payment.options.paymentMethodOrder), '["card","us_bank_account"]', "The mounted Payment Element must order card before US bank account");
assert.equal(cardOnlyCapture.elementsByType.payment.options.wallets.applePay, 'never', "Apple Pay must not be duplicated inside the manual Payment Element");
assert.equal(cardOnlyCapture.elementsByType.payment.options.wallets.googlePay, 'never', "Google Pay must not be duplicated inside the manual Payment Element");
assert.equal(cardOnlyCapture.elementsByType.payment.options.wallets.link, 'never', "Link must not be duplicated inside the manual Payment Element");
assert.equal(JSON.stringify(cardOnlyCapture.elementsByType.expressCheckout.options.paymentMethodOrder), '["applePay","googlePay","link"]', "Express Checkout must prioritize Apple Pay, Google Pay, then Link");
assert.equal(cardOnlyCapture.elementsByType.expressCheckout.options.buttonHeight, 50, "Express wallet buttons must use the premium 50px height");
assert.equal(cardOnlyCapture.elementsByType.expressCheckout.options.layout.maxColumns, 2, "Express wallets must render in a two-column row when possible");
assert.equal(cardOnlyCapture.elementsByType.expressCheckout.options.paymentMethods.applePay, 'auto', "Apple Pay must be eligible on supported devices");
assert.equal(cardOnlyCapture.elementsByType.expressCheckout.options.paymentMethods.googlePay, 'auto', "Google Pay must be eligible on supported devices");
assert.equal(cardOnlyCapture.elementsByType.expressCheckout.options.paymentMethods.link, 'auto', "Link must be available as the wallet fallback");
for (const expected of [
  "Plugin Name: RGV Card & Wallet Payment Stability",
  "is_card_wallet_payment_submission",
  "guard_recursive_order_snippets",
  "woocommerce_update_order",
  "snippet-ops.php",
  "suppressed_recursive_callbacks",
]) assert(cardWalletStabilityPlugin.includes(expected), `Card payment stability guard is missing: ${expected}`);
assert(!cardWalletStabilityPlugin.includes("zelle"), "The card payment stability guard must remain isolated from Zelle");
for (const expected of [
  'payment_method: "psc"',
  'payment_method_title: "Card & Wallets"',
  'customer_id: 0',
  "_rgv_storefront_user",
  'status: "pending"',
  "set_paid: false",
  "paymentUrlForOrder",
  "getCardWalletPaymentRedirect",
  "getCardWalletOrderStatus",
]) assert(cardWalletBackend.includes(expected), `Card and wallet order handoff is missing: ${expected}`);
assert(checkout.includes("getCardWalletPaymentRedirectEndpoint") && checkout.includes('handoffUrl.searchParams.set("order_id"'), "Card and wallet checkout must use the authenticated canonical payment redirect");

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

console.log("Payment verification passed (card/wallet handoff and Zelle enabled; ORBIT card implementation retained but hidden).");
