import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  ChevronRight,
  CreditCard,
  FileUp,
  Lock,
  Mail,
  MapPin,
  PackageCheck,
  ShieldCheck,
  Tag,
  Truck,
  X,
} from "lucide-react";
import { useCart } from "../cart/CartContext";

const WOO_URL =
  import.meta.env.PUBLIC_WOOCOMMERCE_URL ||
  import.meta.env.PUBLIC_WP_SITE_URL ||
  "https://wp.rgvprimellc.com";

const WP_URL =
  import.meta.env.PUBLIC_WP_SITE_URL ||
  import.meta.env.PUBLIC_WOOCOMMERCE_URL ||
  WOO_URL;

const ZELLE_PAYMENT_RECIPIENT = "sales@rgvprimellc.com";

const ZELLE_PAYMENT_NAME = "RGVPRIME LLC";

const FREE_SHIPPING_MINIMUM = 150;

const SHIPPING_METHODS = [
  {
    id: "usps_ground_advantage",
    title: "USPS Ground",
    label: "USPS Ground",
    description: "3 to 7 Business Days",
    price: 8,
  },
  {
    id: "usps_priority",
    title: "USPS Priority",
    label: "USPS Priority",
    description: "3 to 5 Business Days",
    price: 12,
  },
];

const CART_STORAGE_KEY = "rgv-prime-cart-v1";

const CART_STORAGE_FALLBACK_KEYS = [
  CART_STORAGE_KEY,
  "rgv_cart",
  "rgv_checkout_cart",
];

const OLD_FOREIGN_CART_KEYS = [
  "lab_cart",
  "phaseone_cart",
  "phaseone_pending_checkout",
  "phaseone_checkout_shipping",
  "phaseone_checkout_email",
];

const MAX_RECEIPT_SIZE = 10 * 1024 * 1024;

const ACCEPTED_RECEIPT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
];

const PAYMENT_METHODS = [
  {
    id: "card",
    label: "Card",
    eyebrow: "Fast route",
    title: "Card",
    description: "Pay by card through our secure checkout.",
    badge: "Secure",
    icon: CreditCard,
  },
  {
    id: "zelle",
    label: "Zelle",
    eyebrow: "Manual route",
    title: "Zelle",
    description:
      "Create your order here and upload your receipt. Processing may take up to 24 hours.",
    badge: "Manual",
    icon: Building2,
  },
];

const US_STATES = [
  ["", "Select..."],
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
];

const POLICY_LINKS = {
  terms: "/polices",
  refund: "/polices",
  researchUse: "/polices",
};

function safeJsonParse(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function readStoredCartItems() {
  if (typeof window === "undefined") return [];

  for (const key of CART_STORAGE_FALLBACK_KEYS) {
    const parsed = safeJsonParse(window.localStorage.getItem(key), []);

    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.filter(Boolean);
    }
  }

  return [];
}

function clearForeignCartCache() {
  if (typeof window === "undefined") return;

  OLD_FOREIGN_CART_KEYS.forEach((key) => {
    window.localStorage.removeItem(key);
  });
}

function cleanUrl(value = "") {
  return String(value || "").replace(/\/$/, "");
}

function formatMoney(value) {
  const number = Number(value || 0);

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number.isFinite(number) ? number : 0);
}

function toMoneyNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const number = Number(String(value).replace(/,/g, "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : fallback;
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function normalizeCoupon(value = "") {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9-_]/g, "")
    .slice(0, 32);
}

function sanitizeCouponInput(value = "") {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9-_]/g, "")
    .slice(0, 32);
}

function encodeCheckoutPayload(payload) {
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  } catch {
    return "";
  }
}

function decodePossibleGlobalId(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^gid:\/\//i.test(raw)) return raw;

  try {
    if (typeof atob !== "undefined") {
      const decoded = atob(raw);
      if (decoded && decoded !== raw) return decoded;
    }
  } catch {
    return raw;
  }

  return raw;
}

function resolveNumericId(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;

    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }

    const raw = String(value).trim();

    if (/^\d+$/.test(raw)) {
      const number = Number(raw);
      if (number > 0) return number;
    }

    const decoded = decodePossibleGlobalId(raw);
    const match = decoded.match(
      /(?:Product|product|Variation|variation|product_variation|post)[:/](\d+)$/
    );

    if (match?.[1]) {
      const number = Number(match[1]);
      if (number > 0) return number;
    }
  }

  return 0;
}

function getCartItemQuantity(item = {}) {
  const quantity = Number(item.quantity ?? item.qty ?? item.count ?? 1);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function getOfficialProductId(item = {}) {
  return resolveNumericId(
    item.product_id,
    item.productId,
    item.wc_product_id,
    item.woo_product_id,
    item.databaseId,
    item.parent_id,
    item.parentId,
    item.product?.id,
    item.product?.databaseId,
    item.id
  );
}

function getOfficialVariationId(item = {}) {
  return resolveNumericId(
    item.variation_id,
    item.variationId,
    item.selectedVariationId,
    item.variant_id,
    item.variantId,
    item.variation?.id,
    item.variant?.id,
    item.selectedVariant?.id,
    item.merchandise?.id
  );
}

function getItemName(item = {}) {
  return (
    item.name ||
    item.title ||
    item.product_name ||
    item.productName ||
    item.product?.name ||
    item.product?.title ||
    "Item"
  );
}

function getItemImage(item = {}) {
  return (
    item.image ||
    item.image_url ||
    item.imageUrl ||
    item.thumbnail ||
    item.images?.[0]?.src ||
    item.images?.[0]?.url ||
    item.product?.image ||
    item.product?.images?.[0]?.src ||
    "/logo.webp"
  );
}

function getItemOptions(item = {}) {
  if (item.selected_option) return item.selected_option;
  if (item.selectedOption) return item.selectedOption;

  const selected =
    item.selectedAttributes ||
    item.selectedOptions ||
    item.variation ||
    item.variation_attributes ||
    item.attributes ||
    {};

  if (!selected || typeof selected !== "object") return "";

  if (Array.isArray(selected)) {
    return selected
      .map((entry) => entry?.option || entry?.value || entry?.name || "")
      .filter(Boolean)
      .join(" / ");
  }

  return Object.entries(selected)
    .map(([key, value]) => {
      if (!value) return "";

      const cleanKey = String(key)
        .replace(/^attribute_/, "")
        .replace(/^pa_/, "")
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());

      return `${cleanKey}: ${value}`;
    })
    .filter(Boolean)
    .join(" / ");
}

function getCartItemUnitPrice(item = {}) {
  const candidates = [
    item.price,
    item.sale_price,
    item.salePrice,
    item.regular_price,
    item.regularPrice,
    item.unit_price,
    item.unitPrice,
    item.final_price,
    item.amount,
    item.prices?.price,
  ];

  for (const candidate of candidates) {
    const number = toMoneyNumber(candidate, NaN);
    if (Number.isFinite(number) && number > 0) return number;
  }

  const lineCandidates = [
    item.line_total,
    item.lineTotal,
    item.total,
    item.subtotal,
    item.row_total,
    item.rowTotal,
  ];

  const quantity = getCartItemQuantity(item);

  for (const candidate of lineCandidates) {
    const number = toMoneyNumber(candidate, NaN);
    if (Number.isFinite(number) && number > 0) {
      return Number((number / quantity).toFixed(2));
    }
  }

  return 0;
}

function getCartItemLineTotal(item = {}) {
  const lineCandidates = [
    item.line_total,
    item.lineTotal,
    item.total,
    item.subtotal,
    item.row_total,
    item.rowTotal,
  ];

  for (const candidate of lineCandidates) {
    const number = toMoneyNumber(candidate, NaN);
    if (Number.isFinite(number) && number > 0) return Number(number.toFixed(2));
  }

  return Number((getCartItemUnitPrice(item) * getCartItemQuantity(item)).toFixed(2));
}

function calculateCartTotal(items = []) {
  return items.reduce((total, item) => total + getCartItemLineTotal(item), 0);
}

function getVisibleCartItems(items = []) {
  return Array.isArray(items) ? items.filter(Boolean) : [];
}

function buildCheckoutItems(cartItems = []) {
  return getVisibleCartItems(cartItems)
    .map((item) => {
      const quantity = getCartItemQuantity(item);
      const unitPrice = getCartItemUnitPrice(item);
      const lineTotal = getCartItemLineTotal(item);

      return {
        product_id: getOfficialProductId(item),
        variation_id: getOfficialVariationId(item),
        quantity,
        price: unitPrice,
        unit_price: unitPrice,
        line_total: lineTotal,
        total: lineTotal,
        name: getItemName(item),
        title: getItemName(item),
        image: getItemImage(item),
        cart_key: item.cartKey || item.cart_key || item.key || "",
        sku: item.sku || item.product?.sku || "",
        variation:
          item.variation ||
          item.variation_attributes ||
          item.selectedAttributes ||
          item.selectedOptions ||
          {},
      };
    })
    .filter((item) => (item.product_id > 0 || item.name) && item.quantity > 0);
}

function getBlankCheckoutForm() {
  return {
    email: "",
    acceptsMarketing: false,
    country: "US",
    firstName: "",
    lastName: "",
    address1: "",
    address2: "",
    city: "",
    state: "",
    postcode: "",
    phone: "",
  };
}

function getInitialCheckoutForm() {
  const blankForm = getBlankCheckoutForm();
  if (typeof window === "undefined") return blankForm;

  const savedEmail = normalizeEmail(
    localStorage.getItem("rgv_checkout_email") ||
      localStorage.getItem("phaseone_checkout_email") ||
      localStorage.getItem("customer_email") ||
      ""
  );

  const savedShipping = safeJsonParse(
    localStorage.getItem("rgv_checkout_shipping") ||
      localStorage.getItem("phaseone_checkout_shipping"),
    null
  );

  if (savedShipping && typeof savedShipping === "object") {
    return {
      ...blankForm,
      ...savedShipping,
      email: normalizeEmail(savedShipping.email || savedEmail),
    };
  }

  return savedEmail ? { ...blankForm, email: savedEmail } : blankForm;
}

function getInitialCouponCode() {
  if (typeof window === "undefined") return "";

  const url = new URL(window.location.href);

  return normalizeCoupon(
    url.searchParams.get("coupon") ||
      url.searchParams.get("coupon_code") ||
      url.searchParams.get("discount_code") ||
      url.searchParams.get("ref") ||
      localStorage.getItem("rgv_checkout_coupon") ||
      ""
  );
}

function normalizeCheckoutFormForOrder(form = {}) {
  return {
    first_name: String(form.firstName || "").trim(),
    last_name: String(form.lastName || "").trim(),
    email: normalizeEmail(form.email || ""),
    phone: String(form.phone || "").trim(),
    address_1: String(form.address1 || "").trim(),
    address_2: String(form.address2 || "").trim(),
    city: String(form.city || "").trim(),
    state: String(form.state || "").trim(),
    postcode: String(form.postcode || "").trim(),
    country: String(form.country || "US").trim().toUpperCase(),
  };
}

function formatAddressBlock(address = {}) {
  const fullName = [address.first_name, address.last_name].filter(Boolean).join(" ");
  const cityLine = [address.city, address.state, address.postcode]
    .filter(Boolean)
    .join(", ");

  return {
    fullName,
    lines: [address.address_1, address.address_2, cityLine, address.country].filter(Boolean),
    phone: address.phone,
    email: normalizeEmail(address.email || ""),
  };
}

function buildPaymentReference(order = {}) {
  return String(order.payment_reference || order.order_number || order.id || "")
    .replace(/[^0-9]/g, "")
    .slice(0, 12);
}

function buildWooCheckoutUrl({ cartItems, coupon, shippingMethod }) {
  const cleanWooUrl = cleanUrl(WOO_URL);
  if (!cleanWooUrl) return null;

  const checkoutItems = buildCheckoutItems(cartItems);
  const encodedPayload = encodeCheckoutPayload(checkoutItems);
  const legacyItems = checkoutItems
    .map((item) => {
      const productId = Number(item.product_id);
      const variationId = Number(item.variation_id || 0);
      const idForLegacy = variationId || productId;

      return `${idForLegacy}:${Number(item.quantity || 1)}`;
    })
    .join(",");

  const url = new URL(`${cleanWooUrl}/checkout/`);

  url.searchParams.set("phaseone_cart_sync", "1");
  url.searchParams.set("rgv_cart_sync", "1");
  url.searchParams.set("lab_checkout_payload", encodedPayload);
  url.searchParams.set("rgv_checkout_payload", encodedPayload);
  url.searchParams.set("lab_checkout", legacyItems);
  url.searchParams.set("rgv_checkout", legacyItems);

  const cleanCoupon = normalizeCoupon(coupon);

  if (cleanCoupon) {
    url.searchParams.set("phaseone_tagada_coupon", cleanCoupon);
    url.searchParams.set("rgv_tagada_coupon", cleanCoupon);
  }

  if (shippingMethod?.id) {
    url.searchParams.set("rgv_shipping_method", shippingMethod.id);
    url.searchParams.set("rgv_shipping_title", shippingMethod.title || shippingMethod.label || "USPS Priority");
    url.searchParams.set("rgv_shipping_cost", String(toMoneyNumber(shippingMethod.price, 0)));
  }

  return url.toString();
}

function getManualOrderEndpoint() {
  return `${cleanUrl(WP_URL)}/wp-json/rgv/v1/manual-zelle-order`;
}

function getPaymentProofEndpoint() {
  return `${cleanUrl(WP_URL)}/wp-json/rgv/v1/payment-proof`;
}

function getCouponValidateEndpoint() {
  return `${cleanUrl(WP_URL)}/wp-json/rgv/v1/validate-coupon`;
}

function getCouponUiMessage(status, hasCoupon = false) {
  if (status === "valid") return "Coupon applied.";
  if (status === "invalid") return "Code unavailable.";
  if (status === "removed") return "";
  if (status === "checking") return "";
  return hasCoupon ? "" : "";
}

