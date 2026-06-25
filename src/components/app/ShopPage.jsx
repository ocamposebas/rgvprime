import { CartProvider } from "../cart/CartContext";
import CartDrawer from "../cart/CartDrawer";

import Navbar from "../nav/Navbar";
import ProductCatalog from "../catalog/ProductCatalog";
import SiteFooter from "../footer/SiteFooter";

export default function ShopPage() {
  return (
    <CartProvider>
      <Navbar />
      <ProductCatalog />
      <SiteFooter />

      <CartDrawer checkoutPath="/checkout" />
    </CartProvider>
  );
}