export const prerender = false;

const FALLBACK_IMAGE = "/logo.webp";
const DEFAULT_CATALOG_LIMIT = 45;
const MAX_CATALOG_LIMIT = 45;

const CACHE_TTL = {
  catalog: 1000 * 60 * 10,
  detail: 1000 * 60 * 5,
  stale: 1000 * 60 * 60,
};

const cacheStore =
  globalThis.__RGV_PRODUCTS_API_CACHE__ ||
  (globalThis.__RGV_PRODUCTS_API_CACHE__ = {
    catalogs: new Map(),
    details: new Map(),
  });

if (!cacheStore.catalogs) {
  cacheStore.catalogs = new Map();
}

if (!cacheStore.details) {
  cacheStore.details = new Map();
}

function jsonResponse(data, status = 200, cacheControl = "no-store") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cacheControl,
    },
  });
}

function getCatalogCacheControl() {
  return "public, max-age=60, s-maxage=900, stale-while-revalidate=3600";
}

function getDetailCacheControl() {
  return "public, max-age=60, s-maxage=600, stale-while-revalidate=1800";
}

function getErrorCacheControl() {
  return "no-store";
}

function sanitizeLimit(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return DEFAULT_CATALOG_LIMIT;
  }

  return Math.min(Math.max(Math.floor(number), 1), MAX_CATALOG_LIMIT);
}

function normalizeBoolean(value) {
  if (value === null || value === undefined || value === "") return null;

  const cleanValue = String(value).toLowerCase().trim();

  if (cleanValue === "true" || cleanValue === "1" || cleanValue === "yes") {
    return true;
  }

  if (cleanValue === "false" || cleanValue === "0" || cleanValue === "no") {
    return false;
  }

  return null;
}

function getCatalogCacheKey({ limit, featured }) {
  return JSON.stringify({
    type: "catalog",
    limit,
    featured,
  });
}

function getCachedCatalog(cacheKey, allowStale = false) {
  const cached = cacheStore.catalogs.get(cacheKey);

  if (!cached) return null;

  const age = Date.now() - cached.time;
  const maxAge = allowStale ? CACHE_TTL.stale : CACHE_TTL.catalog;

  if (age < maxAge) {
    return cached.data;
  }

  return null;
}

function setCachedCatalog(cacheKey, data) {
  cacheStore.catalogs.set(cacheKey, {
    time: Date.now(),
    data,
  });
}

function getCachedDetail(slug, allowStale = false) {
  const cached = cacheStore.details.get(slug);

  if (!cached) return null;

  const age = Date.now() - cached.time;
  const maxAge = allowStale ? CACHE_TTL.stale : CACHE_TTL.detail;

  if (age < maxAge) {
    return cached.data;
  }

  return null;
}

function setCachedDetail(slug, data) {
  cacheStore.details.set(slug, {
    time: Date.now(),
    data,
  });
}

function getWooImage(product) {
  if (product?.images && product.images.length > 0 && product.images[0]?.src) {
    return product.images[0].src;
  }

  return FALLBACK_IMAGE;
}

function getWooVariationImage(variation) {
  if (variation?.image?.src) {
    return variation.image.src;
  }

  return null;
}

function mapCategory(category) {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
  };
}

function mapProductForCatalog(product) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    type: product.type,
    price: product.price,
    regular_price: product.regular_price,
    sale_price: product.sale_price,
    price_html: product.price_html,
    short_description: product.short_description,
    image: getWooImage(product),
    stock_status: product.stock_status,
    stock_quantity: product.stock_quantity,
    manage_stock: product.manage_stock,
    featured: product.featured,
    categories: Array.isArray(product.categories)
      ? product.categories.map(mapCategory)
      : [],
    permalink: product.permalink,
  };
}

function mapProductForDetail(product) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    type: product.type,
    price: product.price,
    regular_price: product.regular_price,
    sale_price: product.sale_price,
    price_html: product.price_html,
    description: product.description,
    short_description: product.short_description,
    image: getWooImage(product),
    images: Array.isArray(product.images) ? product.images : [],
    attributes: Array.isArray(product.attributes) ? product.attributes : [],
    variations: Array.isArray(product.variations) ? product.variations : [],
    stock_status: product.stock_status,
    stock_quantity: product.stock_quantity,
    manage_stock: product.manage_stock,
    backorders_allowed: product.backorders_allowed,
    featured: product.featured,
    weight: product.weight,
    categories: Array.isArray(product.categories)
      ? product.categories.map(mapCategory)
      : [],
    permalink: product.permalink,
  };
}

function mapVariationForDetail(variation) {
  return {
    id: variation.id,
    sku: variation.sku,
    type: variation.type || "variation",
    price: variation.price,
    regular_price: variation.regular_price,
    sale_price: variation.sale_price,
    price_html: variation.price_html || "",
    description: variation.description,
    image: getWooVariationImage(variation),
    image_data: variation.image || null,
    attributes: Array.isArray(variation.attributes) ? variation.attributes : [],
    stock_status: variation.stock_status,
    stock_quantity: variation.stock_quantity,
    manage_stock: variation.manage_stock,
    backorders_allowed: variation.backorders_allowed,
    weight: variation.weight,
    permalink: variation.permalink,
  };
}

