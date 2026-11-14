import { CartProvider } from "../cart/CartContext";
import LazyCartDrawer from "../cart/LazyCartDrawer";

import Navbar from "../nav/Navbar";
import ProductCatalog from "../catalog/ProductCatalog";

export default function ShopPage({ initialProducts, initialPage, initialFormat }) {
  return (
    <CartProvider>
      <Navbar />
      <ProductCatalog
        initialProducts={initialProducts}
        initialPage={initialPage}
        initialFormat={initialFormat}
      />

      <LazyCartDrawer checkoutPath="/checkout" />
    </CartProvider>
  );
}
