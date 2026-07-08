export const prerender = false;

const FALLBACK_IMAGE = "/logo.webp";
const DEFAULT_CATALOG_LIMIT = 45;
const MAX_CATALOG_LIMIT = 45;

const NO_CACHE_CONTROL = "no-store, no-cache, must-revalidate, max-age=0";

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

function shouldBypassCache(value) {
  const cleanValue = String(value || "").toLowerCase().trim();

  return (
    cleanValue === "1" ||
    cleanValue === "true" ||
    cleanValue === "yes" ||
    cleanValue === "fresh" ||
    cleanValue === "no-cache"
  );
}

function getImageVersion(source) {
  return (
    source?.date_modified_gmt ||
    source?.date_modified ||
    source?.modified_gmt ||
    source?.modified ||
    source?.updated_at ||
    Date.now()
  );
}

function withImageCacheBuster(src, version) {
  if (!src) return FALLBACK_IMAGE;

  const cleanVersion = String(version || Date.now()).trim();

  try {
    const url = new URL(src);
    url.searchParams.set("v", cleanVersion.replace(/[^a-zA-Z0-9._:-]/g, ""));
    return url.toString();
  } catch {
    const separator = src.includes("?") ? "&" : "?";
    return `${src}${separator}v=${encodeURIComponent(cleanVersion)}`;
  }
}

function getWooImage(product) {
  if (product?.images && product.images.length > 0 && product.images[0]?.src) {
    return withImageCacheBuster(product.images[0].src, getImageVersion(product));
  }

  return FALLBACK_IMAGE;
}

function getWooVariationImage(variation) {
  if (variation?.image?.src) {
    return withImageCacheBuster(variation.image.src, getImageVersion(variation));
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
    date_modified: product.date_modified,
    date_modified_gmt: product.date_modified_gmt,
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
    date_modified: product.date_modified,
    date_modified_gmt: product.date_modified_gmt,
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
    name: variation.name || "",
    slug: variation.slug || "",
    sku: variation.sku,
    type: variation.type || "variation",
    status: variation.status,
    purchasable: variation.purchasable,
    price: variation.price,
    regular_price: variation.regular_price,
    sale_price: variation.sale_price,
    price_html: variation.price_html || "",
    description: variation.description,
    date_modified: variation.date_modified,
    date_modified_gmt: variation.date_modified_gmt,
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
  endpoint.searchParams.set("_", String(Date.now()));

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
        "date_modified",
        "date_modified_gmt",
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
      "date_modified",
      "date_modified_gmt",
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
  endpoint.searchParams.set("orderby", "menu_order");
  endpoint.searchParams.set("order", "asc");
  endpoint.searchParams.set("_", String(Date.now()));

  endpoint.searchParams.set(
    "_fields",
    [
      "id",
      "name",
      "slug",
      "sku",
      "type",
      "status",
      "purchasable",
      "price",
      "regular_price",
      "sale_price",
      "price_html",
      "description",
      "date_modified",
      "date_modified_gmt",
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
  endpoint.searchParams.set("_", String(Date.now()));

  return endpoint.toString();
}

async function fetchWooCommerce(endpoint, consumerKey, consumerSecret, signal) {
  const authorization = getBasicAuthHeader(consumerKey, consumerSecret);

  const firstResponse = await fetch(endpoint.toString(), {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: authorization,
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
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
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
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

function productLooksVariable(rawProduct, product) {
  if (!rawProduct && !product) return false;

  const type = rawProduct?.type || product?.type;

  if (type === "variable") return true;

  if (Array.isArray(rawProduct?.variations) && rawProduct.variations.length > 0) {
    return true;
  }

  if (Array.isArray(product?.variations) && product.variations.length > 0) {
    return true;
  }

  const attributes = Array.isArray(rawProduct?.attributes)
    ? rawProduct.attributes
    : Array.isArray(product?.attributes)
      ? product.attributes
      : [];

  return attributes.some((attribute) => {
    if (!attribute) return false;

    if (attribute.variation === true) return true;

    return Array.isArray(attribute.options) && attribute.options.length > 1;
  });
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
      console.error("WooCommerce variations response invalid:", {
        status: variationResult.status,
        statusText: variationResult.statusText,
        message: variationResult.message,
        details: variationResult.details,
      });

      return [];
    }

    return variationResult.products.map(mapVariationForDetail);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }

    console.error("WooCommerce variations request failed:", error);
    return [];
  }
}

export async function GET({ request }) {
  const requestUrl = new URL(request.url);

  const slug = requestUrl.searchParams.get("slug");
  const limit = sanitizeLimit(requestUrl.searchParams.get("limit"));
  const featured = normalizeBoolean(requestUrl.searchParams.get("featured"));
  const debug = shouldBypassCache(requestUrl.searchParams.get("debug"));
  const refresh =
    shouldBypassCache(requestUrl.searchParams.get("refresh")) ||
    shouldBypassCache(request.headers.get("cache-control")) ||
    requestUrl.searchParams.has("_");

  const wcUrl = import.meta.env.WC_API_URL || import.meta.env.PUBLIC_WP_URL;
  const consumerKey = import.meta.env.WC_CONSUMER_KEY;
  const consumerSecret = import.meta.env.WC_CONSUMER_SECRET;

  if (!wcUrl || !consumerKey || !consumerSecret) {
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
      500
    );
  }

  const isDetailRequest = Boolean(slug);

  const endpoint = buildWooEndpoint({
    slug,
    wcUrl,
    limit,
    featured,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

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

      return jsonResponse(
        {
          success: false,
          message: result.message,
          status: result.status,
          statusText: result.statusText,
          details: result.details,
        },
        result.status
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
          404
        );
      }

      let variationDetails = [];

      if (productLooksVariable(rawProduct, product)) {
        variationDetails = await fetchWooProductVariations({
          productId: product.id,
          wcUrl,
          consumerKey,
          consumerSecret,
          signal: controller.signal,
        });

        product.variations = variationDetails;
      }

      clearTimeout(timeout);

      const payload = {
        success: true,
        count: 1,
        product,
        products: [product],
        cache: refresh ? "refresh" : "fresh",
        updatedAt: new Date().toISOString(),
      };

      if (debug) {
        payload.debug = {
          productId: product.id,
          productType: product.type,
          rawVariationIds: Array.isArray(rawProduct?.variations)
            ? rawProduct.variations
            : [],
          variationCount: variationDetails.length,
          variationPreview: variationDetails.map((variation) => ({
            id: variation.id,
            sku: variation.sku,
            price: variation.price,
            regular_price: variation.regular_price,
            sale_price: variation.sale_price,
            stock_status: variation.stock_status,
            purchasable: variation.purchasable,
            attributes: variation.attributes,
            image: variation.image,
            date_modified: variation.date_modified,
            date_modified_gmt: variation.date_modified_gmt,
          })),
        };
      }

      return jsonResponse(payload, 200);
    }

    clearTimeout(timeout);

    const mappedProducts = products.map(mapProductForCatalog);

    return jsonResponse(
      {
        success: true,
        count: mappedProducts.length,
        products: mappedProducts,
        cache: refresh ? "refresh" : "fresh",
        limit,
        featured,
        updatedAt: new Date().toISOString(),
      },
      200
    );
  } catch (error) {
    clearTimeout(timeout);

    const isTimeout = error.name === "AbortError";

    return jsonResponse(
      {
        success: false,
        message: isTimeout
          ? "WooCommerce took too long to respond."
          : "Server could not reach WooCommerce.",
        error: error.message,
      },
      500
    );
  }
}