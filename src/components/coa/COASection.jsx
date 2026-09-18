import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Navbar from "../nav/Navbar";
import { CartProvider } from "../cart/CartContext";
import LazyCartDrawer from "../cart/LazyCartDrawer";
import "../../styles/experience.css";
import "./COASection.css";

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
            className="rgv-coa-highlight"
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

function useCoaDialog(open, onClose, panelRef) {
  useEffect(() => {
    if (!open) return undefined;
    const body = document.body;
    const root = document.documentElement;
    const previous = { body: body.style.overflow, root: root.style.overflow, padding: body.style.paddingRight };
    const previousFocus = document.activeElement;
    const scrollbar = Math.max(0, window.innerWidth - root.clientWidth);
    if (scrollbar) body.style.paddingRight = `${(parseFloat(getComputedStyle(body).paddingRight) || 0) + scrollbar}px`;
    body.style.overflow = "hidden";
    root.style.overflow = "hidden";
    panelRef.current?.querySelector("[data-coa-close]")?.focus();
    function handleKey(event) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = [...(panelRef.current?.querySelectorAll('button:not(:disabled),a[href],input,select,summary,iframe') || [])]
        .filter(node => node.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      body.style.overflow = previous.body;
      root.style.overflow = previous.root;
      body.style.paddingRight = previous.padding;
      document.removeEventListener("keydown", handleKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open, onClose, panelRef]);
}

const Pagination = memo(function Pagination({ currentPage, totalPages, totalResults, onPageChange }) {
  if (totalPages <= 1) return null;
  return <nav className="rgv-coa-pagination" aria-label="Certificate pages">
    <p>Page {currentPage} of {totalPages} <span>· {totalResults} certificates</span></p>
    <div>
      <button type="button" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} aria-label="Previous page"><PaginationArrow direction="previous" /></button>
      <div className="rgv-coa-pagination__numbers">{getVisiblePages(currentPage, totalPages).map((page, index, pages) => <span key={page}>
        {index > 0 && page - pages[index - 1] > 1 && <i>…</i>}
        <button type="button" aria-label={`Go to page ${page}`} aria-current={page === currentPage ? "page" : undefined} onClick={() => onPageChange(page)}>{page}</button>
      </span>)}</div>
      <button type="button" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} aria-label="Next page"><PaginationArrow /></button>
    </div>
  </nav>;
});

function MetaValue({ label, value, highlightQuery = "" }) {
  if (!value) return null;
  const displayValue = label === "Content" && normalize(value) === "report only" ? "See report" : value;
  return <div><dt>{label}</dt><dd><HighlightText text={displayValue} query={highlightQuery} /></dd></div>;
}

const COACard = memo(function COACard({ file, isHistoryOpen, fileHasHistory, historyKey, onToggleHistory, onOpen, highlightQuery = "" }) {
  const historyId = useId();
  const earlierCoas = getEarlierCoas(file);
  return <article className="rgv-coa-record">
    <div className="rgv-coa-record__row">
      <div className="rgv-coa-record__product">
        <span className="rgv-coa-file-icon"><FileIcon /></span>
        <div>
          <h3><HighlightText text={file.product || file.code || "Certificate"} query={highlightQuery} /></h3>
          {file.code && <p>Report <HighlightText text={file.code} query={highlightQuery} /></p>}
        </div>
      </div>
      <dl className="rgv-coa-record__batch">
        <MetaValue label="Lot" value={file.lot || "Not listed"} highlightQuery={highlightQuery} />
        <MetaValue label="SKU" value={file.sku} highlightQuery={highlightQuery} />
      </dl>
      <dl className="rgv-coa-record__analysis">
        <MetaValue label="Purity" value={file.purity || "See report"} highlightQuery={highlightQuery} />
        <MetaValue label="Content" value={file.quantity} highlightQuery={highlightQuery} />
      </dl>
      <button type="button" className="rgv-coa-view" aria-label={`View COA for ${file.product || file.code}`} onClick={() => onOpen(file)}>View COA <ArrowIcon /></button>
    </div>
    <div className="rgv-coa-record__foot">
      <span className="rgv-coa-current"><i aria-hidden="true" />Current certificate</span>
      {fileHasHistory && <button type="button" onClick={() => onToggleHistory(historyKey)} aria-expanded={isHistoryOpen} aria-controls={historyId}>
        {earlierCoas.length} earlier {earlierCoas.length === 1 ? "certificate" : "certificates"} <ChevronIcon open={isHistoryOpen} />
      </button>}
    </div>
    {fileHasHistory && <div id={historyId} className="rgv-coa-history" hidden={!isHistoryOpen}>
      <p>Earlier certificates <span>Match the lot on your label.</span></p>
      <div>{earlierCoas.map((earlier, index) => <button key={`${earlier.url || earlier.lot || earlier.code}-${index}`} type="button" onClick={() => onOpen(file, index + 1)}>
        <span><strong>{earlier.lot ? `Lot ${earlier.lot}` : earlier.code || `Earlier certificate ${index + 1}`}</strong><small>{[earlier.code, earlier.purity, earlier.quantity].filter(Boolean).join(" · ")}</small></span>
        <span className="rgv-coa-history__action">View <ArrowIcon /></span>
      </button>)}</div>
    </div>}
  </article>;
});

