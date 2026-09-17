import sanitizeHtml from "sanitize-html";
import {
  checkRateLimit,
  requestSecurityResponse,
} from "../../lib/requestSecurity";
import {
  getProductImageAlt,
  getPublicProductSlug,
  getWooProductSlug,
} from "../../lib/seo";

export const prerender = false;

const FALLBACK_IMAGE = "/logo.webp";
const DEFAULT_CATALOG_LIMIT = 70;
const MAX_CATALOG_LIMIT = 100;
const MAX_VARIATION_SUMMARY_PRODUCTS = 16;
const PRODUCT_CACHE_TTL_MS = 60 * 1000;
const PRODUCT_STALE_TTL_MS = 15 * 60 * 1000;
const productResponseCache = new Map();

function storeProductResponse(cacheKey, payload) {
  productResponseCache.set(cacheKey, { payload, cachedAt: Date.now() });

  if (productResponseCache.size > 200) {
    const oldestKey = productResponseCache.keys().next().value;
    if (oldestKey) productResponseCache.delete(oldestKey);
  }
}

const PRODUCTS_WITHOUT_COA = new Set([
  "ahk-cu-100mg",
  "l-carnitine-600mg",
  "aod-9604",
]);

const NO_CACHE_CONTROL = "no-store, no-cache, must-revalidate, max-age=0";

const DESCRIPTION_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "ul",
  "ol",
  "li",
  "h2",
  "h3",
  "h4",
  "blockquote",
  "a",
  "span",
];

function sanitizeProductDescription(value) {
  return sanitizeHtml(String(value || ""), {
    allowedTags: DESCRIPTION_TAGS,
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      span: ["class"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          rel: "noopener noreferrer nofollow",
          ...(attribs.target === "_blank" ? { target: "_blank" } : {}),
        },
      }),
    },
  });
}

function sanitizePriceHtml(value) {
  return sanitizeHtml(String(value || ""), {
    allowedTags: ["span", "bdi", "del", "ins", "small"],
    allowedAttributes: {
      span: ["class", "aria-hidden"],
      del: ["aria-hidden"],
      ins: ["aria-hidden"],
      small: ["class"],
    },
  });
}

function jsonResponse(data, status = 200, cacheStatus = "BYPASS", cacheable = false) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cacheable
        ? "public, max-age=30, s-maxage=60, stale-while-revalidate=600"
        : NO_CACHE_CONTROL,
      ...(cacheable
        ? { "CDN-Cache-Control": "public, max-age=60, stale-while-revalidate=600" }
        : { Pragma: "no-cache", Expires: "0" }),
      "X-Product-Cache": cacheStatus,
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

