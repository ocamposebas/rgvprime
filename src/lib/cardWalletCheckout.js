import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";

const MAX_ITEMS = 50;
const MAX_QUANTITY = 100;
const FREE_SHIPPING_MINIMUM = 200;
const ORDER_PROCESSING_FEE_RATE = 0.03;
const PRIORITY_PROCESSING_FEE_RATE = 0.05;
const ORDER_PROCESSING_FEE_NAME = "Service & Processing";
const PRIORITY_PROCESSING_FEE_NAME = "Priority Processing (within 3 hours)";

const SHIPPING_METHODS = {
  ups_2_day_air: { title: "UPS Shipping", cost: 15, freeShippingEligible: true },
  ups_expedited: { title: "UPS Shipping", cost: 45, freeShippingEligible: false },
  usps_ground_advantage: { title: "USPS Ground", cost: 8, freeShippingEligible: true },
  usps_priority: { title: "USPS Priority Mail", cost: 12, freeShippingEligible: true },
};

function envValue(...keys) {
  for (const key of keys) {
    const value = import.meta.env[key];
    if (value) return String(value).trim();
  }
  return "";
}

function wooBaseUrl() {
  const configured = envValue("WC_API_URL", "PUBLIC_WP_URL", "PUBLIC_WOOCOMMERCE_URL");
  if (!configured) return "";

  const clean = configured.replace(/\/+$/, "");
  if (/\/wp-json\/wc\/v3$/i.test(clean)) return clean;
  if (/\/wp-json$/i.test(clean)) return `${clean}/wc/v3`;
  return `${clean}/wp-json/wc/v3`;
}

function wordpressBaseUrl() {
  const configured = envValue("PUBLIC_WP_URL", "PUBLIC_WOOCOMMERCE_URL", "PUBLIC_WP_SITE_URL");
  if (!configured) return "";
  return configured.replace(/\/+$/, "").replace(/\/wp-json(?:\/wc\/v3)?$/i, "");
}

function checkoutError(message, status = 400, code = "CHECKOUT_ERROR") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function basicAuthorization() {
  const key = envValue("WC_CONSUMER_KEY", "WOOCOMMERCE_CONSUMER_KEY");
  const secret = envValue("WC_CONSUMER_SECRET", "WOOCOMMERCE_CONSUMER_SECRET");
  if (!key || !secret) throw checkoutError("Secure checkout is not configured.", 503, "WC_CONFIGURATION_MISSING");
  return `Basic ${Buffer.from(`${key}:${secret}`, "utf8").toString("base64")}`;
}

