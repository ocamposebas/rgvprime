import { SITE_NAME, SITE_URL } from "../../lib/seo";
import { GET as getProducts } from "./products.js";

export const prerender = false;

const FEED_NAME = "rgvprime-affiliate-catalog";
const FEED_VERSION = "2.0";
const CURRENCY = "USD";
const AFFILIATE_COUPON = "sammyc";
const FEED_CACHE_TTL_MS = 30 * 1000;
const FEED_STALE_TTL_MS = 15 * 60 * 1000;
const MAX_VARIATION_BATCH_SIZE = 16;
const MAX_RESULTS = 100;

let feedCache = null;

function cleanText(value = "") {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function money(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Number(number.toFixed(2))
    : null;
}

function formatMoney(value) {
  const amount = money(value);
  return amount === null
    ? null
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: CURRENCY,
      }).format(amount);
}

function chunk(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function affiliateUrl(pathname, extra = {}) {
  const url = new URL(pathname, SITE_URL);
  url.searchParams.set("coupon", AFFILIATE_COUPON);
  url.searchParams.set("utm_source", AFFILIATE_COUPON);
  url.searchParams.set("utm_medium", "affiliate");
  url.searchParams.set("utm_campaign", "product_feed");

  Object.entries(extra).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

function primaryImage(product = {}) {
  const image = Array.isArray(product.images) ? product.images[0] : null;
  const src = String(image?.src || image?.thumbnail || "").trim();

  return src
    ? {
        src,
        alt: cleanText(image?.alt || product.image_alt || product.name),
        ...(image?.srcset ? { srcset: image.srcset } : {}),
        ...(image?.sizes ? { sizes: image.sizes } : {}),
      }
    : null;
}

function variationName(productName, attributes = []) {
  const options = attributes
    .map((attribute) => cleanText(attribute?.option || attribute?.name || ""))
    .filter(Boolean);

  return options.length
    ? `${cleanText(productName)} - ${options.join(" / ")}`
    : cleanText(productName);
}

function mapVariation(variation, product) {
  const current = money(
    variation?.price ?? variation?.sale_price ?? variation?.regular_price,
  );
  const regular = money(variation?.regular_price);
  const sale = money(variation?.sale_price);
  const inStock =
    variation?.stock_status === "instock" && variation?.purchasable !== false;

  return {
    id: Number(variation?.id || 0),
    parent_id: Number(product?.id || 0),
    name: variationName(product?.name, variation?.attributes),
    sku: String(variation?.sku || ""),
    type: "variation",
    url: affiliateUrl(`/product/${encodeURIComponent(product.slug)}`, {
      variation_id: variation?.id,
    }),
    price: current,
    regular_price: regular,
    sale_price: sale,
    currency: CURRENCY,
    formatted_price: formatMoney(current),
    on_sale: regular !== null && current !== null && current < regular,
    stock_status: inStock ? "instock" : "outofstock",
    stock_quantity:
      variation?.stock_quantity === null ||
      variation?.stock_quantity === undefined
        ? null
        : Math.max(0, Number(variation.stock_quantity) || 0),
    in_stock: inStock,
    purchasable: variation?.purchasable !== false,
    backorders_allowed: variation?.backorders_allowed === true,
    image: String(variation?.image || product?.images?.[0]?.src || "") || null,
    attributes: Array.isArray(variation?.attributes)
      ? variation.attributes.map((attribute) => ({
          id: Number(attribute?.id || 0),
          name: cleanText(attribute?.name || ""),
          option: cleanText(attribute?.option || ""),
        }))
      : [],
  };
}

function mapProduct(product, variationSummaries) {
  const rawVariations = Array.isArray(variationSummaries?.[product.id])
    ? variationSummaries[product.id]
    : [];
  const variants = rawVariations.map((variation) =>
    mapVariation(variation, product),
  );
  const variantPrices = variants
    .map((variation) => variation.price)
    .filter((price) => price !== null);
  const current = money(
    product?.price ?? product?.sale_price ?? product?.regular_price,
  );
  const regular = money(product?.regular_price);
  const sale = money(product?.sale_price);
  const priceMin = variantPrices.length
    ? Math.min(...variantPrices)
    : current;
  const priceMax = variantPrices.length
    ? Math.max(...variantPrices)
    : current;
  const hasVariationStock = variants.some((variation) => variation.in_stock);
  const inStock = variants.length
    ? hasVariationStock
    : product?.stock_status === "instock" && product?.purchasable !== false;
  const knownVariantQuantities = variants
    .map((variation) => variation.stock_quantity)
    .filter((quantity) => Number.isFinite(quantity));
  const hasParentQuantity = ![
    null,
    undefined,
    "",
  ].includes(product?.stock_quantity);
  const parentQuantity =
    hasParentQuantity && Number.isFinite(Number(product.stock_quantity))
      ? Math.max(0, Number(product.stock_quantity))
      : null;
  const stockQuantity =
    parentQuantity !== null
      ? parentQuantity
      : knownVariantQuantities.length
        ? knownVariantQuantities.reduce((total, quantity) => total + quantity, 0)
        : null;
  const image = primaryImage(product);

  return {
    id: Number(product?.id || 0),
    name: cleanText(product?.name),
    slug: String(product?.slug || ""),
    sku: String(product?.sku || ""),
    type: String(product?.type || "simple"),
    url: affiliateUrl(`/product/${encodeURIComponent(product.slug)}`),
    price: current ?? priceMin,
    regular_price: regular,
    sale_price: sale,
    currency: CURRENCY,
    formatted_price: formatMoney(current ?? priceMin),
    price_range: {
      min: priceMin,
      max: priceMax,
      min_formatted: formatMoney(priceMin),
      max_formatted: formatMoney(priceMax),
    },
    on_sale:
      (regular !== null && current !== null && current < regular) ||
      variants.some((variation) => variation.on_sale),
    stock_status: inStock ? "instock" : "outofstock",
    stock_quantity: stockQuantity,
    stock_quantity_is_complete:
      variants.length === 0 ||
      knownVariantQuantities.length === variants.length,
    in_stock: inStock,
    purchasable: product?.purchasable !== false,
    backorders_allowed: product?.backorders_allowed === true,
    available_variant_count: variants.filter((variation) => variation.in_stock)
      .length,
    image: image?.src || null,
    image_alt: image?.alt || cleanText(product?.image_alt || product?.name),
    image_data: image,
    short_description: cleanText(product?.short_description),
    featured: product?.featured === true,
    is_new: product?.is_new === true,
    categories: Array.isArray(product?.categories)
      ? product.categories.map((category) => ({
          id: Number(category?.id || 0),
          name: cleanText(category?.name),
          slug: String(category?.slug || ""),
        }))
      : [],
    attributes: Array.isArray(product?.attributes)
      ? product.attributes.map((attribute) => ({
          id: Number(attribute?.id || 0),
          name: cleanText(attribute?.name),
          slug: String(attribute?.slug || ""),
          options: Array.isArray(attribute?.options)
            ? attribute.options.map(cleanText).filter(Boolean)
            : [],
        }))
      : [],
    date_modified:
      product?.date_modified_gmt || product?.date_modified || null,
    variants,
  };
}

async function callProducts(requestUrl, originalRequest, signal) {
  const forwardedFor = originalRequest.headers.get("x-forwarded-for");
  const request = new Request(requestUrl, {
    headers: {
      Accept: "application/json",
      ...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}),
    },
    signal,
  });
  const response = await getProducts({ request });
  const payload = await response.json().catch(() => null);

  if (!response.ok || payload?.success !== true) {
    throw new Error("Product catalog is temporarily unavailable.");
  }

  return payload;
}

