import { useEffect, useMemo, useRef, useState } from "react";
import coaData from "../data/coas.json";

const warmedPdfUrls = new Set();
const loadedPdfPreviewUrls = new Set();
const PDF_PREVIEW_STORAGE_KEY = "rgvprimer_loaded_coa_pdf_previews";

let globalPreviewLoadStarted = false;

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value = "") {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromUrl(url = "") {
  try {
    const cleanUrl = decodeURIComponent(String(url || ""));
    const lastPart = cleanUrl.split("?")[0].split("#")[0].split("/").pop() || "";
    return cleanText(lastPart.replace(/\.pdf$/i, "")) || "COA Document";
  } catch {
    return "COA Document";
  }
}

function titleFromKey(key = "") {
  return cleanText(key).replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isPdfLikeUrl(value = "", key = "") {
  const text = String(value || "").trim();
  const cleanKey = String(key || "").toLowerCase();

  if (!text) return false;

  const isUrl = /^https?:\/\//i.test(text) || text.startsWith("/");
  const isPdf = /\.pdf(?:[?#]|$)/i.test(text);
  const keyLooksLikePdf = /(pdf|coa|certificate|document|file|download)/i.test(
    cleanKey
  );

  return isUrl && (isPdf || keyLooksLikePdf);
}

function pickTitleFromObject(value = {}) {
  return (
    value.title ||
    value.name ||
    value.product ||
    value.productName ||
    value.product_name ||
    value.label ||
    value.peptide ||
    value.slug ||
    ""
  );
}

function extractAllPdfItems(data) {
  const found = [];

  function visit(value, context = {}) {
    if (!value) return;

    if (typeof value === "string") {
      if (isPdfLikeUrl(value, context.key)) {
        found.push({
          title:
            context.title ||
            titleFromKey(context.key) ||
            titleFromUrl(value) ||
            `COA ${found.length + 1}`,
          pdfLink: value,
        });
      }

      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => {
        visit(item, context);
      });

      return;
    }

    if (isObject(value)) {
      const objectTitle =
        pickTitleFromObject(value) ||
        context.title ||
        titleFromKey(context.key);

      Object.entries(value).forEach(([key, child]) => {
        if (typeof child === "string" && isPdfLikeUrl(child, key)) {
          found.push({
            title:
              objectTitle ||
              titleFromKey(key) ||
              titleFromUrl(child) ||
              `COA ${found.length + 1}`,
            pdfLink: child,
          });

          return;
        }

        visit(child, {
          title: objectTitle,
          key,
        });
      });
    }
  }

  visit(data, { title: "", key: "" });

  const seen = new Set();

  return found
    .map((item, index) => ({
      title:
        cleanText(item.title) ||
        titleFromUrl(item.pdfLink) ||
        `COA ${index + 1}`,
      pdfLink: String(item.pdfLink || "").trim(),
    }))
    .filter((item) => item.pdfLink)
    .filter((item) => {
      const key = item.pdfLink.toLowerCase();

      if (seen.has(key)) return false;

      seen.add(key);
      return true;
    });
}

function getPdfPreviewUrl(url = "") {
  const cleanUrl = String(url || "").trim();

  if (!cleanUrl) return "";

  if (cleanUrl.includes("#")) return cleanUrl;

  return `${cleanUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`;
}

function buildCarouselItems(items = []) {
  if (!items.length) return [];

  const minimumItems = 8;
  const baseItems = [];

  while (baseItems.length < Math.max(minimumItems, items.length)) {
    baseItems.push(...items);
  }

  const normalizedItems = baseItems.slice(
    0,
    Math.max(minimumItems, items.length)
  );

  return [...normalizedItems, ...normalizedItems];
}

function runWhenIdle(callback) {
  if (typeof window === "undefined") return;

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(callback, { timeout: 1800 });
    return;
  }

  window.setTimeout(callback, 450);
}

function getStoredLoadedPreviews() {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.sessionStorage.getItem(PDF_PREVIEW_STORAGE_KEY);
    const parsed = JSON.parse(raw || "[]");

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hasPdfPreviewLoaded(previewUrl = "") {
  if (!previewUrl || typeof window === "undefined") return false;

  if (loadedPdfPreviewUrls.has(previewUrl)) return true;

  const stored = getStoredLoadedPreviews();

  return stored.includes(previewUrl);
}

function markPdfPreviewLoaded(previewUrl = "") {
  if (!previewUrl || typeof window === "undefined") return;

  loadedPdfPreviewUrls.add(previewUrl);

  try {
    const stored = new Set(getStoredLoadedPreviews());
    stored.add(previewUrl);

    window.sessionStorage.setItem(
      PDF_PREVIEW_STORAGE_KEY,
      JSON.stringify(Array.from(stored).slice(-120))
    );
  } catch {
    // Storage puede estar bloqueado; no pasa nada.
  }
}

function prefetchPdfUrls(items = []) {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const uniqueUrls = Array.from(
    new Set(items.map((item) => item.pdfLink).filter(Boolean))
  );

  uniqueUrls.forEach((url, index) => {
    if (warmedPdfUrls.has(url)) return;

    warmedPdfUrls.add(url);

    window.setTimeout(() => {
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.href = url;
      link.as = "document";
      document.head.appendChild(link);
    }, 250 + index * 120);
  });
}

function startGlobalPdfPreviewLoading() {
  if (typeof window === "undefined") return;
  if (globalPreviewLoadStarted) return;

  globalPreviewLoadStarted = true;

  window.dispatchEvent(new CustomEvent("coa:load-all-pdf-previews"));
}

function PdfPreviewFrame({ previewUrl = "", title = "COA Document", index = 0 }) {
  const wrapperRef = useRef(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [frameReady, setFrameReady] = useState(false);

  useEffect(() => {
    setShouldLoad(false);
    setFrameReady(false);

    if (!previewUrl) return;

    let didCancel = false;
    let timeoutId;

    const loadPreview = () => {
      if (didCancel) return;

      const alreadyLoaded = hasPdfPreviewLoaded(previewUrl);
      const staggerDelay = alreadyLoaded ? 80 : 500 + index * 140;

      timeoutId = window.setTimeout(() => {
        runWhenIdle(() => {
          if (!didCancel) {
            setShouldLoad(true);
          }
        });
      }, staggerDelay);
    };

    if (hasPdfPreviewLoaded(previewUrl) || globalPreviewLoadStarted) {
      loadPreview();
    } else {
      window.addEventListener("coa:load-all-pdf-previews", loadPreview, {
        once: true,
      });
    }

    return () => {
      didCancel = true;

      window.removeEventListener("coa:load-all-pdf-previews", loadPreview);

      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [previewUrl, index]);

  return (
    <div
      ref={wrapperRef}
      className="absolute inset-0 overflow-hidden bg-[#080505]"
    >
      <div
        className="coa-pdf-placeholder absolute inset-0 flex h-full w-full flex-col items-center justify-center overflow-hidden bg-[#080505] px-5 text-center"
        style={{
          opacity: frameReady ? 0 : 1,
          pointerEvents: frameReady ? "none" : "auto",
        }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(220,38,38,0.18),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.015))]" />
        <div className="pointer-events-none absolute inset-x-8 top-8 h-px bg-gradient-to-r from-transparent via-red-300/35 to-transparent" />
        <div className="pointer-events-none absolute inset-x-8 bottom-8 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        <div className="relative flex h-20 w-20 items-center justify-center rounded-[1.35rem] border border-red-300/15 bg-red-500/10 text-[15px] font-black uppercase tracking-[-0.04em] text-red-100 shadow-[0_18px_55px_rgba(220,38,38,0.14)]">
          COA
        </div>

        <strong className="relative mt-5 max-w-[175px] text-sm font-black uppercase leading-5 text-white">
          {title}
        </strong>

        <span className="relative mt-4 rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-white/45">
          Preview preparing
        </span>
      </div>

      {shouldLoad && previewUrl ? (
        <iframe
          key={previewUrl}
          src={previewUrl}
          title={`${title} COA preview`}
          loading={index <= 1 ? "eager" : "lazy"}
          onLoad={() => {
            markPdfPreviewLoaded(previewUrl);
            setFrameReady(true);
          }}
          className="absolute inset-0 h-full w-full border-0 bg-[#080505] transition-opacity duration-500"
          style={{
            opacity: frameReady ? 1 : 0,
            pointerEvents: "none",
          }}
        />
      ) : null}
    </div>
  );
}

export default function NeedHelp() {
  const coaItems = useMemo(() => extractAllPdfItems(coaData), []);
  const carouselItems = useMemo(() => buildCarouselItems(coaItems), [coaItems]);
  const baseCount = carouselItems.length ? carouselItems.length / 2 : 0;
  const animationDuration = `${Math.max(38, baseCount * 5.2)}s`;

  useEffect(() => {
    if (!coaItems.length) return;

    const startAfterPageLoad = () => {
      runWhenIdle(() => {
        prefetchPdfUrls(coaItems);

        window.setTimeout(() => {
          startGlobalPdfPreviewLoading();
        }, 900);
      });
    };

    if (document.readyState === "complete") {
      startAfterPageLoad();
      return;
    }

    window.addEventListener("load", startAfterPageLoad, { once: true });

    return () => {
      window.removeEventListener("load", startAfterPageLoad);
    };
  }, [coaItems]);

  return (
    <section className="relative overflow-hidden bg-[#030303] py-20 text-white sm:py-24 lg:py-28">
      <div className="pointer-events-none absolute inset-0">
        <div className="coa-soft-glow absolute left-[-18%] top-[-25%] h-[520px] w-[520px] rounded-full bg-red-950/35 blur-[140px]" />
        <div className="coa-soft-glow absolute right-[-18%] bottom-[-25%] h-[560px] w-[560px] rounded-full bg-red-600/10 blur-[150px]" />
        <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.035),transparent_30%,rgba(220,38,38,0.045))]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-400/30 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1240px] px-6 sm:px-8 lg:px-10">
        <div className="mx-auto mb-12 max-w-3xl text-center">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-red-300">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400 shadow-[0_0_16px_rgba(248,113,113,0.9)]" />
            COA Library
          </div>

          <h2 className="text-4xl font-black leading-[0.92] tracking-[-0.065em] text-white sm:text-5xl lg:text-6xl">
            COAs available.
            <span className="block text-white/35">
              Preview before ordering.
            </span>
          </h2>

          <p className="mx-auto mt-6 max-w-2xl text-sm leading-7 text-white/55 sm:text-base">
            Browse our available Certificates of Analysis in a clean visual
            carousel. Tap any document to open the full PDF.
          </p>
        </div>

        <div className="coa-shell relative overflow-hidden rounded-[2.25rem] border border-white/[0.08] bg-white/[0.035] py-7 shadow-[0_35px_120px_rgba(0,0,0,0.5)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(220,38,38,0.16),transparent_38%)]" />

          <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-20 bg-gradient-to-r from-[#030303] to-transparent sm:w-28" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-20 bg-gradient-to-l from-[#030303] to-transparent sm:w-28" />

          {coaItems.length > 0 ? (
            <div className="relative flex overflow-hidden">
              <div
                className="coa-carousel-track flex w-max gap-5 px-5"
                style={{ "--duration": animationDuration }}
              >
                {carouselItems.map((item, index) => {
                  const title = item.title || `COA ${index + 1}`;
                  const pdfLink = item.pdfLink;
                  const previewUrl = getPdfPreviewUrl(pdfLink);

                  return (
                    <article
                      key={`${pdfLink}-${index}`}
                      className="coa-card group relative w-[235px] shrink-0 overflow-hidden rounded-[1.65rem] border border-white/[0.08] bg-black/45 p-3 transition duration-300 hover:-translate-y-1 hover:border-red-400/25 hover:bg-red-950/15 sm:w-[270px] lg:w-[300px]"
                    >
                      <div className="relative aspect-[0.76] overflow-hidden rounded-[1.25rem] border border-white/[0.07] bg-[#080505]">
                        <PdfPreviewFrame
                          previewUrl={previewUrl}
                          title={title}
                          index={index}
                        />

                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-80" />

                        <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-red-600 px-3 py-1 text-[8px] font-black uppercase tracking-[0.15em] text-white shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
                          PDF
                        </div>

                        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4">
                          <span className="inline-flex rounded-full border border-white/15 bg-black/55 px-3 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-white backdrop-blur-md">
                            View COA
                          </span>
                        </div>
                      </div>

                      <div className="px-1 pb-1 pt-4">
                        <h3 className="truncate text-sm font-black uppercase tracking-[-0.02em] text-white">
                          {title}
                        </h3>

                        <p className="mt-1 text-xs font-bold text-white/35">
                          Certificate available
                        </p>
                      </div>

                      <a
                        href={pdfLink}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${title} COA PDF`}
                        className="absolute inset-0 z-30 rounded-[1.65rem]"
                      >
                        <span className="sr-only">Open {title} COA PDF</span>
                      </a>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-bold text-white/45">
                No COA PDF links found in data/coas.json.
              </p>
            </div>
          )}
        </div>

        <div className="mx-auto mt-10 flex max-w-xl flex-col gap-3 sm:flex-row sm:justify-center">
          <a
            href="/coa"
            className="group relative flex min-h-14 items-center justify-center overflow-hidden rounded-2xl bg-red-600 px-7 text-xs font-black uppercase tracking-[0.15em] text-white transition hover:bg-red-500"
          >
            <span className="absolute inset-0 translate-x-[-120%] skew-x-[-18deg] bg-gradient-to-r from-transparent via-white/25 to-transparent transition duration-700 group-hover:translate-x-[120%]" />
            <span className="relative z-10">View Full COA Library</span>
          </a>

          <a
            href="/shop"
            className="flex min-h-14 items-center justify-center rounded-2xl border border-white/[0.09] bg-white/[0.035] px-7 text-xs font-black uppercase tracking-[0.15em] text-white/65 transition hover:border-white/15 hover:bg-white/[0.06] hover:text-white"
          >
            Shop Products
          </a>
        </div>

        <p className="mx-auto mt-7 max-w-2xl text-center text-[11px] leading-6 text-white/28">
          Products are intended strictly for laboratory research use only. Not
          for human consumption, animal use, diagnostic use, therapeutic use, or
          clinical application.
        </p>
      </div>

      <style>{`
        .coa-carousel-track {
          animation: coaCarouselMove var(--duration, 46s) linear infinite;
          backface-visibility: hidden;
          transform: translate3d(0, 0, 0);
          will-change: transform;
        }

        .coa-card {
          backface-visibility: hidden;
          transform: translate3d(0, 0, 0);
          contain: layout paint;
        }

        .coa-pdf-placeholder {
          transition: opacity 0.45s ease;
        }

        @keyframes coaCarouselMove {
          0% {
            transform: translate3d(0, 0, 0);
          }

          100% {
            transform: translate3d(-50%, 0, 0);
          }
        }

        @media (hover: hover) and (pointer: fine) {
          .coa-carousel-track:hover {
            animation-play-state: paused;
          }
        }

        @media (max-width: 768px) {
          .coa-carousel-track {
            animation-duration: 40s;
            will-change: transform;
          }

          .coa-shell {
            box-shadow: 0 24px 70px rgba(0, 0, 0, 0.42);
          }

          .coa-soft-glow {
            filter: blur(95px) !important;
          }

          .coa-card iframe {
            transform: translateZ(0);
          }
        }

        @media (max-width: 480px) {
          .coa-carousel-track {
            gap: 14px;
            padding-left: 18px;
            padding-right: 18px;
          }

          .coa-card {
            width: 220px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .coa-carousel-track {
            animation: none !important;
            transform: translate3d(0, 0, 0) !important;
          }
        }
      `}</style>
    </section>
  );
}