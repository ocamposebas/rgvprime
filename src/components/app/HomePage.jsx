import { CartProvider } from "../cart/CartContext";
import CartDrawer from "../cart/CartDrawer";

import Navbar from "../nav/Navbar";
import Hero from "../hero/Hero";
import TrustBar from "../sections/TrustBar";
import FeaturedProducts from "../sections/FeaturedProducts";
import HowToOrder from "../sections/HowToOrder";
import NeedHelp from "../sections/NeedHelp";
import SiteFooter from "../footer/SiteFooter";
import Faq from "../sections/FAQSection"

export default function HomePage() {
  return (
    <CartProvider>
      <Navbar client:load transparent/> 
      <Hero />
      <TrustBar />
      <FeaturedProducts />
      <NeedHelp />
      <HowToOrder />
      <Faq/>
      <CartDrawer checkoutPath="/checkout" />
    </CartProvider>
  );
}