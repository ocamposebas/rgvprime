import { useEffect, useMemo, useRef, useState } from "react";
import { useCart } from "../cart/CartContext";

const FALLBACK_IMAGE = "/logo.webp";
const PRODUCTS_PER_PAGE = 12;

const statusFilters = [
  { label: "All", value: "all" },
  { label: "Available", value: "available" },
  { label: "Low Stock", value: "low" },
  { label: "Sold Out", value: "sold-out" },
];

const sortOptions = [
  { label: "Default Order", value: "featured" },
  { label: "Price Low", value: "price-low" },
  { label: "Price High", value: "price-high" },
  { label: "Name A-Z", value: "name" },
  { label: "Stock", value: "stock" },
];

const customProductOrder = [
  {
    label: "R3ta",
    terms: ["r3ta", "reta", "retatrutide", "retarutide"],
  },
  {
    label: "Tirz",
    terms: ["tirz", "tirzepatide", "tirzep", "tirza", "tz"],
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
    label: "Fat Blaster",
    terms: ["fat blaster", "fatblaster"],
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
    [
      product?.name,
      product?.slug,
      product?.sku,
      product?.short_description,
      product?.description,
      ...(product?.categories || []).map((item) => item?.name),
      ...(product?.categories || []).map((item) => item?.slug),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function matchesOrderTerm(text, compactText, term) {
  const cleanTerm = normalizeOrderText(term);
  const compactTerm = cleanTerm.replace(/\s+/g, "");

  if (!cleanTerm) return false;
  if (text.includes(cleanTerm)) return true;
  if (compactTerm.length >= 4 && compactText.includes(compactTerm)) return true;

  return false;
}

function getProductOrderAliases(item) {
  return [item?.label, ...(item?.terms || [])].filter(Boolean);
}

function normalizeSearchAliasText(value = "") {
  return normalizeOrderText(value).replace(/3/g, "e");
}

function getSearchVariants(value = "") {
  const normalized = normalizeOrderText(value);
  const aliasNormalized = normalizeSearchAliasText(value);
  const variants = [normalized, aliasNormalized]
    .flatMap((item) => [item, item.replace(/\s+/g, "")])
    .filter((item) => item.length >= 2);

  return [...new Set(variants)];
}

function getCustomProductRank(product) {
  const text = getProductOrderText(product);
  const compactText = text.replace(/\s+/g, "");

  const index = customProductOrder.findIndex((item) =>
    getProductOrderAliases(item).some((term) =>
      matchesOrderTerm(text, compactText, term)
    )
  );

  return index === -1 ? customProductOrder.length : index;
}

function getProductSearchText(product) {
  const productText = getProductOrderText(product);
  const productRank = getCustomProductRank(product);
  const aliasText =
    productRank >= 0 && productRank < customProductOrder.length
      ? getProductOrderAliases(customProductOrder[productRank]).join(" ")
      : "";

  return normalizeOrderText(
    [
      productText,
      aliasText,
      normalizeSearchAliasText(productText),
      normalizeSearchAliasText(aliasText),
    ]
      .filter(Boolean)
      .join(" ")
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

function stripHtml(html = "") {
  return html.replace(/<[^>]*>?/gm, "").trim();
}

function formatPrice(price) {
  if (!price) return null;

  const number = Number(price);

  if (Number.isNaN(number)) {
    return `$${price}`;
  }

  return `$${number.toFixed(2).replace(".00", "")}`;
}

function getPriceLabel(product) {
  const formattedPrice = formatPrice(product.price);

  if (product.type === "variable") {
    return formattedPrice ? `From ${formattedPrice}` : "View";
  }

  return formattedPrice || "View";
}

function getDescription(product) {
  const cleanDescription = stripHtml(product.short_description);

  if (!cleanDescription) {
    return "Research-use-only laboratory product.";
  }

  if (cleanDescription.length > 78) {
    return `${cleanDescription.slice(0, 78)}...`;
  }

  return cleanDescription;
}

function getMainCategory(product) {
  const category = product.categories?.find(
    (item) => item.slug && item.slug !== "uncategorized"
  );

  return category?.name || "Research Product";
}

function getStockBadge(product) {
  const quantity =
    product.stock_quantity !== null &&
    product.stock_quantity !== undefined &&
    product.stock_quantity !== ""
      ? Number(product.stock_quantity)
      : null;

  if (product.stock_status !== "instock") {
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
      `variation-${index}`
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

function getProductVariations(product) {
  const rawVariations =
    product?.variations ||
    product?.variation_options ||
    product?.variationOptions ||
    product?.variants ||
    [];

  if (!Array.isArray(rawVariations)) return [];

  return rawVariations.filter(
    (variation) => variation && typeof variation === "object"
  );
}

function getVariationsFromApiPayload(payload) {
  const productPayload =
    payload?.product || payload?.data?.product || payload?.item || payload;

  const variations =
    getProductVariations(productPayload) ||
    payload?.variations ||
    payload?.data?.variations ||
    [];

  return Array.isArray(variations) ? variations : [];
}

function getVariationLabel(product, variation, index = 0) {
  const options = getAttributeOptions(variation?.attributes);
  const possibleLabels = [
    variation?.label,
    variation?.option,
    variation?.title,
    variation?.name,
    ...options,
  ];

  const mgLabel = possibleLabels.find((value) =>
    /\b\d+(?:\.\d+)?\s*(mg|mcg|g|iu)\b/i.test(String(value || ""))
  );

  if (mgLabel) return cleanVariationText(mgLabel);

  if (options.length) return options.join(" / ");

  const cleanedName = cleanVariationText(
    String(variation?.name || "").replace(product?.name || "", "")
  );

  return cleanedName || `Option ${index + 1}`;
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

function getVariationStockLabel(variation) {
  const quantity =
    variation?.stock_quantity !== null &&
    variation?.stock_quantity !== undefined &&
    variation?.stock_quantity !== ""
      ? Number(variation.stock_quantity)
      : null;

  if (variation?.stock_status && variation.stock_status !== "instock") {
    return "Sold Out";
  }

  if (quantity === null || Number.isNaN(quantity)) return "Available";
  if (quantity > 0) return `${quantity} left`;

  return "Sold Out";
}

function isVariationAvailable(variation) {
  if (!variation) return false;
  if (variation.purchasable === false) return false;
  if (variation.stock_status && variation.stock_status !== "instock") {
    return false;
  }

  return true;
}

function getPaginationItems(currentPage, totalPages) {
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

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
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

function SortDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  const activeOption =
    sortOptions.find((item) => item.value === value) || sortOptions[0];

  useEffect(() => {
    function handleClickOutside(event) {
      if (!wrapperRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", handleClickOutside);

    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`flex h-12 w-full items-center justify-between gap-3 rounded-2xl border px-4 text-xs font-black uppercase tracking-[0.12em] transition ${
          open
            ? "border-red-500/55 bg-[#111] text-white"
            : "border-white/10 bg-black/45 text-white/75 hover:border-red-500/35 hover:text-white"
        }`}
      >
        <span>{activeOption.label}</span>
        <span
          className={`text-white/45 transition duration-300 ${
            open ? "rotate-180 text-red-400" : ""
          }`}
        >
          <ChevronIcon />
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-full min-w-[190px] overflow-hidden rounded-2xl border border-white/10 bg-[#070707] p-1 shadow-[0_22px_70px_rgba(0,0,0,0.65)]">
          {sortOptions.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                onChange(item.value);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-xs font-black uppercase tracking-[0.1em] transition ${
                value === item.value
                  ? "bg-red-600 text-white"
                  : "text-white/55 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductImage({ src, alt, priority = false }) {
  const [imageSrc, setImageSrc] = useState(src || FALLBACK_IMAGE);

  useEffect(() => {
    setImageSrc(src || FALLBACK_IMAGE);
  }, [src]);

  return (
    <img
      src={imageSrc}
      alt={alt || "Product image"}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
      width="600"
      height="600"
      onError={() => {
        if (imageSrc !== FALLBACK_IMAGE) {
          setImageSrc(FALLBACK_IMAGE);
        }
      }}
      className="relative h-full w-full scale-[1.12] object-contain opacity-100 transition duration-500 group-hover:scale-[1.18]"
    />
  );
}

function ProductCard({ product, priority = false }) {
  const { addItem } = useCart();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [variationStatus, setVariationStatus] = useState(() =>
    getProductVariations(product).length ? "success" : "idle"
  );
  const [variations, setVariations] = useState(() =>
    getProductVariations(product)
  );
  const [selectedVariationKey, setSelectedVariationKey] = useState(() => {
    const firstVariation = getProductVariations(product).find(
      isVariationAvailable
    );
    return firstVariation ? getVariationKey(firstVariation, 0) : "";
  });

  const image = getImageUrl(product.image) || FALLBACK_IMAGE;
  const imageAlt = product.image_alt || product.name || "Product image";
  const productUrl = `/product/${product.slug}`;
  const stockBadge = getStockBadge(product);
  const category = getMainCategory(product);
  const description = getDescription(product);
  const price = getPriceLabel(product);

  const isVariableProduct = product.type === "variable";
  const canAddToCart = !isVariableProduct && product.stock_status === "instock";

  const selectedVariation = useMemo(() => {
    if (!variations.length) return null;

    return (
      variations.find(
        (variation, index) =>
          getVariationKey(variation, index) === selectedVariationKey
      ) ||
      variations.find(isVariationAvailable) ||
      variations[0]
    );
  }, [selectedVariationKey, variations]);

  useEffect(() => {
    const productVariations = getProductVariations(product);
    const firstAvailableVariation = productVariations.find(isVariationAvailable);

    setVariations(productVariations);
    setVariationStatus(productVariations.length ? "success" : "idle");
    setSelectedVariationKey(
      firstAvailableVariation ? getVariationKey(firstAvailableVariation, 0) : ""
    );
    setOptionsOpen(false);
  }, [product]);

  useEffect(() => {
    if (!optionsOpen || !isVariableProduct) return undefined;

    function handleEscape(event) {
      if (event.key === "Escape") {
        setOptionsOpen(false);
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [optionsOpen, isVariableProduct]);

  useEffect(() => {
    if (!optionsOpen || !isVariableProduct || typeof document === "undefined") {
      return undefined;
    }

    const isMobile =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 639px)").matches;

    if (!isMobile) return undefined;

    const originalOverflow = document.body.style.overflow;
    const originalTouchAction = document.body.style.touchAction;

    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.touchAction = originalTouchAction;
    };
  }, [optionsOpen, isVariableProduct]);

  async function loadVariations() {
    if (!isVariableProduct || variationStatus === "loading") return;
    if (variations.length) return;

    try {
      setVariationStatus("loading");

      const response = await fetch(
        `/api/products?slug=${encodeURIComponent(product.slug)}&refresh=1`,
        {
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok || data?.success === false) {
        throw new Error(data?.message || "Could not load product options.");
      }

      const nextVariations = getVariationsFromApiPayload(data);
      const firstAvailableVariation = nextVariations.find(isVariationAvailable);

      setVariations(nextVariations);
      setSelectedVariationKey(
        firstAvailableVariation
          ? getVariationKey(firstAvailableVariation, 0)
          : nextVariations[0]
            ? getVariationKey(nextVariations[0], 0)
            : ""
      );
      setVariationStatus(nextVariations.length ? "success" : "empty");
    } catch (error) {
      console.error(error);
      setVariationStatus("error");
    }
  }

  function handleToggleOptions() {
    setOptionsOpen((current) => {
      const nextState = !current;

      if (nextState) {
        loadVariations();
      }

      return nextState;
    });
  }

  function handleAddVariation() {
    if (!selectedVariation || !isVariationAvailable(selectedVariation)) return;

    const label = getVariationLabel(product, selectedVariation);
    const variationPrice = getVariationPrice(selectedVariation, product);
    const variationImage =
      getImageUrl(selectedVariation.image) ||
      getImageUrl(selectedVariation.images?.[0]) ||
      image;
    const variationId =
      selectedVariation.id || selectedVariation.variation_id || selectedVariationKey;

    addItem(
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
        name: `${product.name} - ${label}`,
        slug: product.slug,
        price: variationPrice,
        regular_price: selectedVariation.regular_price || variationPrice,
        sale_price: selectedVariation.sale_price || "",
        image: variationImage,
        stock_status: selectedVariation.stock_status || product.stock_status,
        stock_quantity: selectedVariation.stock_quantity ?? null,
        attributes: selectedVariation.attributes || [],
        selected_option: label,
      },
      1
    );

    setOptionsOpen(false);
  }

  function VariationsPanel({ mode = "desktop" }) {
    const isMobile = mode === "mobile";

    return (
      <div
        className={
          isMobile
            ? "rounded-t-[1.65rem] border-t border-white/10 bg-[#070707] p-4 shadow-[0_-24px_80px_rgba(0,0,0,0.75)]"
            : "mt-3 rounded-2xl border border-red-500/20 bg-black/35 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        }
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.16em] text-red-300">
              Select strength
            </p>

            {isMobile && (
              <h3 className="mt-1 line-clamp-2 text-base font-black leading-tight text-white">
                {product.name}
              </h3>
            )}
          </div>

          {isMobile ? (
            <button
              type="button"
              onClick={() => setOptionsOpen(false)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-lg font-black text-white/60"
              aria-label="Close options"
            >
              ×
            </button>
          ) : (
            <a
              href={productUrl}
              className="shrink-0 text-[9px] font-black uppercase tracking-[0.12em] text-red-300 transition hover:text-white"
            >
              Details
            </a>
          )}
        </div>

        {variationStatus === "loading" && (
          <div className="grid gap-2">
            <div className="h-10 animate-pulse rounded-xl bg-white/[0.06]" />
            <div className="h-10 animate-pulse rounded-xl bg-white/[0.04]" />
          </div>
        )}

        {variationStatus === "error" && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3">
            <p className="text-[10px] font-bold leading-4 text-red-100">
              Options could not load here.
            </p>

            <a
              href={productUrl}
              className="mt-2 inline-flex text-[9px] font-black uppercase tracking-[0.12em] text-white underline underline-offset-4"
            >
              Open product
            </a>
          </div>
        )}

        {variationStatus === "empty" && (
          <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
            <p className="text-[10px] font-bold leading-4 text-white/55">
              No inline options were found for this product.
            </p>

            <a
              href={productUrl}
              className="mt-2 inline-flex text-[9px] font-black uppercase tracking-[0.12em] text-white underline underline-offset-4"
            >
              Open product
            </a>
          </div>
        )}

        {variationStatus === "success" && variations.length > 0 && (
          <>
            <div
              className={
                isMobile
                  ? "grid max-h-[42vh] gap-2 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  : "grid grid-cols-2 gap-2"
              }
            >
              {variations.map((variation, index) => {
                const variationKey = getVariationKey(variation, index);
                const label = getVariationLabel(product, variation, index);
                const optionPrice = formatPrice(
                  getVariationPrice(variation, product)
                );
                const available = isVariationAvailable(variation);
                const active = variationKey === selectedVariationKey;

                return (
                  <button
                    key={variationKey}
                    type="button"
                    disabled={!available}
                    onClick={() => setSelectedVariationKey(variationKey)}
                    className={`min-h-[54px] rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      active
                        ? "border-red-500 bg-red-600 text-white shadow-[0_14px_34px_rgba(220,38,38,0.22)]"
                        : "border-white/10 bg-white/[0.035] text-white/65 hover:border-red-500/35 hover:text-white"
                    }`}
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-black uppercase leading-none tracking-[-0.02em]">
                          {label}
                        </span>

                        <span className="mt-1.5 block truncate text-[9px] font-bold uppercase tracking-[0.1em] opacity-65">
                          {getVariationStockLabel(variation)}
                        </span>
                      </span>

                      <span className="shrink-0 text-right text-[12px] font-black text-white">
                        {optionPrice || "View"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              disabled={
                !selectedVariation || !isVariationAvailable(selectedVariation)
              }
              onClick={handleAddVariation}
              className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-white font-black uppercase tracking-[0.12em] text-black transition hover:bg-red-500 hover:text-white disabled:pointer-events-none disabled:opacity-40 ${
                isMobile ? "h-12 text-[10px]" : "h-10 text-[9px]"
              }`}
            >
              <PlusIcon />
              Add to Cart
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <article className="group flex h-full flex-col overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#080808] transition duration-300 hover:-translate-y-1 hover:border-red-500/35 hover:bg-[#0d0d0d] hover:shadow-[0_28px_80px_rgba(0,0,0,0.42)] sm:rounded-3xl">
        <a
          href={productUrl}
          className="relative flex h-[168px] items-center justify-center overflow-hidden bg-[#101010] p-3 sm:h-[275px] sm:p-5 lg:h-[315px]"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(220,38,38,0.16),transparent_62%)] opacity-80 transition duration-300 group-hover:opacity-100" />
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.04] via-transparent to-black/30" />

          <ProductImage src={image} alt={imageAlt} priority={priority} />

          <span
            className={`absolute left-2 top-2 inline-flex max-w-[calc(100%-54px)] items-center gap-1 rounded-full border px-2 py-1 text-[7px] font-black uppercase tracking-[0.06em] backdrop-blur sm:left-4 sm:top-4 sm:gap-1.5 sm:px-2.5 sm:text-[9px] sm:tracking-[0.08em] ${stockBadge.className}`}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${stockBadge.dot}`}
            />
            {stockBadge.label}
          </span>

          <span className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/70 text-white/75 backdrop-blur transition duration-300 group-hover:bg-red-600 group-hover:text-white sm:right-4 sm:top-4 sm:h-9 sm:w-9">
            <EyeIcon />
          </span>
        </a>

        <div className="flex flex-1 flex-col p-3 sm:p-5">
          <div className="flex-1">
            <p className="mb-1.5 line-clamp-1 text-[8px] font-black uppercase tracking-[0.12em] text-red-400/80 sm:mb-2 sm:text-[10px] sm:tracking-[0.16em]">
              {category}
            </p>

            <a href={productUrl}>
              <h3 className="line-clamp-2 min-h-[34px] text-[13px] font-black leading-[1.08] tracking-[-0.035em] text-white transition group-hover:text-red-100 sm:min-h-[46px] sm:text-lg sm:leading-tight">
                {product.name}
              </h3>
            </a>

            <p className="mt-1.5 line-clamp-2 min-h-[34px] text-[10px] leading-4 text-white/45 sm:mt-2 sm:min-h-[40px] sm:text-xs sm:leading-5">
              {description}
            </p>
          </div>

          <div className="mt-3 grid gap-2 border-t border-white/10 pt-3 sm:mt-5 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:pt-4">
            <div>
              <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-white/30 sm:text-[10px] sm:tracking-[0.14em]">
                Price
              </p>

              <p className="mt-0.5 text-lg font-black tracking-[-0.05em] text-white sm:mt-1 sm:text-2xl">
                {price}
              </p>
            </div>

            {isVariableProduct ? (
              <button
                type="button"
                onClick={handleToggleOptions}
                className={`inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full px-3 text-[8px] font-black uppercase tracking-[0.08em] text-white transition sm:h-11 sm:w-auto sm:gap-2 sm:px-5 sm:text-[10px] sm:tracking-[0.1em] ${
                  optionsOpen
                    ? "bg-red-700 text-white shadow-[0_12px_34px_rgba(220,38,38,0.22)] hover:bg-red-600"
                    : "bg-red-600 text-white hover:bg-red-500"
                }`}
              >
                Choose MG
                <span
                  className={`transition duration-300 ${
                    optionsOpen ? "rotate-180" : ""
                  }`}
                >
                  <ChevronIcon />
                </span>
              </button>
            ) : canAddToCart ? (
              <button
                type="button"
                onClick={() => addItem(product, 1)}
                className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-red-600 px-3 text-[8px] font-black uppercase tracking-[0.08em] text-white transition hover:bg-red-500 sm:h-11 sm:w-auto sm:gap-2 sm:px-5 sm:text-[10px] sm:tracking-[0.1em]"
              >
                <PlusIcon />
                Add to Cart
              </button>
            ) : (
              <a
                href={productUrl}
                className="inline-flex h-9 w-full items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-3 text-[8px] font-black uppercase tracking-[0.08em] text-white/45 sm:h-11 sm:w-auto sm:px-5 sm:text-[10px] sm:tracking-[0.1em]"
              >
                View
              </a>
            )}
          </div>

          {isVariableProduct && optionsOpen && (
            <div className="hidden sm:block">
              <VariationsPanel mode="desktop" />
            </div>
          )}
        </div>
      </article>

      {isVariableProduct && optionsOpen && (
        <div className="fixed inset-0 z-[80] sm:hidden">
          <button
            type="button"
            aria-label="Close options"
            onClick={() => setOptionsOpen(false)}
            className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
          />

          <div className="absolute inset-x-0 bottom-0">
            <VariationsPanel mode="mobile" />
          </div>
        </div>
      )}
    </>
  );
}
function Pagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  const items = getPaginationItems(currentPage, totalPages);

  return (
    <nav
      className="w-full sm:w-auto"
      aria-label="Product pagination"
    >
      <div className="flex w-full items-center justify-between gap-1.5 rounded-2xl border border-white/10 bg-white/[0.03] p-1.5 sm:w-auto sm:justify-center">
        <button
          type="button"
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="inline-flex h-9 min-w-[68px] items-center justify-center rounded-xl border border-white/10 bg-black/35 px-3 text-[9px] font-black uppercase tracking-[0.12em] text-white/60 transition hover:border-red-500/40 hover:text-white disabled:pointer-events-none disabled:opacity-30"
        >
          Prev
        </button>

        <div className="hidden items-center gap-1 sm:flex">
          {items.map((item, index) =>
            item === "..." ? (
              <span
                key={`dots-${index}`}
                className="grid h-9 w-7 place-items-center text-xs font-black text-white/30"
              >
                ...
              </span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => onPageChange(item)}
                className={`grid h-9 w-9 place-items-center rounded-xl text-[11px] font-black transition ${
                  currentPage === item
                    ? "bg-red-600 text-white shadow-[0_12px_34px_rgba(220,38,38,0.22)]"
                    : "border border-white/10 bg-white/[0.035] text-white/50 hover:border-red-500/40 hover:text-white"
                }`}
              >
                {item}
              </button>
            )
          )}
        </div>

        <div className="flex h-9 items-center gap-1 rounded-xl border border-white/10 bg-black/30 px-3 text-[9px] font-black uppercase tracking-[0.12em] text-white/55 sm:hidden">
          {currentPage} / {totalPages}
        </div>

        <button
          type="button"
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className="inline-flex h-9 min-w-[68px] items-center justify-center rounded-xl border border-white/10 bg-black/35 px-3 text-[9px] font-black uppercase tracking-[0.12em] text-white/60 transition hover:border-red-500/40 hover:text-white disabled:pointer-events-none disabled:opacity-30"
        >
          Next
        </button>
      </div>
    </nav>
  );
}

export default function ProductCatalog() {
  const catalogTopRef = useRef(null);
  const [products, setProducts] = useState([]);
  const [status, setStatus] = useState("loading");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [sortBy, setSortBy] = useState("featured");
  const [currentPage, setCurrentPage]  = useState(1);

  useEffect(() => {
    let active = true;

    async function loadProducts() {
      try {
        setStatus("loading");

        const cacheBuster = Date.now();
        const response = await fetch(`/api/products?limit=45&refresh=1&_=${cacheBuster}`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
          cache: "no-store",
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
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, activeFilter, sortBy]);

  const filteredProducts = useMemo(() => {
    const result = products.filter((product) => {
      const matchesSearch = productMatchesSearch(product, searchTerm);

      const stockBadge = getStockBadge(product);

      const matchesFilter =
        activeFilter === "all" ||
        (activeFilter === "available" && product.stock_status === "instock") ||
        (activeFilter === "low" &&
          (stockBadge.status === "low" || stockBadge.status === "medium")) ||
        (activeFilter === "sold-out" && product.stock_status !== "instock");

      return matchesSearch && matchesFilter;
    });

    return [...result].sort((a, b) => {
      const priceA = Number(a.price || 0);
      const priceB = Number(b.price || 0);

      if (sortBy === "price-low") return priceA - priceB;
      if (sortBy === "price-high") return priceB - priceA;
      if (sortBy === "name") return a.name.localeCompare(b.name);

      if (sortBy === "stock") {
        const stockA = Number(a.stock_quantity || 0);
        const stockB = Number(b.stock_quantity || 0);

        return stockB - stockA;
      }

      const orderA = getCustomProductRank(a);
      const orderB = getCustomProductRank(b);

      if (orderA !== orderB) return orderA - orderB;
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;

      return a.name.localeCompare(b.name);
    });
  }, [products, searchTerm, activeFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PRODUCTS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * PRODUCTS_PER_PAGE;
  const endIndex = startIndex + PRODUCTS_PER_PAGE;
  const paginatedProducts = filteredProducts.slice(startIndex, endIndex);
  const visibleStart = filteredProducts.length > 0 ? startIndex + 1 : 0;
  const visibleEnd = Math.min(endIndex, filteredProducts.length);

  function handlePageChange(page) {
    const nextPage = Math.min(Math.max(page, 1), totalPages);

    if (nextPage === currentPage) return;

    setCurrentPage(nextPage);

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

  return (
    <section className="relative bg-[#030303] pb-20 pt-[180px] text-white sm:pt-[192px] lg:pt-[205px]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_6%,rgba(220,38,38,0.1),transparent_30%)]" />

      <div className="relative z-10 mx-auto max-w-[1220px] px-3 sm:px-5 lg:px-6">
        <div className="mb-8 flex flex-col gap-5 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-red-500">
              Shop RGVPRIME
            </p>

            <h1 className="text-4xl font-black uppercase leading-[0.88] tracking-[-0.06em] text-white sm:text-5xl lg:text-6xl">
              Research
              <span className="block text-white/65">Catalog</span>
            </h1>

            <p className="mt-4 max-w-xl text-sm leading-6 text-white/45">
              Browse research-use-only products with clear availability and easy
              navigation.
            </p>
          </div>

          <p className="text-xs font-semibold text-white/40">
            Showing{" "}
            <span className="font-black text-white">
              {visibleStart}-{visibleEnd}
            </span>{" "}
            of{" "}
            <span className="font-black text-white">
              {filteredProducts.length}
            </span>{" "}
            products
          </p>
        </div>

        <div
          ref={catalogTopRef}
          className="mb-4 rounded-3xl border border-white/10 bg-white/[0.03] p-3 sm:p-4"
        >
          <div className="grid gap-3 lg:grid-cols-[320px_1fr_190px] lg:items-center">
            <label className="relative block">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/30">
                <SearchIcon />
              </span>

              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search reta, tirz, bac..."
                className="h-12 w-full rounded-2xl border border-white/10 bg-black/35 pl-11 pr-4 text-sm font-semibold text-white outline-none transition placeholder:text-white/25 focus:border-red-500/45"
              />
            </label>

            <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {statusFilters.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setActiveFilter(item.value)}
                  className={`shrink-0 rounded-2xl border px-4 py-3 text-[10px] font-black uppercase tracking-[0.1em] transition ${
                    activeFilter === item.value
                      ? "border-red-500 bg-red-600 text-white"
                      : "border-white/10 bg-white/[0.035] text-white/45 hover:border-red-500/35 hover:text-white"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <SortDropdown value={sortBy} onChange={setSortBy} />
          </div>
        </div>

        {status === "loading" && (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            {Array.from({ length: PRODUCTS_PER_PAGE }).map((_, index) => (
              <div
                key={index}
                className="h-[385px] animate-pulse rounded-[1.35rem] border border-white/10 bg-white/[0.035] sm:h-[470px] sm:rounded-3xl"
              />
            ))}
          </div>
        )}

        {status === "error" && (
          <div className="mx-auto mt-6 max-w-md rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-center">
            <p className="text-sm font-black text-white">
              Products are not available right now.
            </p>

            <p className="mt-1 text-xs leading-5 text-white/50">
              Please try again in a moment.
            </p>
          </div>
        )}

        {status === "success" && filteredProducts.length === 0 && (
          <div className="mx-auto mt-6 max-w-md rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-center">
            <p className="text-sm font-black text-white">No products found.</p>

            <p className="mt-1 text-xs leading-5 text-white/50">
              Try changing your search or filter.
            </p>
          </div>
        )}

        {status === "success" && filteredProducts.length > 0 && (
          <>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center justify-between gap-4 px-1 sm:justify-start">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/35">
                  Page{" "}
                  <span className="text-white/70">
                    {safeCurrentPage}
                  </span>{" "}
                  of{" "}
                  <span className="text-white/70">
                    {totalPages}
                  </span>
                </p>

                <p className="text-[10px] font-semibold text-white/35">
                  {PRODUCTS_PER_PAGE} products per page
                </p>
              </div>

              <Pagination
                currentPage={safeCurrentPage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
              {paginatedProducts.map((product, index) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  priority={index < 8}
                />
              ))}
            </div>
          </>
        )}

        <p className="mx-auto mt-10 max-w-3xl text-center text-[10px] leading-5 text-white/30">
          Products shown are intended strictly for laboratory research use only.
          Not for human consumption, veterinary use, diagnostic use, therapeutic
          use, cosmetic use, food use, dietary supplement use, or clinical
          application.
        </p>
      </div>
    </section>
  );
}