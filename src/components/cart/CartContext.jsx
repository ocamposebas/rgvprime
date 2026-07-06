import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const CART_STORAGE_KEY = "rgv-prime-cart-v1";

const OLD_FOREIGN_CART_KEYS = [
  "lab_cart",
  "phaseone_cart",
  "phaseone_pending_checkout",
  "phaseone_checkout_shipping",
  "phaseone_checkout_email",
];

const fallbackCart = {
  items: [],
  cartItems: [],
  itemCount: 0,
  subtotal: 0,
  cartTotal: 0,
  paidSubtotal: 0,
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

function getProductImage(product = {}) {
  return (
    product.image ||
    product.image_url ||
    product.imageUrl ||
    product.thumbnail ||
    product.images?.[0]?.src ||
    product.images?.[0]?.url ||
    product.product?.image ||
    product.product?.images?.[0]?.src ||
    "/logo.webp"
  );
}

function resolveProductId(product = {}) {
  return (
    product.product_id ||
    product.productId ||
    product.wc_product_id ||
    product.woo_product_id ||
    product.databaseId ||
    product.id ||
    0
  );
}

function resolveVariationId(product = {}) {
  return (
    product.variation_id ||
    product.variationId ||
    product.selectedVariationId ||
    product.variant_id ||
    product.variantId ||
    product.selectedVariant?.id ||
    product.variation?.id ||
    0
  );
}

function normalizeProduct(product, quantity = 1) {
  const productId = Number(resolveProductId(product) || 0);
  const variationId = Number(resolveVariationId(product) || 0);
  const cartId = variationId ? `${productId}:${variationId}` : String(productId);
  const name = product.name || product.title || product.product_name || "Product";
  const image = getProductImage(product);
  const price = toNumber(product.price || product.sale_price || product.regular_price || 0);

  return {
    id: String(cartId),
    product_id: productId,
    productId,
    wc_product_id: productId,
    variation_id: variationId,
    variationId,
    name,
    title: name,
    slug: product.slug || "",
    type: product.type || "simple",
    price,
    regular_price: toNumber(product.regular_price || product.price || 0),
    sale_price: toNumber(product.sale_price || product.price || 0),
    image,
    image_url: image,
    permalink: product.permalink || `/product/${product.slug || ""}`,
    sku: product.sku || "",
    stock_status: product.stock_status || "instock",
    stock_quantity:
      product.stock_quantity !== null &&
      product.stock_quantity !== undefined &&
      product.stock_quantity !== ""
        ? Number(product.stock_quantity)
        : null,
    quantity: Number(quantity || product.quantity || 1),
    selectedOption: product.selectedOption || product.selected_option || "",
    selectedAttributes:
      product.selectedAttributes ||
      product.selectedOptions ||
      product.variation ||
      product.variation_attributes ||
      {},
    variation:
      product.variation ||
      product.variation_attributes ||
      product.selectedAttributes ||
      product.selectedOptions ||
      {},
    cartKey: cartId,
    cart_key: cartId,
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

function cleanOldCartStorage() {
  if (typeof window === "undefined") return;

  OLD_FOREIGN_CART_KEYS.forEach((key) => {
    window.localStorage.removeItem(key);
  });
}

export function CartProvider({ children }) {
  const [items, setItems] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    try {
      cleanOldCartStorage();

      const savedCart = window.localStorage.getItem(CART_STORAGE_KEY);

      if (savedCart) {
        const parsed = JSON.parse(savedCart);

        if (Array.isArray(parsed)) {
          const normalizedItems = parsed
            .map((item) => normalizeProduct(item, Number(item.quantity || 1)))
            .filter((item) => item.product_id > 0 && item.quantity > 0);

          setItems(normalizedItems);
        }
      }
    } catch (error) {
      console.error("Cart storage error:", error);
      setItems([]);
      window.localStorage.removeItem(CART_STORAGE_KEY);
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

    if (!newItem.product_id) {
      console.error("Invalid product added to cart:", product);
      return;
    }

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
            quantity: Math.min(Number(quantity || 1), getMaxQuantity(newItem)),
          },
        ];
      }

      const maxQuantity = getMaxQuantity(existingItem);
      const nextQuantity = Math.min(
        Number(existingItem.quantity || 1) + Number(quantity || 1),
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
      currentItems.filter((item) => {
        const cleanId = String(productId);

        return (
          item.id !== cleanId &&
          String(item.product_id) !== cleanId &&
          String(item.variation_id) !== cleanId
        );
      })
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
        const cleanId = String(productId);
        const matches =
          item.id === cleanId ||
          String(item.product_id) === cleanId ||
          String(item.variation_id) === cleanId;

        if (!matches) return item;

        return {
          ...item,
          quantity: Math.min(nextQuantity, getMaxQuantity(item)),
        };
      })
    );
  }

  function clearCart() {
    setItems([]);

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(CART_STORAGE_KEY);
      cleanOldCartStorage();
    }
  }

  const itemCount = useMemo(() => {
    return items.reduce((total, item) => total + Number(item.quantity || 0), 0);
  }, [items]);

  const subtotal = useMemo(() => {
    return items.reduce((total, item) => {
      return total + Number(item.price || 0) * Number(item.quantity || 1);
    }, 0);
  }, [items]);

  const value = {
    items,
    cartItems: items,
    itemCount,
    subtotal,
    cartTotal: subtotal,
    paidSubtotal: subtotal,
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
