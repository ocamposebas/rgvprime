import { lazy, Suspense } from "react";

import { CartProvider, useCart } from "../cart/CartContext";

import Navbar from "../nav/Navbar";
import Hero from "../hero/Hero";
import TrustBar from "../sections/TrustBar";
import FeaturedProducts from "../sections/FeaturedProducts";
import NeedHelp from "../sections/NeedHelp";
import HowToOrder from "../sections/HowToOrder";
import Faq from "../sections/FAQSection";
const CartDrawer = lazy(() => import("../cart/CartDrawer"));

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

      <TrustBar />
      <FeaturedProducts initialProducts={featuredProducts} />
      <NeedHelp />
      <HowToOrder />
      <Faq />

      <LazyCartDrawer />
    </CartProvider>
  );
}
