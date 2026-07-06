import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { useCart } from "../cart/CartContext";

const announcementItems = [
  "Research performance essentials",
  "Fast & secure shopping",
  "RGVPRIMER Peps & Performance",
  "Simple checkout experience",
  "Quality-focused products",
  "Built for performance",
];

const navLinks = [
  { label: "Home", href: "/" },
  { label: "Shop", href: "/shop" },
  { label: "COA", href: "/coa" },
];

const FALLBACK_IMAGE = "/logo.webp";

function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

function stripHtml(html = "") {
  return String(html).replace(/<[^>]*>?/gm, "").trim();
}

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compactText(value = "") {
  return normalizeText(value).replace(/\s+/g, "");
}

function formatPrice(price) {
  if (price === null || price === undefined || price === "") return null;

  const number = Number(price);

  if (!Number.isFinite(number)) return `$${price}`;

  return `$${number.toFixed(2).replace(".00", "")}`;
}

function getProductUrl(product) {
  const slug = product?.slug ? String(product.slug).replace(/^\/+|\/+$/g, "") : "";

  if (slug) {
    return `/product/${slug}`;
  }

  return `/product/${product?.id || ""}`;
}

function getImageUrl(value) {
  if (!value) return null;
  if (typeof value === "string") return value;

  return (
    value.src ||
    value.url ||
    value.source_url ||
    value.thumbnail ||
    value.medium ||
    value.large ||
    value?.image?.src ||
    null
  );
}

function getProductImage(product) {
  return (
    getImageUrl(product?.image) ||
    getImageUrl(product?.images?.[0]) ||
    getImageUrl(product?.images?.[0]?.src) ||
    FALLBACK_IMAGE
  );
}

function getCategory(product) {
  return (
    product.categories?.find((item) => item.slug !== "uncategorized")?.name ||
    "Research Product"
  );
}

function getSearchFields(product) {
  return [
    product.name,
    product.slug,
    product.sku,
    product.short_description,
    product.description,
    ...(product.categories || []).map((item) => item.name),
    ...(product.categories || []).map((item) => item.slug),
  ]
    .filter(Boolean)
    .join(" ");
}

function editDistance(a, b) {
  if (!a || !b) return Math.max(a.length, b.length);

  const maxDiff = 3;

  if (Math.abs(a.length - b.length) > maxDiff) {
    return maxDiff + 1;
  }

  const dp = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0)
  );

  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    let rowMin = Infinity;

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );

      rowMin = Math.min(rowMin, dp[i][j]);
    }

    if (rowMin > maxDiff) return maxDiff + 1;
  }

  return dp[a.length][b.length];
}

