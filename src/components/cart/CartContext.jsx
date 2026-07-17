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
  getRememberedOmnisendEmail,
  identifyOmnisendContact,
  readCartRecoveryFromUrl,
  resetOmnisendCartSession,
  trackOmnisendCart,
} from "../../lib/omnisendCart";
import { getMeOnce } from "../../lib/accountSession";

const CART_STORAGE_KEY = "rgv-prime-cart-v1";
const CART_ID_STORAGE_KEY = "rgv-prime-cart-id-v1";
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
  isCartOpen: false,
  openCart: () => {},
  closeCart: () => {},
  toggleCart: () => {},
  addItem: () => {},
  removeItem: () => {},
  updateQuantity: () => {},
  clearCart: () => {},
  identifyContact: () => false,
  trackStartedCheckout: () => false,
};

const CartContext = createContext(fallbackCart);

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
  return Number(toNumber(value).toFixed(2));
}

function normalizeEmail(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isValidEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function stripHtml(value = "") {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const cartId = variationId
    ? `${productId}:${variationId}`
    : String(productId);
  const name =
    product.name || product.title || product.product_name || "Product";
  const image = getProductImage(product);
  const price = toNumber(
    product.price || product.sale_price || product.regular_price || 0,
  );

  return {
    id: String(cartId),
    product_id: productId,
    productId,
    wc_product_id: productId,
    variation_id: variationId,
    variationId,
    name,
    title: name,
    description: stripHtml(
      product.short_description || product.description || "",
    ),
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
    short_description:
      product.short_description ||
      product.shortDescription ||
      product.product?.short_description ||
      "",
    description: product.description || product.product?.description || "",
    categories: Array.isArray(product.categories) ? product.categories : [],
    coa_url: product.coa_url || product.coaURL || product.documentation_url || "",
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

function createUuid() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function getOrCreateCartId() {
  if (typeof window === "undefined") return createUuid();

  try {
    const currentId = window.localStorage.getItem(CART_ID_STORAGE_KEY);

    if (currentId) return currentId;

    const nextId = createUuid();
    window.localStorage.setItem(CART_ID_STORAGE_KEY, nextId);
    return nextId;
  } catch (error) {
    console.error("Cart ID storage error:", error);
    return createUuid();
  }
}

function toAbsoluteUrl(value, fallbackPath = "/shop") {
  if (typeof window === "undefined") {
    return `https://rgvprimellc.com${fallbackPath}`;
  }

  try {
    return new URL(value || fallbackPath, window.location.origin).toString();
  } catch {
    return new URL(fallbackPath, window.location.origin).toString();
  }
}

function getCheckoutUrl() {
  return toAbsoluteUrl("/checkout", "/checkout");
}

function buildOmnisendLineItem(item = {}) {
  const price = roundMoney(item.price);
  const regularPrice = roundMoney(item.regular_price);
  const productId = String(item.product_id || item.productId || item.id || "");
  const variationId = String(item.variation_id || item.variationId || "");
  const imageUrl = toAbsoluteUrl(item.image_url || item.image, "/logo.webp");

  const lineItem = {
    productID: productId,
    productTitle: String(item.name || item.title || "Product"),
    productDescription: stripHtml(item.description || ""),
    productImageURL: imageUrl,
    productPrice: price,
    productQuantity: Math.max(1, Number(item.quantity || 1)),
    productURL: toAbsoluteUrl(
      item.permalink || `/product/${item.slug || ""}`,
      "/shop",
    ),
  };

  if (item.sku) {
    lineItem.productSKU = String(item.sku);
  }

  if (variationId && variationId !== "0") {
    lineItem.productVariantID = variationId;
    lineItem.productVariantImageURL = imageUrl;
  }

  if (regularPrice > price && price >= 0) {
    lineItem.productStrikeThroughPrice = regularPrice;
    lineItem.productDiscount = roundMoney(regularPrice - price);
  }

  return lineItem;
}

function getCartValue(items = []) {
  return roundMoney(
    items.reduce((total, item) => {
      return (
        total + toNumber(item.price) * Math.max(1, Number(item.quantity || 1))
      );
    }, 0),
  );
}

function getOmnisendClient() {
  if (typeof window === "undefined") return null;

  window.omnisend = window.omnisend || [];
  return window.omnisend;
}

function identifyOmnisendContact(email) {
  const cleanEmail = normalizeEmail(email);

  if (!isValidEmail(cleanEmail)) return false;

  const omnisend = getOmnisendClient();

  if (!omnisend) return false;

  if (typeof omnisend.identifyContact === "function") {
    try {
      omnisend.identifyContact({ email: cleanEmail });
    } catch (error) {
      console.error("Omnisend contact identification error:", error);
    }
  }

  return true;
}

function trackOmnisendCartEvent({
  eventName,
  items,
  addedItem = null,
  email = "",
}) {
  if (!Array.isArray(items) || items.length === 0) return false;

  const omnisend = getOmnisendClient();

  if (!omnisend || typeof omnisend.push !== "function") return false;

  const lineItems = items.map(buildOmnisendLineItem);
  const cleanEmail = normalizeEmail(email);
  const event = {
    origin: "api",
    eventID: createUuid(),
    eventVersion: "",
    eventTime: new Date().toISOString(),
    properties: {
      abandonedCheckoutURL: getCheckoutUrl(),
      cartID: getOrCreateCartId(),
      currency: "USD",
      lineItems,
      value: getCartValue(items),
    },
  };

  if (addedItem) {
    event.properties.addedItem = buildOmnisendLineItem(addedItem);
  }

  if (isValidEmail(cleanEmail)) {
    event.contact = { email: cleanEmail };
  }

  try {
    omnisend.push(["track", eventName, event]);
    return true;
  } catch (error) {
    console.error(`Omnisend ${eventName} tracking error:`, error);
    return false;
  }
}

function getCheckoutSignature(email, items = []) {
  const cartFingerprint = items
    .map((item) =>
      [
        item.product_id || item.productId || item.id,
        item.variation_id || item.variationId || 0,
        Number(item.quantity || 1),
        roundMoney(item.price),
      ].join(":"),
    )
    .sort()
    .join("|");

  return `${normalizeEmail(email)}::${cartFingerprint}`;
}

function isCheckoutPage() {
  if (typeof window === "undefined") return false;

  return (
    /(^|\/)checkout(\/|$)/i.test(window.location.pathname) ||
    Boolean(document.querySelector(".rgvx-shell"))
  );
}

export function CartProvider({ children }) {
  const [items, setItems] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  const pendingOmnisendItem = useRef(null);

  const itemsRef = useRef([]);
  const pendingAddedItemIdRef = useRef("");
  const identifiedEmailRef = useRef("");
  const lastCheckoutSignatureRef = useRef("");

  useEffect(() => {
    try {
      cleanOldCartStorage();

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

<<<<<<< HEAD
  useEffect(() => {
    if (!hasHydrated || !items.length || !pendingOmnisendItem.current) return;

    const addedItem = pendingOmnisendItem.current;
    pendingOmnisendItem.current = null;

    async function sendCartEvent() {
      let email = getRememberedOmnisendEmail();

      if (!email) {
        const account = await getMeOnce();
        email = account?.data?.user?.email || "";
      }

      if (email) {
        await identifyOmnisendContact({ email });
      }

      trackOmnisendCart(items, addedItem, { email });
    }

    void sendCartEvent();
  }, [items, hasHydrated]);
=======
  const identifyContact = useCallback((email) => {
    const cleanEmail = normalizeEmail(email);

    if (!isValidEmail(cleanEmail)) return false;

    identifiedEmailRef.current = cleanEmail;
    return identifyOmnisendContact(cleanEmail);
  }, []);

  const trackStartedCheckout = useCallback((email, currentItems) => {
    const cleanEmail = normalizeEmail(email);
    const checkoutItems = Array.isArray(currentItems)
      ? currentItems
      : itemsRef.current;

    if (!isValidEmail(cleanEmail) || checkoutItems.length === 0) return false;

    identifyOmnisendContact(cleanEmail);
    identifiedEmailRef.current = cleanEmail;

    const signature = getCheckoutSignature(cleanEmail, checkoutItems);
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

    // Replay the complete cart now that the visitor is identified. This keeps
    // the existing "Added product to cart" automation working for visitors
    // who were anonymous when they originally added the item.
    const cartTracked = trackOmnisendCartEvent({
      eventName: "added product to cart",
      items: checkoutItems,
      addedItem: checkoutItems[checkoutItems.length - 1] || null,
      email: cleanEmail,
    });

    const checkoutTracked = trackOmnisendCartEvent({
      eventName: "started checkout",
      items: checkoutItems,
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
        // Session storage is optional; the in-memory signature still prevents duplicates.
      }
    }

    return tracked;
  }, []);

  useEffect(() => {
    if (!hasHydrated || !pendingAddedItemIdRef.current) return;

    const addedItemId = pendingAddedItemIdRef.current;
    pendingAddedItemIdRef.current = "";

    const addedItem = items.find((item) => item.id === addedItemId);

    if (!addedItem) return;

    trackOmnisendCartEvent({
      eventName: "added product to cart",
      items,
      addedItem,
      email: identifiedEmailRef.current,
    });

    if (identifiedEmailRef.current && isCheckoutPage()) {
      trackStartedCheckout(identifiedEmailRef.current, items);
    }
  }, [hasHydrated, items, trackStartedCheckout]);

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

      trackStartedCheckout(target.value, itemsRef.current);
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
>>>>>>> 7d7ffe2 (test tagadatnkse)

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

<<<<<<< HEAD
    pendingOmnisendItem.current = newItem;
=======
    pendingAddedItemIdRef.current = newItem.id;
>>>>>>> 7d7ffe2 (test tagadatnkse)

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
        maxQuantity,
      );

      return currentItems.map((item) =>
        item.id === newItem.id
          ? {
              ...item,
              quantity: nextQuantity,
            }
          : item,
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
<<<<<<< HEAD
    resetOmnisendCartSession();
=======
    identifiedEmailRef.current = "";
    lastCheckoutSignatureRef.current = "";
>>>>>>> 7d7ffe2 (test tagadatnkse)

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(CART_STORAGE_KEY);
      window.localStorage.removeItem(CART_ID_STORAGE_KEY);
      window.sessionStorage.removeItem(OMNISEND_CHECKOUT_SIGNATURE_KEY);
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
    identifyContact,
    trackStartedCheckout,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  return useContext(CartContext);
}