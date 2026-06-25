import { useEffect, useMemo, useState } from "react";

const FALLBACK_IMAGE = "/logo.webp";

function stripHtml(html = "") {
  return html.replace(/<[^>]*>?/gm, "").trim();
}

function formatPrice(price) {
  if (!price) return "View";

  const number = Number(price);

  if (Number.isNaN(number)) {
    return `$${price}`;
  }

  return `$${number.toFixed(2).replace(".00", "")}`;
}

function getSimpleDescription(product) {
  const cleanDescription = stripHtml(product.short_description || "");

  if (!cleanDescription) {
    return "Research-use-only product for laboratory use.";
  }

  if (cleanDescription.length > 64) {
    return `${cleanDescription.slice(0, 64)}...`;
  }

  return cleanDescription;
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
      label: "Out",
      className:
        "border-red-500/35 bg-red-600/20 text-red-200 shadow-[0_0_24px_rgba(220,38,38,0.25)]",
    };
  }

  if (quantity === null || Number.isNaN(quantity)) {
    return {
      label: "Available",
      className:
        "border-green-500/30 bg-green-500/15 text-green-200 shadow-[0_0_24px_rgba(34,197,94,0.18)]",
    };
  }

  if (quantity >= 40) {
    return {
      label: `${quantity} Available`,
      className:
        "border-green-500/30 bg-green-500/15 text-green-200 shadow-[0_0_24px_rgba(34,197,94,0.18)]",
    };
  }

  if (quantity >= 20) {
    return {
      label: `${quantity} Left`,
      className:
        "border-yellow-500/35 bg-yellow-500/15 text-yellow-200 shadow-[0_0_24px_rgba(234,179,8,0.18)]",
    };
  }

  if (quantity > 0) {
    return {
      label: `Only ${quantity} Left`,
      className:
        "border-red-500/35 bg-red-600/20 text-red-200 shadow-[0_0_24px_rgba(220,38,38,0.25)]",
    };
  }

  return {
    label: "Out",
    className:
      "border-red-500/35 bg-red-600/20 text-red-200 shadow-[0_0_24px_rgba(220,38,38,0.25)]",
  };
}

function getProductSlug(product = {}) {
  if (product.slug) {
    return String(product.slug).trim().replace(/^\/+|\/+$/g, "");
  }

  if (product.permalink) {
    try {
      const url = new URL(product.permalink, "https://example.com");
      const parts = url.pathname.split("/").filter(Boolean);
      const productIndex = parts.lastIndexOf("product");

      if (productIndex >= 0 && parts[productIndex + 1]) {
        return parts[productIndex + 1];
      }

      return parts[parts.length - 1] || "";
    } catch {
      const cleanPermalink = String(product.permalink)
        .split("?")[0]
        .split("#")[0]
        .replace(/\/+$/g, "");

      return cleanPermalink.split("/").filter(Boolean).pop() || "";
    }
  }

  return "";
}

function getProductUrl(product = {}) {
  const slug = getProductSlug(product);

  if (!slug) return "/shop";

  return `/product/${slug}`;
}

