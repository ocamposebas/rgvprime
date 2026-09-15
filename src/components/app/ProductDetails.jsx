import { useEffect, useMemo, useRef, useState } from "react";
import { Coins, FileCheck2, LockKeyhole, PackageCheck } from "lucide-react";
import { useCart } from "../cart/CartContext";
import {
  getCachedVariationSummary,
  getProductVariations as getCatalogProductVariations,
  ProductCard as CatalogProductCard,
  requestVariationSummaryBatch,
} from "../catalog/ProductCatalog";
import {
  formatPoints,
  getProductLoyaltyPoints,
} from "../../lib/loyaltyProgram";
import {
  getMaximumPurchasableQuantity,
  isProductAvailable,
} from "../../lib/inventory";
import {
  getFormatMeta,
  isKitFormatValue,
  isPurchaseFormatAttribute,
  PRODUCT_FORMATS,
  sortPurchaseAttributes,
} from "../../lib/productFormat";
import "../../styles/storefront-v2.css";

const FALLBACK_IMAGE = "/logo.webp";

const PURCHASE_ASSURANCES = [
  {
    title: "Protected packaging",
    detail: "Prepared and sealed with care",
    icon: PackageCheck,
  },
  {
    title: "Secure checkout",
    detail: "Protected payment process",
    icon: LockKeyhole,
  },
  {
    title: "COA documentation",
    detail: "Searchable by product or lot",
    icon: FileCheck2,
  },
];

function getStockBadge(product) {
  const quantity =
    product?.stock_quantity !== null &&
    product?.stock_quantity !== undefined &&
    product?.stock_quantity !== ""
      ? Number(product.stock_quantity)
      : null;

  if (!isProductAvailable(product)) {
    return {
      label: "Sold Out",
      status: "out",
      dot: "bg-red-500",
      className: "border-red-500/30 bg-red-500/10 text-red-200",
    };
  }

  if (quantity === null || Number.isNaN(quantity)) {
    return {
      label: "Available",
      status: "high",
      dot: "bg-emerald-400",
      className: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
    };
  }

  if (quantity > 0 && quantity <= 10) {
    return {
      label: `Low Stock · ${quantity}`,
      status: "low",
      dot: "bg-yellow-300",
      className: "border-yellow-400/30 bg-yellow-400/10 text-yellow-200",
    };
  }

  return {
    label: `${quantity} Available`,
    status: "high",
    dot: "bg-emerald-400",
    className: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  };
}

function getProductImage(product) {
  if (product?.images && product.images.length > 0 && product.images[0]?.src) {
    return product.images[0].src;
  }

  if (product?.image?.src) {
    return product.image.src;
  }

  if (typeof product?.image === "string" && product.image.trim() !== "") {
    return product.image;
  }

  return FALLBACK_IMAGE;
}

function formatMoney(value, currency = "USD") {
  if (value === null || value === undefined || value === "") return null;

  const cleanValue =
    typeof value === "string" ? value.replace(/[^0-9.-]/g, "") : value;

  const number = Number(cleanValue);

  if (Number.isNaN(number)) return null;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(number);
}

function getRawPrice(item) {
  const candidates = [item?.price, item?.sale_price, item?.regular_price];

  return (
    candidates.find(
      (value) => value !== null && value !== undefined && value !== "",
    ) ?? null
  );
}

function getPriceOffer(item) {
  const currency = item?.currency || item?.currency_code || "USD";
  const parsePrice = (value) => {
    if (value === null || value === undefined || value === "") return null;

    const number = Number(
      typeof value === "string" ? value.replace(/[^0-9.-]/g, "") : value,
    );

    return Number.isFinite(number) ? number : null;
  };
  const currentRaw =
    [item?.sale_price, item?.price, item?.regular_price].find(
      (value) => value !== null && value !== undefined && value !== "",
    ) ?? null;
  const currentPrice = parsePrice(currentRaw);
  const regularPrice = parsePrice(item?.regular_price);
  const hasDiscount =
    currentPrice !== null &&
    regularPrice !== null &&
    regularPrice > 0 &&
    currentPrice < regularPrice;
  const savings = hasDiscount ? regularPrice - currentPrice : 0;

  return {
    currency,
    currentPrice,
    currentFormatted: formatMoney(currentPrice, currency),
    regularPrice,
    regularFormatted: hasDiscount
      ? formatMoney(regularPrice, currency)
      : null,
    hasDiscount,
    savings,
    savingsFormatted: hasDiscount ? formatMoney(savings, currency) : null,
    percentage: hasDiscount
      ? Math.max(1, Math.round((savings / regularPrice) * 100))
      : 0,
  };
}

function normalizeVariantValue(value = "") {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/&amp;/g, "&")
    .replace(/^attribute[:_\-\s]*/i, "")
    .replace(/^pa[:_\-\s]*/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*(mcg|mg|g|iu)\b/g, "$1")
    .trim();
}

function normalizeAttributeName(value = "") {
  return normalizeVariantValue(value)
    .replace(/^(attribute|pa)\s+/i, "")
    .trim();
}

function getStrengthMatch(value = "") {
  const text = normalizeVariantValue(value);
  const match = text.match(/(\d+(?:\.\d+)?)(mcg|mg|g|iu)\b/i);

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = String(match[2] || "").toLowerCase();

  if (!Number.isFinite(amount)) return null;

  const multiplier =
    unit === "g" ? 1000 : unit === "mcg" ? 0.001 : unit === "mg" ? 1 : 1;

  return {
    amount,
    unit,
    sortValue: amount * multiplier,
    raw: `${amount}${unit}`,
  };
}

function valuesLookEquivalent(a = "", b = "") {
  const cleanA = normalizeVariantValue(a);
  const cleanB = normalizeVariantValue(b);

  if (!cleanA || !cleanB) return false;
  if (cleanA === cleanB) return true;

  const strengthA = getStrengthMatch(cleanA);
  const strengthB = getStrengthMatch(cleanB);

  if (strengthA && strengthB) {
    return Math.abs(strengthA.sortValue - strengthB.sortValue) < 0.000001;
  }

  return cleanA.includes(cleanB) || cleanB.includes(cleanA);
}

