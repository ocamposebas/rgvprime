import { CartProvider } from "../cart/CartContext";
import Navbar from "../nav/Navbar";
import LazyCartDrawer from "../cart/LazyCartDrawer";
import AccountPortal from "./AccountPortal";

export default function AccountPageShell() {
  return (
    <CartProvider>
      <Navbar client:load transparent/> 
      <LazyCartDrawer />
      <AccountPortal />
    </CartProvider>
  );
}
