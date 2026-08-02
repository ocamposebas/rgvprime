import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import coaData from "../data/coas.json";

const COAS_PER_PAGE = 8;
const MAX_SUGGESTIONS = 8;
const URL_SYNC_DELAY = 400;
const ALL_ID = "";

function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function getHistoryKey(file) {
  return `${file?.code || "coa"}-${file?.lot || file?.url || "history"}`;
}

function hasHistory(file) {
  return Array.isArray(file?.history) && file.history.length > 0;
}

function buildHistoryText(history = []) {
  return history
    .flatMap((item) => [item.code, item.lot, item.product, item.sku, item.url])
    .map(normalize)
    .filter(Boolean)
    .join(" ");
}

function buildSearchText(file, companyName, aliases = [], historyText = "") {
  return [
    companyName,
    ...aliases,
    file.code,
    file.lot,
    file.product,
    file.sku,
    file.url,
    historyText,
  ]
    .map(normalize)
    .filter(Boolean)
    .join(" ");
}

function getVisiblePages(currentPage, totalPages) {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  if (currentPage <= 3) return [1, 2, 3, 4, totalPages];
  if (currentPage >= totalPages - 2) {
    return [1, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, currentPage - 1, currentPage, currentPage + 1, totalPages];
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17L17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

function ChevronIcon({ open = false }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-4 w-4 transition-transform duration-300", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="13" cy="18" r="2" />
    </svg>
  );
}

function PaginationArrow({ direction = "next" }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-4 w-4", direction === "previous" && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

const Pagination = memo(function Pagination({
  currentPage,
  totalPages,
  totalResults,
  onPageChange,
}) {
  if (totalPages <= 1) return null;

  const visiblePages = getVisiblePages(currentPage, totalPages);

  return (
    <div className="mt-5 sm:mt-6 sm:flex sm:items-center sm:justify-between sm:gap-3">
      <p className="hidden text-xs font-semibold text-white/45 sm:block">
        Page {currentPage} of {totalPages} · {totalResults} results
      </p>

      <div className="grid grid-cols-[3rem_1fr_3rem] items-center gap-2 sm:flex sm:justify-end">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.035] text-white/60 transition hover:border-red-500/30 hover:text-white disabled:pointer-events-none disabled:opacity-30 sm:h-10 sm:w-10"
          aria-label="Previous page"
        >
          <PaginationArrow direction="previous" />
        </button>

        <div className="hidden items-center gap-1 sm:flex">
          {visiblePages.map((page, index) => {
            const previousPage = visiblePages[index - 1];
            const showGap = previousPage && page - previousPage > 1;

            return (
              <span key={page} className="flex items-center gap-1">
                {showGap && <span className="px-1 text-xs font-black text-white/25">…</span>}
                <button
                  type="button"
                  onClick={() => onPageChange(page)}
                  className={cn(
                    "h-10 min-w-10 rounded-xl px-3 text-xs font-black transition",
                    page === currentPage
                      ? "bg-red-600 text-white shadow-[0_10px_25px_rgba(220,38,38,0.3)]"
                      : "border border-white/10 bg-white/[0.035] text-white/55 hover:border-red-500/30 hover:text-white"
                  )}
                  aria-label={`Go to page ${page}`}
                  aria-current={page === currentPage ? "page" : undefined}
                >
                  {page}
                </button>
              </span>
            );
          })}
        </div>

        <p className="text-center text-xs font-bold text-white/55 sm:hidden">
          Page {currentPage} of {totalPages}
          <span className="mt-0.5 block text-[10px] font-semibold text-white/35">
            {totalResults} results
          </span>
        </p>

        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.035] text-white/60 transition hover:border-red-500/30 hover:text-white disabled:pointer-events-none disabled:opacity-30 sm:h-10 sm:w-10"
          aria-label="Next page"
        >
          <PaginationArrow />
        </button>
      </div>
    </div>
  );
});

function MetaValue({ label, value, mono = true }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[11px] font-bold uppercase tracking-wide text-white/40">
        {label}
      </span>
      <span className={cn("text-[13px] font-semibold text-white/80", mono && "font-mono")}>
        {value}
      </span>
    </span>
  );
}

