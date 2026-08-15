import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getOmnisendCartFingerprint,
  getRememberedOmnisendEmail,
  identifyOmnisendContact,
  readCartRecoveryFromUrl,
  resetOmnisendCartSession,
  trackOmnisendCart,
  trackOmnisendStartedCheckout,
} from "../../lib/omnisendCart";
import { getMeOnce } from "../../lib/accountSession";
import {
  getMaximumPurchasableQuantity,
  isProductAvailable,
} from "../../lib/inventory";

const CART_STORAGE_KEY = "rgv-prime-cart-v1";
const OMNISEND_CHECKOUT_SIGNATURE_KEY =
  "rgv-prime-omnisend-checkout-signature-v1";

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
  cartNotice: "",
  isCheckingStock: false,
  isCartOpen: false,
  openCart: () => {},
  closeCart: () => {},
  toggleCart: () => {},
  addItem: () => {},
  removeItem: () => {},
  updateQuantity: () => {},
  clearCart: () => {},
  clearCartNotice: () => {},
  validateStock: () => Promise.resolve({ success: false, valid: false }),
  identifyContact: () => Promise.resolve(false),
  trackStartedCheckout: () => Promise.resolve(false),
};

const CartContext = createContext(fallbackCart);

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeEmail(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isValidEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
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

function resolveProductUrl(product = {}) {
  const slug = String(product?.slug || "")
    .replace(/^\/+|\/+$/g, "")
    .trim();

  return slug ? `/product/${slug}` : "/shop";
}

function normalizeProduct(product, quantity = 1) {
  const productId = Number(resolveProductId(product) || 0);
  const variationId = Number(resolveVariationId(product) || 0);
  const cartId = variationId
    ? `${productId}:${variationId}`
    : String(productId);
  const name =
    product.name || product.title || product.product_name || "Product";
  const image = getProductImage(product);
  const price = toNumber(
    product.price || product.sale_price || product.regular_price || 0,
  );
  const shortDescription =
    product.short_description ||
    product.shortDescription ||
    product.product?.short_description ||
    "";
  const description =
    product.description || product.product?.description || shortDescription;

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
    permalink: resolveProductUrl(product),
    sku: product.sku || "",
    stock_status: String(product.stock_status || "unknown").toLowerCase(),
    stock_quantity:
      product.stock_quantity !== null &&
      product.stock_quantity !== undefined &&
      product.stock_quantity !== ""
        ? Number(product.stock_quantity)
        : null,
    manage_stock: product.manage_stock === true,
    backorders_allowed: product.backorders_allowed === true,
    purchasable: product.purchasable !== false,
    quantity: Number(quantity || product.quantity || 1),
    selectedOption: product.selectedOption || product.selected_option || "",
    selectedAttributes:
      product.selectedAttributes ||
      product.selectedOptions ||
      product.variation ||
      product.variation_attributes ||
      {},
    short_description: shortDescription,
    description,
    categories: Array.isArray(product.categories) ? product.categories : [],
    coa_url:
      product.coa_url || product.coaURL || product.documentation_url || "",
    coa_code: product.coa_code || product.coaCode || "",
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
  return getMaximumPurchasableQuantity(item, 99);
}

function cleanOldCartStorage() {
  if (typeof window === "undefined") return;

  OLD_FOREIGN_CART_KEYS.forEach((key) => {
    window.localStorage.removeItem(key);
  });
}

function isCheckoutPage() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  return (
    /(^|\/)checkout(\/|$)/i.test(window.location.pathname) ||
    Boolean(document.querySelector(".rgvx-shell"))
  );
}

