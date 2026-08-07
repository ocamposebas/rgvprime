import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence, useDragControls } from "motion/react";

const COAS_PER_PAGE = 8;
const MAX_SUGGESTIONS = 8;
const URL_SYNC_DELAY = 400;
const ALL_ID = "";
const RECENT_COAS_STORAGE_KEY = "rgvprime_recent_coas_v1";

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

function normalizeProductOrderValue(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCustomProductPriority(label) {
  const value = normalizeProductOrderValue(label);
  if (!value) return Number.POSITIVE_INFINITY;

  const matchIndex = customProductOrder.findIndex((entry) => {
    if (Array.isArray(entry.groups) && entry.groups.length > 0) {
      return entry.groups.some((group) =>
        group.every((term) => value.includes(normalizeProductOrderValue(term)))
      );
    }

    if (Array.isArray(entry.terms) && entry.terms.length > 0) {
      return entry.terms.some((term) => {
        const cleanTerm = normalizeProductOrderValue(term);
        return cleanTerm && (value === cleanTerm || value.includes(cleanTerm));
      });
    }

    return false;
  });

  if (matchIndex < 0) return Number.POSITIVE_INFINITY;

  const explicitRank = Number(customProductOrder[matchIndex]?.rank);
  return Number.isFinite(explicitRank) ? explicitRank : matchIndex + 1;
}

function compareProductsByCustomOrder(a, b) {
  const priorityA = getCustomProductPriority(a);
  const priorityB = getCustomProductPriority(b);

  if (priorityA !== priorityB) return priorityA - priorityB;

  return String(a || "").localeCompare(String(b || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function getHistoryKey(file) {
  return `${file?.code || "coa"}-${file?.lot || file?.url || "history"}`;
}

function getEarlierCoas(file) {
  return Array.isArray(file?.history) ? file.history.filter(Boolean) : [];
}

function hasHistory(file) {
  return getEarlierCoas(file).length > 0;
}

function buildHistoryText(history = []) {
  return (Array.isArray(history) ? history : [])
    .filter(Boolean)
    .flatMap((item) => [item.code, item.lot, item.product, item.sku, item.url, item.purity])
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

function matchesSearchText(searchText = "", query = "") {
  const search = normalize(query);
  if (!search) return false;

  const haystack = normalize(searchText);
  const tokens = search.split(/\s+/).filter(Boolean);

  return tokens.every((token) => haystack.includes(token));
}

function normalizeExactLookup(value = "") {
  return normalize(value)
    .replace(/^(lot|sku|code)\s*[:#-]?\s*/i, "")
    .trim();
}

function findExactCertificateMatch(files = [], query = "") {
  const search = normalizeExactLookup(query);
  if (!search) return null;

  for (const file of files) {
    const currentFields = [
      ["lot", file?.lot],
      ["sku", file?.sku],
      ["code", file?.code],
    ];

    for (const [field, value] of currentFields) {
      if (normalizeExactLookup(value) === search) {
        return {
          file,
          versionIndex: 0,
          field,
          value,
          certificate: file,
        };
      }
    }

    const history = getEarlierCoas(file);
    for (let index = 0; index < history.length; index += 1) {
      const item = history[index];
      const historicalFields = [
        ["lot", item?.lot],
        ["sku", item?.sku],
        ["code", item?.code],
      ];

      for (const [field, value] of historicalFields) {
        if (normalizeExactLookup(value) === search) {
          return {
            file,
            versionIndex: index + 1,
            field,
            value,
            certificate: { ...file, ...item },
          };
        }
      }
    }
  }

  return null;
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightText({ text, query, className = "" }) {
  const value = String(text || "");
  const cleanQuery = normalizeExactLookup(query);
  if (!value || !cleanQuery) return <span className={className}>{value}</span>;

  const tokens = cleanQuery
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  if (!tokens.length) return <span className={className}>{value}</span>;

  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "ig");
  const parts = value.split(pattern);

  return (
    <span className={className}>
      {parts.map((part, index) => {
        const isMatch = tokens.some((token) => normalize(part) === normalize(token));
        return isMatch ? (
          <mark
            key={`${part}-${index}`}
            className="rounded bg-red-500/20 px-0.5 text-red-100 ring-1 ring-inset ring-red-400/20"
          >
            {part}
          </mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        );
      })}
    </span>
  );
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

function MetaValue({ label, value, mono = true, highlightQuery = "" }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[11px] font-bold uppercase tracking-wide text-white/40">
        {label}
      </span>
      <span className={cn("text-[13px] font-semibold text-white/80", mono && "font-mono")}>
        <HighlightText text={value} query={highlightQuery} />
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
  onOpen,
  highlightQuery = "",
}) {
  const earlierCoas = getEarlierCoas(file);

  return (
    <article className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] shadow-[0_12px_35px_rgba(0,0,0,0.18)] transition hover:border-red-500/30 sm:hover:-translate-y-0.5">
      <button
        type="button"
        onClick={() => onOpen?.(file)}
        className="absolute inset-0 z-20 sm:hidden"
        aria-label={`Open ${file.product || file.code || "COA"}`}
      >
        <span className="sr-only">Open COA</span>
      </button>

      <div className="flex min-h-[104px] flex-col gap-3 p-4 sm:min-h-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 hidden h-10 w-10 shrink-0 place-items-center rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 sm:grid">
            <FileIcon />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="break-words text-base font-black tracking-[-0.01em] text-white">
                <HighlightText text={file.product || file.code} query={highlightQuery} />
              </h3>
              <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] text-emerald-200">
                Latest
              </span>
              {fileHasHistory && (
                <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold text-emerald-200">
                  {earlierCoas.length} Earlier COA{earlierCoas.length === 1 ? "" : "s"}
                </span>
              )}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:flex sm:flex-wrap sm:items-baseline">
              <MetaValue label="Lot" value={file.lot} highlightQuery={highlightQuery} />
              <MetaValue label="Code" value={file.code} highlightQuery={highlightQuery} />
              <MetaValue label="SKU" value={file.sku} highlightQuery={highlightQuery} />
              <MetaValue label="Purity" value={file.purity} mono={false} highlightQuery={highlightQuery} />
              <MetaValue label="Content" value={file.quantity} mono={false} highlightQuery={highlightQuery} />
            </div>
          </div>

          <span className="pointer-events-none flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-red-500/25 bg-red-500/10 text-red-300 shadow-[0_10px_28px_rgba(220,38,38,0.12)] transition group-active:scale-95 group-active:bg-red-600 group-active:text-white sm:hidden">
            <ArrowIcon />
          </span>
        </div>

        <div className="hidden shrink-0 grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3">
          {fileHasHistory && (
            <button
              type="button"
              onClick={() => onToggleHistory(historyKey)}
              aria-expanded={isHistoryOpen}
              className="hidden h-10 items-center justify-center gap-1.5 rounded-xl border border-transparent px-3 text-xs font-bold text-white/65 transition hover:border-white/10 hover:text-white sm:inline-flex"
            >
              Earlier COAs
              <ChevronIcon open={isHistoryOpen} />
            </button>
          )}

          <button
            type="button"
            onClick={() => onOpen?.(file)}
            className={cn(
              "inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-red-600 px-5 text-xs font-black uppercase tracking-wide text-white shadow-[0_10px_25px_rgba(220,38,38,0.25)] transition hover:-translate-y-0.5 hover:bg-red-500 active:translate-y-0 active:scale-[0.98] sm:h-11",
              "col-span-2 sm:col-span-1"
            )}
          >
            View COA
            <ArrowIcon />
          </button>
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
            className="hidden overflow-hidden border-t border-white/10 bg-black/20 sm:block"
          >
            <div className="divide-y divide-white/[0.06] px-4 sm:px-5">
              {earlierCoas.map((item, index) => (
                <div
                  key={`${item.code || "coa"}-${item.lot || item.url || index}`}
                  className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <MetaValue label="Lot" value={item.lot} highlightQuery={highlightQuery} />
                    <MetaValue label="Code" value={item.code} highlightQuery={highlightQuery} />
                    <MetaValue label="SKU" value={item.sku} highlightQuery={highlightQuery} />
                    <MetaValue label="Purity" value={item.purity} mono={false} highlightQuery={highlightQuery} />
                  </div>

                  <button
                    type="button"
                    onClick={() => onOpen?.(file, index + 1)}
                    className="inline-flex h-10 w-fit shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-[11px] font-bold text-white/65 transition hover:border-red-500/30 hover:bg-white/[0.04] hover:text-white"
                  >
                    View COA
                    <ArrowIcon />
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
});

const COAViewer = memo(function COAViewer({ file, versionIndex = 0, onVersionChange, onClose }) {
  const [earlierOpen, setEarlierOpen] = useState(false);
  const [copiedLot, setCopiedLot] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const dragControls = useDragControls();

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobileViewport(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (!file || typeof document === "undefined") return undefined;

    const previousOverflow = document.body.style.overflow;
    const shouldLockPage = typeof window !== "undefined" && window.innerWidth < 1024;
    if (shouldLockPage) document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      if (shouldLockPage) document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [file, onClose]);

  const versions = useMemo(() => {
    if (!file) return [];

    const current = {
      ...file,
      isHistorical: false,
      versionLabel: "Latest COA",
    };

    const earlierVersions = getEarlierCoas(file).map((item, index) => ({
      ...file,
      ...item,
      history: file.history,
      product: item.product || file.product,
      company: file.company,
      isHistorical: true,
      versionLabel: `Earlier COA ${index + 1}`,
    }));

    return [current, ...earlierVersions];
  }, [file]);

  const safeVersionIndex = Math.min(
    Math.max(Number(versionIndex) || 0, 0),
    Math.max(versions.length - 1, 0)
  );

  useEffect(() => {
    if (!file) {
      setEarlierOpen(false);
      return;
    }
    setEarlierOpen(safeVersionIndex > 0);
  }, [file, safeVersionIndex]);

  useEffect(() => {
    setCopiedLot(false);
  }, [file, safeVersionIndex]);

  if (!file) return null;

  const activeFile = versions[safeVersionIndex] || file;
  const earlierVersions = versions.slice(1);
  const pdfUrl = String(activeFile?.url || "").trim();
  const viewerUrl = pdfUrl
    ? `${pdfUrl}${pdfUrl.includes("#") ? "&" : "#"}view=FitH&toolbar=1&navpanes=0`
    : "";
  const hasEarlier = earlierVersions.length > 0;
  const viewingEarlier = safeVersionIndex > 0;

  const showLatest = () => {
    onVersionChange?.(0);
    setEarlierOpen(false);
  };

  const toggleEarlier = () => {
    setEarlierOpen((open) => !open);
  };

  const showEarlier = (index) => {
    onVersionChange?.(index + 1);
    setEarlierOpen(true);
  };

  const copyLot = async () => {
    const lot = String(activeFile?.lot || "").trim();
    if (!lot || typeof navigator === "undefined") return;
    try {
      await navigator.clipboard?.writeText(lot);
      setCopiedLot(true);
      window.setTimeout(() => setCopiedLot(false), 1400);
    } catch {
      setCopiedLot(false);
    }
  };

  const certificateDate =
    activeFile?.date || activeFile?.test_date || activeFile?.testDate || activeFile?.created_at || "";

  return (
    <AnimatePresence>
      <motion.div
        key={file.key || file.url || file.code || file.lot}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.14 }}
        className="fixed inset-0 z-[220] bg-black/70 backdrop-blur-[3px] lg:bg-black/25 lg:backdrop-blur-[2px]"
        role="dialog"
        aria-modal="true"
        aria-label={`COA viewer for ${file.product || file.code || "certificate"}`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close COA viewer"
          className="absolute inset-0 h-full w-full cursor-default"
        />

        <motion.div
          initial={{ y: 36, opacity: 0, scale: 0.985 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 24, opacity: 0, scale: 0.99 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          drag={isMobileViewport ? "y" : false}
          dragControls={dragControls}
          dragListener={false}
          dragConstraints={isMobileViewport ? { top: 0, bottom: 720 } : { top: 0, bottom: 0 }}
          dragElastic={isMobileViewport ? 0.04 : 0}
          dragMomentum={false}
          dragSnapToOrigin={isMobileViewport}
          onDragEnd={(_, info) => {
            if (isMobileViewport && (info.offset.y > 105 || info.velocity.y > 520)) {
              onClose?.();
            }
          }}
          className="absolute inset-x-1 bottom-1 flex h-[95dvh] min-h-[540px] max-h-[calc(100dvh-0.35rem)] flex-col overflow-hidden rounded-[1.45rem] border border-white/10 bg-[#050505] shadow-[0_-24px_80px_rgba(0,0,0,0.62)] sm:inset-x-2 sm:bottom-2 sm:h-[92dvh] lg:inset-y-0 lg:left-auto lg:right-0 lg:h-auto lg:max-h-none lg:w-[52vw] lg:min-w-[620px] lg:max-w-[940px] lg:rounded-none lg:rounded-l-[2rem] lg:border-y-0 lg:border-r-0 lg:border-l lg:shadow-[-30px_0_100px_rgba(0,0,0,0.65)]"
        >
          <div
            className="flex h-9 shrink-0 cursor-grab touch-none select-none items-center justify-center active:cursor-grabbing lg:hidden"
            onPointerDown={(event) => dragControls.start(event)}
            role="presentation"
          >
            <span className="h-1.5 w-14 rounded-full bg-white/35" />
          </div>

          <div className="relative z-20 flex shrink-0 items-center gap-2 border-b border-white/10 bg-[#080808]/96 px-2.5 pb-2.5 pt-1.5 backdrop-blur-xl sm:px-4 sm:py-3 lg:min-h-[70px] lg:px-5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-black text-white sm:text-sm lg:text-base">
                {activeFile.product || activeFile.code || "Certificate"}
              </p>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[9px] font-bold uppercase tracking-[0.07em] text-white/38 sm:text-[10px]">
                {activeFile.lot && (
                  <button
                    type="button"
                    onClick={copyLot}
                    className="relative z-30 inline-flex min-h-7 items-center rounded-lg border border-white/10 bg-white/[0.035] px-2 font-mono text-white/65 transition active:scale-[0.97] active:bg-red-600/20 hover:border-red-500/30 hover:text-white"
                    aria-label={`Copy lot ${activeFile.lot}`}
                  >
                    {copiedLot ? "Copied ✓" : `Lot ${activeFile.lot}`}
                  </button>
                )}
                {activeFile.sku && <span className="truncate">SKU {activeFile.sku}</span>}
                {activeFile.purity && <span>{activeFile.purity}</span>}
                {certificateDate && <span>{certificateDate}</span>}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {pdfUrl && (
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hidden h-9 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.035] px-3 text-[9px] font-black uppercase tracking-[0.1em] text-white/55 transition hover:border-red-500/30 hover:text-white lg:inline-flex"
                >
                  Original
                  <ArrowIcon />
                </a>
              )}

              <button
                type="button"
                onClick={onClose}
                className="hidden h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.045] text-white/70 transition active:scale-95 lg:flex lg:hover:border-red-500/30 lg:hover:bg-red-500/10 lg:hover:text-white"
                aria-label="Close COA viewer"
              >
                <CloseIcon />
              </button>
            </div>
          </div>

          <div className="shrink-0 border-b border-white/[0.08] bg-[#090909] px-2.5 py-2 sm:px-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={showLatest}
                className={cn(
                  "flex min-h-12 items-center justify-between rounded-xl border px-3.5 py-2 text-left text-[11px] font-black transition active:scale-[0.98] sm:min-h-10",
                  !viewingEarlier
                    ? "border-red-500/50 bg-red-600 text-white shadow-[0_8px_20px_rgba(220,38,38,0.18)]"
                    : "border-white/10 bg-white/[0.035] text-white/60 hover:border-white/20 hover:text-white"
                )}
                aria-pressed={!viewingEarlier}
              >
                <span>
                  <span className="block">Latest COA</span>
                  <span className={cn("mt-0.5 block text-[9px] font-bold", !viewingEarlier ? "text-white/75" : "text-white/35")}>
                    Current certificate
                  </span>
                </span>
                <span className="h-2 w-2 rounded-full bg-emerald-300" />
              </button>

              {hasEarlier ? (
                <button
                  type="button"
                  onClick={toggleEarlier}
                  className={cn(
                    "flex min-h-12 items-center justify-between gap-2 rounded-xl border px-3.5 py-2 text-left text-[11px] font-black transition active:scale-[0.98] sm:min-h-10",
                    viewingEarlier || earlierOpen
                      ? "border-red-500/35 bg-red-500/10 text-white"
                      : "border-white/10 bg-white/[0.035] text-white/60 hover:border-white/20 hover:text-white"
                  )}
                  aria-expanded={earlierOpen}
                >
                  <span>
                    <span className="block">Earlier COAs</span>
                    <span className={cn("mt-0.5 block text-[9px] font-bold", viewingEarlier ? "text-red-200/75" : "text-white/35")}>
                      {earlierVersions.length} archived {earlierVersions.length === 1 ? "certificate" : "certificates"}
                    </span>
                  </span>
                  <ChevronIcon open={earlierOpen} />
                </button>
              ) : (
                <div className="flex min-h-12 items-center rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 text-[10px] font-bold text-white/25 sm:min-h-10">
                  No earlier COAs
                </div>
              )}
            </div>
          </div>

          <AnimatePresence initial={false}>
            {hasEarlier && earlierOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{
                  height: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
                  opacity: { duration: 0.16, ease: "easeOut" },
                }}
                className="shrink-0 overflow-hidden border-b border-white/[0.08] bg-[#070707]"
              >
                <div className="max-h-[31dvh] overflow-y-auto overscroll-contain p-2.5 sm:max-h-[260px] sm:p-3 [scrollbar-width:thin]">
                  <div className="grid gap-2">
                    {earlierVersions.map((version, index) => {
                      const selected = safeVersionIndex === index + 1;
                      return (
                        <button
                          key={`${version.url || version.code || version.lot}-${index}`}
                          type="button"
                          onClick={() => showEarlier(index)}
                          className={cn(
                            "flex min-h-[58px] w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition active:scale-[0.99]",
                            selected
                              ? "border-red-500/50 bg-red-600/95 text-white shadow-[0_8px_22px_rgba(220,38,38,0.16)]"
                              : "border-white/10 bg-white/[0.035] text-white/70 hover:border-red-500/25 hover:bg-white/[0.055] hover:text-white"
                          )}
                          aria-pressed={selected}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] font-black">
                              {version.lot ? `Lot ${version.lot}` : version.code || `Earlier COA ${index + 1}`}
                            </span>
                            <span className={cn("mt-1 block truncate text-[9px] font-bold uppercase tracking-[0.08em]", selected ? "text-white/70" : "text-white/35")}>
                              {[version.code, version.sku, version.purity].filter(Boolean).join(" · ") || "Archived certificate"}
                            </span>
                          </span>
                          <span className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
                            selected ? "border-white/20 bg-white/10" : "border-white/10 bg-black/20"
                          )}>
                            <ArrowIcon />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative min-h-0 flex-1 bg-[#111]">
            {viewerUrl ? (
              <iframe
                key={viewerUrl}
                src={viewerUrl}
                title={`${activeFile.product || activeFile.code || "COA"} certificate`}
                className="h-full w-full border-0 bg-white"
                loading="eager"
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center">
                <div className="max-w-sm">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10 text-red-300">
                    <FileIcon />
                  </div>
                  <h3 className="mt-3 text-lg font-black text-white">Certificate unavailable</h3>
                  <p className="mt-1.5 text-xs leading-5 text-white/45">
                    This COA does not currently have a PDF URL.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-white/[0.08] bg-[#080808]/98 p-2 backdrop-blur-xl lg:hidden">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex h-12 items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/[0.055] text-[11px] font-black uppercase tracking-[0.08em] text-white/80 active:scale-[0.98] active:bg-white/10"
              >
                <ChevronLeftIcon />
                Back
              </button>
              {pdfUrl ? (
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-12 items-center justify-center gap-2 rounded-xl bg-red-600 text-[11px] font-black uppercase tracking-[0.08em] text-white shadow-[0_10px_26px_rgba(220,38,38,0.2)] active:scale-[0.98] active:bg-red-500"
                >
                  Open PDF
                  <ArrowIcon />
                </a>
              ) : (
                <div className="flex h-12 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.02] text-[10px] font-black uppercase tracking-[0.08em] text-white/25">
                  PDF unavailable
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
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
        <div className="fixed inset-0 z-[210] lg:hidden" role="dialog" aria-modal="true" aria-labelledby="mobile-product-picker-title">
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
  const [coaData, setCoaData] = useState({ companies: [] });
  const [libraryStatus, setLibraryStatus] = useState("loading");
  const [libraryError, setLibraryError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(ALL_ID);
  const [openHistory, setOpenHistory] = useState({});
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [currentPage, setCurrentPage] = useState(1);
  const [mobileProductsOpen, setMobileProductsOpen] = useState(false);
  const [activeCoa, setActiveCoa] = useState(null);
  const [activeCoaVersionIndex, setActiveCoaVersionIndex] = useState(0);
  const [recentlyViewed, setRecentlyViewed] = useState([]);
  const [browseDocked, setBrowseDocked] = useState(false);

  const deferredQuery = useDeferredValue(query);
  const sectionRef = useRef(null);
  const browseButtonRef = useRef(null);
  const searchWrapperRef = useRef(null);
  const resultsTopRef = useRef(null);
  const browseEndSentinelRef = useRef(null);
  const categoryApplyTimerRef = useRef(null);
  const urlSyncTimer = useRef(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadLibrary() {
      setLibraryStatus("loading");
      setLibraryError("");

      try {
        const response = await fetch("/api/coas", {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload?.error || "Could not load the certificate library.");
        }

        setCoaData(payload && typeof payload === "object" ? payload : { companies: [] });
        setLibraryStatus("ready");
      } catch (error) {
        if (error?.name === "AbortError") return;
        setLibraryError(error?.message || "Could not load the certificate library.");
        setLibraryStatus("error");
      }
    }

    loadLibrary();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    const product = params.get("product");
    if (q) setQuery(q);
    else if (product) setSelectedCategory(product);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = JSON.parse(window.localStorage.getItem(RECENT_COAS_STORAGE_KEY) || "[]");
      if (Array.isArray(stored)) setRecentlyViewed(stored.slice(0, 3));
    } catch {
      setRecentlyViewed([]);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined") {
        window.clearTimeout(categoryApplyTimerRef.current);
      }
    };
  }, []);

  // Browse uses one DOM node only. No scroll listener, no per-frame measurements.
  // A 1px sentinel at the end of the COA section tells us when the fixed button
  // should become section-anchored. The handoff happens exactly when the section
  // bottom reaches the viewport bottom, so the button does not visibly jump.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const sentinel = browseEndSentinelRef.current;
    if (!sentinel || !("IntersectionObserver" in window)) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const viewportBottom = entry.rootBounds?.bottom ?? window.innerHeight;
        setBrowseDocked(entry.boundingClientRect.top <= viewportBottom);
      },
      { root: null, threshold: 0 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [libraryStatus, navItems.length]);

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

    return companies
      .flatMap((company) => {
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
      })
      .sort((a, b) => compareProductsByCustomOrder(a?.product, b?.product));
  }, [coaData]);

  const compoundCounts = useMemo(() => {
    const counts = new Map();
    allCoas.forEach((file) => {
      if (!file.product) return;
      counts.set(file.product, (counts.get(file.product) || 0) + 1);
    });
    return counts;
  }, [allCoas]);

  const compoundList = useMemo(() => {
    return [...compoundCounts.keys()].sort(compareProductsByCustomOrder);
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
    return allCoas.filter((file) => matchesSearchText(file.searchText, search));
  }, [allCoas, deferredQuery]);

  const mobileQuickMatches = useMemo(() => {
    const search = normalize(deferredQuery);
    if (!search) return [];

    return allCoas
      .filter((file) => matchesSearchText(file.searchText, search))
      .map((file) => {
        const product = normalize(file.product);
        const lot = normalize(file.lot);
        const sku = normalize(file.sku);
        const code = normalize(file.code);

        let score = 0;
        if (lot === search) score += 140;
        if (sku === search) score += 135;
        if (code === search) score += 130;
        if (product === search) score += 125;
        if (lot.startsWith(search)) score += 90;
        if (sku.startsWith(search)) score += 85;
        if (code.startsWith(search)) score += 80;
        if (product.startsWith(search)) score += 75;
        if (product.includes(search)) score += 40;

        return { file, score };
      })
      .sort((a, b) =>
        b.score - a.score || compareProductsByCustomOrder(a.file?.product, b.file?.product)
      )
      .slice(0, 6)
      .map((item) => item.file);
  }, [allCoas, deferredQuery]);

  const exactCertificateMatch = useMemo(
    () => findExactCertificateMatch(allCoas, deferredQuery),
    [allCoas, deferredQuery]
  );

  const resolvedRecentCoas = useMemo(() => {
    return recentlyViewed
      .map((entry) => {
        const file = allCoas.find((item) => item.key === entry.key);
        if (!file) return null;
        const versionIndex = Math.max(0, Number(entry.versionIndex) || 0);
        const version = versionIndex > 0 ? getEarlierCoas(file)[versionIndex - 1] : file;
        return { entry, file, versionIndex, version: version || file };
      })
      .filter(Boolean)
      .slice(0, 3);
  }, [allCoas, recentlyViewed]);

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

  const rememberCoa = useCallback((file, versionIndex = 0) => {
    if (!file) return;
    const key = file.key || getHistoryKey(file);
    const entry = {
      key,
      versionIndex: Math.max(0, Number(versionIndex) || 0),
      viewedAt: Date.now(),
    };

    setRecentlyViewed((current) => {
      const next = [entry, ...current.filter((item) => item?.key !== key)].slice(0, 3);
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(RECENT_COAS_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Storage may be unavailable in private/restricted browsing.
        }
      }
      return next;
    });
  }, []);

  const openCoa = useCallback((file, versionIndex = 0) => {
    if (!file) return;
    const safeIndex = Math.max(0, Number(versionIndex) || 0);
    setSuggestionsOpen(false);
    setActiveCoa(file);
    setActiveCoaVersionIndex(safeIndex);
    rememberCoa(file, safeIndex);
  }, [rememberCoa]);

  const closeCoa = useCallback(() => {
    setActiveCoa(null);
    setActiveCoaVersionIndex(0);
  }, []);

  const changeActiveCoaVersion = useCallback(
    (versionIndex) => {
      const safeIndex = Math.max(0, Number(versionIndex) || 0);
      setActiveCoaVersionIndex(safeIndex);
      if (activeCoa) rememberCoa(activeCoa, safeIndex);
    },
    [activeCoa, rememberCoa]
  );

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
    const applySelection = () => {
      setSelectedCategory(id);
      setQuery("");
      setSuggestionsOpen(false);
      setMobileProductsOpen(false);
      setActiveSuggestion(-1);
      setCurrentPage(1);
      setOpenHistory({});
    };

    if (typeof window === "undefined" || window.innerWidth >= 1024) {
      applySelection();
      return;
    }

    // Close the picker first, but keep the current result list in place while the
    // viewport glides upward. Changing a long list into a short one BEFORE the
    // scroll was the main cause of the hard mobile jump / page-height collapse.
    setSuggestionsOpen(false);
    setMobileProductsOpen(false);
    setActiveSuggestion(-1);
    window.clearTimeout(categoryApplyTimerRef.current);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = resultsTopRef.current;
        if (!target) {
          applySelection();
          return;
        }

        const topOffset = window.innerWidth < 640 ? 88 : 104;
        const targetY = Math.max(
          0,
          target.getBoundingClientRect().top + window.scrollY - topOffset
        );
        const distance = Math.abs(window.scrollY - targetY);

        if (distance < 72) {
          applySelection();
          return;
        }

        window.scrollTo({ top: targetY, behavior: "smooth" });

        // Apply the compound after the viewport has started moving. Native smooth
        // scrolling stays on the browser compositor and is much less janky than
        // calling window.scrollTo() on every animation frame from React code.
        const delay = distance > 900 ? 520 : distance > 450 ? 430 : 330;
        categoryApplyTimerRef.current = window.setTimeout(applySelection, delay);
      });
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
      if (event.key === "Enter" && exactCertificateMatch) {
        event.preventDefault();
        openCoa(exactCertificateMatch.file, exactCertificateMatch.versionIndex);
        event.currentTarget.blur();
        return;
      }

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
    [suggestionsOpen, suggestions, activeSuggestion, selectCategory, exactCertificateMatch, openCoa]
  );

  const totalCoaCount = allCoas.length;
  const resultLabel = activeList && activeList.length === 1 ? "result" : "results";

  let panelTitle = "All products";
  let panelSubtitle =
    libraryStatus === "ready"
      ? `${navItems.length} products · ${totalCoaCount} certificates`
      : "Loading certificate library…";
  if (isSearching) {
    panelTitle = `Results for "${query}"`;
    panelSubtitle = null;
  } else if (selectedCategory) {
    panelTitle = selectedCategory;
    panelSubtitle = null;
  }

  return (
    <section
      ref={sectionRef}
      id="coa"
      className="relative w-full overflow-x-clip bg-[#030303] px-3 pb-[8rem] pt-[148px] text-white sm:px-4 sm:pb-[8rem] sm:pt-[160px] lg:px-6 lg:pb-20 lg:pt-[180px]"
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
          className="mx-auto mt-7 w-full max-w-[760px] sm:mt-9"
        >
          <div ref={searchWrapperRef} className="relative">
            <label className="relative block">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/35">
                <SearchIcon />
              </span>

              <input
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
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
                placeholder="Search product, SKU or lot…"
                aria-label="Search certificates by product, SKU, or lot number"
                className="h-[4rem] w-full rounded-2xl border border-white/15 bg-white/[0.065] pl-12 pr-11 text-[16px] font-bold text-white shadow-[0_18px_55px_rgba(0,0,0,0.28)] outline-none transition placeholder:text-white/35 focus:border-red-500/70 focus:bg-white/[0.08] sm:h-14 sm:text-sm"
              />

              {query && (
                <button
                  type="button"
                  onClick={clearSearch}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl text-white/45 transition active:bg-white/10 hover:bg-white/10 hover:text-white"
                >
                  <CloseIcon />
                </button>
              )}
            </label>

            {/* Mobile: ranked certificate matches with one-tap opening. */}
            <AnimatePresence>
              {suggestionsOpen && query.trim() && (exactCertificateMatch || mobileQuickMatches.length > 0) && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.99 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.99 }}
                  transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute left-0 right-0 top-[calc(100%+0.55rem)] z-50 overflow-hidden rounded-2xl border border-white/12 bg-[#080808]/98 shadow-[0_26px_80px_rgba(0,0,0,0.72)] backdrop-blur-xl lg:hidden"
                >
                  <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2.5">
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-white/38">
                      Quick matches
                    </p>
                    <span className="text-[10px] font-bold text-red-300/80">
                      Tap to open
                    </span>
                  </div>

                  <div className="max-h-[min(58dvh,390px)] overflow-y-auto overscroll-contain p-1.5">
                    {exactCertificateMatch && (
                      <button
                        type="button"
                        onClick={() => openCoa(exactCertificateMatch.file, exactCertificateMatch.versionIndex)}
                        className="mb-1.5 w-full rounded-xl border border-emerald-400/25 bg-emerald-400/[0.08] p-3.5 text-left shadow-[0_10px_30px_rgba(16,185,129,0.08)] transition active:scale-[0.995] active:bg-emerald-400/[0.13]"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-[0.13em] text-emerald-300">
                              Exact certificate found ✓
                            </p>
                            <p className="mt-1 truncate text-[15px] font-black text-white">
                              {exactCertificateMatch.file.product || exactCertificateMatch.file.code || "Certificate"}
                            </p>
                            <p className="mt-1 truncate text-[10px] font-bold uppercase tracking-[0.07em] text-white/45">
                              {[
                                exactCertificateMatch.certificate?.lot && `Lot ${exactCertificateMatch.certificate.lot}`,
                                exactCertificateMatch.certificate?.sku && `SKU ${exactCertificateMatch.certificate.sku}`,
                                exactCertificateMatch.certificate?.purity,
                                exactCertificateMatch.versionIndex > 0 ? "Earlier COA" : "Latest COA",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                          <span className="flex h-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500 px-4 text-[10px] font-black uppercase tracking-[0.08em] text-black">
                            View COA
                          </span>
                        </div>
                      </button>
                    )}

                    {mobileQuickMatches
                      .filter((file) => file.key !== exactCertificateMatch?.file?.key)
                      .map((file) => (
                      <button
                        key={file.key || `${file.code}-${file.lot || file.url}`}
                        type="button"
                        onClick={() => openCoa(file)}
                        className="group flex min-h-[76px] w-full items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left transition active:scale-[0.995] active:bg-red-600/20"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[14px] font-black text-white">
                            <HighlightText text={file.product || file.code || "Certificate"} query={query} />
                          </p>
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white/38">
                            {file.lot && (
                              <span className="text-red-300/85">Lot <HighlightText text={file.lot} query={query} /></span>
                            )}
                            {file.sku && <span>SKU <HighlightText text={file.sku} query={query} /></span>}
                            {file.purity && <span>{file.purity}</span>}
                          </div>
                        </div>

                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-red-500/25 bg-red-500/10 text-red-300 shadow-[0_8px_24px_rgba(220,38,38,0.1)]">
                          <ArrowIcon />
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="border-t border-white/10 px-3 py-2 text-center text-[10px] font-semibold text-white/30">
                    Full results continue below as you type
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

        </motion.div>



        {resolvedRecentCoas.length > 0 && !isSearching && (
          <div className="mx-auto mt-4 w-full max-w-[760px] sm:mt-6">
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-white/35">Recently viewed</p>
              <span className="text-[10px] font-semibold text-white/25">Last 3</span>
            </div>
            <div className="flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {resolvedRecentCoas.map(({ entry, file, versionIndex, version }) => (
                <button
                  key={`${entry.key}-${versionIndex}`}
                  type="button"
                  onClick={() => openCoa(file, versionIndex)}
                  className="min-w-[210px] snap-start rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-left transition active:scale-[0.985] active:bg-white/[0.07] hover:border-red-500/25"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[12px] font-black text-white">{file.product || file.code}</p>
                    <span className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.08em]",
                      versionIndex > 0 ? "bg-white/[0.07] text-white/45" : "bg-emerald-400/10 text-emerald-200"
                    )}>
                      {versionIndex > 0 ? "Earlier" : "Latest"}
                    </span>
                  </div>
                  <p className="mt-1.5 truncate text-[9px] font-bold uppercase tracking-[0.07em] text-white/35">
                    {[version?.lot && `Lot ${version.lot}`, version?.sku && `SKU ${version.sku}`, version?.purity]
                      .filter(Boolean)
                      .join(" · ") || "Certificate"}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.14, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto mt-7 flex w-full flex-col gap-6 sm:mt-12 lg:flex-row lg:items-start"
        >
          <CategoryNav items={navItems} activeId={isSearching ? null : selectedCategory} onSelect={selectCategory} />

          <div
            ref={resultsTopRef}
            className="min-w-0 flex-1 scroll-mt-24 [overflow-anchor:none]"
          >
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

            <motion.div
              key={isSearching ? `search:${deferredQuery}` : `product:${selectedCategory || ALL_ID}`}
              initial={{ opacity: 0.72 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="[overflow-anchor:none]"
            >
            {libraryStatus === "loading" ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-7 text-center">
                <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-white/15 border-t-red-500" />
                <p className="mt-3 text-sm font-bold text-white/55">Loading certificate library…</p>
              </div>
            ) : libraryStatus === "error" ? (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-6 text-center sm:p-7">
                <h3 className="text-lg font-black text-white">Certificate library unavailable</h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/50">
                  {libraryError || "Please try again in a moment."}
                </p>
              </div>
            ) : activeList ? (
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
                          onOpen={openCoa}
                          highlightQuery={isSearching ? query : ""}
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
            </motion.div>
          </div>
        </motion.div>
      </div>

      {/* End-of-section sentinel for the single mobile Browse control. */}
      <div
        ref={browseEndSentinelRef}
        className="pointer-events-none absolute bottom-0 left-0 h-px w-px lg:hidden"
        aria-hidden="true"
      />

      {/* Exactly one Browse control. It stays fixed while browsing and becomes
          section-anchored only when the section bottom reaches the viewport. */}
      {libraryStatus === "ready" && navItems.length > 0 && !mobileProductsOpen && !activeCoa && (
        <button
          ref={browseButtonRef}
          type="button"
          onClick={() => {
            setSuggestionsOpen(false);
            setMobileProductsOpen(true);
          }}
          aria-label="Browse COA products"
          style={{ bottom: "calc(14px + env(safe-area-inset-bottom))" }}
          className={cn(
            "left-1/2 z-[120] flex min-h-[64px] w-[calc(100%_-_1.5rem)] max-w-[430px] -translate-x-1/2 items-center justify-between gap-3 overflow-hidden rounded-[1.35rem] border border-white/15 bg-[#090909]/98 px-3.5 py-2.5 text-left text-white shadow-[0_20px_70px_rgba(0,0,0,0.76),0_0_0_1px_rgba(255,255,255,0.025)] backdrop-blur-2xl transition-[background-color,border-color,box-shadow] duration-200 active:scale-[0.985] lg:hidden",
            browseDocked ? "absolute" : "fixed"
          )}
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-400/60 to-transparent" />
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/12 text-red-300 shadow-[0_8px_24px_rgba(220,38,38,0.12)]">
              <SlidersIcon />
            </span>
            <span className="min-w-0">
              <span className="block text-[9px] font-black uppercase tracking-[0.16em] text-red-300/80">
                Browse COAs
              </span>
              <span className="mt-0.5 block truncate text-[13px] font-black tracking-[-0.01em] text-white">
                {selectedCategory || `All ${navItems.length} products`}
              </span>
              <span className="mt-0.5 block truncate text-[10px] font-semibold text-white/35">
                Tap to choose a product
              </span>
            </span>
          </span>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.045] text-white/60">
            <ChevronIcon />
          </span>
        </button>
      )}

      <COAViewer
        file={activeCoa}
        versionIndex={activeCoaVersionIndex}
        onVersionChange={changeActiveCoaVersion}
        onClose={closeCoa}
      />

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
