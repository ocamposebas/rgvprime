import { useEffect, useMemo, useState } from "react";
import { useCart } from "../cart/CartContext";
import coaData from "../data/coas.json";

const FALLBACK_IMAGE = "/logo.webp";

function getStockBadge(product) {
  const quantity =
    product?.stock_quantity !== null &&
    product?.stock_quantity !== undefined &&
    product?.stock_quantity !== ""
      ? Number(product.stock_quantity)
      : null;

  if (product?.stock_status !== "instock" && product?.backorders_allowed !== true) {
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

function getLowestAvailableVariation(product) {
  const variations = sortVariationsByStrength(getVariationList(product));

  return (
    variations.find(
      (variation) =>
        variation?.stock_status === "instock" || variation?.backorders_allowed === true
    ) || variations[0] || null
  );
}

function getMatchingProductAttributeName(product, variationAttribute, option) {
  const attributes = Array.isArray(product?.attributes) ? product.attributes : [];
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

  if (variations.length === 0) return null;

  const exactMatch = variations.find((variation) =>
    variationMatchesSelection(variation, selectedVariants)
  );

  if (exactMatch) return exactMatch;

  const selectedValues = Object.values(selectedVariants || {}).filter(Boolean);

  if (selectedValues.length > 0) {
    const valueMatch = variations.find((variation) =>
      selectedValues.every((selectedValue) =>
        getVariationOptionValues(variation).some((variationValue) =>
          valuesLookEquivalent(variationValue, selectedValue)
        )
      )
    );

    if (valueMatch) return valueMatch;

    const selectedStrength = selectedValues
      .map((value) => getStrengthMatch(value))
      .filter(Boolean)
      .map((strength) => strength.sortValue)[0];

    if (selectedStrength !== undefined) {
      const strengthMatch = variations.find((variation) => {
        const variationStrength = getVariationStrengthValue(variation);

        return (
          Number.isFinite(variationStrength) &&
          Math.abs(variationStrength - selectedStrength) < 0.000001
        );
      });

      if (strengthMatch) return strengthMatch;
    }

    const attributeEntries = Object.entries(selectedVariants || {}).filter(
      ([, value]) => value !== null && value !== undefined && value !== ""
    );

    for (const [attributeName, selectedValue] of attributeEntries) {
      const attribute = Array.isArray(product?.attributes)
        ? product.attributes.find((item) =>
            normalizeAttributeName(item?.name || item?.slug || "") ===
              normalizeAttributeName(attributeName) ||
            normalizeAttributeName(item?.name || item?.slug || "").includes(
              normalizeAttributeName(attributeName)
            ) ||
            normalizeAttributeName(attributeName).includes(
              normalizeAttributeName(item?.name || item?.slug || "")
            )
          )
        : null;

      const sortedOptions = sortVariantOptions(attribute?.options || []);
      const selectedIndex = sortedOptions.findIndex((option) =>
        valuesLookEquivalent(option, selectedValue)
      );

      if (selectedIndex >= 0 && variations[selectedIndex]) {
        return variations[selectedIndex];
      }
    }
  }

  return getLowestAvailableVariation(product);
}

function buildInitialVariantSelection(product) {
  const initialVariants = {};
  const preferredVariation = getLowestAvailableVariation(product);
  const preferredOptions = getVariationOptionValues(preferredVariation);

  if (Array.isArray(product?.attributes) && product.attributes.length > 0) {
    product.attributes.forEach((attr) => {
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

  const variationImage = getVariationImage(variation);

  return {
    ...product,
    selectedVariationId: variation.id,
    variation_id: variation.id,
    variationId: variation.id,
    sku: variation.sku || product.sku,
    price: variation.price || variation.sale_price || variation.regular_price || product.price,
    regular_price: variation.regular_price || product.regular_price,
    sale_price: variation.sale_price || "",
    price_html: "",
    image: variationImage || getProductImage(product),
    images: variationImage
      ? [{ src: variationImage }]
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
  const currency = product?.currency || product?.currency_code || "USD";
  const isVariableParent = product?.type === "variable" && !product?.selectedVariationId;

  if (
    !isVariableParent &&
    product?.price_html &&
    product.price_html.trim() !== ""
  ) {
    return (
      <div
        className="product-price text-3xl font-black tracking-[-0.055em] text-white sm:text-4xl lg:text-[3.15rem] [&_.amount]:text-white [&_.woocommerce-Price-amount]:text-white [&>del]:mr-3 [&>del]:text-base [&>del]:text-white/25 [&>ins]:no-underline"
        dangerouslySetInnerHTML={{ __html: product.price_html }}
      />
    );
  }

  if (product?.sale_price && product?.regular_price) {
    const salePrice = formatMoney(product.sale_price, currency);
    const regularPrice = formatMoney(product.regular_price, currency);

    if (salePrice && regularPrice && salePrice !== regularPrice) {
      return (
        <div className="flex flex-wrap items-end gap-3">
          <span className="text-3xl font-black tracking-[-0.055em] text-white sm:text-4xl lg:text-[3.15rem]">
            {salePrice}
          </span>

          <span className="pb-2 text-xl font-black tracking-[-0.04em] text-white/24 line-through">
            {regularPrice}
          </span>
        </div>
      );
    }
  }

  const singlePrice =
    product?.price ?? product?.sale_price ?? product?.regular_price ?? null;

  const formattedPrice = formatMoney(singlePrice, currency);

  if (formattedPrice) {
    return (
      <div className="text-3xl font-black tracking-[-0.055em] text-white sm:text-4xl lg:text-[3.15rem]">
        {formattedPrice}
      </div>
    );
  }

  return (
    <div className="text-2xl font-black tracking-[-0.04em] text-white/45 sm:text-3xl">
      Select Variant
    </div>
  );
}

function findCOA(product) {
  if (!product || !coaData?.companies?.[0]?.files) return null;

  const files = coaData.companies[0].files;
  const prodName = product.name ? product.name.toLowerCase() : "";
  const prodSku = product.sku ? product.sku.toLowerCase() : "";

  return files.find((file) => {
    const coaSku = file.sku ? file.sku.toLowerCase() : "";
    return (prodSku && prodSku === coaSku) || prodName.includes(coaSku);
  });
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

function IconShield() {
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
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
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

function IconArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 17L17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

function TechnicalRow({ icon, label, value }) {
  return (
    <div className="group flex items-center justify-between gap-5 border-b border-white/[0.06] py-4 last:border-0">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.035] text-white/45 transition duration-300 group-hover:border-red-500/30 group-hover:bg-red-500/10 group-hover:text-red-300">
          {icon}
        </div>

        <p className="truncate text-[10px] font-black uppercase tracking-[0.16em] text-white/45 transition group-hover:text-white/70">
          {label}
        </p>
      </div>

      {typeof value === "string" ? (
        <p className="shrink-0 text-right text-[13px] font-extrabold text-white/85">
          {value}
        </p>
      ) : (
        value
      )}
    </div>
  );
}

function MiniTrustItem({ icon, title, text }) {
  return (
    <div className="group relative overflow-hidden rounded-[1.35rem] border border-white/[0.08] bg-white/[0.035] p-4 shadow-[0_18px_45px_rgba(0,0,0,0.22)] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-red-500/25 hover:bg-red-500/[0.045]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,0.08),transparent_36%)] opacity-70" />

      <div className="relative flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-red-500/15 bg-red-500/10 text-red-300 transition duration-300 group-hover:border-red-400/30 group-hover:bg-red-500/15 group-hover:text-red-200">
          {icon}
        </div>

        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-white/85">
            {title}
          </p>

          <p className="mt-1 text-[12px] leading-relaxed text-white/42">
            {text}
          </p>
        </div>
      </div>
    </div>
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
      className="relative overflow-hidden rounded-[1.7rem] border border-rose-400/15 bg-[linear-gradient(135deg,rgba(190,18,60,0.08),rgba(255,255,255,0.025))] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.32)] backdrop-blur-xl"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(244,63,94,0.16),transparent_42%)]" />

      <div className="relative mb-5 flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-500/10 text-rose-200">
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </div>

        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-300">
            Back In Stock Alert
          </p>

          <h3 className="mt-1 text-xl font-black tracking-[-0.04em] text-white">
            Notify me when available
          </h3>

          <p className="mt-1.5 max-w-xl text-[12px] leading-relaxed text-white/45">
            Leave your details and we&apos;ll send you a clean notification as
            soon as this product is available again.
          </p>
        </div>
      </div>

      <div className="relative space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.16em] text-white/35">
              Name
            </label>

            <input
              type="text"
              value={notifyName}
              onChange={(event) => setNotifyName(event.target.value)}
              placeholder="Your name"
              className="h-[52px] w-full rounded-2xl border border-white/[0.08] bg-black/30 px-4 text-[13px] font-bold text-white outline-none transition placeholder:text-white/25 focus:border-rose-300/40 focus:bg-black/45"
            />
          </div>

          <div>
            <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.16em] text-white/35">
              Email
            </label>

            <input
              type="email"
              value={notifyEmail}
              onChange={(event) => setNotifyEmail(event.target.value)}
              placeholder="you@email.com"
              className="h-[52px] w-full rounded-2xl border border-white/[0.08] bg-black/30 px-4 text-[13px] font-bold text-white outline-none transition placeholder:text-white/25 focus:border-rose-300/40 focus:bg-black/45"
              required
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={notifyStatus === "loading"}
          className="group relative flex h-[52px] w-full items-center justify-center overflow-hidden rounded-2xl bg-rose-600 px-6 text-[11px] font-black uppercase tracking-[0.16em] text-white shadow-[0_18px_45px_rgba(190,18,60,0.24)] transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="absolute inset-0 translate-x-[-120%] skew-x-[-18deg] bg-gradient-to-r from-transparent via-white/20 to-transparent transition duration-700 group-hover:translate-x-[120%]" />

          <span className="relative z-10">
            {notifyStatus === "loading" ? "Saving..." : "Notify Me"}
          </span>
        </button>
      </div>

      {notifyMessage && (
        <div
          className={`relative mt-4 flex items-start gap-3 rounded-2xl border p-4 text-[12px] font-bold leading-relaxed ${
            isSuccess
              ? "border-rose-300/20 bg-rose-500/[0.08] text-rose-50"
              : "border-red-400/20 bg-red-500/10 text-red-100"
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

function getProductUrl(product) {
  const cleanSlug = product?.slug
    ? String(product.slug).replace(/^\/+|\/+$/g, "")
    : "";

  if (cleanSlug) {
    return `/product/${cleanSlug}`;
  }

  return `/product/${product?.id || ""}`;
}

function stripProductHtml(html = "") {
  return String(html).replace(/<[^>]*>?/gm, "").trim();
}

function getComplementDescription(product) {
  const cleanDescription = stripProductHtml(product?.short_description || "");

  if (!cleanDescription) {
    return "Research-use-only product for laboratory use.";
  }

  if (cleanDescription.length > 82) {
    return `${cleanDescription.slice(0, 82)}...`;
  }

  return cleanDescription;
}

function getComplementPrice(product) {
  const currency = product?.currency || product?.currency_code || "USD";
  const price = product?.price ?? product?.sale_price ?? product?.regular_price;

  const formattedPrice = formatMoney(price, currency);

  if (product?.type === "variable") {
    return formattedPrice ? `From ${formattedPrice}` : "View Options";
  }

  return formattedPrice || "View";
}

function ComplementProductCard({ product }) {
  const image = getProductImage(product);
  const stockBadge = getStockBadge(product);
  const productUrl = getProductUrl(product);
  const description = getComplementDescription(product);
  const price = getComplementPrice(product);
  const isSoldOut = product?.stock_status !== "instock";

  return (
    <article className="group relative overflow-hidden rounded-[1.7rem] border border-white/[0.08] bg-[#080808] shadow-[0_24px_70px_rgba(0,0,0,0.35)] transition duration-300 hover:-translate-y-1 hover:border-red-500/35 hover:shadow-[0_34px_95px_rgba(0,0,0,0.48)]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgba(255,255,255,0.055),transparent_35%,rgba(220,38,38,0.045))]" />

      <a
        href={productUrl}
        className="relative flex h-52 items-center justify-center overflow-hidden bg-[#101010] p-4"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(220,38,38,0.14),transparent_58%)] opacity-80 transition duration-300 group-hover:opacity-100" />
        <div className="absolute inset-x-8 bottom-5 h-20 rounded-full bg-black/70 blur-3xl" />

        <img
          src={image}
          alt={product.name}
          loading="lazy"
          className={`relative h-full w-full object-contain drop-shadow-[0_22px_45px_rgba(0,0,0,0.55)] transition duration-500 group-hover:scale-[1.08] ${
            isSoldOut ? "opacity-55 grayscale-[0.25]" : "opacity-100"
          }`}
        />

        <div className="absolute left-3 top-3 flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] backdrop-blur ${stockBadge.className}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${stockBadge.dot}`} />
            {stockBadge.label}
          </span>
        </div>
      </a>

      <div className="relative p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-red-300/80">
            Add-On
          </p>

          {isSoldOut && (
            <p className="rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-red-200/80">
              Waitlist
            </p>
          )}
        </div>

        <h3 className="line-clamp-2 min-h-[44px] text-lg font-black leading-tight tracking-[-0.035em] text-white">
          {product.name}
        </h3>

        <p className="mt-2 line-clamp-2 min-h-[40px] text-xs leading-5 text-white/48">
          {description}
        </p>

        <div className="mt-5 flex items-end justify-between gap-4 border-t border-white/[0.08] pt-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-white/30">
              Price
            </p>

            <p className="mt-1 text-2xl font-black tracking-[-0.05em] text-white">
              {price}
            </p>
          </div>

          <a
            href={productUrl}
            className={`inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-5 text-[10px] font-black uppercase tracking-[0.12em] transition active:scale-[0.98] ${
              isSoldOut
                ? "border border-red-400/20 bg-red-500/10 text-red-100 hover:bg-red-600 hover:text-white"
                : "bg-red-600 text-white shadow-[0_18px_45px_rgba(220,38,38,0.22)] hover:bg-red-500"
            }`}
          >
            {isSoldOut ? "Notify" : "View"}
            <IconArrow />
          </a>
        </div>
      </div>
    </article>
  );
}

function ProductComplements({ currentProductId }) {
  const [products, setProducts] = useState([]);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let isMounted = true;

    async function loadComplements() {
      try {
        setStatus("loading");

        const response = await fetch("/api/products");
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
              .slice(0, 8)
          : [];

        if (!isMounted) return;

        setProducts(featuredProducts);
        setStatus("success");
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
  }, [currentProductId]);

  if (status === "success" && products.length === 0) {
    return null;
  }

  return (
    <section className="mt-24 border-t border-white/[0.08] pt-14">
      <div className="mx-auto mb-10 max-w-3xl text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-red-300">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400 shadow-[0_0_14px_rgba(248,113,113,0.85)]" />
          Add-Ons
        </div>

        <h2 className="text-4xl font-black leading-[0.92] tracking-[-0.06em] text-white sm:text-5xl lg:text-6xl">
          Recommended
          <span className="block text-white/38">Add-Ons.</span>
        </h2>

        <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-white/52 sm:text-base">
          Featured WooCommerce products that may complement this selection.
          Sold out products stay visible so customers can review details or
          join the notification list.
        </p>
      </div>

      {status === "loading" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="overflow-hidden rounded-[1.7rem] border border-white/10 bg-white/[0.035]"
            >
              <div className="h-52 animate-pulse bg-white/[0.04]" />

              <div className="space-y-3 p-4">
                <div className="h-5 w-2/3 animate-pulse rounded bg-white/10" />
                <div className="h-4 w-full animate-pulse rounded bg-white/[0.06]" />
                <div className="h-4 w-4/5 animate-pulse rounded bg-white/[0.06]" />
                <div className="h-12 w-full animate-pulse rounded-xl bg-white/10" />
              </div>
            </div>
          ))}
        </div>
      )}

      {status === "error" && (
        <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-6 text-center">
          <p className="text-sm font-black text-white">
            Add-Ons are not available right now.
          </p>
        </div>
      )}

      {status === "success" && products.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {products.map((item) => (
              <ComplementProductCard key={item.id} product={item} />
            ))}
          </div>

          <div className="mt-9 flex justify-center">
            <a
              href="/shop"
              className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.04] px-8 text-xs font-black uppercase tracking-[0.12em] text-white/70 transition hover:border-red-500/35 hover:bg-red-600 hover:text-white"
            >
              View Catalog
            </a>
          </div>
        </>
      )}
    </section>
  );
}

