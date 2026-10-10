export const NEW_PRODUCT_WINDOW_DAYS = 45;

const NEW_PRODUCT_TAGS = new Set([
  "new",
  "new-arrival",
  "new-arrivals",
  "new-product",
  "new-products",
  "nuevo",
  "nuevos",
]);

function normalizeTag(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

function hasNewProductTag(product = {}) {
  return (Array.isArray(product?.tags) ? product.tags : []).some((tag) => {
    const values =
      tag && typeof tag === "object" ? [tag.slug, tag.name] : [tag];

    return values.some((value) => NEW_PRODUCT_TAGS.has(normalizeTag(value)));
  });
}

export function getProductCreatedTime(product = {}) {
  const rawDate = product?.date_created_gmt || product?.date_created;

  if (!rawDate) return 0;

  const normalizedDate =
    product?.date_created_gmt && !/[zZ]|[+-]\d\d:\d\d$/.test(String(rawDate))
      ? `${rawDate}Z`
      : rawDate;
  const time = new Date(normalizedDate).getTime();

  return Number.isFinite(time) ? time : 0;
}

export function isProductNew(product = {}, now = Date.now()) {
  if (product?.is_new === true || hasNewProductTag(product)) return true;

  const createdAt = getProductCreatedTime(product);
  if (!createdAt) return false;

  const age = Number(now) - createdAt;
  const windowMs = NEW_PRODUCT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  return age >= -24 * 60 * 60 * 1000 && age <= windowMs;
}
