import {
  checkRateLimit,
  requestSecurityResponse,
} from "../../lib/requestSecurity";

const CACHE_TTL = 1000 * 60 * 10;
const STALE_TTL = 1000 * 60 * 60 * 12;
const REQUEST_TIMEOUT = 8000;

let cachedPayload = null;
let cachedAt = 0;
let pendingRequest = null;

function createJsonResponse(payload, status = 200, cacheStatus = "MISS") {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control":
        status === 200
          ? "public, max-age=300, s-maxage=600, stale-while-revalidate=43200"
          : "no-store",
      "CDN-Cache-Control":
        status === 200
          ? "public, max-age=600, stale-while-revalidate=43200"
          : "no-store",
      "X-Cache": cacheStatus,
    },
  });
}

function getBasicAuthHeader(consumerKey, consumerSecret) {
  return `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}`;
}

function getImage(product) {
  if (!Array.isArray(product.images) || product.images.length === 0) {
    return {
      src: "/logo.webp",
      alt: product.name || "RGVPRIME product",
    };
  }

  const mainImage = product.images[0];

  return {
    src: mainImage.src || "/logo.webp",
    alt: mainImage.alt || mainImage.name || product.name || "RGVPRIME product",
  };
}

function mapProduct(product) {
  const image = getImage(product);

  const categories = Array.isArray(product.categories)
    ? product.categories.map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
      }))
    : [];

  const tags = Array.isArray(product.tags)
    ? product.tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        slug: tag.slug,
      }))
    : [];

  return {
    id: product.id,
    name: product.name,
    title: product.name,
    slug: product.slug,
    sku: product.sku,
    type: product.type,
    price: product.price,
    regular_price: product.regular_price,
    sale_price: product.sale_price,
    price_html: product.price_html,
    short_description: product.short_description,
    image: image.src,
    image_alt: image.alt,
    images: Array.isArray(product.images) ? product.images : [],
    stock_status: product.stock_status,
    stock_quantity: product.stock_quantity,
    manage_stock: product.manage_stock,
    backorders_allowed: product.backorders_allowed,
    featured: product.featured,
    categories,
    tags,
    permalink: product.permalink,
  };
}

async function fetchWooFeaturedProducts() {
  const wcUrl = import.meta.env.WC_API_URL || import.meta.env.PUBLIC_WP_URL;
  const consumerKey = import.meta.env.WC_CONSUMER_KEY;
  const consumerSecret = import.meta.env.WC_CONSUMER_SECRET;

  if (!wcUrl || !consumerKey || !consumerSecret) {
    return {
      ok: false,
      status: 500,
      payload: {
        success: false,
        message: "The product service is not configured.",
      },
    };
  }

  const cleanUrl = wcUrl.replace(/\/$/, "");
  const endpoint = new URL(`${cleanUrl}/wp-json/wc/v3/products`);

  endpoint.searchParams.set("status", "publish");
  endpoint.searchParams.set("stock_status", "instock");
  endpoint.searchParams.set("per_page", "4");
  endpoint.searchParams.set("orderby", "date");
  endpoint.searchParams.set("order", "desc");
  endpoint.searchParams.set("featured", "true");

  endpoint.searchParams.set(
    "_fields",
    [
      "id",
      "name",
      "slug",
      "sku",
      "type",
      "price",
      "regular_price",
      "sale_price",
      "price_html",
      "short_description",
      "images",
      "stock_status",
      "stock_quantity",
      "manage_stock",
      "backorders_allowed",
      "featured",
      "categories",
      "tags",
      "permalink",
    ].join(",")
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(endpoint.toString(), {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: getBasicAuthHeader(consumerKey, consumerSecret),
      },
    });

    const rawText = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        payload: {
          success: false,
          message: "WooCommerce API request failed.",
          status: response.status,
          statusText: response.statusText,
        },
      };
    }

    let products = [];

    try {
      products = JSON.parse(rawText);
    } catch {
      return {
        ok: false,
        status: 500,
        payload: {
          success: false,
          message: "WooCommerce did not return valid JSON.",
        },
      };
    }

    const mappedProducts = Array.isArray(products)
      ? products.map(mapProduct)
      : [];

    return {
      ok: true,
      status: 200,
      payload: {
        success: true,
        count: mappedProducts.length,
        products: mappedProducts,
        cached_at: new Date().toISOString(),
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      payload: {
        success: false,
        message:
          error.name === "AbortError"
            ? "WooCommerce request timed out."
            : "Server could not reach WooCommerce.",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET({ request }) {
  const rate = checkRateLimit(request, {
    namespace: "featured-products",
    limit: 120,
    windowMs: 60 * 1000,
  });

  if (!rate.allowed) {
    return requestSecurityResponse(
      "Too many product requests. Please wait and try again.",
      429,
      rate.retryAfter,
    );
  }

  const now = Date.now();
  const cacheAge = now - cachedAt;

  if (cachedPayload && cacheAge < CACHE_TTL) {
    return createJsonResponse(cachedPayload, 200, "HIT");
  }

  if (pendingRequest) {
    const result = await pendingRequest;

    if (result.ok) {
      return createJsonResponse(result.payload, 200, "HIT-PENDING");
    }

    if (cachedPayload && cacheAge < STALE_TTL) {
      return createJsonResponse(
        {
          ...cachedPayload,
          stale: true,
          warning: "Serving stale products while WooCommerce is unavailable.",
        },
        200,
        "STALE"
      );
    }

    return createJsonResponse(result.payload, result.status, "ERROR");
  }

  pendingRequest = fetchWooFeaturedProducts();

  const result = await pendingRequest;
  pendingRequest = null;

  if (result.ok) {
    cachedPayload = result.payload;
    cachedAt = now;

    return createJsonResponse(result.payload, 200, "MISS");
  }

  if (cachedPayload && cacheAge < STALE_TTL) {
    return createJsonResponse(
      {
        ...cachedPayload,
        stale: true,
        warning: "Serving stale products because WooCommerce failed.",
      },
      200,
      "STALE"
    );
  }

  return createJsonResponse(result.payload, result.status, "ERROR");
}
