import { CartProvider } from "../cart/CartContext";
import CartDrawer from "../cart/CartDrawer";
import Navbar from "../nav/Navbar";
import RgvCheckout from "./RgvCheckout";

export default function CheckoutPage() {
  return (
    <CartProvider>
      <Navbar />
      <RgvCheckout />
      <CartDrawer checkoutPath="/checkout" />
    </CartProvider>
  );
}
