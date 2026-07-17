import { Buffer } from "node:buffer";

export const prerender = false;

const TRACKING_ITEM_META_KEYS = [
  "_wc_shipment_tracking_items",
  "wc_shipment_tracking_items",
  "_ast_tracking_items",
  "ast_tracking_items",
];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

function envValue(...keys) {
  for (const key of keys) {
    const value = import.meta.env[key];
    if (value) return String(value).trim();
  }

  return "";
}

function apiBaseUrl() {
  const configured = envValue(
    "WC_STORE_URL",
    "WC_API_URL",
    "WOOCOMMERCE_URL",
    "WOOCOMMERCE_API_URL",
    "WORDPRESS_URL",
    "WORDPRESS_API_URL",
    "WP_URL",
    "PUBLIC_WORDPRESS_URL",
    "PUBLIC_WP_URL",
  );

  if (!configured) return "";

  const clean = configured.replace(/\/+$/, "");
  if (/\/wp-json\/wc\/v3$/i.test(clean)) return clean;
  if (/\/wp-json$/i.test(clean)) return `${clean}/wc/v3`;

  return `${clean}/wp-json/wc/v3`;
}

function basicAuthorization(key, secret) {
  return `Basic ${Buffer.from(`${key}:${secret}`, "utf8").toString("base64")}`;
}