function buildWooEndpoint({
  slug,
  wcUrl,
  limit = DEFAULT_CATALOG_LIMIT,
  featured = null,
}) {
  const cleanUrl = wcUrl.replace(/\/$/, "");
  const endpoint = new URL(`${cleanUrl}/wp-json/wc/v3/products`);

  endpoint.searchParams.set("status", "publish");

  if (slug) {
    endpoint.searchParams.set("slug", slug);
    endpoint.searchParams.set("per_page", "1");

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
        "description",
        "short_description",
        "images",
        "attributes",
        "variations",
        "stock_status",
        "stock_quantity",
        "manage_stock",
        "backorders_allowed",
        "featured",
        "weight",
        "categories",
        "permalink",
      ].join(",")
    );

    return endpoint;
  }

  endpoint.searchParams.set("per_page", String(limit));
  endpoint.searchParams.set("orderby", "menu_order");
  endpoint.searchParams.set("order", "asc");

  if (featured !== null) {
    endpoint.searchParams.set("featured", featured ? "true" : "false");
  }

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
      "featured",
      "categories",
      "permalink",
    ].join(",")
  );

  return endpoint;
}

function buildWooVariationEndpoint({ productId, wcUrl }) {
  const cleanUrl = wcUrl.replace(/\/$/, "");
  const endpoint = new URL(
    `${cleanUrl}/wp-json/wc/v3/products/${productId}/variations`
  );

  endpoint.searchParams.set("per_page", "100");

  endpoint.searchParams.set(
    "_fields",
    [
      "id",
      "sku",
      "type",
      "price",
      "regular_price",
      "sale_price",
      "price_html",
      "description",
      "image",
      "attributes",
      "stock_status",
      "stock_quantity",
      "manage_stock",
      "backorders_allowed",
      "weight",
      "permalink",
    ].join(",")
  );

  return endpoint;
}

function getBasicAuthHeader(consumerKey, consumerSecret) {
  const token = `${consumerKey}:${consumerSecret}`;

  if (typeof Buffer !== "undefined") {
    return `Basic ${Buffer.from(token).toString("base64")}`;
  }

  return `Basic ${btoa(token)}`;
}

function addCredentialsToUrl(url, consumerKey, consumerSecret) {
  const endpoint = new URL(url);

  endpoint.searchParams.set("consumer_key", consumerKey);
  endpoint.searchParams.set("consumer_secret", consumerSecret);

  return endpoint.toString();
}

async function fetchWooCommerce(endpoint, consumerKey, consumerSecret, signal) {
  const authorization = getBasicAuthHeader(consumerKey, consumerSecret);

  const firstResponse = await fetch(endpoint.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: authorization,
    },
    signal,
  });

  if (firstResponse.status !== 401 && firstResponse.status !== 403) {
    return firstResponse;
  }

  return fetch(
    addCredentialsToUrl(endpoint.toString(), consumerKey, consumerSecret),
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal,
    }
  );
}

async function parseWooProducts(response) {
  const rawText = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      statusText: response.statusText,
      message: "WooCommerce API request failed.",
      details: rawText.slice(0, 500),
      products: null,
    };
  }

  try {
    const products = JSON.parse(rawText);

    if (!Array.isArray(products)) {
      return {
        ok: false,
        status: 500,
        statusText: "Invalid WooCommerce response",
        message: "WooCommerce response was not an array.",
        details: rawText.slice(0, 500),
        products: null,
      };
    }

    return {
      ok: true,
      status: 200,
      statusText: "OK",
      message: "OK",
      details: "",
      products,
    };
  } catch {
    return {
      ok: false,
      status: 500,
      statusText: "Invalid JSON",
      message: "WooCommerce did not return valid JSON.",
      details: rawText.slice(0, 500),
      products: null,
    };
  }
}

async function fetchWooProductVariations({
  productId,
  wcUrl,
  consumerKey,
  consumerSecret,
  signal,
}) {
  if (!productId) return [];

  try {
    const variationEndpoint = buildWooVariationEndpoint({
      productId,
      wcUrl,
    });

    const variationResponse = await fetchWooCommerce(
      variationEndpoint,
      consumerKey,
      consumerSecret,
      signal
    );

    const variationResult = await parseWooProducts(variationResponse);

    if (!variationResult.ok || !Array.isArray(variationResult.products)) {
      return [];
    }

    return variationResult.products.map(mapVariationForDetail);
  } catch (error) {
    console.error("WooCommerce variations request failed:", error);
    return [];
  }
}