const CategoryNav = memo(function CategoryNav({ items, activeId, onSelect }) {
  const [filter, setFilter] = useState("");
  const filtered = items.filter(item => normalize(item.label).includes(normalize(filter)));
  return <nav className="rgv-coa-products" aria-label="Filter certificates by product">
    <div className="rgv-coa-products__heading"><h2>Products</h2><span>{items.length}</span></div>
    <label className="rgv-coa-products__search"><SearchIcon /><input type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Find a product" aria-label="Filter product directory" /></label>
    <div className="rgv-coa-products__list">
      <button type="button" className={activeId === ALL_ID ? "is-active" : ""} aria-pressed={activeId === ALL_ID} onClick={() => onSelect(ALL_ID)}><span>All certificates</span><span>{items.reduce((sum, item) => sum + item.count, 0)}</span></button>
      {filtered.map(item => <button key={item.id} type="button" className={activeId === item.id ? "is-active" : ""} aria-pressed={activeId === item.id} onClick={() => onSelect(item.id)}><span>{item.label}</span><span>{item.count}</span></button>)}
      {!filtered.length && <p>No matching products.</p>}
    </div>
  </nav>;
});

const COAViewer = memo(function COAViewer({ file, versionIndex = 0, onVersionChange, onClose }) {
  const panelRef = useRef(null);
  const [copiedLot, setCopiedLot] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const copyTimer = useRef(null);
  const titleId = useId();
  useCoaDialog(Boolean(file), onClose, panelRef);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => { setCopiedLot(false); window.clearTimeout(copyTimer.current); return () => window.clearTimeout(copyTimer.current); }, [file, versionIndex]);
  const versions = useMemo(() => !file ? [] : [file, ...getEarlierCoas(file).map(earlier => ({ ...file, ...earlier, product: earlier.product || file.product }))], [file]);
  if (!file || typeof document === "undefined") return null;
  const index = Math.min(Math.max(Number(versionIndex) || 0, 0), versions.length - 1);
  const active = versions[index];
  const pdfUrl = String(active.url || "").trim();
  const viewerUrl = pdfUrl ? `${pdfUrl}${pdfUrl.includes("#") ? "&" : "#"}view=FitH&toolbar=1&navpanes=0` : "";
  const certificateDate = active.report_date || active.date || active.test_date || active.testDate || active.created_at || "";
  async function copyLot() {
    if (!active.lot || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(String(active.lot));
      setCopiedLot(true); window.clearTimeout(copyTimer.current); copyTimer.current = window.setTimeout(() => setCopiedLot(false), 1400);
    } catch { setCopiedLot(false); }
  }
  return createPortal(<div className="rgv-coa-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <button type="button" className="rgv-coa-modal__scrim" onClick={onClose} tabIndex={-1} aria-hidden="true" />
    <div className="rgv-coa-viewer" ref={panelRef}>
      <header className="rgv-coa-viewer__header">
        <div><p>{index === 0 ? "Current certificate" : "Earlier certificate"}</p><h2 id={titleId}>{active.product || active.code || "Certificate of analysis"}</h2></div>
        <div>{pdfUrl && <a className="rgv-coa-original" href={pdfUrl} target="_blank" rel="noreferrer">Open original PDF <ArrowIcon /></a>}
          <button type="button" data-coa-close onClick={onClose} className="rgv-coa-modal__close" aria-label="Close COA viewer"><CloseIcon /></button></div>
      </header>
      <div className="rgv-coa-viewer__body">
        <aside className="rgv-coa-viewer__details">
          <details open={!isMobile} key={`${file.key}-${index}-${isMobile}`}>
            <summary><span>{active.lot ? `Lot ${active.lot}` : "Certificate details"}</span><ChevronIcon /></summary>
            <p className="rgv-coa-viewer__label">Certificate details</p>
            <dl><MetaValue label="Lot number" value={active.lot} /><MetaValue label="Report code" value={active.code} /><MetaValue label="SKU" value={active.sku} /><MetaValue label="Purity" value={active.purity} /><MetaValue label="Content" value={active.quantity} /><MetaValue label="Laboratory" value={active.lab_name || active.lab} /><MetaValue label="Report date" value={certificateDate} /></dl>
            {active.lot && <button type="button" onClick={copyLot} className="rgv-coa-copy" aria-label={`Copy lot ${active.lot}`}>{copiedLot ? "Copied ✓" : "Copy lot number"}</button>}
          </details>
          <div className="rgv-coa-versions">
            <p className="rgv-coa-viewer__label">Certificate versions</p>
            {versions.map((version, versionIndex) => <button key={`${version.url}-${versionIndex}`} type="button" className={index === versionIndex ? "is-active" : ""} aria-pressed={index === versionIndex} onClick={() => onVersionChange(versionIndex)}>
              <span>{versionIndex === 0 ? "Current COA" : "Earlier COA"}</span><strong>{version.lot || version.code || "Certificate"}</strong>
            </button>)}
          </div>
          {versions.length > 1 && <label className="rgv-coa-version-select"><span>Certificate version</span><select value={index} onChange={event => onVersionChange(Number(event.target.value))}>{versions.map((version, versionIndex) => <option key={versionIndex} value={versionIndex}>{versionIndex === 0 ? "Current" : "Earlier"} · {version.lot || version.code || `Certificate ${versionIndex + 1}`}</option>)}</select></label>}
        </aside>
        <div className="rgv-coa-preview">{viewerUrl ? <iframe key={viewerUrl} src={viewerUrl} title={`${active.product || active.code || "COA"} certificate`} loading="eager" /> : <div className="rgv-coa-preview__empty"><FileIcon /><h3>Certificate unavailable</h3><p>This record does not currently have a PDF attached.</p></div>}</div>
      </div>
      <footer className="rgv-coa-viewer__footer"><button type="button" onClick={onClose}>Back to library</button>{pdfUrl && <a className="rgv-coa-primary" href={pdfUrl} target="_blank" rel="noreferrer">Open PDF <ArrowIcon /></a>}</footer>
    </div>
  </div>, document.body);
});