async function wooRequest(path) {
  const baseUrl = apiBaseUrl();
  const key = envValue(
    "WC_CONSUMER_KEY",
    "WOOCOMMERCE_CONSUMER_KEY",
    "WC_KEY",
    "WP_CONSUMER_KEY",
  );
  const secret = envValue(
    "WC_CONSUMER_SECRET",
    "WOOCOMMERCE_CONSUMER_SECRET",
    "WC_SECRET",
    "WP_CONSUMER_SECRET",
  );

  if (!baseUrl || !key || !secret) {
    throw new Error("TRACKING_CONFIGURATION_MISSING");
  }

  const response = await fetch(
    `${baseUrl}/${String(path).replace(/^\/+/, "")}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: basicAuthorization(key, secret),
      },
    },
  );

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("WOOCOMMERCE_INVALID_RESPONSE");
  }

  if (!response.ok) {
    const error = new Error(data?.message || "WOOCOMMERCE_REQUEST_FAILED");
    error.status = response.status;
    throw error;
  }

  return data;
}

function normalizeOrderNumber(value) {
  return String(value || "")
    .trim()
    .replace(/^#/, "")
    .replace(/[^a-z0-9-_]/gi, "");
}

async function findOrder(orderNumber) {
  if (/^\d+$/.test(orderNumber)) {
    try {
      const order = await wooRequest(
        `orders/${encodeURIComponent(orderNumber)}`,
      );
      if (order?.id) return order;
    } catch (error) {
      if (error?.status !== 404) throw error;
    }
  }

  const candidates = await wooRequest(
    `orders?search=${encodeURIComponent(orderNumber)}&per_page=50&orderby=date&order=desc`,
  );

  return (
    (Array.isArray(candidates) ? candidates : []).find(
      (order) =>
        normalizeOrderNumber(order?.number) === orderNumber ||
        String(order?.id || "") === orderNumber,
    ) || null
  );
}

function stripHtml(value = "") {
  return String(value)
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8211;|&#x2013;/gi, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function metaValue(metaData, keys) {
  if (!Array.isArray(metaData)) return "";

  const wanted = new Set(keys.map((key) => String(key).toLowerCase()));
  const match = [...metaData]
    .reverse()
    .find((item) => wanted.has(String(item?.key || "").toLowerCase()));

  return match?.value ?? "";
}

function maybeJson(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || !["[", "{"].includes(trimmed[0])) return value;

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function collectObjects(target, value, depth = 0) {
  if (depth > 5 || value === undefined || value === null) return;

  const decoded = maybeJson(value);

  if (Array.isArray(decoded)) {
    decoded.forEach((item) => collectObjects(target, item, depth + 1));
    return;
  }

  if (decoded && typeof decoded === "object") {
    target.push(decoded);
    Object.values(decoded).forEach((item) => {
      if (item && typeof item === "object") {
        collectObjects(target, item, depth + 1);
      }
    });
  }
}

function sourceValue(sources, keys) {
  for (const source of sources) {
    for (const key of keys) {
      const value = source?.[key];
      if (value === 0) return value;
      if (
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ""
      ) {
        return value;
      }
    }
  }

  return "";
}

function serializedValue(value, keys) {
  if (typeof value !== "string") return "";

  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = value.match(
      new RegExp(`${escaped}["']?;?(?:s:\\d+:)?["']([^"';}]+)`, "i"),
    );
    if (match?.[1]) return match[1].trim();
  }

  return "";
}

function parseTrackingNote(value) {
  const raw = String(value || "");
  const plain = stripHtml(raw);
  if (!plain) return {};

  const numberMatch = plain.match(
    /tracking(?:\s+(?:number|no\.?))?\s*[:#-]?\s*([A-Z0-9]{8,40})/i,
  );
  const carrierMatch = plain.match(
    /shipped\s+via\s+([a-z0-9 .&-]+?)(?=\s+with\s+tracking|\s+tracking|[,.]|$)/i,
  );
  const hrefMatch = raw.match(/href=["']([^"']+)["']/i);
  const urlMatch = plain.match(/https?:\/\/[^\s<]+/i);

  return {
    number: numberMatch?.[1] || "",
    carrier: carrierMatch?.[1]?.trim() || "",
    url: hrefMatch?.[1]?.replace(/&amp;/gi, "&") || urlMatch?.[0] || "",
  };
}

function inferCarrier(number) {
  const clean = String(number || "")
    .replace(/\s+/g, "")
    .toUpperCase();

  if (/^1Z[A-Z0-9]{16}$/.test(clean)) return "UPS";
  if (/^\d{20,22}$/.test(clean) || /^(94|92|93|95)\d{18,20}$/.test(clean)) {
    return "USPS";
  }
  if (/^\d{12}$/.test(clean) || /^\d{15}$/.test(clean)) return "FedEx";

  return "";
}

function carrierUrl(carrier, number) {
  if (!number) return "";

  const provider = String(carrier || "").toLowerCase();
  const encoded = encodeURIComponent(String(number).trim());

  if (provider.includes("usps") || provider.includes("postal service")) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
  }
  if (provider.includes("ups") && !provider.includes("usps")) {
    return `https://www.ups.com/track?loc=en_US&tracknum=${encoded}`;
  }
  if (provider.includes("fedex")) {
    return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
  }
  if (provider.includes("dhl")) {
    return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${encoded}`;
  }

  return "";
}

function shipmentStatusLabel(value, hasTracking) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return hasTracking ? "Shipped" : "Pending";
  if (normalized === "1") return "Shipped";
  if (normalized === "0")
    return hasTracking ? "Tracking assigned" : "Preparing";

  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function extractTracking(order, notes) {
  const metaData = Array.isArray(order?.meta_data) ? order.meta_data : [];
  const storedItems = metaValue(metaData, TRACKING_ITEM_META_KEYS);
  const sources = [];
  collectObjects(sources, storedItems);

  const noteTracking =
    [...(Array.isArray(notes) ? notes : [])]
      .sort(
        (a, b) =>
          new Date(b?.date_created_gmt || b?.date_created || 0).getTime() -
          new Date(a?.date_created_gmt || a?.date_created || 0).getTime(),
      )
      .map((note) => parseTrackingNote(note?.note))
      .find((item) => item.number || item.url || item.carrier) || {};

  const directSerialized = typeof storedItems === "string" ? storedItems : "";
  const number = String(
    sourceValue(sources, [
      "tracking_number",
      "trackingNumber",
      "tracking_no",
      "tracking_id",
      "number",
    ]) ||
      metaValue(metaData, [
        "tracking_number",
        "_tracking_number",
        "_shipment_tracking_number",
        "_wc_shipment_tracking_number",
        "_aftership_tracking_number",
      ]) ||
      serializedValue(directSerialized, ["tracking_number", "tracking_no"]) ||
      noteTracking.number ||
      "",
  ).trim();

  const carrier = String(
    sourceValue(sources, [
      "tracking_provider",
      "custom_tracking_provider",
      "shipping_provider",
      "provider",
      "carrier",
    ]) ||
      metaValue(metaData, [
        "tracking_provider",
        "_tracking_provider",
        "_shipment_tracking_provider",
        "_wc_shipment_tracking_provider",
      ]) ||
      serializedValue(directSerialized, [
        "tracking_provider",
        "custom_tracking_provider",
      ]) ||
      noteTracking.carrier ||
      inferCarrier(number) ||
      "",
  ).trim();

  const suppliedUrl = String(
    sourceValue(sources, [
      "tracking_url",
      "tracking_link",
      "custom_tracking_link",
      "url",
    ]) ||
      metaValue(metaData, [
        "tracking_url",
        "_tracking_url",
        "custom_tracking_link",
      ]) ||
      serializedValue(directSerialized, [
        "tracking_url",
        "tracking_link",
        "custom_tracking_link",
      ]) ||
      noteTracking.url ||
      "",
  ).trim();

  const rawStatus =
    sourceValue(sources, [
      "shipment_status",
      "tracking_status",
      "status_description",
      "latest_status",
      "status_shipped",
      "status",
    ]) ||
    metaValue(metaData, [
      "shipment_status",
      "_shipment_status",
      "tracking_status",
      "_tracking_status",
    ]);

  const eta = String(
    sourceValue(sources, [
      "eta",
      "estimated_delivery",
      "estimatedDelivery",
      "delivery_date",
    ]) ||
      metaValue(metaData, [
        "estimated_delivery",
        "_estimated_delivery",
        "delivery_date",
      ]) ||
      "",
  ).trim();

  return {
    number,
    carrier,
    url: suppliedUrl || carrierUrl(carrier, number),
    status: shipmentStatusLabel(rawStatus, Boolean(number)),
    eta,
  };
}

function publicOrder(order, tracking) {
  const created = order?.date_created_gmt || order?.date_created;
  const formattedDate = created
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${created.replace(/Z$/, "")}Z`))
    : "";

  return {
    id: order.id,
    number: order.number || order.id,
    date: formattedDate,
    status: order.status || "pending",
    total: order.total || "0",
    currency: order.currency || "USD",
    tracking,
    items: (Array.isArray(order.line_items) ? order.line_items : []).map(
      (item) => ({
        name: item.name || "Product",
        quantity: Number(item.quantity || 0),
      }),
    ),
  };
}