function getBasicAuthHeader(consumerKey, consumerSecret) {
  return `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}`;
}

async function loadAffiliateCoupon(signal) {
  const wcUrl = String(
    import.meta.env.WC_API_URL || import.meta.env.PUBLIC_WP_URL || "",
  ).replace(/\/+$/, "");
  const consumerKey = import.meta.env.WC_CONSUMER_KEY;
  const consumerSecret = import.meta.env.WC_CONSUMER_SECRET;

  if (!wcUrl || !consumerKey || !consumerSecret) {
    return { active: false, status: "unavailable", discount: null };
  }

  try {
    const endpoint = new URL(`${wcUrl}/wp-json/wc/v3/coupons`);
    endpoint.searchParams.set("code", AFFILIATE_COUPON);
    endpoint.searchParams.set("per_page", "1");
    endpoint.searchParams.set(
      "_fields",
      "id,code,status,discount_type,amount,date_expires",
    );
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: getBasicAuthHeader(consumerKey, consumerSecret),
      },
      signal,
    });
    const coupons = await response.json().catch(() => []);
    const coupon = Array.isArray(coupons) ? coupons[0] : null;

    if (!response.ok || !coupon) {
      return { active: false, status: "not_found", discount: null };
    }

    const expiresTimestamp = Date.parse(coupon.date_expires || "");
    const expiresAt = Number.isFinite(expiresTimestamp)
      ? new Date(expiresTimestamp).toISOString()
      : null;
    const expired = expiresAt ? expiresTimestamp <= Date.now() : false;
    const active = coupon.status === "publish" && !expired;

    return {
      active,
      status: expired ? "expired" : active ? "active" : "inactive",
      discount: {
        type: String(coupon.discount_type || ""),
        amount: money(coupon.amount),
        expires_at: expiresAt,
      },
    };
  } catch {
    return { active: false, status: "unavailable", discount: null };
  }
}

