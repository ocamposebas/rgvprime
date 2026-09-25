import { loadEnv } from "vite";

const env = loadEnv("production", process.cwd(), "");
const base = String(env.WC_API_URL || env.PUBLIC_WP_URL || env.PUBLIC_WOOCOMMERCE_URL || "https://wp.rgvprimellc.com")
  .replace(/\/wp-json\/wc\/v3\/?$/, "")
  .replace(/\/$/, "");
const key = env.WC_CONSUMER_KEY || env.WOOCOMMERCE_CONSUMER_KEY;
const secret = env.WC_CONSUMER_SECRET || env.WOOCOMMERCE_CONSUMER_SECRET;
if (!key || !secret) throw new Error("WooCommerce API credentials are not configured locally");

const response = await fetch(`${base}/wp-json/wc/v3/orders/4458`, {
  headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}` },
});
if (!response.ok) throw new Error(`WooCommerce returned HTTP ${response.status}`);
const order = await response.json();
const meta = new Map((order.meta_data || []).map((entry) => [String(entry.key), entry.value]));

console.log(JSON.stringify({
  id: order.id,
  status: order.status,
  paymentMethod: order.payment_method,
  paymentMethodTitle: order.payment_method_title,
  paymentSource: meta.get("_rgv_payment_source") || null,
  checkoutRequestKeyPresent: Boolean(meta.get("_rgv_checkout_request_key")),
  orderKeyPresent: Boolean(order.order_key),
  datePaid: order.date_paid || null,
  total: order.total,
}, null, 2));
