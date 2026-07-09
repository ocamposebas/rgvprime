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

const steps = [
  {
    number: "01",
    title: "Search",
    text: "Use a product name, SKU, or lot number.",
  },
  {
    number: "02",
    title: "Match",
    text: "Find the certificate connected to your product.",
  },
  {
    number: "03",
    title: "Verify",
    text: "Open the COA and review the available details.",
  },
];

const COAS_PER_PAGE = 8;
const MAX_COMPOUND_OPTIONS = 120;

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

function FileIcon() {
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
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
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

function HistoryIcon({ open = false }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("h-4 w-4 transition-transform duration-300", open && "rotate-180")}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function SelectIcon() {
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
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function PaginationArrow({ direction = "next" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("h-4 w-4", direction === "previous" && "rotate-180")}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

const StepCard = memo(function StepCard({ step }) {
  return (
    <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.025] p-4 text-center transition-colors hover:bg-white/[0.05] sm:p-5">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-400">
        {step.number}
      </p>

      <h3 className="mt-3 text-sm font-black uppercase tracking-[0.12em] text-white">
        {step.title}
      </h3>

      <p className="mx-auto mt-2 max-w-[220px] text-sm leading-6 text-white/45">
        {step.text}
      </p>
    </div>
  );
});

const Pagination = memo(function Pagination({
  currentPage,
  totalPages,
  totalResults,
  onPageChange,
}) {
  if (totalPages <= 1) return null;

  const visiblePages = getVisiblePages(currentPage, totalPages);
  const hasLeftGap = visiblePages[1] && visiblePages[1] > 2;
  const hasRightGap =
    visiblePages[visiblePages.length - 2] &&
    visiblePages[visiblePages.length - 2] < totalPages - 1;

  return (
    <div className="mt-5 rounded-[1.35rem] border border-white/10 bg-white/[0.025] p-3 shadow-[0_18px_55px_rgba(0,0,0,0.22)] sm:mt-6 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-red-300">
            Page {currentPage} of {totalPages}
          </p>

          <p className="mt-1 text-xs font-semibold text-white/38">
            Showing {COAS_PER_PAGE} per page · {totalResults} total results
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <button
            type="button"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className="inline-flex h-10 min-w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.035] px-3 text-white/60 transition hover:border-red-500/30 hover:text-white disabled:pointer-events-none disabled:opacity-35"
            aria-label="Previous page"
          >
            <PaginationArrow direction="previous" />
          </button>

          <div className="flex min-w-0 items-center gap-1 overflow-x-auto px-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {visiblePages.map((page, index) => {
              const previousPage = visiblePages[index - 1];
              const shouldShowGap =
                (page === totalPages && hasRightGap) || (page !== 1 && previousPage && page - previousPage > 1);

              return (
                <span key={page} className="flex items-center gap-1">
                  {shouldShowGap && (
                    <span className="px-1 text-[10px] font-black text-white/25">
                      ...
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => onPageChange(page)}
                    className={cn(
                      "h-10 min-w-10 rounded-xl px-3 text-[10px] font-black uppercase tracking-[0.1em] transition",
                      page === currentPage
                        ? "bg-red-600 text-white shadow-[0_14px_35px_rgba(220,38,38,0.25)]"
                        : "border border-white/10 bg-white/[0.035] text-white/50 hover:border-red-500/30 hover:text-white"
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

          <button
            type="button"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="inline-flex h-10 min-w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.035] px-3 text-white/60 transition hover:border-red-500/30 hover:text-white disabled:pointer-events-none disabled:opacity-35"
            aria-label="Next page"
          >
            <PaginationArrow />
          </button>
        </div>
      </div>
    </div>
  );
});

const COACard = memo(function COACard({
  file,
  isHistoryOpen,
  fileHasHistory,
  historyKey,
  onToggleHistory,
}) {
  return (
    <div className="group min-w-0 overflow-hidden rounded-[1.35rem] border border-white/10 bg-white/[0.025] transition hover:border-red-500/35 hover:bg-white/[0.045]">
      <div className="grid min-w-0 gap-4 p-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 hidden h-10 w-10 shrink-0 place-items-center rounded-2xl border border-red-500/20 bg-red-500/10 text-red-300 sm:grid">
              <FileIcon />
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="break-words text-base font-black tracking-[-0.02em] text-white">
                  {file.product || file.code}
                </h3>

                {fileHasHistory && (
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[8px] font-black uppercase tracking-[0.12em] text-emerald-200">
                    History available
                  </span>
                )}
              </div>

              <div className="mt-2 flex max-w-full flex-wrap gap-1.5">
                {file.lot && (
                  <span className="max-w-full truncate rounded-full bg-white/[0.05] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-white/45 sm:px-3 sm:text-[10px]">
                    Lot: {file.lot}
                  </span>
                )}

                {file.code && (
                  <span className="max-w-full truncate rounded-full bg-white/[0.05] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-white/45 sm:px-3 sm:text-[10px]">
                    Code: {file.code}
                  </span>
                )}

                {file.sku && (
                  <span className="max-w-full truncate rounded-full bg-white/[0.05] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-white/45 sm:px-3 sm:text-[10px]">
                    SKU: {file.sku}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-2 sm:min-w-[160px]">
          <a
            href={file.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-red-600 px-5 text-[10px] font-black uppercase tracking-[0.14em] text-white no-underline shadow-[0_16px_38px_rgba(220,38,38,0.22)] transition hover:bg-red-500 active:scale-[0.98]"
          >
            Open PDF
            <ArrowIcon />
          </a>

          {fileHasHistory && (
            <button
              type="button"
              onClick={() => onToggleHistory(historyKey)}
              aria-expanded={isHistoryOpen}
              className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.08] px-5 text-[10px] font-black uppercase tracking-[0.14em] text-red-100 transition hover:border-red-500/45 hover:bg-red-500/[0.14] hover:text-white active:scale-[0.98]"
            >
              {isHistoryOpen ? "Hide history" : "View history"}
              <HistoryIcon open={isHistoryOpen} />
            </button>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {fileHasHistory && isHistoryOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0, y: -6 }}
            animate={{ height: "auto", opacity: 1, y: 0 }}
            exit={{ height: 0, opacity: 0, y: -6 }}
            transition={{
              height: { duration: 0.34, ease: [0.16, 1, 0.3, 1] },
              opacity: { duration: 0.22, ease: "easeOut" },
              y: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
            }}
            className="overflow-hidden will-change-[height,opacity,transform]"
          >
            <div className="mt-2 border-t border-red-500/10 bg-black/20 p-4 sm:p-5">
              <p className="mb-4 text-[10px] font-black uppercase tracking-[0.16em] text-red-200/70">
                Previous Certificates
              </p>

              <div className="grid gap-3">
                {file.history.map((item) => (
                  <div
                    key={`${item.code}-${item.lot || item.url}`}
                    className="grid gap-3.5 rounded-2xl border border-white/10 bg-white/[0.035] p-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-4"
                  >
                    <div className="min-w-0">
                      <h4 className="break-words text-sm font-black text-white/90">
                        {item.product || file.product || item.code}
                      </h4>

                      <div className="mt-2 flex max-w-full flex-wrap gap-1.5">
                        {item.lot && (
                          <span className="max-w-full truncate rounded-full bg-white/[0.05] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-white/40">
                            Lot: {item.lot}
                          </span>
                        )}

                        {item.code && (
                          <span className="max-w-full truncate rounded-full bg-white/[0.05] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-white/40">
                            Code: {item.code}
                          </span>
                        )}

                        {item.sku && (
                          <span className="max-w-full truncate rounded-full bg-white/[0.05] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-white/40">
                            SKU: {item.sku}
                          </span>
                        )}
                      </div>
                    </div>

                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-4 text-[9px] font-black uppercase tracking-[0.13em] text-red-100 no-underline transition hover:border-red-500/45 hover:bg-red-500/15 hover:text-white active:scale-[0.98] sm:w-auto"
                    >
                      Open old PDF
                      <ArrowIcon />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

export default function COASection() {
  const [query, setQuery] = useState("");
  const [openHistory, setOpenHistory] = useState({});
  const [compoundOpen, setCompoundOpen] = useState(false);
  const [compoundSearch, setCompoundSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const deferredQuery = useDeferredValue(query);
  const deferredCompoundSearch = useDeferredValue(compoundSearch);
  const compoundRef = useRef(null);
  const resultsTopRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");

    if (q) setQuery(q);
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (compoundRef.current && !compoundRef.current.contains(event.target)) {
        setCompoundOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") setCompoundOpen(false);
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

      return files
        .filter(Boolean)
        .map((file) => {
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
            historyCount: history.length,
          };
        });
    });
  }, []);

  const compoundFilters = useMemo(() => {
    const products = allCoas.map((file) => file.product).filter(Boolean);

    return [...new Set(products)].sort((a, b) =>
      a.localeCompare(b, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
  }, [allCoas]);

  const selectedCompound = useMemo(() => {
    const cleanQuery = normalize(query);

    return compoundFilters.find((compound) => normalize(compound) === cleanQuery) || "";
  }, [compoundFilters, query]);

  const visibleCompoundFilters = useMemo(() => {
    const search = normalize(deferredCompoundSearch);
    const filtered = search
      ? compoundFilters.filter((compound) => normalize(compound).includes(search))
      : compoundFilters;

    return filtered.slice(0, MAX_COMPOUND_OPTIONS);
  }, [compoundFilters, deferredCompoundSearch]);

  const filteredCoas = useMemo(() => {
    const search = normalize(deferredQuery);

    if (!search) return allCoas;

    return allCoas.filter((file) => file.searchText.includes(search));
  }, [allCoas, deferredQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredCoas.length / COAS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * COAS_PER_PAGE;
  const pageEnd = pageStart + COAS_PER_PAGE;

  const paginatedCoas = useMemo(() => {
    return filteredCoas.slice(pageStart, pageEnd);
  }, [filteredCoas, pageStart, pageEnd]);

  const resultLabel = filteredCoas.length === 1 ? "result" : "results";
  const showClear = query.trim().length > 0;

  useEffect(() => {
    setCurrentPage(1);
    setOpenHistory({});
  }, [deferredQuery]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const updateUrlQuery = useCallback((value) => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const cleanValue = value.trim();

    if (cleanValue) {
      params.set("q", cleanValue);
    } else {
      params.delete("q");
    }

    const nextUrl = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;

    window.history.replaceState({}, "", nextUrl);
  }, []);

  const handleSubmit = useCallback(
    (event) => {
      event.preventDefault();
      updateUrlQuery(query);
    },
    [query, updateUrlQuery]
  );

  const handleCompoundSelect = useCallback(
    (value) => {
      setQuery(value);
      updateUrlQuery(value);
      setCompoundOpen(false);
      setCompoundSearch("");
    },
    [updateUrlQuery]
  );

  const clearSearch = useCallback(() => {
    setQuery("");
    updateUrlQuery("");
    setCompoundSearch("");
    setCompoundOpen(false);
  }, [updateUrlQuery]);

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
        resultsTopRef.current?.scrollIntoView({
          block: "start",
          behavior: "smooth",
        });
      });
    },
    [totalPages]
  );

  return (
    <section
      id="coa"
      className="relative w-full overflow-x-hidden bg-[#030303] px-3 pb-14 pt-[108px] text-white sm:px-4 sm:pb-16 sm:pt-[118px] lg:px-6 lg:pb-20 lg:pt-[132px]"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(220,38,38,0.13),transparent_34%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.022)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.022)_1px,transparent_1px)] bg-[size:44px_44px] opacity-[0.16] [mask-image:linear-gradient(to_bottom,black,transparent_72%)]" />
      <div className="pointer-events-none absolute left-1/2 top-[-120px] h-[320px] w-[82vw] max-w-[760px] -translate-x-1/2 rounded-full bg-red-600/10 blur-[110px]" />

      <div className="relative z-10 mx-auto w-full max-w-[1080px]">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto max-w-[760px] text-center"
        >
          <div className="mx-auto mb-4 inline-flex max-w-full items-center gap-2 rounded-full border border-red-500/25 bg-red-500/10 px-3 py-1.5 sm:px-4 sm:py-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500 shadow-[0_0_18px_rgba(239,68,68,0.7)]" />
            <span className="truncate text-[9px] font-black uppercase tracking-[0.16em] text-red-300 sm:text-[10px] sm:tracking-[0.22em]">
              Certificate Lookup
            </span>
          </div>

          <h1 className="text-[2.4rem] font-black uppercase leading-[0.88] tracking-[-0.07em] text-white xs:text-[2.7rem] sm:text-6xl lg:text-7xl">
            COA Lookup
          </h1>

          <p className="mx-auto mt-4 max-w-[560px] text-sm leading-6 text-white/55 sm:mt-5 sm:text-base sm:leading-7">
            Find available Certificates of Analysis by product name, SKU, or lot number.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: 0.08,
            duration: 0.5,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="mx-auto mt-7 w-full max-w-[760px] sm:mt-9"
        >
          <div className="relative rounded-[1.6rem] border border-white/10 bg-white/[0.035] p-2.5 shadow-[0_22px_70px_rgba(0,0,0,0.38)] backdrop-blur sm:rounded-[1.8rem] sm:p-3">
            <form onSubmit={handleSubmit}>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
                <label className="relative block min-w-0">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/35">
                    <SearchIcon />
                  </span>

                  <input
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search product, SKU, or lot..."
                    className="h-12 w-full min-w-0 rounded-[1.15rem] border border-white/0 bg-black/25 pl-11 pr-4 text-sm font-semibold text-white outline-none transition placeholder:text-white/30 focus:border-red-500/35 focus:bg-white/[0.035] sm:h-14 sm:rounded-[1.25rem]"
                  />
                </label>

                <button
                  type="submit"
                  className="h-12 rounded-[1.15rem] bg-red-600 px-5 text-[10px] font-black uppercase tracking-[0.16em] text-white transition hover:bg-red-500 active:scale-[0.98] sm:h-14 sm:rounded-[1.25rem]"
                >
                  Search
                </button>
              </div>
            </form>

            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div ref={compoundRef} className="relative z-40 min-w-0">
                <button
                  type="button"
                  onClick={() => setCompoundOpen((current) => !current)}
                  aria-expanded={compoundOpen}
                  className="flex h-11 w-full items-center justify-between gap-3 rounded-[1.05rem] border border-white/10 bg-black/20 px-4 text-left text-xs font-black uppercase tracking-[0.1em] text-white/60 outline-none transition hover:border-red-500/25 hover:text-white focus:border-red-500/35"
                >
                  <span className="min-w-0 truncate">
                    {selectedCompound || "Browse by compound"}
                  </span>

                  <span
                    className={cn(
                      "shrink-0 text-white/30 transition-transform duration-300",
                      compoundOpen && "rotate-180"
                    )}
                  >
                    <SelectIcon />
                  </span>
                </button>

                <AnimatePresence>
                  {compoundOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.98 }}
                      transition={{
                        duration: 0.14,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-[1.15rem] border border-white/10 bg-[#080808]/95 shadow-[0_24px_70px_rgba(0,0,0,0.65)] backdrop-blur-xl"
                    >
                      <div className="border-b border-white/10 p-2">
                        <input
                          type="text"
                          value={compoundSearch}
                          onChange={(event) => setCompoundSearch(event.target.value)}
                          placeholder="Search compound..."
                          className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.035] px-3 text-xs font-semibold text-white outline-none transition placeholder:text-white/30 focus:border-red-500/35"
                        />
                      </div>

                      <div className="max-h-[260px] overflow-y-auto p-2 [scrollbar-color:rgba(239,68,68,0.45)_rgba(255,255,255,0.06)] [scrollbar-width:thin]">
                        <button
                          type="button"
                          onClick={() => handleCompoundSelect("")}
                          className={cn(
                            "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.12em] transition",
                            !query
                              ? "bg-red-600 text-white"
                              : "text-white/55 hover:bg-white/[0.055] hover:text-white"
                          )}
                        >
                          All COAs
                        </button>

                        {visibleCompoundFilters.length > 0 ? (
                          visibleCompoundFilters.map((compound) => {
                            const isActive =
                              normalize(selectedCompound) === normalize(compound);

                            return (
                              <button
                                key={compound}
                                type="button"
                                onClick={() => handleCompoundSelect(compound)}
                                className={cn(
                                  "mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.12em] transition",
                                  isActive
                                    ? "bg-red-600 text-white"
                                    : "text-white/55 hover:bg-white/[0.055] hover:text-white"
                                )}
                              >
                                <span className="min-w-0 truncate">{compound}</span>

                                {isActive && (
                                  <span className="ml-3 h-1.5 w-1.5 shrink-0 rounded-full bg-white" />
                                )}
                              </button>
                            );
                          })
                        ) : (
                          <div className="px-3 py-5 text-center text-xs font-semibold text-white/35">
                            No compounds found.
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {showClear && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="h-11 rounded-[1.05rem] border border-white/10 bg-white/[0.035] px-4 text-[10px] font-black uppercase tracking-[0.13em] text-white/45 transition hover:border-red-500/30 hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </motion.div>

        <motion.div
          ref={resultsTopRef}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: 0.14,
            duration: 0.5,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="scroll-mt-24 mx-auto mt-9 w-full max-w-[900px] sm:mt-12"
        >
          <div className="mb-4 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-300">
                Available Certificates
              </p>

              <h2 className="mt-2 break-words text-xl font-black tracking-[-0.04em] text-white sm:text-2xl">
                {query ? `Results for "${query}"` : "All COAs"}
              </h2>

              {filteredCoas.length > 0 && (
                <p className="mt-1 text-xs font-semibold text-white/35">
                  Showing {pageStart + 1}-{Math.min(pageEnd, filteredCoas.length)} of{" "}
                  {filteredCoas.length}
                </p>
              )}
            </div>

            <span className="w-fit rounded-full border border-white/10 bg-white/[0.035] px-3.5 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-white/50">
              {filteredCoas.length} {resultLabel}
            </span>
          </div>

          {filteredCoas.length > 0 ? (
            <>
              <div className="grid gap-3">
                {paginatedCoas.map((file) => {
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
                totalResults={filteredCoas.length}
                onPageChange={handlePageChange}
              />
            </>
          ) : (
            <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.025] p-6 text-center sm:p-7">
              <h3 className="text-lg font-black text-white">No COAs found</h3>

              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/45">
                Try searching by the exact product name, SKU, or lot number printed on the
                vial or packaging.
              </p>
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: 0.2,
            duration: 0.5,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="mx-auto mt-10 grid w-full max-w-[900px] gap-3 sm:mt-14 sm:grid-cols-3"
        >
          {steps.map((step) => (
            <StepCard key={step.number} step={step} />
          ))}
        </motion.div>
      </div>
    </section>
  );
}