async function loadFreshFeed(request, signal) {
  const catalogUrl = new URL("/api/products", request.url);
  catalogUrl.searchParams.set("limit", "100");

  const [catalog, affiliate] = await Promise.all([
    callProducts(catalogUrl, request, signal),
    loadAffiliateCoupon(signal),
  ]);
  const products = Array.isArray(catalog.products) ? catalog.products : [];
  const variableProductIds = products
    .filter((product) => product?.type === "variable")
    .map((product) => Number(product.id))
    .filter((id) => Number.isInteger(id) && id > 0);
  const variationSummaries = {};
  const failedVariationIds = [];

  await Promise.all(
    chunk(variableProductIds, MAX_VARIATION_BATCH_SIZE).map(async (ids) => {
      const url = new URL("/api/products", request.url);
      url.searchParams.set("option_ids", ids.join(","));

      try {
        const payload = await callProducts(url, request, signal);
        Object.assign(variationSummaries, payload.summaries || {});
        failedVariationIds.push(...(payload.failed_ids || []));
      } catch {
        failedVariationIds.push(...ids);
      }
    }),
  );

  const normalizedProducts = products.map((product) =>
    mapProduct(product, variationSummaries),
  );
  const generatedAt = new Date().toISOString();

  return {
    generatedAt,
    updatedAt: catalog.updatedAt || generatedAt,
    products: normalizedProducts,
    affiliate,
    failedVariationIds: [...new Set(failedVariationIds)].sort((a, b) => a - b),
  };
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed)
    ? Math.min(Math.max(parsed, 1), MAX_RESULTS)
    : MAX_RESULTS;
}

