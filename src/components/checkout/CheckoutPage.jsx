import { CartProvider } from "../cart/CartContext";
import LazyCartDrawer from "../cart/LazyCartDrawer";
import { ArrowLeft, ArrowUpRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { CHECKOUT_PAUSED } from "../../lib/checkoutAvailability";
import RgvCheckout from "./RgvCheckout";
import "./CheckoutPage.css";
import "../../styles/experience.css";
import "./CheckoutPremium.css";

function ProcessorUpdate() {
  return (
    <div className="rgv-checkout rgv-checkout--processor-update">
      <header className="rgvx-checkout-nav rgvx-processor-nav">
        <div className="rgvx-checkout-nav-inner">
          <a href="/" className="rgvx-checkout-logo" aria-label="RGVPRIME home">
            <img src="/logo.webp" alt="RGVPRIME" width="164" height="46" />
          </a>

          <div className="rgvx-checkout-nav-secure">
            <LockKeyhole size={15} aria-hidden="true" />
            <span>Checkout update</span>
          </div>

          <a href="/shop" className="rgvx-checkout-back">
            <ArrowLeft size={15} aria-hidden="true" />
            <span>Continue shopping</span>
          </a>
        </div>
      </header>

      <main className="rgvx-processor-update" aria-labelledby="processor-update-title">
        <div className="rgvx-processor-backdrop" aria-hidden="true">
          <div className="rgvx-processor-ambient" />
          <svg
            className="rgvx-processor-ribbon"
            viewBox="0 0 1200 900"
            width="1200"
            height="900"
            fill="none"
            focusable="false"
          >
            <defs>
              <linearGradient id="rgvx-processor-surface" x1="690" y1="50" x2="1070" y2="850" gradientUnits="userSpaceOnUse">
                <stop stopColor="#140609" />
                <stop offset=".22" stopColor="#69101b" />
                <stop offset=".38" stopColor="#b5232c" />
                <stop offset=".48" stopColor="#3d090f" />
                <stop offset=".64" stopColor="#8f1522" />
                <stop offset=".84" stopColor="#2a080d" />
                <stop offset="1" stopColor="#090a0c" />
              </linearGradient>
              <linearGradient id="rgvx-processor-fold" x1="585" y1="400" x2="1030" y2="600" gradientUnits="userSpaceOnUse">
                <stop stopColor="#26070d" />
                <stop offset=".36" stopColor="#a21d29" />
                <stop offset=".63" stopColor="#580c17" />
                <stop offset="1" stopColor="#12070a" />
              </linearGradient>
              <linearGradient id="rgvx-processor-edge" x1="750" y1="100" x2="915" y2="860" gradientUnits="userSpaceOnUse">
                <stop stopColor="#a72830" stopOpacity="0" />
                <stop offset=".33" stopColor="#eb6256" stopOpacity=".7" />
                <stop offset=".56" stopColor="#a51f2b" stopOpacity=".4" />
                <stop offset=".78" stopColor="#d74741" stopOpacity=".6" />
                <stop offset="1" stopColor="#a72830" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M1085-90C1050 92 1094 164 895 277C713 380 522 391 561 516C608 666 929 649 1082 823L1165 965H1290C1233 731 1063 623 862 568C682 519 741 438 957 355C1171 273 1177 97 1249-90Z" fill="url(#rgvx-processor-surface)" />
            <path d="M561 516C595 625 923 617 1082 823C966 694 778 705 650 638C548 584 510 460 661 402C583 444 543 467 561 516Z" fill="url(#rgvx-processor-fold)" />
            <path d="M1085-90C1050 92 1094 164 895 277C713 380 522 391 561 516C608 666 929 649 1082 823" stroke="url(#rgvx-processor-edge)" strokeWidth="1.4" />
            <path d="M1249-90C1177 97 1171 273 957 355C741 438 682 519 862 568C1063 623 1233 731 1290 965" stroke="url(#rgvx-processor-edge)" strokeWidth="1" />
          </svg>
        </div>

        <div className="rgvx-processor-shell">
          <div className="rgvx-processor-copy">
            <p className="rgvx-processor-kicker">
              <span aria-hidden="true" />
              Checkout update
            </p>

            <h1 id="processor-update-title" className="rgvx-processor-title">
              <span>Checkout</span>
              <span className="rgvx-processor-title-accent">
                in progress<span aria-hidden="true">.</span>
              </span>
            </h1>

            <div className="rgvx-processor-intro">
              <span aria-hidden="true" />
              <p>
                We’re finishing our payment processor to make checkout smoother,
                faster, and more secure. Payments are temporarily paused while we
                put the final details in place.
              </p>
            </div>

            <div className="rgvx-processor-actions">
              <a href="/shop" className="rgvx-processor-primary">
                Return to the collection
                <ArrowUpRight size={18} strokeWidth={1.7} aria-hidden="true" />
              </a>
              <div className="rgvx-processor-status">
                <ShieldCheck size={17} strokeWidth={1.6} aria-hidden="true" />
                <span>
                  <strong>Payments are safely paused</strong>
                  Your cart will be here when checkout returns.
                </span>
              </div>
            </div>
          </div>

          <div className="rgvx-processor-baseline" role="status" aria-label="Checkout update status">
            <span>Payment processor</span>
            <strong><i aria-hidden="true" /> Currently being prepared</strong>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function CheckoutPage() {
  if (CHECKOUT_PAUSED) {
    return <ProcessorUpdate />;
  }

  return (
    <CartProvider>
      <div className="rgv-checkout">
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
        <LazyCartDrawer checkoutPath="/checkout" />
      </div>
    </CartProvider>
  );
}
