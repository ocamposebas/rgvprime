import { allowsBackorders, isProductAvailable } from "./inventory.js";
import {
  getPackSize,
  getProductFormatSupport,
  isApparelProduct,
  isPurchaseFormatAttribute,
} from "./productFormat.js";

export const SITE_NAME = "RGVPRIME LLC";
export const SITE_URL = "https://rgvprimellc.com";

const SELLER_SCHEMA = {
  "@type": "Organization",
  "@id": `${SITE_URL}/#organization`,
  name: SITE_NAME,
  url: SITE_URL,
};

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
  const apparel = isApparelProduct(product);
  const category = apparel ? "apparel" : getProductCategoryLabel(product);
  const { singleOption, kitOption } = getProductFormatSupport(product);
  const kitSize = getPackSize(kitOption || "");
  const kitLabel = kitSize ? `${kitSize}-vial kit` : "multi-vial kit";
  const formats = apparel
    ? []
    : [singleOption && "a single vial", kitOption && `a ${kitLabel}`].filter(Boolean);
  const strengths = getListedStrengths(product);
  const strengthsInName = getStrengthLabels(name);
  const missingStrengths = strengths.filter(
    (strength) => !strengthsInName.includes(strength),
  );
  const titleStrength = !apparel && missingStrengths.length && strengths.length <= 2
    ? missingStrengths.join(" / ")
    : "";
  const titleName = [name, titleStrength].filter(Boolean).join(" ");
  const titleDetail = formats.length
    ? "Research Vials"
    : {
        apparel: "Apparel",
        "laboratory supply": "Lab Supply",
        "research solution": "Lab Solution",
        "laboratory research product": "Laboratory Research",
      }[category];
  const formatsText = formats.length ? `Listed as ${formats.join(" or ")}.` : "";
  const strengthsText = missingStrengths.length && !apparel
    ? `Listed strengths: ${strengths.join(", ")}.`
    : "";
  const intro = formats.length ? `${name}.` : `${name} | ${titleDetail}.`;
  const summary = [intro, strengthsText, formatsText].filter(Boolean).join(" ");
  const description = [
    !apparel && `${summary} Check price, availability, and any published COA.`,
    `${summary} Check price and availability.`,
    summary,
    intro,
  ].find((text) => text && text.length <= 150) || name.slice(0, 150).trimEnd();
  const productSummary = [formatsText, strengthsText].filter(Boolean).join(" ");

  return {
    title: `${titleName} | ${titleDetail}`,
    description,
    productSummary,
    researchUse: !apparel,
    imageAlt: getProductImageAlt(product),
  };
}

function getStrengthLabels(text) {
  return (text.toLowerCase().match(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu)\b/g) || [])
    .map((label) => label.replace(/\s+/g, ""));
}

function getListedStrengths(product) {
  const attributes = Array.isArray(product.attributes) ? product.attributes : [];
  const values = attributes
    .filter((attribute) => !isPurchaseFormatAttribute(attribute))
    .flatMap((attribute) => Array.isArray(attribute.options) ? attribute.options : [])
    .map((value) => String(value).trim().toLowerCase().replace(/\s+/g, ""))
    .filter((value) => /^\d+(?:\.\d+)?(?:mg|mcg|g|ml|iu)$/.test(value));
  return [...new Set(values)].sort((a, b) => parseFloat(a) - parseFloat(b));
}

function getOfferAvailability(item) {
  if (!isProductAvailable(item)) return "OutOfStock";
  if (allowsBackorders(item) && !isProductAvailable({ ...item, backorders_allowed: false })) {
    return "BackOrder";
  }
  return "InStock";
}

export function buildProductOffer(item, { currentPrice, currency }, canonicalUrl) {
  if (!item || !Number.isFinite(currentPrice) || currentPrice < 0) return null;

  return {
    "@type": "Offer",
    url: canonicalUrl,
    priceCurrency: currency,
    price: currentPrice.toFixed(2),
    availability: `https://schema.org/${getOfferAvailability(item)}`,
    itemCondition: "https://schema.org/NewCondition",
    seller: SELLER_SCHEMA,
    ...(item.sku ? { sku: String(item.sku) } : {}),
  };
}
