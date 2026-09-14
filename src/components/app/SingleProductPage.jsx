import { CartProvider } from "../cart/CartContext";
import LazyCartDrawer from "../cart/LazyCartDrawer";
import Navbar from "../nav/Navbar";
import ProductDetails from "./ProductDetails";

export default function SingleProductPage({ slug, initialProduct = null }) {
  return (
    <CartProvider>
      <Navbar />
      <ProductDetails slug={slug} initialProduct={initialProduct} />
      <LazyCartDrawer checkoutPath="/checkout" />
    </CartProvider>
  );
}
