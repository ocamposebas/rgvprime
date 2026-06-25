import { CartProvider } from "../cart/CartContext";
import CartDrawer from "../cart/CartDrawer";
import Navbar from "../nav/Navbar";
import SiteFooter from "../footer/SiteFooter";
import TrackOrder  from "../account/TrackOrder";

export default function SingleProductPage({ slug }) {
  return (
    <CartProvider>
      <Navbar />
      <TrackOrder />
      <SiteFooter />
      <CartDrawer checkoutPath="/checkout" />
    </CartProvider>
  );
}