export function CartProvider({ children }) {
  const [items, setItems] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [cartNotice, setCartNotice] = useState("");
  const [isCheckingStock, setIsCheckingStock] = useState(false);

  const itemsRef = useRef([]);
  const pendingOmnisendItemRef = useRef(null);
  const pendingAdditionsRef = useRef(new Set());
  const identifiedEmailRef = useRef("");
  const lastCheckoutSignatureRef = useRef("");

  useEffect(() => {
    try {
      cleanOldCartStorage();
      identifiedEmailRef.current = getRememberedOmnisendEmail();

      const recoveredCart = readCartRecoveryFromUrl();
      const savedCart = window.localStorage.getItem(CART_STORAGE_KEY);
      const parsedSavedCart = savedCart ? JSON.parse(savedCart) : [];
      const parsed = recoveredCart.length ? recoveredCart : parsedSavedCart;

      if (Array.isArray(parsed)) {
        const normalizedItems = parsed
          .map((item) => normalizeProduct(item, Number(item.quantity || 1)))
          .filter((item) => item.product_id > 0 && item.quantity > 0);

        setItems(normalizedItems);
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
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (!hasHydrated) return;

    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch (error) {
      console.error("Cart save error:", error);
    }
  }, [items, hasHydrated]);

  const identifyContact = useCallback(async (email) => {
    const cleanEmail = normalizeEmail(email);

    if (!isValidEmail(cleanEmail)) return false;

    identifiedEmailRef.current = cleanEmail;
    return identifyOmnisendContact({ email: cleanEmail });
  }, []);

  const trackStartedCheckout = useCallback(async (email, currentItems) => {
    const cleanEmail = normalizeEmail(email);
    const checkoutItems = Array.isArray(currentItems)
      ? currentItems
      : itemsRef.current;

    if (!isValidEmail(cleanEmail) || checkoutItems.length === 0) return false;

    identifiedEmailRef.current = cleanEmail;

    const signature = getOmnisendCartFingerprint(checkoutItems, cleanEmail);
    let storedSignature = "";

    try {
      storedSignature =
        window.sessionStorage.getItem(OMNISEND_CHECKOUT_SIGNATURE_KEY) || "";
    } catch {
      storedSignature = "";
    }

    if (
      signature === lastCheckoutSignatureRef.current ||
      signature === storedSignature
    ) {
      return true;
    }

    await identifyOmnisendContact({ email: cleanEmail });

    // Send both native events after identification. The first keeps the
    // existing Abandoned Cart workflow active, and the second supports the
    // dedicated Abandoned Checkout workflow.
    const cartTracked = trackOmnisendCart(
      checkoutItems,
      checkoutItems.at(-1) || null,
      { email: cleanEmail },
    );
    const checkoutTracked = trackOmnisendStartedCheckout(checkoutItems, {
      email: cleanEmail,
    });
    const tracked = cartTracked || checkoutTracked;

    if (tracked) {
      lastCheckoutSignatureRef.current = signature;

      try {
        window.sessionStorage.setItem(
          OMNISEND_CHECKOUT_SIGNATURE_KEY,
          signature,
        );
      } catch {
        // The in-memory signature still prevents duplicates if storage is blocked.
      }
    }

    return tracked;
  }, []);

  useEffect(() => {
    if (!hasHydrated || !items.length || !pendingOmnisendItemRef.current) {
      return;
    }

    const addedItem = pendingOmnisendItemRef.current;
    pendingOmnisendItemRef.current = null;

    async function sendCartEvent() {
      let email = identifiedEmailRef.current || getRememberedOmnisendEmail();

      if (!email) {
        try {
          const account = await getMeOnce();
          email = normalizeEmail(account?.data?.user?.email || "");
        } catch (error) {
          console.warn("Unable to identify account for cart tracking:", error);
        }
      }

      if (isValidEmail(email)) {
        identifiedEmailRef.current = email;
        await identifyOmnisendContact({ email });
      }

      trackOmnisendCart(items, addedItem, { email });
    }

    void sendCartEvent();
  }, [items, hasHydrated]);

  useEffect(() => {
    if (!hasHydrated || typeof document === "undefined") return undefined;

    let debounceTimer = null;

    const processEmailField = (target) => {
      if (!isCheckoutPage() || itemsRef.current.length === 0) return;

      if (
        typeof HTMLInputElement === "undefined" ||
        !(target instanceof HTMLInputElement)
      ) {
        return;
      }

      const isEmailField =
        target.type === "email" || target.autocomplete === "email";

      if (!isEmailField || !isValidEmail(target.value)) return;

      void trackStartedCheckout(target.value, itemsRef.current);
    };

    const scheduleEmailCapture = (event) => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(
        () => processEmailField(event.target),
        event.type === "input" ? 600 : 0,
      );
    };

    document.addEventListener("input", scheduleEmailCapture, true);
    document.addEventListener("change", scheduleEmailCapture, true);
    document.addEventListener("focusout", scheduleEmailCapture, true);

    const initialScanTimer = window.setTimeout(() => {
      const emailField = document.querySelector(
        'input[type="email"], input[autocomplete="email"]',
      );
      processEmailField(emailField);
    }, 1000);

    return () => {
      window.clearTimeout(debounceTimer);
      window.clearTimeout(initialScanTimer);
      document.removeEventListener("input", scheduleEmailCapture, true);
      document.removeEventListener("change", scheduleEmailCapture, true);
      document.removeEventListener("focusout", scheduleEmailCapture, true);
    };
  }, [hasHydrated, trackStartedCheckout]);

  function openCart() {
    setIsCartOpen(true);
  }

  function closeCart() {
    setIsCartOpen(false);
  }

  function toggleCart() {
    setIsCartOpen((previous) => !previous);
  }

  const clearCartNotice = useCallback(() => setCartNotice(""), []);

  const validateStock = useCallback(async (currentItems, options = {}) => {
    const itemsToValidate = Array.isArray(currentItems)
      ? currentItems
      : itemsRef.current;
    const reconcile = options.reconcile !== false;
    const reportStatus = options.reportStatus !== false;

    if (!itemsToValidate.length) {
      return { success: true, valid: false, items: [] };
    }

    if (reportStatus) setIsCheckingStock(true);

    try {
      const response = await fetch("/api/cart/validate-stock", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          items: itemsToValidate.map((item) => ({
            cart_id: item.id || item.cartKey || item.cart_key,
            product_id: item.product_id || item.productId,
            variation_id: item.variation_id || item.variationId || 0,
            quantity: Number(item.quantity || 1),
            name: item.name || item.title || "Product",
          })),
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || data?.success !== true || !Array.isArray(data.items)) {
        throw new Error(data?.message || "Inventory could not be verified.");
      }

      const validationById = new Map(
        data.items.map((item) => [String(item.cart_id), item]),
      );
      const unavailable = data.items.filter((item) => !item.available);
      const reduced = data.items.filter(
        (item) => item.available && item.valid === false,
      );

      if (reconcile) {
        setItems((storedItems) =>
          storedItems.flatMap((item) => {
            const validation = validationById.get(String(item.id));
            if (!validation) return [];
            if (!validation.available) return [];

            const availableQuantity = Number(validation.stock_quantity);
            const hasStockLimit =
              validation.backorders_allowed !== true &&
              validation.stock_quantity !== null &&
              Number.isFinite(availableQuantity);

            return [
              {
                ...item,
                name: validation.name || item.name,
                stock_status: validation.stock_status,
                stock_quantity: validation.stock_quantity,
                backorders_allowed: validation.backorders_allowed === true,
                quantity: hasStockLimit
                  ? Math.min(Number(item.quantity || 1), availableQuantity)
                  : Number(item.quantity || 1),
              },
            ];
          }),
        );
      }

      if (reportStatus && unavailable.length) {
        const names = unavailable.map((item) => item.name).join(", ");
        setCartNotice(`Removed from cart because it is sold out: ${names}.`);
      } else if (reportStatus && reduced.length) {
        const names = reduced.map((item) => item.name).join(", ");
        setCartNotice(`Quantity adjusted to current stock for: ${names}.`);
      } else if (reportStatus) {
        setCartNotice("");
      }

      return data;
    } catch (error) {
      const message =
        error?.message || "Inventory could not be verified. Please try again.";
      if (reportStatus) setCartNotice(message);
      return { success: false, valid: false, message, items: [] };
    } finally {
      if (reportStatus) setIsCheckingStock(false);
    }
  }, []);

  async function addItem(product, quantity = 1) {
    const newItem = normalizeProduct(product, quantity);

    if (!newItem.product_id) {
      console.error("Invalid product added to cart:", product);
      return { success: false, valid: false };
    }

    const hasKnownInventory =
      newItem.stock_status !== "unknown" || newItem.stock_quantity !== null;

    if (hasKnownInventory && !isProductAvailable(newItem, quantity)) {
      setCartNotice(`${newItem.name} is sold out and was not added to your cart.`);
      openCart();
      return { success: true, valid: false };
    }

    if (pendingAdditionsRef.current.has(newItem.id)) {
      return { success: false, valid: false, pending: true };
    }

    pendingAdditionsRef.current.add(newItem.id);

    try {
      const existingItem = itemsRef.current.find((item) => item.id === newItem.id);
      const desiredQuantity =
        Number(existingItem?.quantity || 0) + Math.max(1, Number(quantity) || 1);
      const validation = await validateStock(
        [{ ...newItem, quantity: desiredQuantity }],
        { reconcile: false, reportStatus: false },
      );
      const liveItem = validation.items?.[0];

      if (!validation.success || !validation.valid || !liveItem?.available) {
        if (liveItem && !liveItem.available) {
          setCartNotice(`${liveItem.name} is sold out and was not added to your cart.`);
        } else if (liveItem?.reason === "insufficient_stock") {
          setCartNotice(
            `Only ${liveItem.allowed_quantity} unit(s) of ${liveItem.name} are available.`,
          );
        } else {
          setCartNotice(
            validation.message || "Inventory could not be verified. Please try again.",
          );
        }

        openCart();
        return { ...validation, valid: false };
      }

      const verifiedItem = {
        ...newItem,
        stock_status: liveItem.stock_status,
        stock_quantity: liveItem.stock_quantity,
        backorders_allowed: liveItem.backorders_allowed === true,
      };

      pendingOmnisendItemRef.current = verifiedItem;

      setItems((currentItems) => {
        const currentItem = currentItems.find((item) => item.id === verifiedItem.id);

        if (!currentItem) {
          return [
            ...currentItems,
            {
              ...verifiedItem,
              quantity: Math.min(
                Number(quantity || 1),
                getMaxQuantity(verifiedItem),
              ),
            },
          ];
        }

        const maxQuantity = getMaxQuantity(verifiedItem);
        const nextQuantity = Math.min(
          Number(currentItem.quantity || 1) + Number(quantity || 1),
          maxQuantity,
        );

        return currentItems.map((item) =>
          item.id === verifiedItem.id
            ? {
                ...item,
                ...verifiedItem,
                quantity: nextQuantity,
              }
            : item,
        );
      });

      setCartNotice("");
      openCart();
      return { success: true, valid: true, item: verifiedItem };
    } finally {
      pendingAdditionsRef.current.delete(newItem.id);
    }
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
      }),
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
      }),
    );
  }

  function clearCart() {
    setItems([]);
    setCartNotice("");
    pendingOmnisendItemRef.current = null;
    identifiedEmailRef.current = "";
    lastCheckoutSignatureRef.current = "";
    resetOmnisendCartSession();

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(CART_STORAGE_KEY);

      try {
        window.sessionStorage.removeItem(OMNISEND_CHECKOUT_SIGNATURE_KEY);
      } catch {
        // Nothing else is required when session storage is unavailable.
      }

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
    cartNotice,
    isCheckingStock,
    isCartOpen,
    openCart,
    closeCart,
    toggleCart,
    addItem,
    removeItem,
    updateQuantity,
    clearCart,
    clearCartNotice,
    validateStock,
    identifyContact,
    trackStartedCheckout,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  return useContext(CartContext);
}