const COACard = memo(function COACard({
  file,
  isHistoryOpen,
  fileHasHistory,
  historyKey,
  onToggleHistory,
}) {
  return (
    <article className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] shadow-[0_12px_35px_rgba(0,0,0,0.18)] transition hover:border-red-500/30">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 hidden h-10 w-10 shrink-0 place-items-center rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 sm:grid">
            <FileIcon />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="break-words text-base font-black tracking-[-0.01em] text-white">
                {file.product || file.code}
              </h3>
              {fileHasHistory && (
                <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold text-emerald-200">
                  {file.history.length} earlier {file.history.length === 1 ? "version" : "versions"}
                </span>
              )}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:flex sm:flex-wrap sm:items-baseline">
              <MetaValue label="Lot" value={file.lot} />
              <MetaValue label="Code" value={file.code} />
              <MetaValue label="SKU" value={file.sku} />
            </div>
          </div>
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3">
          {fileHasHistory && (
            <button
              type="button"
              onClick={() => onToggleHistory(historyKey)}
              aria-expanded={isHistoryOpen}
              className="inline-flex h-12 items-center justify-center gap-1.5 rounded-xl border border-white/10 px-3 text-xs font-bold text-white/65 transition hover:text-white sm:h-10 sm:border-transparent"
            >
              History
              <ChevronIcon open={isHistoryOpen} />
            </button>
          )}

          <a
            href={file.url}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-xs font-black uppercase tracking-wide text-white no-underline shadow-[0_10px_25px_rgba(220,38,38,0.25)] transition hover:bg-red-500 active:scale-[0.98] sm:h-10",
              !fileHasHistory && "col-span-2 sm:col-span-1"
            )}
          >
            Open certificate
            <ArrowIcon />
          </a>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {fileHasHistory && isHistoryOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
              opacity: { duration: 0.18, ease: "easeOut" },
            }}
            className="overflow-hidden border-t border-white/10 bg-black/20"
          >
            <div className="divide-y divide-white/[0.06] px-4 sm:px-5">
              {file.history.map((item) => (
                <div
                  key={`${item.code}-${item.lot || item.url}`}
                  className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <MetaValue label="Lot" value={item.lot} />
                    <MetaValue label="Code" value={item.code} />
                    <MetaValue label="SKU" value={item.sku} />
                  </div>

                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 w-fit shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-[11px] font-bold text-white/65 no-underline transition hover:border-red-500/30 hover:text-white"
                  >
                    Open PDF
                    <ArrowIcon />
                  </a>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
});

// A single "product" tile shown on the home/directory view.
const CategoryTile = memo(function CategoryTile({ label, count, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-left transition hover:border-red-500/30 hover:bg-white/[0.045]"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-black text-white">{label}</p>
        <p className="mt-1 text-xs font-semibold text-white/40">
          {count} {count === 1 ? "certificate" : "certificates"}
        </p>
      </div>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 text-white/40 transition group-hover:border-red-500/40 group-hover:text-red-300">
        <ArrowIcon />
      </span>
    </button>
  );
});

// The always-visible product list on desktop. On mobile, people use the
// search box's suggestion list instead (see below) to keep the page short.
const CategoryNav = memo(function CategoryNav({ items, activeId, onSelect }) {
  return (
    <nav
      aria-label="Products"
      className="hidden shrink-0 lg:sticky lg:top-24 lg:block lg:w-64"
    >
      <p className="px-3 pb-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/35">
        Products
      </p>

      <div className="max-h-[calc(100vh-9rem)] overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.02] p-1.5">
        <button
          type="button"
          onClick={() => onSelect(ALL_ID)}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition",
            activeId === ALL_ID
              ? "bg-red-600 text-white"
              : "text-white/65 hover:bg-white/[0.06] hover:text-white"
          )}
        >
          All products
          <span className={cn("text-xs font-bold tabular-nums", activeId === ALL_ID ? "text-white/80" : "text-white/35")}>
            {items.reduce((sum, item) => sum + item.count, 0)}
          </span>
        </button>

        <div className="mt-1 space-y-0.5">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition",
                activeId === item.id
                  ? "bg-red-600 text-white"
                  : "text-white/60 hover:bg-white/[0.06] hover:text-white"
              )}
            >
              <span className="min-w-0 truncate">{item.label}</span>
              <span className={cn("shrink-0 text-xs font-bold tabular-nums", activeId === item.id ? "text-white/80" : "text-white/35")}>
                {item.count}
              </span>
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
});

