import { useEffect, useMemo, useRef, useState } from "react";
import coaData from "../data/coas.json";

const loadedPdfPreviewUrls = new Set();

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
      value.forEach((item) => visit(item, context));
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

  const hashIndex = cleanUrl.indexOf("#");
  const baseUrl = hashIndex >= 0 ? cleanUrl.slice(0, hashIndex) : cleanUrl;
  const existingHash = hashIndex >= 0 ? cleanUrl.slice(hashIndex + 1) : "";

  const params = new URLSearchParams(existingHash);

  params.set("toolbar", "0");
  params.set("navpanes", "0");
  params.set("scrollbar", "0");
  params.set("page", "1");
  params.set("view", "FitH");
  params.set("zoom", "page-width");
  params.set("pagemode", "none");

  return `${baseUrl}#${params.toString()}`;
}

function buildDesktopCarouselItems(items = []) {
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

function PdfPreviewFrame({
  previewUrl = "",
  title = "COA Document",
  index = 0,
  priority = false,
}) {
  const wrapperRef = useRef(null);
  const [shouldLoad, setShouldLoad] = useState(priority);
  const [frameReady, setFrameReady] = useState(false);

  useEffect(() => {
    setFrameReady(false);
    setShouldLoad(priority || loadedPdfPreviewUrls.has(previewUrl));

    if (!previewUrl || typeof window === "undefined") return;

    let didCancel = false;
    let timeoutId;
    let observer;

    const startLoading = () => {
      if (didCancel) return;

      const alreadyLoaded = loadedPdfPreviewUrls.has(previewUrl);
      const delay = priority || alreadyLoaded ? 60 : 220 + index * 70;

      timeoutId = window.setTimeout(() => {
        if (!didCancel) {
          setShouldLoad(true);
        }
      }, delay);
    };

    if (priority || loadedPdfPreviewUrls.has(previewUrl)) {
      startLoading();
    } else if ("IntersectionObserver" in window && wrapperRef.current) {
      observer = new IntersectionObserver(
        (entries) => {
          const isVisible = entries.some((entry) => entry.isIntersecting);

          if (isVisible) {
            startLoading();

            if (observer) {
              observer.disconnect();
            }
          }
        },
        {
          root: null,
          rootMargin: "320px 260px",
          threshold: 0.05,
        }
      );

      observer.observe(wrapperRef.current);
    } else {
      startLoading();
    }

    return () => {
      didCancel = true;

      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      if (observer) {
        observer.disconnect();
      }
    };
  }, [previewUrl, index, priority]);

  return (
    <div
      ref={wrapperRef}
      className="coa-preview-frame absolute inset-0 overflow-hidden bg-[#080505]"
    >
      <div
        className="coa-pdf-placeholder absolute inset-0 z-20 flex h-full w-full flex-col items-center justify-center overflow-hidden bg-[#080505] px-5 text-center transition-opacity duration-500"
        style={{
          opacity: frameReady ? 0 : 1,
          pointerEvents: frameReady ? "none" : "auto",
        }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(220,38,38,0.2),transparent_44%),linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.015))]" />
        <div className="pointer-events-none absolute inset-x-8 top-8 h-px bg-gradient-to-r from-transparent via-red-300/35 to-transparent" />
        <div className="pointer-events-none absolute inset-x-8 bottom-8 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        <div className="relative flex h-20 w-20 items-center justify-center rounded-[1.35rem] border border-red-300/15 bg-red-500/10 text-[15px] font-black uppercase tracking-[-0.04em] text-red-100 shadow-[0_18px_55px_rgba(220,38,38,0.14)]">
          COA
        </div>

        <strong className="relative mt-5 max-w-[190px] text-sm font-black uppercase leading-5 text-white">
          {title}
        </strong>

        <span className="relative mt-4 rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-white/45">
          Loading preview
        </span>
      </div>

      {shouldLoad && previewUrl ? (
        <div className="coa-pdf-stage absolute z-10 overflow-hidden">
          <iframe
            key={previewUrl}
            src={previewUrl}
            title={`${title} COA preview`}
            loading={priority ? "eager" : "lazy"}
            onLoad={() => {
              loadedPdfPreviewUrls.add(previewUrl);
              setFrameReady(true);
            }}
            className="coa-pdf-iframe absolute inset-0 h-full w-full border-0 bg-[#080505]"
            style={{
              opacity: frameReady ? 1 : 0,
              transition: "opacity 520ms ease",
              pointerEvents: "none",
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function CoaCard({ item, index, priority = false, mobile = false }) {
  const title = item.title || `COA ${index + 1}`;
  const pdfLink = item.pdfLink;
  const previewUrl = getPdfPreviewUrl(pdfLink);

  return (
    <article
      data-coa-mobile-card={mobile ? "true" : undefined}
      className="coa-card group relative w-[245px] shrink-0 overflow-hidden rounded-[1.65rem] border border-white/[0.08] bg-black/45 p-3 transition duration-300 hover:-translate-y-1 hover:border-red-400/25 hover:bg-red-950/15 sm:w-[280px] lg:w-[310px]"
    >
      <div className="coa-preview-window relative overflow-hidden rounded-[1.25rem] border border-white/[0.07] bg-[#080505]">
        <PdfPreviewFrame
          previewUrl={previewUrl}
          title={title}
          index={index}
          priority={priority}
        />

        <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-t from-black/60 via-transparent to-black/10 opacity-80" />

        <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-full bg-red-600 px-3 py-1 text-[8px] font-black uppercase tracking-[0.15em] text-white shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
          PDF
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-3">
          <span className="inline-flex rounded-full border border-white/15 bg-black/60 px-3 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-white backdrop-blur-md">
            Open COA
          </span>
        </div>
      </div>

      <div className="px-1 pb-1 pt-4">
        <h3 className="coa-title-clamp text-sm font-black uppercase tracking-[-0.02em] text-white">
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
}

export default function NeedHelp() {
  const mobileScrollRef = useRef(null);
  const mobileAutoTimerRef = useRef(null);
  const mobileResumeTimerRef = useRef(null);
  const mobilePausedRef = useRef(false);

  const coaItems = useMemo(() => extractAllPdfItems(coaData), []);
  const desktopCarouselItems = useMemo(
    () => buildDesktopCarouselItems(coaItems),
    [coaItems]
  );

  const baseCount = desktopCarouselItems.length
    ? desktopCarouselItems.length / 2
    : 0;

  const animationDuration = `${Math.max(48, baseCount * 6)}s`;

  const pauseMobileAuto = () => {
    mobilePausedRef.current = true;

    if (mobileResumeTimerRef.current) {
      window.clearTimeout(mobileResumeTimerRef.current);
    }
  };

  const resumeMobileAuto = (delay = 4200) => {
    if (typeof window === "undefined") return;

    if (mobileResumeTimerRef.current) {
      window.clearTimeout(mobileResumeTimerRef.current);
    }

    mobileResumeTimerRef.current = window.setTimeout(() => {
      mobilePausedRef.current = false;
    }, delay);
  };

  const scrollMobileTo = (direction = 1) => {
    const el = mobileScrollRef.current;
    if (!el || typeof window === "undefined") return;

    const cards = Array.from(
      el.querySelectorAll('[data-coa-mobile-card="true"]')
    );

    if (!cards.length) return;

    const viewportCenter = el.scrollLeft + el.clientWidth / 2;

    let currentIndex = 0;
    let closestDistance = Infinity;

    cards.forEach((card, index) => {
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const distance = Math.abs(cardCenter - viewportCenter);

      if (distance < closestDistance) {
        closestDistance = distance;
        currentIndex = index;
      }
    });

    const nextIndex =
      direction > 0
        ? (currentIndex + 1) % cards.length
        : (currentIndex - 1 + cards.length) % cards.length;

    const nextCard = cards[nextIndex];

    el.scrollTo({
      left: nextCard.offsetLeft - (el.clientWidth - nextCard.offsetWidth) / 2,
      behavior: "smooth",
    });
  };

  useEffect(() => {
    if (!coaItems.length || typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(max-width: 767px)");

    const startAuto = () => {
      if (mobileAutoTimerRef.current) {
        window.clearInterval(mobileAutoTimerRef.current);
      }

      mobileAutoTimerRef.current = window.setInterval(() => {
        if (!mediaQuery.matches) return;
        if (mobilePausedRef.current) return;

        scrollMobileTo(1);
      }, 3600);
    };

    startAuto();

    return () => {
      if (mobileAutoTimerRef.current) {
        window.clearInterval(mobileAutoTimerRef.current);
      }

      if (mobileResumeTimerRef.current) {
        window.clearTimeout(mobileResumeTimerRef.current);
      }
    };
  }, [coaItems.length]);

  return (
    <section className="relative overflow-hidden bg-[#030303] py-20 text-white sm:py-24 lg:py-28">
      <div className="pointer-events-none absolute inset-0">
        <div className="coa-soft-glow absolute left-[-18%] top-[-25%] h-[520px] w-[520px] rounded-full bg-red-950/35 blur-[140px]" />
        <div className="coa-soft-glow absolute right-[-18%] bottom-[-25%] h-[560px] w-[560px] rounded-full bg-red-600/10 blur-[150px]" />
        <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.035),transparent_30%,rgba(220,38,38,0.045))]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-400/30 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1240px] px-5 sm:px-8 lg:px-10">
        <div className="mx-auto mb-10 max-w-3xl text-center sm:mb-12">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-red-300">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400 shadow-[0_0_16px_rgba(248,113,113,0.9)]" />
            COA Library
          </div>

          <h2 className="text-[2.55rem] font-black leading-[0.92] tracking-[-0.065em] text-white sm:text-5xl lg:text-6xl">
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

        <div className="coa-shell relative overflow-hidden rounded-[2rem] border border-white/[0.08] bg-white/[0.035] py-6 shadow-[0_35px_120px_rgba(0,0,0,0.5)] sm:rounded-[2.25rem] sm:py-7">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(220,38,38,0.16),transparent_38%)]" />

          <div className="pointer-events-none absolute inset-y-0 left-0 z-20 hidden w-28 bg-gradient-to-r from-[#030303] to-transparent md:block" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-20 hidden w-28 bg-gradient-to-l from-[#030303] to-transparent md:block" />

          {coaItems.length > 0 ? (
            <>
              <div className="coa-desktop-viewport relative hidden overflow-hidden md:flex">
                <div
                  className="coa-carousel-track flex w-max gap-5 px-5"
                  style={{ "--duration": animationDuration }}
                >
                  {desktopCarouselItems.map((item, index) => (
                    <CoaCard
                      key={`desktop-${item.pdfLink}-${index}`}
                      item={item}
                      index={index % Math.max(coaItems.length, 1)}
                      priority={index <= 1}
                    />
                  ))}
                </div>
              </div>

              <div
                ref={mobileScrollRef}
                className="coa-mobile-viewport relative flex overflow-x-auto overflow-y-hidden md:hidden"
                onPointerDown={pauseMobileAuto}
                onPointerUp={() => resumeMobileAuto(4200)}
                onPointerCancel={() => resumeMobileAuto(4200)}
                onTouchStart={pauseMobileAuto}
                onTouchEnd={() => resumeMobileAuto(4200)}
              >
                <div className="flex w-max gap-4 px-4">
                  {coaItems.map((item, index) => (
                    <CoaCard
                      key={`mobile-${item.pdfLink}-${index}`}
                      item={item}
                      index={index}
                      priority={index <= 1}
                      mobile
                    />
                  ))}
                </div>
              </div>

              <div className="mt-5 flex items-center justify-center gap-3 px-5 md:hidden">
                <button
                  type="button"
                  onClick={() => {
                    pauseMobileAuto();
                    scrollMobileTo(-1);
                    resumeMobileAuto(4200);
                  }}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-lg font-black text-white/70 transition active:scale-95"
                  aria-label="Previous COA"
                >
                  ‹
                </button>

                <span className="rounded-full border border-white/10 bg-black/25 px-4 py-2 text-[9px] font-black uppercase tracking-[0.18em] text-white/35">
                  Auto / Swipe
                </span>

                <button
                  type="button"
                  onClick={() => {
                    pauseMobileAuto();
                    scrollMobileTo(1);
                    resumeMobileAuto(4200);
                  }}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-lg font-black text-white/70 transition active:scale-95"
                  aria-label="Next COA"
                >
                  ›
                </button>
              </div>
            </>
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
        .coa-desktop-viewport,
        .coa-mobile-viewport {
          overscroll-behavior-x: contain;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }

        .coa-desktop-viewport::-webkit-scrollbar,
        .coa-mobile-viewport::-webkit-scrollbar {
          display: none;
        }

        .coa-carousel-track {
          animation: coaCarouselMove var(--duration, 54s) linear infinite;
          backface-visibility: hidden;
          transform: translate3d(0, 0, 0);
          will-change: transform;
        }

        .coa-card {
          backface-visibility: hidden;
          transform: translate3d(0, 0, 0);
          contain: layout paint;
        }

        .coa-preview-window {
          aspect-ratio: 210 / 297;
          min-height: 0;
          isolation: isolate;
        }

        .coa-preview-frame,
        .coa-pdf-stage,
        .coa-pdf-iframe {
          backface-visibility: hidden;
        }

        .coa-pdf-stage {
          left: 50%;
          top: 50%;
          width: 106%;
          height: 106%;
          transform: translate3d(-50%, -50%, 0);
          transform-origin: center center;
          background: #080505;
        }

        .coa-pdf-iframe {
          display: block;
          inline-size: 100%;
          block-size: 100%;
          transform: translate3d(0, 0, 0);
          transform-origin: center center;
        }

        .coa-title-clamp {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          min-height: 2.35rem;
          line-height: 1.15rem;
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
          .coa-mobile-viewport {
            scroll-snap-type: x mandatory;
            scroll-padding-inline: 18px;
            touch-action: pan-x;
            scroll-behavior: smooth;
          }

          .coa-card {
            width: min(77vw, 255px);
            scroll-snap-align: center;
            scroll-snap-stop: always;
            border-radius: 1.35rem;
            padding: 10px;
          }

          .coa-card:hover {
            transform: translate3d(0, 0, 0);
          }

          .coa-preview-window {
            border-radius: 1rem;
          }

          .coa-pdf-stage {
            width: 112%;
            height: 112%;
            transform: translate3d(-50%, -50%, 0) scale(0.94);
          }

          .coa-shell {
            margin-left: -4px;
            margin-right: -4px;
            padding-top: 18px;
            padding-bottom: 18px;
            border-radius: 1.65rem;
            box-shadow: 0 24px 70px rgba(0, 0, 0, 0.42);
          }

          .coa-soft-glow {
            filter: blur(90px) !important;
          }
        }

        @media (max-width: 420px) {
          .coa-card {
            width: min(79vw, 238px);
          }

          .coa-pdf-stage {
            width: 118%;
            height: 118%;
            transform: translate3d(-50%, -50%, 0) scale(0.9);
          }
        }

        @media (max-width: 360px) {
          .coa-card {
            width: min(82vw, 220px);
          }

          .coa-pdf-stage {
            width: 124%;
            height: 124%;
            transform: translate3d(-50%, -50%, 0) scale(0.86);
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