export const prerender = false;

import {
  checkRateLimit,
  isRequestBodyTooLarge,
  requestSecurityResponse,
} from "../../../lib/requestSecurity";

const NO_CACHE_CONTROL = "no-store, no-cache, must-revalidate, max-age=0";
const MAX_ITEMS = 50;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": NO_CACHE_CONTROL,
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

function getBasicAuthHeader(consumerKey, consumerSecret) {
  return `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}`;
}

async function fetchWooProduct(endpoint, consumerKey, consumerSecret, signal) {
  return fetch(endpoint.toString(), {
    method: "GET",
    cache: "no-store",
    signal,
    headers: {
      Accept: "application/json",
      Authorization: getBasicAuthHeader(consumerKey, consumerSecret),
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });

}

function normalizeItem(item = {}, index = 0) {
  const productId = Number(item.product_id || item.productId || 0);
  const variationId = Number(item.variation_id || item.variationId || 0);
  const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));

  return {
    cart_id: String(item.cart_id || item.id || `${productId}:${variationId || 0}:${index}`),
    name: String(item.name || "Product"),
    product_id: Number.isInteger(productId) && productId > 0 ? productId : 0,
    variation_id:
      Number.isInteger(variationId) && variationId > 0 ? variationId : 0,
    quantity,
  };
}

function getAvailableQuantity(product = {}) {
  if (product.backorders_allowed === true) return null;
  if (product.stock_quantity === null || product.stock_quantity === undefined) {
    return null;
  }

  const quantity = Number(product.stock_quantity);
  return Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : null;
}

function validateProduct(item, product) {
  const name = String(product?.name || item.name || "Product");
  const availableQuantity = getAvailableQuantity(product);
  const base = {
    ...item,
    name,
    price: Number(product?.price || 0),
    regular_price: Number(product?.regular_price || product?.price || 0),
    sale_price:
      product?.sale_price !== null && product?.sale_price !== undefined
        ? Number(product.sale_price || 0)
        : 0,
    stock_status: String(product?.stock_status || "unknown"),
    stock_quantity: availableQuantity,
    backorders_allowed: product?.backorders_allowed === true,
  };

  if (!product || product.status === "trash" || product.purchasable === false) {
    return { ...base, available: false, reason: "unavailable" };
  }

  const inStock =
    product.backorders_allowed === true || product.stock_status === "instock";

  if (!inStock || (availableQuantity !== null && availableQuantity <= 0)) {
    return { ...base, available: false, reason: "sold_out" };
  }

  if (availableQuantity !== null && item.quantity > availableQuantity) {
    return {
      ...base,
      available: true,
      valid: false,
      reason: "insufficient_stock",
      allowed_quantity: availableQuantity,
    };
  }

  return {
    ...base,
    available: true,
    valid: true,
    reason: null,
    allowed_quantity: item.quantity,
  };
}

export async function POST({ request }) {
  if (isRequestBodyTooLarge(request, 64 * 1024)) {
    return requestSecurityResponse("Request is too large.", 413);
  }

  const rate = checkRateLimit(request, {
    namespace: "stock-validation",
    limit: 60,
    windowMs: 60 * 1000,
  });

  if (!rate.allowed) {
    return requestSecurityResponse(
      "Too many inventory checks. Please wait and try again.",
      429,
      rate.retryAfter,
    );
  }

  const wcUrl = import.meta.env.WC_API_URL || import.meta.env.PUBLIC_WP_URL;
  const consumerKey = import.meta.env.WC_CONSUMER_KEY;
  const consumerSecret = import.meta.env.WC_CONSUMER_SECRET;

  if (!wcUrl || !consumerKey || !consumerSecret) {
    return jsonResponse(
      { success: false, message: "Inventory validation is not configured." },
      503,
    );
  }

  const body = await request.json().catch(() => null);
  const rawItems = Array.isArray(body?.items) ? body.items.slice(0, MAX_ITEMS) : [];
  const items = rawItems.map(normalizeItem).filter((item) => item.product_id > 0);

  if (!items.length) {
    return jsonResponse(
      { success: false, message: "No valid cart items were received." },
      400,
    );
  }

  const cleanUrl = String(wcUrl).replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const results = await Promise.all(
      items.map(async (item) => {
        const path = item.variation_id
          ? `products/${item.product_id}/variations/${item.variation_id}`
          : `products/${item.product_id}`;
        const endpoint = new URL(`${cleanUrl}/wp-json/wc/v3/${path}`);
        endpoint.searchParams.set(
          "_fields",
          "id,name,status,purchasable,price,regular_price,sale_price,stock_status,stock_quantity,manage_stock,backorders_allowed",
        );
        endpoint.searchParams.set("_", String(Date.now()));

        const response = await fetchWooProduct(
          endpoint,
          consumerKey,
          consumerSecret,
          controller.signal,
        );

        if (response.status === 404) return validateProduct(item, null);
        if (!response.ok) throw new Error(`WooCommerce returned ${response.status}.`);

        const product = await response.json();
        return validateProduct(item, product);
      }),
    );

    const valid = results.every((item) => item.valid === true);

    return jsonResponse({
      success: true,
      valid,
      items: results,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    const timedOut = error?.name === "AbortError";

    return jsonResponse(
      {
        success: false,
        message: timedOut
          ? "Inventory validation timed out. Please try again."
          : "Inventory could not be verified. Please try again.",
      },
      503,
    );
  } finally {
    clearTimeout(timeout);
  }
}