const MobileProductPicker = memo(function MobileProductPicker({
  open,
  items,
  activeId,
  onClose,
  onSelect,
}) {
  const [filter, setFilter] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setFilter("");
      return;
    }
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 250);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  const visibleItems = useMemo(() => {
    const search = normalize(filter);
    if (!search) return items;
    return items.filter((item) => normalize(item.label).includes(search));
  }, [filter, items]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[140] lg:hidden" role="dialog" aria-modal="true" aria-labelledby="mobile-product-picker-title">
          <motion.button
            type="button"
            aria-label="Close product list"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 h-full w-full bg-black/75 backdrop-blur-sm"
          />

          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-[1.75rem] border-t border-white/15 bg-[#090909] shadow-[0_-30px_80px_rgba(0,0,0,0.75)]"
          >
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/20" />

            <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-red-400">Product directory</p>
                <h2 id="mobile-product-picker-title" className="mt-1 text-xl font-black text-white">
                  Choose a product
                </h2>
                <p className="mt-1 text-xs text-white/45">{items.length} products available</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close product list"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/65"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="px-4 pb-3">
              <label className="relative block">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/35">
                  <SearchIcon />
                </span>
                <input
                  ref={inputRef}
                  type="search"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Filter products..."
                  className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.05] pl-11 pr-4 text-sm font-semibold text-white outline-none placeholder:text-white/30 focus:border-red-500/50"
                />
              </label>
            </div>

            <div className="overflow-y-auto overscroll-contain px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              {!filter && (
                <button
                  type="button"
                  onClick={() => onSelect(ALL_ID)}
                  className={cn(
                    "mb-2 flex min-h-14 w-full items-center justify-between rounded-xl border px-4 text-left text-sm font-black",
                    activeId === ALL_ID
                      ? "border-red-500 bg-red-600 text-white"
                      : "border-white/10 bg-white/[0.035] text-white"
                  )}
                >
                  Browse all products
                  <span className="text-xs font-bold text-white/55">{items.reduce((sum, item) => sum + item.count, 0)} COAs</span>
                </button>
              )}

              <div className="grid gap-2">
                {visibleItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item.id)}
                    className={cn(
                      "flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border px-4 text-left transition",
                      activeId === item.id
                        ? "border-red-500 bg-red-600 text-white"
                        : "border-white/10 bg-white/[0.035] text-white/80 active:bg-white/10"
                    )}
                  >
                    <span className="min-w-0 text-sm font-bold">{item.label}</span>
                    <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black", activeId === item.id ? "bg-black/20 text-white" : "bg-white/[0.06] text-white/40")}>{item.count}</span>
                  </button>
                ))}
              </div>

              {visibleItems.length === 0 && (
                <p className="py-10 text-center text-sm text-white/45">No matching products.</p>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
});