const MobileProductPicker = memo(function MobileProductPicker({ open, items, activeId, onClose, onSelect }) {
  const [filter, setFilter] = useState("");
  const panelRef = useRef(null);
  const titleId = useId();
  useCoaDialog(open, onClose, panelRef);
  useEffect(() => { if (!open) setFilter(""); }, [open]);
  const visible = items.filter(item => normalize(item.label).includes(normalize(filter)));
  if (!open || typeof document === "undefined") return null;
  return createPortal(<div className="rgv-coa-modal rgv-coa-picker-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <button type="button" className="rgv-coa-modal__scrim" onClick={onClose} tabIndex={-1} aria-hidden="true" />
    <div className="rgv-coa-picker" ref={panelRef}>
      <header><div><p>Product directory</p><h2 id={titleId}>Choose a product</h2></div><button type="button" className="rgv-coa-modal__close" data-coa-close aria-label="Close product list" onClick={onClose}><CloseIcon /></button></header>
      <label className="rgv-coa-search rgv-coa-picker__search"><SearchIcon /><input type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Find a product" aria-label="Filter COA products" /></label>
      <div className="rgv-coa-picker__list"><button type="button" aria-pressed={activeId === ALL_ID} className={activeId === ALL_ID ? "is-active" : ""} onClick={() => onSelect(ALL_ID)}><span>All certificates</span><span>{items.reduce((sum, item) => sum + item.count, 0)}</span></button>
        {visible.map(item => <button key={item.id} type="button" className={activeId === item.id ? "is-active" : ""} aria-pressed={activeId === item.id} onClick={() => onSelect(item.id)}><span>{item.label}</span><span>{item.count}</span></button>)}
        {!visible.length && <p>No matching products.</p>}
      </div>
    </div>
  </div>, document.body);
});

