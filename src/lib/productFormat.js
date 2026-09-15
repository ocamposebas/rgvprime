const FORMAT_WORDS = /\b(?:format|purchase|pack|presentation)\b/i;
const KIT_WORDS = /\b(?:kit|kits|bundle|bundles|pack|box)\b/i;
const SINGLE_WORDS = /\b(?:single|singles|one vial|1 vial|unit)\b/i;

export const PRODUCT_FORMATS = Object.freeze({
  ALL: "all",
  SINGLE: "singles",
  KIT: "kits",
});

export function normalizeProductFormatValue(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[×]/g, "x")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isKitFormatValue(value = "") {
  const normalized = normalizeProductFormatValue(value);

  return KIT_WORDS.test(normalized) || /(?:^|\s)x\s*\d+\b/.test(normalized);
}

export function isSingleFormatValue(value = "") {
  return SINGLE_WORDS.test(normalizeProductFormatValue(value));
}

export function isPurchaseFormatAttribute(attributeOrName) {
  const name =
    typeof attributeOrName === "string"
      ? attributeOrName
      : attributeOrName?.name || attributeOrName?.slug || "";
  const options =
    typeof attributeOrName === "object" && Array.isArray(attributeOrName?.options)
      ? attributeOrName.options
      : [];

  if (FORMAT_WORDS.test(normalizeProductFormatValue(name))) return true;

  return options.some(
    (option) => isKitFormatValue(option) || isSingleFormatValue(option),
  );
}

export function getPackSize(value = "") {
  const normalized = normalizeProductFormatValue(value);
  const match =
    normalized.match(/(?:^|\s)x\s*(\d+)\b/) ||
    normalized.match(/\b(\d+)\s*(?:vials?|units?|pack)\b/);

  return match ? Number(match[1]) : null;
}

export function getFormatMeta(value = "") {
  const kit = isKitFormatValue(value);
  const packSize = kit ? getPackSize(value) : 1;

  if (kit) {
    return {
      kind: PRODUCT_FORMATS.KIT,
      label: packSize ? `${packSize} Vial Kits` : "Vial Kits",
      eyebrow: "Multi-vial format",
      description: packSize
        ? `${packSize} sealed vials in one order`
        : "Multi-vial research format",
      packSize,
    };
  }

  return {
    kind: PRODUCT_FORMATS.SINGLE,
    label: "Single vial",
    eyebrow: "Individual format",
    description: "One sealed vial per unit",
    packSize: 1,
  };
}

export function findPurchaseFormatAttribute(attributes = []) {
  if (!Array.isArray(attributes)) return null;

  return attributes.find(isPurchaseFormatAttribute) || null;
}

export function getProductFormatSupport(product = {}) {
  const formatAttribute = findPurchaseFormatAttribute(product?.attributes);
  const options = Array.isArray(formatAttribute?.options)
    ? formatAttribute.options.filter(Boolean)
    : [];
  const kitOption = options.find(isKitFormatValue) || null;
  const singleOption = options.find(isSingleFormatValue) || null;
  const isSimpleProduct = product?.type !== "variable";

  return {
    singles: isSimpleProduct || Boolean(singleOption) || !kitOption,
    kits: Boolean(kitOption),
    singleOption,
    kitOption,
    formatAttribute,
  };
}

export function sortPurchaseAttributes(attributes = []) {
  if (!Array.isArray(attributes)) return [];

  return [...attributes].sort((a, b) => {
    const aIsFormat = isPurchaseFormatAttribute(a);
    const bIsFormat = isPurchaseFormatAttribute(b);

    if (aIsFormat === bIsFormat) return 0;
    return aIsFormat ? -1 : 1;
  });
}