export default function ProductDetails({ slug }) {
  const { addItem, openCart } = useCart();

  const [product, setProduct] = useState(null);
  const [status, setStatus] = useState("loading");
  const [quantity, setQuantity] = useState(1);
  const [selectedVariants, setSelectedVariants] = useState({});
  const [justAdded, setJustAdded] = useState(false);

  const [notifyName, setNotifyName] = useState("");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [notifyStatus, setNotifyStatus] = useState("idle");
  const [notifyMessage, setNotifyMessage] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadProduct() {
      try {
        setStatus("loading");
        setQuantity(1);
        setSelectedVariants({});
        setNotifyName("");
        setNotifyEmail("");
        setNotifyStatus("idle");
        setNotifyMessage("");

        const cleanSlug = String(slug || "").trim();

        if (!cleanSlug) {
          throw new Error("Missing product slug.");
        }

        const response = await fetch(
          `/api/products?slug=${encodeURIComponent(cleanSlug)}&refresh=1&_=${Date.now()}`,
          {
            cache: "no-store",
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
      } catch (error) {
        console.error(error);

        if (isMounted) {
          setStatus("error");
        }
      }
    }

    loadProduct();

    return () => {
      isMounted = false;
    };
  }, [slug]);

  const selectedVariation = useMemo(() => {
    return getSelectedVariation(product, selectedVariants);
  }, [product, selectedVariants]);

  const displayProduct = useMemo(() => {
    return selectedVariation
      ? mergeProductWithVariation(product, selectedVariation)
      : product;
  }, [product, selectedVariation]);

  const image = displayProduct ? getProductImage(displayProduct) : FALLBACK_IMAGE;
  const stockBadge = displayProduct ? getStockBadge(displayProduct) : null;

  const category = product?.categories?.[0]?.name || "Research Compound";
  const hasVariants = product?.attributes && product.attributes.length > 0;
  const hasVariationData = getVariationList(product).length > 0;

  const selectedConfigLabel =
    Object.entries(selectedVariants || {})
      .map(([, value]) => value)
      .filter(Boolean)
      .join(" · ") || "Base configuration";

  const isInstock =
    displayProduct?.stock_status === "instock" ||
    displayProduct?.backorders_allowed === true;

  const canAddToCart =
    isInstock && (!hasVariants || !hasVariationData || Boolean(selectedVariation));

  const coaFile = product ? findCOA(product) : null;

  const sku = displayProduct?.sku ? displayProduct.sku : "N/A";
  const productType = selectedVariation
    ? "Selected Variation"
    : product?.type || "Simple Compound";

  const maxQuantity = useMemo(() => {
    const stock = Number(displayProduct?.stock_quantity);

    if (!Number.isNaN(stock) && stock > 0) {
      return stock;
    }

    return 99;
  }, [displayProduct]);

  const stockQuantity =
    displayProduct?.stock_quantity !== null &&
    displayProduct?.stock_quantity !== undefined
      ? `${displayProduct.stock_quantity} Units`
      : displayProduct?.stock_status === "instock" ||
          displayProduct?.backorders_allowed === true
        ? "Available"
        : "Sold Out";

  const handleVariantChange = (attributeName, value) => {
    setSelectedVariants((prev) => ({
      ...prev,
      [attributeName]: value,
    }));

    setQuantity(1);
    setJustAdded(false);
  };

  const handleAddToCart = () => {
    if (!product || !displayProduct || !canAddToCart) return;

    const itemToAdd = {
      ...displayProduct,
      parent_id: product.id,
      product_id: product.id,
      variation_id: selectedVariation?.id || 0,
      variationId: selectedVariation?.id || 0,
      selectedOptions: selectedVariants,
      cartKey: selectedVariation
        ? `${product.id}:${selectedVariation.id}`
        : String(product.id),
    };

    addItem(itemToAdd, quantity);
    openCart?.();

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
    setQuantity((q) => Math.max(1, q - 1));
  };

  const increaseQuantity = () => {
    setQuantity((q) => Math.min(maxQuantity, q + 1));
  };

  if (status === "loading") {
    return (
      <section className="relative min-h-screen overflow-hidden bg-[#030303] px-6 pb-20 pt-[150px] text-white sm:px-8 sm:pt-[170px] md:px-10 lg:px-14 xl:px-20">
        <div className="mx-auto grid max-w-[1280px] gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:gap-12">
          <div className="h-[430px] animate-pulse rounded-[2.3rem] border border-white/[0.06] bg-white/[0.035] lg:h-[620px]" />

          <div className="flex flex-col justify-center">
            <div className="mb-5 h-4 w-44 animate-pulse rounded-full bg-white/[0.06]" />
            <div className="mb-5 h-16 w-full animate-pulse rounded-2xl bg-white/[0.06]" />
            <div className="mb-8 h-12 w-64 animate-pulse rounded-2xl bg-white/[0.06]" />

            <div className="space-y-3">
              <div className="h-3 w-full animate-pulse rounded bg-white/[0.06]" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-white/[0.06]" />
              <div className="h-3 w-4/6 animate-pulse rounded bg-white/[0.06]" />
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (status === "error" || !product) {
    return (
      <section className="relative flex min-h-[70vh] flex-col items-center justify-center overflow-hidden bg-[#030303] px-4 pt-[150px] text-center text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(220,38,38,0.08),transparent_45%)]" />

        <div className="relative max-w-md rounded-[2rem] border border-white/[0.08] bg-[#090909]/90 p-10 shadow-[0_30px_100px_rgba(0,0,0,0.55)] backdrop-blur-xl">
          <p className="mb-3 text-[10px] font-black uppercase tracking-[0.25em] text-red-400">
            Product Error
          </p>

          <h2 className="text-3xl font-black tracking-[-0.04em] text-white">
            Product Unavailable
          </h2>

          <p className="mt-3 text-sm leading-relaxed text-white/45">
            This product could not be loaded right now.
          </p>

          <a
            href="/shop"
            className="mt-7 inline-flex h-12 items-center justify-center rounded-full bg-red-600 px-8 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-red-500"
          >
            Return to Catalog
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="relative overflow-hidden bg-[#030303] pb-24 pt-[138px] text-white sm:pt-[158px] lg:pt-[170px]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute right-[-16%] top-[-18%] h-[620px] w-[620px] rounded-full bg-red-600/10 blur-[135px]" />
        <div className="absolute left-[-18%] top-[18%] h-[620px] w-[620px] rounded-full bg-red-950/24 blur-[145px]" />
        <div className="absolute bottom-[-18%] right-[18%] h-[500px] w-[500px] rounded-full bg-white/[0.035] blur-[130px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.035),transparent_22%,transparent_70%,rgba(220,38,38,0.035))]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.022)_1px,transparent_1px)] bg-[size:72px_72px] opacity-[0.12]" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-[1320px] px-6 sm:px-8 md:px-10 lg:px-14 xl:px-20 2xl:px-24">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
            <a href="/shop" className="transition hover:text-white">
              Shop
            </a>

            <span className="h-1 w-1 rounded-full bg-red-500/70" />

            <span className="text-red-400">Product Details</span>
          </div>

          <div className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/35 backdrop-blur-xl sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400 shadow-[0_0_16px_rgba(248,113,113,0.9)]" />
            Live Variant Console
          </div>
        </div>

        <div className="grid gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-12 xl:gap-16">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <div className="relative overflow-hidden rounded-[2.4rem] border border-white/[0.08] bg-[#070707] shadow-[0_45px_130px_rgba(0,0,0,0.72)]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_34%,rgba(220,38,38,0.22),transparent_38%),linear-gradient(145deg,rgba(255,255,255,0.09),transparent_28%,rgba(255,255,255,0.025)_70%,rgba(220,38,38,0.08))]" />
              <div className="pointer-events-none absolute left-1/2 top-[50%] h-[360px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.045]" />
              <div className="pointer-events-none absolute left-1/2 top-[50%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.025]" />

              <div className="relative flex min-h-[520px] flex-col justify-between p-5 sm:min-h-[640px] sm:p-7 lg:min-h-[720px]">
                <div className="z-20 flex items-start justify-between gap-4">
                  {stockBadge && (
                    <span
                      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[10px] font-black uppercase tracking-[0.14em] backdrop-blur-xl ${stockBadge.className}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full shadow-[0_0_12px_currentColor] ${stockBadge.dot}`}
                      />
                      {stockBadge.label}
                    </span>
                  )}

                  <span className="rounded-full border border-white/[0.08] bg-black/35 px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/45 backdrop-blur-xl">
                    {category}
                  </span>
                </div>

                <div className="relative z-10 flex flex-1 items-center justify-center py-10">
                  <div className="pointer-events-none absolute bottom-[18%] left-1/2 h-28 w-[68%] -translate-x-1/2 rounded-full bg-black/80 blur-[42px]" />

                  <img
                    key={image}
                    src={image}
                    alt={product.name}
                    className="relative w-full max-w-[390px] object-contain drop-shadow-[0_34px_70px_rgba(0,0,0,0.7)] transition duration-700 hover:scale-[1.035] sm:max-w-[470px]"
                  />
                </div>

                <div className="relative z-20 grid gap-3 rounded-[1.8rem] border border-white/[0.08] bg-black/35 p-4 backdrop-blur-xl sm:grid-cols-3">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/28">
                      Selected
                    </p>
                    <p className="mt-1 truncate text-[12px] font-black text-white/80">
                      {selectedConfigLabel}
                    </p>
                  </div>

                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/28">
                      SKU
                    </p>
                    <p className="mt-1 truncate text-[12px] font-black text-white/80">
                      {sku}
                    </p>
                  </div>

                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/28">
                      Status
                    </p>
                    <p className="mt-1 truncate text-[12px] font-black text-white/80">
                      {stockQuantity}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-start lg:pt-3">
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-3.5 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-red-300">
                <span className="h-1.5 w-1.5 rounded-full bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.8)]" />
                RGV Prime
                <span className="text-white/30">/</span>
                <span className="text-white/50">{category}</span>
              </div>

              <h1 className="max-w-3xl bg-gradient-to-br from-white via-white to-white/42 bg-clip-text pb-1 pr-2 text-[2.45rem] font-black leading-[1.06] tracking-[-0.045em] text-transparent sm:text-[3.15rem] lg:text-[3.45rem] xl:text-[3.85rem]">
                {product.name}
              </h1>

              <div className="mt-7 overflow-hidden rounded-[2rem] border border-white/[0.08] bg-[linear-gradient(135deg,rgba(255,255,255,0.055),rgba(255,255,255,0.022))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:p-6">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-300">
                      Selected Configuration
                    </p>
                    <p className="mt-1 text-[12px] font-bold text-white/38">
                      Price updates with the selected variant.
                    </p>
                  </div>

                  <div className="rounded-full border border-white/[0.08] bg-black/30 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-white/45">
                    {selectedConfigLabel}
                  </div>
                </div>

                {renderProductPrice(displayProduct)}
              </div>

              {product.short_description && (
                <div
                  className="mt-6 max-w-2xl text-[15px] leading-relaxed text-white/52 [&>p]:mb-0 [&_a]:text-red-300 [&_strong]:text-white/80"
                  dangerouslySetInnerHTML={{
                    __html: product.short_description,
                  }}
                />
              )}

              {coaFile && (
                <a
                  href={coaFile.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group mt-5 flex max-w-2xl items-center justify-between gap-4 rounded-2xl border border-rose-400/15 bg-rose-500/[0.045] p-4 shadow-[0_18px_45px_rgba(0,0,0,0.22)] backdrop-blur-xl transition duration-300 hover:border-rose-300/35 hover:bg-rose-500/[0.075]"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-500/10 text-rose-200">
                      <IconShield />
                    </div>

                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white/85">
                        Certificate of Analysis
                      </p>

                      <p className="mt-1 text-[12px] font-bold text-rose-200/75">
                        Active lot file · LOT: {coaFile.lot}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-rose-200/75 transition group-hover:text-white">
                    View COA
                    <IconArrow />
                  </div>
                </a>
              )}

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                <MiniTrustItem
                  title="Lab File"
                  text={coaFile ? "COA available" : "Upon availability"}
                  icon={<IconShield />}
                />

                <MiniTrustItem
                  title="Secure"
                  text="Protected checkout"
                  icon={
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  }
                />

                <MiniTrustItem
                  title="Shipping"
                  text="Discreet handling"
                  icon={
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 7h11v10H3z" />
                      <path d="M14 10h4l3 3v4h-7z" />
                      <circle cx="7" cy="19" r="2" />
                      <circle cx="17" cy="19" r="2" />
                    </svg>
                  }
                />
              </div>
            </div>

            <div className="mt-8 overflow-hidden rounded-[2.2rem] border border-white/[0.08] bg-[#080808]/85 p-5 shadow-[0_28px_95px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-6">
              <div className="pointer-events-none absolute inset-0" />

              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-red-400">
                    Order Console
                  </p>

                  <h2 className="mt-1 text-2xl font-black tracking-[-0.045em] text-white">
                    Configure Selection
                  </h2>
                </div>

                <div className="hidden rounded-full border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-white/45 sm:block">
                  SKU: {sku}
                </div>
              </div>

              {hasVariants && (
                <div className="mb-6 space-y-5">
                  {product.attributes.map((attribute) => (
                    <div key={attribute.name} className="space-y-3">
                      <label className="flex items-center justify-between gap-4 text-[10px] font-black uppercase tracking-[0.18em] text-white/45">
                        <span>{attribute.name}</span>
                        <span className="text-red-300/70">Live Pricing</span>
                      </label>

                      <div className="grid gap-2 sm:grid-cols-2">
                        {sortVariantOptions(attribute.options).map((option) => {
                          const isSelected =
                            selectedVariants[attribute.name] === option;

                          return (
                            <button
                              key={option}
                              type="button"
                              onClick={() =>
                                handleVariantChange(attribute.name, option)
                              }
                              className={`group relative min-h-14 overflow-hidden rounded-2xl border px-4 py-3 text-left transition duration-300 active:scale-[0.98] ${
                                isSelected
                                  ? "border-red-400/55 bg-red-500/[0.13] text-white shadow-[0_0_34px_rgba(220,38,38,0.14)]"
                                  : "border-white/[0.07] bg-white/[0.025] text-white/48 hover:border-white/15 hover:bg-white/[0.045] hover:text-white"
                              }`}
                            >
                              <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,0.08),transparent_42%)] opacity-0 transition group-hover:opacity-100" />

                              <span className="relative flex items-center justify-between gap-4">
                                <span>
                                  <span className="block text-[13px] font-black">
                                    {option}
                                  </span>
                                  <span className="mt-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-white/28">
                                    Variant Option
                                  </span>
                                </span>

                                <span
                                  className={`flex h-6 w-6 items-center justify-center rounded-full border transition ${
                                    isSelected
                                      ? "border-red-300 bg-red-500 text-white"
                                      : "border-white/10 text-transparent group-hover:border-white/30"
                                  }`}
                                >
                                  <svg
                                    viewBox="0 0 24 24"
                                    className="h-3.5 w-3.5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {hasVariants && hasVariationData && !selectedVariation && (
                <div className="mb-5 rounded-2xl border border-yellow-400/20 bg-yellow-400/10 p-4 text-[12px] font-bold leading-relaxed text-yellow-100">
                  Please select a valid combination to see the correct price,
                  image, stock, and SKU.
                </div>
              )}

              {isInstock ? (
                <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
                  <div className="flex h-14 items-center justify-between rounded-2xl border border-white/[0.08] bg-white/[0.035] px-2">
                    <button
                      type="button"
                      onClick={decreaseQuantity}
                      className="flex h-10 w-10 items-center justify-center rounded-xl text-xl font-light text-white/45 transition hover:bg-white/10 hover:text-white active:scale-95"
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>

                    <span className="text-lg font-black text-white">
                      {quantity}
                    </span>

                    <button
                      type="button"
                      onClick={increaseQuantity}
                      className="flex h-10 w-10 items-center justify-center rounded-xl text-xl font-light text-white/45 transition hover:bg-white/10 hover:text-white active:scale-95"
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleAddToCart}
                    disabled={!canAddToCart}
                    className={`group relative flex h-14 items-center justify-center overflow-hidden rounded-2xl px-8 text-white shadow-[0_18px_45px_rgba(220,38,38,0.28)] transition active:scale-[0.985] ${
                      canAddToCart
                        ? "bg-red-600 hover:bg-red-500"
                        : "cursor-not-allowed bg-white/10 text-white/40 shadow-none"
                    }`}
                  >
                    <span className="absolute inset-0 translate-x-[-120%] skew-x-[-18deg] bg-gradient-to-r from-transparent via-white/25 to-transparent transition duration-700 group-hover:translate-x-[120%]" />

                    <span className="relative z-10 flex items-center gap-3 text-[12px] font-black uppercase tracking-[0.18em]">
                      {hasVariants && hasVariationData && !selectedVariation
                        ? "Select Options"
                        : justAdded
                          ? "Added to Cart"
                          : "Add to Cart"}

                      <IconBag />
                    </span>
                  </button>
                </div>
              ) : (
                <BackInStockForm
                  notifyName={notifyName}
                  setNotifyName={setNotifyName}
                  notifyEmail={notifyEmail}
                  setNotifyEmail={setNotifyEmail}
                  notifyStatus={notifyStatus}
                  notifyMessage={notifyMessage}
                  onSubmit={handleBackInStockSubmit}
                />
              )}

              <div className="mt-6 rounded-2xl border border-red-500/15 bg-[linear-gradient(135deg,rgba(220,38,38,0.08),rgba(255,255,255,0.025))] p-4 shadow-[0_18px_45px_rgba(0,0,0,0.25)]">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10 text-red-300">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  </div>

                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-red-200">
                      Final Sale Notice
                    </p>

                    <p className="mt-1.5 text-[12px] leading-relaxed text-white/45">
                      Please review your selected options, quantity, and
                      shipping details before placing the order.
                      <strong className="text-white/75">
                        {" "}
                        All sales are final
                      </strong>{" "}
                      once checkout is completed. Returns, refunds, or exchanges
                      are not accepted after confirmation.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-20 grid gap-12 lg:grid-cols-[1fr_380px] lg:gap-16">
          <div className="relative">
            <div className="mb-8">
              <p className="mb-3 text-[10px] font-black uppercase tracking-[0.24em] text-red-400">
                Compound Profile
              </p>

              <h2 className="max-w-3xl text-4xl font-black tracking-[-0.055em] text-white sm:text-5xl lg:text-6xl">
                Detailed Analysis
              </h2>
            </div>

            <div
              className="max-w-4xl space-y-5 text-[15px] leading-relaxed text-white/55 sm:text-[16px] [&>h1]:text-white [&>h2]:text-white [&>h3]:text-white [&>p]:mb-0 [&>strong]:text-white/80 [&>ul]:list-none [&>ul]:space-y-3 [&>ul>li]:relative [&>ul>li]:pl-6 [&>ul>li]:before:absolute [&>ul>li]:before:left-0 [&>ul>li]:before:top-[10px] [&>ul>li]:before:h-1.5 [&>ul>li]:before:w-1.5 [&>ul>li]:before:rounded-full [&>ul>li]:before:bg-red-500"
              dangerouslySetInnerHTML={{
                __html:
                  product.description ||
                  product.short_description ||
                  "Detailed specifications are currently being updated.",
              }}
            />

            <div className="mt-10 max-w-4xl border-t border-white/[0.08] pt-7">
              <div className="flex items-start gap-3">
                <svg
                  viewBox="0 0 24 24"
                  className="mt-0.5 h-5 w-5 shrink-0 text-red-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>

                <p className="text-[12px] leading-relaxed text-white/32">
                  <strong className="text-white/55">Disclaimer:</strong>{" "}
                  Research compounds shown are strictly for laboratory research
                  use only. They are not intended for human consumption,
                  veterinary use, diagnosis, treatment, cure, or prevention of
                  any disease. Purchase signifies agreement to limit usage to
                  recognized laboratory and research procedures.
                </p>
              </div>
            </div>
          </div>

          <aside className="lg:sticky lg:top-28 lg:self-start">
            <div className="mb-7">
              <p className="mb-3 text-[10px] font-black uppercase tracking-[0.24em] text-white/30">
                Specs
              </p>

              <h3 className="text-3xl font-black tracking-[-0.05em] text-white">
                Technical Profile
              </h3>
            </div>

            <div className="overflow-hidden rounded-[2rem] border border-white/[0.08] bg-white/[0.025] px-5 py-3 shadow-[0_24px_70px_rgba(0,0,0,0.32)] backdrop-blur-xl">
              <TechnicalRow
                icon={
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                }
                label="Compound SKU"
                value={sku}
              />

              <TechnicalRow
                icon={
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M12 2v20M2 12h20" />
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                }
                label="Molecular Type"
                value={productType}
              />

              {displayProduct?.weight && (
                <TechnicalRow
                  icon={
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <rect x="3" y="6" width="18" height="12" rx="2" />
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 10h18M11 14h2" />
                    </svg>
                  }
                  label="Compound Weight"
                  value={`${displayProduct.weight} kg`}
                />
              )}

              <TechnicalRow
                icon={
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
                  </svg>
                }
                label="In-Stock Units"
                value={stockQuantity}
              />

              <TechnicalRow
                icon={<IconShield />}
                label="COA Status"
                value={coaFile ? "Available" : "Upon Availability"}
              />
            </div>
          </aside>
        </div>

        <ProductComplements currentProductId={product.id} />
      </div>
    </section>
  );
}