const CoaAtmosphere = memo(function CoaAtmosphere({ paused = false }) {
  const artRef = useRef(null);
  const [motionActive, setMotionActive] = useState(false);
  const artId = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true;
    const updateMotion = () => setMotionActive(visible && !document.hidden && !reducedMotion.matches);
    const observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; updateMotion(); })
      : null;
    if (artRef.current) observer?.observe(artRef.current);
    document.addEventListener("visibilitychange", updateMotion);
    reducedMotion.addEventListener("change", updateMotion);
    updateMotion();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", updateMotion);
      reducedMotion.removeEventListener("change", updateMotion);
    };
  }, []);

  return <div ref={artRef} className={`rgv-coa-atmosphere${motionActive && !paused ? " is-motion-active" : ""}`} aria-hidden="true">
    <div className="rgv-coa-atmosphere__ambient" />
    <svg className="rgv-coa-atmosphere__rear" viewBox="0 0 1200 700" width="1200" height="700" fill="none" focusable="false">
      <defs><linearGradient id={`${artId}-rear`} x1="380" y1="480" x2="1070" y2="60" gradientUnits="userSpaceOnUse">
        <stop stopColor="#14080c" /><stop offset=".4" stopColor="#56111c" /><stop offset=".65" stopColor="#86212b" /><stop offset="1" stopColor="#19080d" />
      </linearGradient></defs>
      <path d="M1150-90C1010 81 872 98 658 172C442 248 370 351 467 440C587 550 886 508 1162 346L1242 432C957 638 583 681 406 524C188 331 375 114 643 76C850 46 983 38 1050-90Z" fill={`url(#${artId}-rear)`} />
      <path d="M467 440C587 550 886 508 1162 346" stroke="#a6473d" strokeOpacity=".35" strokeWidth="1" />
    </svg>
    <svg className="rgv-coa-atmosphere__ribbon" viewBox="0 0 1200 700" width="1200" height="700" fill="none" focusable="false">
      <defs>
        <linearGradient id={`${artId}-surface`} x1="380" y1="165" x2="1040" y2="510" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1b080e" /><stop offset=".23" stopColor="#57101b" /><stop offset=".42" stopColor="#a2242c" /><stop offset=".57" stopColor="#76121f" /><stop offset=".75" stopColor="#3c0b13" /><stop offset="1" stopColor="#13070c" />
        </linearGradient>
        <linearGradient id={`${artId}-fold`} x1="335" y1="440" x2="1130" y2="390" gradientUnits="userSpaceOnUse">
          <stop stopColor="#28080e" /><stop offset=".2" stopColor="#9b1e2b" /><stop offset=".48" stopColor="#64101c" /><stop offset=".76" stopColor="#320a12" /><stop offset="1" stopColor="#11080c" />
        </linearGradient>
        <linearGradient id={`${artId}-edge`} x1="290" y1="260" x2="1100" y2="410" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8d2b30" stopOpacity="0" /><stop offset=".25" stopColor="#cf6251" stopOpacity=".65" /><stop offset=".48" stopColor="#b53b3c" stopOpacity=".4" /><stop offset=".72" stopColor="#ad3a36" stopOpacity=".5" /><stop offset="1" stopColor="#78202b" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M1080-90C945 111 802 116 593 162C381 210 259 313 341 423C451 570 758 519 1035 337L1115 425C826 632 450 659 291 484C119 294 313 102 584 72C798 49 932 42 1008-90Z" fill={`url(#${artId}-surface)`} />
      <path d="M291 484C450 659 826 632 1115 425L1035 337C792 508 515 578 378 482C296 425 275 351 315 278C230 342 221 407 291 484Z" fill={`url(#${artId}-fold)`} />
      <path d="M1080-90C945 111 802 116 593 162C381 210 259 313 341 423C451 570 758 519 1035 337" stroke={`url(#${artId}-edge)`} strokeWidth="1.2" />
      <path d="M1008-90C932 42 798 49 584 72C313 102 119 294 291 484C450 659 826 632 1115 425" stroke={`url(#${artId}-edge)`} strokeWidth=".8" />
      <path d="M1048-90C941 93 787 77 590 119C356 169 212 298 314 450C443 629 789 579 1080 385" stroke="#b13238" strokeOpacity=".2" />
    </svg>
  </div>;
});