export async function POST({ request }) {
  try {
    let body = null;

    try {
      body = await request.json();
    } catch {
      return json({ success: false, message: "Invalid request." }, 400);
    }

    const email = String(body?.email || "")
      .trim()
      .toLowerCase();
    const orderNumber = normalizeOrderNumber(body?.order_number);

    if (!email || !/^\S+@\S+\.\S+$/.test(email) || !orderNumber) {
      return json(
        {
          success: false,
          message: "Enter a valid billing email and confirmation number.",
        },
        400,
      );
    }

    const order = await findOrder(orderNumber);
    const billingEmail = String(order?.billing?.email || "")
      .trim()
      .toLowerCase();

    if (!order || !billingEmail || billingEmail !== email) {
      return json(
        {
          success: false,
          message: "We could not find an order with those details.",
        },
        404,
      );
    }

    let notes = [];
    try {
      notes = await wooRequest(
        `orders/${encodeURIComponent(order.id)}/notes?per_page=100`,
      );
    } catch {
      // Tracking metadata can still be returned when order-note access is unavailable.
      notes = [];
    }

    const tracking = extractTracking(order, notes);

    return json({
      success: true,
      order: publicOrder(order, tracking),
    });
  } catch (error) {
    console.error("Track order endpoint error:", error?.message || error);

    if (error?.message === "TRACKING_CONFIGURATION_MISSING") {
      return json(
        {
          success: false,
          message: "The tracking service is not configured yet.",
        },
        503,
      );
    }

    return json(
      {
        success: false,
        message: "Unable to track this order right now. Please try again.",
      },
      500,
    );
  }
}