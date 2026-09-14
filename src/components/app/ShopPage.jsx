import { CartProvider } from "../cart/CartContext";
import LazyCartDrawer from "../cart/LazyCartDrawer";

import Navbar from "../nav/Navbar";
import ProductCatalog from "../catalog/ProductCatalog";

export default function ShopPage({ initialProducts = [] }) {
  return (
    <CartProvider>
      <Navbar />
      <ProductCatalog initialProducts={initialProducts} />

      <LazyCartDrawer checkoutPath="/checkout" />
    </CartProvider>
  );
}
