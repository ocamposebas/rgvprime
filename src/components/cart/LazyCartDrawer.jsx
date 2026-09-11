import { lazy, Suspense } from "react";
import { useCart } from "./CartContext";

const CartDrawer = lazy(() => import("./CartDrawer"));

export default function LazyCartDrawer({ checkoutPath = "/checkout" }) {
  const { isCartOpen } = useCart();

  if (!isCartOpen) return null;

  return (
    <Suspense fallback={null}>
      <CartDrawer checkoutPath={checkoutPath} />
    </Suspense>
  );
}