async function wooRequest(path, { method = "GET", body, timeoutMs = 15000 } = {}) {
  const baseUrl = wooBaseUrl();
  if (!baseUrl) throw checkoutError("Secure checkout is not configured.", 503, "WC_CONFIGURATION_MISSING");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/${String(path).replace(/^\/+/, "")}`, {
      method,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: basicAuthorization(),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw checkoutError("WooCommerce returned an invalid response.", 502, "WC_INVALID_RESPONSE");
    }

    if (!response.ok) {
      throw checkoutError(
        String(data?.message || "WooCommerce could not complete the request."),
        response.status >= 400 && response.status < 600 ? response.status : 502,
        String(data?.code || "WC_REQUEST_FAILED"),
      );
    }

    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw checkoutError("Secure checkout timed out. Please try again.", 504, "WC_TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function cleanText(value, maxLength = 200) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, maxLength);
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 254);
}

function cleanAddress(address = {}) {
  return {
    first_name: cleanText(address.first_name, 80),
    last_name: cleanText(address.last_name, 80),
    company: cleanText(address.company, 120),
    address_1: cleanText(address.address_1, 180),
    address_2: cleanText(address.address_2, 180),
    city: cleanText(address.city, 100),
    state: cleanText(address.state, 20).toUpperCase(),
    postcode: cleanText(address.postcode, 20),
    country: cleanText(address.country || "US", 2).toUpperCase(),
    email: cleanEmail(address.email),
    phone: cleanText(address.phone, 40),
  };
}

function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > MAX_ITEMS) {
    throw checkoutError("No valid cart items were received.");
  }

  return rawItems.map((item) => {
    const productId = Number(item?.product_id || item?.productId || 0);
    const variationId = Number(item?.variation_id || item?.variationId || 0);
    const quantity = Number(item?.quantity || 0);

    if (!Number.isSafeInteger(productId) || productId < 1 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw checkoutError("A cart item is invalid.");
    }
    if (!Number.isSafeInteger(variationId) || variationId < 0) {
      throw checkoutError("A product variation is invalid.");
    }

    return { product_id: productId, variation_id: variationId, quantity };
  });
}

function validateAddress(address, label) {
  const required = ["first_name", "last_name", "address_1", "city", "state", "postcode", "country"];
  if (required.some((field) => !address[field])) throw checkoutError(`Complete the ${label} address.`);
  if (address.country !== "US" || address.state === "PR") {
    throw checkoutError("Shipping to this destination is not available.");
  }
}

function money(value) {
  return (Math.round((Number(value) + Number.EPSILON) * 100) / 100).toFixed(2);
}

function metaValue(order, key) {
  const item = [...(Array.isArray(order?.meta_data) ? order.meta_data : [])]
    .reverse()
    .find((entry) => String(entry?.key || "") === key);
  return String(item?.value ?? "");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function requestKey(value) {
  const clean = cleanText(value, 200);
  if (!clean) throw checkoutError("The checkout attempt identifier is missing.", 400, "REQUEST_ID_MISSING");
  return createHash("sha256").update(clean).digest("hex");
}

async function loadProducts(items) {
  return Promise.all(items.map(async (item) => {
    const path = item.variation_id
      ? `products/${item.product_id}/variations/${item.variation_id}`
      : `products/${item.product_id}`;
    const product = await wooRequest(
      `${path}?_fields=id,parent_id,name,status,purchasable,price,stock_status,stock_quantity,manage_stock,backorders_allowed`,
    );

    if (!product?.id || product.status === "trash" || product.purchasable === false) {
      throw checkoutError(`${cleanText(product?.name || "A product")} is no longer available.`, 409, "PRODUCT_UNAVAILABLE");
    }
    if (item.variation_id && Number(product.parent_id || 0) !== item.product_id) {
      throw checkoutError("A product variation no longer matches its product.", 409, "VARIATION_MISMATCH");
    }
    if (product.backorders_allowed !== true && product.stock_status !== "instock") {
      throw checkoutError(`${cleanText(product.name || "A product")} is sold out.`, 409, "PRODUCT_SOLD_OUT");
    }
    const available = product.stock_quantity === null || product.stock_quantity === undefined
      ? null
      : Math.max(0, Math.floor(Number(product.stock_quantity) || 0));
    if (product.backorders_allowed !== true && available !== null && item.quantity > available) {
      throw checkoutError(`There is not enough stock available for ${cleanText(product.name || "a product")}.`, 409, "INSUFFICIENT_STOCK");
    }

    const price = Number(product.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw checkoutError(`${cleanText(product.name || "A product")} does not have a valid price.`, 409, "INVALID_PRICE");
    }

    return { ...item, name: cleanText(product.name, 200), price };
  }));
}

async function validateCoupon(code, products, billingEmail, acceptance) {
  if (!code) return { code: "", discount: 0, freeShipping: false };

  const wpUrl = wordpressBaseUrl();
  const secret = envValue("COMPLIANCE_SIGNING_SECRET", "PORTAL_API_SECRET");
  if (!wpUrl || !secret) throw checkoutError("Coupon validation is not configured.", 503, "COUPON_CONFIGURATION_MISSING");

  const response = await fetch(`${wpUrl}/wp-json/rgv/v1/validate-coupon`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-RGV-Compliance-Secret": secret,
    },
    body: JSON.stringify({
      code,
      coupon: code,
      items: products.map(({ product_id, variation_id, quantity }) => ({ product_id, variation_id, quantity })),
      subtotal: products.reduce((sum, item) => sum + item.price * item.quantity, 0),
      customer_email: billingEmail,
      complianceAcceptance: acceptance,
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success === false || data?.valid === false) {
    throw checkoutError(String(data?.message || "This coupon is not valid for your cart."), 400, "COUPON_INVALID");
  }

  const subtotal = products.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = Math.min(
    subtotal,
    Math.max(0, Number(data?.discount_total ?? data?.discountTotal ?? 0) || 0),
  );
  return {
    code: cleanText(data?.code || code, 80).toUpperCase().replace(/[^A-Z0-9_-]/g, ""),
    discount,
    freeShipping: data?.free_shipping === true || data?.freeShipping === true,
  };
}

async function findExistingOrder(hash, billingEmail) {
  const query = new URLSearchParams({
    search: billingEmail,
    per_page: "30",
    orderby: "date",
    order: "desc",
  });
  const orders = await wooRequest(`orders?${query.toString()}`);
  return (Array.isArray(orders) ? orders : []).find((order) =>
    order?.payment_method === "psc" &&
    cleanEmail(order?.billing?.email) === billingEmail &&
    metaValue(order, "_rgv_checkout_request_key") === hash &&
    !["cancelled", "failed", "refunded", "trash"].includes(String(order?.status || "")),
  ) || null;
}

function paymentUrlForOrder(order) {
  if (order?.payment_url) return String(order.payment_url);
  const wpUrl = wordpressBaseUrl();
  if (!wpUrl || !order?.id || !order?.order_key) return "";
  return `${wpUrl}/checkout/order-pay/${encodeURIComponent(order.id)}/?pay_for_order=true&key=${encodeURIComponent(order.order_key)}`;
}

function formatOrderResponse(order, duplicatePrevented = false) {
  const paymentUrl = paymentUrlForOrder(order);
  if (!paymentUrl) throw checkoutError("Your order was created, but a payment link was not returned. Please contact support before retrying.", 502, "PAYMENT_URL_MISSING");

  return {
    success: true,
    duplicate_prevented: duplicatePrevented,
    payment_url: paymentUrl,
    order: {
      order_id: Number(order.id),
      order_number: String(order.number || order.id),
      order_key: String(order.order_key || ""),
      status: String(order.status || "pending"),
      payment_method: String(order.payment_method || "psc"),
      payment_method_title: "Card & Wallets",
      payment_url: paymentUrl,
      total: String(order.total || "0.00"),
      currency: String(order.currency || "USD"),
      paid: Boolean(order.date_paid),
    },
  };
}

async function ensureComplianceOrderId(order) {
  if (!order?.id || metaValue(order, "_rgv_compliance_order_id") === String(order.id)) {
    return order;
  }

  return wooRequest(`orders/${order.id}`, {
    method: "PUT",
    body: {
      meta_data: [{ key: "_rgv_compliance_order_id", value: String(order.id) }],
    },
  });
}

export async function createCardWalletOrder({ body, acceptance, attemptId }) {
  const items = normalizeItems(body?.items);
  const billing = cleanAddress(body?.billing);
  const shipping = cleanAddress(body?.shipping || body?.billing);
  validateAddress(billing, "billing");
  validateAddress(shipping, "shipping");

  if (!/^\S+@\S+\.\S+$/.test(billing.email)) throw checkoutError("A valid billing email is required.");
  const approvedEmail = cleanEmail(acceptance?.userEmail || acceptance?.email);
  if (!approvedEmail || billing.email !== approvedEmail) {
    throw checkoutError("Use the email address from your signed-in account.", 403, "ACCOUNT_EMAIL_MISMATCH");
  }

  const hash = requestKey(attemptId || body?.requestId || body?.request_id);
  const existing = await findExistingOrder(hash, billing.email);
  if (existing) return formatOrderResponse(await ensureComplianceOrderId(existing), true);

  const products = await loadProducts(items);
  const subtotal = products.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const rawCoupon = cleanText(body?.coupon || body?.couponCode, 80).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  const coupon = await validateCoupon(rawCoupon, products, billing.email, acceptance);
  const requestedShipping = cleanText(
    body?.shippingMethod || body?.shipping_method || body?.shippingMethodId || body?.shipping_method_id,
    80,
  );
  const method = SHIPPING_METHODS[requestedShipping] || SHIPPING_METHODS.usps_ground_advantage;
  const priority = body?.priorityProcessing === true || body?.priority_processing === true;
  const freeShipping = method.freeShippingEligible && (subtotal >= FREE_SHIPPING_MINIMUM || coupon.freeShipping);
  const shippingCost = freeShipping ? 0 : method.cost;
  const feeBase = Math.max(0, subtotal - coupon.discount + shippingCost);
  const processingFee = Number(money(feeBase * ORDER_PROCESSING_FEE_RATE));
  const priorityFee = priority ? Number(money(feeBase * PRIORITY_PROCESSING_FEE_RATE)) : 0;
  const totalQuantity = products.reduce((sum, item) => sum + item.quantity, 0);
  const reviewSignals = [
    ...(products.some((item) => item.quantity >= 5) ? ["five_or_more_of_one_item"] : []),
    ...(totalQuantity >= 10 ? ["high_total_unit_count"] : []),
    ...(billing.postcode && shipping.postcode && billing.postcode !== shipping.postcode ? ["billing_and_shipping_zip_mismatch"] : []),
  ];

  const metaData = [
    { key: "_rgv_payment_source", value: "rgv_custom_checkout_card_wallets" },
    { key: "_rgv_checkout_request_key", value: hash },
    { key: "_rgv_storefront_user", value: String(Number(acceptance?.userId || 0)) },
    { key: "_rgv_priority_processing", value: priority ? "yes" : "no" },
    { key: "_rgv_compliance_policy_version", value: cleanText(acceptance?.policyVersion, 100) },
    { key: "_rgv_compliance_text_version", value: cleanText(acceptance?.textVersion, 100) },
    { key: "_rgv_compliance_initial_accepted_at_utc", value: cleanText(acceptance?.acceptedAt, 80) },
    { key: "_rgv_compliance_final_accepted_at_utc", value: cleanText(acceptance?.finalAcceptedAt, 80) },
    { key: "_rgv_compliance_user_id", value: String(Number(acceptance?.userId || 0)) },
    { key: "_rgv_compliance_user_email", value: approvedEmail },
    { key: "_rgv_compliance_ip", value: cleanText(acceptance?.requestIp || "unknown", 80) },
    { key: "_rgv_age_21_certified", value: "yes" },
    { key: "_rgv_research_use_only_accepted", value: "yes" },
    { key: "_rgv_terms_accepted", value: "yes" },
    ...(reviewSignals.length ? [
      { key: "_rgv_manual_misuse_review_required", value: "yes" },
      { key: "_rgv_manual_misuse_review_signals", value: reviewSignals.join(",") },
    ] : []),
  ];

  const payload = {
    status: "pending",
    customer_id: 0,
    created_via: "rgv_custom_checkout",
    payment_method: "psc",
    payment_method_title: "Card & Wallets",
    set_paid: false,
    billing,
    shipping: { ...shipping, email: undefined, phone: undefined },
    line_items: products.map((item) => ({
      product_id: item.product_id,
      ...(item.variation_id ? { variation_id: item.variation_id } : {}),
      quantity: item.quantity,
      subtotal: money(item.price * item.quantity),
      total: money(item.price * item.quantity),
    })),
    shipping_lines: [{
      method_id: freeShipping ? "free_shipping" : requestedShipping in SHIPPING_METHODS ? requestedShipping : "usps_ground_advantage",
      method_title: freeShipping ? "Free Shipping (Orders Over $200)" : method.title,
      total: money(shippingCost),
    }],
    fee_lines: [
      ...(processingFee > 0 ? [{ name: ORDER_PROCESSING_FEE_NAME, tax_status: "none", total: money(processingFee) }] : []),
      ...(priorityFee > 0 ? [{ name: PRIORITY_PROCESSING_FEE_NAME, tax_status: "none", total: money(priorityFee) }] : []),
    ],
    coupon_lines: coupon.code && coupon.discount > 0
      ? [{ code: coupon.code, discount: money(coupon.discount) }]
      : [],
    meta_data: metaData,
  };

  let order;
  try {
    order = await wooRequest("orders", { method: "POST", body: payload, timeoutMs: 25000 });
  } catch (error) {
    const duplicate = await findExistingOrder(hash, billing.email).catch(() => null);
    if (duplicate) return formatOrderResponse(await ensureComplianceOrderId(duplicate), true);
    throw error;
  }

  order = await ensureComplianceOrderId(order);

  if (reviewSignals.length && order?.id) {
    await wooRequest(`orders/${order.id}/notes`, {
      method: "POST",
      body: {
        note: `Manual misuse review required before fulfillment. Signals: ${reviewSignals.join(", ")}. Cancel the order if qualified research use cannot be established.`,
        customer_note: false,
      },
    }).catch(() => null);
  }

  return formatOrderResponse(order, false);
}

function orderBelongsToUser(order, approvedUser) {
  const approvedId = String(Number(approvedUser?.id || approvedUser?.user_id || 0));
  const approvedEmail = cleanEmail(approvedUser?.email);
  const orderUser = metaValue(order, "_rgv_storefront_user");
  const orderEmail = cleanEmail(order?.billing?.email);
  return Boolean(
    (approvedId !== "0" && orderUser === approvedId) ||
    (approvedEmail && orderEmail === approvedEmail),
  );
}

export async function getCardWalletOrderStatus({ orderId, orderKey, approvedUser }) {
  const id = Number(orderId);
  if (!Number.isSafeInteger(id) || id < 1 || !orderKey) {
    throw checkoutError("The order reference is invalid.", 400, "INVALID_ORDER_REFERENCE");
  }

  const order = await wooRequest(`orders/${id}`);
  if (
    order?.payment_method !== "psc" ||
    !safeEqual(order?.order_key, orderKey) ||
    !orderBelongsToUser(order, approvedUser)
  ) {
    throw checkoutError("This order could not be verified.", 403, "ORDER_NOT_AUTHORIZED");
  }

  const status = String(order.status || "pending").toLowerCase();
  const paid = Boolean(order.date_paid || order.date_paid_gmt || ["processing", "completed"].includes(status));
  const lifecycle = paid
    ? "confirmed"
    : ["cancelled", "refunded"].includes(status)
      ? "cancelled"
      : status === "failed"
        ? "failed"
        : "pending";

  return {
    success: true,
    lifecycle,
    paid,
    orderId: Number(order.id),
    orderNumber: String(order.number || order.id),
    orderStatus: status,
    paymentMethod: "card_wallets",
    total: String(order.total || "0.00"),
    currency: String(order.currency || "USD"),
    message: lifecycle === "confirmed"
      ? "Your payment was confirmed and the order is being processed."
      : lifecycle === "pending"
        ? "Payment has not been confirmed yet. Your cart has been preserved."
        : "This payment was not completed. Your cart has been preserved.",
  };
}

function normalizeAccountOrder(order) {
  return {
    id: Number(order.id),
    order_id: Number(order.id),
    number: String(order.number || order.id),
    order_number: String(order.number || order.id),
    order_key: String(order.order_key || ""),
    date: String(order.date_created || order.date_created_gmt || ""),
    date_created: String(order.date_created || ""),
    status: String(order.status || "pending"),
    currency: String(order.currency || "USD"),
    total: String(order.total || "0.00"),
    payment_method: "psc",
    payment_method_title: "Card & Wallets",
    billing: order.billing || {},
    shipping: order.shipping || {},
    items: (Array.isArray(order.line_items) ? order.line_items : []).map((item) => ({
      id: Number(item.id || 0),
      name: cleanText(item.name, 200),
      quantity: Number(item.quantity || 0),
      total: String(item.total || "0.00"),
      product_id: Number(item.product_id || 0),
      variation_id: Number(item.variation_id || 0),
    })),
  };
}

export async function listCardWalletOrdersForUser(user) {
  const email = cleanEmail(user?.email);
  if (!email) return [];

  const query = new URLSearchParams({ search: email, per_page: "50", orderby: "date", order: "desc" });
  const orders = await wooRequest(`orders?${query.toString()}`);
  return (Array.isArray(orders) ? orders : [])
    .filter((order) => order?.payment_method === "psc" && orderBelongsToUser(order, user))
    .map(normalizeAccountOrder);
}
