import { CartProvider } from "../cart/CartContext";
import RgvCheckout from "./RgvCheckout";

export default function CheckoutPage() {
  return (
    <CartProvider>
      <RgvCheckout />
    </CartProvider>
  );
}