function filterProducts(products, url) {
  const query = cleanText(url.searchParams.get("q") || "").toLowerCase();
  const type = cleanText(url.searchParams.get("type") || "").toLowerCase();
  const category = cleanText(
    url.searchParams.get("category") || "",
  ).toLowerCase();
  const stock = cleanText(url.searchParams.get("stock") || "all").toLowerCase();
  const limit = normalizeLimit(url.searchParams.get("limit"));

  const filtered = products.filter((product) => {
    if (type && type !== "all" && product.type.toLowerCase() !== type) {
      return false;
    }

    if (stock === "in" && !product.in_stock) return false;
    if (stock === "out" && product.in_stock) return false;

    if (
      category &&
      !product.categories.some(
        (item) =>
          item.slug.toLowerCase() === category ||
          item.name.toLowerCase() === category,
      )
    ) {
      return false;
    }

    if (query) {
      const haystack = [
        product.name,
        product.slug,
        product.sku,
        ...product.variants.flatMap((variation) => [
          variation.name,
          variation.sku,
        ]),
      ]
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(query)) return false;
    }

    return true;
  });

  return {
    products: filtered.slice(0, limit),
    filters: {
      q: query || null,
      type: type || "all",
      category: category || null,
      stock: ["in", "out"].includes(stock) ? stock : "all",
      limit,
    },
    matched: filtered.length,
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function responseHeaders({ etag, cacheStatus }) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, If-None-Match",
    "Access-Control-Expose-Headers": "ETag, X-Feed-Cache, X-Feed-Version",
    "Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=300",
    "Content-Type": "application/json; charset=utf-8",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "X-Feed-Cache": cacheStatus,
    "X-Feed-Version": FEED_VERSION,
  };
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Accept, If-None-Match",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function GET({ request }) {
  const now = Date.now();
  const cacheAge = feedCache ? now - feedCache.cachedAt : Infinity;
  let source = feedCache?.payload || null;
  let cacheStatus = "HIT";
  let stale = false;

  if (!source || cacheAge >= FEED_CACHE_TTL_MS) {
    const timeout = AbortSignal.timeout(15_000);
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeout])
      : timeout;

    try {
      source = await loadFreshFeed(request, signal);
      feedCache = { payload: source, cachedAt: Date.now() };
      cacheStatus = "MISS";
    } catch {
      if (source && cacheAge < FEED_STALE_TTL_MS) {
        stale = true;
        cacheStatus = "STALE";
      } else {
        return new Response(
          JSON.stringify({
            success: false,
            error: "catalog_unavailable",
            message: "The affiliate catalog is temporarily unavailable.",
          }),
          {
            status: 503,
            headers: {
              ...responseHeaders({ etag: 'W/"unavailable"', cacheStatus: "ERROR" }),
              "Cache-Control": "no-store",
            },
          },
        );
      }
    }
  }

  const requestUrl = new URL(request.url);
  const filtered = filterProducts(source.products, requestUrl);
  const products = filtered.products;
  const variantCount = products.reduce(
    (total, product) => total + product.variants.length,
    0,
  );
  const payload = {
    success: true,
    schema_version: FEED_VERSION,
    feed: FEED_NAME,
    store: {
      name: SITE_NAME,
      url: SITE_URL,
      currency: CURRENCY,
    },
    affiliate: {
      code: AFFILIATE_COUPON,
      query_parameter: "coupon",
      active: source.affiliate.active,
      status: source.affiliate.status,
      discount: source.affiliate.discount,
      validation: "Eligibility and final discount are verified at checkout.",
    },
    generated_at: source.generatedAt,
    updated_at: source.updatedAt,
    refresh_seconds: FEED_CACHE_TTL_MS / 1000,
    stale,
    request: filtered.filters,
    counts: {
      products: products.length,
      matched_products: filtered.matched,
      total_products: source.products.length,
      variants: variantCount,
      in_stock: products.filter((product) => product.in_stock).length,
      out_of_stock: products.filter((product) => !product.in_stock).length,
    },
    data_quality: {
      complete: source.failedVariationIds.length === 0,
      variation_product_failures: source.failedVariationIds,
    },
    links: {
      self: requestUrl.toString(),
      store: SITE_URL,
      shop: affiliateUrl("/shop"),
      documentation: `${SITE_URL}/api/feed`,
    },
    products,
  };
  const body = JSON.stringify(payload, null, 2);
  const etag = `W/"${hashString(body)}"`;
  const headers = responseHeaders({ etag, cacheStatus });

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(body, { status: 200, headers });
}
