import { CartProvider } from "../cart/CartContext";
import CartDrawer from "../cart/CartDrawer";
import Navbar from "../nav/Navbar";
import SiteFooter from "../footer/SiteFooter";
import ProductDetails from "./ProductDetails";

export default function SingleProductPage({ slug }) {
  return (
    <CartProvider>
      <Navbar />
      <ProductDetails slug={slug} />
      <SiteFooter />
      <CartDrawer checkoutPath="/checkout" />
    </CartProvider>
  );
}