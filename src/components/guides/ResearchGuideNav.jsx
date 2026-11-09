import { CartProvider } from "../cart/CartContext";
import LazyCartDrawer from "../cart/LazyCartDrawer";
import Navbar from "../nav/Navbar";

export default function ResearchGuideNav() {
  return (
    <CartProvider>
      <Navbar />
      <LazyCartDrawer checkoutPath="/checkout" />
    </CartProvider>
  );
}