function Field({ label, children, wide = false }) {
  return (
    <label className={`rgvx-field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export default function RgvCheckout() {
  const cart = useCart?.();
  const [localCartItems] = useState(() => readStoredCartItems());
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState("card");
  const [selectedShippingMethodId, setSelectedShippingMethodId] = useState(
    SHIPPING_METHODS[0].id
  );
  const [couponInput, setCouponInput] = useState(() => getInitialCouponCode());
  const [coupon, setCoupon] = useState("");
  const [couponMessage, setCouponMessage] = useState("");
  const [couponStatus, setCouponStatus] = useState("idle");
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponValidation, setCouponValidation] = useState(null);
  const [checkoutForm, setCheckoutForm] = useState(() => getInitialCheckoutForm());
  const [policyAcknowledged, setPolicyAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [paymentNotice, setPaymentNotice] = useState("");
  const [manualOrder, setManualOrder] = useState(null);
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [receiptMessage, setReceiptMessage] = useState("");
  const [receiptSubmitted, setReceiptSubmitted] = useState(false);
  const [memoCopied, setMemoCopied] = useState(false);

  const providerCartItems = useMemo(() => {
    const sources = [cart?.cartItems, cart?.items];
    const validSource = sources.find(
      (source) => Array.isArray(source) && source.length > 0
    );

    return Array.isArray(validSource) ? validSource : [];
  }, [cart?.cartItems, cart?.items]);

  const hasProviderCartItems = providerCartItems.length > 0;

  useEffect(() => {
    if (typeof window === "undefined") return;

    clearForeignCartCache();

    if (couponInput) {
      localStorage.setItem("rgv_checkout_coupon", couponInput);
    }
  }, []);

  const cartItems = hasProviderCartItems ? providerCartItems : localCartItems;

  const cartTotal = useMemo(
    () =>
      hasProviderCartItems
        ? Number(
            cart?.cartTotal ??
              cart?.subtotal ??
              cart?.paidSubtotal ??
              calculateCartTotal(cartItems)
          )
        : calculateCartTotal(cartItems),
    [cart?.cartTotal, cart?.paidSubtotal, cart?.subtotal, cartItems, hasProviderCartItems]
  );

  const summaryItems = useMemo(
    () =>
      cartItems.map((item, index) => ({
        key: item.cartKey || item.cart_key || `${getOfficialProductId(item)}-${index}`,
        image: getItemImage(item),
        lineTotal: getCartItemLineTotal(item),
        name: getItemName(item),
        options: getItemOptions(item),
        quantity: getCartItemQuantity(item),
      })),
    [cartItems]
  );

  const couponDiscount =
    couponStatus === "valid"
      ? Math.min(
          Math.max(cartTotal, 0),
          toMoneyNumber(
            couponValidation?.discount_total ?? couponValidation?.discountTotal,
            0
          )
        )
      : 0;

  const couponHasFreeShipping =
    couponStatus === "valid" && Boolean(couponValidation?.free_shipping);

  const discountedCartTotal = Math.max(cartTotal - couponDiscount, 0);

  const selectedShippingMethod =
    SHIPPING_METHODS.find((method) => method.id === selectedShippingMethodId) ||
    SHIPPING_METHODS[0];

  const isZelleSelected = selectedPaymentMethodId === "zelle";
  const hasItems = cartItems.length > 0;
  const freeShippingUnlocked = cartTotal >= FREE_SHIPPING_MINIMUM || couponHasFreeShipping;
  const amountUntilFreeShipping = Math.max(FREE_SHIPPING_MINIMUM - cartTotal, 0);
  const selectedShippingBaseCost = toMoneyNumber(selectedShippingMethod?.price, 0);
  const shippingCost = freeShippingUnlocked ? 0 : selectedShippingBaseCost;
  const estimatedDue = Math.max(discountedCartTotal + shippingCost, 0);

  const orderReference = buildPaymentReference(manualOrder || {});
  const zelleMemoCode = `RGV-${orderReference || manualOrder?.order_number || manualOrder?.number || manualOrder?.id || ""}`;
  const manualOrderTotal = Number(manualOrder?.total || estimatedDue || 0);
  const manualPaymentAmount = formatMoney(manualOrderTotal);
  const manualEmail = normalizeEmail(
    manualOrder?.billing?.email || manualOrder?.email || checkoutForm.email || ""
  );
  const manualBilling = formatAddressBlock(
    manualOrder?.billing || normalizeCheckoutFormForOrder(checkoutForm)
  );
  const manualShipping = formatAddressBlock(
    manualOrder?.shipping || manualOrder?.billing || normalizeCheckoutFormForOrder(checkoutForm)
  );

  const progressWidth = Math.min(100, Math.round((cartTotal / FREE_SHIPPING_MINIMUM) * 100));

  const validateCouponWithWoo = async (cleanCoupon) => {
    const checkoutItems = buildCheckoutItems(cartItems);

    if (!checkoutItems.length) {
      throw new Error("No valid cart items were found for coupon validation.");
    }

    const response = await fetch(getCouponValidateEndpoint(), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        code: cleanCoupon,
        coupon: cleanCoupon,
        items: checkoutItems,
        subtotal: cartTotal,
        customer_email: checkoutForm.email,
      }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || data?.success === false || data?.valid === false) {
      throw new Error(data?.message || "This coupon is not valid for your cart.");
    }

    return data;
  };

  const applyCoupon = async () => {
    const cleanCoupon = normalizeCoupon(couponInput);

    if (!cleanCoupon) {
      removeCoupon();
      return;
    }

    try {
      setCouponLoading(true);
      setCouponStatus("validating");
      setCouponMessage(getCouponUiMessage("checking"));
      setError("");

      const data = await validateCouponWithWoo(cleanCoupon);
      const finalCode = normalizeCoupon(data?.code || cleanCoupon);

      setCoupon(finalCode);
      setCouponInput(finalCode);
      setCouponValidation(data);
      setCouponStatus("valid");
      setCouponMessage(getCouponUiMessage("valid", true));

      if (typeof window !== "undefined") {
        localStorage.setItem("rgv_checkout_coupon", finalCode);
      }
    } catch (err) {
      setCoupon("");
      setCouponValidation(null);
      setCouponStatus("invalid");
      setCouponMessage(getCouponUiMessage("invalid"));

      if (typeof window !== "undefined") {
        localStorage.removeItem("rgv_checkout_coupon");
      }
    } finally {
      setCouponLoading(false);
    }
  };

  const removeCoupon = () => {
    setCoupon("");
    setCouponInput("");
    setCouponMessage("");
    setCouponStatus("idle");
    setCouponValidation(null);
    setCouponLoading(false);

    if (typeof window !== "undefined") {
      localStorage.removeItem("rgv_checkout_coupon");
    }
  };

  const copyZelleMemo = async () => {
    try {
      await navigator.clipboard?.writeText(zelleMemoCode);
      setMemoCopied(true);
      window.setTimeout(() => setMemoCopied(false), 1500);
    } catch (copyError) {
      console.error("Memo copy error:", copyError);
    }
  };

  const updateCheckoutField = (field, value) => {
    setCheckoutForm((current) => ({ ...current, [field]: value }));
    setError("");
    setPaymentNotice("");
  };

  const validateBaseCheckout = () => {
    if (!hasItems) {
      setError("Your cart is empty.");
      return false;
    }

    if (!policyAcknowledged) {
      setError("Please confirm the age, research-use, and policy acknowledgement.");
      return false;
    }

    return true;
  };

  const validateZelleForm = () => {
    const normalizedForm = normalizeCheckoutFormForOrder(checkoutForm);

    if (!isValidEmail(normalizedForm.email)) {
      setError("Enter a valid email before creating your Zelle order.");
      return null;
    }

    const requiredFields = [
      ["first_name", "First name"],
      ["last_name", "Last name"],
      ["address_1", "Address"],
      ["city", "City"],
      ["state", "State"],
      ["postcode", "ZIP"],
      ["phone", "Phone number"],
    ];

    const missingField = requiredFields.find(([key]) => !normalizedForm[key]);

    if (missingField) {
      setError(`${missingField[1]} is required before creating the Zelle order.`);
      return null;
    }

    return normalizedForm;
  };

  const continueToCardCheckout = () => {
    if (!validateBaseCheckout()) return;

    if (couponInput && couponInput !== coupon) {
      setError("Apply or clear the coupon code before continuing.");
      return;
    }

    const checkoutUrl = buildWooCheckoutUrl({
      cartItems,
      coupon,
      shippingMethod: selectedShippingMethod,
    });

    if (!checkoutUrl) {
      setError("Secure checkout is temporarily unavailable. Please contact support.");
      return;
    }

    setLoading(true);
    setPaymentNotice("Opening secure card checkout...");
    window.location.href = checkoutUrl;
  };

  const createZelleOrder = async () => {
    if (!validateBaseCheckout()) return;

    if (couponInput && couponInput !== coupon) {
      setError("Apply or clear the coupon code before creating your Zelle order.");
      return;
    }

    const normalizedForm = validateZelleForm();
    if (!normalizedForm) return;

    const checkoutItems = buildCheckoutItems(cartItems);

    if (!checkoutItems.length) {
      setError("No valid cart items were found for this order.");
      return;
    }

    const finalBilling = {
      ...normalizedForm,
      email: normalizedForm.email,
    };

    const finalShipping = {
      ...normalizedForm,
      email: normalizedForm.email,
    };

    const finalCustomer = {
      firstName: finalBilling.first_name,
      lastName: finalBilling.last_name,
      email: finalBilling.email,
      phone: finalBilling.phone,
    };

    try {
      setLoading(true);
      setError("");
      setPaymentNotice("Creating your Zelle order...");

      if (typeof window !== "undefined") {
        localStorage.setItem("rgv_checkout_email", finalBilling.email);
        localStorage.setItem("rgv_checkout_shipping", JSON.stringify(checkoutForm));
      }

      const response = await fetch(getManualOrderEndpoint(), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          paymentMethod: "zelle",
          payment_method: "zelle",
          paymentMethodTitle: "Zelle",
          payment_method_title: "Zelle",
          customer: finalCustomer,
          billing: finalBilling,
          shipping: finalShipping,
          items: checkoutItems,
          couponCode: coupon,
          coupon: coupon,
          couponDiscount,
          coupon_discount: couponDiscount,
          couponValidation,
          coupon_validation: couponValidation,
          discountedSubtotal: discountedCartTotal,
          discounted_subtotal: discountedCartTotal,
          shippingMethod: selectedShippingMethod?.id,
          shipping_method: selectedShippingMethod?.id,
          shippingMethodTitle: selectedShippingMethod?.title,
          shipping_method_title: selectedShippingMethod?.title,
          shippingCost,
          shipping_cost: shippingCost,
          shippingBaseCost: selectedShippingBaseCost,
          shipping_base_cost: selectedShippingBaseCost,
          zelleDiscountRate: 0,
          zelle_discount_rate: 0,
          freeShippingMinimum: FREE_SHIPPING_MINIMUM,
          free_shipping_minimum: FREE_SHIPPING_MINIMUM,
          standardShippingCost: selectedShippingBaseCost,
          standard_shipping_cost: selectedShippingBaseCost,
          source: "rgv_custom_checkout_zelle",
          ageConfirmed: true,
          researchUseAcknowledged: true,
          termsAccepted: true,
          refundPolicyAccepted: true,
          researchUsePolicyAccepted: true,
          policyAcknowledgedAt: new Date().toISOString(),
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || data?.success === false) {
        throw new Error(data?.message || data?.error || "Unable to create the Zelle order.");
      }

      const order = data?.order || data;

      if (!order?.order_id && !order?.id) {
        throw new Error("The order was created, but no order number was returned.");
      }

      const nextOrder = {
        ...order,
        order_id: order.order_id || order.id,
        order_number: order.order_number || order.number || order.id || order.order_id,
        payment_reference:
          order.payment_reference || order.order_number || order.number || order.id || order.order_id,
        billing: order.billing || finalBilling,
        shipping: order.shipping || finalShipping,
        customer: order.customer || finalCustomer,
        items: order.items || checkoutItems,
      };

      setManualOrder(nextOrder);
      setPaymentNotice(
        `Order #${nextOrder.order_number} created. Payment instructions are shown below and were emailed to ${finalBilling.email}. Zelle processing can take up to 24 hours after receipt upload.`
      );
    } catch (err) {
      setError(err?.message || "Unable to create the Zelle order. Please try again.");
      setPaymentNotice("");
    } finally {
      setLoading(false);
    }
  };

  const handleContinuePayment = () => {
    if (isZelleSelected) {
      createZelleOrder();
      return;
    }

    continueToCardCheckout();
  };

  const handleReceiptFile = (event) => {
    const file = event.target.files?.[0];

    if (!file) return;

    if (!ACCEPTED_RECEIPT_TYPES.includes(file.type)) {
      setReceiptFile(null);
      setReceiptMessage("Please upload a JPG, PNG, WEBP or PDF file.");
      return;
    }

    if (file.size > MAX_RECEIPT_SIZE) {
      setReceiptFile(null);
      setReceiptMessage("The receipt must be under 10MB.");
      return;
    }

    setReceiptFile(file);
    setReceiptMessage("");
  };

  const uploadPaymentReceipt = async () => {
    if (!receiptFile || !manualOrder?.order_id) return;

    try {
      setReceiptUploading(true);
      setReceiptMessage("");

      const formData = new FormData();
      formData.append("order_id", manualOrder.order_id);
      formData.append("order_key", manualOrder.order_key || "");
      formData.append("customer_email", manualEmail || manualBilling.email || "");
      formData.append("payment_method", "zelle");
      formData.append("receipt", receiptFile);

      const response = await fetch(getPaymentProofEndpoint(), {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || data?.success === false) {
        throw new Error(data?.message || data?.error || "Unable to upload receipt.");
      }

      setReceiptFile(null);
      setReceiptSubmitted(true);

      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (err) {
      setReceiptMessage(err?.message || "Unable to upload receipt. Please try again.");
    } finally {
      setReceiptUploading(false);
    }
  };

  const EmptyState = () => (
    <main className="rgvx-page rgvx-empty-page">
      <div className="rgvx-background-wash" />
      <section className="rgvx-empty-state">
        <p>RGVPRIME CHECKOUT</p>
        <h1>Your cart is empty</h1>
        <span>Add products to your cart before continuing to checkout.</span>
        <a href="/shop">Back to shop</a>
      </section>
      <style>{styles}</style>
    </main>
  );

  if (!hasItems) return <EmptyState />;

  if (receiptSubmitted && manualOrder && isZelleSelected) {
    const orderNumber = manualOrder.order_number || manualOrder.number || manualOrder.id;

    return (
      <main className="rgvx-page rgvx-thanks-page">
        <div className="rgvx-background-wash" />

        <section className="rgvx-shell rgvx-thanks-shell">
          <div className="rgvx-topbar">
            <a href="/shop" className="rgvx-ghost-link">
              <ArrowLeft size={14} /> Back to shop
            </a>

            <div className="rgvx-lock-pill rgvx-confirmed-pill">
              <BadgeCheck size={13} /> Receipt received
            </div>
          </div>

          <section className="rgvx-receipt-thanks-card" aria-live="polite">
            <div className="rgvx-receipt-thanks-icon">
              <BadgeCheck size={36} />
            </div>

            <p>ORDER #{orderNumber}</p>
            <h1>Thank you for your purchase</h1>
            <span>
              We have received your payment receipt. Your purchase will be confirmed
              within 24 hours, and you will receive a confirmation email.
            </span>

            <div className="rgvx-receipt-thanks-details">
              <div>
                <Mail size={17} />
                <span>Confirmation email</span>
                <strong>{manualEmail || manualBilling.email}</strong>
              </div>

              <div>
                <ShieldCheck size={17} />
                <span>Current status</span>
                <strong>Pending verification</strong>
              </div>
            </div>

            <a href="/shop" className="rgvx-receipt-thanks-button">
              Continue shopping <ChevronRight size={18} />
            </a>
          </section>
        </section>

        <style>{styles}</style>
      </main>
    );
  }

  if (manualOrder && isZelleSelected) {
    const orderNumber = manualOrder.order_number || manualOrder.number || manualOrder.id;

    return (
      <main className="rgvx-page rgvx-thanks-page">
        <div className="rgvx-background-wash" />

        <section className="rgvx-shell rgvx-thanks-shell">
          <div className="rgvx-topbar">
            <a href="/shop" className="rgvx-ghost-link">
              <ArrowLeft size={14} /> Back to shop
            </a>

            <div className="rgvx-lock-pill">
              <Lock size={13} /> Payment pending
            </div>
          </div>

          <section className="rgvx-zelle-guide-card rgvx-zelle-guide-card-simple" aria-live="polite">
            <div className="rgvx-zelle-guide-status">
              <BadgeCheck size={17} />
              <span>Order created successfully</span>
            </div>

            <header className="rgvx-zelle-guide-hero rgvx-zelle-guide-hero-simple">
              <div className="rgvx-zelle-guide-title">
                <p>Order #{orderNumber}</p>
                <h1>Pay with Zelle</h1>
                <span>
                  Send the exact amount, use the memo below, then upload your receipt.
                  Zelle orders can take up to 24 hours to process after verification.
                </span>
              </div>

              <div className="rgvx-zelle-guide-total">
                <span>Total to send</span>
                <strong>{manualPaymentAmount}</strong>
                <small>Send this exact amount</small>
              </div>
            </header>

            <div className="rgvx-zelle-payment-line rgvx-zelle-payment-line-simple">
              <div className="rgvx-zelle-pay-detail">
                <span>Send Zelle to</span>
                <strong>{ZELLE_PAYMENT_RECIPIENT}</strong>
                <small>{ZELLE_PAYMENT_NAME}</small>
              </div>

              <div className="rgvx-zelle-memo-panel">
                <div className="rgvx-zelle-memo-header">
                  <span>Memo / notes</span>
                  <strong>{zelleMemoCode}</strong>
                </div>

                <small>
                  Write only this code in Zelle. No product names, no product details,
                  and no extra notes.
                </small>
              </div>

              <button
                type="button"
                className={`rgvx-copy-memo-button ${memoCopied ? "is-copied" : ""}`}
                onClick={copyZelleMemo}
              >
                {memoCopied ? "Copied" : "Copy memo"}
              </button>
            </div>

            <div className="rgvx-zelle-guide-body rgvx-zelle-guide-body-simple">
              <section className="rgvx-zelle-guide-steps" aria-label="Zelle payment steps">
                <div className="rgvx-guide-section-heading">
                  <p>What to do now</p>
                  <h2>3 simple steps</h2>
                  <span>Follow these instructions exactly so your payment can be validated quickly.</span>
                </div>

                <div className="rgvx-guide-step-list">
                  <div className="rgvx-guide-step-item">
                    <b>1</b>
                    <div>
                      <strong>Open Zelle in your bank app</strong>
                      <p>
                        Create a Zelle payment to <strong>{ZELLE_PAYMENT_RECIPIENT}</strong> for the exact amount:
                        <strong> {manualPaymentAmount}</strong>.
                      </p>
                    </div>
                  </div>

                  <div className="rgvx-guide-step-item is-important">
                    <b>2</b>
                    <div>
                      <strong>Use this memo only: {zelleMemoCode}</strong>
                      <p>
                        In the memo or notes field, write <strong>{zelleMemoCode}</strong> only.
                        Do not include product names, peptide names, order details, or any extra comments.
                      </p>
                    </div>
                  </div>

                  <div className="rgvx-guide-step-item">
                    <b>3</b>
                    <div>
                      <strong>Upload your receipt</strong>
                      <p>
                        After sending the payment, upload your confirmation screenshot or PDF here.
                        We will review it and update your order after validation. Zelle orders can take up to 24 hours to process.
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="rgvx-zelle-guide-upload" aria-label="Upload Zelle payment receipt">
                <div className="rgvx-guide-section-heading">
                  <p>Verification</p>
                  <h2>Upload receipt</h2>
                  <span>JPG, PNG, WEBP or PDF. Max 10MB.</span>
                </div>

                <label className="rgvx-upload-zone rgvx-guide-upload-zone">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    onChange={handleReceiptFile}
                  />

                  <FileUp size={24} />
                  <strong>{receiptFile ? receiptFile.name : "Choose payment receipt"}</strong>
                  <small>Upload the confirmation screenshot or PDF from your bank.</small>
                </label>

                <button
                  type="button"
                  onClick={uploadPaymentReceipt}
                  disabled={!receiptFile || receiptUploading}
                  className="rgvx-upload-button"
                >
                  {receiptUploading ? "Uploading..." : "Submit receipt"}
                </button>

                {receiptMessage && <p className="rgvx-receipt-message">{receiptMessage}</p>}
              </section>
            </div>

            <div className="rgvx-zelle-simple-warning">
              <ShieldCheck size={18} />
              <p>
                <strong>Important:</strong> your Zelle memo must be exactly <strong>{zelleMemoCode}</strong>.
                Extra words or product names can delay manual verification.
              </p>
            </div>

            <footer className="rgvx-zelle-guide-footer">
              <div>
                <MapPin size={15} />
                <span>Shipping to</span>
                <strong>{manualShipping.fullName || "Shipping address"}</strong>
                {manualShipping.lines.map((line) => (
                  <small key={line}>{line}</small>
                ))}
                {manualShipping.phone && <small>{manualShipping.phone}</small>}
              </div>

              <div>
                <Mail size={15} />
                <span>Email</span>
                <strong>{manualEmail || manualBilling.email}</strong>
                <small>Payment instructions were also sent to this email. Zelle processing can take up to 24 hours.</small>
              </div>
            </footer>
          </section>
        </section>

        <style>{styles}</style>
      </main>
    );
  }

  return (
    <main className="rgvx-page">
      <div className="rgvx-background-wash" />

      <section className="rgvx-shell">
        <div className="rgvx-topbar">
          <a href="/shop" className="rgvx-ghost-link">
            <ArrowLeft size={14} /> Back to shop
          </a>

          <div className="rgvx-lock-pill">
            <Lock size={13} /> Secure
          </div>
        </div>

        <header className="rgvx-clean-header">
          <div>
            <p>RGVPRIME RESEARCH</p>
            <h1>Checkout</h1>
            <span>
              Review your order, choose a payment method, then complete the final step.
            </span>
          </div>

          <div className="rgvx-header-note">
            <ShieldCheck size={17} />
            <span>Research use only</span>
          </div>
        </header>

        <div className="rgvx-clean-layout">
          <section className="rgvx-flow">
            <div className="rgvx-flow-section first">
              <div className="rgvx-section-heading">
                <p>Step 3</p>
                <h2>Choose payment</h2>
                <span>Choose Card for secure payment, or Zelle to create the order here first.</span>
              </div>

              <div className="rgvx-payment-switch" role="radiogroup" aria-label="Payment method">
                {PAYMENT_METHODS.map((method) => {
                  const Icon = method.icon;
                  const active = selectedPaymentMethodId === method.id;

                  return (
                    <button
                      key={method.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`rgvx-payment-option ${active ? "active" : ""}`}
                      onClick={() => {
                        setSelectedPaymentMethodId(method.id);
                        setManualOrder(null);
                        setError("");
                        setPaymentNotice("");
                      }}
                    >
                      <Icon size={18} />

                      <span>
                        <strong>{method.title}</strong>
                        <small>{method.description}</small>
                      </span>

                      <em>{method.badge}</em>
                    </button>
                  );
                })}
              </div>
            </div>

            {isZelleSelected && (
              <div className="rgvx-zelle-area">
                <div className="rgvx-zelle-banner">
                  <Building2 size={18} />
                  <div>
                    <strong>Zelle selected</strong>
                    <span>
                      Enter contact and delivery details. After receipt upload, Zelle orders can take up to 24 hours to process.
                    </span>
                  </div>
                </div>

                <div className="rgvx-form-section">
                  <div className="rgvx-block-title">
                    <Mail size={16} />
                    <div>
                      <strong>Contact</strong>
                      <small>Email for order updates and payment instructions.</small>
                    </div>
                  </div>

                  <div className="rgvx-form-grid">
                    <Field label="Email" wide>
                      <input
                        type="email"
                        value={checkoutForm.email}
                        onChange={(event) => updateCheckoutField("email", event.target.value)}
                        placeholder="your@email.com"
                        autoComplete="email"
                      />
                    </Field>

                    <label className="rgvx-marketing-inline">
                      <input
                        type="checkbox"
                        checked={checkoutForm.acceptsMarketing}
                        onChange={(event) => updateCheckoutField("acceptsMarketing", event.target.checked)}
                      />
                      <span>Email me with news and offers</span>
                    </label>
                  </div>
                </div>

                <div className="rgvx-form-section">
                  <div className="rgvx-block-title">
                    <MapPin size={16} />
                    <div>
                      <strong>Delivery</strong>
                      <small>Required only for Zelle orders.</small>
                    </div>
                  </div>

                  <div className="rgvx-form-grid two">
                    <Field label="First name">
                      <input
                        type="text"
                        value={checkoutForm.firstName}
                        onChange={(event) => updateCheckoutField("firstName", event.target.value)}
                        placeholder="John"
                        autoComplete="given-name"
                      />
                    </Field>

                    <Field label="Last name">
                      <input
                        type="text"
                        value={checkoutForm.lastName}
                        onChange={(event) => updateCheckoutField("lastName", event.target.value)}
                        placeholder="Doe"
                        autoComplete="family-name"
                      />
                    </Field>

                    <Field label="Address" wide>
                      <input
                        type="text"
                        value={checkoutForm.address1}
                        onChange={(event) => updateCheckoutField("address1", event.target.value)}
                        placeholder="123 Main Street"
                        autoComplete="address-line1"
                      />
                    </Field>

                    <Field label="Apartment, suite, etc." wide>
                      <input
                        type="text"
                        value={checkoutForm.address2}
                        onChange={(event) => updateCheckoutField("address2", event.target.value)}
                        placeholder="Optional"
                        autoComplete="address-line2"
                      />
                    </Field>
                  </div>

                  <div className="rgvx-form-grid three">
                    <Field label="City">
                      <input
                        type="text"
                        value={checkoutForm.city}
                        onChange={(event) => updateCheckoutField("city", event.target.value)}
                        placeholder="City"
                        autoComplete="address-level2"
                      />
                    </Field>

                    <Field label="State">
                      <select
                        value={checkoutForm.state}
                        onChange={(event) => updateCheckoutField("state", event.target.value)}
                        autoComplete="address-level1"
                      >
                        {US_STATES.map(([value, label]) => (
                          <option key={value || "empty"} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="ZIP">
                      <input
                        type="text"
                        value={checkoutForm.postcode}
                        onChange={(event) => updateCheckoutField("postcode", event.target.value)}
                        placeholder="12345"
                        autoComplete="postal-code"
                      />
                    </Field>
                  </div>

                  <div className="rgvx-form-grid">
                    <Field label="Phone" wide>
                      <input
                        type="tel"
                        value={checkoutForm.phone}
                        onChange={(event) => updateCheckoutField("phone", event.target.value)}
                        placeholder="+1 (555) 123-4567"
                        autoComplete="tel"
                      />
                    </Field>
                  </div>
                </div>

              </div>
            )}

            <div className="rgvx-form-section rgvx-shipping-section">
              <div className="rgvx-block-title">
                <Truck size={16} />
                <div>
                  <strong>Shipping method</strong>
                  <small>
                    Choose USPS Ground or USPS Priority. Free shipping unlocks at {formatMoney(FREE_SHIPPING_MINIMUM)}.
                  </small>
                </div>
              </div>

              <div
                className="rgvx-shipping-options flow"
                role="radiogroup"
                aria-label="Shipping method"
              >
                <div className="rgvx-shipping-options-head">
                  <span>Available methods</span>
                  <strong>{freeShippingUnlocked ? "Free unlocked" : `Only ${formatMoney(amountUntilFreeShipping)} more for free shipping`}</strong>
                </div>

                <div className="rgvx-shipping-option-list">
                  {SHIPPING_METHODS.map((method) => {
                    const active = selectedShippingMethodId === method.id;

                    return (
                      <button
                        key={method.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={`rgvx-shipping-option ${active ? "active" : ""}`}
                        onClick={() => {
                          setSelectedShippingMethodId(method.id);
                          setError("");
                        }}
                      >
                        <div>
                          <strong>{method.title}</strong>
                          <small>{method.description}</small>
                          {freeShippingUnlocked && (
                            <small className="rgvx-shipping-free-note">
                              Regular {formatMoney(method.price)} · free unlocked
                            </small>
                          )}
                        </div>

                        <em>{freeShippingUnlocked ? "FREE" : formatMoney(method.price)}</em>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {error && <p className="rgvx-error">{error}</p>}
            {paymentNotice && !error && <p className="rgvx-success">{paymentNotice}</p>}

            <label className={`rgvx-policy ${!policyAcknowledged && error ? "warning" : ""}`}>
              <input
                type="checkbox"
                checked={policyAcknowledged}
                onChange={(event) => {
                  setPolicyAcknowledged(event.target.checked);
                  if (event.target.checked) setError("");
                }}
              />

              <span>
                I confirm I am 21 or older, I am acquiring these compounds for in-vitro research or
                laboratory use only, and I agree to the <a href={POLICY_LINKS.terms}>Terms & Conditions</a>,{" "}
                <a href={POLICY_LINKS.refund}>Refund Policy</a>, and{" "}
                <a href={POLICY_LINKS.researchUse}>Research Use Only policy</a>.
              </span>
            </label>

            <button
              type="button"
              onClick={handleContinuePayment}
              disabled={loading}
              className="rgvx-final-button"
            >
              <span>
                <strong>
                  {loading
                    ? isZelleSelected
                      ? "Creating Zelle order"
                      : "Opening card checkout"
                    : isZelleSelected
                      ? "Create Zelle order"
                      : "Continue to secure checkout"}
                </strong>
                <small>
                  {isZelleSelected
                    ? "Payment instructions and receipt upload will appear next. Zelle processing can take up to 24 hours."
                    : "You will be redirected to secure card checkout."}
                </small>
              </span>
              <ChevronRight size={20} />
            </button>
          </section>

          <aside className="rgvx-order-summary">
            <div className="rgvx-summary-head">
              <div>
                <p>Step 1 Â· Review order</p>
                <h2>{formatMoney(estimatedDue)}</h2>
              </div>
              <PackageCheck size={18} />
            </div>

            <div className="rgvx-items-list">
              {summaryItems.map((item) => (
                  <div
                    key={item.key}
                    className="rgvx-summary-item"
                  >
                    <div className="rgvx-item-image">
                      <img
                        src={item.image}
                        alt={item.name}
                        loading="lazy"
                        decoding="async"
                        width="58"
                        height="58"
                      />
                      <span>{item.quantity}</span>
                    </div>

                    <div>
                      <strong>{item.name}</strong>
                      {item.options && <small>{item.options}</small>}
                    </div>

                    <em>{formatMoney(item.lineTotal)}</em>
                  </div>
                ))}
            </div>

            <div className="rgvx-free-progress">
              <div>
                <span>Free shipping over {formatMoney(FREE_SHIPPING_MINIMUM)}</span>
                <strong>
                  {freeShippingUnlocked ? "Unlocked" : `${formatMoney(amountUntilFreeShipping)} away`}
                </strong>
              </div>
              <div className="progress-track">
                <span style={{ width: `${progressWidth}%` }} />
              </div>
            </div>

            <div className="rgvx-totals">
              <div className="rgvx-total-row">
                <span>Subtotal</span>
                <strong>{formatMoney(cartTotal)}</strong>
              </div>

              {couponStatus === "valid" && couponDiscount > 0 && (
                <div className="rgvx-total-row good">
                  <span>Coupon {coupon}</span>
                  <strong>-{formatMoney(couponDiscount)}</strong>
                </div>
              )}

              <div className="rgvx-total-row">
                <span>{selectedShippingMethod?.label || "Shipping"}</span>
                <strong className={freeShippingUnlocked ? "free" : ""}>
                  {freeShippingUnlocked ? "FREE" : formatMoney(shippingCost)}
                </strong>
              </div>

              <div className="rgvx-total-row total">
                <span>{isZelleSelected ? "Due" : "Estimated total"}</span>
                <strong>{formatMoney(estimatedDue)}</strong>
              </div>

              <div className={`rgvx-mini-coupon ${couponStatus !== "idle" ? `is-${couponStatus}` : ""}`}>
                <div className="rgvx-mini-coupon-header">
                  <div className="rgvx-mini-coupon-title">
                    <Tag size={12} />
                    <span>Coupon</span>
                  </div>

                  {couponStatus === "valid" && <div className="rgvx-mini-coupon-pill">Applied</div>}
                </div>

                <div className="rgvx-mini-coupon-controls">
                  <div className="rgvx-mini-coupon-code-wrap">
                    <input
                      value={couponInput}
                      disabled={couponLoading}
                      onChange={(event) => {
                        const nextValue = sanitizeCouponInput(event.target.value);

                        setCouponInput(nextValue);
                        setCouponMessage("");
                        setError("");

                        if (coupon && nextValue !== coupon) {
                          setCoupon("");
                          setCouponStatus("idle");
                          setCouponValidation(null);

                          if (typeof window !== "undefined") {
                            localStorage.removeItem("rgv_checkout_coupon");
                          }
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();

                          if (!couponLoading) {
                            if (coupon) {
                              removeCoupon();
                            } else {
                              applyCoupon();
                            }
                          }
                        }
                      }}
                      placeholder="Enter coupon code"
                      inputMode="text"
                      autoCapitalize="characters"
                      className="rgvx-mini-coupon-input"
                    />

                    {coupon && (
                      <button
                        type="button"
                        className="rgvx-coupon-clear"
                        onClick={removeCoupon}
                        aria-label="Remove coupon"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    className="rgvx-mini-coupon-action"
                    onClick={coupon ? removeCoupon : applyCoupon}
                    disabled={couponLoading || (!coupon && !couponInput.trim())}
                  >
                    {couponLoading ? "Checking..." : coupon ? "Remove coupon" : "Apply coupon"}
                  </button>
                </div>

                {couponMessage && (
                  <p className={`rgvx-coupon-message ${couponStatus !== "idle" ? `is-${couponStatus}` : ""}`}>
                    {couponMessage}
                  </p>
                )}
              </div>
            </div>
          </aside>
        </div>
      </section>

      <div className="rgvx-floating-total-bar" aria-live="polite">
        <span>{isZelleSelected ? "Due now" : "Estimated total"}</span>
        <strong>{formatMoney(estimatedDue)}</strong>
      </div>

      <style>{styles}</style>
    </main>
  );
}

const styles = `
  * {
    box-sizing: border-box;
  }

  .rgvx-page {
    position: relative;
    min-height: 100dvh;
    overflow-x: hidden;
    overflow-y: visible;
    background:
      radial-gradient(circle at 8% -10%, rgba(220, 38, 38, 0.20), transparent 34%),
      radial-gradient(circle at 100% 10%, rgba(127, 29, 29, 0.22), transparent 30%),
      linear-gradient(135deg, #020202 0%, #070202 48%, #030303 100%);
    color: #ffffff;
    padding: clamp(145px, 12vh, 185px) 16px 72px;
  }

  .rgvx-background-wash {
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0.35;
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
    background-size: 46px 46px;
    mask-image: radial-gradient(circle at center, black, transparent 78%);
  }

  .rgvx-shell {
    position: relative;
    z-index: 1;
    width: min(1160px, 100%);
    margin: 0 auto;
  }

  .rgvx-thanks-shell {
    width: min(1040px, 100%);
  }

  .rgvx-confirmed-pill {
    border-color: rgba(34, 197, 94, 0.32);
    background: rgba(34, 197, 94, 0.08);
    color: #bbf7d0;
  }

  .rgvx-receipt-thanks-card {
    width: min(760px, 100%);
    margin: clamp(32px, 7vh, 84px) auto 0;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 28px;
    background:
      radial-gradient(circle at 50% 0%, rgba(220, 38, 38, 0.16), transparent 42%),
      rgba(7, 7, 7, 0.92);
    padding: clamp(34px, 6vw, 68px);
    text-align: center;
    box-shadow: 0 30px 90px rgba(0, 0, 0, 0.48);
    backdrop-filter: blur(18px);
  }

  .rgvx-receipt-thanks-icon {
    display: grid;
    width: 74px;
    height: 74px;
    margin: 0 auto 24px;
    place-items: center;
    border: 1px solid rgba(34, 197, 94, 0.38);
    border-radius: 50%;
    background: rgba(34, 197, 94, 0.1);
    color: #86efac;
    box-shadow: 0 0 42px rgba(34, 197, 94, 0.14);
  }

  .rgvx-receipt-thanks-card > p {
    margin: 0;
    color: rgba(248, 113, 113, 0.92);
    font-size: 10px;
    font-weight: 1000;
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }

  .rgvx-receipt-thanks-card > h1 {
    margin: 10px 0 14px;
    color: #ffffff;
    font-size: clamp(34px, 6vw, 58px);
    font-weight: 1000;
    letter-spacing: -0.06em;
    line-height: 0.98;
  }

  .rgvx-receipt-thanks-card > span {
    display: block;
    max-width: 600px;
    margin: 0 auto;
    color: rgba(255, 255, 255, 0.66);
    font-size: clamp(14px, 2vw, 17px);
    font-weight: 650;
    line-height: 1.7;
  }

  .rgvx-receipt-thanks-details {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin: 32px 0;
    text-align: left;
  }

  .rgvx-receipt-thanks-details > div {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    gap: 4px 10px;
    align-items: center;
    min-width: 0;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.03);
    padding: 18px;
  }

  .rgvx-receipt-thanks-details svg {
    grid-row: 1 / 3;
    color: #f87171;
  }

  .rgvx-receipt-thanks-details span {
    color: rgba(255, 255, 255, 0.42);
    font-size: 9px;
    font-weight: 950;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .rgvx-receipt-thanks-details strong {
    min-width: 0;
    overflow-wrap: anywhere;
    color: rgba(255, 255, 255, 0.9);
    font-size: 12px;
    font-weight: 850;
  }

  .rgvx-receipt-thanks-button {
    display: inline-flex;
    min-height: 52px;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border-radius: 999px;
    background: linear-gradient(135deg, #dc2626, #991b1b);
    padding: 0 24px;
    color: #ffffff;
    font-size: 11px;
    font-weight: 950;
    letter-spacing: 0.08em;
    text-decoration: none;
    text-transform: uppercase;
    box-shadow: 0 14px 34px rgba(220, 38, 38, 0.22);
    transition: transform 160ms ease, filter 160ms ease;
  }

  .rgvx-receipt-thanks-button:hover {
    filter: brightness(1.08);
    transform: translateY(-1px);
  }

  @media (max-width: 620px) {
    .rgvx-receipt-thanks-card {
      margin-top: 18px;
      border-radius: 22px;
      padding: 32px 20px;
    }

    .rgvx-receipt-thanks-details {
      grid-template-columns: 1fr;
      margin: 26px 0;
    }

    .rgvx-receipt-thanks-button {
      width: 100%;
    }
  }

  .rgvx-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 38px;
  }

  .rgvx-ghost-link,
  .rgvx-lock-pill {
    display: inline-flex;
    min-height: 40px;
    align-items: center;
    justify-content: center;
    gap: 9px;
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.32);
    padding: 0 15px;
    color: rgba(255, 255, 255, 0.72);
    font-size: 10px;
    font-weight: 950;
    letter-spacing: 0.14em;
    text-decoration: none;
    text-transform: uppercase;
    backdrop-filter: blur(14px);
  }

  .rgvx-ghost-link:hover {
    border-color: rgba(239, 68, 68, 0.48);
    color: #ffffff;
  }

  .rgvx-clean-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: 20px;
    margin-bottom: 28px;
  }

  .rgvx-clean-header p,
  .rgvx-section-heading p,
  .rgvx-summary-head p,
  .rgvx-thanks-heading p,
  .rgvx-payment-total span,
  .rgvx-memo-box span,
  .rgvx-payment-lines span {
    margin: 0;
    color: rgba(248, 113, 113, 0.92);
    font-size: 9px;
    font-weight: 1000;
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }

  .rgvx-clean-header h1 {
    margin: 5px 0 0;
    color: #ffffff;
    font-size: clamp(38px, 5vw, 58px);
    font-weight: 1000;
    letter-spacing: -0.07em;
    line-height: 0.95;
    text-transform: uppercase;
  }

  .rgvx-clean-header > div > span {
    display: block;
    max-width: 620px;
    margin-top: 9px;
    color: rgba(255, 255, 255, 0.50);
    font-size: 13px;
    font-weight: 700;
    line-height: 1.6;
  }

  .rgvx-header-note {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border: 1px solid rgba(220, 38, 38, 0.28);
    border-radius: 999px;
    background: rgba(220, 38, 38, 0.08);
    padding: 0 16px;
    color: rgba(255, 255, 255, 0.82);
    font-size: 10px;
    font-weight: 950;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .rgvx-clean-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 34px;
    align-items: start;
  }

  .rgvx-flow {
    min-width: 0;
  }

  .rgvx-flow-section,
  .rgvx-zelle-area,
  .rgvx-policy {
    border-top: 1px solid rgba(255, 255, 255, 0.09);
    padding-top: 22px;
    margin-top: 22px;
  }

  .rgvx-flow-section.first {
    border-top: 0;
    padding-top: 0;
    margin-top: 0;
  }

  .rgvx-section-heading {
    margin-bottom: 16px;
  }

  .rgvx-section-heading h2,
  .rgvx-thanks-heading h1 {
    margin: 4px 0 0;
    color: #ffffff;
    font-size: clamp(24px, 3vw, 34px);
    font-weight: 1000;
    letter-spacing: -0.055em;
    line-height: 1;
  }

  .rgvx-section-heading span,
  .rgvx-block-title small,
  .rgvx-zelle-banner span,
  .rgvx-thanks-heading span,
  .rgvx-receipt-panel .rgvx-section-heading span {
    display: block;
    margin-top: 8px;
    color: rgba(255, 255, 255, 0.47);
    font-size: 12px;
    font-weight: 700;
    line-height: 1.55;
  }

  .rgvx-payment-switch {
    display: grid;
    gap: 10px;
  }

  .rgvx-payment-option {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) auto;
    gap: 13px;
    align-items: center;
    width: 100%;
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 22px;
    background: rgba(255, 255, 255, 0.035);
    padding: 13px;
    color: #ffffff;
    cursor: pointer;
    text-align: left;
    transition: border-color 180ms ease, background 180ms ease, transform 180ms ease;
  }

  .rgvx-payment-option:hover,
  .rgvx-payment-option.active {
    border-color: rgba(248, 113, 113, 0.55);
    background: rgba(220, 38, 38, 0.10);
    transform: translateY(-1px);
  }

  .rgvx-payment-option > svg {
    display: grid;
    width: 42px;
    height: 42px;
    border: 1px solid rgba(220, 38, 38, 0.22);
    border-radius: 16px;
    padding: 10px;
    color: rgb(248, 113, 113);
    background: rgba(220, 38, 38, 0.08);
  }

  .rgvx-payment-option strong {
    display: block;
    color: #ffffff;
    font-size: 15px;
    font-weight: 950;
    letter-spacing: -0.035em;
  }

  .rgvx-payment-option small {
    display: block;
    margin-top: 3px;
    color: rgba(255, 255, 255, 0.46);
    font-size: 12px;
    font-weight: 750;
    line-height: 1.45;
  }

  .rgvx-payment-option em {
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 999px;
    padding: 7px 10px;
    color: rgba(255, 255, 255, 0.74);
    font-size: 9px;
    font-style: normal;
    font-weight: 1000;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .rgvx-payment-option.active em {
    border-color: rgba(248, 113, 113, 0.35);
    background: rgba(220, 38, 38, 0.14);
    color: #ffffff;
  }

  .rgvx-coupon-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 14px;
    align-items: center;
  }

  .rgvx-coupon-row > div:first-child {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    color: rgba(255, 255, 255, 0.68);
    font-size: 10px;
    font-weight: 1000;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .rgvx-coupon-row > p {
    grid-column: 2;
    margin: -4px 0 0;
    color: rgba(248, 113, 113, 0.78);
    font-size: 11px;
    font-weight: 800;
  }

  .rgvx-code-input {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 9px;
  }

  input,
  select {
    width: 100%;
    min-height: 48px;
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 16px;
    background: rgba(0, 0, 0, 0.34);
    padding: 0 14px;
    color: #ffffff;
    outline: none;
    font-family: inherit;
    font-size: 13px;
    font-weight: 800;
    transition: border-color 160ms ease, background 160ms ease;
  }

  input::placeholder {
    color: rgba(255, 255, 255, 0.26);
  }

  input:focus,
  select:focus {
    border-color: rgba(248, 113, 113, 0.48);
    background: rgba(0, 0, 0, 0.52);
  }

  select option {
    background: #080808;
    color: #ffffff;
  }

  .rgvx-code-input button,
  .rgvx-upload-button {
    display: inline-flex;
    min-height: 48px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 0;
    border-radius: 16px;
    background: #dc2626;
    padding: 0 16px;
    color: #ffffff;
    cursor: pointer;
    font-size: 10px;
    font-weight: 1000;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    transition: background 160ms ease, transform 160ms ease;
  }

  .rgvx-code-input button:hover,
  .rgvx-upload-button:hover {
    background: #ef4444;
    transform: translateY(-1px);
  }

  .rgvx-code-input .remove {
    border: 1px solid rgba(255, 255, 255, 0.10);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.72);
  }

  .rgvx-zelle-area {
    display: grid;
    gap: 22px;
  }

  .rgvx-zelle-banner,
  .rgvx-shipping-line {
    display: flex;
    align-items: center;
    gap: 12px;
    border: 1px solid rgba(220, 38, 38, 0.18);
    border-radius: 22px;
    background: rgba(220, 38, 38, 0.07);
    padding: 14px;
  }

  .rgvx-zelle-banner svg,
  .rgvx-shipping-line svg {
    flex: 0 0 auto;
    color: rgb(248, 113, 113);
  }

  .rgvx-zelle-banner strong,
  .rgvx-shipping-line strong {
    display: block;
    color: #ffffff;
    font-size: 13px;
    font-weight: 950;
  }

  .rgvx-form-section {
    display: grid;
    gap: 14px;
  }

  .rgvx-block-title {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .rgvx-block-title svg {
    color: rgb(248, 113, 113);
    margin-top: 2px;
  }

  .rgvx-block-title strong {
    display: block;
    color: #ffffff;
    font-size: 15px;
    font-weight: 950;
    letter-spacing: -0.025em;
  }

  .rgvx-form-grid {
    display: grid;
    gap: 12px;
  }

  .rgvx-form-grid.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .rgvx-form-grid.three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .rgvx-field {
    display: grid;
    gap: 7px;
  }

  .rgvx-field.wide {
    grid-column: 1 / -1;
  }

  .rgvx-field > span {
    color: rgba(255, 255, 255, 0.48);
    font-size: 10px;
    font-weight: 950;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .rgvx-marketing-inline,
  .rgvx-policy {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    color: rgba(255, 255, 255, 0.58);
    font-size: 12px;
    font-weight: 750;
    line-height: 1.55;
  }

  .rgvx-marketing-inline input,
  .rgvx-policy input {
    width: 16px;
    min-width: 16px;
    height: 16px;
    min-height: 16px;
    margin-top: 2px;
    accent-color: #dc2626;
  }

  .rgvx-policy a {
    color: #ffffff;
    font-weight: 900;
    text-decoration: underline;
    text-underline-offset: 4px;
  }

  .rgvx-policy.warning {
    color: rgb(254, 202, 202);
  }

  .rgvx-shipping-line {
    justify-content: space-between;
  }

  .rgvx-shipping-line > div {
    min-width: 0;
    flex: 1;
  }

  .rgvx-shipping-line small {
    display: block;
    margin-top: 3px;
    color: rgba(255, 255, 255, 0.48);
    font-size: 11px;
    font-weight: 750;
    line-height: 1.45;
  }

  .rgvx-shipping-line em {
    flex: 0 0 auto;
    color: #ffffff;
    font-size: 13px;
    font-style: normal;
    font-weight: 1000;
  }

  .rgvx-error,
  .rgvx-success,
  .rgvx-receipt-message {
    margin: 18px 0 0;
    border: 1px solid rgba(248, 113, 113, 0.22);
    border-radius: 16px;
    background: rgba(220, 38, 38, 0.08);
    padding: 13px;
    color: rgb(254, 202, 202);
    font-size: 12px;
    font-weight: 850;
    line-height: 1.5;
  }

  .rgvx-success,
  .rgvx-receipt-message {
    border-color: rgba(34, 197, 94, 0.20);
    background: rgba(34, 197, 94, 0.08);
    color: rgb(187, 247, 208);
  }

  .rgvx-final-button {
    display: flex;
    width: 100%;
    min-height: 68px;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    margin-top: 22px;
    border: 0;
    border-radius: 24px;
    background: linear-gradient(135deg, #dc2626, #991b1b);
    padding: 0 20px;
    color: #ffffff;
    cursor: pointer;
    text-align: left;
    box-shadow: 0 22px 55px rgba(220, 38, 38, 0.23);
    transition: transform 160ms ease, filter 160ms ease;
  }

  .rgvx-final-button:hover {
    transform: translateY(-1px);
    filter: brightness(1.08);
  }

  .rgvx-final-button:disabled,
  .rgvx-upload-button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
    transform: none;
  }

  .rgvx-final-button strong {
    display: block;
    color: #ffffff;
    font-size: 14px;
    font-weight: 1000;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .rgvx-final-button small {
    display: block;
    margin-top: 4px;
    color: rgba(255, 255, 255, 0.70);
    font-size: 11px;
    font-weight: 800;
  }

  .rgvx-order-summary {
    position: sticky;
    top: 88px;
    align-self: start;
    display: grid;
    max-height: calc(100dvh - 104px);
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    border-left: 1px solid rgba(255, 255, 255, 0.10);
    padding-left: 24px;
    padding-bottom: 16px;
    scrollbar-width: none;
  }

  .rgvx-order-summary::-webkit-scrollbar {
    display: none;
  }

  .rgvx-summary-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .rgvx-summary-head h2 {
    margin: 5px 0 0;
    color: #ffffff;
    font-size: 34px;
    font-weight: 1000;
    letter-spacing: -0.065em;
  }

  .rgvx-items-list {
    display: grid;
    gap: 12px;
    max-height: min(260px, 32dvh);
    overflow-y: auto;
    padding: 16px 2px;
    scrollbar-width: none;
  }

  .rgvx-items-list::-webkit-scrollbar {
    display: none;
  }

  .rgvx-summary-item {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 11px;
    align-items: center;
  }

  .rgvx-item-image {
    position: relative;
    display: grid;
    width: 52px;
    height: 52px;
    place-items: center;
    border-radius: 16px;
    background: radial-gradient(circle, rgba(220, 38, 38, 0.18), rgba(255, 255, 255, 0.04));
  }

  .rgvx-item-image img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .rgvx-item-image span {
    position: absolute;
    right: -5px;
    top: -5px;
    display: grid;
    min-width: 20px;
    height: 20px;
    place-items: center;
    border-radius: 999px;
    background: #dc2626;
    color: white;
    font-size: 10px;
    font-weight: 1000;
  }

  .rgvx-summary-item strong {
    display: block;
    color: #ffffff;
    font-size: 12px;
    font-weight: 950;
    line-height: 1.15;
  }

  .rgvx-summary-item small {
    display: block;
    margin-top: 4px;
    color: rgba(255, 255, 255, 0.42);
    font-size: 10px;
    line-height: 1.35;
  }

  .rgvx-summary-item em {
    color: #ffffff;
    font-size: 12px;
    font-style: normal;
    font-weight: 1000;
  }

  .rgvx-free-progress {
    display: grid;
    gap: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    padding: 16px 0;
  }

  .rgvx-free-progress > div:first-child,
  .rgvx-totals > .rgvx-total-row {
    display: flex;
    justify-content: space-between;
    gap: 14px;
  }

  .rgvx-free-progress span,
  .rgvx-totals span {
    color: rgba(255, 255, 255, 0.46);
    font-size: 12px;
    font-weight: 900;
  }

  .rgvx-free-progress strong,
  .rgvx-totals strong {
    color: #ffffff;
    font-size: 12px;
    font-weight: 1000;
  }

  .progress-track {
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
  }

  .progress-track span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #991b1b, #ef4444);
  }

  .rgvx-shipping-options {
    display: grid;
    gap: 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    padding: 14px 0 16px;
  }

  .rgvx-shipping-options.flow {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 24px;
    background: rgba(255, 255, 255, 0.025);
    padding: 16px;
  }

  .rgvx-shipping-options-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .rgvx-shipping-options-head span {
    color: rgba(255, 255, 255, 0.46);
    font-size: 12px;
    font-weight: 900;
  }

  .rgvx-shipping-options-head strong {
    color: rgba(255, 255, 255, 0.76);
    font-size: 11px;
    font-weight: 1000;
  }

  .rgvx-shipping-option-list {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .rgvx-shipping-option {
    appearance: none;
    display: flex;
    width: 100%;
    min-height: 78px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.025);
    padding: 14px;
    color: #ffffff;
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
  }

  .rgvx-shipping-option:hover {
    border-color: rgba(248, 113, 113, 0.25);
    background: rgba(220, 38, 38, 0.06);
    transform: translateY(-1px);
  }

  .rgvx-shipping-option.active {
    border-color: rgba(248, 113, 113, 0.42);
    background: rgba(220, 38, 38, 0.10);
    box-shadow: inset 0 0 0 1px rgba(248, 113, 113, 0.18);
  }

  .rgvx-shipping-option div {
    min-width: 0;
  }

  .rgvx-shipping-option strong {
    display: block;
    color: #ffffff;
    font-size: 12px;
    font-weight: 1000;
  }

  .rgvx-shipping-option small {
    display: block;
    margin-top: 3px;
    color: rgba(255, 255, 255, 0.46);
    font-size: 10px;
    font-weight: 750;
    line-height: 1.35;
  }

  .rgvx-shipping-option small.rgvx-shipping-free-note {
    color: rgba(74, 222, 128, 0.78);
  }

  .rgvx-shipping-option em {
    flex: 0 0 auto;
    color: #ffffff;
    font-size: 12px;
    font-style: normal;
    font-weight: 1000;
    white-space: nowrap;
  }

  .rgvx-shipping-option.active em {
    color: rgb(254, 202, 202);
  }

  .rgvx-totals {
    display: grid;
    gap: 12px;
    padding-top: 16px;
  }

  .rgvx-totals .good strong,
  .rgvx-totals .free {
    color: rgb(187, 247, 208);
  }

  .rgvx-totals .total {
    border-top: 1px solid rgba(255, 255, 255, 0.10);
    margin-top: 4px;
    padding-top: 14px;
  }

  .rgvx-totals .total span {
    color: rgba(255, 255, 255, 0.70);
  }

  .rgvx-totals .total strong {
    color: #ffffff;
    font-size: 22px;
    letter-spacing: -0.045em;
  }

  .rgvx-mini-coupon {
    display: grid;
    width: 100%;
    min-width: 0;
    gap: 12px;
    margin-top: 10px;
    border: 1px solid rgba(34, 197, 94, 0.20);
    border-radius: 22px;
    background:
      radial-gradient(circle at 0% 0%, rgba(34, 197, 94, 0.07), transparent 42%),
      linear-gradient(180deg, rgba(8, 12, 10, 0.96), rgba(5, 7, 6, 0.96));
    padding: 14px;
    overflow: hidden;
  }

  .rgvx-mini-coupon.is-valid {
    border-color: rgba(34, 197, 94, 0.24);
  }

  .rgvx-mini-coupon.is-invalid {
    border-color: rgba(248, 113, 113, 0.28);
    background:
      radial-gradient(circle at 0% 0%, rgba(248, 113, 113, 0.06), transparent 42%),
      linear-gradient(180deg, rgba(12, 8, 8, 0.96), rgba(7, 5, 5, 0.96));
  }

  .rgvx-mini-coupon.is-validating {
    border-color: rgba(255, 255, 255, 0.12);
  }

  .rgvx-mini-coupon-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .rgvx-mini-coupon-title {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
  }

  .rgvx-mini-coupon-title svg {
    flex: 0 0 auto;
    color: rgba(255, 255, 255, 0.78);
  }

  .rgvx-mini-coupon-title span {
    color: rgba(255, 255, 255, 0.62);
    font-size: 10px;
    font-weight: 1000;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .rgvx-mini-coupon-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 24px;
    padding: 0 10px;
    border-radius: 999px;
    background: rgba(34, 197, 94, 0.14);
    color: rgb(187, 247, 208);
    font-size: 8px;
    font-weight: 1000;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .rgvx-mini-coupon-controls {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .rgvx-mini-coupon-code-wrap {
    display: flex;
    min-width: 0;
    min-height: 48px;
    align-items: center;
    gap: 10px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.03);
    padding: 0 12px;
  }

  .rgvx-mini-coupon-input {
    width: 100%;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: #ffffff;
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .rgvx-mini-coupon-input::placeholder {
    color: rgba(255, 255, 255, 0.28);
    text-transform: none;
    letter-spacing: 0;
  }

  .rgvx-mini-coupon-input:disabled {
    cursor: not-allowed;
    opacity: 0.72;
  }

  .rgvx-coupon-clear {
    display: inline-grid;
    width: 28px;
    height: 28px;
    flex: 0 0 auto;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.72);
    cursor: pointer;
    transition: 160ms ease;
  }

  .rgvx-coupon-clear:hover {
    border-color: rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.08);
    color: #ffffff;
  }

  .rgvx-mini-coupon-action {
    display: inline-flex;
    width: 100%;
    min-height: 46px;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 16px;
    background: #db3a2f;
    padding: 0 14px;
    color: #ffffff;
    cursor: pointer;
    font-size: 10px;
    font-weight: 1000;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    transition: background 160ms ease, transform 160ms ease, opacity 160ms ease;
    white-space: nowrap;
  }

  .rgvx-mini-coupon-action:hover:not(:disabled) {
    background: #ef4444;
    transform: translateY(-1px);
  }

  .rgvx-mini-coupon-action:disabled {
    opacity: 0.55;
    cursor: not-allowed;
    transform: none;
  }

  .rgvx-coupon-message {
    margin: 0;
    color: rgba(255, 255, 255, 0.66);
    font-size: 11px;
    font-weight: 800;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .rgvx-coupon-message.is-valid {
    color: rgb(209, 250, 229);
  }

  .rgvx-coupon-message.is-invalid {
    color: rgb(254, 202, 202);
  }

  .rgvx-coupon-message.is-validating {
    color: rgba(255, 255, 255, 0.62);
  }

  .rgvx-totals {
    position: sticky;
    bottom: 0;
    z-index: 4;
    margin-top: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    background:
      linear-gradient(to bottom, rgba(3, 3, 3, 0), rgba(3, 3, 3, 0.98) 18%),
      rgba(3, 3, 3, 0.94);
    padding-top: 16px;
    padding-bottom: 2px;
    backdrop-filter: blur(16px);
  }

  .rgvx-floating-total-bar {
    display: none;
  }

  .rgvx-upload-zone {
    display: grid;
    place-items: center;
    gap: 8px;
    min-height: 160px;
    border: 1px dashed rgba(248, 113, 113, 0.34);
    border-radius: 24px;
    background: rgba(220, 38, 38, 0.05);
    padding: 20px;
    color: #ffffff;
    cursor: pointer;
    text-align: center;
  }

  .rgvx-upload-zone input {
    display: none;
  }

  .rgvx-upload-zone svg {
    color: rgb(248, 113, 113);
  }

  .rgvx-upload-zone strong {
    color: #ffffff;
    font-size: 13px;
    font-weight: 950;
    overflow-wrap: anywhere;
  }

  .rgvx-upload-zone small {
    color: rgba(255, 255, 255, 0.46);
    font-size: 11px;
    font-weight: 750;
  }

  .rgvx-upload-button {
    width: 100%;
    margin-top: 12px;
  }

  .rgvx-empty-page {
    display: grid;
    place-items: center;
  }

  .rgvx-empty-state {
    position: relative;
    z-index: 1;
    width: min(460px, 100%);
    text-align: center;
  }

  .rgvx-empty-state p {
    color: rgba(248, 113, 113, 0.92);
    font-size: 10px;
    font-weight: 1000;
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }

  .rgvx-empty-state h1 {
    margin: 8px 0 0;
    color: #ffffff;
    font-size: 42px;
    font-weight: 1000;
    letter-spacing: -0.06em;
  }

  .rgvx-empty-state span {
    display: block;
    margin-top: 8px;
    color: rgba(255, 255, 255, 0.48);
    font-size: 13px;
    line-height: 1.6;
  }

  .rgvx-empty-state a {
    display: inline-flex;
    min-height: 46px;
    align-items: center;
    justify-content: center;
    margin-top: 20px;
    border-radius: 999px;
    background: #dc2626;
    padding: 0 18px;
    color: #ffffff;
    font-size: 10px;
    font-weight: 1000;
    letter-spacing: 0.14em;
    text-decoration: none;
    text-transform: uppercase;
  }

  @media (max-width: 980px) {
    .rgvx-page {
      padding: 138px 14px calc(132px + env(safe-area-inset-bottom));
    }

    .rgvx-clean-layout,
    .rgvx-thanks-layout {
      grid-template-columns: 1fr;
    }

    .rgvx-order-summary {
      position: static;
      max-height: none;
      overflow: visible;
      border-left: 0;
      border-top: 1px solid rgba(255, 255, 255, 0.10);
      padding-left: 0;
      padding-top: 24px;
      padding-bottom: 0;
    }

    .rgvx-totals {
      position: static;
      border-top: 0;
      background: transparent;
      padding-bottom: 0;
      backdrop-filter: none;
    }
  }

  @media (max-width: 760px) {
    .rgvx-page {
      padding: 128px 12px 118px;
    }

    .rgvx-topbar,
    .rgvx-clean-header {
      grid-template-columns: 1fr;
      align-items: start;
    }

    .rgvx-topbar {
      flex-direction: column;
      align-items: stretch;
    }

    .rgvx-ghost-link,
    .rgvx-lock-pill,
    .rgvx-header-note {
      width: fit-content;
    }

    .rgvx-clean-header h1 {
      font-size: clamp(38px, 14vw, 52px);
    }

    .rgvx-payment-option {
      grid-template-columns: 38px minmax(0, 1fr);
    }

    .rgvx-payment-option em {
      grid-column: 2;
      width: fit-content;
    }

    .rgvx-coupon-row {
      grid-template-columns: 1fr;
    }

    .rgvx-coupon-row > p {
      grid-column: auto;
    }

    .rgvx-code-input {
      grid-template-columns: 1fr;
    }

    .rgvx-form-grid.two,
    .rgvx-form-grid.three,
    .rgvx-payment-lines,
    .rgvx-delivery-summary {
      grid-template-columns: 1fr;
    }

    .rgvx-floating-total-bar {
      position: fixed;
      left: 12px;
      right: 12px;
      bottom: calc(12px + env(safe-area-inset-bottom));
      z-index: 90;
      display: flex;
      min-height: 58px;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      background:
        radial-gradient(circle at 15% 0%, rgba(220, 38, 38, 0.22), transparent 42%),
        rgba(5, 5, 5, 0.92);
      padding: 0 16px;
      box-shadow: 0 18px 55px rgba(0, 0, 0, 0.52);
      backdrop-filter: blur(18px);
    }

    .rgvx-floating-total-bar span {
      color: rgba(255, 255, 255, 0.55);
      font-size: 10px;
      font-weight: 1000;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .rgvx-floating-total-bar strong {
      color: #ffffff;
      font-size: 20px;
      font-weight: 1000;
      letter-spacing: -0.045em;
    }

    .rgvx-mini-code-input {
      grid-template-columns: 1fr auto;
    }

    .rgvx-final-button {
      min-height: 72px;
      border-radius: 22px;
      padding: 0 16px;
    }
  }

  /* =========================================================
     CLEAN STICKY SUMMARY + MOBILE RESPONSIVE FIX
     Desktop: summary stays in its right column and sticks while scrolling.
     It no longer uses fixed positioning, so it will not float over the header.
     Mobile/tablet: summary returns to normal flow and the bottom total bar stays visible.
  ========================================================= */

  .rgvx-page,
  .rgvx-shell,
  .rgvx-clean-layout {
    overflow: visible !important;
  }

  .rgvx-floating-total-bar {
    display: none;
  }

  @media (min-width: 981px) {
    .rgvx-clean-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(340px, 390px);
      gap: 34px;
      align-items: start;
    }

    .rgvx-flow {
      min-width: 0;
    }

    .rgvx-order-summary {
      position: sticky !important;
      top: 92px;
      align-self: start;
      z-index: 8;
      width: 100%;
      max-height: none;
      overflow: visible;
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 28px;
      background:
        radial-gradient(circle at 12% 0%, rgba(220, 38, 38, 0.12), transparent 40%),
        rgba(5, 5, 5, 0.90);
      padding: 18px;
      box-shadow: 0 28px 90px rgba(0, 0, 0, 0.40);
      backdrop-filter: blur(18px);
      scrollbar-width: none;
    }

    .rgvx-order-summary::-webkit-scrollbar {
      display: none;
    }

    .rgvx-items-list {
      max-height: 250px;
      min-height: 0;
      overflow-y: auto;
      scrollbar-width: none;
    }

    .rgvx-items-list::-webkit-scrollbar {
      display: none;
    }

    .rgvx-totals {
      position: static;
      margin: 0;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 0;
      background: transparent;
      padding: 16px 0 0;
      backdrop-filter: none;
    }
  }

  @media (max-width: 980px) {
    .rgvx-page {
      min-height: 100dvh;
      padding: 108px 14px calc(132px + env(safe-area-inset-bottom));
      overflow-x: clip !important;
      overflow-y: visible !important;
    }

    .rgvx-shell,
    .rgvx-thanks-shell {
      width: 100%;
    }

    .rgvx-clean-layout,
    .rgvx-thanks-layout {
      grid-template-columns: 1fr !important;
      gap: 26px;
    }

    .rgvx-order-summary {
      position: static !important;
      width: 100%;
      max-height: none;
      overflow: visible;
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 26px;
      background:
        radial-gradient(circle at 12% 0%, rgba(220, 38, 38, 0.10), transparent 40%),
        rgba(5, 5, 5, 0.74);
      padding: 16px;
      box-shadow: 0 20px 70px rgba(0, 0, 0, 0.30);
      backdrop-filter: blur(16px);
    }

    .rgvx-items-list {
      max-height: none;
      overflow: visible;
    }

    .rgvx-totals {
      position: static !important;
      margin: 0;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 0;
      background: transparent;
      padding: 16px 0 0;
      backdrop-filter: none;
    }

    .rgvx-floating-total-bar {
      position: fixed;
      left: 14px;
      right: 14px;
      bottom: calc(14px + env(safe-area-inset-bottom));
      z-index: 100;
      display: flex !important;
      min-height: 62px;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 22px;
      background:
        radial-gradient(circle at 16% 0%, rgba(220, 38, 38, 0.24), transparent 44%),
        rgba(5, 5, 5, 0.94);
      padding: 0 17px;
      box-shadow: 0 22px 60px rgba(0, 0, 0, 0.58);
      backdrop-filter: blur(18px);
    }

    .rgvx-floating-total-bar span {
      color: rgba(255, 255, 255, 0.58);
      font-size: 10px;
      font-weight: 1000;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .rgvx-floating-total-bar strong {
      color: #ffffff;
      font-size: 22px;
      font-weight: 1000;
      letter-spacing: -0.055em;
    }
  }

  @media (max-width: 760px) {
    .rgvx-topbar,
    .rgvx-clean-header {
      grid-template-columns: 1fr;
      align-items: flex-start;
    }

    .rgvx-topbar {
      flex-direction: column;
      align-items: stretch;
      gap: 10px;
    }

    .rgvx-ghost-link,
    .rgvx-lock-pill,
    .rgvx-header-note {
      width: fit-content;
      max-width: 100%;
    }

    .rgvx-clean-header {
      margin-bottom: 24px;
    }

    .rgvx-clean-header h1 {
      font-size: clamp(36px, 13vw, 50px);
      line-height: 0.96;
    }

    .rgvx-clean-header > div > span {
      max-width: 100%;
      font-size: 12px;
      line-height: 1.55;
    }

    .rgvx-section-heading h2,
    .rgvx-thanks-heading h1 {
      font-size: clamp(24px, 8vw, 32px);
    }

    .rgvx-payment-option {
      grid-template-columns: 40px minmax(0, 1fr);
      gap: 12px;
      padding: 14px 0;
    }

    .rgvx-payment-option em {
      grid-column: 2;
      justify-self: start;
      margin-top: 3px;
    }

    .rgvx-form-grid.two,
    .rgvx-form-grid.three,
    .rgvx-payment-lines,
    .rgvx-delivery-summary {
      grid-template-columns: 1fr !important;
    }

    .rgvx-marketing-inline,
    .rgvx-policy {
      font-size: 11.5px;
    }

    .rgvx-final-button {
      min-height: 64px;
      border-radius: 21px;
      padding: 0 16px;
    }

    .rgvx-final-button strong {
      font-size: 12px;
    }

    .rgvx-final-button small {
      font-size: 10.5px;
      line-height: 1.35;
    }

    .rgvx-order-summary {
      border-radius: 24px;
      padding: 14px;
    }

    .rgvx-summary-head h2 {
      font-size: 30px;
    }

    .rgvx-summary-item {
      grid-template-columns: 46px minmax(0, 1fr) auto;
      gap: 10px;
    }

    .rgvx-item-image {
      width: 46px;
      height: 46px;
      border-radius: 14px;
    }

    .rgvx-totals .total strong {
      font-size: 24px;
    }

    .rgvx-mini-code-input {
      grid-template-columns: minmax(0, 1fr) 78px;
    }

    .rgvx-mini-code-input input,
    .rgvx-mini-code-input button {
      min-height: 38px;
    }

    .rgvx-floating-total-bar {
      left: 10px;
      right: 10px;
      bottom: calc(10px + env(safe-area-inset-bottom));
      min-height: 58px;
      border-radius: 20px;
      padding: 0 14px;
    }
  }

  @media (max-width: 420px) {
    .rgvx-page {
      padding-left: 10px;
      padding-right: 10px;
    }

    .rgvx-payment-option {
      grid-template-columns: 36px minmax(0, 1fr);
    }

    .rgvx-mini-code-input {
      grid-template-columns: 1fr;
    }

    .rgvx-mini-code-input button {
      width: 100%;
    }

    .rgvx-floating-total-bar strong {
      font-size: 20px;
    }
  }


  .rgvx-zelle-guide-card {
    position: relative;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 32px;
    background:
      radial-gradient(circle at 8% 0%, rgba(220, 38, 38, 0.2), transparent 34%),
      radial-gradient(circle at 95% 12%, rgba(127, 29, 29, 0.2), transparent 32%),
      linear-gradient(135deg, rgba(255, 255, 255, 0.052), rgba(255, 255, 255, 0.014)),
      rgba(7, 7, 7, 0.92);
    box-shadow: 0 34px 110px rgba(0, 0, 0, 0.38);
    backdrop-filter: blur(20px);
    padding: clamp(20px, 3vw, 34px);
  }

  .rgvx-zelle-guide-card::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px);
    background-size: 46px 46px;
    mask-image: radial-gradient(circle at 30% 0%, black, transparent 68%);
    opacity: 0.55;
  }

  .rgvx-zelle-guide-card > * {
    position: relative;
    z-index: 1;
  }

  .rgvx-zelle-guide-status {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    min-height: 38px;
    border: 1px solid rgba(74, 222, 128, 0.18);
    border-radius: 999px;
    background: rgba(74, 222, 128, 0.07);
    padding: 0 14px;
    color: rgba(220, 252, 231, 0.92);
    font-size: 11px;
    font-weight: 1000;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  .rgvx-zelle-guide-hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(210px, 280px);
    gap: 24px;
    align-items: end;
    margin-top: 22px;
    padding-bottom: 26px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .rgvx-zelle-guide-title p,
  .rgvx-zelle-guide-total span,
  .rgvx-zelle-payment-line span,
  .rgvx-guide-section-heading p,
  .rgvx-zelle-guide-footer span {
    margin: 0;
    color: rgba(248, 113, 113, 0.92);
    font-size: 10px;
    font-weight: 1000;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .rgvx-zelle-guide-title h1 {
    margin: 7px 0 0;
    color: #ffffff;
    font-size: clamp(38px, 5.6vw, 72px);
    font-weight: 1000;
    letter-spacing: -0.074em;
    line-height: 0.9;
    text-transform: uppercase;
    max-width: 880px;
  }

  .rgvx-zelle-guide-title > span {
    display: block;
    max-width: 780px;
    margin-top: 14px;
    color: rgba(255, 255, 255, 0.62);
    font-size: 14px;
    font-weight: 750;
    line-height: 1.72;
  }

  .rgvx-zelle-guide-total {
    justify-self: end;
    min-width: 230px;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
    padding-left: 24px;
    text-align: right;
  }

  .rgvx-zelle-guide-total strong {
    display: block;
    margin-top: 8px;
    color: #ffffff;
    font-size: clamp(38px, 4vw, 54px);
    font-weight: 1000;
    letter-spacing: -0.06em;
    line-height: 0.95;
  }

  .rgvx-zelle-guide-total small {
    display: block;
    margin-top: 8px;
    color: rgba(255, 255, 255, 0.52);
    font-size: 12px;
    font-weight: 800;
  }

  .rgvx-zelle-payment-line {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr) auto;
    gap: 18px;
    align-items: stretch;
    margin-top: 24px;
    padding: 18px;
    border: 1px solid rgba(220, 38, 38, 0.16);
    border-radius: 24px;
    background:
      linear-gradient(135deg, rgba(220, 38, 38, 0.105), rgba(255, 255, 255, 0.018)),
      rgba(0, 0, 0, 0.22);
  }

  .rgvx-zelle-payment-line > div {
    min-width: 0;
  }

  .rgvx-zelle-payment-line strong {
    display: block;
    margin-top: 8px;
    color: #ffffff;
    font-size: 16px;
    font-weight: 1000;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .rgvx-zelle-payment-line small {
    display: block;
    margin-top: 6px;
    color: rgba(255, 255, 255, 0.52);
    font-size: 12px;
    font-weight: 750;
    line-height: 1.45;
  }

  .rgvx-zelle-memo-panel strong {
    display: inline-flex;
    width: fit-content;
    border: 1px solid rgba(248, 113, 113, 0.3);
    border-radius: 15px;
    background: rgba(220, 38, 38, 0.16);
    padding: 10px 13px;
    letter-spacing: 0.06em;
  }

  .rgvx-copy-memo-button {
    align-self: center;
    height: 48px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    padding: 0 18px;
    color: #ffffff;
    cursor: pointer;
    font-size: 11px;
    font-weight: 1000;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease;
    white-space: nowrap;
  }

  .rgvx-copy-memo-button:hover {
    transform: translateY(-1px);
    border-color: rgba(248, 113, 113, 0.35);
    background: rgba(220, 38, 38, 0.14);
  }

  .rgvx-zelle-guide-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
    gap: 34px;
    align-items: start;
    margin-top: 28px;
  }

  .rgvx-guide-section-heading h2 {
    margin: 7px 0 0;
    color: #ffffff;
    font-size: 26px;
    font-weight: 1000;
    letter-spacing: -0.045em;
  }

  .rgvx-guide-section-heading > span {
    display: block;
    margin-top: 7px;
    color: rgba(255, 255, 255, 0.54);
    font-size: 13px;
    font-weight: 750;
    line-height: 1.55;
  }

  .rgvx-guide-step-list {
    display: grid;
    gap: 18px;
    margin-top: 22px;
  }

  .rgvx-guide-step-item {
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr);
    gap: 15px;
    align-items: start;
  }

  .rgvx-guide-step-item b {
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    border: 1px solid rgba(220, 38, 38, 0.22);
    border-radius: 14px;
    background: rgba(220, 38, 38, 0.1);
    color: #ffffff;
    font-size: 14px;
    font-weight: 1000;
  }

  .rgvx-guide-step-item.is-important b {
    border-color: rgba(248, 113, 113, 0.34);
    background: rgba(220, 38, 38, 0.2);
    box-shadow: 0 14px 40px rgba(127, 29, 29, 0.24);
  }

  .rgvx-guide-step-item strong {
    color: #ffffff;
    font-size: 15px;
    font-weight: 1000;
    line-height: 1.2;
  }

  .rgvx-guide-step-item p {
    margin: 7px 0 0;
    color: rgba(255, 255, 255, 0.6);
    font-size: 13px;
    font-weight: 720;
    line-height: 1.65;
  }

  .rgvx-zelle-guide-upload {
    display: grid;
    gap: 14px;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
    padding-left: 30px;
  }

  .rgvx-guide-upload-zone {
    min-height: 168px;
    border-style: dashed;
    background:
      radial-gradient(circle at 50% 0%, rgba(220, 38, 38, 0.13), transparent 48%),
      rgba(255, 255, 255, 0.022);
  }

  .rgvx-zelle-simple-warning {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-top: 28px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding-top: 18px;
    color: rgba(254, 202, 202, 0.92);
  }

  .rgvx-zelle-simple-warning p {
    margin: 0;
    color: rgba(255, 255, 255, 0.72);
    font-size: 13px;
    font-weight: 760;
    line-height: 1.65;
  }

  .rgvx-zelle-guide-footer {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 22px;
    margin-top: 24px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding-top: 20px;
  }

  .rgvx-zelle-guide-footer div {
    display: grid;
    min-width: 0;
    gap: 6px;
  }

  .rgvx-zelle-guide-footer svg {
    margin-bottom: 3px;
    color: rgba(248, 113, 113, 0.9);
  }

  .rgvx-zelle-guide-footer strong {
    color: #ffffff;
    font-size: 14px;
    font-weight: 1000;
    overflow-wrap: anywhere;
  }

  .rgvx-zelle-guide-footer small {
    color: rgba(255, 255, 255, 0.54);
    font-size: 12px;
    font-weight: 720;
    line-height: 1.5;
  }

  @media (max-width: 980px) {
    .rgvx-zelle-guide-hero {
      grid-template-columns: 1fr;
      align-items: start;
    }

    .rgvx-zelle-guide-total {
      justify-self: stretch;
      min-width: 0;
      border-left: 0;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      padding-left: 0;
      padding-top: 18px;
      text-align: left;
    }

    .rgvx-zelle-payment-line {
      grid-template-columns: 1fr;
    }

    .rgvx-copy-memo-button {
      width: fit-content;
    }

    .rgvx-zelle-guide-body {
      grid-template-columns: 1fr;
    }

    .rgvx-zelle-guide-upload {
      border-left: 0;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      padding-left: 0;
      padding-top: 24px;
    }
  }

  @media (max-width: 700px) {
    .rgvx-thanks-shell {
      padding-inline: 14px;
    }

    .rgvx-zelle-guide-card {
      border-radius: 24px;
      padding: 18px;
    }

    .rgvx-zelle-guide-status {
      width: 100%;
      justify-content: center;
      font-size: 10px;
    }

    .rgvx-zelle-guide-title h1 {
      font-size: clamp(35px, 11vw, 48px);
    }

    .rgvx-zelle-guide-title > span {
      font-size: 13px;
    }

    .rgvx-zelle-guide-hero {
      margin-top: 18px;
      padding-bottom: 20px;
    }

    .rgvx-zelle-payment-line {
      margin-top: 20px;
      padding: 15px;
      border-radius: 20px;
    }

    .rgvx-copy-memo-button {
      width: 100%;
    }

    .rgvx-zelle-guide-body {
      gap: 24px;
      margin-top: 24px;
    }

    .rgvx-guide-section-heading h2 {
      font-size: 23px;
    }

    .rgvx-guide-step-list {
      gap: 16px;
    }

    .rgvx-guide-step-item {
      grid-template-columns: 34px minmax(0, 1fr);
      gap: 12px;
    }

    .rgvx-guide-step-item b {
      width: 34px;
      height: 34px;
      border-radius: 12px;
    }

    .rgvx-guide-upload-zone {
      min-height: 150px;
    }

    .rgvx-zelle-guide-footer {
      grid-template-columns: 1fr;
    }
  }


  .rgvx-zelle-guide-card-simple {
    max-width: 1040px;
    margin: 0 auto;
    padding: clamp(18px, 2.4vw, 30px);
  }

  .rgvx-zelle-guide-hero-simple {
    grid-template-columns: minmax(0, 1fr) minmax(190px, 250px);
    align-items: center;
    gap: 22px;
    margin-top: 20px;
    padding-bottom: 22px;
  }

  .rgvx-zelle-guide-card-simple .rgvx-zelle-guide-title h1 {
    max-width: 560px;
    font-size: clamp(38px, 4.4vw, 58px);
    letter-spacing: -0.065em;
    line-height: 0.94;
    text-transform: none;
  }

  .rgvx-zelle-guide-card-simple .rgvx-zelle-guide-title > span {
    max-width: 620px;
    margin-top: 12px;
    font-size: 14px;
    line-height: 1.65;
  }

  .rgvx-zelle-guide-card-simple .rgvx-zelle-guide-total {
    min-width: 210px;
    padding-left: 22px;
  }

  .rgvx-zelle-guide-card-simple .rgvx-zelle-guide-total strong {
    font-size: clamp(34px, 3.2vw, 46px);
  }

  .rgvx-zelle-payment-line-simple {
    grid-template-columns: minmax(0, 1fr) minmax(220px, 0.72fr) auto;
    gap: 16px;
    margin-top: 22px;
    padding: 16px 18px;
  }

  .rgvx-zelle-guide-body-simple {
    grid-template-columns: minmax(0, 1fr) minmax(300px, 340px);
    gap: 30px;
    margin-top: 26px;
  }

  .rgvx-zelle-guide-card-simple .rgvx-guide-section-heading h2 {
    font-size: clamp(24px, 2.2vw, 32px);
  }

  .rgvx-zelle-guide-card-simple .rgvx-guide-step-list {
    gap: 15px;
  }

  .rgvx-zelle-guide-card-simple .rgvx-guide-step-item {
    border: 1px solid rgba(255, 255, 255, 0.065);
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.018);
    padding: 14px;
  }

  .rgvx-zelle-guide-card-simple .rgvx-guide-step-item.is-important {
    border-color: rgba(248, 113, 113, 0.22);
    background: rgba(220, 38, 38, 0.07);
  }

  .rgvx-zelle-guide-card-simple .rgvx-guide-step-item p strong {
    color: #ffffff;
  }

  @media (max-width: 980px) {
    .rgvx-zelle-guide-card-simple,
    .rgvx-zelle-guide-card-simple .rgvx-zelle-guide-title h1,
    .rgvx-zelle-guide-card-simple .rgvx-zelle-guide-title > span {
      max-width: none;
    }

    .rgvx-zelle-guide-hero-simple,
    .rgvx-zelle-payment-line-simple,
    .rgvx-zelle-guide-body-simple {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 700px) {
    .rgvx-zelle-guide-card-simple {
      padding: 18px;
    }

    .rgvx-zelle-guide-card-simple .rgvx-zelle-guide-title h1 {
      font-size: clamp(36px, 12vw, 48px);
    }

    .rgvx-zelle-guide-card-simple .rgvx-zelle-guide-total strong {
      font-size: 38px;
    }

    .rgvx-zelle-payment-line-simple {
      padding: 15px;
      gap: 14px;
    }
  }


  /* Zelle thanks memo section - cleaner + fully responsive */
  .rgvx-zelle-payment-line-simple {
    grid-template-columns: minmax(0, 1fr) minmax(280px, 0.9fr) auto;
    align-items: center;
    gap: 14px;
    border-color: rgba(248, 113, 113, 0.16);
    border-radius: 22px;
    padding: 14px;
    background:
      radial-gradient(circle at 15% 0%, rgba(220, 38, 38, 0.12), transparent 36%),
      linear-gradient(135deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.012)),
      rgba(0, 0, 0, 0.22);
  }

  .rgvx-zelle-pay-detail,
  .rgvx-zelle-memo-panel {
    min-width: 0;
    border-radius: 18px;
    padding: 13px 14px;
  }

  .rgvx-zelle-pay-detail {
    background: rgba(255, 255, 255, 0.018);
  }

  .rgvx-zelle-memo-panel {
    border: 1px solid rgba(248, 113, 113, 0.18);
    background: rgba(220, 38, 38, 0.08);
  }

  .rgvx-zelle-memo-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .rgvx-zelle-memo-header span,
  .rgvx-zelle-pay-detail span {
    color: rgba(248, 113, 113, 0.9);
    font-size: 10px;
    font-weight: 1000;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .rgvx-zelle-pay-detail strong {
    margin-top: 8px;
    font-size: clamp(14px, 1.5vw, 16px);
  }

  .rgvx-zelle-memo-panel .rgvx-zelle-memo-header strong {
    display: inline-flex;
    width: auto;
    max-width: 100%;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(248, 113, 113, 0.28);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.055);
    padding: 8px 13px;
    color: #ffffff;
    font-size: clamp(16px, 1.9vw, 22px);
    font-weight: 1000;
    letter-spacing: 0.015em;
    line-height: 1;
    overflow-wrap: anywhere;
    text-align: center;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }

  .rgvx-zelle-memo-panel small {
    margin-top: 9px;
    color: rgba(255, 255, 255, 0.62);
    font-size: 12px;
    font-weight: 780;
    line-height: 1.45;
  }

  .rgvx-copy-memo-button {
    min-width: 122px;
    height: 48px;
    border-radius: 16px;
    background:
      linear-gradient(135deg, rgba(220, 38, 38, 0.95), rgba(185, 28, 28, 0.86)),
      rgba(220, 38, 38, 0.2);
    border-color: rgba(248, 113, 113, 0.28);
    box-shadow: 0 16px 38px rgba(127, 29, 29, 0.22);
  }

  .rgvx-copy-memo-button:hover,
  .rgvx-copy-memo-button.is-copied {
    background:
      linear-gradient(135deg, rgba(34, 197, 94, 0.7), rgba(22, 101, 52, 0.65)),
      rgba(22, 163, 74, 0.22);
    border-color: rgba(134, 239, 172, 0.28);
  }

  @media (max-width: 1100px) {
    .rgvx-zelle-payment-line-simple {
      grid-template-columns: minmax(0, 1fr) minmax(260px, 0.9fr);
    }

    .rgvx-zelle-payment-line-simple .rgvx-copy-memo-button {
      grid-column: 1 / -1;
      justify-self: stretch;
      width: 100%;
    }
  }

  @media (max-width: 780px) {
    .rgvx-zelle-guide-card-simple {
      padding: 16px;
    }

    .rgvx-zelle-guide-card-simple .rgvx-zelle-guide-title h1 {
      font-size: clamp(30px, 10vw, 42px);
      letter-spacing: -0.055em;
      line-height: 0.98;
    }

    .rgvx-zelle-guide-card-simple .rgvx-zelle-guide-title > span {
      font-size: 12.5px;
      line-height: 1.6;
    }

    .rgvx-zelle-payment-line-simple {
      grid-template-columns: 1fr;
      gap: 10px;
      padding: 12px;
      border-radius: 20px;
    }

    .rgvx-zelle-pay-detail,
    .rgvx-zelle-memo-panel {
      padding: 12px;
      border-radius: 16px;
    }

    .rgvx-zelle-memo-header {
      align-items: flex-start;
      flex-direction: column;
      gap: 8px;
    }

    .rgvx-zelle-memo-panel .rgvx-zelle-memo-header strong {
      width: 100%;
      justify-content: center;
      padding: 10px 12px;
      font-size: clamp(19px, 7vw, 28px);
    }

    .rgvx-copy-memo-button {
      min-width: 0;
      width: 100%;
      height: 50px;
      border-radius: 16px;
    }

    .rgvx-zelle-guide-body-simple {
      gap: 22px;
    }

    .rgvx-zelle-guide-card-simple .rgvx-guide-step-item {
      grid-template-columns: 32px minmax(0, 1fr);
      padding: 12px;
      gap: 11px;
    }

    .rgvx-guide-step-item b {
      width: 32px;
      height: 32px;
      border-radius: 11px;
    }

    .rgvx-guide-step-item strong {
      font-size: 14px;
    }

    .rgvx-guide-step-item p {
      font-size: 12.5px;
      line-height: 1.55;
    }
  }

  @media (max-width: 430px) {
    .rgvx-thanks-shell {
      padding-inline: 10px;
    }

    .rgvx-zelle-guide-card-simple {
      padding: 13px;
      border-radius: 20px;
    }

    .rgvx-zelle-guide-status {
      min-height: 38px;
      padding-inline: 12px;
      font-size: 9px;
      letter-spacing: 0.11em;
    }

    .rgvx-zelle-guide-card-simple .rgvx-zelle-guide-total strong {
      font-size: 34px;
    }

    .rgvx-zelle-memo-header span,
    .rgvx-zelle-pay-detail span {
      font-size: 9px;
      letter-spacing: 0.14em;
    }

    .rgvx-zelle-memo-panel small,
    .rgvx-zelle-payment-line small {
      font-size: 11.5px;
    }

    .rgvx-zelle-guide-footer {
      gap: 14px;
    }
  }


  .rgvx-page {
    padding-top: clamp(190px, 16vh, 230px) !important;
  }

  .rgvx-topbar {
    margin-bottom: 46px !important;
  }

  @media (min-width: 981px) {
    .rgvx-order-summary {
      top: 158px !important;
      max-height: calc(100dvh - 178px) !important;
    }
  }

  @media (max-width: 980px) {
    .rgvx-page {
      padding-top: 152px !important;
    }

    .rgvx-order-summary {
      position: static !important;
      max-height: none !important;
      overflow: visible !important;
    }
  }

  @media (max-width: 760px) {
    .rgvx-page {
      padding-top: 142px !important;
    }
  }

  @media (max-width: 420px) {
    .rgvx-page {
      padding-top: 136px !important;
    }
  }


  .rgvx-page {
    background:
      radial-gradient(circle at 8% -10%, rgba(220, 38, 38, 0.18), transparent 34%),
      radial-gradient(circle at 100% 8%, rgba(127, 29, 29, 0.18), transparent 30%),
      linear-gradient(135deg, #020202 0%, #070202 48%, #030303 100%) !important;
  }

  .rgvx-clean-header > div > span {
    max-width: 560px;
  }

  .rgvx-payment-option strong {
    letter-spacing: -0.025em;
  }

  @media (max-width: 980px) {
    .rgvx-page {
      padding: 134px 16px 54px !important;
    }

    .rgvx-shell {
      width: min(560px, 100%) !important;
    }

    .rgvx-topbar {
      display: flex !important;
      flex-direction: row !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 12px !important;
      margin-bottom: 28px !important;
    }

    .rgvx-ghost-link,
    .rgvx-lock-pill {
      width: auto !important;
      min-height: 34px !important;
      border-color: rgba(255, 255, 255, 0.08) !important;
      border-radius: 999px !important;
      background: rgba(0, 0, 0, 0.18) !important;
      padding: 0 11px !important;
      font-size: 8.5px !important;
      letter-spacing: 0.09em !important;
      white-space: nowrap !important;
      backdrop-filter: blur(10px) !important;
    }

    .rgvx-lock-pill {
      margin-left: auto !important;
    }

    .rgvx-clean-header {
      display: block !important;
      margin-bottom: 28px !important;
    }

    .rgvx-clean-header p {
      font-size: 8.5px !important;
      letter-spacing: 0.18em !important;
    }

    .rgvx-clean-header h1 {
      margin-top: 7px !important;
      font-size: clamp(36px, 12vw, 48px) !important;
      letter-spacing: -0.058em !important;
      line-height: 0.96 !important;
    }

    .rgvx-clean-header > div > span {
      max-width: 100% !important;
      margin-top: 10px !important;
      color: rgba(255, 255, 255, 0.58) !important;
      font-size: 13px !important;
      line-height: 1.55 !important;
    }

    .rgvx-header-note {
      display: none !important;
    }

    .rgvx-clean-layout {
      display: grid !important;
      grid-template-columns: 1fr !important;
      gap: 34px !important;
    }

    .rgvx-order-summary {
      order: 1 !important;
      position: static !important;
      width: 100% !important;
      max-height: none !important;
      overflow: visible !important;
      border: 1px solid rgba(255, 255, 255, 0.095) !important;
      border-radius: 28px !important;
      background:
        radial-gradient(circle at 0% 0%, rgba(220, 38, 38, 0.13), transparent 42%),
        rgba(7, 7, 7, 0.76) !important;
      padding: 18px !important;
      box-shadow: 0 18px 58px rgba(0, 0, 0, 0.28) !important;
      backdrop-filter: blur(16px) !important;
    }

    .rgvx-flow {
      order: 2 !important;
      display: grid !important;
      gap: 24px !important;
    }

    .rgvx-summary-head {
      align-items: center !important;
      padding-bottom: 18px !important;
    }

    .rgvx-summary-head h2 {
      margin-top: 6px !important;
      font-size: clamp(38px, 13vw, 48px) !important;
      line-height: 0.9 !important;
    }

    .rgvx-summary-head svg {
      width: 38px !important;
      height: 38px !important;
      border: 1px solid rgba(220, 38, 38, 0.28) !important;
      border-radius: 15px !important;
      padding: 9px !important;
      color: rgb(248, 113, 113) !important;
      background: rgba(220, 38, 38, 0.08) !important;
    }

    .rgvx-items-list {
      max-height: none !important;
      gap: 14px !important;
      overflow: visible !important;
      padding: 18px 0 !important;
    }

    .rgvx-summary-item {
      grid-template-columns: 50px minmax(0, 1fr) auto !important;
      gap: 12px !important;
      min-height: 58px !important;
    }

    .rgvx-item-image {
      width: 50px !important;
      height: 50px !important;
      border-radius: 16px !important;
    }

    .rgvx-summary-item strong {
      font-size: 12.5px !important;
      line-height: 1.22 !important;
    }

    .rgvx-summary-item em {
      font-size: 12px !important;
    }

    .rgvx-free-progress {
      gap: 11px !important;
      padding: 18px 0 !important;
    }

    .progress-track {
      height: 7px !important;
    }

    .rgvx-totals {
      position: static !important;
      gap: 13px !important;
      margin: 0 !important;
      border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
      border-radius: 0 !important;
      background: transparent !important;
      padding: 18px 0 0 !important;
      backdrop-filter: none !important;
    }

    .rgvx-totals .total strong {
      font-size: 26px !important;
    }

    .rgvx-shipping-options {
      padding: 16px 0 !important;
    }

    .rgvx-shipping-options.flow {
      padding: 14px !important;
      border-radius: 22px !important;
    }

    .rgvx-shipping-option-list {
      grid-template-columns: 1fr !important;
    }

    .rgvx-shipping-option {
      border-radius: 16px !important;
      min-height: 74px !important;
      padding: 12px !important;
    }

    .rgvx-mini-coupon {
      gap: 12px !important;
      margin-top: 16px !important;
      border-radius: 20px !important;
      padding: 14px !important;
    }

    .rgvx-mini-coupon-controls {
      grid-template-columns: 1fr !important;
      gap: 10px !important;
    }

    .rgvx-mini-coupon-action,
    .rgvx-mini-coupon-code-wrap {
      min-height: 48px !important;
    }

    .rgvx-flow-section,
    .rgvx-zelle-area,
    .rgvx-policy {
      border-top: 0 !important;
      margin-top: 0 !important;
      padding-top: 0 !important;
    }

    .rgvx-flow-section.first {
      border: 1px solid rgba(255, 255, 255, 0.09) !important;
      border-radius: 28px !important;
      background:
        radial-gradient(circle at 0% 0%, rgba(220, 38, 38, 0.10), transparent 44%),
        rgba(7, 7, 7, 0.68) !important;
      padding: 18px !important;
    }

    .rgvx-section-heading {
      margin-bottom: 17px !important;
    }

    .rgvx-section-heading p {
      font-size: 8.5px !important;
      letter-spacing: 0.18em !important;
    }

    .rgvx-section-heading h2 {
      margin-top: 5px !important;
      font-size: 28px !important;
      letter-spacing: -0.045em !important;
    }

    .rgvx-section-heading span {
      margin-top: 8px !important;
      font-size: 12.5px !important;
      line-height: 1.55 !important;
      color: rgba(255, 255, 255, 0.55) !important;
    }

    .rgvx-payment-switch {
      grid-template-columns: 1fr 1fr !important;
      gap: 12px !important;
    }

    .rgvx-payment-option {
      display: flex !important;
      min-height: 92px !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 8px !important;
      border-radius: 21px !important;
      padding: 14px 10px !important;
      text-align: center !important;
      transform: none !important;
    }

    .rgvx-payment-option > svg {
      display: none !important;
    }

    .rgvx-payment-option span {
      display: grid !important;
      gap: 4px !important;
    }

    .rgvx-payment-option strong {
      font-size: 15px !important;
      letter-spacing: -0.02em !important;
    }

    .rgvx-payment-option small {
      max-width: 150px !important;
      margin: 0 !important;
      font-size: 10.5px !important;
      line-height: 1.35 !important;
    }

    .rgvx-payment-option em {
      margin: 0 !important;
      padding: 5px 8px !important;
      font-size: 8px !important;
      letter-spacing: 0.09em !important;
    }

    .rgvx-zelle-area {
      display: grid !important;
      gap: 22px !important;
    }

    .rgvx-zelle-banner,
    .rgvx-shipping-line {
      align-items: flex-start !important;
      border-radius: 22px !important;
      padding: 15px !important;
    }

    .rgvx-form-section {
      gap: 14px !important;
    }

    .rgvx-block-title strong {
      font-size: 16px !important;
    }

    .rgvx-block-title small {
      font-size: 12px !important;
      line-height: 1.45 !important;
    }

    .rgvx-form-grid,
    .rgvx-form-grid.two,
    .rgvx-form-grid.three {
      grid-template-columns: 1fr !important;
      gap: 13px !important;
    }

    .rgvx-field > span {
      font-size: 9.5px !important;
      letter-spacing: 0.13em !important;
    }

    input,
    select {
      min-height: 52px !important;
      border-radius: 17px !important;
      font-size: 14px !important;
    }

    .rgvx-marketing-inline {
      font-size: 11.5px !important;
    }

    .rgvx-policy {
      display: flex !important;
      gap: 10px !important;
      border: 1px solid rgba(255, 255, 255, 0.09) !important;
      border-radius: 18px !important;
      background: rgba(255, 255, 255, 0.035) !important;
      padding: 14px !important;
      font-size: 11px !important;
      line-height: 1.45 !important;
    }

    .rgvx-final-button {
      min-height: 66px !important;
      margin-top: -2px !important;
      border-radius: 21px !important;
      padding: 0 17px !important;
      box-shadow: 0 20px 48px rgba(220, 38, 38, 0.22) !important;
    }

    .rgvx-final-button strong {
      font-size: 12px !important;
      letter-spacing: 0.07em !important;
    }

    .rgvx-final-button small {
      font-size: 10.5px !important;
      line-height: 1.35 !important;
    }

    .rgvx-floating-total-bar {
      display: none !important;
    }
  }

  @media (max-width: 430px) {
    .rgvx-page {
      padding-left: 14px !important;
      padding-right: 14px !important;
    }

    .rgvx-clean-header h1 {
      font-size: 38px !important;
    }

    .rgvx-summary-head h2 {
      font-size: 40px !important;
    }

    .rgvx-payment-option {
      min-height: 84px !important;
    }

    .rgvx-payment-option small {
      display: none !important;
    }

    .rgvx-mini-code-input {
      grid-template-columns: 1fr !important;
    }

    .rgvx-mini-code-input button {
      width: 100% !important;
    }
  }

  /* Mobile policy checkbox fix */
  .rgvx-policy {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    overflow: hidden;
  }

  .rgvx-policy > span {
    display: block;
    flex: 1 1 auto;
    min-width: 0;
    max-width: 100%;
    white-space: normal;
    overflow-wrap: break-word;
    word-break: normal;
  }

  .rgvx-policy a {
    display: inline;
    white-space: normal;
    overflow-wrap: anywhere;
    text-decoration-thickness: 1px;
  }

  .rgvx-policy input[type="checkbox"] {
    -webkit-appearance: none !important;
    appearance: none !important;
    display: grid !important;
    place-items: center !important;
    flex: 0 0 22px !important;
    width: 22px !important;
    min-width: 22px !important;
    max-width: 22px !important;
    height: 22px !important;
    min-height: 22px !important;
    max-height: 22px !important;
    margin: 1px 0 0 !important;
    padding: 0 !important;
    border: 1px solid rgba(255, 255, 255, 0.26) !important;
    border-radius: 7px !important;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.015)),
      rgba(0, 0, 0, 0.42) !important;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      0 8px 20px rgba(0, 0, 0, 0.22) !important;
    cursor: pointer;
  }

  .rgvx-policy input[type="checkbox"]::after {
    content: "";
    width: 6px;
    height: 11px;
    border-right: 2px solid #ffffff;
    border-bottom: 2px solid #ffffff;
    transform: rotate(45deg) scale(0);
    transform-origin: center;
    transition: transform 160ms ease;
  }

  .rgvx-policy input[type="checkbox"]:checked {
    border-color: rgba(248, 113, 113, 0.92) !important;
    background:
      radial-gradient(circle at 30% 15%, rgba(255, 255, 255, 0.24), transparent 36%),
      linear-gradient(135deg, #ef4444, #991b1b) !important;
    box-shadow:
      0 0 0 4px rgba(220, 38, 38, 0.14),
      0 12px 30px rgba(220, 38, 38, 0.26) !important;
  }

  .rgvx-policy input[type="checkbox"]:checked::after {
    transform: rotate(45deg) scale(1);
  }

  @media (max-width: 760px) {
    .rgvx-policy {
      display: flex !important;
      align-items: flex-start !important;
      gap: 12px !important;
      width: 100% !important;
      border: 1px solid rgba(255, 255, 255, 0.105) !important;
      border-radius: 22px !important;
      background:
        radial-gradient(circle at 0% 0%, rgba(220, 38, 38, 0.12), transparent 42%),
        rgba(255, 255, 255, 0.04) !important;
      padding: 14px !important;
      color: rgba(255, 255, 255, 0.72) !important;
      font-size: 11.5px !important;
      line-height: 1.55 !important;
      letter-spacing: -0.01em !important;
      box-shadow: 0 16px 42px rgba(0, 0, 0, 0.22) !important;
      backdrop-filter: blur(14px) !important;
    }

    .rgvx-policy > span {
      padding-top: 1px;
    }

    .rgvx-policy a {
      color: #ffffff !important;
      font-weight: 950 !important;
      text-underline-offset: 3px !important;
    }

    .rgvx-policy.warning {
      border-color: rgba(248, 113, 113, 0.45) !important;
      background:
        radial-gradient(circle at 0% 0%, rgba(220, 38, 38, 0.18), transparent 44%),
        rgba(127, 29, 29, 0.16) !important;
    }
  }

  @media (max-width: 380px) {
    .rgvx-policy {
      gap: 10px !important;
      padding: 13px !important;
      border-radius: 20px !important;
      font-size: 10.8px !important;
      line-height: 1.5 !important;
    }

    .rgvx-policy input[type="checkbox"] {
      flex-basis: 20px !important;
      width: 20px !important;
      min-width: 20px !important;
      max-width: 20px !important;
      height: 20px !important;
      min-height: 20px !important;
      max-height: 20px !important;
      border-radius: 6px !important;
    }
  }



  @media (max-width: 420px) {
    .rgvx-mini-code-input {
      grid-template-columns: 1fr !important;
    }

    .rgvx-mini-code-input button {
      width: 100% !important;
      min-width: 0 !important;
    }
  }
  /* Mobile checkout order:
     1. Order summary
     2. Shipping
     3. Payment
     4. Age / policy confirmation
     5. Continue button
  */
  @media (max-width: 980px) {
    .rgvx-clean-layout {
      display: grid !important;
      grid-template-columns: 1fr !important;
    }

    .rgvx-order-summary {
      order: 1 !important;
    }

    .rgvx-flow {
      order: 2 !important;
      display: grid !important;
    }

    .rgvx-shipping-section {
      order: 1 !important;
    }

    .rgvx-flow-section.first {
      order: 2 !important;
    }

    .rgvx-zelle-area {
      order: 3 !important;
    }

    .rgvx-error,
    .rgvx-success {
      order: 4 !important;
    }

    .rgvx-policy {
      order: 5 !important;
    }

    .rgvx-final-button {
      order: 6 !important;
    }
  }

`;