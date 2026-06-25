export const prerender = false;

const WC_STORE_URL =
  import.meta.env.WC_STORE_URL ||
  import.meta.env.WC_API_URL ||
  import.meta.env.PUBLIC_WP_URL;

const WC_CONSUMER_KEY = import.meta.env.WC_CONSUMER_KEY;
const WC_CONSUMER_SECRET = import.meta.env.WC_CONSUMER_SECRET;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function cleanOrderNumber(value = "") {
  return String(value || "").replace(/^#/, "").trim();
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function buildWooUrl(path, params = {}) {
  if (!WC_STORE_URL || !WC_CONSUMER_KEY || !WC_CONSUMER_SECRET) {
    throw new Error(
      "Missing WooCommerce env variables. Check WC_API_URL, WC_CONSUMER_KEY and WC_CONSUMER_SECRET."
    );
  }

  const cleanBase = String(WC_STORE_URL).replace(/\/$/, "");
  const cleanPath = String(path).replace(/^\//, "");

  const url = cleanBase.includes("/wp-json/wc/v3")
    ? new URL(`${cleanBase}/${cleanPath}`)
    : new URL(`${cleanBase}/wp-json/wc/v3/${cleanPath}`);

  url.searchParams.set("consumer_key", WC_CONSUMER_KEY);
  url.searchParams.set("consumer_secret", WC_CONSUMER_SECRET);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return url;
}

async function wcFetch(path, params = {}) {
  const url = buildWooUrl(path, params);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    console.error("WooCommerce non JSON response:", text);
    throw new Error("WooCommerce returned an invalid JSON response.");
  }

  if (!response.ok) {
    const message =
      data?.message || `WooCommerce request failed with status ${response.status}.`;

    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return data;
}

function metaValue(order, keys = []) {
  const meta = Array.isArray(order?.meta_data) ? order.meta_data : [];

  const found = meta.find((item) => keys.includes(item?.key));

  return found?.value || "";
}

function extractTracking(order) {
  const shipmentItems = metaValue(order, [
    "_wc_shipment_tracking_items",
    "_shipment_tracking_items",
  ]);

  if (Array.isArray(shipmentItems) && shipmentItems.length > 0) {
    const item = shipmentItems[0] || {};

    return {
      number: item.tracking_number || item.trackingNumber || "",
      carrier:
        item.tracking_provider ||
        item.trackingProvider ||
        item.provider ||
        "Carrier pending",
      url:
        item.custom_tracking_link ||
        item.tracking_url ||
        item.trackingUrl ||
        "",
      eta: item.date_shipped || "",
    };
  }

  return {
    number: metaValue(order, [
      "_tracking_number",
      "tracking_number",
      "_aftership_tracking_number",
    ]),
    carrier:
      metaValue(order, [
        "_tracking_provider",
        "tracking_provider",
        "_aftership_tracking_provider_name",
      ]) || "Carrier pending",
    url: metaValue(order, [
      "_tracking_url",
      "tracking_url",
      "_aftership_tracking_url",
    ]),
    eta: metaValue(order, [
      "_estimated_delivery",
      "estimated_delivery",
      "eta",
    ]),
  };
}

function safeOrder(order) {
  const tracking = extractTracking(order);

  return {
    id: order.id,
    number: order.number || String(order.id),
    status: order.status,
    date: order.date_created
      ? new Date(order.date_created).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "",
    total: order.total,
    currency: order.currency || "USD",
    tracking,
    items: Array.isArray(order.line_items)
      ? order.line_items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
        }))
      : [],
  };
}

async function findOrder(orderNumber) {
  const numericId = /^\d+$/.test(orderNumber) ? Number(orderNumber) : null;

  if (numericId) {
    try {
      const direct = await wcFetch(`orders/${numericId}`);

      if (direct?.id) {
        return direct;
      }
    } catch (error) {
      if (![404, 400].includes(error.status)) {
        throw error;
      }
    }
  }

  const candidates = await wcFetch("orders", {
    search: orderNumber,
    per_page: 20,
    orderby: "date",
    order: "desc",
  });

  if (!Array.isArray(candidates)) {
    return null;
  }

  return (
    candidates.find((order) => {
      const number = String(order?.number || order?.id || "");

      return number.toLowerCase() === String(orderNumber).toLowerCase();
    }) || null
  );
}

export async function POST({ request }) {
  try {
    const body = await request.json().catch(() => ({}));

    const email = normalizeEmail(body.email);
    const orderNumber = cleanOrderNumber(
      body.order_number || body.orderNumber || body.number
    );

    if (!orderNumber || !email || !isValidEmail(email)) {
      return json(
        {
          success: false,
          message: "Enter a valid billing email and confirmation number.",
        },
        400
      );
    }

    const order = await findOrder(orderNumber);

    if (!order) {
      return json(
        {
          success: false,
          message: "We could not find an order with those details.",
        },
        404
      );
    }

    const billingEmail = normalizeEmail(order?.billing?.email);

    if (!billingEmail || billingEmail !== email) {
      return json(
        {
          success: false,
          message: "We could not find an order with those details.",
        },
        404
      );
    }

    return json({
      success: true,
      order: safeOrder(order),
    });
  } catch (error) {
    console.error("Track order error:", error);

    return json(
      {
        success: false,
        message:
          import.meta.env.DEV
            ? error.message
            : "Unable to track this order right now.",
      },
      500
    );
  }
}