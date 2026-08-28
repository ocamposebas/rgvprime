import { CartProvider } from "../cart/CartContext";
import CartDrawer from "../cart/CartDrawer";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import RgvCheckout from "./RgvCheckout";
import "./Exrgvcheckout.css";

export default function CheckoutPage() {
  return (
    <CartProvider>
      <header className="rgvx-checkout-nav">
        <div className="rgvx-checkout-nav-inner">
          <a href="/" className="rgvx-checkout-logo" aria-label="RGVPRIME home">
            <img src="/logo.webp" alt="RGVPRIME" width="164" height="46" />
          </a>

          <div className="rgvx-checkout-nav-secure">
            <LockKeyhole size={15} aria-hidden="true" />
            <span>Secure checkout</span>
          </div>

          <a href="/shop" className="rgvx-checkout-back">
            <ArrowLeft size={15} aria-hidden="true" />
            <span>Continue shopping</span>
          </a>
        </div>
      </header>
      <RgvCheckout />
      <CartDrawer checkoutPath="/checkout" />
    </CartProvider>
  );
}
