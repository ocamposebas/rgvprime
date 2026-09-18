import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  FileCheck2,
  FlaskConical,
  Package,
  SlidersHorizontal,
} from "lucide-react";
import { useCart } from "../cart/CartContext";
import { isProductAvailable } from "../../lib/inventory";
import { calculateLoyaltyPoints, formatPoints } from "../../lib/loyaltyProgram";
import {
  getFormatMeta,
  getProductFormatSupport,
  isApparelProduct,
  isPurchaseFormatAttribute,
  PRODUCT_FORMATS,
} from "../../lib/productFormat";
import "../../styles/storefront.css";

const FALLBACK_IMAGE = "/logo.webp";
const DESKTOP_PRODUCTS_PER_PAGE = 16;
const MOBILE_PRODUCTS_PER_PAGE = 14;
const VARIATION_CACHE_TTL_MS = 60 * 1000;
const variationRequestCache = new Map();
const variationSummaryCache = new Map();
const variationSummaryRequestCache = new Map();

const formatFilters = [
  {
    label: "Single Vials",
    value: PRODUCT_FORMATS.SINGLE,
    description: "1 vial",
  },
  {
    label: "10 Vial Kits",
    value: PRODUCT_FORMATS.KIT,
    description: "10 vials",
  },
];

const sortOptions = [
  { label: "Featured", value: "featured" },
  { label: "Name A-Z", value: "name" },
];

const customProductOrder = [
  {
    rank: 1,
    label: "RG-Rt",
    groups: [["rg", "rt"]],
  },
  {
    rank: 2,
    label: "RG-Tz",
    groups: [["rg", "tz"]],
  },
  {
    label: "Mots C",
    terms: ["mots c", "mots-c", "motsc", "mots"],
  },
  {
    label: "NAD",
    terms: ["nad", "nad plus", "nad+"],
  },
  {
    label: "SS31",
    terms: ["ss31", "ss 31", "ss-31"],
  },
  {
    label: "Tesamorelin",
    terms: ["tesamorelin", "tesa", "tesam"],
  },
  {
    label: "CJC/IPA",
    terms: ["cjc ipa", "cjc/ipa", "cjc ipamorelin", "ipamorelin", "ipa", "cjc"],
  },
  {
    label: "Adamax",
    terms: ["adamax"],
  },
  {
    label: "Semax",
    terms: ["semax"],
  },
  {
    label: "Selank",
    terms: ["selank"],
  },
  {
    label: "GHK-Cu 50/100",
    terms: ["ghk cu", "ghk-cu", "ghkcu", "ghk 50", "ghk 100"],
  },
  {
    label: "Klow",
    terms: ["klow"],
  },
  {
    label: "Glow",
    terms: ["glow"],
  },
  {
    label: "Raw GHK",
    terms: ["raw ghk", "rawghk"],
  },
  {
    label: "Korean Glutathione 1200mg",
    terms: [
      "korean glutathione 1200",
      "korean glutathione",
      "glutathione 1200",
      "glutathione",
      "gluta",
    ],
  },
  {
    label: "Lipo-C/B12",
    terms: ["lipo c b12", "lipo-c/b12", "lipocb12", "lipo c", "lipo b12"],
  },
  {
    label: "Hospira Bac Water",
    terms: [
      "hospira bac water",
      "hospira bacteriostatic water",
      "hospira bac",
      "bac water",
      "bacteriostatic water",
      "bac 30ml",
      "bac",
      "hospira",
    ],
  },
];

function normalizeOrderText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\+/g, " plus ")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getProductOrderText(product) {
  return normalizeOrderText(
    [product?.name, product?.slug, product?.sku].filter(Boolean).join(" "),
  );
}

function matchesOrderTerm(text, compactText, term) {
  const cleanTerm = normalizeOrderText(term);
  const compactTerm = cleanTerm.replace(/\s+/g, "");

  if (!cleanTerm) return false;
  if (cleanTerm.length <= 3) return text.split(" ").includes(cleanTerm);
  if (text.includes(cleanTerm)) return true;
  if (compactTerm.length >= 4 && compactText.includes(compactTerm)) return true;

  return false;
}

function getProductOrderAliases(item) {
  return [item?.label, ...(item?.terms || [])].filter(Boolean);
}

function getProductOrderGroups(item) {
  if (Array.isArray(item?.groups) && item.groups.length) {
    return item.groups.filter(Array.isArray);
  }

  return getProductOrderAliases(item).map((term) => [term]);
}

function getSearchVariants(value = "") {
  const normalized = normalizeOrderText(value);
  const variants = [normalized]
    .flatMap((item) => [item, item.replace(/\s+/g, "")])
    .filter((item) => item.length >= 2);

  return [...new Set(variants)];
}

function getCustomProductRank(product) {
  const text = getProductOrderText(product);
  const compactText = text.replace(/\s+/g, "");

  const index = customProductOrder.findIndex((item) =>
    getProductOrderGroups(item).some((group) =>
      group.every((term) => matchesOrderTerm(text, compactText, term)),
    ),
  );

  return index === -1 ? customProductOrder.length : index;
}