export async function GET({ request }) {
  const requestUrl = new URL(request.url);

  const slug = requestUrl.searchParams.get("slug");
  const limit = sanitizeLimit(requestUrl.searchParams.get("limit"));
  const featured = normalizeBoolean(requestUrl.searchParams.get("featured"));

  const isDetailRequest = Boolean(slug);
  const catalogCacheKey = getCatalogCacheKey({ limit, featured });

  const freshCachedData = isDetailRequest
    ? getCachedDetail(slug, false)
    : getCachedCatalog(catalogCacheKey, false);

  if (freshCachedData) {
    return jsonResponse(
      {
        ...freshCachedData,
        cache: "memory",
      },
      200,
      isDetailRequest ? getDetailCacheControl() : getCatalogCacheControl()
    );
  }

  const wcUrl = import.meta.env.WC_API_URL || import.meta.env.PUBLIC_WP_URL;
  const consumerKey = import.meta.env.WC_CONSUMER_KEY;
  const consumerSecret = import.meta.env.WC_CONSUMER_SECRET;

  if (!wcUrl || !consumerKey || !consumerSecret) {
    const staleCachedData = isDetailRequest
      ? getCachedDetail(slug, true)
      : getCachedCatalog(catalogCacheKey, true);

    if (staleCachedData) {
      return jsonResponse(
        {
          ...staleCachedData,
          cache: "stale",
        },
        200,
        isDetailRequest ? getDetailCacheControl() : getCatalogCacheControl()
      );
    }

    return jsonResponse(
      {
        success: false,
        message: "Missing WooCommerce API environment variables.",
        received: {
          WC_API_URL: Boolean(import.meta.env.WC_API_URL),
          PUBLIC_WP_URL: Boolean(import.meta.env.PUBLIC_WP_URL),
          WC_CONSUMER_KEY: Boolean(consumerKey),
          WC_CONSUMER_SECRET: Boolean(consumerSecret),
        },
      },
      500,
      getErrorCacheControl()
    );
  }

  const endpoint = buildWooEndpoint({
    slug,
    wcUrl,
    limit,
    featured,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7500);

  try {
    const response = await fetchWooCommerce(
      endpoint,
      consumerKey,
      consumerSecret,
      controller.signal
    );

    const result = await parseWooProducts(response);

    if (!result.ok) {
      clearTimeout(timeout);

      const staleCachedData = isDetailRequest
        ? getCachedDetail(slug, true)
        : getCachedCatalog(catalogCacheKey, true);

      if (staleCachedData) {
        return jsonResponse(
          {
            ...staleCachedData,
            cache: "stale",
          },
          200,
          isDetailRequest ? getDetailCacheControl() : getCatalogCacheControl()
        );
      }

      return jsonResponse(
        {
          success: false,
          message: result.message,
          status: result.status,
          statusText: result.statusText,
          details: result.details,
        },
        result.status,
        getErrorCacheControl()
      );
    }

    const products = result.products;

    if (isDetailRequest) {
      const rawProduct = products[0] || null;
      const product = rawProduct ? mapProductForDetail(rawProduct) : null;

      if (!product) {
        clearTimeout(timeout);

        return jsonResponse(
          {
            success: false,
            message: "Product not found.",
            product: null,
            products: [],
            cache: "miss",
          },
          404,
          "public, max-age=30, s-maxage=60, stale-while-revalidate=300"
        );
      }

      if (product.type === "variable") {
        const variationDetails = await fetchWooProductVariations({
          productId: product.id,
          wcUrl,
          consumerKey,
          consumerSecret,
          signal: controller.signal,
        });

        if (variationDetails.length > 0) {
          product.variations = variationDetails;
        }
      }

      clearTimeout(timeout);

      const payload = {
        success: true,
        count: 1,
        product,
        products: [product],
        cache: "fresh",
      };

      setCachedDetail(slug, payload);

      return jsonResponse(payload, 200, getDetailCacheControl());
    }

    clearTimeout(timeout);

    const mappedProducts = products.map(mapProductForCatalog);

    const payload = {
      success: true,
      count: mappedProducts.length,
      products: mappedProducts,
      cache: "fresh",
      limit,
      featured,
    };

    setCachedCatalog(catalogCacheKey, payload);

    return jsonResponse(payload, 200, getCatalogCacheControl());
  } catch (error) {
    clearTimeout(timeout);

    const staleCachedData = isDetailRequest
      ? getCachedDetail(slug, true)
      : getCachedCatalog(catalogCacheKey, true);

    if (staleCachedData) {
      return jsonResponse(
        {
          ...staleCachedData,
          cache: "stale",
        },
        200,
        isDetailRequest ? getDetailCacheControl() : getCatalogCacheControl()
      );
    }

    const isTimeout = error.name === "AbortError";

    return jsonResponse(
      {
        success: false,
        message: isTimeout
          ? "WooCommerce took too long to respond."
          : "Server could not reach WooCommerce.",
        error: error.message,
      },
      500,
      getErrorCacheControl()
    );
  }
}