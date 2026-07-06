import { CartProvider } from "../cart/CartContext";
import CartDrawer from "../cart/CartDrawer";
import Navbar from "../nav/Navbar";
import SiteFooter from "../footer/SiteFooter";
import RgvCheckout from "./RgvCheckout";

export default function SingleProductPage({ slug }) {
  return (
    <CartProvider>
      <Navbar  transparent/>
      <RgvCheckout />
      <SiteFooter />
      <CartDrawer checkoutPath="/checkout" />
    </CartProvider>
  );
}