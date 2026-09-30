import { CartProvider } from "../cart/CartContext";
import LazyCartDrawer from "../cart/LazyCartDrawer";
import Navbar from "../nav/Navbar";
import TrackOrder from "../account/TrackOrder";

export default function TrackOrderPage() {
  return (
    <CartProvider>
      <Navbar />
      <TrackOrder />
      <LazyCartDrawer checkoutPath="/checkout" />
    </CartProvider>
  );
}
