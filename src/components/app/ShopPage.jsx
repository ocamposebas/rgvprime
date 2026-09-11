import { CartProvider } from "../cart/CartContext";
import LazyCartDrawer from "../cart/LazyCartDrawer";

import Navbar from "../nav/Navbar";
import ProductCatalog from "../catalog/ProductCatalog";
import SiteFooter from "../footer/SiteFooter";

export default function ShopPage() {
  return (
    <CartProvider>
      <Navbar />
      <ProductCatalog />
      <SiteFooter />

      <LazyCartDrawer checkoutPath="/checkout" />
    </CartProvider>
  );
}
