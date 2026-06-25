import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const CART_STORAGE_KEY = "rgv-prime-cart-v1";

const fallbackCart = {
  items: [],
  itemCount: 0,
  subtotal: 0,
  isCartOpen: false,
  openCart: () => {},
  closeCart: () => {},
  toggleCart: () => {},
  addItem: () => {},
  removeItem: () => {},
  updateQuantity: () => {},
  clearCart: () => {},
};

const CartContext = createContext(fallbackCart);

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeProduct(product, quantity = 1) {
  return {
    id: String(product.id),
    name: product.name || "Product",
    slug: product.slug || "",
    type: product.type || "simple",
    price: toNumber(product.price || product.regular_price || 0),
    image: product.image || "/logo.webp",
    permalink: product.permalink || `/product/${product.slug}`,
    stock_status: product.stock_status || "instock",
    stock_quantity:
      product.stock_quantity !== null &&
      product.stock_quantity !== undefined &&
      product.stock_quantity !== ""
        ? Number(product.stock_quantity)
        : null,
    quantity,
  };
}

function getMaxQuantity(item) {
  if (
    item.stock_quantity !== null &&
    item.stock_quantity !== undefined &&
    Number.isFinite(Number(item.stock_quantity)) &&
    Number(item.stock_quantity) > 0
  ) {
    return Number(item.stock_quantity);
  }

  return 99;
}

export function CartProvider({ children }) {
  const [items, setItems] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    try {
      const savedCart = window.localStorage.getItem(CART_STORAGE_KEY);

      if (savedCart) {
        const parsed = JSON.parse(savedCart);

        if (Array.isArray(parsed)) {
          setItems(parsed);
        }
      }
    } catch (error) {
      console.error("Cart storage error:", error);
    } finally {
      setHasHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;

    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch (error) {
      console.error("Cart save error:", error);
    }
  }, [items, hasHydrated]);

  function openCart() {
    setIsCartOpen(true);
  }

  function closeCart() {
    setIsCartOpen(false);
  }

  function toggleCart() {
    setIsCartOpen((prev) => !prev);
  }

  function addItem(product, quantity = 1) {
    const newItem = normalizeProduct(product, quantity);

    if (newItem.stock_status !== "instock") {
      openCart();
      return;
    }

    setItems((currentItems) => {
      const existingItem = currentItems.find((item) => item.id === newItem.id);

      if (!existingItem) {
        return [
          ...currentItems,
          {
            ...newItem,
            quantity: Math.min(quantity, getMaxQuantity(newItem)),
          },
        ];
      }

      const maxQuantity = getMaxQuantity(existingItem);
      const nextQuantity = Math.min(
        existingItem.quantity + quantity,
        maxQuantity
      );

      return currentItems.map((item) =>
        item.id === newItem.id
          ? {
              ...item,
              quantity: nextQuantity,
            }
          : item
      );
    });

    openCart();
  }

  function removeItem(productId) {
    setItems((currentItems) =>
      currentItems.filter((item) => item.id !== String(productId))
    );
  }

  function updateQuantity(productId, quantity) {
    const nextQuantity = Number(quantity);

    if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
      removeItem(productId);
      return;
    }

    setItems((currentItems) =>
      currentItems.map((item) => {
        if (item.id !== String(productId)) return item;

        return {
          ...item,
          quantity: Math.min(nextQuantity, getMaxQuantity(item)),
        };
      })
    );
  }

  function clearCart() {
    setItems([]);
  }

  const itemCount = useMemo(() => {
    return items.reduce((total, item) => total + item.quantity, 0);
  }, [items]);

  const subtotal = useMemo(() => {
    return items.reduce(
      (total, item) => total + item.price * item.quantity,
      0
    );
  }, [items]);

  const value = {
    items,
    itemCount,
    subtotal,
    isCartOpen,
    openCart,
    closeCart,
    toggleCart,
    addItem,
    removeItem,
    updateQuantity,
    clearCart,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  return useContext(CartContext);
}   