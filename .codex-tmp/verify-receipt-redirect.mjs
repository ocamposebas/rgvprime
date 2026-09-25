import { loadEnv } from "vite";

const env = loadEnv("production", process.cwd(), "");
const base = String(env.WC_API_URL || env.PUBLIC_WP_URL || env.PUBLIC_WOOCOMMERCE_URL || "https://wp.rgvprimellc.com")
  .replace(/\/wp-json\/wc\/v3\/?$/, "")
  .replace(/\/$/, "");
const consumerKey = env.WC_CONSUMER_KEY || env.WOOCOMMERCE_CONSUMER_KEY;
const consumerSecret = env.WC_CONSUMER_SECRET || env.WOOCOMMERCE_CONSUMER_SECRET;

if (!consumerKey || !consumerSecret) {
  throw new Error("WooCommerce API credentials are not configured locally");
}

const orderResponse = await fetch(`${base}/wp-json/wc/v3/orders/4458`, {
  headers: {
    Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}`,
  },
});

if (!orderResponse.ok) {
  throw new Error(`WooCommerce returned HTTP ${orderResponse.status}`);
}

const order = await orderResponse.json();
if (!order?.id || !order?.order_key) {
  throw new Error("The paid order did not expose the fields required for the redirect check");
}

async function probe(orderKey) {
  return fetch(`${base}/checkout/order-received/${order.id}/?key=${encodeURIComponent(orderKey)}`, {
    method: "HEAD",
    redirect: "manual",
    headers: { "Cache-Control": "no-cache" },
  });
}

const validResponse = await probe(order.order_key);
const validLocation = validResponse.headers.get("location") || "";
const validTarget = validLocation ? new URL(validLocation, base) : null;

const invalidResponse = await probe("wc_order_invalid_verification_key");
const invalidLocation = invalidResponse.headers.get("location") || "";
const invalidTarget = invalidLocation ? new URL(invalidLocation, base) : null;

console.log(JSON.stringify({
  validRequest: {
    status: validResponse.status,
    destinationOrigin: validTarget?.origin || null,
    destinationPath: validTarget?.pathname || null,
    successFlag: validTarget?.searchParams.get("card_payment") === "success",
    orderIdPreserved: validTarget?.searchParams.get("order_id") === String(order.id),
    orderKeyPreserved: validTarget?.searchParams.get("order_key") === String(order.order_key),
  },
  invalidKeyRequest: {
    status: invalidResponse.status,
    redirectedToStorefrontReceipt:
      invalidTarget?.origin === "https://rgvprimellc.com" &&
      invalidTarget?.pathname === "/checkout" &&
      invalidTarget?.searchParams.get("card_payment") === "success",
  },
}, null, 2));