function scoreProduct(product, rawQuery) {
  const query = normalizeText(rawQuery);
  const compactQuery = compactText(rawQuery);

  if (!query) return 0;

  const name = normalizeText(product.name);
  const slug = normalizeText(product.slug);
  const sku = normalizeText(product.sku);
  const fields = normalizeText(getSearchFields(product));

  const compactName = compactText(product.name);
  const compactSlug = compactText(product.slug);
  const compactSku = compactText(product.sku);
  const compactFields = compactText(getSearchFields(product));

  let score = 0;

  if (sku && sku === query) score += 180;
  if (name === query) score += 160;
  if (slug === query) score += 140;

  if (compactSku && compactSku === compactQuery) score += 170;
  if (compactName === compactQuery) score += 150;
  if (compactSlug === compactQuery) score += 130;

  if (name.includes(query)) score += 90;
  if (sku.includes(query)) score += 95;
  if (slug.includes(query)) score += 80;
  if (fields.includes(query)) score += 55;

  if (compactName.includes(compactQuery)) score += 85;
  if (compactSku.includes(compactQuery)) score += 95;
  if (compactSlug.includes(compactQuery)) score += 75;
  if (compactFields.includes(compactQuery)) score += 50;

  const queryTokens = query.split(/\s+/).filter(Boolean);
  const fieldTokens = fields.split(/\s+/).filter(Boolean);

  queryTokens.forEach((queryToken) => {
    let bestTokenScore = 0;

    fieldTokens.forEach((fieldToken) => {
      if (!fieldToken) return;

      if (fieldToken === queryToken) {
        bestTokenScore = Math.max(bestTokenScore, 45);
        return;
      }

      if (fieldToken.startsWith(queryToken)) {
        bestTokenScore = Math.max(bestTokenScore, 35);
        return;
      }

      if (fieldToken.includes(queryToken)) {
        bestTokenScore = Math.max(bestTokenScore, 28);
        return;
      }

      const distance = editDistance(queryToken, fieldToken);

      if (queryToken.length >= 5 && distance <= 2) {
        bestTokenScore = Math.max(bestTokenScore, 24);
      } else if (queryToken.length >= 3 && distance <= 1) {
        bestTokenScore = Math.max(bestTokenScore, 18);
      }
    });

    score += bestTokenScore;
  });

  if (product.featured) score += 4;
  if (product.stock_status === "instock") score += 3;

  return score;
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="8" r="4" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6h15l-1.6 8.4a2 2 0 0 1-2 1.6H9a2 2 0 0 1-2-1.6L5 3H2" />
      <circle cx="9" cy="21" r="1" />
      <circle cx="18" cy="21" r="1" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function ArrowIcon() {
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
      <path d="M7 17L17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

function SearchResultImage({ src, alt, priority = false }) {
  const [loaded, setLoaded] = useState(false);
  const [imageSrc, setImageSrc] = useState(src || FALLBACK_IMAGE);

  useEffect(() => {
    setLoaded(false);
    setImageSrc(src || FALLBACK_IMAGE);
  }, [src]);

  return (
    <div className="relative flex h-[66px] w-[66px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[#101010] p-2 sm:h-[76px] sm:w-[76px]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(220,38,38,0.14),transparent_62%)]" />

      {!loaded && <div className="absolute inset-0 animate-pulse bg-white/[0.045]" />}

      <img
        src={imageSrc}
        alt={alt || ""}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        onLoad={() => setLoaded(true)}
        onError={() => {
          setImageSrc(FALLBACK_IMAGE);
          setLoaded(true);
        }}
        className={`relative h-full w-full object-contain transition duration-500 group-hover:scale-105 ${
          loaded ? "opacity-100 blur-0" : "opacity-0 blur-sm"
        }`}
      />
    </div>
  );
}

function LogoutIcon() {
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
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

function LockIcon() {
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
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function initialsFromUser(user) {
  const first = user?.first_name?.trim()?.[0] || "";
  const last = user?.last_name?.trim()?.[0] || "";
  const display = user?.display_name?.trim()?.[0] || "";
  const email = user?.email?.trim()?.[0] || "";

  return `${first}${last}`.toUpperCase() || display.toUpperCase() || email.toUpperCase() || "A";
}

function getAccountName(user) {
  const fullName = `${user?.first_name || ""} ${user?.last_name || ""}`.trim();
  return fullName || user?.display_name || user?.email || "Account";
}

function AccountDropdown({
  open,
  user,
  status,
  onOpen,
  onClose,
  onToggle,
  onLogout,
  glassStyle,
}) {
  const isLoggedIn = Boolean(user);
  const loading = status === "loading";

  return (
    <div
      className="relative hidden pb-5 -mb-5 sm:block"
      onMouseEnter={onOpen}
      onMouseLeave={onClose}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label="Account menu"
        aria-expanded={open}
        className="group relative flex h-10 min-w-10 items-center justify-center gap-2 rounded-full border px-0 text-white/75 transition hover:bg-white/10 hover:text-white md:h-11 md:min-w-11"
        style={glassStyle}
      >
        {isLoggedIn ? (
          <span className="grid h-7 min-w-7 place-items-center rounded-full bg-red-600 px-2 text-[10px] font-black text-white shadow-[0_0_22px_rgba(220,38,38,0.45)]">
            {initialsFromUser(user)}
          </span>
        ) : (
          <UserIcon />
        )}
      </button>

      {open && (
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.96, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="absolute right-0 top-[calc(100%+0.45rem)] z-[120] w-[285px] overflow-hidden rounded-[1.45rem] border border-white/10 bg-[#070707]/96 p-3 text-white shadow-[0_30px_100px_rgba(0,0,0,0.72)] backdrop-blur-xl"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(220,38,38,0.18),transparent_38%)]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-400/60 to-transparent" />

          <div className="relative">
            {loading && (
              <div className="grid gap-2 p-1">
                <div className="h-16 animate-pulse rounded-2xl bg-white/[0.05]" />
                <div className="h-11 animate-pulse rounded-2xl bg-white/[0.035]" />
                <div className="h-11 animate-pulse rounded-2xl bg-white/[0.035]" />
              </div>
            )}

            {!loading && !isLoggedIn && (
              <div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl border border-red-400/20 bg-red-500/10 text-red-100">
                    <LockIcon />
                  </div>
                  <p className="text-sm font-black tracking-[-0.02em] text-white">
                    Private account access
                  </p>
                  <p className="mt-1 text-xs leading-5 text-white/42">
                    Sign in to review orders, update details, and manage your profile.
                  </p>
                </div>

                <div className="mt-3 grid gap-2">
                  <a
                    href="/account?mode=login"
                    className="flex min-h-11 items-center justify-between rounded-2xl bg-red-600 px-4 text-xs font-black uppercase tracking-[0.14em] text-white transition hover:bg-red-500"
                  >
                    Sign In
                    <ArrowIcon />
                  </a>

                  <a
                    href="/account?mode=register"
                    className="flex min-h-11 items-center justify-between rounded-2xl border border-white/10 bg-white/[0.035] px-4 text-xs font-black uppercase tracking-[0.14em] text-white/72 transition hover:bg-white/[0.07] hover:text-white"
                  >
                    Register
                    <ArrowIcon />
                  </a>
                </div>
              </div>
            )}

            {!loading && isLoggedIn && (
              <div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <div className="flex items-center gap-3">
                    <div className="grid h-11 min-w-11 place-items-center rounded-2xl bg-red-600 px-2 text-xs font-black text-white shadow-[0_18px_40px_rgba(220,38,38,0.28)]">
                      {initialsFromUser(user)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-white">
                        {getAccountName(user)}
                      </p>
                      <p className="truncate text-xs text-white/38">
                        {user?.email || "Signed in"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid gap-2">
                  <a
                    href="/account"
                    className="flex min-h-11 items-center justify-between rounded-2xl bg-red-600 px-4 text-xs font-black uppercase tracking-[0.14em] text-white transition hover:bg-red-500"
                  >
                    View Profile
                    <ArrowIcon />
                  </a>

                  <button
                    type="button"
                    onClick={onLogout}
                    className="flex min-h-11 items-center justify-between rounded-2xl border border-white/10 bg-white/[0.035] px-4 text-xs font-black uppercase tracking-[0.14em] text-white/72 transition hover:border-red-500/30 hover:bg-red-500/10 hover:text-white"
                  >
                    Sign Out
                    <LogoutIcon />
                  </button>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}

function AnnouncementItem({ text }) {
  return (
    <div className="flex h-8 shrink-0 items-center px-5 text-[9px] font-bold uppercase tracking-[0.16em] text-white/80 sm:h-9 sm:px-8 sm:text-[11px] md:text-xs">
      <span>{text}</span>
      <span className="ml-5 text-red-500 sm:ml-8">●</span>
    </div>
  );
}

function SearchModal({
  open,
  onClose,
  products,
  status,
  query,
  setQuery,
  onLoadProducts,
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    onLoadProducts();

    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 80);

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose, onLoadProducts]);

  const results = useMemo(() => {
    const cleanQuery = query.trim();

    if (!cleanQuery) {
      return products
        .filter((product) => product.stock_status === "instock")
        .slice(0, 8);
    }

    const scored = products
      .map((product) => ({
        product,
        score: scoreProduct(product, cleanQuery),
      }))
      .filter((item) => item.score >= 20)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((item) => item.product);

    return scored;
  }, [products, query]);

  useEffect(() => {
    if (!open || status !== "success" || !results.length) return;

    const warmImages = results.slice(0, 6).map((product) => {
      const image = new Image();
      image.decoding = "async";
      image.src = getProductImage(product);
      return image;
    });

    return () => {
      warmImages.forEach((image) => {
        image.onload = null;
        image.onerror = null;
      });
    };
  }, [open, status, results]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-black/78 px-3 py-4 text-white backdrop-blur-md sm:px-5">
      <button
        type="button"
        aria-label="Close search"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default"
      />

      <motion.div
        initial={{ opacity: 0, y: -14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 mx-auto mt-20 w-full max-w-[780px] overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#070707] shadow-[0_30px_120px_rgba(0,0,0,0.72)] sm:mt-24"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(220,38,38,0.14),transparent_42%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-500/50 to-transparent" />

        <div className="relative p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-300">
                Product Search
              </p>
              <p className="mt-1 text-xs text-white/40">
                Search by name, SKU, category, or close spelling.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.035] text-white/65 transition hover:bg-red-600 hover:text-white"
            >
              <CloseIcon />
            </button>
          </div>

          <label className="relative block">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/35">
              <SearchIcon />
            </span>

            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Try: BPC 157, tesamorlin, bac water..."
              className="h-14 w-full rounded-2xl border border-white/10 bg-black/45 pl-12 pr-4 text-base font-bold text-white outline-none transition placeholder:text-white/25 focus:border-red-500/55 focus:shadow-[0_0_0_4px_rgba(220,38,38,0.10)]"
            />
          </label>

          <div className="mt-3 max-h-[min(62vh,520px)] overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:rgba(239,68,68,0.55)_transparent]">
            {status === "loading" && (
              <div className="grid gap-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-[66px_minmax(0,1fr)] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-2.5"
                  >
                    <div className="h-[66px] w-[66px] animate-pulse rounded-xl bg-white/[0.055]" />
                    <div className="space-y-2">
                      <div className="h-3 w-24 animate-pulse rounded-full bg-white/[0.06]" />
                      <div className="h-4 w-4/5 animate-pulse rounded-full bg-white/[0.07]" />
                      <div className="h-3 w-32 animate-pulse rounded-full bg-white/[0.05]" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {status === "error" && (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-center">
                <p className="text-sm font-black text-white">
                  Search is not available right now.
                </p>
                <p className="mt-1 text-xs text-white/45">
                  Please try again in a moment.
                </p>
              </div>
            )}

            {status === "success" && results.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-6 text-center">
                <p className="text-sm font-black text-white">
                  No products found.
                </p>
                <p className="mt-1 text-xs leading-5 text-white/45">
                  Try another spelling, product code, SKU, or category.
                </p>
              </div>
            )}

            {status === "success" && results.length > 0 && (
              <div className="grid gap-2">
                {!query.trim() && (
                  <p className="px-1 pb-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/35">
                    Popular Products
                  </p>
                )}

                {results.map((product, index) => {
                  const productUrl = getProductUrl(product);
                  const image = getProductImage(product);
                  const category = getCategory(product);
                  const price = formatPrice(product.price);

                  return (
                    <a
                      key={product.id}
                      href={productUrl}
                      onClick={onClose}
                      className="group grid min-w-0 grid-cols-[66px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-2.5 text-white no-underline transition hover:border-red-500/35 hover:bg-white/[0.055] sm:grid-cols-[76px_minmax(0,1fr)_auto]"
                    >
                      <SearchResultImage
                        src={image}
                        alt={product.name}
                        priority={!query.trim() || index < 3}
                      />

                      <div className="min-w-0">
                        <p className="truncate text-[9px] font-black uppercase tracking-[0.14em] text-red-300/80">
                          {category}
                        </p>

                        <p className="mt-1 line-clamp-2 text-sm font-black leading-tight tracking-[-0.02em] text-white sm:text-base">
                          {product.name}
                        </p>

                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {product.sku && (
                            <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-white/45">
                              SKU: {product.sku}
                            </span>
                          )}

                          {price && (
                            <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-white/45">
                              {price}
                            </span>
                          )}
                        </div>
                      </div>

                      <span className="hidden h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-black/35 text-white/45 transition group-hover:bg-red-600 group-hover:text-white sm:grid">
                        <ArrowIcon />
                      </span>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default function Navbar({ transparent = false }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [products, setProducts] = useState([]);
  const [productsStatus, setProductsStatus] = useState("idle");
  const [scrollProgress, setScrollProgress] = useState(transparent ? 0 : 1);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accountStatus, setAccountStatus] = useState("loading");
  const [accountUser, setAccountUser] = useState(null);
  const accountMenuTimerRef = useRef(null);

  const { openCart, itemCount } = useCart();

  const duplicatedItems = [
    ...announcementItems,
    ...announcementItems,
    ...announcementItems,
    ...announcementItems,
  ];

  useEffect(() => {
    let active = true;

    function setGuestAccount() {
      if (!active) return;

      setAccountUser(null);
      setAccountStatus("guest");
      setAccountMenuOpen(false);
    }

    async function loadAccount({ silent = false } = {}) {
      try {
        if (!silent) {
          setAccountStatus("loading");
        }

        const response = await fetch("/api/account/me", {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Cache-Control": "no-store",
          },
          credentials: "same-origin",
          cache: "no-store",
        });

        const text = await response.text();
        let data = {};

        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = {};
        }

        if (!active) return;

        if (response.ok && data.success && data.user) {
          setAccountUser(data.user);
          setAccountStatus("authenticated");
        } else {
          setGuestAccount();
        }
      } catch {
        setGuestAccount();
      }
    }

    function handlePortalLogout() {
      setGuestAccount();
    }

    function handlePortalLogin() {
      loadAccount({ silent: true });
    }

    function handleStorageEvent(event) {
      if (event.key !== "rgv-account-event") return;

      const value = String(event.newValue || "");

      if (value.startsWith("logout:")) {
        setGuestAccount();
        return;
      }

      if (value.startsWith("login:")) {
        loadAccount({ silent: true });
      }
    }

    loadAccount();

    window.addEventListener("rgv-account-logout", handlePortalLogout);
    window.addEventListener("rgv-account-login", handlePortalLogin);
    window.addEventListener("storage", handleStorageEvent);
    window.addEventListener("focus", handlePortalLogin);

    return () => {
      active = false;
      window.clearTimeout(accountMenuTimerRef.current);
      window.removeEventListener("rgv-account-logout", handlePortalLogout);
      window.removeEventListener("rgv-account-login", handlePortalLogin);
      window.removeEventListener("storage", handleStorageEvent);
      window.removeEventListener("focus", handlePortalLogin);
    };
  }, []);

  useEffect(() => {
    if (!transparent) {
      setScrollProgress(1);
      return;
    }

    let ticking = false;

    const handleScroll = () => {
      if (ticking) return;

      ticking = true;

      window.requestAnimationFrame(() => {
        const progress = Math.min(window.scrollY / 130, 1);
        setScrollProgress(progress);
        ticking = false;
      });
    };

    handleScroll();

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [transparent]);

  async function loadProductsForSearch() {
    if (productsStatus === "loading" || productsStatus === "success") return;

    try {
      setProductsStatus("loading");

      const response = await fetch("/api/products", {
        cache: "force-cache",
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not load products.");
      }

      setProducts(Array.isArray(data.products) ? data.products : []);
      setProductsStatus("success");
    } catch (error) {
      console.error(error);
      setProductsStatus("error");
    }
  }

  function openSearchModal() {
    setMenuOpen(false);
    setAccountMenuOpen(false);
    setSearchOpen(true);
  }

  function openAccountMenu() {
    window.clearTimeout(accountMenuTimerRef.current);
    setAccountMenuOpen(true);
  }

  function closeAccountMenu() {
    window.clearTimeout(accountMenuTimerRef.current);
    accountMenuTimerRef.current = window.setTimeout(() => {
      setAccountMenuOpen(false);
    }, 130);
  }

  function toggleAccountMenu() {
    window.clearTimeout(accountMenuTimerRef.current);
    setMenuOpen(false);
    setAccountMenuOpen((current) => !current);
  }

  async function handleAccountLogout() {
    const fallbackLogoutUrl =
      "/api/account/logout?next=/account%3Fmode%3Dlogin%26logged_out%3D1";

    let logoutOk = false;

    setAccountStatus("loading");

    try {
      const response = await fetch("/api/account/logout", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-store",
        },
        credentials: "same-origin",
        cache: "no-store",
      });

      logoutOk = response.ok;
    } catch (error) {
      console.error("Navbar logout failed:", error);
    }

    if (!logoutOk) {
      window.location.assign(fallbackLogoutUrl);
      return;
    }

    setAccountUser(null);
    setAccountStatus("guest");
    setAccountMenuOpen(false);
    setMenuOpen(false);

    try {
      window.localStorage.setItem("rgv-account-event", `logout:${Date.now()}`);
    } catch {}

    window.dispatchEvent(new Event("rgv-account-logout"));

    if (window.location.pathname.startsWith("/account")) {
      window.history.replaceState({}, "", "/account?mode=login&logged_out=1");
    }
  }

  const activeProgress = menuOpen ? 1 : transparent ? scrollProgress : 1;

  const headerBgOpacity = 0.58 * activeProgress;
  const barBgOpacity = 0.88 * activeProgress;
  const navBlackOpacity = 0.82 * activeProgress;
  const navRedOpacity = 0.34 * activeProgress;
  const borderOpacity = 0.14 * activeProgress;
  const shadowOpacity = 0.34 * activeProgress;
  const blurAmount = 18 * activeProgress;
  const navEffectOpacity = 0.16 * activeProgress;
  const shineOpacity = 0.1 * activeProgress;

  const chipBgOpacity = 0.04 + 0.14 * activeProgress;
  const chipBorderOpacity = 0.08 + 0.08 * activeProgress;

  const glassStyle = {
    background: `rgba(0,0,0,${chipBgOpacity})`,
    borderColor: `rgba(255,255,255,${chipBorderOpacity})`,
    backdropFilter: `blur(${Math.max(6, blurAmount)}px)`,
    WebkitBackdropFilter: `blur(${Math.max(6, blurAmount)}px)`,
  };

  return (
    <>
      <header
        className="fixed left-0 top-0 z-[90] w-full text-white"
        style={{
          background: `linear-gradient(180deg, rgba(0,0,0,${headerBgOpacity}) 0%, rgba(0,0,0,${
            headerBgOpacity * 0.45
          }) 72%, rgba(0,0,0,0) 100%)`,
          backdropFilter: `blur(${blurAmount}px)`,
          WebkitBackdropFilter: `blur(${blurAmount}px)`,
          boxShadow: `0 20px 80px rgba(0,0,0,${shadowOpacity})`,
          transition:
            "background 650ms cubic-bezier(.16,1,.3,1), box-shadow 650ms cubic-bezier(.16,1,.3,1), backdrop-filter 650ms cubic-bezier(.16,1,.3,1)",
        }}
      >
        <div
          className="relative h-8 w-full overflow-hidden border-b sm:h-9"
          style={{
            background: `linear-gradient(90deg, rgba(69,10,10,${barBgOpacity}), rgba(8,8,8,${barBgOpacity}), rgba(69,10,10,${barBgOpacity}))`,
            borderColor: `rgba(255,255,255,${borderOpacity})`,
            transition:
              "background 650ms cubic-bezier(.16,1,.3,1), border-color 650ms cubic-bezier(.16,1,.3,1)",
          }}
        >
          <motion.div
            className="flex h-full w-max items-center whitespace-nowrap"
            initial={{ x: 0 }}
            animate={{ x: "-50%" }}
            transition={{
              duration: 70,
              ease: "linear",
              repeat: Infinity,
              repeatType: "loop",
            }}
          >
            {duplicatedItems.map((text, index) => (
              <AnnouncementItem key={`${text}-${index}`} text={text} />
            ))}
          </motion.div>
        </div>

        <nav
          className="relative w-full overflow-visible border-b"
          style={{
            background: `linear-gradient(90deg, rgba(69,10,10,${navRedOpacity}) 0%, rgba(3,3,3,${navBlackOpacity}) 28%, rgba(18,6,6,${navBlackOpacity}) 52%, rgba(69,10,10,${navRedOpacity}) 100%)`,
            borderColor: `rgba(255,255,255,${borderOpacity})`,
            transition:
              "background 650ms cubic-bezier(.16,1,.3,1), border-color 650ms cubic-bezier(.16,1,.3,1)",
          }}
        >
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_50%,rgba(220,38,38,0.16),transparent_30%),radial-gradient(circle_at_88%_50%,rgba(127,29,29,0.16),transparent_34%)]"
            style={{
              opacity: navEffectOpacity,
              transition: "opacity 650ms cubic-bezier(.16,1,.3,1)",
            }}
          />

          <motion.div
            className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-red-500/10 to-transparent"
            style={{ opacity: shineOpacity }}
            animate={{ x: ["0%", "320%"] }}
            transition={{
              duration: 8,
              ease: "linear",
              repeat: Infinity,
              repeatType: "loop",
            }}
          />

          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
            style={{ opacity: activeProgress }}
          />

          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-red-500/25 to-transparent"
            style={{ opacity: activeProgress }}
          />

          <div className="relative z-10 mx-auto flex h-20 max-w-[1440px] items-center justify-between px-4 sm:px-5 md:px-8 lg:px-10">
            <a
              href="/"
              aria-label="RGVPRIMER Home"
              className="flex min-w-0 shrink-0 items-center"
            >
              <img
                src="/logo.webp"
                alt="RGVPRIMER"
                className="h-14 w-auto shrink-0 object-contain transition-all duration-500 sm:h-16 md:h-20"
              />
            </a>

            <div
              className="hidden items-center gap-2 rounded-full border px-2 py-2 md:flex"
              style={glassStyle}
            >
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="rounded-full px-5 py-2.5 text-xs font-black uppercase tracking-[0.14em] text-white/80 transition hover:bg-white/10 hover:text-white lg:text-sm"
                >
                  {link.label}
                </a>
              ))}
            </div>

            <div className="flex shrink-0 items-center gap-0.5 sm:gap-1 md:gap-2">
              <button
                type="button"
                onClick={openSearchModal}
                aria-label="Search products"
                className="hidden h-10 w-10 items-center justify-center rounded-full border text-white/75 transition hover:bg-white/10 hover:text-white sm:flex md:h-11 md:w-11"
                style={glassStyle}
              >
                <SearchIcon />
              </button>

              <AccountDropdown
                open={accountMenuOpen}
                user={accountUser}
                status={accountStatus}
                onOpen={openAccountMenu}
                onClose={closeAccountMenu}
                onToggle={toggleAccountMenu}
                onLogout={handleAccountLogout}
                glassStyle={glassStyle}
              />

              <button
                type="button"
                onClick={openCart}
                aria-label="Open cart"
                className="relative flex h-10 w-10 items-center justify-center rounded-full border text-white/85 transition hover:bg-white/10 hover:text-white md:h-11 md:w-11"
                style={glassStyle}
              >
                <CartIcon />

                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-black text-white shadow-[0_0_18px_rgba(220,38,38,0.55)]">
                  {itemCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                className="ml-1 flex h-10 w-10 items-center justify-center rounded-full border text-white transition hover:bg-white/10 md:hidden"
                style={glassStyle}
              >
                {menuOpen ? <CloseIcon /> : <MenuIcon />}
              </button>
            </div>
          </div>
        </nav>

        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="border-b border-white/10 bg-[linear-gradient(135deg,rgba(69,10,10,0.88),rgba(3,3,3,0.98),rgba(69,10,10,0.74))] px-4 py-5 backdrop-blur-xl sm:px-5 md:hidden"
          >
            <div className="grid gap-2">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 text-sm font-black uppercase tracking-[0.16em] text-white/75 transition hover:bg-red-600 hover:text-white"
                >
                  {link.label}
                </a>
              ))}
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={openSearchModal}
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white/80 transition hover:bg-white/10 hover:text-white"
              >
                <SearchIcon />
                Search
              </button>

              {accountUser ? (
                <>
                  <a
                    href="/account"
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white/80 transition hover:bg-white/10 hover:text-white"
                  >
                    <UserIcon />
                    Profile
                  </a>

                  <button
                    type="button"
                    onClick={handleAccountLogout}
                    className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white/80 transition hover:bg-red-600 hover:text-white sm:col-span-2"
                  >
                    <LogoutIcon />
                    Sign Out
                  </button>
                </>
              ) : (
                <>
                  <a
                    href="/account?mode=login"
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white/80 transition hover:bg-white/10 hover:text-white"
                  >
                    <UserIcon />
                    Sign In
                  </a>

                  <a
                    href="/account?mode=register"
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-red-600 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white transition hover:bg-red-500 sm:col-span-2"
                  >
                    <LockIcon />
                    Register
                  </a>
                </>
              )}
            </div>
          </motion.div>
        )}
      </header>

      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        products={products}
        status={productsStatus}
        query={searchTerm}
        setQuery={setSearchTerm}
        onLoadProducts={loadProductsForSearch}
      />
    </>
  );
}