function compareVariantValues(a = "", b = "") {
  const strengthA = getStrengthMatch(a);
  const strengthB = getStrengthMatch(b);

  if (strengthA && strengthB && strengthA.sortValue !== strengthB.sortValue) {
    return strengthA.sortValue - strengthB.sortValue;
  }

  if (strengthA && !strengthB) return -1;
  if (!strengthA && strengthB) return 1;

  return String(a || "").localeCompare(String(b || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function sortVariantOptions(options = []) {
  return [...(Array.isArray(options) ? options : [])].sort(compareVariantValues);
}

function getVariationImage(variation) {
  if (variation?.image?.src) return variation.image.src;

  if (variation?.image_data?.src) return variation.image_data.src;

  if (typeof variation?.image === "string" && variation.image.trim() !== "") {
    return variation.image;
  }

  return null;
}

function getVariationResponsiveImage(product, variation) {
  const src = getVariationImage(variation);

  if (!src) return null;

  const variationImageObject =
    variation?.image && typeof variation.image === "object"
      ? variation.image
      : {};
  const variationImageData = {
    ...variationImageObject,
    ...(variation?.image_data && typeof variation.image_data === "object"
      ? variation.image_data
      : {}),
  };
  const parentImageData =
    (Array.isArray(product?.images) && product.images[0]) ||
    (product?.image && typeof product.image === "object"
      ? product.image
      : {});
  const variationSrcset =
    variationImageData.srcset || variationImageData.srcSet || undefined;
  const parentSrcset =
    parentImageData.srcset || parentImageData.srcSet || undefined;
  const sharesParentSource =
    Boolean(parentImageData.src) && String(parentImageData.src) === String(src);

  return {
    ...parentImageData,
    ...variationImageData,
    src,
    srcset: variationSrcset || (sharesParentSource ? parentSrcset : undefined),
    sizes:
      variationImageData.sizes ||
      (sharesParentSource ? parentImageData.sizes : undefined),
  };
}

function getVariationAttributeOption(attribute) {
  return (
    attribute?.option ??
    attribute?.value ??
    attribute?.slug ??
    ""
  );
}

function getVariationOptionValues(variation) {
  if (!variation || typeof variation !== "object") return [];

  const values = [];

  if (Array.isArray(variation.attributes)) {
    variation.attributes.forEach((attribute) => {
      const option = getVariationAttributeOption(attribute);

      if (option) values.push(option);
    });
  }

  [
    variation.label,
    variation.option,
    variation.title,
    variation.name,
    variation.sku,
  ].forEach((value) => {
    if (value) values.push(value);
  });

  return values.filter(Boolean);
}

function getVariationStrengthValue(variation) {
  const values = getVariationOptionValues(variation);
  const strengths = values
    .map((value) => getStrengthMatch(value))
    .filter(Boolean)
    .map((strength) => strength.sortValue);

  if (!strengths.length) return Number.POSITIVE_INFINITY;

  return Math.min(...strengths);
}

function sortVariationsByStrength(variations = []) {
  return [...variations].sort((a, b) => {
    const strengthA = getVariationStrengthValue(a);
    const strengthB = getVariationStrengthValue(b);

    if (strengthA !== strengthB) return strengthA - strengthB;

    const priceA = Number(a?.price || a?.sale_price || a?.regular_price || 0);
    const priceB = Number(b?.price || b?.sale_price || b?.regular_price || 0);

    if (priceA !== priceB) return priceA - priceB;

    return String(a?.sku || a?.id || "").localeCompare(
      String(b?.sku || b?.id || ""),
      undefined,
      { numeric: true, sensitivity: "base" }
    );
  });
}

function getVariationList(product) {
  return Array.isArray(product?.variations)
    ? product.variations.filter(
        (variation) =>
          variation && typeof variation === "object" && !Array.isArray(variation)
      )
    : [];
}

function getSelectableProductAttributes(product) {
  const attributes = Array.isArray(product?.attributes)
    ? product.attributes.filter(
        (attribute) => attribute && typeof attribute === "object",
      )
    : [];
  const hasVariationSignal = attributes.some((attribute) =>
    Object.prototype.hasOwnProperty.call(attribute, "variation"),
  );

  // Modern Woo data explicitly identifies variation-driving attributes. If
  // that signal exists, informational attributes must never enter selection
  // matching. Older payloads without the signal retain the legacy behavior.
  return hasVariationSignal
    ? attributes.filter((attribute) => attribute.variation === true)
    : attributes;
}

function getScopedVariantSelection(product, selectedVariants) {
  const selectableNames = new Set(
    getSelectableProductAttributes(product).map((attribute) =>
      normalizeAttributeName(attribute?.name || attribute?.slug || ""),
    ),
  );

  return Object.fromEntries(
    Object.entries(selectedVariants || {}).filter(([name, value]) => {
      return (
        value !== null &&
        value !== undefined &&
        value !== "" &&
        selectableNames.has(normalizeAttributeName(name))
      );
    }),
  );
}

function isVariationPurchasable(variation) {
  if (!variation) return false;

  const explicitFlag = variation.purchasable ?? variation.is_purchasable;

  if (
    explicitFlag === false ||
    explicitFlag === 0 ||
    String(explicitFlag).toLowerCase() === "false"
  ) {
    return false;
  }

  return getRawPrice(variation) !== null && isProductAvailable(variation);
}

function getLowestAvailableVariation(product) {
  const variations = sortVariationsByStrength(getVariationList(product));
  const availableVariations = variations.filter((variation) =>
    isVariationPurchasable(variation),
  );
  const preferredSingle = availableVariations.find((variation) =>
    getVariationOptionValues(variation).every(
      (value) => !isKitFormatValue(value),
    ),
  );

  return (
    preferredSingle ||
    availableVariations[0] ||
    variations[0] ||
    null
  );
}

function getMatchingProductAttributeName(product, variationAttribute, option) {
  const attributes = getSelectableProductAttributes(product);
  const variationName = normalizeAttributeName(
    variationAttribute?.name || variationAttribute?.slug || ""
  );

  const directAttribute = attributes.find((attribute) => {
    const attrName = normalizeAttributeName(attribute?.name || attribute?.slug || "");

    return (
      attrName &&
      variationName &&
      (attrName === variationName || attrName.includes(variationName) || variationName.includes(attrName))
    );
  });

  if (directAttribute?.name) return directAttribute.name;

  const optionAttribute = attributes.find(
    (attribute) =>
      Array.isArray(attribute?.options) &&
      attribute.options.some((item) => valuesLookEquivalent(item, option))
  );

  return optionAttribute?.name || variationAttribute?.name || variationAttribute?.slug || "Option";
}

function variationMatchesSelection(variation, selectedVariants) {
  if (!variation || typeof variation !== "object") return false;

  const variationAttributes = Array.isArray(variation.attributes)
    ? variation.attributes
    : [];

  const selectedEntries = Object.entries(selectedVariants || {}).filter(
    ([, value]) => value !== null && value !== undefined && value !== ""
  );

  if (selectedEntries.length === 0 || variationAttributes.length === 0) {
    return false;
  }

  const allVariationValues = getVariationOptionValues(variation);

  return selectedEntries.every(([selectedName, selectedValue]) => {
    const cleanSelectedName = normalizeAttributeName(selectedName);
    const cleanSelectedValue = normalizeVariantValue(selectedValue);

    const directMatch = variationAttributes.some((attribute) => {
      const attrName = normalizeAttributeName(attribute?.name || attribute?.slug);
      const attrOption = normalizeVariantValue(getVariationAttributeOption(attribute));

      const nameMatches =
        !attrName ||
        !cleanSelectedName ||
        attrName === cleanSelectedName ||
        attrName.includes(cleanSelectedName) ||
        cleanSelectedName.includes(attrName);

      const valueMatches =
        valuesLookEquivalent(attrOption, cleanSelectedValue) ||
        valuesLookEquivalent(attribute?.name, cleanSelectedValue) ||
        valuesLookEquivalent(attribute?.slug, cleanSelectedValue);

      return nameMatches && valueMatches;
    });

    if (directMatch) return true;

    return allVariationValues.some((value) =>
      valuesLookEquivalent(value, cleanSelectedValue)
    );
  });
}

function getSelectedVariation(product, selectedVariants) {
  const variations = sortVariationsByStrength(getVariationList(product));
  const scopedSelection = getScopedVariantSelection(product, selectedVariants);

  if (variations.length === 0) return null;

  const exactMatch = variations.find((variation) =>
    variationMatchesSelection(variation, scopedSelection)
  );

  if (exactMatch) return exactMatch;

  const selectedValues = Object.values(scopedSelection).filter(Boolean);

  if (selectedValues.length > 0) {
    const valueMatch = variations.find((variation) =>
      selectedValues.every((selectedValue) =>
        getVariationOptionValues(variation).some((variationValue) =>
          valuesLookEquivalent(variationValue, selectedValue)
        )
      )
    );

    if (valueMatch) return valueMatch;

    // A variable product must resolve every selected value to the same
    // variation. Falling back by strength or array position can silently add
    // the wrong format (for example, a single vial instead of a kit).
    return null;
  }

  return getLowestAvailableVariation(product);
}

function getVariationStockQuantity(variation) {
  const rawQuantity = variation?.stock_quantity;

  if (rawQuantity === null || rawQuantity === undefined || rawQuantity === "") {
    return null;
  }

  const quantity = Number(rawQuantity);

  return Number.isFinite(quantity) ? quantity : null;
}

function getVariationStockLabel(variation, isAvailable) {
  if (!variation) return "Unavailable";

  const quantity = getVariationStockQuantity(variation);

  if (!isAvailable) return "Sold Out";

  if (quantity !== null) {
    return `Available · ${quantity}`;
  }

  return "Available";
}

function buildSelectionFromVariation(product, variation) {
  if (!variation) return {};

  const selection = {};
  const variationValues = getVariationOptionValues(variation);

  getSelectableProductAttributes(product).forEach((attribute) => {
    if (!attribute?.name) return;

    const options = sortVariantOptions(attribute.options || []);
    const directVariationAttribute = Array.isArray(variation.attributes)
      ? variation.attributes.find((variationAttribute) => {
          const productName = normalizeAttributeName(
            attribute.name || attribute.slug || "",
          );
          const variationName = normalizeAttributeName(
            variationAttribute?.name || variationAttribute?.slug || "",
          );

          return (
            productName &&
            variationName &&
            (productName === variationName ||
              productName.includes(variationName) ||
              variationName.includes(productName))
          );
        })
      : null;
    const directValue = getVariationAttributeOption(directVariationAttribute);
    const matchingOption = options.find((option) => {
      return (
        valuesLookEquivalent(option, directValue) ||
        variationValues.some((value) => valuesLookEquivalent(option, value))
      );
    });

    if (matchingOption) {
      selection[attribute.name] = matchingOption;
    } else if (!options.length && directValue) {
      selection[attribute.name] = directValue;
    }
  });

  return selection;
}

function getAvailableVariationMatchingSelection(product, selectedVariants) {
  const scopedSelection = getScopedVariantSelection(product, selectedVariants);

  if (Object.keys(scopedSelection).length === 0) return null;

  return (
    sortVariationsByStrength(getVariationList(product)).find(
      (variation) =>
        isVariationPurchasable(variation) &&
        variationMatchesSelection(variation, scopedSelection),
    ) || null
  );
}

function getAnyVariationMatchingSelection(product, selectedVariants) {
  const scopedSelection = getScopedVariantSelection(product, selectedVariants);

  if (Object.keys(scopedSelection).length === 0) return null;

  return (
    sortVariationsByStrength(getVariationList(product)).find((variation) =>
      variationMatchesSelection(variation, scopedSelection),
    ) || null
  );
}

function getVariantPricePreview(product, selectedVariants, attributeName, option) {
  const currency = product?.currency || product?.currency_code || "USD";
  const selectableAttributes = getSelectableProductAttributes(product);
  const attribute = selectableAttributes.find(
    (item) =>
      normalizeAttributeName(item?.name || item?.slug || "") ===
      normalizeAttributeName(attributeName),
  );
  const previewSelection = {
    ...getScopedVariantSelection(product, selectedVariants),
    [attributeName]: option,
  };
  const compatibilitySelection = isPurchaseFormatAttribute(attribute)
    ? { [attributeName]: option }
    : previewSelection;
  const availableVariation = getAvailableVariationMatchingSelection(
    product,
    compatibilitySelection,
  );
  const variation =
    availableVariation ||
    getAnyVariationMatchingSelection(product, compatibilitySelection);

  const rawPrice = getRawPrice(variation);

  const formattedPrice = formatMoney(rawPrice, currency);

  const isAvailable = isVariationPurchasable(variation);

  const stockLabel = getVariationStockLabel(variation, isAvailable);

  return {
    variation,
    formattedPrice,
    isAvailable,
    stockLabel,
    label: isAvailable && formattedPrice
      ? formattedPrice
      : variation
        ? "Sold out"
        : "Unavailable",
  };
}

function buildInitialVariantSelection(product) {
  const initialVariants = {};
  const preferredVariation = getLowestAvailableVariation(product);
  const preferredOptions = getVariationOptionValues(preferredVariation);

  const selectableAttributes = getSelectableProductAttributes(product);

  if (selectableAttributes.length > 0) {
    selectableAttributes.forEach((attr) => {
      if (!attr?.name) return;

      const options = sortVariantOptions(attr.options || []);
      const matchingPreferredOption = options.find((option) =>
        preferredOptions.some((preferredOption) =>
          valuesLookEquivalent(option, preferredOption)
        )
      );

      if (matchingPreferredOption || options[0]) {
        initialVariants[attr.name] = matchingPreferredOption || options[0];
      }
    });
  }

  if (
    Object.keys(initialVariants).length === 0 &&
    preferredVariation &&
    Array.isArray(preferredVariation.attributes)
  ) {
    preferredVariation.attributes.forEach((attribute) => {
      const option = getVariationAttributeOption(attribute);
      const attributeName = getMatchingProductAttributeName(product, attribute, option);

      if (attributeName && option) {
        initialVariants[attributeName] = option;
      }
    });
  }

  return initialVariants;
}

function mergeProductWithVariation(product, variation) {
  if (!product || !variation) return product;

  const variationImage = getVariationResponsiveImage(product, variation);
  const variationPrice = getRawPrice(variation);

  return {
    ...product,
    selectedVariationId: variation.id,
    variation_id: variation.id,
    variationId: variation.id,
    sku: variation.sku || product.sku,
    price: variationPrice ?? product.price,
    regular_price: variation.regular_price || product.regular_price,
    sale_price: variation.sale_price || "",
    price_html: "",
    image: variationImage?.src || getProductImage(product),
    images: variationImage
      ? [variationImage]
      : Array.isArray(product.images)
        ? product.images
        : [],
    variations: [],
    stock_status: variation.stock_status || product.stock_status,
    stock_quantity:
      variation.stock_quantity !== null &&
      variation.stock_quantity !== undefined &&
      variation.stock_quantity !== ""
        ? variation.stock_quantity
        : product.stock_quantity,
    manage_stock:
      variation.manage_stock !== null && variation.manage_stock !== undefined
        ? variation.manage_stock
        : product.manage_stock,
    backorders_allowed:
      variation.backorders_allowed !== null &&
      variation.backorders_allowed !== undefined
        ? variation.backorders_allowed
        : product.backorders_allowed,
    weight: variation.weight || product.weight,
  };
}

function renderProductPrice(product) {
  const offer = getPriceOffer(product);
  const isVariableParent = product?.type === "variable" && !product?.selectedVariationId;

  if (offer.currentFormatted) {
    if (offer.hasDiscount) {
      return (
        <div className="rgv-ticket-price rgv-ticket-price--sale">
          <strong>{offer.currentFormatted}</strong>
          <del>{offer.regularFormatted}</del>
        </div>
      );
    }

    return (
      <div className="rgv-ticket-price">
        <strong>{offer.currentFormatted}</strong>
      </div>
    );
  }

  if (
    !isVariableParent &&
    product?.price_html &&
    product.price_html.trim() !== ""
  ) {
    return (
      <div
        className="rgv-ticket-price product-price"
        dangerouslySetInnerHTML={{ __html: product.price_html }}
      />
    );
  }

  return (
    <div className="rgv-ticket-price is-empty">
      Select Variant
    </div>
  );
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function cleanNotifierMessage(value, type = "success") {
  const raw = String(value || "").trim();

  const plain = raw
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

  if (type === "success") {
    return "Perfect — you’re on the list. We’ll notify you as soon as this product is back in stock.";
  }

  return plain || "Something went wrong. Please try again.";
}

function IconBag() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}

function BackInStockForm({
  notifyName,
  setNotifyName,
  notifyEmail,
  setNotifyEmail,
  notifyStatus,
  notifyMessage,
  onSubmit,
}) {
  const isSuccess = notifyStatus === "success";

  return (
    <form
      onSubmit={onSubmit}
      className="rgv-pdp-notify border border-white/12 bg-white/[0.035] p-5"
    >
      <div className="mb-5">
        <h3 className="text-lg font-semibold tracking-[-0.02em] text-white">
          Notify me when available
        </h3>
        <p className="mt-1.5 max-w-xl text-sm leading-6 text-white/50">
          We&apos;ll email you when this exact selection is back in stock.
        </p>
      </div>

      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="back-in-stock-name"
              className="mb-2 block text-xs font-medium text-white/55"
            >
              Name
            </label>

            <input
              id="back-in-stock-name"
              name="name"
              type="text"
              autoComplete="name"
              value={notifyName}
              onChange={(event) => setNotifyName(event.target.value)}
              placeholder="Your name"
              className="h-12 w-full border border-white/15 bg-black/20 px-4 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-white/45"
            />
          </div>

          <div>
            <label
              htmlFor="back-in-stock-email"
              className="mb-2 block text-xs font-medium text-white/55"
            >
              Email
            </label>

            <input
              id="back-in-stock-email"
              name="email"
              type="email"
              autoComplete="email"
              value={notifyEmail}
              onChange={(event) => setNotifyEmail(event.target.value)}
              placeholder="you@email.com"
              className="h-12 w-full border border-white/15 bg-black/20 px-4 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-white/45"
              required
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={notifyStatus === "loading"}
          className="flex h-12 w-full items-center justify-center bg-red-700 px-6 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {notifyStatus === "loading" ? "Saving…" : "Notify me"}
        </button>
      </div>

      {notifyMessage && (
        <div
          role="status"
          aria-live="polite"
          className={`mt-4 border p-4 text-sm leading-6 ${
            isSuccess
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : "border-red-200 bg-red-50 text-red-950"
          }`}
        >
          <span>{notifyMessage}</span>
        </div>
      )}
    </form>
  );
}

function isFeaturedProduct(product) {
  return (
    product?.featured === true ||
    product?.featured === "true" ||
    product?.featured === 1 ||
    product?.featured === "1"
  );
}

function ProductComplements({ currentProductId }) {
  const sectionRef = useRef(null);
  const [products, setProducts] = useState([]);
  const [status, setStatus] = useState("idle");
  const [shouldLoad, setShouldLoad] = useState(false);
  const [variationSummaries, setVariationSummaries] = useState({});
  const [variationSummaryStatus, setVariationSummaryStatus] = useState({});

  useEffect(() => {
    const section = sectionRef.current;

    if (!section || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "420px 0px" },
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldLoad) return undefined;

    let isMounted = true;

    async function loadComplements() {
      try {
        setStatus("loading");

        const response = await fetch("/api/products?featured=true&limit=5");
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.message || "Could not load complements.");
        }

        const featuredProducts = Array.isArray(data.products)
          ? data.products
              .filter((item) => isFeaturedProduct(item))
              .filter(
                (item) => String(item.id) !== String(currentProductId || "")
              )
              .sort((a, b) => {
                const aInStock = a.stock_status === "instock";
                const bInStock = b.stock_status === "instock";

                if (aInStock && !bInStock) return -1;
                if (!aInStock && bInStock) return 1;

                return String(a.name || "").localeCompare(String(b.name || ""));
              })
              .slice(0, 4)
          : [];

        if (!isMounted) return;

        setProducts(featuredProducts);
        setStatus("success");

        const localSummaries = {};
        const nextStatuses = {};
        const requestIds = [];

        featuredProducts.forEach((product) => {
          const productId = String(product.id);

          if (product?.type !== "variable") {
            nextStatuses[productId] = "success";
            return;
          }

          const embeddedVariations = getCatalogProductVariations(product);
          const cachedVariations = getCachedVariationSummary(product.id);
          const variations = embeddedVariations.length
            ? embeddedVariations
            : cachedVariations;

          if (variations) {
            localSummaries[productId] = variations;
            nextStatuses[productId] = "success";
          } else {
            requestIds.push(product.id);
            nextStatuses[productId] = "loading";
          }
        });

        setVariationSummaries(localSummaries);
        setVariationSummaryStatus(nextStatuses);

        if (!requestIds.length) return;

        try {
          const { summaries, failedIds } =
            await requestVariationSummaryBatch(requestIds);

          if (!isMounted) return;

          const failedSet = new Set((failedIds || []).map(String));
          const normalizedSummaries = {};
          const resolvedStatuses = {};

          requestIds.forEach((productId) => {
            const key = String(productId);
            const variations = summaries?.[key];

            if (Array.isArray(variations) && !failedSet.has(key)) {
              normalizedSummaries[key] = variations;
            }

            // A missing summary must resolve to the product-page fallback,
            // never leave an action labelled as permanently loading.
            resolvedStatuses[key] = "success";
          });

          setVariationSummaries((current) => ({
            ...current,
            ...normalizedSummaries,
          }));
          setVariationSummaryStatus((current) => ({
            ...current,
            ...resolvedStatuses,
          }));
        } catch (error) {
          console.error(error);

          if (!isMounted) return;

          setVariationSummaryStatus((current) => {
            const next = { ...current };
            requestIds.forEach((productId) => {
              next[String(productId)] = "success";
            });
            return next;
          });
        }
      } catch (error) {
        console.error(error);

        if (isMounted) {
          setStatus("error");
        }
      }
    }

    loadComplements();

    return () => {
      isMounted = false;
    };
  }, [currentProductId, shouldLoad]);

  if (status === "success" && products.length === 0) {
    return null;
  }

  return (
    <section
      ref={sectionRef}
      className="rgv-product-related rgv-pdp-related"
    >
      <div className="mb-9 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-700">
            Explore more
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            Related products
          </h2>
        </div>
        <a
          href="/shop"
          className="text-sm font-semibold text-black underline decoration-black/20 underline-offset-4"
        >
          View all products
        </a>
      </div>

      {(status === "idle" || status === "loading") && (
        <div className="rgv-product-grid rgv-product-grid--related">
          {Array.from({ length: 4 }).map((_, index) => (
            <article
              key={index}
              className="rgv-index-card rgv-product-card rgv-index-card--loading"
            >
              <div className="rgv-card-media animate-pulse" />
              <div className="rgv-card-body space-y-3">
                <div className="h-5 w-2/3 animate-pulse bg-white/[0.07]" />
                <div className="h-4 w-full animate-pulse bg-white/[0.05]" />
                <div className="h-11 w-full animate-pulse bg-white/[0.07]" />
              </div>
            </article>
          ))}
        </div>
      )}

      {status === "error" && (
        <div className="border border-black/10 bg-white p-6 text-center">
          <p className="text-sm font-medium text-black/60">
            Related products are unavailable right now.
          </p>
        </div>
      )}

      {status === "success" && products.length > 0 && (
        <div className="rgv-product-grid rgv-product-grid--related">
          {products.map((item) => (
            <CatalogProductCard
              key={item.id}
              product={item}
              format={PRODUCT_FORMATS.SINGLE}
              variations={
                variationSummaries[String(item.id)] ||
                getCatalogProductVariations(item)
              }
              variationStatus={
                variationSummaryStatus[String(item.id)] ||
                (item.type === "variable" ? "loading" : "success")
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

function formatCertificateDate(value) {
  if (!value) return "Not listed";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function certificateMatchesVariation(certificate, variation) {
  const variationId = String(
    variation?.id || variation?.variation_id || variation?.variationId || "",
  ).trim();

  if (!variationId) return true;

  const certificateIds = [
    certificate?.variation_id,
    certificate?.variationId,
    ...(Array.isArray(certificate?.product_ids)
      ? certificate.product_ids
      : []),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (certificateIds.includes(variationId)) return true;

  const normalizeSku = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const variationSku = normalizeSku(variation?.sku);
  const certificateSku = normalizeSku(certificate?.sku);

  return Boolean(variationSku && certificateSku && variationSku === certificateSku);
}

function ProductVerification({ product, variation }) {
  const [status, setStatus] = useState("loading");
  const [certificate, setCertificate] = useState(null);
  const variationId = variation?.id || variation?.variation_id || 0;
  const requiresVariation = product?.type === "variable";

  useEffect(() => {
    if (!product?.id || (requiresVariation && !variationId)) {
      setStatus(requiresVariation ? "selection" : "empty");
      setCertificate(null);
      return undefined;
    }

    const controller = new AbortController();

    async function loadCertificate() {
      try {
        setStatus("loading");
        setCertificate(null);

        const params = new URLSearchParams({
          product_id: String(product.id),
        });

        if (variationId) params.set("variation_id", String(variationId));

        const response = await fetch(`/api/coas?${params.toString()}`, {
          headers: { Accept: "application/json" },
          cache: "default",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok) throw new Error("Certificate lookup failed.");

        const items = Array.isArray(payload?.items) ? payload.items : [];
        const matchingItems = variationId
          ? items.filter((item) => certificateMatchesVariation(item, variation))
          : items;
        const current =
          matchingItems.find((item) => item?.is_current) ||
          matchingItems[0] ||
          null;

        setCertificate(current);
        setStatus(current ? "success" : "empty");
      } catch (error) {
        if (error?.name === "AbortError") return;
        console.error(error);
        setStatus("error");
      }
    }

    loadCertificate();
    return () => controller.abort();
  }, [product?.id, requiresVariation, variationId, variation?.sku]);

  const archiveUrl = `/coa?product=${encodeURIComponent(product?.name || "")}`;

  return (
    <section
      className="rgv-verification-strip rgv-pdp-verification mt-16 border-y border-black/10 py-10"
      aria-labelledby="verification-title"
    >
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="rgv-kicker text-xs font-semibold uppercase tracking-[0.14em] text-red-700">
            Quality documentation
          </p>
          <h2
            id="verification-title"
            className="mt-2 text-2xl font-semibold tracking-[-0.025em]"
          >
            Certificate of analysis
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-black/55">
            The certificate shown matches the exact format and strength you
            selected.
          </p>
        </div>
        <span
          className={`rgv-verification-strip__state is-${status} text-xs font-medium text-black/55`}
          aria-live="polite"
        >
          {status === "loading"
            ? "Checking documentation…"
            : status === "success"
              ? "Certificate matched"
              : status === "selection"
                ? "Select a variation"
              : status === "empty"
                ? "Search the archive"
                : "Documentation unavailable"}
        </span>
      </header>

      {status === "success" && certificate ? (
        <div className="mt-8 grid gap-7 lg:grid-cols-[1fr_auto] lg:items-end">
          <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="border-l border-black/15 pl-4">
              <dt className="text-xs text-black/45">Purity</dt>
              <dd className="mt-1 text-sm font-semibold">
                {certificate.purity || "See certificate"}
              </dd>
            </div>
            <div className="border-l border-black/15 pl-4">
              <dt className="text-xs text-black/45">Lot</dt>
              <dd className="mt-1 text-sm font-semibold">
                {certificate.lot || certificate.batch || "See certificate"}
              </dd>
            </div>
            <div className="border-l border-black/15 pl-4">
              <dt className="text-xs text-black/45">Laboratory</dt>
              <dd className="mt-1 text-sm font-semibold">
                {certificate.lab || certificate.lab_name || "Independent lab"}
              </dd>
            </div>
            <div className="border-l border-black/15 pl-4">
              <dt className="text-xs text-black/45">Report date</dt>
              <dd className="mt-1 text-sm font-semibold">
                {formatCertificateDate(
                  certificate.report_date || certificate.test_date,
                )}
              </dd>
            </div>
          </dl>
          <div className="rgv-verification-strip__actions flex flex-wrap gap-3 text-sm font-semibold">
            {(certificate.url || certificate.pdf_url) && (
              <a
                href={certificate.url || certificate.pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="is-primary border border-black bg-black px-5 py-3 text-white transition hover:bg-black/80"
              >
                View certificate
              </a>
            )}
            <a
              href={archiveUrl}
              className="border border-black/20 bg-white px-5 py-3 text-black transition hover:border-black"
            >
              View batch history
            </a>
          </div>
        </div>
      ) : (
        <div className="rgv-verification-strip__fallback mt-7 flex flex-wrap items-center justify-between gap-4 bg-white p-5 text-sm text-black/60">
          <p className="max-w-2xl leading-6">
            {status === "loading"
              ? "Checking the certificate for your selection."
              : status === "selection"
                ? "Choose a format and strength to see its certificate."
                : "No exact certificate match is available here. You can search the full archive by product, SKU, or lot."}
          </p>
          {status !== "loading" && status !== "selection" && (
            <a
              href={archiveUrl}
              className="font-semibold text-red-700 underline decoration-red-700/25 underline-offset-4"
            >
              Search certificate archive
            </a>
          )}
        </div>
      )}
    </section>
  );
}

export default function ProductDetails({ slug, initialProduct = null }) {
  const { addItem } = useCart();
  const purchaseRef = useRef(null);
  const hasInitialProduct = Boolean(initialProduct?.id);

  const [product, setProduct] = useState(() => initialProduct || null);
  const [status, setStatus] = useState(
    hasInitialProduct ? "success" : "loading",
  );
  const [quantity, setQuantity] = useState(1);
  const [selectedVariants, setSelectedVariants] = useState(() =>
    hasInitialProduct ? buildInitialVariantSelection(initialProduct) : {},
  );
  const [justAdded, setJustAdded] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [notifyName, setNotifyName] = useState("");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [notifyStatus, setNotifyStatus] = useState("idle");
  const [notifyMessage, setNotifyMessage] = useState("");
  const [purchasePanelVisible, setPurchasePanelVisible] = useState(false);
  const [variationLoadStatus, setVariationLoadStatus] = useState(() =>
    initialProduct?.type === "variable" &&
    getVariationList(initialProduct).length === 0
      ? "loading"
      : "ready",
  );
  const [variationRetryKey, setVariationRetryKey] = useState(0);

  useEffect(() => {
    const suppliedSlug = String(initialProduct?.slug || "").trim();
    const cleanSlug = String(slug || "").trim();

    const canUseInitialProduct =
      initialProduct?.id &&
      (!cleanSlug || !suppliedSlug || suppliedSlug === cleanSlug);
    const initialNeedsVariations =
      canUseInitialProduct &&
      initialProduct?.type === "variable" &&
      getVariationList(initialProduct).length === 0;

    if (canUseInitialProduct) {
      setProduct(initialProduct);
      setSelectedVariants(buildInitialVariantSelection(initialProduct));
      setStatus("success");

      if (!initialNeedsVariations && variationRetryKey === 0) {
        setVariationLoadStatus("ready");
        return undefined;
      }
    }

    let isMounted = true;

    async function loadProduct() {
      try {
        if (canUseInitialProduct) {
          setVariationLoadStatus("loading");
        } else {
          setStatus("loading");
          setQuantity(1);
          setSelectedVariants({});
          setNotifyName("");
          setNotifyEmail("");
          setNotifyStatus("idle");
          setNotifyMessage("");
        }

        if (!cleanSlug) {
          throw new Error("Missing product slug.");
        }

        const shouldRefresh = initialNeedsVariations || variationRetryKey > 0;
        const response = await fetch(
          `/api/products?slug=${encodeURIComponent(cleanSlug)}${
            shouldRefresh ? "&refresh=1" : ""
          }`,
          {
            cache: shouldRefresh ? "no-store" : "default",
          }
        );

        const data = await response.json().catch(() => null);

        const foundProduct = Array.isArray(data?.products)
          ? data.products[0]
          : data?.product;

        if (!response.ok || !foundProduct) {
          throw new Error(data?.message || "Product not found");
        }

        if (!isMounted) return;

        setProduct(foundProduct);
        setSelectedVariants(buildInitialVariantSelection(foundProduct));
        setStatus("success");
        setVariationLoadStatus(
          foundProduct?.type === "variable" &&
            getVariationList(foundProduct).length === 0
            ? "unavailable"
            : "ready",
        );
      } catch (error) {
        console.error(error);

        if (isMounted) {
          if (canUseInitialProduct) {
            setVariationLoadStatus("error");
          } else {
            setStatus("error");
          }
        }
      }
    }

    loadProduct();

    return () => {
      isMounted = false;
    };
  }, [slug, initialProduct, variationRetryKey]);

  useEffect(() => {
    const panel = purchaseRef.current;

    if (
      status !== "success" ||
      !panel ||
      typeof IntersectionObserver === "undefined"
    ) {
      setPurchasePanelVisible(false);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setPurchasePanelVisible(
          Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.12),
        );
      },
      { threshold: [0, 0.12, 0.5] },
    );

    observer.observe(panel);
    return () => observer.disconnect();
  }, [status, product?.id]);

  const selectedVariation = useMemo(() => {
    return getSelectedVariation(product, selectedVariants);
  }, [product, selectedVariants]);

  const displayProduct = useMemo(() => {
    return selectedVariation
      ? mergeProductWithVariation(product, selectedVariation)
      : product;
  }, [product, selectedVariation]);

  const selectedVariationImage = useMemo(
    () => getVariationResponsiveImage(product, selectedVariation),
    [product, selectedVariation],
  );
  const image =
    selectedVariationImage?.src ||
    (displayProduct ? getProductImage(displayProduct) : FALLBACK_IMAGE);
  const heroImageData =
    selectedVariationImage || displayProduct?.images?.[0] || {};
  const stockBadge = displayProduct ? getStockBadge(displayProduct) : null;

  const category = product?.categories?.[0]?.name || "Research Compound";
  const isVariableProduct = product?.type === "variable";
  const selectableAttributes = useMemo(
    () => getSelectableProductAttributes(product),
    [product?.attributes],
  );
  const hasVariants = selectableAttributes.length > 0;
  const hasVariationData = getVariationList(product).length > 0;
  const orderedAttributes = useMemo(
    () => sortPurchaseAttributes(selectableAttributes),
    [selectableAttributes],
  );
  const formatAttribute = orderedAttributes.find(isPurchaseFormatAttribute);
  const strengthAttributes = orderedAttributes.filter(
    (attribute) => !isPurchaseFormatAttribute(attribute),
  );
  const selectedFormatValue =
    (formatAttribute?.name && selectedVariants[formatAttribute.name]) || "Single";
  const selectedFormatMeta = getFormatMeta(selectedFormatValue);
  const selectedStrengthLabel =
    Object.entries(selectedVariants || {})
      .filter(([name, value]) => value && !isPurchaseFormatAttribute(name))
      .map(([, value]) => value)
      .join(" / ") || "Standard";
  const selectedConfigLabel = `${selectedFormatMeta.label} / ${selectedStrengthLabel}`;

  const isInstock = isProductAvailable(displayProduct);
  const variationOptionsReady = !isVariableProduct || hasVariationData;
  const selectedVariationPurchasable = isVariableProduct
    ? isVariationPurchasable(selectedVariation)
    : true;

  const canAddToCart =
    variationOptionsReady &&
    isInstock &&
    selectedVariationPurchasable;

  const sku = displayProduct?.sku ? displayProduct.sku : "N/A";
  const productType =
    selectedFormatMeta.kind === "kits"
      ? selectedFormatMeta.packSize
        ? `Kit of ${selectedFormatMeta.packSize} vials`
        : "Multi-vial kit"
      : "Single vial";

  const maxQuantity = useMemo(() => {
    return getMaximumPurchasableQuantity(displayProduct, 99);
  }, [displayProduct]);

  const stockQuantity = !isInstock
    ? "Sold Out"
    : displayProduct?.stock_quantity !== null &&
        displayProduct?.stock_quantity !== undefined
      ? `${displayProduct.stock_quantity} Units`
      : "Available";

  const purchasePoints = getProductLoyaltyPoints(displayProduct, quantity);
  const purchaseOffer = getPriceOffer(displayProduct);
  const mobilePrice =
    formatMoney(
      displayProduct?.price ??
        displayProduct?.sale_price ??
        displayProduct?.regular_price,
      displayProduct?.currency || displayProduct?.currency_code || "USD",
    ) || "Select variant";

  const handleVariantChange = (attributeName, value, preferredVariation = null) => {
    if (isAdding) return;

    setSelectedVariants((previousSelection) => {
      const nextSelection = {
        ...getScopedVariantSelection(product, previousSelection),
        [attributeName]: value,
      };
      let matchingVariation = preferredVariation;

      if (!matchingVariation) {
        matchingVariation = getAvailableVariationMatchingSelection(
          product,
          nextSelection,
        );
      }

      if (!matchingVariation) {
        const changedAttribute = orderedAttributes.find(
          (attribute) =>
            normalizeAttributeName(attribute?.name || attribute?.slug || "") ===
            normalizeAttributeName(attributeName),
        );
        const compatibilitySelection = isPurchaseFormatAttribute(
          changedAttribute,
        )
          ? { [attributeName]: value }
          : {
              ...(formatAttribute?.name &&
              nextSelection[formatAttribute.name]
                ? {
                    [formatAttribute.name]:
                      nextSelection[formatAttribute.name],
                  }
                : {}),
              [attributeName]: value,
            };

        matchingVariation =
          getAvailableVariationMatchingSelection(
            product,
            compatibilitySelection,
          ) ||
          getAnyVariationMatchingSelection(product, compatibilitySelection);
      }

      return matchingVariation
        ? {
            ...nextSelection,
            ...buildSelectionFromVariation(product, matchingVariation),
          }
        : nextSelection;
    });

    setQuantity(1);
    setJustAdded(false);
  };

  const handleAddToCart = async () => {
    if (
      !product ||
      !displayProduct ||
      !canAddToCart ||
      isAdding ||
      justAdded
    ) {
      return;
    }

    const itemToAdd = {
      ...displayProduct,
      name: isVariableProduct
        ? `${product.name} \u2014 ${selectedConfigLabel}`
        : product.name,
      parent_id: product.id,
      product_id: product.id,
      variation_id: selectedVariation?.id || 0,
      variationId: selectedVariation?.id || 0,
      selectedOptions: selectedVariants,
      selected_option: isVariableProduct ? selectedConfigLabel : "",
      cartKey: selectedVariation
        ? `${product.id}:${selectedVariation.id}`
        : String(product.id),
      short_description: product.short_description || "",
      description: product.description || "",
    };

    setIsAdding(true);
    let result;

    try {
      result = await addItem(itemToAdd, quantity);
    } finally {
      setIsAdding(false);
    }

    if (!result?.valid) return;

    setJustAdded(true);

    window.clearTimeout(window.__productAddedTimer);
    window.__productAddedTimer = window.setTimeout(() => {
      setJustAdded(false);
    }, 1600);
  };

  const handleBackInStockSubmit = async (event) => {
    event.preventDefault();

    if (!product) return;

    const cleanEmail = notifyEmail.trim().toLowerCase();

    if (!isValidEmail(cleanEmail)) {
      setNotifyStatus("error");
      setNotifyMessage("Please enter a valid email address.");
      return;
    }

    try {
      setNotifyStatus("loading");
      setNotifyMessage("");

      const response = await fetch("/api/back-in-stock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productId: product.id,
          variationId: selectedVariation?.id || 0,
          email: cleanEmail,
          name: notifyName.trim(),
          selectedOptions: selectedVariants,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error(
          cleanNotifierMessage(
            data?.message || "Could not save your notification request.",
            "error"
          )
        );
      }

      setNotifyStatus("success");
      setNotifyMessage(cleanNotifierMessage(data?.message, "success"));
      setNotifyEmail("");
      setNotifyName("");
    } catch (error) {
      console.error(error);

      setNotifyStatus("error");
      setNotifyMessage(cleanNotifierMessage(error.message, "error"));
    }
  };

  const decreaseQuantity = () => {
    if (isAdding) return;
    setQuantity((q) => Math.max(1, q - 1));
  };

  const increaseQuantity = () => {
    if (isAdding) return;
    setQuantity((q) => Math.min(maxQuantity, q + 1));
  };

  if (status === "loading") {
    return (
      <section className="min-h-screen bg-[#050505] px-5 pb-20 pt-[148px] text-white sm:px-8 lg:px-10">
        <div className="mx-auto grid max-w-[1320px] overflow-hidden border border-white/10 lg:grid-cols-[minmax(0,1.55fr)_minmax(390px,0.85fr)]">
          <div className="h-[560px] animate-pulse border-b border-white/10 bg-white/[0.04] lg:h-[720px] lg:border-b-0 lg:border-r" />

          <div className="flex min-h-[560px] flex-col justify-center p-7 lg:min-h-[720px]">
            <div className="mb-5 h-3 w-36 animate-pulse bg-white/[0.08]" />
            <div className="mb-5 h-16 w-full animate-pulse bg-white/[0.08]" />
            <div className="mb-8 h-12 w-56 animate-pulse bg-white/[0.08]" />

            <div className="space-y-3">
              <div className="h-3 w-full animate-pulse bg-white/[0.06]" />
              <div className="h-3 w-5/6 animate-pulse bg-white/[0.06]" />
              <div className="h-3 w-4/6 animate-pulse bg-white/[0.06]" />
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (status === "error" || !product) {
    return (
      <section className="flex min-h-[70vh] items-center justify-center bg-[#050505] px-5 pt-[140px] text-center text-white">
        <div className="max-w-md border border-white/12 bg-[#0a0a0a] p-10">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-red-500">
            Product unavailable
          </p>

          <h2 className="text-3xl font-semibold tracking-[-0.035em]">
            We couldn&apos;t load this product
          </h2>

          <p className="mt-3 text-sm leading-6 text-white/50">
            Please return to the shop and try again in a moment.
          </p>

          <a
            href="/shop"
            className="mt-7 inline-flex h-12 items-center justify-center rounded-full bg-red-700 px-7 text-sm font-semibold text-white transition hover:bg-red-600"
          >
            Return to shop
          </a>
        </div>
      </section>
    );
  }

  const formatOptions = formatAttribute
    ? sortVariantOptions(formatAttribute.options || []).sort(
        (left, right) =>
          Number(isKitFormatValue(left)) - Number(isKitFormatValue(right)),
      )
    : [];

  return (
    <main className="rgv-product-page min-h-screen overflow-x-clip bg-[#070506] pb-0 pt-[132px] text-white sm:pt-[148px]">
      <div className="mx-auto w-full max-w-[1320px] px-5 sm:px-8 lg:px-12">
        <nav
          className="rgv-product-breadcrumb mb-5 flex items-center gap-2 text-xs text-white/45"
          aria-label="Breadcrumb"
        >
          <a href="/shop" className="transition hover:text-white">
            Shop
          </a>
          <span aria-hidden="true">/</span>
          <span className="truncate text-white/70">{product.name}</span>
        </nav>

        <section className="rgv-product-stage grid min-w-0 overflow-hidden border border-white/12 bg-[#0a0a0a] lg:min-h-[720px] lg:grid-cols-[minmax(0,1.55fr)_minmax(390px,0.85fr)]">
          <div className="rgv-product-showcase min-w-0">
            <div className="rgv-stage-media relative flex min-h-[520px] min-w-0 flex-col bg-[#111] p-5 sm:min-h-[620px] sm:p-7 lg:min-h-0">
              <header className="rgv-stage-identity">
                <p className="rgv-stage-overline">
                  <span>RGV Prime</span>
                  <span>{category}</span>
                </p>
                <h1 className="rgv-product-title">{product.name}</h1>
              </header>

              <div className="rgv-stage-coordinate" aria-hidden="true">
                <span>SPECIMEN / ACTIVE</span>
                <strong>
                  REF.{String(selectedVariation?.id || product.id).slice(-6).toUpperCase()}
                </strong>
                <small>{selectedConfigLabel}</small>
              </div>

              <div className="rgv-stage-scale" aria-hidden="true">
                <span>00</span>
                <span>25</span>
                <span>50</span>
                <span>75</span>
                <span>100</span>
              </div>

              <div className="rgv-stage-image flex min-h-0 flex-1 items-center justify-center py-7">
                <img
                  key={`${selectedVariation?.id || product.id}:${image}`}
                  src={image}
                  srcSet={
                    heroImageData?.srcset ||
                    heroImageData?.srcSet ||
                    undefined
                  }
                  sizes={
                    heroImageData?.sizes ||
                    "(max-width: 639px) 92vw, (max-width: 1023px) 680px, 760px"
                  }
                  width="680"
                  height="680"
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                  alt={
                    displayProduct.image_alt ||
                    product.image_alt ||
                    `${product.name} laboratory research product`
                  }
                  className="max-h-[460px] w-full max-w-[660px] object-contain sm:max-h-[540px] lg:max-h-[560px]"
                />
              </div>

              <div className="rgv-stage-media-status flex items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-2 text-white/65">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      isInstock && variationOptionsReady
                        ? "bg-emerald-400"
                        : "bg-red-500"
                    }`}
                  />
                  {variationOptionsReady
                    ? stockBadge?.label || "Availability pending"
                    : "Options unavailable"}
                </span>
              </div>
            </div>
          </div>

          <aside
            ref={purchaseRef}
            className="rgv-stage-buy rgv-purchase-ticket flex min-w-0 flex-col bg-[#0a0a0a] p-6 sm:p-8 lg:p-7 xl:p-9"
          >
            <div className="rgv-stage-buy-head border-b border-white/10 pb-6">
              <div className="rgv-purchase-heading">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-red-500">
                    Order configuration
                  </p>
                  <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em] text-white">
                    Build your selection
                  </h2>
                </div>
              </div>

              <div className="rgv-price-offer">
                <div className="rgv-price-offer__top">
                  <span>Your price</span>
                  {variationOptionsReady && purchaseOffer.hasDiscount && (
                    <strong>
                      Save {purchaseOffer.percentage}%
                    </strong>
                  )}
                </div>

                <div
                  key={`price-${selectedVariation?.id || product.id}`}
                  className="rgv-price-ledger"
                  aria-live="polite"
                >
                  {variationOptionsReady ? (
                    renderProductPrice(displayProduct)
                  ) : (
                    <div className="rgv-ticket-price is-empty">
                      Options unavailable
                    </div>
                  )}
                </div>

                {variationOptionsReady && purchaseOffer.hasDiscount && (
                  <p className="rgv-price-offer__saving">
                    You save {purchaseOffer.savingsFormatted} per unit
                  </p>
                )}
              </div>

              {variationOptionsReady && purchasePoints > 0 && (
                <div
                  key={`points-${selectedVariation?.id || product.id}-${quantity}`}
                  className="rgv-points-credit"
                  aria-live="polite"
                >
                  <span className="rgv-points-credit__icon" aria-hidden="true">
                    <Coins size={19} strokeWidth={1.9} />
                  </span>
                  <span className="rgv-points-credit__copy">
                    <small>RGV rewards</small>
                    <strong>+{formatPoints(purchasePoints)} points</strong>
                  </span>
                  <span className="rgv-points-credit__note">
                    earned with this order
                  </span>
                </div>
              )}
            </div>

            {isVariableProduct && !variationOptionsReady ? (
              <div
                className="rgv-pdp-variation-state my-6 border border-white/12 bg-white/[0.035] p-5"
                role="status"
                aria-live="polite"
              >
                <h2 className="text-base font-semibold text-white">
                  {variationLoadStatus === "loading"
                    ? "Loading available options"
                    : "Product options are temporarily unavailable"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-white/48">
                  {variationLoadStatus === "loading"
                    ? "Checking current prices and availability."
                    : "We couldn’t load the available choices. Try again before adding this product."}
                </p>
                {variationLoadStatus !== "loading" && (
                  <button
                    type="button"
                    onClick={() => setVariationRetryKey((key) => key + 1)}
                    className="mt-4 min-h-11 border border-white/20 px-5 text-sm font-semibold text-white transition hover:border-white/50"
                  >
                    Try again
                  </button>
                )}
              </div>
            ) : (
              <>
                {formatAttribute && (
                  <div className="rgv-buy-format mt-6">
                    <label className="sr-only" aria-hidden="true">
                      {formatAttribute.name}
                    </label>
                    <div className="mb-3 flex items-end justify-between gap-4">
                      <p className="rgv-config-label text-sm font-semibold text-white">
                        <span>01</span>
                        Format
                      </p>
                      <span className="text-[11px] text-white/38">
                        Single vial or kit of 10
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {formatOptions.map((option) => {
                        const isSelected =
                          selectedVariants[formatAttribute.name] === option;
                        const optionPrice = getVariantPricePreview(
                          product,
                          selectedVariants,
                          formatAttribute.name,
                          option,
                        );
                        const formatMeta = getFormatMeta(option);

                        return (
                          <button
                            key={option}
                            type="button"
                            aria-pressed={isSelected}
                            disabled={isAdding || !optionPrice.variation}
                            onClick={() =>
                              handleVariantChange(
                                formatAttribute.name,
                                option,
                                optionPrice.variation,
                              )
                            }
                            className={`rgv-variant-option min-h-[92px] border p-4 text-left transition ${
                              isSelected
                                ? "is-active border-red-600 bg-red-700 text-white"
                                : "border-white/14 bg-white/[0.035] text-white hover:border-white/35"
                            }`}
                          >
                            <strong className="block text-base font-semibold">
                              {option}
                            </strong>
                            <small
                              className={`mt-1 block text-[11px] leading-4 ${
                                isSelected ? "text-white/70" : "text-white/42"
                              }`}
                            >
                              {formatMeta.packSize === 1
                                ? "1 vial"
                                : `${formatMeta.packSize || 10} vials`}
                            </small>
                            <span className="mt-3 block text-sm font-semibold">
                              {optionPrice.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {strengthAttributes.map((attribute, attributeIndex) => (
                  <div key={attribute.name} className="rgv-buy-strengths mt-6">
                    <label className="sr-only" aria-hidden="true">
                      {attribute.name}
                    </label>
                    <div className="mb-3 flex items-end justify-between gap-4">
                      <p className="rgv-config-label text-sm font-semibold text-white">
                        <span>
                          {String(
                            attributeIndex + (formatAttribute ? 2 : 1),
                          ).padStart(2, "0")}
                        </span>
                        Strength
                      </p>
                      <span className="text-[11px] text-white/38">
                        Amount per vial
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                      {sortVariantOptions(attribute.options || []).map(
                        (option) => {
                          const isSelected =
                            selectedVariants[attribute.name] === option;
                          const optionPrice = getVariantPricePreview(
                            product,
                            selectedVariants,
                            attribute.name,
                            option,
                          );

                          return (
                            <button
                              key={option}
                              type="button"
                              aria-pressed={isSelected}
                              disabled={isAdding || !optionPrice.variation}
                              onClick={() =>
                                handleVariantChange(
                                  attribute.name,
                                  option,
                                  optionPrice.variation,
                                )
                              }
                              className={`rgv-variant-option min-h-[64px] border px-3 py-2 text-left transition ${
                                isSelected
                                  ? "is-active border-white bg-white text-black"
                                  : "border-white/14 bg-transparent text-white hover:border-white/35"
                              }`}
                            >
                              <strong className="block text-sm font-semibold">
                                {option}
                              </strong>
                              <small
                                className={`mt-1 block text-[10px] ${
                                  isSelected ? "text-black/55" : "text-white/38"
                                }`}
                              >
                                {optionPrice.label}
                              </small>
                            </button>
                          );
                        },
                      )}
                    </div>
                  </div>
                ))}

                {hasVariants && hasVariationData && !selectedVariation && (
                  <div className="rgv-pdp-selection-alert mt-5 border border-amber-400/35 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
                    This combination is unavailable. Choose another format or
                    strength to continue.
                  </div>
                )}

                <div className="rgv-stage-selection mt-6 flex items-center justify-between gap-4 border-y border-white/10 py-4 text-xs">
                  <span className="text-white/38">Your selection</span>
                  <strong className="text-right font-medium text-white/85">
                    {selectedConfigLabel} · {mobilePrice}
                  </strong>
                </div>

                {isInstock ? (
                  <div className="rgv-purchase-actions mt-5 grid gap-2 sm:grid-cols-[112px_1fr] lg:grid-cols-1 xl:grid-cols-[112px_1fr]">
                    <div className="rgv-quantity-control flex h-14 items-center justify-between border border-white/16 px-1">
                      <button
                        type="button"
                        onClick={decreaseQuantity}
                        disabled={isAdding}
                        className="flex h-11 w-9 items-center justify-center text-xl text-white/45 transition hover:text-white"
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <span className="text-base font-semibold text-white">
                        {quantity}
                      </span>
                      <button
                        type="button"
                        onClick={increaseQuantity}
                        disabled={isAdding}
                        className="flex h-11 w-9 items-center justify-center text-xl text-white/45 transition hover:text-white"
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleAddToCart}
                      disabled={!canAddToCart || isAdding || justAdded}
                      aria-busy={isAdding}
                      className={`rgv-product-add-button flex h-14 items-center justify-center gap-3 px-6 text-sm font-semibold transition ${
                        canAddToCart && !justAdded
                          ? "bg-red-700 text-white hover:bg-red-600"
                          : "cursor-not-allowed bg-white/10 text-white/35"
                      }`}
                    >
                      {hasVariants && !selectedVariation
                        ? "Choose a valid option"
                        : isVariableProduct && !selectedVariationPurchasable
                          ? "Unavailable"
                        : justAdded
                          ? "Added to cart"
                          : isAdding
                            ? "Adding…"
                            : "Add to cart"}
                      <IconBag />
                    </button>
                  </div>
                ) : (
                  <div className="mt-5">
                    <BackInStockForm
                      notifyName={notifyName}
                      setNotifyName={setNotifyName}
                      notifyEmail={notifyEmail}
                      setNotifyEmail={setNotifyEmail}
                      notifyStatus={notifyStatus}
                      notifyMessage={notifyMessage}
                      onSubmit={handleBackInStockSubmit}
                    />
                  </div>
                )}
              </>
            )}

            <ul className="rgv-stage-assurances mt-6 grid text-white/50">
              {PURCHASE_ASSURANCES.map(
                ({ title, detail, icon: AssuranceIcon }) => (
                  <li key={title} className="rgv-assurance-chip">
                    <span className="rgv-assurance-icon" aria-hidden="true">
                      <AssuranceIcon size={18} strokeWidth={1.9} />
                    </span>
                    <span className="rgv-assurance-copy">
                      <strong>{title}</strong>
                      <small>{detail}</small>
                    </span>
                  </li>
                ),
              )}
            </ul>
          </aside>
        </section>
      </div>

      <div className="rgv-product-after mt-0 bg-[#070506] py-0 text-white">
        <div className="mx-auto w-full max-w-[1320px] px-5 sm:px-8 lg:px-12">
          <ProductVerification product={product} variation={selectedVariation} />

          <section
            className="rgv-product-evidence rgv-pdp-info mt-20 border-t border-white/10 pt-14"
            aria-labelledby="product-information-title"
          >
            <div className="rgv-pdp-info-head mb-10 max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-700">
                Product record
              </p>
              <h2
                id="product-information-title"
                className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl"
              >
                About {product.name}
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-6 text-white/52">
                Product information and the current purchasable configuration.
              </p>
            </div>

            <div className="rgv-pdp-info-grid grid gap-12 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-16">
              <div className="rgv-product-description rgv-pdp-description min-w-0">
                <div
                  className="max-w-3xl space-y-5 text-[15px] leading-7 text-black/65 [&>h1]:text-2xl [&>h1]:font-semibold [&>h1]:text-black [&>h2]:text-2xl [&>h2]:font-semibold [&>h2]:text-black [&>h3]:text-xl [&>h3]:font-semibold [&>h3]:text-black [&_a]:text-red-700 [&_strong]:font-semibold [&_strong]:text-black [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5"
                  dangerouslySetInnerHTML={{
                    __html:
                      product.description ||
                      product.short_description ||
                      "Product information is currently being updated.",
                  }}
                />

                <div className="rgv-research-notice mt-10 border-l-2 border-red-700 pl-5 text-xs leading-6 text-white/50">
                  <strong className="font-semibold text-white/75">
                    Research use only.
                  </strong>{" "}
                  Not intended for human consumption, veterinary use,
                  diagnosis, treatment, cure, or prevention of disease.
                </div>
              </div>

              <aside className="rgv-product-specs rgv-pdp-specs">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-red-500">
                  Current configuration
                </p>
                <h3 className="mt-2 text-xl font-semibold">Selection details</h3>
                <dl className="mt-5 divide-y divide-white/10 border-y border-white/10">
                  <div className="flex justify-between gap-5 py-4 text-sm">
                    <dt className="text-white/50">SKU</dt>
                    <dd className="text-right font-medium">{sku}</dd>
                  </div>
                  <div className="flex justify-between gap-5 py-4 text-sm">
                    <dt className="text-white/50">Format</dt>
                    <dd className="text-right font-medium">{productType}</dd>
                  </div>
                  {selectedStrengthLabel !== "Standard" && (
                    <div className="flex justify-between gap-5 py-4 text-sm">
                      <dt className="text-white/50">Strength</dt>
                      <dd className="text-right font-medium">
                        {selectedStrengthLabel}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-5 py-4 text-sm">
                    <dt className="text-white/50">Category</dt>
                    <dd className="text-right font-medium">{category}</dd>
                  </div>
                  <div className="flex justify-between gap-5 py-4 text-sm">
                    <dt className="text-white/50">Availability</dt>
                    <dd className="text-right font-medium">{stockQuantity}</dd>
                  </div>
                  {displayProduct?.weight && (
                    <div className="flex justify-between gap-5 py-4 text-sm">
                      <dt className="text-white/50">Shipping weight</dt>
                      <dd className="text-right font-medium">
                        {displayProduct.weight} kg
                      </dd>
                    </div>
                  )}
                </dl>
              </aside>
            </div>
          </section>

          <ProductComplements currentProductId={product.id} />
        </div>
      </div>

      {!purchasePanelVisible && (
        <div
          className="rgv-mobile-purchase-bar rgv-pdp-mobile-purchase"
          aria-label="Purchase controls"
        >
          <div>
            <small>{selectedConfigLabel}</small>
            <strong>{mobilePrice}</strong>
          </div>
          <button
            type="button"
            disabled={isAdding || justAdded}
            aria-busy={isAdding}
            onClick={() => {
              if (canAddToCart) {
                handleAddToCart();
                return;
              }

              purchaseRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            }}
          >
            {justAdded
              ? "Added to cart"
              : isAdding
                ? "Adding…"
                : canAddToCart
                ? "Add to cart"
                : !variationOptionsReady
                  ? variationLoadStatus === "loading"
                    ? "Loading options"
                    : "Review options"
                  : isVariableProduct && !selectedVariationPurchasable
                    ? "Unavailable"
                  : isInstock
                    ? "Select options"
                    : "Notify me"}
          </button>
        </div>
      )}
    </main>
  );
}
