import coaData from "../components/data/coas.json";

const SITE_URL = "https://rgvprimellc.com";
const CART_ID_STORAGE_KEY = "rgv-prime-omnisend-cart-id";
const IDENTIFIED_EMAIL_STORAGE_KEY = "rgv-prime-omnisend-email";
const RECOVERY_PARAM = "rgv_cart_recovery";
const RESEARCH_NOTICE = "For laboratory research use only. Not for human consumption.";

function isBrowser() {
  return typeof window !== "undefined";
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function decodeHtmlEntities(value = "") {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(value = "") {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value = "", maxLength = 320) {
  const cleanValue = String(value || "").trim();

  if (cleanValue.length <= maxLength) return cleanValue;

  return `${cleanValue.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function normalizeMatchValue(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&amp;/gi, "and")
    .replace(/\+/g, "plus")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function getStrength(value = "") {
  const match = String(value || "")
    .toLowerCase()
    .match(/(\d+(?:\.\d+)?)\s*(mcg|mg|g|iu|ml)\b/i);

  return match ? `${Number(match[1])}${match[2].toLowerCase()}` : "";
}

function getItemTitle(item = {}) {
  return String(
    item.name || item.title || item.product_name || item.product?.name || "Research product"
  ).trim();
}

function getItemVariant(item = {}) {
  if (item.selectedOption || item.selected_option) {
    return String(item.selectedOption || item.selected_option).trim();
  }

  const selected =
    item.selectedAttributes ||
    item.selectedOptions ||
    item.variation_attributes ||
    item.variation ||
    {};

  if (!selected || typeof selected !== "object" || Array.isArray(selected)) {
    return "";
  }

  return Object.values(selected)
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" · ");
}

function getItemDescription(item = {}) {
  const description = stripHtml(
    item.short_description ||
      item.shortDescription ||
      item.description ||
      item.product?.short_description ||
      item.product?.description ||
      ""
  );

  return truncate(
    description || "A documented research-use-only laboratory product.",
    300
  );
}

function getItemImage(item = {}) {
  return String(
    item.image ||
      item.image_url ||
      item.imageUrl ||
      item.thumbnail ||
      item.images?.[0]?.src ||
      item.product?.image ||
      "/logo.webp"
  ).trim();
}

function getItemProductId(item = {}) {
  return String(
    item.product_id ||
      item.productId ||
      item.wc_product_id ||
      item.parent_id ||
      item.parentId ||
      item.id ||
      ""
  ).trim();
}

function getItemVariationId(item = {}) {
  return String(
    item.variation_id ||
      item.variationId ||
      item.selectedVariationId ||
      item.variant_id ||
      item.variantId ||
      ""
  ).trim();
}

function getItemQuantity(item = {}) {
  return Math.max(1, Math.floor(toNumber(item.quantity || item.qty || 1, 1)));
}

function getItemPrice(item = {}) {
  return Math.max(
    0,
    toNumber(item.price ?? item.sale_price ?? item.regular_price ?? item.unit_price, 0)
  );
}

function getItemRegularPrice(item = {}) {
  return Math.max(0, toNumber(item.regular_price ?? item.price, getItemPrice(item)));
}

function getItemCategories(item = {}) {
  const categories = Array.isArray(item.categories) ? item.categories : [];

  return categories
    .map((category) => ({
      id: String(category?.id || category?.slug || category?.name || "research"),
      title: String(category?.name || category?.title || "Research Product"),
    }))
    .filter((category) => category.id && category.title)
    .slice(0, 10);
}

function absoluteUrl(value = "", baseUrl = SITE_URL) {
  const cleanValue = String(value || "").trim();

  try {
    return new URL(cleanValue || "/", baseUrl).toString();
  } catch {
    return new URL("/", SITE_URL).toString();
  }
}

function getProductUrl(item = {}) {
  const slug = String(item.slug || item.product?.slug || "")
    .replace(/^\/+|\/+$/g, "")
    .trim();

  if (slug) return absoluteUrl(`/product/${slug}`);

  const permalink = item.permalink || item.product_url || item.productURL;

  if (permalink) return absoluteUrl(permalink);

  return absoluteUrl("/shop");
}

function getCOAFiles() {
  const companies = Array.isArray(coaData?.companies) ? coaData.companies : [];

  return companies.flatMap((company) =>
    (Array.isArray(company?.files) ? company.files : []).filter(Boolean)
  );
}

function getCOAMatchScore(item, file) {
  const itemFields = [
    getItemTitle(item),
    item.slug,
    item.sku,
    getItemVariant(item),
  ]
    .map(normalizeMatchValue)
    .filter(Boolean);

  const aliases = [
    file?.product,
    file?.sku,
    file?.lot,
    file?.canonical_key,
    ...(Array.isArray(file?.aliases) ? file.aliases : []),
  ]
    .map(normalizeMatchValue)
    .filter(Boolean);

  let score = 0;

  itemFields.forEach((itemField) => {
    aliases.forEach((alias) => {
      if (itemField === alias) score = Math.max(score, 100);
      else if (alias.length >= 5 && itemField.includes(alias)) score = Math.max(score, 75);
      else if (itemField.length >= 5 && alias.includes(itemField)) score = Math.max(score, 60);
    });
  });

  if (!score) return 0;

  const itemStrength = getStrength(
    [getItemTitle(item), getItemVariant(item), item.sku].filter(Boolean).join(" ")
  );
  const fileStrength = getStrength([file?.product, file?.sku, file?.lot].join(" "));

  if (itemStrength && fileStrength) {
    score += itemStrength === fileStrength ? 40 : -80;
  }

  return score;
}

function getDocumentation(item = {}) {
  const directUrl = item.coa_url || item.coaURL || item.documentation_url;

  if (directUrl) {
    return {
      url: absoluteUrl(directUrl),
      code: String(item.coa_code || item.coaCode || "").trim(),
      direct: true,
    };
  }

  const matchedFile = getCOAFiles()
    .map((file) => ({ file, score: getCOAMatchScore(item, file) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)[0]?.file;

  if (matchedFile?.url) {
    return {
      url: absoluteUrl(matchedFile.url),
      code: String(matchedFile.code || "").trim(),
      direct: true,
    };
  }

  return {
    url: absoluteUrl(`/coa?q=${encodeURIComponent(getItemTitle(item))}`),
    code: "",
    direct: false,
  };
}

function getCurrentOrigin() {
  return isBrowser() ? window.location.origin : SITE_URL;
}

function createUUID() {
  if (isBrowser() && typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function getCartId() {
  if (!isBrowser()) return createUUID();

  const storedId = window.localStorage.getItem(CART_ID_STORAGE_KEY);

  if (storedId) return storedId;

  const nextId = createUUID();
  window.localStorage.setItem(CART_ID_STORAGE_KEY, nextId);
  return nextId;
}

function encodeBase64Url(value) {
  if (!isBrowser()) return "";

  const bytes = new TextEncoder().encode(value);
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  if (!isBrowser() || !value) return "";

  const base64 = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = window.atob(`${base64}${padding}`);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  return new TextDecoder().decode(bytes);
}

function getRecoveryItem(item = {}) {
  return {
    product_id: toNumber(getItemProductId(item), 0),
    variation_id: toNumber(getItemVariationId(item), 0),
    name: getItemTitle(item),
    slug: String(item.slug || ""),
    sku: String(item.sku || ""),
    price: getItemPrice(item),
    regular_price: getItemRegularPrice(item),
    image: getItemImage(item),
    quantity: getItemQuantity(item),
    selectedOption: getItemVariant(item),
    selectedAttributes:
      item.selectedAttributes || item.selectedOptions || item.variation || {},
    short_description: getItemDescription(item),
    stock_status: "instock",
  };
}

export function createCartRecoveryUrl(items = []) {
  const url = new URL("/checkout", getCurrentOrigin());
  const recoveryItems = (Array.isArray(items) ? items : [])
    .map(getRecoveryItem)
    .filter((item) => item.product_id > 0 && item.quantity > 0);

  if (recoveryItems.length) {
    url.searchParams.set(RECOVERY_PARAM, encodeBase64Url(JSON.stringify(recoveryItems)));
  }

  return url.toString();
}

export function readCartRecoveryFromUrl() {
  if (!isBrowser()) return [];

  try {
    const value = new URL(window.location.href).searchParams.get(RECOVERY_PARAM);
    if (!value) return [];

    const decoded = JSON.parse(decodeBase64Url(value));

    return Array.isArray(decoded)
      ? decoded.filter(
          (item) => toNumber(item?.product_id, 0) > 0 && toNumber(item?.quantity, 0) > 0
        )
      : [];
  } catch (error) {
    console.warn("Invalid cart recovery link:", error);
    return [];
  }
}

export function buildOmnisendLineItem(item = {}) {
  const productPrice = getItemPrice(item);
  const regularPrice = getItemRegularPrice(item);
  const productURL = getProductUrl(item);
  const productImageURL = absoluteUrl(getItemImage(item), getCurrentOrigin());
  const productDescription = truncate(
    `${getItemDescription(item)} View research details and available COA documentation on the product page.`,
    380
  );
  const documentation = getDocumentation(item);
  const productQuantity = getItemQuantity(item);
  const productID = getItemProductId(item);
  const productVariantID = getItemVariationId(item);
  const productCategories = getItemCategories(item);

  const standardItem = {
    productID,
    productDescription,
    productImageURL,
    productPrice,
    productQuantity,
    productSKU: String(item.sku || productID),
    productTitle: getItemTitle(item),
    productURL,
  };

  if (productCategories.length) standardItem.productCategories = productCategories;
  if (productVariantID) {
    standardItem.productVariantID = productVariantID;
    standardItem.productVariantImageURL = productImageURL;
  }
  if (regularPrice > productPrice) {
    standardItem.productStrikeThroughPrice = regularPrice;
    standardItem.productDiscount = regularPrice - productPrice;
  }

  return {
    standardItem,
    rgvItem: {
      ...standardItem,
      productVariant: getItemVariant(item) || "Standard configuration",
      productPriceFormatted: new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(productPrice),
      lineTotal: productPrice * productQuantity,
      coaURL: documentation.url,
      coaCode: documentation.code,
      coaLabel: documentation.direct ? "View active COA" : "Search documentation",
      researchUseNotice: RESEARCH_NOTICE,
    },
  };
}

export function buildOmnisendCartEvent(items = [], addedItem = null, contact = {}) {
  const safeItems = (Array.isArray(items) ? items : []).filter(Boolean);
  const mappedItems = safeItems.map(buildOmnisendLineItem);
  const mappedAddedItem = buildOmnisendLineItem(addedItem || safeItems.at(-1) || {});
  const email = normalizeEmail(contact?.email);

  const payload = {
    origin: "api",
    eventID: createUUID(),
    eventVersion: "",
    properties: {
      abandonedCheckoutURL: createCartRecoveryUrl(safeItems),
      cartID: getCartId(),
      currency: "USD",
      value: mappedItems.reduce(
        (total, item) =>
          total + item.standardItem.productPrice * item.standardItem.productQuantity,
        0
      ),
      addedItem: mappedAddedItem.standardItem,
      lineItems: mappedItems.map((item) => item.standardItem),
      rgvLineItems: mappedItems.map((item) => item.rgvItem),
      researchUseNotice: RESEARCH_NOTICE,
    },
  };

  if (email) payload.contact = { email };

  return payload;
}

function canUseOmnisend() {
  return Boolean(
    isBrowser() &&
      window.__RGV_OMNISEND_ENABLED__ &&
      window.omnisend &&
      typeof window.omnisend.push === "function"
  );
}

function queueOmnisendEvent(eventName, payload) {
  if (!canUseOmnisend()) return false;

  window.omnisend.push(["track", eventName, payload]);
  return true;
}

export function trackOmnisendCart(items = [], addedItem = null, contact = {}) {
  if (!Array.isArray(items) || !items.length) return false;

  return queueOmnisendEvent(
    "added product to cart",
    buildOmnisendCartEvent(items, addedItem, contact)
  );
}

export function trackOmnisendStartedCheckout(items = [], contact = {}) {
  if (!Array.isArray(items) || !items.length) return false;

  const payload = buildOmnisendCartEvent(items, items.at(-1), contact);
  delete payload.properties.addedItem;

  return queueOmnisendEvent("started checkout", payload);
}

export function identifyOmnisendContact(contact = {}) {
  const email = normalizeEmail(contact.email);

  if (!isBrowser() || !isValidEmail(email) || !window.__RGV_OMNISEND_ENABLED__) {
    return Promise.resolve(false);
  }

  window.localStorage.setItem(IDENTIFIED_EMAIL_STORAGE_KEY, email);

  return new Promise((resolve) => {
    let attempts = 0;

    const identify = () => {
      attempts += 1;

      if (typeof window.omnisend?.identifyContact === "function") {
        window.omnisend.identifyContact({
          email,
          ...(contact.phone ? { phone: String(contact.phone).trim() } : {}),
        });
        resolve(true);
        return;
      }

      if (attempts >= 12) {
        resolve(false);
        return;
      }

      window.setTimeout(identify, 250);
    };

    identify();
  });
}

export function getRememberedOmnisendEmail() {
  if (!isBrowser()) return "";

  const email = normalizeEmail(window.localStorage.getItem(IDENTIFIED_EMAIL_STORAGE_KEY));
  return isValidEmail(email) ? email : "";
}

export function resetOmnisendCartSession() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(CART_ID_STORAGE_KEY);
}

export function getOmnisendCartFingerprint(items = [], email = "") {
  return JSON.stringify({
    email: normalizeEmail(email),
    items: (Array.isArray(items) ? items : []).map((item) => ({
      id: getItemProductId(item),
      variation: getItemVariationId(item),
      quantity: getItemQuantity(item),
      price: getItemPrice(item),
    })),
  });
}