function EyeIcon() {
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
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function FeaturedProducts() {
  const [products, setProducts] = useState([]);
  const [status, setStatus] = useState("loading");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [itemsPerView, setItemsPerView] = useState(4);

  useEffect(() => {
    async function loadProducts() {
      try {
        const response = await fetch("/api/featured-products");
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.message || "Could not load products.");
        }

        setProducts((data.products || []).slice(0, 4));
        setStatus("success");
      } catch (error) {
        console.error(error);
        setStatus("error");
      }
    }

    loadProducts();
  }, []);

  useEffect(() => {
    function updateItemsPerView() {
      if (window.innerWidth < 640) {
        setItemsPerView(1);
      } else if (window.innerWidth < 1024) {
        setItemsPerView(2);
      } else {
        setItemsPerView(4);
      }
    }

    updateItemsPerView();
    window.addEventListener("resize", updateItemsPerView);

    return () => {
      window.removeEventListener("resize", updateItemsPerView);
    };
  }, []);

  const maxIndex = useMemo(() => {
    return Math.max(products.length - itemsPerView, 0);
  }, [products.length, itemsPerView]);

  useEffect(() => {
    setCurrentIndex((prev) => Math.min(prev, maxIndex));
  }, [maxIndex]);

  const canSlide = products.length > itemsPerView;

  function goPrev() {
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
  }

  function goNext() {
    setCurrentIndex((prev) => Math.min(prev + 1, maxIndex));
  }

  return (
    <section className="relative overflow-hidden bg-[#050505] py-14 text-white sm:py-16 lg:py-20">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(220,38,38,0.12),transparent_30%),radial-gradient(circle_at_80%_20%,rgba(127,29,29,0.1),transparent_32%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-600/35 to-transparent" />

      <div className="relative z-10 mx-auto max-w-[1320px] px-6 sm:px-8 lg:px-12 xl:px-8">
        <div className="mx-auto mb-7 max-w-3xl text-center sm:mb-8">
          <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-red-500">
            Best Sellers
          </p>

          <h2 className="text-3xl font-black leading-tight tracking-[-0.04em] text-white sm:text-4xl md:text-5xl">
            Our Most Requested Products
          </h2>

          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/55">
            Customer favorites from our current product lineup.
          </p>
        </div>

        {status === "success" && canSlide && (
          <div className="mb-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={goPrev}
              disabled={currentIndex === 0}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-xl font-black text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
              aria-label="Previous products"
            >
              ‹
            </button>

            <button
              type="button"
              onClick={goNext}
              disabled={currentIndex === maxIndex}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-red-500/30 bg-red-600 text-xl font-black text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-35"
              aria-label="Next products"
            >
              ›
            </button>
          </div>
        )}

        {status === "loading" && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]"
              >
                <div className="h-52 animate-pulse bg-white/[0.04] sm:h-56" />

                <div className="space-y-3 p-4">
                  <div className="h-5 w-2/3 animate-pulse rounded bg-white/10" />
                  <div className="h-4 w-full animate-pulse rounded bg-white/[0.06]" />
                  <div className="h-14 w-full animate-pulse rounded-xl bg-white/10" />
                  <div className="h-11 w-full animate-pulse rounded-xl bg-white/10" />
                </div>
              </div>
            ))}
          </div>
        )}

        {status === "error" && (
          <div className="mx-auto max-w-xl rounded-3xl border border-red-500/20 bg-red-500/10 p-6 text-center">
            <p className="text-lg font-black text-white">
              Products are not available right now.
            </p>

            <p className="mt-2 text-sm leading-6 text-white/60">
              Please try again in a moment or visit the shop.
            </p>

            <a
              href="/shop"
              className="mt-5 inline-flex min-h-12 items-center justify-center rounded-xl bg-red-600 px-6 text-sm font-black text-white transition hover:bg-red-500"
            >
              Go to Shop
            </a>
          </div>
        )}

        {status === "success" && products.length === 0 && (
          <div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/[0.035] p-6 text-center">
            <p className="text-lg font-black text-white">
              No featured products yet.
            </p>

            <p className="mt-2 text-sm leading-6 text-white/55">
              Please check back soon.
            </p>
          </div>
        )}

        {status === "success" && products.length > 0 && (
          <>
            <div className="-mx-2 overflow-x-hidden px-2 py-4">
              <div
                className="flex transition-transform duration-500 ease-out"
                style={{
                  transform: `translateX(-${
                    currentIndex * (100 / itemsPerView)
                  }%)`,
                }}
              >
                {products.map((product) => {
                  const image = product.image || FALLBACK_IMAGE;
                  const description = getSimpleDescription(product);
                  const productUrl = getProductUrl(product);

                  const price =
                    product.type === "variable"
                      ? `From ${formatPrice(product.price)}`
                      : formatPrice(product.price);

                  const stockBadge = getStockBadge(product);

                  return (
                    <div
                      key={product.id}
                      className="shrink-0 px-2"
                      style={{
                        width: `${100 / itemsPerView}%`,
                      }}
                    >
                      <article className="group h-full overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a] shadow-[0_20px_60px_rgba(0,0,0,0.28)] transition duration-300 hover:-translate-y-1 hover:border-red-500/35 hover:shadow-[0_28px_80px_rgba(0,0,0,0.4)]">
                        <a
                          href={productUrl}
                          className="relative flex h-52 items-center justify-center overflow-hidden bg-[#101010] p-2 sm:h-56"
                        >
                          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.04] to-black/20" />

                          <div className="absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-600/10 blur-3xl transition duration-300 group-hover:bg-red-600/20" />

                          <img
                            src={image}
                            alt={product.name}
                            loading="lazy"
                            className="relative h-[115%] w-[115%] max-w-none scale-[1.12] object-contain transition duration-500 group-hover:scale-[1.2]"
                          />

                          <span
                            className={`absolute left-3 top-3 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] backdrop-blur ${stockBadge.className}`}
                          >
                            {stockBadge.label}
                          </span>

                          <span className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/65 text-white/80 backdrop-blur transition duration-300 group-hover:border-red-500/35 group-hover:bg-red-600 group-hover:text-white">
                            <EyeIcon />
                          </span>
                        </a>

                        <div className="p-4">
                          <h3 className="line-clamp-2 min-h-[44px] text-base font-black leading-tight tracking-[-0.03em] text-white">
                            {product.name}
                          </h3>

                          <p className="mt-2 line-clamp-2 min-h-[40px] text-xs leading-5 text-white/55">
                            {description}
                          </p>

                          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">
                              Price
                            </p>

                            <p className="mt-1 text-2xl font-black tracking-[-0.04em] text-white">
                              {price}
                            </p>
                          </div>

                          <a
                            href={productUrl}
                            className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl bg-red-600 px-4 text-xs font-black uppercase tracking-[0.08em] text-white transition hover:bg-red-500"
                          >
                            View Product
                          </a>
                        </div>
                      </article>
                    </div>
                  );
                })}
              </div>
            </div>

            {canSlide && (
              <div className="mt-3 flex items-center justify-center gap-2">
                {Array.from({ length: maxIndex + 1 }).map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setCurrentIndex(index)}
                    aria-label={`Go to product slide ${index + 1}`}
                    className={`h-2 rounded-full transition-all ${
                      currentIndex === index
                        ? "w-8 bg-red-600"
                        : "w-2 bg-white/20 hover:bg-white/35"
                    }`}
                  />
                ))}
              </div>
            )}

            <div className="mt-7 text-center">
              <a
                href="/shop"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-7 text-sm font-black text-white transition hover:border-red-500/35 hover:bg-red-600"
              >
                View All Products
              </a>
            </div>
          </>
        )}

        <p className="mx-auto mt-7 max-w-3xl text-center text-xs leading-6 text-white/35">
          Products shown are intended strictly for laboratory research use only.
          Not for human or animal use.
        </p>
      </div>
    </section>
  );
}