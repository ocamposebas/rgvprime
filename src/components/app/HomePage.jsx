import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { CartProvider, useCart } from "../cart/CartContext";

import Navbar from "../nav/Navbar";
import Hero from "../hero/Hero";

const loadTrustBar = () => import("../sections/TrustBar");
const loadFeaturedProducts = () => import("../sections/FeaturedProducts");
const loadNeedHelp = () => import("../sections/NeedHelp");
const loadHowToOrder = () => import("../sections/HowToOrder");
const loadFaq = () => import("../sections/FAQSection");

const sectionLoaders = [
  loadTrustBar,
  loadFeaturedProducts,
  loadNeedHelp,
  loadHowToOrder,
  loadFaq,
];

const TrustBar = lazy(loadTrustBar);
const FeaturedProducts = lazy(loadFeaturedProducts);
const NeedHelp = lazy(loadNeedHelp);
const HowToOrder = lazy(loadHowToOrder);
const Faq = lazy(loadFaq);
const CartDrawer = lazy(() => import("../cart/CartDrawer"));

function SectionPreview({ type, height }) {
  if (type === "trust") {
    return (
      <div
        aria-hidden="true"
        className="grid min-h-[120px] grid-cols-3 items-center gap-2 border-y border-red-500/15 bg-[#090505] px-4 text-center"
      >
        {["Fast shipping", "Secure shopping", "Research use only"].map(
          (label) => (
            <span
              key={label}
              className="text-[8px] font-black uppercase tracking-[0.12em] text-white/55 sm:text-[10px]"
            >
              {label}
            </span>
          ),
        )}
      </div>
    );
  }

  const content = {
    products: {
      eyebrow: "RGVPRIME selection",
      title: "Featured products",
      cards: 3,
    },
    help: {
      eyebrow: "Research support",
      title: "Documentation and ordering support",
      cards: 2,
    },
    order: {
      eyebrow: "Simple process",
      title: "How to order",
      cards: 3,
    },
    faq: {
      eyebrow: "RGVPRIME FAQ",
      title: "Questions answered",
      cards: 4,
    },
  }[type];

  return (
    <section
      aria-hidden="true"
      className="relative flex w-full items-center overflow-hidden border-t border-white/[0.06] bg-[#050505] px-5 py-14 text-white sm:px-8"
      style={{ minHeight: height }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(185,28,28,0.18),transparent_38rem),linear-gradient(180deg,#070404_0%,#030303_100%)]" />
      <div className="relative mx-auto w-full max-w-[1120px]">
        <p className="text-[9px] font-black uppercase tracking-[0.22em] text-red-400">
          {content.eyebrow}
        </p>
        <p className="mt-3 max-w-[720px] text-3xl font-black uppercase leading-[0.95] tracking-[-0.045em] text-white sm:text-5xl">
          {content.title}
        </p>
        <div
          className={`mt-8 grid gap-3 ${
            content.cards === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"
          }`}
        >
          {Array.from({ length: content.cards }, (_, index) => (
            <div
              key={index}
              className={`rounded-[1.35rem] border border-white/10 bg-white/[0.035] ${
                type === "faq" ? "h-16 sm:col-span-3" : "h-32"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function LazyOnVisible({
  children,
  type,
  fallbackHeight = 360,
  rootMargin = "700px 0px",
}) {
  const ref = useRef(null);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    const element = ref.current;

    if (!element || shouldRender) return;

    if (!("IntersectionObserver" in window)) {
      setShouldRender(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShouldRender(true);
        observer.disconnect();
      },
      { rootMargin, threshold: 0.01 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin, shouldRender]);

  const preview = <SectionPreview type={type} height={fallbackHeight} />;

  return (
    <div ref={ref} className="relative bg-[#030303]">
      {shouldRender ? (
        <Suspense fallback={preview}>{children}</Suspense>
      ) : (
        preview
      )}
    </div>
  );
}

function LazyCartDrawer() {
  const { isCartOpen } = useCart();

  if (!isCartOpen) return null;

  return (
    <Suspense fallback={null}>
      <CartDrawer checkoutPath="/checkout" />
    </Suspense>
  );
}

export default function HomePage({ featuredProducts = [] }) {
  useEffect(() => {
    let idleId = null;
    let timeoutId = null;
    let started = false;

    const preloadSections = () => {
      if (started) return;
      started = true;
      sectionLoaders.forEach((loadSection) => void loadSection());
    };

    const preloadEvents = ["scroll", "touchstart", "pointerdown"];
    preloadEvents.forEach((eventName) =>
      window.addEventListener(eventName, preloadSections, {
        once: true,
        passive: true,
      }),
    );

    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(preloadSections, { timeout: 1200 });
    } else {
      timeoutId = window.setTimeout(preloadSections, 800);
    }

    return () => {
      preloadEvents.forEach((eventName) =>
        window.removeEventListener(eventName, preloadSections),
      );
      if (idleId !== null) window.cancelIdleCallback(idleId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, []);

  return (
    <CartProvider>
      <Navbar transparent />

      <Hero />

      <LazyOnVisible type="trust" fallbackHeight={120} rootMargin="600px 0px">
        <TrustBar />
      </LazyOnVisible>

      <LazyOnVisible
        type="products"
        fallbackHeight={720}
        rootMargin="520px 0px"
      >
        <FeaturedProducts initialProducts={featuredProducts} />
      </LazyOnVisible>

      <LazyOnVisible type="help" fallbackHeight={520} rootMargin="380px 0px">
        <NeedHelp />
      </LazyOnVisible>

      <LazyOnVisible type="order" fallbackHeight={620} rootMargin="460px 0px">
        <HowToOrder />
      </LazyOnVisible>

      <LazyOnVisible type="faq" fallbackHeight={680} rootMargin="520px 0px">
        <Faq />
      </LazyOnVisible>

      <LazyCartDrawer />
    </CartProvider>
  );
}
