import { CartProvider } from "../cart/CartContext";
import Navbar from "../nav/Navbar";
import CartDrawer from "../cart/CartDrawer";
import AccountPortal from "./AccountPortal";

export default function AccountPageShell() {
  return (
    <CartProvider>
      <Navbar client:load transparent/> 
      <CartDrawer />
      <AccountPortal />
    </CartProvider>
  );
}