function getProductSearchText(product) {
  return normalizeOrderText(
    [
      product?.name,
      product?.title,
      product?.slug,
      product?.sku,
      product?.short_description,
      product?.description,
      ...(product?.categories || []).flatMap((item) => [
        item?.name,
        item?.slug,
      ]),
      ...(product?.tags || []).flatMap((item) => [item?.name, item?.slug]),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function productMatchesSearch(product, value = "") {
  const searchVariants = getSearchVariants(value);

  if (!searchVariants.length) return true;

  const productSearchText = getProductSearchText(product);
  const productCompactText = productSearchText.replace(/\s+/g, "");

  return searchVariants.some((term) => {
    const compactTerm = term.replace(/\s+/g, "");

    return (
      productSearchText.includes(term) ||
      (compactTerm.length >= 3 && productCompactText.includes(compactTerm))
    );
  });
}

function formatPrice(price) {
  if (!price) return null;

  const number = Number(price);

  if (Number.isNaN(number)) {
    return `$${price}`;
  }

  return `$${number.toFixed(2).replace(".00", "")}`;
}

function getDiscountDetails(item) {
  const regularPrice = Number(item?.regular_price);
  const explicitSalePrice = Number(item?.sale_price);
  const currentPrice = Number(item?.price);
  const salePrice =
    Number.isFinite(explicitSalePrice) && explicitSalePrice > 0
      ? explicitSalePrice
      : currentPrice;

  if (
    !Number.isFinite(regularPrice) ||
    regularPrice <= 0 ||
    !Number.isFinite(salePrice) ||
    salePrice <= 0 ||
    salePrice >= regularPrice
  ) {
    return null;
  }

  return {
    regularPrice,
    salePrice,
    percentage: Math.max(
      1,
      Math.round(((regularPrice - salePrice) / regularPrice) * 100),
    ),
  };
}

function getPriceLabel(product) {
  const formattedPrice = formatPrice(product.price);

  if (product.type === "variable") {
    return formattedPrice || "View";
  }

  return formattedPrice || "View";
}

function getProductUrl(product = {}) {
  const slug = String(product?.slug || "")
    .replace(/^\/+|\/+$/g, "")
    .trim();

  return slug ? `/product/${slug}` : "/shop";
}

function getMainCategory(product) {
  const category = product.categories?.find(
    (item) => item.slug && item.slug !== "uncategorized",
  );

  return category?.name || "Research Product";
}

function getCatalogCategories(product) {
  const categories = Array.isArray(product?.categories)
    ? product.categories
    : [];

  return categories
    .filter((item) => item?.slug && item.slug !== "uncategorized")
    .map((item) => ({
      label: String(item.name || item.slug)
        .replace(/^Research\s+/i, "")
        .trim(),
      value: String(item.slug),
    }));
}

function productMatchesCategory(product, category) {
  if (!category || category === "all") return true;

  return getCatalogCategories(product).some((item) => item.value === category);
}

function getCatalogStrengthOptions(product) {
  const attributes = Array.isArray(product?.attributes)
    ? product.attributes
    : [];
  const options = attributes
    .filter((attribute) => !isPurchaseFormatAttribute(attribute))
    .flatMap((attribute) =>
      Array.isArray(attribute?.options) ? attribute.options : [],
    )
    .map(cleanVariationText)
    .filter(Boolean);
  const uniqueOptions = [...new Set(options)];
  const measuredOptions = uniqueOptions.filter((option) =>
    /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|iu|ml)\b/i.test(option),
  );

  return measuredOptions.length ? measuredOptions : uniqueOptions;
}

function getStockBadge(product) {
  const quantity =
    product.stock_quantity !== null &&
    product.stock_quantity !== undefined &&
    product.stock_quantity !== ""
      ? Number(product.stock_quantity)
      : null;

  if (!isProductAvailable(product)) {
    return {
      label: "Sold Out",
      status: "out",
      dot: "bg-red-400",
      className: "border-red-500/25 bg-red-500/10 text-red-200",
    };
  }

  if (quantity === null || Number.isNaN(quantity)) {
    return {
      label: "Available",
      status: "high",
      dot: "bg-green-400",
      className: "border-green-500/25 bg-green-500/10 text-green-200",
    };
  }

  if (quantity >= 40) {
    return {
      label: `${quantity} Available`,
      status: "high",
      dot: "bg-green-400",
      className: "border-green-500/25 bg-green-500/10 text-green-200",
    };
  }

  if (quantity >= 20) {
    return {
      label: `${quantity} Left`,
      status: "medium",
      dot: "bg-yellow-300",
      className: "border-yellow-500/25 bg-yellow-500/10 text-yellow-100",
    };
  }

  if (quantity > 0) {
    return {
      label: `Only ${quantity} Left`,
      status: "low",
      dot: "bg-red-400",
      className: "border-red-500/25 bg-red-500/10 text-red-200",
    };
  }

  return {
    label: "Sold Out",
    status: "out",
    dot: "bg-red-400",
    className: "border-red-500/25 bg-red-500/10 text-red-200",
  };
}

function cleanVariationText(value = "") {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getImageUrl(value) {
  if (!value) return null;
  if (typeof value === "string") return value;

  return (
    value.src ||
    value.url ||
    value.source_url ||
    value.thumbnail ||
    value?.image?.src ||
    null
  );
}

function getVariationKey(variation, index = 0) {
  return String(
    variation?.id ||
      variation?.variation_id ||
      variation?.sku ||
      variation?.slug ||
      `variation-${index}`,
  );
}

function getAttributeOptions(attributes) {
  if (!attributes) return [];

  if (Array.isArray(attributes)) {
    return attributes
      .map((attribute) => {
        if (!attribute) return "";
        if (typeof attribute === "string") return attribute;

        return (
          attribute.option ||
          attribute.value ||
          attribute.slug ||
          attribute.name ||
          ""
        );
      })
      .map(cleanVariationText)
      .filter(Boolean);
  }

  if (typeof attributes === "object") {
    return Object.values(attributes)
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .map(cleanVariationText)
      .filter(Boolean);
  }

  return [];
}

export function getProductVariations(product) {
  const rawVariations =
    product?.variations ||
    product?.variation_options ||
    product?.variationOptions ||
    product?.variants ||
    [];

  if (!Array.isArray(rawVariations)) return [];

  return rawVariations.filter(
    (variation) => variation && typeof variation === "object",
  );
}

function getVariationsFromApiPayload(payload) {
  const productPayload =
    payload?.product || payload?.data?.product || payload?.item || payload;

  const productVariations = getProductVariations(productPayload);
  const variations = productVariations.length
    ? productVariations
    : payload?.variations || payload?.data?.variations || [];

  return Array.isArray(variations) ? variations : [];
}

async function requestProductVariations(product) {
  const embeddedVariations = getProductVariations(product);

  if (embeddedVariations.length) return embeddedVariations;

  const cacheKey = String(product?.id || product?.slug || "").trim();

  const cachedRequest = cacheKey ? variationRequestCache.get(cacheKey) : null;

  if (cachedRequest && cachedRequest.expiresAt > Date.now()) {
    return cachedRequest.promise;
  }

  if (cacheKey && cachedRequest) {
    variationRequestCache.delete(cacheKey);
  }

  const request = fetch(
    `/api/products?slug=${encodeURIComponent(product.slug)}`,
    {
      cache: "default",
    },
  )
    .then(async (response) => {
      const data = await response.json();

      if (!response.ok || data?.success === false) {
        throw new Error(data?.message || "Could not load product options.");
      }

      return getVariationsFromApiPayload(data);
    })
    .catch((error) => {
      if (cacheKey) variationRequestCache.delete(cacheKey);
      throw error;
    });

  if (cacheKey) {
    variationRequestCache.set(cacheKey, {
      promise: request,
      expiresAt: Date.now() + VARIATION_CACHE_TTL_MS,
    });
  }

  return request;
}

export function getCachedVariationSummary(productId) {
  const cacheKey = String(productId || "").trim();
  const cached = cacheKey ? variationSummaryCache.get(cacheKey) : null;

  if (!cached) return null;
  if (cached.expiresAt > Date.now()) return cached.variations;

  variationSummaryCache.delete(cacheKey);
  return null;
}

export async function requestVariationSummaryBatch(productIds = []) {
  const uniqueIds = [
    ...new Set(
      productIds
        .map((productId) => Number(productId))
        .filter((productId) => Number.isInteger(productId) && productId > 0),
    ),
  ].slice(0, Math.max(DESKTOP_PRODUCTS_PER_PAGE, MOBILE_PRODUCTS_PER_PAGE));
  const summaries = {};
  const missingIds = [];

  uniqueIds.forEach((productId) => {
    const cached = getCachedVariationSummary(productId);

    if (cached) summaries[productId] = cached;
    else missingIds.push(productId);
  });

  if (!missingIds.length) {
    return { summaries, failedIds: [] };
  }

  const requestKey = [...missingIds].sort((a, b) => a - b).join(",");
  let requestEntry = variationSummaryRequestCache.get(requestKey);

  if (!requestEntry || requestEntry.expiresAt <= Date.now()) {
    const promise = fetch(
      `/api/products?option_ids=${encodeURIComponent(requestKey)}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "default",
      },
    )
      .then(async (response) => {
        const data = await response.json();

        if (!response.ok || data?.success !== true) {
          throw new Error(data?.message || "Could not load product options.");
        }

        const nextSummaries = data?.summaries || {};
        const failedIds = Array.isArray(data?.failed_ids)
          ? data.failed_ids.map(String)
          : [];

        missingIds.forEach((productId) => {
          const key = String(productId);
          const variations = nextSummaries[key];

          if (!Array.isArray(variations)) return;

          variationSummaryCache.set(key, {
            variations,
            expiresAt: Date.now() + VARIATION_CACHE_TTL_MS,
          });
        });

        return {
          summaries: nextSummaries,
          failedIds: missingIds.filter(
            (productId) =>
              failedIds.includes(String(productId)) ||
              !Array.isArray(nextSummaries[String(productId)]),
          ),
        };
      })
      .catch((error) => {
        variationSummaryRequestCache.delete(requestKey);
        throw error;
      });

    requestEntry = {
      promise,
      expiresAt: Date.now() + VARIATION_CACHE_TTL_MS,
    };
    variationSummaryRequestCache.set(requestKey, requestEntry);
  }

  const requested = await requestEntry.promise;

  return {
    summaries: { ...summaries, ...requested.summaries },
    failedIds: requested.failedIds,
  };
}

function getVariationLabel(product, variation, index = 0) {
  const options = getAttributeOptions(variation?.attributes);
  const possibleLabels = [
    variation?.label,
    variation?.option,
    variation?.title,
    variation?.name,
    ...options,
    product?.name,
  ];

  const mgLabel = possibleLabels.find((value) =>
    /\b\d+(?:\.\d+)?\s*(mg|mcg|g|iu)\b/i.test(String(value || "")),
  );

  if (mgLabel) return cleanVariationText(mgLabel);

  if (options.length) return options.join(" / ");

  const cleanedName = cleanVariationText(
    String(variation?.name || "").replace(product?.name || "", ""),
  );

  return cleanedName || `Option ${index + 1}`;
}

function getVariationDisplayParts(label = "") {
  const cleanedLabel = cleanVariationText(label).replace(/\s*,\s*/g, ", ");
  const strengthMatch = cleanedLabel.match(
    /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|iu|ml)\b/i,
  );

  if (!strengthMatch) {
    return {
      strength: cleanedLabel || "Option",
      presentation: "",
    };
  }

  const strength = strengthMatch[0].replace(/\s+/g, "").toUpperCase();
  const presentation = cleanedLabel
    .replace(strengthMatch[0], "")
    .replace(/^[\s,|/·:;\-–—]+|[\s,|/·:;\-–—]+$/g, "")
    .trim();

  return {
    strength,
    presentation,
  };
}

function getVariationPrice(variation, product) {
  return (
    variation?.price ||
    variation?.sale_price ||
    variation?.regular_price ||
    product?.price ||
    ""
  );
}

function buildVariationCartItem(
  product,
  variation,
  format,
  fallbackImage,
  fallbackVariationId = "",
) {
  const labelParts = getVariationDisplayParts(
    getVariationLabel(product, variation),
  );
  const cartFormatLabel =
    format === PRODUCT_FORMATS.KIT ? "10 Vial Kits" : "Single vial";
  const cartSelectionLabel = `${cartFormatLabel} / ${labelParts.strength}`;
  const variationPrice = getVariationPrice(variation, product);
  const variationImage =
    getImageUrl(variation.image) ||
    getImageUrl(variation.images?.[0]) ||
    fallbackImage;
  const variationId =
    variation.id || variation.variation_id || fallbackVariationId;

  return {
    ...product,
    ...variation,
    id: variationId,
    parent_id: product.id,
    parentId: product.id,
    product_id: product.id,
    variation_id: variationId,
    variationId,
    type: "variation",
    name: `${product.name} — ${cartSelectionLabel}`,
    slug: product.slug,
    price: variationPrice,
    regular_price: variation.regular_price || variationPrice,
    sale_price: variation.sale_price || "",
    image: variationImage,
    stock_status: variation.stock_status || product.stock_status,
    stock_quantity: variation.stock_quantity ?? null,
    attributes: variation.attributes || [],
    selected_option: cartSelectionLabel,
    selectedOptions: {
      format: cartFormatLabel,
      strength: labelParts.strength,
    },
  };
}

function getVariationGroupingText(product, variation, index = 0) {
  return normalizeOrderText(
    [
      getVariationLabel(product, variation, index),
      variation?.name,
      variation?.label,
      variation?.option,
      variation?.title,
      variation?.slug,
      variation?.sku,
      ...getAttributeOptions(variation?.attributes),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function isKitVariation(product, variation, index = 0) {
  const text = getVariationGroupingText(product, variation, index);

  if (/\b(?:kit|kits|bundle|box)\b/.test(text)) return true;

  const quantityPatterns = [
    /\b(\d+)\s*(?:vial|vials|pack|packs|count|ct)\b/,
    /\b(?:vial|vials|pack|packs)\s*(?:x|of)?\s*(\d+)\b/,
    /\b(\d+)\s*x\s*\d+(?:\.\d+)?\s*(?:mg|mcg|g|iu|ml)\b/,
    /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|iu|ml)\s*x\s*(\d+)\b/,
  ];

  return quantityPatterns.some((pattern) => {
    const match = text.match(pattern);
    return match ? Number(match[1]) > 1 : false;
  });
}

function getVariationStockLabel(variation) {
  const quantity =
    variation?.stock_quantity !== null &&
    variation?.stock_quantity !== undefined &&
    variation?.stock_quantity !== ""
      ? Number(variation.stock_quantity)
      : null;

  if (!isProductAvailable(variation)) {
    return "Sold Out";
  }

  if (quantity === null || Number.isNaN(quantity)) return "Available";
  if (quantity > 0) return `${quantity} left`;

  return "Sold Out";
}

function isVariationAvailable(variation) {
  return isProductAvailable(variation);
}

function groupProductVariations(product, variations = []) {
  const indexedVariations = variations
    .map((variation, index) => ({
      variation,
      index,
    }))
    .sort((left, right) => {
      if (isApparelProduct(product)) return 0;
      const leftLabel = getVariationDisplayParts(
        getVariationLabel(product, left.variation, left.index),
      ).strength;
      const rightLabel = getVariationDisplayParts(
        getVariationLabel(product, right.variation, right.index),
      ).strength;
      return leftLabel.localeCompare(rightLabel, undefined, { numeric: true });
    });

  return {
    singles: indexedVariations.filter(
      ({ variation, index }) => !isKitVariation(product, variation, index),
    ),
    kits: indexedVariations.filter(({ variation, index }) =>
      isKitVariation(product, variation, index),
    ),
  };
}

function getPaginationItems(currentPage, totalPages, compact = false) {
  if (compact && totalPages > 4) {
    if (currentPage <= 2) return [1, 2, "...", totalPages];
    if (currentPage >= totalPages - 1)
      return [1, "...", totalPages - 1, totalPages];
    return [1, "...", currentPage, "...", totalPages];
  }

  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "...", totalPages];
  }

  if (currentPage >= totalPages - 3) {
    return [
      1,
      "...",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  }

  return [
    1,
    "...",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "...",
    totalPages,
  ];
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function getNextEnabledOptionIndex(options, currentIndex, direction) {
  if (!options.length) return -1;

  for (let step = 1; step <= options.length; step += 1) {
    const index =
      (currentIndex + direction * step + options.length) % options.length;

    if (!options[index]?.disabled) return index;
  }

  return currentIndex;
}

function CatalogDropdown({
  label,
  value,
  onChange,
  options,
  className = "rgv-catalog-status",
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const optionRefs = useRef([]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((item) => item.value === value),
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selectedOption = options[selectedIndex] || options[0];
  const idBase = `catalog-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  useEffect(() => {
    if (!isOpen) return undefined;

    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setIsOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;

    setActiveIndex(selectedIndex);
    const frame = window.requestAnimationFrame(() => {
      optionRefs.current[selectedIndex]?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, selectedIndex]);

  function closeMenu({ restoreFocus = false } = {}) {
    setIsOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  function chooseOption(item) {
    if (item.disabled) return;
    onChange(item.value);
    closeMenu({ restoreFocus: true });
  }

  function focusOption(index) {
    if (index < 0) return;
    setActiveIndex(index);
    optionRefs.current[index]?.focus();
  }

  function handleTriggerKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      return;
    }

    if (event.key === "Escape") closeMenu();
  }

  function handleOptionKeyDown(event, index, item) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(
        getNextEnabledOptionIndex(
          options,
          index,
          event.key === "ArrowDown" ? 1 : -1,
        ),
      );
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const startIndex = event.key === "Home" ? -1 : 0;
      const direction = event.key === "Home" ? 1 : -1;
      focusOption(getNextEnabledOptionIndex(options, startIndex, direction));
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      chooseOption(item);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
      return;
    }

    if (event.key === "Tab") closeMenu();
  }

  return (
    <div
      ref={rootRef}
      className={`${className} rgv-catalog-dropdown${isOpen ? " is-open" : ""}`}
    >
      <button
        ref={triggerRef}
        type="button"
        className="rgv-catalog-dropdown__trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={`${idBase}-listbox`}
        aria-labelledby={`${idBase}-label ${idBase}-value`}
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span id={`${idBase}-label`}>{label}</span>
        <strong id={`${idBase}-value`}>
          {selectedOption?.label || "Select"}
        </strong>
        <i aria-hidden="true">
          <ChevronIcon />
        </i>
      </button>

      {isOpen && (
        <div
          id={`${idBase}-listbox`}
          className="rgv-catalog-dropdown__menu"
          role="listbox"
          aria-labelledby={`${idBase}-label`}
        >
          {options.map((item, index) => {
            const selected = item.value === value;

            return (
              <button
                key={item.value}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={Boolean(item.disabled)}
                disabled={item.disabled}
                tabIndex={activeIndex === index ? 0 : -1}
                className={`rgv-catalog-dropdown__option${
                  selected ? " is-selected" : ""
                }${activeIndex === index ? " is-highlighted" : ""}`}
                onMouseEnter={() => {
                  if (!item.disabled) setActiveIndex(index);
                }}
                onClick={() => chooseOption(item)}
                onKeyDown={(event) => handleOptionKeyDown(event, index, item)}
              >
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SortDropdown({ value, onChange }) {
  return (
    <CatalogDropdown
      className="rgv-index-sort"
      label="Sort by"
      value={value}
      onChange={onChange}
      options={sortOptions}
    />
  );
}

function ProductImage({ src, srcSet, alt, priority = false }) {
  const [imageSrc, setImageSrc] = useState(src || FALLBACK_IMAGE);

  useEffect(() => {
    setImageSrc(src || FALLBACK_IMAGE);
  }, [src]);

  return (
    <img
      src={imageSrc}
      srcSet={imageSrc === FALLBACK_IMAGE ? undefined : srcSet || undefined}
      alt={alt ?? "Product image"}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
      width="600"
      height="600"
      sizes="(max-width: 767px) 60vw, (max-width: 1100px) 58vw, 480px"
      onError={() => {
        if (imageSrc !== FALLBACK_IMAGE) {
          setImageSrc(FALLBACK_IMAGE);
        }
      }}
      className="rgv-product-image"
    />
  );
}

function getVariationSelectionForFormat(
  product,
  variations = [],
  format = PRODUCT_FORMATS.SINGLE,
  preferredVariationKey = "",
) {
  const groups = groupProductVariations(product, variations);
  const items = groups[format] || [];
  const requestedItem = preferredVariationKey
    ? items.find(
        ({ variation, index }) =>
          getVariationKey(variation, index) === preferredVariationKey,
      )
    : null;
  const preferredItem =
    requestedItem ||
    items.find(({ variation }) => isVariationAvailable(variation)) ||
    items[0];

  return {
    key: preferredItem
      ? getVariationKey(preferredItem.variation, preferredItem.index)
      : "",
    count: items.length,
  };
}

function StrengthSheet({
  product,
  format,
  preferredVariationKey = "",
  onClose,
}) {
  const { addItem } = useCart();
  const dockRef = useRef(null);
  const previousFocusRef = useRef(null);
  const mountedRef = useRef(true);
  const isAddingRef = useRef(false);
  const selectionTokenRef = useRef(0);
  const [variationStatus, setVariationStatus] = useState("idle");
  const [variations, setVariations] = useState([]);
  const [selectedVariationKey, setSelectedVariationKey] = useState("");
  const [justAdded, setJustAdded] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isMobileDock, setIsMobileDock] = useState(false);

  const isVariableProduct = product?.type === "variable";
  const image =
    getImageUrl(product?.images?.[0]) ||
    getImageUrl(product?.image) ||
    FALLBACK_IMAGE;
  const productUrl = product ? getProductUrl(product) : "/shop";
  const variationGroups = useMemo(
    () => groupProductVariations(product, variations),
    [product, variations],
  );
  const formatVariations = variationGroups[format] || [];
  const selectedVariation = useMemo(() => {
    if (!variations.length) return null;

    return (
      variations.find(
        (variation, index) =>
          getVariationKey(variation, index) === selectedVariationKey,
      ) || null
    );
  }, [selectedVariationKey, variations]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      selectionTokenRef.current += 1;
      isAddingRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    selectionTokenRef.current += 1;
    isAddingRef.current = false;
    setIsAdding(false);
    setJustAdded(false);

    if (!product) {
      setVariations([]);
      setVariationStatus("idle");
      setSelectedVariationKey("");
      return undefined;
    }

    const embeddedVariations = getProductVariations(product);
    const embeddedSelection = getVariationSelectionForFormat(
      product,
      embeddedVariations,
      format,
      preferredVariationKey,
    );

    setVariations(embeddedVariations);
    setSelectedVariationKey(embeddedSelection.key);

    if (!isVariableProduct) {
      setVariationStatus("success");
      return undefined;
    }

    if (embeddedVariations.length) {
      setVariationStatus(embeddedSelection.count ? "success" : "empty");
      return undefined;
    }

    setVariationStatus("loading");

    requestProductVariations(product)
      .then((nextVariations) => {
        if (!active) return;

        const nextSelection = getVariationSelectionForFormat(
          product,
          nextVariations,
          format,
          preferredVariationKey,
        );

        setVariations(nextVariations);
        setSelectedVariationKey(nextSelection.key);
        setVariationStatus(nextSelection.count ? "success" : "empty");
      })
      .catch((error) => {
        if (!active) return;
        console.error(error);
        setVariationStatus("error");
      });

    return () => {
      active = false;
    };
  }, [product, format, isVariableProduct, preferredVariationKey]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const query = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobileDock(query.matches);

    update();
    query.addEventListener("change", update);

    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!product || typeof window === "undefined") return undefined;

    const originalOverflow = document.body.style.overflow;
    const originalTouchAction = document.body.style.touchAction;

    previousFocusRef.current = document.activeElement;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    window.requestAnimationFrame(() => {
      dockRef.current?.querySelector("[data-dock-close]")?.focus();
    });

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dockRef.current) return;

      const focusable = Array.from(
        dockRef.current.querySelectorAll(
          'a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
      document.body.style.touchAction = originalTouchAction;

      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus({ preventScroll: true });
      }
    };
  }, [product, onClose]);

  function updateSelection(nextVariationKey) {
    selectionTokenRef.current += 1;
    setSelectedVariationKey(nextVariationKey);
    setJustAdded(false);
  }

  async function handleAddSelection() {
    if (!product || isAddingRef.current || justAdded) return;

    const requestToken = selectionTokenRef.current;
    const canAddSimple = !isVariableProduct && isProductAvailable(product);
    const canAddVariation =
      isVariableProduct &&
      variationStatus === "success" &&
      selectedVariation &&
      isVariationAvailable(selectedVariation);

    if (!canAddSimple && !canAddVariation) return;

    isAddingRef.current = true;
    setIsAdding(true);
    setJustAdded(false);

    try {
      let result;

      if (!isVariableProduct) {
        result = await addItem(product, 1);
      } else {
        const label = getVariationLabel(product, selectedVariation);
        const labelParts = getVariationDisplayParts(label);
        const cartFormatLabel =
          format === PRODUCT_FORMATS.KIT ? "Kit \u00d710" : "Single vial";
        const cartSelectionLabel = `${cartFormatLabel} / ${labelParts.strength}`;
        const variationPrice = getVariationPrice(selectedVariation, product);
        const variationImage =
          getImageUrl(selectedVariation.image) ||
          getImageUrl(selectedVariation.images?.[0]) ||
          image;
        const variationId =
          selectedVariation.id ||
          selectedVariation.variation_id ||
          selectedVariationKey;

        result = await addItem(
          {
            ...product,
            ...selectedVariation,
            id: variationId,
            parent_id: product.id,
            parentId: product.id,
            product_id: product.id,
            variation_id: variationId,
            variationId,
            type: "variation",
            name: `${product.name} \u2014 ${cartSelectionLabel}`,
            slug: product.slug,
            price: variationPrice,
            regular_price: selectedVariation.regular_price || variationPrice,
            sale_price: selectedVariation.sale_price || "",
            image: variationImage,
            stock_status:
              selectedVariation.stock_status || product.stock_status,
            stock_quantity: selectedVariation.stock_quantity ?? null,
            attributes: selectedVariation.attributes || [],
            selected_option: cartSelectionLabel,
            selectedOptions: {
              format: cartFormatLabel,
              strength: labelParts.strength,
            },
          },
          1,
        );
      }

      if (!mountedRef.current || selectionTokenRef.current !== requestToken) {
        return;
      }

      if (result?.valid) {
        if (isMobileDock) onClose();
        else setJustAdded(true);
      }
    } finally {
      if (mountedRef.current && selectionTokenRef.current === requestToken) {
        isAddingRef.current = false;
        setIsAdding(false);
      }
    }
  }

  if (!product) return null;

  const selectedLabel = selectedVariation
    ? getVariationDisplayParts(
        getVariationLabel(
          product,
          selectedVariation,
          variations.indexOf(selectedVariation),
        ),
      ).strength
    : "";
  const selectedPrice = selectedVariation
    ? formatPrice(getVariationPrice(selectedVariation, product))
    : getPriceLabel(product);
  const selectionAvailable = isVariableProduct
    ? variationStatus === "success" &&
      Boolean(selectedVariation && isVariationAvailable(selectedVariation))
    : isProductAvailable(product);
  const formatValue =
    format === PRODUCT_FORMATS.KIT ? "10 Vial Kits" : "Single";
  const formatMeta = getFormatMeta(formatValue);
  const discount = selectedVariation
    ? getDiscountDetails(selectedVariation)
    : getDiscountDetails(product);

  return (
    <div className="rgv-order-dock-layer rgv-strength-sheet-layer">
      <button
        type="button"
        className="rgv-order-dock-backdrop"
        aria-label="Close strength selector"
        onClick={onClose}
      />
      <aside
        id="catalog-strength-sheet"
        ref={dockRef}
        className="rgv-order-dock rgv-order-dock--active rgv-strength-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalog-strength-title"
        aria-busy={isAdding || variationStatus === "loading"}
      >
        <header className="rgv-order-dock__header">
          <div>
            <p>{formatMeta.label}</p>
            <h2 id="catalog-strength-title">
              {isVariableProduct
                ? "Choose a strength"
                : "Review your selection"}
            </h2>
            <span>{product.name}</span>
          </div>
          <button
            type="button"
            data-dock-close
            onClick={onClose}
            aria-label="Close strength selector"
          >
            ×
          </button>
        </header>

        <a className="rgv-order-dock__product" href={productUrl}>
          <span className="rgv-order-dock__thumb">
            <img src={image} alt="" loading="lazy" decoding="async" />
          </span>
          <span>
            <small>{getMainCategory(product)}</small>
            <strong>View product details</strong>
          </span>
          <span aria-hidden="true">→</span>
        </a>

        {variationStatus === "loading" && (
          <div className="rgv-order-dock__loading" aria-live="polite">
            <span />
            Loading available options…
          </div>
        )}

        {variationStatus === "error" && (
          <div className="rgv-order-dock__message" role="alert">
            We could not load the strengths.{" "}
            <a href={productUrl}>View product</a>
          </div>
        )}

        {variationStatus === "empty" && (
          <div className="rgv-order-dock__message">
            No {formatMeta.label.toLowerCase()} strengths are available here.{" "}
            <a href={productUrl}>View product</a>
          </div>
        )}

        {variationStatus === "success" && (
          <div className="rgv-order-dock__body">
            {isVariableProduct && (
              <fieldset className="rgv-order-dock__strengths">
                <legend>Available strengths</legend>
                <div>
                  {formatVariations.map(({ variation, index }) => {
                    const variationKey = getVariationKey(variation, index);
                    const label = getVariationDisplayParts(
                      getVariationLabel(product, variation, index),
                    );
                    const price = formatPrice(
                      getVariationPrice(variation, product),
                    );
                    const optionDiscount = getDiscountDetails(variation);
                    const available = isVariationAvailable(variation);
                    const active = variationKey === selectedVariationKey;

                    return (
                      <button
                        key={variationKey}
                        type="button"
                        aria-pressed={active}
                        disabled={!available || isAdding}
                        onClick={() => updateSelection(variationKey)}
                        className={active ? "is-active" : ""}
                      >
                        <span>
                          <strong>{label.strength}</strong>
                          <small>{getVariationStockLabel(variation)}</small>
                        </span>
                        <span>
                          <strong>{price || "View price"}</strong>
                          {optionDiscount && (
                            <small className="rgv-order-dock__saving">
                              Save {optionDiscount.percentage}%
                            </small>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}

            <div className="rgv-order-dock__summary" aria-live="polite">
              <div>
                <small>Your selection</small>
                <strong>
                  {isVariableProduct
                    ? `${formatMeta.label} · ${selectedLabel}`
                    : product.name}
                </strong>
              </div>
              <div>
                {discount && <del>{formatPrice(discount.regularPrice)}</del>}
                <strong>{selectedPrice}</strong>
              </div>
            </div>

            <button
              type="button"
              className="rgv-order-dock__add rgv-variation-add-button"
              disabled={!selectionAvailable || isAdding || justAdded}
              onClick={handleAddSelection}
            >
              <span>
                {isAdding
                  ? "Adding…"
                  : justAdded
                    ? "Added to cart"
                    : "Add to cart"}
              </span>
              <PlusIcon />
            </button>

            <p className="rgv-order-dock__notice">
              For research use only. Verify the selected format and strength
              before checkout.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

export function ProductCard({
  product,
  sequence = 1,
  priority = false,
  active = false,
  format = PRODUCT_FORMATS.SINGLE,
  variations = [],
  variationStatus = "idle",
  onChoose,
}) {
  const { addItem } = useCart();
  const [isAdding, setIsAdding] = useState(false);
  const productImage =
    getImageUrl(product?.images?.[0]) ||
    getImageUrl(product?.image) ||
    FALLBACK_IMAGE;
  const imageAlt = product.image_alt || product.name || "Product image";
  const productUrl = getProductUrl(product);
  const isVariableProduct = product.type === "variable";
  const isApparel = isApparelProduct(product);
  const isKit = format === PRODUCT_FORMATS.KIT;
  const cardVariations = variations.length
    ? variations
    : getProductVariations(product);
  const variationGroups = useMemo(
    () => groupProductVariations(product, cardVariations),
    [product, cardVariations],
  );
  const formatVariations = variationGroups[format] || [];
  const optionSignature = formatVariations
    .map(({ variation, index }) => getVariationKey(variation, index))
    .join("|");
  const [selectedVariationKey, setSelectedVariationKey] = useState("");

  const preferredVariationItem =
    formatVariations.find(({ variation }) => isVariationAvailable(variation)) ||
    formatVariations[0] ||
    null;
  const selectedVariationItem =
    formatVariations.find(
      ({ variation, index }) =>
        getVariationKey(variation, index) === selectedVariationKey,
    ) || preferredVariationItem;
  const selectedVariation = selectedVariationItem?.variation || null;
  const selectedVariationIndex = selectedVariationItem?.index ?? 0;
  const effectiveSelectionKey = selectedVariation
    ? getVariationKey(selectedVariation, selectedVariationIndex)
    : "";
  const selectedLabel = selectedVariation
    ? getVariationDisplayParts(
        getVariationLabel(product, selectedVariation, selectedVariationIndex),
      ).strength
    : "";
  const selectedPrice = selectedVariation
    ? formatPrice(getVariationPrice(selectedVariation, product))
    : !isVariableProduct
      ? getPriceLabel(product)
      : null;
  const discount = selectedVariation
    ? getDiscountDetails(selectedVariation)
    : !isVariableProduct
      ? getDiscountDetails(product)
      : null;
  const discountBadge = discount
    ? {
        label: `Save ${discount.percentage}%`,
        ariaLabel: `${discount.percentage}% product discount`,
      }
    : null;
  const selectedImage =
    getImageUrl(selectedVariation?.image) ||
    getImageUrl(selectedVariation?.images?.[0]) ||
    productImage;
  const exactOptionsReady =
    !isVariableProduct ||
    variationStatus === "success" ||
    cardVariations.length > 0;
  const optionsLoading =
    isVariableProduct && !exactOptionsReady && variationStatus !== "error";
  const startingPrice =
    isVariableProduct && !selectedVariation && !isKit
      ? formatPrice(product.price)
      : null;
  const displayPrice = selectedPrice || startingPrice;
  const points = calculateLoyaltyPoints(
    selectedVariation
      ? getVariationPrice(selectedVariation, product)
      : !isKit || !isVariableProduct
        ? product.price
        : 0,
  );
  const allFormatOptionsSoldOut =
    formatVariations.length > 0 &&
    !formatVariations.some(({ variation }) => isVariationAvailable(variation));
  const cardUnavailable = isVariableProduct
    ? allFormatOptionsSoldOut
    : !isProductAvailable(product);
  const canAddDirectly = isVariableProduct
    ? Boolean(selectedVariation && isVariationAvailable(selectedVariation))
    : !cardUnavailable;
  const cardStatus = (() => {
    if (!isVariableProduct) return getStockBadge(product);
    if (variationStatus === "error" && !cardVariations.length) {
      return { label: "Check availability", status: "neutral", dot: null };
    }
    if (optionsLoading) {
      return { label: "Loading options", status: "neutral", dot: null };
    }
    if (selectedVariation) return getStockBadge(selectedVariation);

    return { label: "Check options", status: "neutral", dot: null };
  })();
  const fallbackStrengths = getCatalogStrengthOptions(product).slice(0, 6);
  const formatLabel = isApparel
    ? "Apparel"
    : isKit
      ? "10 vial kit"
      : "Single vial";
  const priceContext = selectedLabel
    ? `${formatLabel} · ${selectedLabel}`
    : formatLabel;
  const stockLabel = ["high", "medium", "low"].includes(cardStatus.status)
    ? "In stock"
    : cardStatus.label;
  const actionLabel = isVariableProduct
    ? optionsLoading
      ? "Loading…"
      : canAddDirectly
        ? isAdding
          ? "Adding…"
          : "Add to cart"
        : "Review options"
    : isAdding
      ? "Adding…"
      : "Add to cart";

  useEffect(() => {
    const nextSelection = getVariationSelectionForFormat(
      product,
      cardVariations,
      format,
    );

    setSelectedVariationKey(nextSelection.key);
  }, [product, format, optionSignature]);

  async function handleCardAction() {
    if (isAdding) return;

    if (!canAddDirectly) {
      if (typeof onChoose === "function") {
        onChoose(product, effectiveSelectionKey, cardVariations);
      } else if (typeof window !== "undefined") {
        window.location.assign(productUrl);
      }
      return;
    }

    setIsAdding(true);

    try {
      const itemToAdd = isVariableProduct
        ? buildVariationCartItem(
            product,
            selectedVariation,
            format,
            productImage,
            effectiveSelectionKey,
          )
        : product;

      await addItem(itemToAdd, 1);
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <article
      className={`rgv-index-card rgv-product-card ${active ? "is-active" : ""} ${
        cardUnavailable ? "is-sold-out" : ""
      } ${isApparel ? "is-apparel" : ""} ${isKit ? "is-kit" : ""}`}
    >
      <a
        href={productUrl}
        className="rgv-index-card__media rgv-card-media"
        aria-label={`View ${product.name}`}
      >
        <span className="rgv-card-reference" aria-hidden="true">
          <i /> RGV <b>/</b> {String(sequence).padStart(2, "0")}
        </span>
        <ProductImage
          src={selectedImage}
          srcSet={
            selectedImage === productImage
              ? product?.images?.[0]?.srcset
              : undefined
          }
          alt={imageAlt}
          priority={priority}
        />
        <span className="rgv-card-view" aria-hidden="true">
          <ArrowUpRight size={18} strokeWidth={1.6} />
        </span>
        {discountBadge && (
          <span
            className="rgv-card-sale-badge"
            aria-label={discountBadge.ariaLabel}
          >
            {discountBadge.label}
          </span>
        )}
      </a>

      <div className="rgv-index-card__content rgv-card-body">
        <div className="rgv-card-title-row">
          <a href={productUrl}>
            <h3>{product.name}</h3>
          </a>
          <div
            className={`rgv-card-price ${displayPrice ? "" : "is-empty"}`}
            aria-live="polite"
          >
            <small>{priceContext}</small>
            {startingPrice && <span className="rgv-card-price__from">From</span>}
            <span>
              <strong>{displayPrice || (optionsLoading ? "—" : "View price")}</strong>
              {discount && <del>{formatPrice(discount.regularPrice)}</del>}
            </span>
            {points > 0 && <span className="rgv-card-points">+{formatPoints(points)} points</span>}
          </div>
        </div>
        <div className="rgv-card-meta-row">
          <p className="rgv-card-meta">{formatLabel}</p>
          <span
            className={`rgv-card-inline-stock rgv-index-card__stock ${cardStatus.status}`}
            aria-label={`Availability: ${cardStatus.label}`}
            title={cardStatus.label}
          >
            {cardStatus.dot && (
              <i className={cardStatus.dot} aria-hidden="true" />
            )}
            {stockLabel}
          </span>
        </div>
        {isVariableProduct && (
          <fieldset className="rgv-card-options">
            <legend>{isApparel ? "Size" : "Strength"}</legend>
            <div>
              {formatVariations.map(({ variation, index }) => {
                const variationKey = getVariationKey(variation, index);
                const label = getVariationDisplayParts(
                  getVariationLabel(product, variation, index),
                ).strength;
                const available = isVariationAvailable(variation);
                const selected = variationKey === effectiveSelectionKey;

                return (
                  <button
                    key={variationKey}
                    type="button"
                    className={`${selected ? "is-active" : ""} ${
                      !available ? "is-sold-out" : ""
                    }`.trim()}
                    aria-pressed={selected}
                    disabled={!available}
                    title={
                      available ? `${label} available` : `${label} sold out`
                    }
                    onClick={() => setSelectedVariationKey(variationKey)}
                  >
                    <span>{label}</span>
                    {!available && <small>Sold out</small>}
                  </button>
                );
              })}

              {optionsLoading &&
                (fallbackStrengths.length
                  ? fallbackStrengths
                  : ["Loading…"]
                ).map((label) => (
                  <button key={label} type="button" disabled>
                    <span>{label}</span>
                  </button>
                ))}

              {!optionsLoading && !formatVariations.length && (
                <span className="rgv-card-options__empty">
                  Options available on product page
                </span>
              )}
            </div>
          </fieldset>
        )}

        <footer className="rgv-index-card__footer rgv-card-footer">
          <button
            type="button"
            className="rgv-card-add"
            disabled={cardUnavailable || optionsLoading || isAdding}
            onClick={handleCardAction}
            aria-label={
              canAddDirectly
                ? `Add ${priceContext} for ${product.name} to cart`
                : `Review options for ${product.name}`
            }
            aria-busy={isAdding}
            aria-controls={
              !canAddDirectly && typeof onChoose === "function"
                ? "catalog-strength-sheet"
                : undefined
            }
            aria-expanded={
              !canAddDirectly && typeof onChoose === "function" ? active : undefined
            }
          >
            <span>{actionLabel}</span>
            {canAddDirectly ? (
              <span className="rgv-card-add__icon" aria-hidden="true">
                <PlusIcon />
              </span>
            ) : (
              <span aria-hidden="true">→</span>
            )}
          </button>
        </footer>
      </div>
    </article>
  );
}
function Pagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  const items = getPaginationItems(currentPage, totalPages);
  const mobileItems = getPaginationItems(currentPage, totalPages, true);
  const renderPageItems = (pageItems) =>
    pageItems.map((item, index) =>
      item === "..." ? (
        <span key={`dots-${index}`} aria-hidden="true">
          …
        </span>
      ) : (
        <button
          key={item}
          type="button"
          aria-label={`Page ${item}`}
          aria-current={currentPage === item ? "page" : undefined}
          onClick={() => onPageChange(item)}
        >
          {item}
        </button>
      ),
    );

  return (
    <nav className="rgv-index-pagination" aria-label="Product pagination">
      <button
        className="rgv-index-pagination__previous rgv-index-pagination__direction"
        type="button"
        aria-label="Previous page"
        disabled={currentPage === 1}
        onClick={() => onPageChange(currentPage - 1)}
      >
        <ChevronLeft size={18} aria-hidden="true" /> <span>Previous</span>
      </button>

      <div className="rgv-index-pagination__pages rgv-index-pagination__pages--desktop">
        {renderPageItems(items)}
      </div>
      <div className="rgv-index-pagination__pages rgv-index-pagination__pages--mobile">
        {renderPageItems(mobileItems)}
      </div>

      <small>
        Page {currentPage} of {totalPages}
      </small>

      <button
        className="rgv-index-pagination__next rgv-index-pagination__direction"
        type="button"
        aria-label="Next page"
        disabled={currentPage === totalPages}
        onClick={() => onPageChange(currentPage + 1)}
      >
        <span>Next</span> <ChevronRight size={18} aria-hidden="true" />
      </button>
    </nav>
  );
}

export default function ProductCatalog({ initialProducts = [] }) {
  const catalogTopRef = useRef(null);
  const hasInitialProducts =
    Array.isArray(initialProducts) && initialProducts.length > 0;
  const [products, setProducts] = useState(() =>
    hasInitialProducts ? initialProducts : [],
  );
  const [status, setStatus] = useState(
    hasInitialProducts ? "success" : "loading",
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFormat, setActiveFormat] = useState(PRODUCT_FORMATS.SINGLE);
  const [activeCategory, setActiveCategory] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [sortBy, setSortBy] = useState("featured");
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [configuredProduct, setConfiguredProduct] = useState(null);
  const [variationSummaries, setVariationSummaries] = useState({});
  const [variationSummaryStatus, setVariationSummaryStatus] = useState({});
  const [productsPerPage, setProductsPerPage] = useState(
    DESKTOP_PRODUCTS_PER_PAGE,
  );

  useEffect(() => {
    const format = new URLSearchParams(window.location.search).get("format");
    if (format === PRODUCT_FORMATS.SINGLE || format === PRODUCT_FORMATS.KIT) {
      setActiveFormat(format);
    }
  }, []);

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 639px)");

    function updateProductsPerPage(event) {
      setProductsPerPage(
        event.matches ? MOBILE_PRODUCTS_PER_PAGE : DESKTOP_PRODUCTS_PER_PAGE,
      );
    }

    updateProductsPerPage(mobileQuery);
    mobileQuery.addEventListener("change", updateProductsPerPage);

    return () => {
      mobileQuery.removeEventListener("change", updateProductsPerPage);
    };
  }, []);

  useEffect(() => {
    if (hasInitialProducts) return undefined;

    let active = true;

    async function loadProducts() {
      try {
        setStatus("loading");

        const response = await fetch("/api/products?limit=70", {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "default",
        });

        const data = await response.json();

        if (!active) return;

        if (!response.ok || data?.success !== true) {
          throw new Error(data?.message || "Could not load products.");
        }

        setProducts(Array.isArray(data.products) ? data.products : []);
        setStatus("success");
      } catch (error) {
        if (!active) return;

        console.error("Product catalog load failed:", error);
        setProducts([]);
        setStatus("error");
      }
    }

    loadProducts();

    return () => {
      active = false;
    };
  }, [hasInitialProducts]);

  useEffect(() => {
    setCurrentPage(1);
    setConfiguredProduct(null);
  }, [
    searchTerm,
    activeFormat,
    activeCategory,
    availabilityFilter,
    sortBy,
    productsPerPage,
  ]);

  const formatProducts = useMemo(
    () =>
      products.filter((product) => {
        const formatSupport = getProductFormatSupport(product);

        return activeFormat === PRODUCT_FORMATS.KIT
          ? formatSupport.kits
          : formatSupport.singles;
      }),
    [products, activeFormat],
  );

  const categoryOptions = useMemo(() => {
    const categoryMap = new Map();

    products.forEach((product) => {
      getCatalogCategories(product).forEach((category) => {
        if (!categoryMap.has(category.value)) {
          categoryMap.set(category.value, category.label);
        }
      });
    });

    const options = [...categoryMap.entries()]
      .map(([value, label]) => {
        const count = formatProducts.filter((product) =>
          productMatchesCategory(product, value),
        ).length;

        return {
          value,
          label,
          disabled: count === 0,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    return [
      {
        value: "all",
        label: "All categories",
        disabled: false,
      },
      ...options,
    ];
  }, [products, formatProducts]);

  const availabilityOptions = useMemo(() => {
    const relevantProducts = formatProducts.filter(
      (product) =>
        productMatchesSearch(product, searchTerm) &&
        productMatchesCategory(product, activeCategory),
    );
    const availableCount = relevantProducts.filter((product) =>
      isProductAvailable(product),
    ).length;
    const soldOutCount = relevantProducts.length - availableCount;

    return [
      { value: "all", label: "All stock" },
      {
        value: "available",
        label: "Available",
        disabled: availableCount === 0,
      },
      {
        value: "soldout",
        label: "Sold out",
        disabled: soldOutCount === 0,
      },
    ];
  }, [formatProducts, searchTerm, activeCategory]);

  const filteredProducts = useMemo(() => {
    const result = formatProducts.filter((product) => {
      const matchesSearch = productMatchesSearch(product, searchTerm);
      const matchesCategory = productMatchesCategory(product, activeCategory);
      const available = isProductAvailable(product);
      const matchesAvailability =
        availabilityFilter === "all" ||
        (availabilityFilter === "available" && available) ||
        (availabilityFilter === "soldout" && !available);

      return matchesSearch && matchesCategory && matchesAvailability;
    });

    return [...result].sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);

      const orderA = getCustomProductRank(a);
      const orderB = getCustomProductRank(b);

      if (orderA !== orderB) return orderA - orderB;
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;

      return a.name.localeCompare(b.name);
    });
  }, [formatProducts, searchTerm, activeCategory, availabilityFilter, sortBy]);

  useEffect(() => {
    if (!configuredProduct) return;

    const remainsVisible = filteredProducts.some(
      (product) =>
        String(product.id) === String(configuredProduct?.product?.id),
    );

    if (!remainsVisible) setConfiguredProduct(null);
  }, [configuredProduct, filteredProducts]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredProducts.length / productsPerPage),
  );
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * productsPerPage;
  const endIndex = startIndex + productsPerPage;
  const paginatedProducts = useMemo(
    () => filteredProducts.slice(startIndex, endIndex),
    [filteredProducts, startIndex, endIndex],
  );
  const visibleStart = filteredProducts.length > 0 ? startIndex + 1 : 0;
  const visibleEnd = Math.min(endIndex, filteredProducts.length);
  const visibleVariableIdsKey = useMemo(
    () =>
      paginatedProducts
        .filter((product) => product.type === "variable")
        .map((product) => String(product.id))
        .join(","),
    [paginatedProducts],
  );

  useEffect(() => {
    if (!visibleVariableIdsKey) return undefined;

    let active = true;
    const productIds = visibleVariableIdsKey.split(",").filter(Boolean);
    const localSummaries = {};
    const requestIds = [];

    productIds.forEach((productId) => {
      const product = paginatedProducts.find(
        (item) => String(item.id) === productId,
      );
      const embeddedVariations = getProductVariations(product);
      const cachedVariations = getCachedVariationSummary(productId);
      const variations = embeddedVariations.length
        ? embeddedVariations
        : cachedVariations;

      if (variations) localSummaries[productId] = variations;
      else requestIds.push(productId);
    });

    if (Object.keys(localSummaries).length) {
      setVariationSummaries((current) => ({
        ...current,
        ...localSummaries,
      }));
      setVariationSummaryStatus((current) => {
        const next = { ...current };
        Object.keys(localSummaries).forEach((productId) => {
          next[productId] = "success";
        });
        return next;
      });
    }

    if (!requestIds.length) return undefined;

    setVariationSummaryStatus((current) => {
      const next = { ...current };
      requestIds.forEach((productId) => {
        next[productId] = "loading";
      });
      return next;
    });

    requestVariationSummaryBatch(requestIds)
      .then(({ summaries, failedIds }) => {
        if (!active) return;

        const normalizedSummaries = {};
        Object.entries(summaries || {}).forEach(([productId, variations]) => {
          if (Array.isArray(variations)) {
            normalizedSummaries[String(productId)] = variations;
          }
        });

        if (Object.keys(normalizedSummaries).length) {
          setVariationSummaries((current) => ({
            ...current,
            ...normalizedSummaries,
          }));
        }

        setVariationSummaryStatus((current) => {
          const next = { ...current };
          const failedSet = new Set(failedIds.map(String));

          requestIds.forEach((productId) => {
            next[productId] =
              failedSet.has(productId) ||
              !Array.isArray(normalizedSummaries[productId])
                ? "error"
                : "success";
          });

          return next;
        });
      })
      .catch((error) => {
        if (!active) return;

        console.error("Product option summary load failed:", error);
        setVariationSummaryStatus((current) => {
          const next = { ...current };
          requestIds.forEach((productId) => {
            next[productId] = "error";
          });
          return next;
        });
      });

    return () => {
      active = false;
    };
  }, [visibleVariableIdsKey]);

  function handlePageChange(page) {
    const nextPage = Math.min(Math.max(page, 1), totalPages);

    if (nextPage === currentPage) return;

    setCurrentPage(nextPage);
    setConfiguredProduct(null);

    window.requestAnimationFrame(() => {
      if (!catalogTopRef.current) return;

      const top =
        catalogTopRef.current.getBoundingClientRect().top +
        window.scrollY -
        132;

      window.scrollTo({
        top,
        behavior: "smooth",
      });
    });
  }

  function handleFormatChange(nextFormat) {
    setActiveFormat(nextFormat);
    setActiveCategory("all");
    setAvailabilityFilter("all");
  }

  function clearCatalogFilters() {
    setSearchTerm("");
    setActiveCategory("all");
    setAvailabilityFilter("all");
    setSortBy("featured");
  }

  const handleChoose = useCallback(
    (product, preferredVariationKey, variations) => {
      setConfiguredProduct({
        product:
          Array.isArray(variations) && variations.length
            ? { ...product, variations }
            : product,
        preferredVariationKey: preferredVariationKey || "",
      });
    },
    [],
  );

  const handleCloseConfigurator = useCallback(() => {
    setConfiguredProduct(null);
  }, []);
  const activeFacetCount =
    Number(activeCategory !== "all") +
    Number(availabilityFilter !== "all") +
    Number(sortBy !== "featured");

  return (
    <main id="research-catalog" className="rgv-catalog" ref={catalogTopRef}>
      <header className="rgv-catalog-hero rgv-catalog-head">
        <div className="rgv-catalog-hero__copy">
          <p className="rgv-kicker rgv-collection-eyebrow">
            <i aria-hidden="true" /> RGV Prime / Research use only
          </p>
          <h1>Research collection</h1>
        </div>
        <a
          className="rgv-catalog-documentation"
          href="/coa"
          aria-label="Product certificates"
        >
          <span className="rgv-catalog-documentation__icon" aria-hidden="true">
            <FileCheck2 size={18} strokeWidth={1.6} />
          </span>
          <span className="rgv-catalog-documentation__copy">
            <strong>Certificates</strong>
            <small>Product documentation</small>
          </span>
          <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </header>

      <div className="rgv-catalog-browse">
        <section
          className={`rgv-catalog-controls ${showFilters ? "is-expanded" : ""}`}
          aria-label="Catalog controls"
        >
          <nav className="rgv-catalog-format-bar" aria-label="Shopping format">
            <div
              className="rgv-catalog-modes__options rgv-format-switch"
              role="group"
              aria-label="Choose product format"
            >
              {formatFilters.map((item) => {
                const active = activeFormat === item.value;

                return (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={active}
                    aria-controls="catalog-product-grid"
                    className={active ? "is-active" : ""}
                    onClick={() => handleFormatChange(item.value)}
                    title={item.description}
                  >
                    {item.value === PRODUCT_FORMATS.KIT ? (
                      <Package size={18} strokeWidth={1.6} aria-hidden="true" />
                    ) : (
                      <FlaskConical
                        size={18}
                        strokeWidth={1.6}
                        aria-hidden="true"
                      />
                    )}
                    <strong>{item.label}</strong>
                  </button>
                );
              })}
            </div>
          </nav>

          <label className="rgv-catalog-search">
            <span aria-hidden="true">
              <SearchIcon />
            </span>
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search products"
              aria-label="Search products"
            />
          </label>

          <button
            type="button"
            className={`rgv-catalog-facet-toggle ${activeFacetCount ? "has-filters" : ""}`}
            aria-label="Catalog filters"
            aria-expanded={showFilters}
            aria-controls="catalog-facets"
            onClick={() => setShowFilters((value) => !value)}
          >
            <SlidersHorizontal size={18} aria-hidden="true" />
            <span>Filters</span>
            {activeFacetCount > 0 && <b>{activeFacetCount}</b>}
          </button>
          <div id="catalog-facets" className="rgv-catalog-facets">
            <CatalogDropdown
              label="Category"
              value={activeCategory}
              onChange={setActiveCategory}
              options={categoryOptions}
            />
            <CatalogDropdown
              label="Availability"
              value={availabilityFilter}
              onChange={setAvailabilityFilter}
              options={availabilityOptions}
            />
            <SortDropdown value={sortBy} onChange={setSortBy} />
          </div>
        </section>
      </div>

      {status === "success" && (
        <div className="rgv-catalog-results-bar">
          <p aria-live="polite">
            Showing{" "}
            <strong>
              {visibleStart}–{visibleEnd}
            </strong>{" "}
            of <strong>{filteredProducts.length}</strong>{" "}
            {activeFormat === PRODUCT_FORMATS.KIT ? "kits" : "products"}
          </p>
          {(searchTerm ||
            activeCategory !== "all" ||
            availabilityFilter !== "all" ||
            sortBy !== "featured") && (
            <button type="button" onClick={clearCatalogFilters}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {status === "loading" && (
        <div className="rgv-catalog-workbench">
          <div
            id="catalog-product-grid"
            className="rgv-index-grid rgv-product-grid"
            aria-label="Loading products"
            aria-busy="true"
          >
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={index}
                className="rgv-index-card rgv-product-card rgv-index-card--loading"
              />
            ))}
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="rgv-catalog-message" role="alert">
          <h2>Products are temporarily unavailable.</h2>
          <p>Please try again in a moment.</p>
        </div>
      )}

      {status === "success" && filteredProducts.length === 0 && (
        <div className="rgv-catalog-message">
          <h2>No products found.</h2>
          <p>Try another format or search term, or clear your filters.</p>
          <button type="button" onClick={clearCatalogFilters}>
            Clear filters
          </button>
        </div>
      )}

      {status === "success" && filteredProducts.length > 0 && (
        <>
          <div className="rgv-catalog-workbench">
            <section
              id="catalog-product-grid"
              className="rgv-index-grid rgv-product-grid"
              aria-label="Products"
            >
              {paginatedProducts.map((product, index) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  sequence={visibleStart + index}
                  priority={index < 4}
                  active={
                    String(configuredProduct?.product?.id || "") ===
                    String(product.id)
                  }
                  format={activeFormat}
                  variations={
                    variationSummaries[String(product.id)] ||
                    getProductVariations(product)
                  }
                  variationStatus={
                    variationSummaryStatus[String(product.id)] ||
                    (getProductVariations(product).length
                      ? "success"
                      : product.type === "variable"
                        ? "loading"
                        : "success")
                  }
                  onChoose={handleChoose}
                />
              ))}
            </section>

            {configuredProduct && (
              <StrengthSheet
                product={configuredProduct.product}
                format={activeFormat}
                preferredVariationKey={configuredProduct.preferredVariationKey}
                onClose={handleCloseConfigurator}
              />
            )}
          </div>

          <div className="rgv-catalog-pagination-bottom">
            <Pagination
              currentPage={safeCurrentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
            />
          </div>
        </>
      )}

      <footer className="rgv-catalog-disclaimer">
        <strong>For research use only</strong>
        <p>
          Products are not intended for human consumption, diagnostic,
          therapeutic, or clinical use.
        </p>
      </footer>
    </main>
  );
}