export default function COASection() {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(ALL_ID);
  const [openHistory, setOpenHistory] = useState({});
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [currentPage, setCurrentPage] = useState(1);
  const [mobileProductsOpen, setMobileProductsOpen] = useState(false);

  const deferredQuery = useDeferredValue(query);
  const searchWrapperRef = useRef(null);
  const resultsTopRef = useRef(null);
  const urlSyncTimer = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    const product = params.get("product");
    if (q) setQuery(q);
    else if (product) setSelectedCategory(product);
  }, []);

  useEffect(() => {
    if (!mobileProductsOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleEscape = (event) => {
      if (event.key === "Escape") setMobileProductsOpen(false);
    };
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [mobileProductsOpen]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(event.target)) {
        setSuggestionsOpen(false);
      }
    }
    function handleEscape(event) {
      if (event.key === "Escape") setSuggestionsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside, { passive: true });
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const allCoas = useMemo(() => {
    const companies = Array.isArray(coaData?.companies) ? coaData.companies : [];

    return companies.flatMap((company) => {
      const companyName = company?.name || "";
      const aliases = Array.isArray(company?.aliases) ? company.aliases : [];
      const files = Array.isArray(company?.files) ? company.files : [];

      return files.filter(Boolean).map((file) => {
        const history = Array.isArray(file.history) ? file.history.filter(Boolean) : [];
        const historyText = buildHistoryText(history);
        const key = getHistoryKey(file);

        return {
          ...file,
          key,
          history,
          company: companyName,
          aliases,
          searchText: buildSearchText(file, companyName, aliases, historyText),
        };
      });
    });
  }, []);

  const compoundCounts = useMemo(() => {
    const counts = new Map();
    allCoas.forEach((file) => {
      if (!file.product) return;
      counts.set(file.product, (counts.get(file.product) || 0) + 1);
    });
    return counts;
  }, [allCoas]);

  const compoundList = useMemo(() => {
    return [...compoundCounts.keys()].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );
  }, [compoundCounts]);

  const navItems = useMemo(
    () => compoundList.map((label) => ({ id: label, label, count: compoundCounts.get(label) })),
    [compoundList, compoundCounts]
  );

  const isSearching = deferredQuery.trim().length > 0;

  const suggestions = useMemo(() => {
    const search = normalize(deferredQuery);
    const filtered = search
      ? compoundList.filter((compound) => normalize(compound).includes(search))
      : compoundList;
    return filtered.slice(0, MAX_SUGGESTIONS);
  }, [compoundList, deferredQuery]);

  const searchResults = useMemo(() => {
    const search = normalize(deferredQuery);
    if (!search) return [];
    return allCoas.filter((file) => file.searchText.includes(search));
  }, [allCoas, deferredQuery]);

  const categoryResults = useMemo(() => {
    if (!selectedCategory) return [];
    const target = normalize(selectedCategory);
    return allCoas.filter((file) => normalize(file.product) === target);
  }, [allCoas, selectedCategory]);

  // What the main panel actually shows: a search overrides category
  // browsing; otherwise a chosen category filters to just its files;
  // otherwise it's the home directory (handled separately below).
  const activeList = isSearching ? searchResults : selectedCategory ? categoryResults : null;

  const totalPages = activeList ? Math.max(1, Math.ceil(activeList.length / COAS_PER_PAGE)) : 1;
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * COAS_PER_PAGE;
  const pageEnd = pageStart + COAS_PER_PAGE;
  const paginatedResults = activeList ? activeList.slice(pageStart, pageEnd) : [];

  useEffect(() => {
    setCurrentPage(1);
    setOpenHistory({});
  }, [deferredQuery, selectedCategory]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const updateUrl = useCallback((nextQuery, nextCategory) => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    else if (nextCategory) params.set("product", nextCategory);
    const nextUrl = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, "", nextUrl);
  }, []);

  useEffect(() => {
    clearTimeout(urlSyncTimer.current);
    urlSyncTimer.current = setTimeout(() => {
      updateUrl(deferredQuery, selectedCategory);
    }, URL_SYNC_DELAY);
    return () => clearTimeout(urlSyncTimer.current);
  }, [deferredQuery, selectedCategory, updateUrl]);

  const selectCategory = useCallback((id) => {
    setSelectedCategory(id);
    setQuery("");
    setSuggestionsOpen(false);
    setMobileProductsOpen(false);
    setActiveSuggestion(-1);
    window.requestAnimationFrame(() => {
      resultsTopRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }, []);

  const clearSearch = useCallback(() => {
    setQuery("");
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
  }, []);

  const toggleHistory = useCallback((historyKey) => {
    setOpenHistory((current) => ({
      ...current,
      [historyKey]: !current[historyKey],
    }));
  }, []);

  const handlePageChange = useCallback(
    (page) => {
      const nextPage = Math.min(Math.max(page, 1), totalPages);
      setCurrentPage(nextPage);
      setOpenHistory({});
      window.requestAnimationFrame(() => {
        resultsTopRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    },
    [totalPages]
  );

  const handleInputKeyDown = useCallback(
    (event) => {
      if (!suggestionsOpen || suggestions.length === 0) {
        if (event.key === "Escape") event.currentTarget.blur();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveSuggestion((current) => (current + 1) % suggestions.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveSuggestion((current) => (current - 1 + suggestions.length) % suggestions.length);
      } else if (event.key === "Enter" && activeSuggestion >= 0) {
        event.preventDefault();
        selectCategory(suggestions[activeSuggestion]);
      } else if (event.key === "Escape") {
        setSuggestionsOpen(false);
      }
    },
    [suggestionsOpen, suggestions, activeSuggestion, selectCategory]
  );

  const totalCoaCount = allCoas.length;
  const resultLabel = activeList && activeList.length === 1 ? "result" : "results";

  let panelTitle = "All products";
  let panelSubtitle = `${navItems.length} products · ${totalCoaCount} certificates`;
  if (isSearching) {
    panelTitle = `Results for "${query}"`;
    panelSubtitle = null;
  } else if (selectedCategory) {
    panelTitle = selectedCategory;
    panelSubtitle = null;
  }

  return (
    <section
      id="coa"
      className="relative w-full overflow-x-hidden bg-[#030303] px-3 pb-14 pt-[148px] text-white sm:px-4 sm:pb-16 sm:pt-[160px] lg:px-6 lg:pb-20 lg:pt-[180px]"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(220,38,38,0.13),transparent_34%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.022)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.022)_1px,transparent_1px)] bg-[size:44px_44px] opacity-[0.16] [mask-image:linear-gradient(to_bottom,black,transparent_72%)]" />
      <div className="pointer-events-none absolute left-1/2 top-[-120px] h-[320px] w-[82vw] max-w-[760px] -translate-x-1/2 rounded-full bg-red-600/10 blur-[110px]" />

      <div className="relative z-10 mx-auto w-full max-w-[1180px]">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto max-w-[760px] text-center"
        >
          <div className="mx-auto mb-3 inline-flex max-w-full items-center gap-2 rounded-full border border-red-500/25 bg-red-500/10 px-3 py-1.5 sm:mb-4 sm:px-4 sm:py-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500 shadow-[0_0_18px_rgba(239,68,68,0.7)]" />
            <span className="truncate text-[9px] font-black uppercase tracking-[0.16em] text-red-300 sm:text-[10px] sm:tracking-[0.22em]">
              Certificate Lookup
            </span>
          </div>

          <h1 className="text-[2.35rem] font-black uppercase leading-[0.92] tracking-[-0.06em] text-white xs:text-[2.7rem] sm:text-6xl lg:text-7xl">
            Find your COA
          </h1>

          <p className="mx-auto mt-3 max-w-[560px] text-sm leading-6 text-white/55 sm:mt-5 sm:text-base sm:leading-7">
            Search the product name, SKU, or lot number printed on your label.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto mt-6 w-full max-w-[620px] sm:mt-9"
        >
          <div ref={searchWrapperRef} className="relative">
            <label className="relative block">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/35">
                <SearchIcon />
              </span>

              <input
                type="text"
                value={query}
                role="combobox"
                aria-expanded={suggestionsOpen}
                aria-autocomplete="list"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSuggestionsOpen(true);
                  setActiveSuggestion(-1);
                }}
                onFocus={() => setSuggestionsOpen(true)}
                onKeyDown={handleInputKeyDown}
                placeholder="Product, SKU, or lot number"
                aria-label="Search certificates by product, SKU, or lot number"
                className="h-[3.75rem] w-full rounded-2xl border border-white/15 bg-white/[0.055] pl-12 pr-11 text-base font-semibold text-white shadow-[0_16px_45px_rgba(0,0,0,0.22)] outline-none transition placeholder:text-white/35 focus:border-red-500/60 focus:bg-white/[0.07] sm:h-14 sm:text-sm"
              />

              {query && (
                <button
                  type="button"
                  onClick={clearSearch}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-white/40 transition hover:bg-white/10 hover:text-white"
                >
                  <CloseIcon />
                </button>
              )}
            </label>

            {/* Mobile fallback for browsing products, since the sidebar is desktop-only */}
            <AnimatePresence>
              {suggestionsOpen && query.trim() && suggestions.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                  role="listbox"
                  className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-2xl border border-white/10 bg-[#080808]/95 shadow-[0_24px_70px_rgba(0,0,0,0.65)] backdrop-blur-xl lg:hidden"
                >
                  <p className="border-b border-white/10 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.14em] text-white/35">
                    Matching products
                  </p>

                  <div className="max-h-[280px] overflow-y-auto p-1.5">
                    {suggestions.map((compound, index) => (
                      <button
                        key={compound}
                        type="button"
                        role="option"
                        aria-selected={index === activeSuggestion}
                        onMouseEnter={() => setActiveSuggestion(index)}
                        onClick={() => selectCategory(compound)}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition",
                          index === activeSuggestion
                            ? "bg-red-600 text-white"
                            : "text-white/70 hover:bg-white/[0.06] hover:text-white"
                        )}
                      >
                        <span className="min-w-0 truncate">{compound}</span>
                        <span className={cn("shrink-0 text-xs font-bold tabular-nums", index === activeSuggestion ? "text-white/80" : "text-white/35")}>
                          {compoundCounts.get(compound)}
                        </span>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            type="button"
            onClick={() => {
              setSuggestionsOpen(false);
              setMobileProductsOpen(true);
            }}
            className="mt-3 flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.035] px-4 text-left text-sm font-bold text-white transition active:bg-white/10 lg:hidden"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-600/15 text-red-300">
                <SlidersIcon />
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] font-black uppercase tracking-[0.12em] text-white/35">Browse directory</span>
                <span className="mt-0.5 block truncate">
                  {selectedCategory || `All ${navItems.length} products`}
                </span>
              </span>
            </span>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 text-white/55">
              <ChevronIcon />
            </span>
          </button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.14, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto mt-7 flex w-full flex-col gap-6 sm:mt-12 lg:flex-row lg:items-start"
        >
          <CategoryNav items={navItems} activeId={isSearching ? null : selectedCategory} onSelect={selectCategory} />

          <div ref={resultsTopRef} className="min-w-0 flex-1 scroll-mt-24">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                {!isSearching && selectedCategory && (
                  <button
                    type="button"
                    onClick={() => selectCategory(ALL_ID)}
                    className="mb-1.5 inline-flex items-center gap-1 text-xs font-bold text-white/45 transition hover:text-white"
                  >
                    <ChevronLeftIcon />
                    All products
                  </button>
                )}
                <h2 className="break-words text-xl font-black tracking-[-0.02em] text-white sm:text-2xl">
                  {panelTitle}
                </h2>
                {panelSubtitle && (
                  <p className="mt-1 text-xs font-semibold text-white/40">{panelSubtitle}</p>
                )}
              </div>

              {activeList && (
                <span className="rounded-full border border-white/10 bg-white/[0.035] px-3.5 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-white/50">
                  {activeList.length} {resultLabel}
                </span>
              )}
            </div>

            {activeList ? (
              activeList.length > 0 ? (
                <>
                  <div className="grid gap-3">
                    {paginatedResults.map((file) => {
                      const historyKey = file.key || getHistoryKey(file);
                      const fileHasHistory = hasHistory(file);

                      return (
                        <COACard
                          key={historyKey}
                          file={file}
                          historyKey={historyKey}
                          fileHasHistory={fileHasHistory}
                          isHistoryOpen={Boolean(openHistory[historyKey])}
                          onToggleHistory={toggleHistory}
                        />
                      );
                    })}
                  </div>

                  <Pagination
                    currentPage={safeCurrentPage}
                    totalPages={totalPages}
                    totalResults={activeList.length}
                    onPageChange={handlePageChange}
                  />
                </>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-6 text-center sm:p-7">
                  <h3 className="text-lg font-black text-white">No certificates found</h3>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/50">
                    Check the spelling, or search using the exact product name, SKU, or lot
                    number printed on the packaging.
                  </p>
                </div>
              )
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {navItems.map((item) => (
                  <CategoryTile
                    key={item.id}
                    label={item.label}
                    count={item.count}
                    onSelect={() => selectCategory(item.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </div>

      <MobileProductPicker
        open={mobileProductsOpen}
        items={navItems}
        activeId={isSearching ? null : selectedCategory}
        onClose={() => setMobileProductsOpen(false)}
        onSelect={selectCategory}
      />
    </section>
  );
}