function CertificateLibrary() {
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
  const [reloadKey, setReloadKey] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const searchWrapperRef = useRef(null);
  const resultsTopRef = useRef(null);
  const categoryTimer = useRef(null);
  const urlSyncTimer = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadLibrary() {
      setLibraryStatus("loading"); setLibraryError("");
      try {
        const response = await fetch("/api/coas", { headers: { Accept: "application/json" }, signal: controller.signal });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Could not load the certificate library.");
        setCoaData(payload && typeof payload === "object" ? payload : { companies: [] }); setLibraryStatus("ready");
      } catch (error) {
        if (error?.name === "AbortError") return;
        setLibraryError(error?.message || "Could not load the certificate library."); setLibraryStatus("error");
      }
    }
    void loadLibrary(); return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q"), product = params.get("product");
    if (q) setQuery(q); else if (product) setSelectedCategory(product);
    try { const stored = JSON.parse(localStorage.getItem(RECENT_COAS_STORAGE_KEY) || "[]"); if (Array.isArray(stored)) setRecentlyViewed(stored.slice(0, 3)); } catch { setRecentlyViewed([]); }
    return () => window.clearTimeout(categoryTimer.current);
  }, []);

  useEffect(() => {
    function outside(event) { if (!searchWrapperRef.current?.contains(event.target)) setSuggestionsOpen(false); }
    function escape(event) { if (event.key === "Escape") setSuggestionsOpen(false); }
    document.addEventListener("mousedown", outside, { passive: true }); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, []);

  const allCoas = useMemo(() => (Array.isArray(coaData?.companies) ? coaData.companies : []).flatMap(company => {
    const companyName = company?.name || "";
    const companyAliases = Array.isArray(company?.aliases) ? company.aliases : [];
    return (Array.isArray(company?.files) ? company.files : []).filter(Boolean).map(file => {
      const history = getEarlierCoas(file);
      const aliases = [...companyAliases, ...(Array.isArray(file.aliases) ? file.aliases : [])];
      return { ...file, key: getHistoryKey(file), history, company: companyName, aliases, searchText: buildSearchText(file, companyName, aliases, buildHistoryText(history)) };
    });
  }).sort((a, b) => compareProductsByCustomOrder(a.product, b.product)), [coaData]);

  const navItems = useMemo(() => {
    const counts = new Map();
    allCoas.forEach(file => { if (file.product) counts.set(file.product, (counts.get(file.product) || 0) + 1); });
    return [...counts.keys()].sort(compareProductsByCustomOrder).map(label => ({ id: label, label, count: counts.get(label) }));
  }, [allCoas]);
  const isSearching = deferredQuery.trim().length > 0;
  const suggestions = useMemo(() => navItems.map(item => item.label).filter(label => normalize(label).includes(normalize(deferredQuery))).slice(0, MAX_SUGGESTIONS), [navItems, deferredQuery]);
  const showSuggestions = suggestionsOpen && query.trim().length > 0 && suggestions.length > 0;
  const searchResults = useMemo(() => allCoas.filter(file => matchesSearchText(file.searchText, deferredQuery)), [allCoas, deferredQuery]);
  const exactCertificateMatch = useMemo(() => findExactCertificateMatch(allCoas, deferredQuery), [allCoas, deferredQuery]);
  const categoryResults = useMemo(() => allCoas.filter(file => normalize(file.product) === normalize(selectedCategory)), [allCoas, selectedCategory]);
  const activeList = isSearching ? searchResults : selectedCategory ? categoryResults : allCoas;
  const totalPages = Math.max(1, Math.ceil(activeList.length / COAS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedResults = activeList.slice((safeCurrentPage - 1) * COAS_PER_PAGE, safeCurrentPage * COAS_PER_PAGE);
  const resolvedRecentCoas = useMemo(() => recentlyViewed.map(entry => {
    const file = allCoas.find(item => item.key === entry.key);
    if (!file) return null;
    const versionIndex = Math.min(Math.max(0, Number(entry.versionIndex) || 0), getEarlierCoas(file).length);
    return { entry, file, versionIndex, version: versionIndex > 0 ? getEarlierCoas(file)[versionIndex - 1] : file };
  }).filter(Boolean).slice(0, 3), [allCoas, recentlyViewed]);

  const rememberCoa = useCallback((file, versionIndex = 0) => {
    if (!file) return;
    const key = file.key || getHistoryKey(file);
    const entry = { key, versionIndex: Math.max(0, Number(versionIndex) || 0), viewedAt: Date.now() };
    setRecentlyViewed(current => {
      const next = [entry, ...current.filter(item => item?.key !== key)].slice(0, 3);
      try { localStorage.setItem(RECENT_COAS_STORAGE_KEY, JSON.stringify(next)); } catch { /* Browsing works without storage. */ }
      return next;
    });
  }, []);
  const openCoa = useCallback((file, versionIndex = 0) => {
    if (!file) return;
    const index = Math.min(Math.max(0, Number(versionIndex) || 0), getEarlierCoas(file).length);
    setSuggestionsOpen(false); setMobileProductsOpen(false); setActiveCoa(file); setActiveCoaVersionIndex(index); rememberCoa(file, index);
  }, [rememberCoa]);
  const closeCoa = useCallback(() => { setActiveCoa(null); setActiveCoaVersionIndex(0); }, []);
  const closePicker = useCallback(() => setMobileProductsOpen(false), []);
  const changeActiveCoaVersion = useCallback(index => { setActiveCoaVersionIndex(index); if (activeCoa) rememberCoa(activeCoa, index); }, [activeCoa, rememberCoa]);

  useEffect(() => { setCurrentPage(1); setOpenHistory({}); }, [deferredQuery, selectedCategory]);
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);
  useEffect(() => {
    window.clearTimeout(urlSyncTimer.current);
    urlSyncTimer.current = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (deferredQuery.trim()) params.set("q", deferredQuery.trim()); else if (selectedCategory) params.set("product", selectedCategory);
      window.history.replaceState({}, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
    }, URL_SYNC_DELAY);
    return () => window.clearTimeout(urlSyncTimer.current);
  }, [deferredQuery, selectedCategory]);

  const selectCategory = useCallback(id => {
    window.clearTimeout(categoryTimer.current);
    const apply = () => { setSelectedCategory(id); setQuery(""); setSuggestionsOpen(false); setMobileProductsOpen(false); setActiveSuggestion(-1); setCurrentPage(1); setOpenHistory({}); };
    setMobileProductsOpen(false); setSuggestionsOpen(false);
    const target = resultsTopRef.current;
    if (window.innerWidth < 1024 && target && target.getBoundingClientRect().top < 110) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - 120), behavior: reduce ? "instant" : "smooth" });
      if (!reduce) { categoryTimer.current = window.setTimeout(apply, 330); return; }
    }
    apply();
  }, []);
  const clearSearch = useCallback(() => { setQuery(""); setSuggestionsOpen(false); setActiveSuggestion(-1); }, []);
  const toggleHistory = useCallback(key => setOpenHistory(current => ({ ...current, [key]: !current[key] })), []);
  const handlePageChange = useCallback(page => {
    setCurrentPage(Math.min(Math.max(page, 1), totalPages)); setOpenHistory({});
    window.requestAnimationFrame(() => resultsTopRef.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }));
  }, [totalPages]);
  const handleInputKeyDown = useCallback(event => {
    if (event.key === "Enter" && exactCertificateMatch) { event.preventDefault(); openCoa(exactCertificateMatch.file, exactCertificateMatch.versionIndex); return; }
    if (!showSuggestions) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveSuggestion(current => (current + 1) % suggestions.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActiveSuggestion(current => current < 0 ? suggestions.length - 1 : (current - 1 + suggestions.length) % suggestions.length); }
    else if (event.key === "Enter" && activeSuggestion >= 0) { event.preventDefault(); selectCategory(suggestions[activeSuggestion]); }
    else if (event.key === "Escape") setSuggestionsOpen(false);
  }, [exactCertificateMatch, openCoa, showSuggestions, suggestions, activeSuggestion, selectCategory]);

  const panelTitle = isSearching ? "Search results" : selectedCategory || "All certificates";
  return <main id="coa" className="rgv-experience rgv-coa">
    <CoaAtmosphere paused={Boolean(activeCoa) || mobileProductsOpen} />
    <div className="rgv-experience-shell">
      <header className="rgv-experience-heading rgv-coa-heading">
        <div><p className="rgv-experience-kicker">RGVPRIME / LABORATORY DOCUMENTATION</p><h1 className="rgv-experience-title">Certificates of analysis.</h1><p className="rgv-experience-description">Find the laboratory report for your product. Search by name, SKU, or the lot number printed on your label.</p></div>
        <div className="rgv-coa-heading__note">
          <FileIcon />
          <p><span>The right report.</span><span>The right batch.</span></p>
          <small>Match the lot number<br />on your product label.</small>
        </div>
      </header>
      <div className="rgv-coa-toolbar">
        <div ref={searchWrapperRef} className="rgv-coa-search-wrap">
          <label className="rgv-coa-search"><SearchIcon /><input ref={inputRef} type="search" inputMode="search" enterKeyHint="search" autoComplete="off" value={query} role="combobox" aria-expanded={showSuggestions} aria-autocomplete="list" aria-controls="rgv-coa-suggestions" aria-activedescendant={showSuggestions && activeSuggestion >= 0 ? `rgv-coa-suggestion-${activeSuggestion}` : undefined} onChange={event => { setQuery(event.target.value); setSuggestionsOpen(true); setActiveSuggestion(-1); }} onFocus={() => setSuggestionsOpen(true)} onKeyDown={handleInputKeyDown} placeholder="Search product, SKU or lot number" aria-label="Search certificates by product, SKU, or lot number" />{query && <button type="button" onClick={clearSearch} aria-label="Clear search"><CloseIcon /></button>}</label>
          {showSuggestions && <div id="rgv-coa-suggestions" className="rgv-coa-suggestions" role="listbox" aria-label="Matching products"><p>Matching products</p>{suggestions.map((product, index) => <button key={product} id={`rgv-coa-suggestion-${index}`} role="option" aria-selected={activeSuggestion === index} className={activeSuggestion === index ? "is-active" : ""} type="button" onClick={() => selectCategory(product)}><HighlightText text={product} query={query} /><ArrowIcon /></button>)}</div>}
        </div>
        <button className="rgv-coa-filter-toggle" type="button" onClick={() => { setSuggestionsOpen(false); setMobileProductsOpen(true); }} aria-haspopup="dialog" aria-label="Browse COA products"><SlidersIcon /><span>Products</span></button>
        <p className="rgv-coa-toolbar__count">{libraryStatus === "ready" ? <><strong>{allCoas.length}</strong> current certificates <span>· {navItems.length} products</span></> : "Laboratory document library"}</p>
      </div>
      {exactCertificateMatch && <div className="rgv-coa-exact"><div><span>Exact {exactCertificateMatch.field} match</span><p>{exactCertificateMatch.file.product} <small>{exactCertificateMatch.versionIndex > 0 ? "Earlier certificate" : "Current certificate"} · {exactCertificateMatch.certificate.lot || exactCertificateMatch.value}</small></p></div><button type="button" onClick={() => openCoa(exactCertificateMatch.file, exactCertificateMatch.versionIndex)}>Open certificate <ArrowIcon /></button></div>}
      <div className="rgv-coa-layout">
        <CategoryNav items={navItems} activeId={isSearching ? null : selectedCategory} onSelect={selectCategory} />
        <section ref={resultsTopRef} className="rgv-coa-results" aria-labelledby="rgv-coa-results-title" aria-busy={libraryStatus === "loading"}>
          <div className="rgv-coa-results__heading"><div><p>{isSearching ? `For “${query}”` : "CERTIFICATE LIBRARY"}</p><h2 id="rgv-coa-results-title">{panelTitle}</h2></div><span aria-live="polite">{libraryStatus === "ready" ? `${activeList.length} ${activeList.length === 1 ? "certificate" : "certificates"}` : ""}</span></div>
          {selectedCategory && !isSearching && <button className="rgv-coa-clear-filter" type="button" onClick={() => selectCategory(ALL_ID)}><CloseIcon />Clear product filter</button>}
          {libraryStatus === "loading" ? <div className="rgv-coa-state" role="status"><span className="rgv-coa-spinner" /><h3>Loading certificates</h3><p>Preparing the document library…</p></div>
            : libraryStatus === "error" ? <div className="rgv-coa-state" role="alert"><FileIcon /><h3>Library unavailable</h3><p>{libraryError || "Please try again in a moment."}</p><button className="rgv-coa-primary" type="button" onClick={() => setReloadKey(key => key + 1)}>Try again <ArrowIcon /></button></div>
            : activeList.length === 0 ? <div className="rgv-coa-state"><SearchIcon /><h3>{isSearching || selectedCategory ? "No certificates found" : "No certificates available"}</h3><p>{isSearching || selectedCategory ? "Check the spelling or try the lot number printed on your label." : "Laboratory reports will appear here when they are available."}</p>{(query || selectedCategory) && <button type="button" className="rgv-coa-primary" onClick={() => selectCategory(ALL_ID)}>View all certificates <ArrowIcon /></button>}</div>
            : <><div className="rgv-coa-column-labels" aria-hidden="true"><span>Product / report</span><span>Batch / identifier</span><span>Analysis</span><span>Document</span></div><div className="rgv-coa-records">{paginatedResults.map(file => <COACard key={file.key} file={file} historyKey={file.key} fileHasHistory={hasHistory(file)} isHistoryOpen={Boolean(openHistory[file.key])} onToggleHistory={toggleHistory} onOpen={openCoa} highlightQuery={isSearching ? query : ""} />)}</div><Pagination currentPage={safeCurrentPage} totalPages={totalPages} totalResults={activeList.length} onPageChange={handlePageChange} /></>}
          {resolvedRecentCoas.length > 0 && !isSearching && <section className="rgv-coa-recent" aria-labelledby="rgv-coa-recent-title"><h2 id="rgv-coa-recent-title">Recently viewed</h2><div>{resolvedRecentCoas.map(({ entry, file, versionIndex, version }) => <button key={entry.key} type="button" onClick={() => openCoa(file, versionIndex)}><FileIcon /><span><strong>{file.product || file.code}</strong><small>{versionIndex > 0 ? "Earlier" : "Current"}{version?.lot ? ` · Lot ${version.lot}` : ""}</small></span><ArrowIcon /></button>)}</div></section>}
          <p className="rgv-coa-note">Certificate records are specific to the tested batch. Use the lot number on your label to select the corresponding report. <a href="/contact">Need help finding a document? <ArrowIcon /></a></p>
        </section>
      </div>
    </div>
    <COAViewer file={activeCoa} versionIndex={activeCoaVersionIndex} onVersionChange={changeActiveCoaVersion} onClose={closeCoa} />
    <MobileProductPicker open={mobileProductsOpen} items={navItems} activeId={isSearching ? null : selectedCategory} onClose={closePicker} onSelect={selectCategory} />
  </main>;
}

export default function COASection() {
  return <CartProvider><Navbar /><CertificateLibrary /><LazyCartDrawer /></CartProvider>;
}
