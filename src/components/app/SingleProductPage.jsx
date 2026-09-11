import { CartProvider } from "../cart/CartContext";
import LazyCartDrawer from "../cart/LazyCartDrawer";
import Navbar from "../nav/Navbar";
import SiteFooter from "../footer/SiteFooter";
import ProductDetails from "./ProductDetails";

export default function SingleProductPage({ slug }) {
  return (
    <CartProvider>
      <Navbar />
      <ProductDetails slug={slug} />
      <SiteFooter />
      <LazyCartDrawer checkoutPath="/checkout" />
    </CartProvider>
  );
}
