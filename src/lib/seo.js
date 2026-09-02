export const SITE_NAME = "RGVPRIME LLC";
export const SITE_URL = "https://rgvprimellc.com";

// WooCommerce remains the source of truth for product and variation IDs. These
// aliases change only the public storefront slug.
export const PUBLIC_PRODUCT_SLUGS = new Map([
  ["rgv-tesa", "rg-tesa"],
  ["ll-375-5mg", "ll-37-5mg"],
  ["ss-31-10mg", "ss-31"],
]);

export const WOO_PRODUCT_SLUGS = new Map(
  Array.from(PUBLIC_PRODUCT_SLUGS, ([wooSlug, publicSlug]) => [
    publicSlug,
    wooSlug,
  ]),
);

// Every target is a final canonical URL so redirects remain one hop.
export const PERMANENT_PRODUCT_REDIRECTS = new Map([
  ["cagrilintide-5mg", "/product/rg-cag"],
  ["tesamorelin-10mg", "/product/rg-tesa"],
  ["fat-blaster-10ml", "/product/lemon-bottle-10ml"],
  ["hospira-bac-30ml", "/product/hosp-recon-water"],
  ["bac-water", "/product/recon-water"],
  ["pl-rt", "/product/rg-rt"],
  ["rgv-tesa", "/product/rg-tesa"],
  ["ll-375-5mg", "/product/ll-37-5mg"],
  ["ss-31-10mg", "/product/ss-31"],
  ["retatrutide", "/product/rg-rt"],
  ["retatrutide-10mg", "/product/rg-rt"],
  ["retatrutide-20mg", "/product/rg-rt"],
  ["retatrutide-30mg", "/product/rg-rt"],
  ["tirzepatide", "/product/rg-tz"],
  ["tirzepatide-10mg", "/product/rg-tz"],
  ["tirzepatide-20mg", "/product/rg-tz"],
  ["tirzepatide-30mg", "/product/rg-tz"],
  ["tirzepatide-40mg", "/product/rg-tz"],
]);

const SPECIAL_IMAGE_ALT = new Map([
  ["rg-rt", "RG-Rt laboratory research vial"],
  ["rg-tz", "RG-Tz research compound vial"],
  ["bpc-157-10mg", "BPC-157 laboratory research vial"],
]);

export function toPlainText(value = "") {
  return String(value)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function getPublicProductSlug(slug = "") {
  const cleanSlug = String(slug || "").trim().toLowerCase();
  return PUBLIC_PRODUCT_SLUGS.get(cleanSlug) || cleanSlug;
}

export function getWooProductSlug(slug = "") {
  const cleanSlug = String(slug || "").trim().toLowerCase();
  return WOO_PRODUCT_SLUGS.get(cleanSlug) || cleanSlug;
}

export function getPermanentProductRedirect(slug = "") {
  return PERMANENT_PRODUCT_REDIRECTS.get(
    String(slug || "").trim().toLowerCase(),
  );
}

export function normalizeCanonicalPath(pathname = "/") {
  const lowerPath = String(pathname || "/").toLowerCase();
  const collapsedPath = lowerPath.replace(/\/{2,}/g, "/");

  if (collapsedPath === "/") return "/";

  return collapsedPath.replace(/\/+$/, "") || "/";
}

function getProductName(product = {}) {
  return (
    toPlainText(product?.name || product?.title || "") ||
    "Laboratory Research Product"
  );
}

function getProductCategoryLabel(product = {}) {
  const categorySlugs = new Set(
    (Array.isArray(product?.categories) ? product.categories : [])
      .map((category) => String(category?.slug || "").toLowerCase())
      .filter(Boolean),
  );

  if (categorySlugs.has("supplies")) return "laboratory supply";
  if (categorySlugs.has("research-solutions")) return "research solution";

  return "laboratory research product";
}

export function getProductImageAlt(product = {}) {
  const publicSlug = getPublicProductSlug(product?.slug);
  const specialAlt = SPECIAL_IMAGE_ALT.get(publicSlug);

  if (specialAlt) return specialAlt;

  return `${getProductName(product)} ${getProductCategoryLabel(product)}`;
}

export function getProductSeo(product = {}) {
  const name = getProductName(product);
  const categoryLabel = getProductCategoryLabel(product);

  return {
    title: `${name} ${categoryLabel}`,
    description: `Review ${name} ${categoryLabel} details, configurations, availability, and laboratory documentation for research use only.`,
    imageAlt: getProductImageAlt(product),
  };
}

function getAvailability(value) {
  return value === "instock"
    ? "https://schema.org/InStock"
    : "https://schema.org/OutOfStock";
}

function getValidPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function buildProductOffers(product = {}, canonicalUrl) {
  const variations = Array.isArray(product?.variations)
    ? product.variations
    : [];
  const pricedVariations = variations
    .map((variation) => ({
      variation,
      price: getValidPrice(
        variation?.price ?? variation?.sale_price ?? variation?.regular_price,
      ),
    }))
    .filter(({ variation, price }) => variation?.purchasable !== false && price);

  if (product?.type === "variable" && pricedVariations.length > 0) {
    const prices = pricedVariations.map(({ price }) => price);
    const anyInStock = pricedVariations.some(
      ({ variation }) => variation?.stock_status === "instock",
    );

    return {
      "@type": "AggregateOffer",
      url: canonicalUrl,
      priceCurrency: "USD",
      lowPrice: Math.min(...prices).toFixed(2),
      highPrice: Math.max(...prices).toFixed(2),
      offerCount: pricedVariations.length,
      availability: getAvailability(anyInStock ? "instock" : "outofstock"),
      offers: pricedVariations.map(({ variation, price }) => ({
        "@type": "Offer",
        url: canonicalUrl,
        priceCurrency: "USD",
        price: price.toFixed(2),
        availability: getAvailability(variation?.stock_status),
        ...(variation?.sku ? { sku: String(variation.sku) } : {}),
      })),
    };
  }

  const price = getValidPrice(
    product?.price ?? product?.sale_price ?? product?.regular_price,
  );

  if (!price) return null;

  return {
    "@type": "Offer",
    url: canonicalUrl,
    priceCurrency: "USD",
    price: price.toFixed(2),
    availability: getAvailability(product?.stock_status),
    ...(product?.sku ? { sku: String(product.sku) } : {}),
  };
}
