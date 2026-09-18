import { lazy, Suspense } from "react";
import { CartProvider, useCart } from "../cart/CartContext";
import Navbar from "../nav/Navbar";
import Hero from "../hero/Hero";
import FeaturedProducts from "../sections/FeaturedProducts";
import { ResearchFormats, CertificateRecords, HomeQuestions } from "../home/HomeSections";
import "../../styles/home.css";

const CartDrawer = lazy(() => import("../cart/CartDrawer"));
const EMPTY_PRODUCTS = [];

function HomeCart() {
  const { isCartOpen } = useCart();
  if (!isCartOpen) return null;
  return (
    <Suspense fallback={null}>
      <CartDrawer checkoutPath="/checkout" />
    </Suspense>
  );
}

export default function HomePage({ featuredProducts = EMPTY_PRODUCTS }) {
  return (
    <CartProvider>
      <div className="rgv-home">
        <Navbar transparent />
        <main>
          <Hero />
          <FeaturedProducts initialProducts={featuredProducts} />
          <ResearchFormats />
          <CertificateRecords />
          <HomeQuestions />
        </main>
        <HomeCart />
      </div>
    </CartProvider>
  );
}