function parseVariationSummaryIds(value) {
  if (!value) return [];

  return [
    ...new Set(
      String(value)
        .split(",")
        .map((item) => Number(item.trim()))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ]
    .sort((a, b) => a - b)
    .slice(0, MAX_VARIATION_SUMMARY_PRODUCTS);
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

function compactImageSrcset(value, version) {
  const candidates = String(value || "")
    .split(",")
    .map((candidate) => {
      const match = candidate.trim().match(/^(.*)\s+(\d+)w$/);

      return match
        ? { src: match[1].trim(), width: Number(match[2]) }
        : null;
    })
    .filter(
      (candidate) =>
        candidate?.src && Number.isFinite(candidate.width) && candidate.width > 0,
    )
    .sort((a, b) => a.width - b.width);

  if (!candidates.length) return undefined;

  const selectedCandidates = [300, 600, 1024].map((targetWidth) =>
    candidates.reduce((closest, candidate) =>
      Math.abs(candidate.width - targetWidth) <
      Math.abs(closest.width - targetWidth)
        ? candidate
        : closest,
    ),
  );
  const uniqueCandidates = [
    ...new Map(
      selectedCandidates.map((candidate) => [candidate.width, candidate]),
    ).values(),
  ].sort((a, b) => a.width - b.width);

  return uniqueCandidates
    .map(
      (candidate) =>
        `${withImageCacheBuster(candidate.src, version)} ${candidate.width}w`,
    )
    .join(", ");
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

function removeUnverifiedPurityClaims(value, slug = "") {
  if (!PRODUCTS_WITHOUT_COA.has(String(slug || "").trim())) {
    return value;
  }

  let sanitized = String(value || "");

  if (slug === "aod-9604") {
    sanitized = sanitized.replace(
      /high[\s-]*purity\s+reagent[\s-]*grade\s+synthetic\s+peptide\.?/gi,
      "",
    );
  }

  return sanitized
    .replace(
      /purity\s*:\s*(?:(?:&(?:ge|#8805);|≥)\s*)?99\s*%\s*(?:\(\s*hplc\s*\))?\.?/gi,
      "",
    )
    .replace(/<p>\s*<\/p>/gi, "")
    .replace(/(?:<br\s*\/?>\s*){2,}/gi, "<br>")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function mapTaxonomyItem(item) {
  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
  };
}

function mapProductForCatalog(product) {
  const imageAlt = getProductImageAlt(product);
  const imageVersion = getImageVersion(product);

  return {
    id: product.id,
    name: product.name,
    slug: getPublicProductSlug(product.slug),
    sku: product.sku,
    type: product.type,
    price: product.price,
    regular_price: product.regular_price,
    sale_price: product.sale_price,
    short_description: removeUnverifiedPurityClaims(
      sanitizeProductDescription(product.short_description),
      product.slug,
    ),
    date_modified: product.date_modified,
    date_modified_gmt: product.date_modified_gmt,
    image_alt: imageAlt,
    images: Array.isArray(product.images)
      ? product.images.slice(0, 1).map((image) => ({
          src: withImageCacheBuster(image.src, imageVersion),
          srcset: compactImageSrcset(image.srcset, imageVersion),
          sizes: image.sizes,
          thumbnail: image.thumbnail
            ? withImageCacheBuster(image.thumbnail, imageVersion)
            : undefined,
          alt: imageAlt,
        }))
      : [],
    attributes: Array.isArray(product.attributes)
      ? product.attributes
          .filter((attribute) => attribute?.variation === true)
          .map((attribute) => ({
            id: attribute.id,
            name: attribute.name,
            slug: attribute.slug,
            variation: true,
            options: Array.isArray(attribute.options)
              ? attribute.options.filter(Boolean)
              : [],
          }))
      : [],
    stock_status: product.stock_status,
    stock_quantity: product.stock_quantity,
    manage_stock: product.manage_stock,
    backorders_allowed: product.backorders_allowed,
    purchasable: product.purchasable,
    featured: product.featured,
    categories: Array.isArray(product.categories)
      ? product.categories.map(mapCategory)
      : [],
    tags: Array.isArray(product.tags)
      ? product.tags.map(mapTaxonomyItem)
      : [],
  };
}

function mapProductForDetail(product) {
  const imageAlt = getProductImageAlt(product);

  return {
    id: product.id,
    name: product.name,
    title: product.name,
    slug: getPublicProductSlug(product.slug),
    sku: product.sku,
    type: product.type,
    price: product.price,
    regular_price: product.regular_price,
    sale_price: product.sale_price,
    price_html: sanitizePriceHtml(product.price_html),
    description: removeUnverifiedPurityClaims(
      sanitizeProductDescription(product.description),
      product.slug,
    ),
    short_description: removeUnverifiedPurityClaims(
      sanitizeProductDescription(product.short_description),
      product.slug,
    ),
    date_modified: product.date_modified,
    date_modified_gmt: product.date_modified_gmt,
    image: getWooImage(product),
    image_alt: imageAlt,
    images: Array.isArray(product.images)
      ? product.images.map((image) => ({ ...image, alt: imageAlt }))
      : [],
    attributes: Array.isArray(product.attributes) ? product.attributes : [],
    variations: Array.isArray(product.variations) ? product.variations : [],
    stock_status: product.stock_status,
    stock_quantity: product.stock_quantity,
    manage_stock: product.manage_stock,
    backorders_allowed: product.backorders_allowed,
    purchasable: product.purchasable,
    featured: product.featured,
    weight: product.weight,
    categories: Array.isArray(product.categories)
      ? product.categories.map(mapCategory)
      : [],
    tags: Array.isArray(product.tags)
      ? product.tags.map(mapTaxonomyItem)
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
    price_html: sanitizePriceHtml(variation.price_html),
    description: sanitizeProductDescription(variation.description),
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

function mapVariationForCatalogCard(variation) {
  return {
    id: variation.id,
    sku: variation.sku,
    purchasable: variation.purchasable,
    price: variation.price,
    regular_price: variation.regular_price,
    sale_price: variation.sale_price,
    image: variation?.image?.src || null,
    attributes: Array.isArray(variation.attributes) ? variation.attributes : [],
    stock_status: variation.stock_status,
    stock_quantity: variation.stock_quantity,
    manage_stock: variation.manage_stock,
    backorders_allowed: variation.backorders_allowed,
  };
}

function buildWooEndpoint({
  slug,
  wcUrl,
  limit = DEFAULT_CATALOG_LIMIT,
  featured = null,
  refresh = false,
}) {
  const cleanUrl = wcUrl.replace(/\/$/, "");
  const endpoint = new URL(`${cleanUrl}/wp-json/wc/v3/products`);

  endpoint.searchParams.set("status", "publish");
  if (refresh) endpoint.searchParams.set("_", String(Date.now()));

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
        "purchasable",
        "featured",
        "weight",
        "categories",
        "tags",
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
      "short_description",
      "date_modified",
      "date_modified_gmt",
      "images",
      "attributes",
      "stock_status",
      "stock_quantity",
      "manage_stock",
      "backorders_allowed",
      "purchasable",
      "featured",
      "categories",
      "tags",
    ].join(",")
  );

  return endpoint;
}

function buildWooVariationEndpoint({
  productId,
  wcUrl,
  refresh = false,
  summary = false,
}) {
  const cleanUrl = wcUrl.replace(/\/$/, "");
  const endpoint = new URL(
    `${cleanUrl}/wp-json/wc/v3/products/${productId}/variations`
  );

  endpoint.searchParams.set("per_page", "100");
  endpoint.searchParams.set("orderby", "menu_order");
  endpoint.searchParams.set("order", "asc");
  if (refresh) endpoint.searchParams.set("_", String(Date.now()));

  endpoint.searchParams.set(
    "_fields",
    (summary
      ? [
          "id",
          "sku",
          "purchasable",
          "price",
          "regular_price",
          "sale_price",
          "image",
          "attributes",
          "stock_status",
          "stock_quantity",
          "manage_stock",
          "backorders_allowed",
        ]
      : [
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
        ]
    ).join(",")
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

  return firstResponse;
}

async function parseWooProducts(response) {
  const rawText = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      statusText: response.statusText,
      message: "WooCommerce API request failed.",
      details: "",
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
        details: "",
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
      details: "",
      products: null,
    };
  }
}

function productLooksVariable(rawProduct, product) {
  if (!rawProduct && !product) return false;

  const type = String(rawProduct?.type || product?.type || "")
    .trim()
    .toLowerCase();

  if (type === "variable") return true;

  const variationReferences = [
    ...(Array.isArray(rawProduct?.variations) ? rawProduct.variations : []),
    ...(Array.isArray(product?.variations) ? product.variations : []),
  ];

  return variationReferences.some((variation) => {
    const variationId = Number(
      variation && typeof variation === "object" ? variation.id : variation,
    );

    return Number.isInteger(variationId) && variationId > 0;
  });
}

async function fetchWooProductVariations({
  productId,
  wcUrl,
  consumerKey,
  consumerSecret,
  signal,
  refresh = false,
  summary = false,
}) {
  const numericProductId = Number(productId);

  if (!Number.isInteger(numericProductId) || numericProductId <= 0) {
    throw new Error("A valid product ID is required to load variations.");
  }

  try {
    const variationEndpoint = buildWooVariationEndpoint({
      productId: numericProductId,
      wcUrl,
      refresh,
      summary,
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

      throw new Error("WooCommerce variations response was invalid.");
    }

    return variationResult.products.map(
      summary ? mapVariationForCatalogCard : mapVariationForDetail,
    );
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }

    console.error("WooCommerce variations request failed:", error);
    throw error;
  }
}

async function fetchVariationSummaryBatch({
  productIds,
  wcUrl,
  consumerKey,
  consumerSecret,
  signal,
  refresh,
}) {
  const summaries = {};
  const failedIds = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < productIds.length) {
      const productId = productIds[nextIndex];
      nextIndex += 1;

      try {
        summaries[productId] = await fetchWooProductVariations({
          productId,
          wcUrl,
          consumerKey,
          consumerSecret,
          signal,
          refresh,
          summary: true,
        });
      } catch {
        failedIds.push(productId);
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(4, productIds.length) },
      () => worker(),
    ),
  );

  return { summaries, failedIds };
}

export async function GET({ request }) {
  const requestUrl = new URL(request.url);

  const requestedSlug = requestUrl.searchParams.get("slug");
  const slug = requestedSlug ? getWooProductSlug(requestedSlug) : null;
  const variationSummaryIds = parseVariationSummaryIds(
    requestUrl.searchParams.get("option_ids"),
  );
  const limit = sanitizeLimit(requestUrl.searchParams.get("limit"));
  const featured = normalizeBoolean(requestUrl.searchParams.get("featured"));
  const debug = shouldBypassCache(requestUrl.searchParams.get("debug"));
  const refresh =
    shouldBypassCache(requestUrl.searchParams.get("refresh")) ||
    shouldBypassCache(request.headers.get("cache-control")) ||
    requestUrl.searchParams.has("_");
  const cacheKey = JSON.stringify({
    mode: variationSummaryIds.length
      ? "variation-summary"
      : slug
        ? "detail"
        : "catalog",
    variationSummaryIds,
    slug: slug || "",
    limit,
    featured,
  });
  const cached = productResponseCache.get(cacheKey);
  const cacheAge = cached
    ? Date.now() - cached.cachedAt
    : Number.POSITIVE_INFINITY;

  if (!refresh && !debug && cached && cacheAge < PRODUCT_CACHE_TTL_MS) {
    return jsonResponse(cached.payload, 200, "HIT", true);
  }

  const rate = checkRateLimit(request, {
    namespace: "products",
    limit: 120,
    windowMs: 60 * 1000,
  });

  if (!rate.allowed) {
    if (!refresh && !debug && cached && cacheAge < PRODUCT_STALE_TTL_MS) {
      return jsonResponse({ ...cached.payload, stale: true }, 200, "STALE", true);
    }

    return requestSecurityResponse(
      "Too many product requests. Please wait and try again.",
      429,
      rate.retryAfter,
    );
  }

  const wcUrl = import.meta.env.WC_API_URL || import.meta.env.PUBLIC_WP_URL;
  const consumerKey = import.meta.env.WC_CONSUMER_KEY;
  const consumerSecret = import.meta.env.WC_CONSUMER_SECRET;

  if (!wcUrl || !consumerKey || !consumerSecret) {
    return jsonResponse(
      {
        success: false,
        message: "The product service is not configured.",
      },
      500
    );
  }

  const isDetailRequest = Boolean(slug);

  const endpoint = variationSummaryIds.length
    ? null
    : buildWooEndpoint({
        slug,
        wcUrl,
        limit,
        featured,
        refresh,
      });

  const timeoutSignal = AbortSignal.timeout(6500);
  const upstreamSignal = request.signal
    ? AbortSignal.any([request.signal, timeoutSignal])
    : timeoutSignal;

  try {
    if (variationSummaryIds.length) {
      const { summaries, failedIds } = await fetchVariationSummaryBatch({
        productIds: variationSummaryIds,
        wcUrl,
        consumerKey,
        consumerSecret,
        signal: upstreamSignal,
        refresh,
      });
      const payload = {
        success: true,
        count: Object.keys(summaries).length,
        summaries,
        failed_ids: failedIds,
        cache: refresh ? "refresh" : "fresh",
        updatedAt: new Date().toISOString(),
      };
      const complete = failedIds.length === 0;

      if (!debug && complete) storeProductResponse(cacheKey, payload);

      return jsonResponse(
        payload,
        200,
        refresh ? "REFRESH" : "MISS",
        complete && !refresh && !debug,
      );
    }

    const response = await fetchWooCommerce(
      endpoint,
      consumerKey,
      consumerSecret,
      upstreamSignal
    );

    const result = await parseWooProducts(response);

    if (!result.ok) {
      if (!refresh && cached && cacheAge < PRODUCT_STALE_TTL_MS) {
        return jsonResponse({ ...cached.payload, stale: true }, 200, "STALE", true);
      }

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
          signal: upstreamSignal,
          refresh,
        });

        product.variations = variationDetails;
      }

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

      if (!debug) storeProductResponse(cacheKey, payload);
      return jsonResponse(payload, 200, refresh ? "REFRESH" : "MISS", !refresh && !debug);
    }

    const mappedProducts = products.map(mapProductForCatalog);

    const payload = {
      success: true,
      count: mappedProducts.length,
      products: mappedProducts,
      cache: refresh ? "refresh" : "fresh",
      limit,
      featured,
      updatedAt: new Date().toISOString(),
    };

    if (!debug) storeProductResponse(cacheKey, payload);
    return jsonResponse(payload, 200, refresh ? "REFRESH" : "MISS", !refresh && !debug);
  } catch (error) {
    if (!refresh && cached && cacheAge < PRODUCT_STALE_TTL_MS) {
      return jsonResponse({ ...cached.payload, stale: true }, 200, "STALE", true);
    }

    const isTimeout =
      error?.name === "AbortError" || error?.name === "TimeoutError";

    return jsonResponse(
      {
        success: false,
        message: isTimeout
          ? "WooCommerce took too long to respond."
          : "Server could not reach WooCommerce.",
      },
      500
    );
  }
}
