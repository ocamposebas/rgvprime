import { CartProvider } from "../cart/CartContext";
import LazyCartDrawer from "../cart/LazyCartDrawer";
import Navbar from "../nav/Navbar";
import SiteFooter from "../footer/SiteFooter";
import TrackOrder  from "../account/TrackOrder";

export default function SingleProductPage({ slug }) {
  return (
    <CartProvider>
      <Navbar />
      <TrackOrder />
      <SiteFooter />
      <LazyCartDrawer checkoutPath="/checkout" />
    </CartProvider>
  );
}
