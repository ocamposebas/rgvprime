import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { CartProvider, useCart } from "../cart/CartContext";

import Navbar from "../nav/Navbar";
import Hero from "../hero/Hero";

const TrustBar = lazy(() => import("../sections/TrustBar"));
const FeaturedProducts = lazy(() => import("../sections/FeaturedProducts"));
const NeedHelp = lazy(() => import("../sections/NeedHelp"));
const HowToOrder = lazy(() => import("../sections/HowToOrder"));
const Faq = lazy(() => import("../sections/FAQSection"));
const CartDrawer = lazy(() => import("../cart/CartDrawer"));

function LazyOnVisible({
  children,
  fallbackHeight = 360,
  rootMargin = "420px 0px",
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
      {
        root: null,
        rootMargin,
        threshold: 0.01,
      }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [rootMargin, shouldRender]);

  return (
    <div ref={ref} style={{ minHeight: shouldRender ? undefined : fallbackHeight }}>
      {shouldRender ? (
        <Suspense fallback={<SectionFallback height={fallbackHeight} />}>
          {children}
        </Suspense>
      ) : null}
    </div>
  );
}

function SectionFallback({ height = 360 }) {
  return (
    <div
      aria-hidden="true"
      className="w-full bg-[#030303]"
      style={{ minHeight: height }}
    />
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
  return (
    <CartProvider>
      <Navbar transparent />

      <Hero />

      <LazyOnVisible fallbackHeight={120} rootMargin="500px 0px">
        <TrustBar />
      </LazyOnVisible>

      <LazyOnVisible fallbackHeight={720} rootMargin="520px 0px">
        <FeaturedProducts initialProducts={featuredProducts} />
      </LazyOnVisible>

      <LazyOnVisible fallbackHeight={520} rootMargin="480px 0px">
        <NeedHelp />
      </LazyOnVisible>

      <LazyOnVisible fallbackHeight={620} rootMargin="480px 0px">
        <HowToOrder />
      </LazyOnVisible>

      <LazyOnVisible fallbackHeight={680} rootMargin="460px 0px">
        <Faq />
      </LazyOnVisible>

      <LazyCartDrawer />
    </CartProvider>
  );
}