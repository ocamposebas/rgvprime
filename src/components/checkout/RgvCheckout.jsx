  import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  ChevronDown,
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
import {
  getOmnisendCartFingerprint,
  identifyOmnisendContact,
  trackOmnisendCart,
  trackOmnisendStartedCheckout,
} from "../../lib/omnisendCart";
import {
  calculateLoyaltyPoints,
  formatPoints,
} from "../../lib/loyaltyProgram";
import { getMeOnce } from "../../lib/accountSession";
import OrbitCardPayment from "./OrbitCardPayment";

const WOO_URL =
  import.meta.env.PUBLIC_WOOCOMMERCE_URL ||
  import.meta.env.PUBLIC_WP_SITE_URL ||
  import.meta.env.PUBLIC_WP_URL ||
  "https://wp.rgvprimellc.com";

const WP_URL =
  import.meta.env.PUBLIC_WP_SITE_URL ||
  import.meta.env.PUBLIC_WOOCOMMERCE_URL ||
  import.meta.env.PUBLIC_WP_URL ||
  WOO_URL;

const ZELLE_PAYMENT_RECIPIENT = "sales@rgvprimellc.com";

const ZELLE_PAYMENT_NAME = "RGVPRIME LLC";

const FREE_SHIPPING_MINIMUM = 200;
const FREE_SHIPPING_DISPLAY_MINIMUM = 200;
const FREE_SHIPPING_LABEL = "Free Shipping";
const FREE_SHIPPING_METHOD_LABEL = "Free Shipping (Order's Over $200)";

const SHIPPING_METHODS = [
  {
    id: "ups_2_day_air",
    title: "UPS Shipping",
    label: "UPS Shipping",
    description: "Estimated 3-5 Business days after processing",
    price: 15,
    carrier: "UPS",
  },
  {
    id: "usps_ground_advantage",
    title: "USPS Ground",
    label: "USPS Ground",
    description: "Estimated 3-8 Business days after processing",
    price: 8,
    carrier: "USPS",
  },
  {
    id: "usps_priority",
    title: "USPS Priority Mail",
    label: "USPS Priority Mail",
    description: "Estimated 3-8 Business days after processing",
    price: 12,
    carrier: "USPS",
  },
];

function getShippingOrderLabel(shippingMethod, freeShipping = false) {
  if (freeShipping) return FREE_SHIPPING_LABEL;

  return shippingMethod?.label || shippingMethod?.title || "USPS Ground";
}

function CarrierLogo({ carrier }) {
  if (carrier === "UPS") {
    return (
      <span className="rgvx-carrier-logo ups" aria-label="UPS">
        <svg viewBox="0 0 32 38" aria-hidden="true">
          <path d="M4 2h24v17c0 9-5 14-12 17C9 33 4 28 4 19V2Z" />
          <text x="16" y="23" textAnchor="middle">UPS</text>
        </svg>
      </span>
    );
  }

  return (
    <span className="rgvx-carrier-logo usps" aria-label="USPS">
      <img
        src="/WhatsApp%20Image%202026-07-28%20at%204.24.24%20PM.jpeg"
        alt=""
      />
    </span>
  );
}

const ADDRESS_CONFIRMATION_FIELDS = new Set([
  "firstName",
  "lastName",
  "address1",
  "address2",
  "city",
  "state",
  "postcode",
  "country",
  "phone",
]);

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
    label: "Card & Wallets",
    eyebrow: "Fast route",
    title: "Card & Wallets",
    description: "Apple Pay · Google Pay · Cards",
    badge: "Secure",
    icon: CreditCard,
  },
  {
    id: "zelle",
    label: "Zelle",
    eyebrow: "Manual route",
    title: "Zelle",
    description: "Manual payment",
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
  terms: "/policies#terms",
  refund: "/policies#refunds",
  researchUse: "/policies#research-use",
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

function getManualOrderEndpoint() {
  return `${cleanUrl(WP_URL)}/wp-json/rgv/v1/manual-zelle-order`;
}

function getPaymentProofEndpoint() {
  return `${cleanUrl(WP_URL)}/wp-json/rgv/v1/payment-proof`;
}

function getCouponValidateEndpoint() {
  return `${cleanUrl(WP_URL)}/wp-json/rgv/v1/validate-coupon`;
}

function getEdebitOrderEndpoint() {
  return `${cleanUrl(WP_URL)}/wp-json/rgvprime/v1/create-edebit-order`;
}

function getOrbitCardCheckoutEndpoint() {
  return `${cleanUrl(WP_URL)}/wp-json/orbit/v1/card-checkout`;
}

function getOrbitCardQuoteEndpoint() {
  return `${cleanUrl(WP_URL)}/wp-json/orbit/v1/card-quote`;
}

function createCheckoutAttemptId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

const ORBIT_CARD_RETURN_STORAGE_KEY = "rgv_orbit_card_return";

function getInitialOrbitCardReturn() {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const clientSecret = String(params.get("payment_intent_client_secret") || "");

  if (params.get("orbit_card_return") !== "1" || !/^pi_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+$/.test(clientSecret)) {
    return null;
  }

  const stored = safeJsonParse(sessionStorage.getItem(ORBIT_CARD_RETURN_STORAGE_KEY), null);

  if (
    !stored ||
    !/^pk_(?:test|live)_[A-Za-z0-9]+$/.test(String(stored.publishableKey || "")) ||
    !/^acct_[A-Za-z0-9]+$/.test(String(stored.connectedAccountId || ""))
  ) {
    return null;
  }

  return {
    ...stored,
    clientSecret,
    isReturn: true,
  };
}

const EDEBIT_RETURN_QUERY_KEYS = [
  "rgvprime_bank_thanks",
  "phaseone_bank_thanks",
  "payment",
  "order_id",
  "order_key",
  "status",
  "payment_method",
  "source",
  "message",
];

function getInitialEdebitReturn() {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const isEdebitReturn =
    params.get("rgvprime_bank_thanks") === "1" ||
    params.get("phaseone_bank_thanks") === "1";

  if (!isEdebitReturn) return null;

  const rawPayment = String(params.get("payment") || "failed").toLowerCase();
  const payment = ["success", "failed", "cancelled"].includes(rawPayment)
    ? rawPayment
    : ["cancel", "canceled"].includes(rawPayment)
      ? "cancelled"
      : "failed";

  return {
    payment,
    orderId: String(params.get("order_id") || "").replace(/[^0-9]/g, "").slice(0, 20),
    status: String(params.get("status") || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40),
    paymentMethod: String(params.get("payment_method") || "edebit_yodlee").slice(0, 80),
    message: String(params.get("message") || "").slice(0, 300),
  };
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
  const [edebitReturn] = useState(() => getInitialEdebitReturn());
  const [orbitCardCheckout, setOrbitCardCheckout] = useState(() => getInitialOrbitCardReturn());
  const [checkoutQuote, setCheckoutQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [orbitCardReady, setOrbitCardReady] = useState(false);
  const [orbitPaymentResult, setOrbitPaymentResult] = useState(null);
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
  const [shippingAddressConfirmed, setShippingAddressConfirmed] = useState(false);
  const [policyAcknowledged, setPolicyAcknowledged] = useState(false);
  const [finalSaleAcknowledged, setFinalSaleAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [paymentNotice, setPaymentNotice] = useState("");
  const [manualOrder, setManualOrder] = useState(null);
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [receiptMessage, setReceiptMessage] = useState("");
  const [receiptSubmitted, setReceiptSubmitted] = useState(false);
  const [memoCopied, setMemoCopied] = useState(false);
  const [mobileSummaryOpen, setMobileSummaryOpen] = useState(false);
  const [sessionCustomer, setSessionCustomer] = useState(null);
  const omnisendFingerprintRef = useRef("");
  const sessionCustomerPromiseRef = useRef(null);
  const edebitSubmittingRef = useRef(false);
  const orbitCardSubmittingRef = useRef(false);
  const orbitCardPaymentRef = useRef(null);
  const checkoutAttemptIdRef = useRef(createCheckoutAttemptId());

  async function loadSessionCustomer() {
    if (!sessionCustomerPromiseRef.current) {
      sessionCustomerPromiseRef.current = getMeOnce()
        .then((result) => {
          const data = result?.data || {};
          return result?.ok && data?.success ? data.user || null : null;
        })
        .catch(() => null);
    }

    const user = await sessionCustomerPromiseRef.current;
    if (!user?.email) return null;

    setSessionCustomer(user);
    setCheckoutForm((current) => ({
      ...current,
      email: current.email || normalizeEmail(user.email),
      firstName: current.firstName || user.first_name || "",
      lastName: current.lastName || user.last_name || "",
      phone: current.phone || user.billing_phone || "",
      address1: current.address1 || user.billing_address_1 || "",
      address2: current.address2 || user.billing_address_2 || "",
      city: current.city || user.billing_city || "",
      state: current.state || user.billing_state || "",
      postcode: current.postcode || user.billing_postcode || "",
      country: current.country || user.billing_country || "US",
    }));

    return user;
  }

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

  useEffect(() => {
    loadSessionCustomer();
  }, []);

  useEffect(() => {
    if (!edebitReturn || typeof window === "undefined") return;

    const cleanReturnUrl = new URL(window.location.href);
    EDEBIT_RETURN_QUERY_KEYS.forEach((key) => cleanReturnUrl.searchParams.delete(key));
    window.history.replaceState(
      {},
      "",
      `${cleanReturnUrl.pathname}${cleanReturnUrl.search}${cleanReturnUrl.hash}`
    );

    localStorage.removeItem("rgv_edebit_pending_order");

    if (edebitReturn.payment !== "success") return;

    CART_STORAGE_FALLBACK_KEYS.forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem("rgv_checkout_coupon");

    const clearCartHandler = cart?.clearCart || cart?.emptyCart || cart?.resetCart;

    if (typeof clearCartHandler === "function") {
      try {
        clearCartHandler();
      } catch (clearError) {
        console.error("Unable to clear cart after eDebit payment:", clearError);
      }
    }
  }, [edebitReturn?.payment]);

  useEffect(() => {
    if (!orbitCardCheckout?.isReturn || typeof window === "undefined") return;

    const cleanReturnUrl = new URL(window.location.href);
    [
      "orbit_card_return",
      "payment_intent",
      "payment_intent_client_secret",
      "redirect_status",
    ].forEach((key) => cleanReturnUrl.searchParams.delete(key));
    window.history.replaceState(
      {},
      "",
      `${cleanReturnUrl.pathname}${cleanReturnUrl.search}${cleanReturnUrl.hash}`,
    );
  }, [orbitCardCheckout?.isReturn]);

  const cartItems = hasProviderCartItems ? providerCartItems : localCartItems;

  useEffect(() => {
    const email = normalizeEmail(checkoutForm.email);

    if (!isValidEmail(email) || !cartItems.length) return undefined;

    const fingerprint = getOmnisendCartFingerprint(cartItems, email);
    if (fingerprint === omnisendFingerprintRef.current) return undefined;

    const timeoutId = window.setTimeout(async () => {
      await identifyOmnisendContact({ email, phone: checkoutForm.phone });
      trackOmnisendCart(cartItems, cartItems.at(-1), { email });
      omnisendFingerprintRef.current = fingerprint;
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [cartItems, checkoutForm.email, checkoutForm.phone]);

  const calculatedItemsSubtotal = useMemo(
    () => Number(calculateCartTotal(cartItems).toFixed(2)),
    [cartItems]
  );

  // This is the merchandise subtotal before applying the checkout coupon.
  // Do not use cart.cartTotal because some providers expose the discounted
  // or grand total there, which can incorrectly remove free shipping.
  const cartTotal = useMemo(() => {
    const explicitSubtotalBeforeDiscount = toMoneyNumber(
      cart?.subtotalBeforeDiscount ??
        cart?.subtotal_before_discount ??
        cart?.subtotal,
      NaN
    );

    if (
      Number.isFinite(explicitSubtotalBeforeDiscount) &&
      explicitSubtotalBeforeDiscount > 0
    ) {
      return Number(explicitSubtotalBeforeDiscount.toFixed(2));
    }

    return calculatedItemsSubtotal;
  }, [
    cart?.subtotal,
    cart?.subtotalBeforeDiscount,
    cart?.subtotal_before_discount,
    calculatedItemsSubtotal,
  ]);

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

  const discountedCartTotal = Math.max(cartTotal - couponDiscount, 0);
  const estimatedLoyaltyPoints = calculateLoyaltyPoints(discountedCartTotal);
  const currentLoyaltyPoints = Math.max(
    0,
    Number(sessionCustomer?.loyalty?.points || 0)
  );
  const loyaltyGoal = Math.max(
    1,
    Number(sessionCustomer?.loyalty?.minimum_points || 1000)
  );
  const projectedLoyaltyPoints =
    currentLoyaltyPoints + estimatedLoyaltyPoints;
  const pointsMissingNow = Math.max(0, loyaltyGoal - currentLoyaltyPoints);
  const pointsMissingAfterOrder = Math.max(
    0,
    loyaltyGoal - projectedLoyaltyPoints
  );
  const currentLoyaltyProgress = Math.min(
    100,
    (currentLoyaltyPoints / loyaltyGoal) * 100
  );
  const projectedLoyaltyProgress = Math.min(
    100,
    (projectedLoyaltyPoints / loyaltyGoal) * 100
  );

  const selectedShippingMethod =
    SHIPPING_METHODS.find((method) => method.id === selectedShippingMethodId) ||
    SHIPPING_METHODS[0];

  const isEdebitSelected = selectedPaymentMethodId === "edebit";
  const isZelleSelected = selectedPaymentMethodId === "zelle";
  const isCardSelected = selectedPaymentMethodId === "card";
  const requiresDirectDetails = isCardSelected || isEdebitSelected || isZelleSelected;
  const hasItems = cartItems.length > 0;
  const freeShippingQualifiedBySubtotal =
    Math.max(cartTotal, 0) >= FREE_SHIPPING_MINIMUM;
  const isFreeShippingUnlocked = () =>
    freeShippingQualifiedBySubtotal ||
    (couponStatus === "valid" &&
      Boolean(couponValidation?.free_shipping));
  const freeShippingUnlocked = isFreeShippingUnlocked();
  const shippingLabelForDisplay = getShippingOrderLabel(
    selectedShippingMethod,
    freeShippingUnlocked
  );
  const amountUntilFreeShipping = Math.max(
    FREE_SHIPPING_DISPLAY_MINIMUM - cartTotal,
    0
  );
  const selectedShippingBaseCost = toMoneyNumber(selectedShippingMethod?.price, 0);
  const shippingCost = freeShippingUnlocked ? 0 : selectedShippingBaseCost;
  const estimatedDue = Math.max(discountedCartTotal + shippingCost, 0);

  useEffect(() => {
    if (!hasItems || !isCardSelected || orbitCardCheckout?.isReturn) return undefined;
    const items = buildCheckoutItems(cartItems);
    if (!items.length || items.some((item) => !item.product_id)) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setQuoteLoading(true);
        setQuoteError("");
        const address = normalizeCheckoutFormForOrder(checkoutForm);
        const response = await fetch(getOrbitCardQuoteEndpoint(), {
          method: "POST", credentials: "include", signal: controller.signal,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ items, billing: address, shipping: address, couponCode: coupon, shippingMethod: selectedShippingMethodId }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.success === false || !/^orb_quote_[a-f0-9]{32}$/.test(String(data?.quoteId || ""))) {
          throw new Error("We could not refresh the secure order total.");
        }
        setCheckoutQuote(data);
      } catch (cause) {
        if (cause?.name !== "AbortError") {
          setCheckoutQuote(null);
          setQuoteError("Secure checkout totals are temporarily unavailable. Please try again.");
        }
      } finally {
        if (!controller.signal.aborted) setQuoteLoading(false);
      }
    }, 450);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [cartItems, checkoutForm.country, checkoutForm.postcode, checkoutForm.state, coupon, hasItems, isCardSelected, orbitCardCheckout?.isReturn, selectedShippingMethodId]);

  const authoritativeDue = checkoutQuote ? checkoutQuote.totalMinor / 100 : estimatedDue;

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
  const checkoutAddressPreview = formatAddressBlock(
    normalizeCheckoutFormForOrder(checkoutForm)
  );
  const normalizedCardAddress = normalizeCheckoutFormForOrder(checkoutForm);
  const cardPaymentEnabled = Boolean(
    checkoutQuote && !quoteLoading && !loading && policyAcknowledged && finalSaleAcknowledged &&
    shippingAddressConfirmed && isValidEmail(normalizedCardAddress.email) &&
    normalizedCardAddress.first_name && normalizedCardAddress.last_name && normalizedCardAddress.address_1 &&
    normalizedCardAddress.city && normalizedCardAddress.state && normalizedCardAddress.postcode && normalizedCardAddress.phone
  );
  const stripePaymentContext = orbitCardCheckout?.isReturn ? orbitCardCheckout : checkoutQuote ? {
    publishableKey: checkoutQuote.publishableKey,
    connectedAccountId: checkoutQuote.connectedAccountId,
    totalMinor: checkoutQuote.totalMinor,
    currency: checkoutQuote.currency,
    customerEmail: normalizedCardAddress.email,
    customerName: `${normalizedCardAddress.first_name} ${normalizedCardAddress.last_name}`.trim(),
    customerPhone: normalizedCardAddress.phone,
    billingAddress: {
      line1: normalizedCardAddress.address_1,
      line2: normalizedCardAddress.address_2 || undefined,
      city: normalizedCardAddress.city,
      state: normalizedCardAddress.state,
      postal_code: normalizedCardAddress.postcode,
      country: normalizedCardAddress.country,
    },
    isReturn: false,
  } : null;
  const summarySubtotal = isCardSelected && checkoutQuote ? checkoutQuote.subtotalMinor / 100 : cartTotal;
  const summaryDiscount = isCardSelected && checkoutQuote ? checkoutQuote.discountMinor / 100 : couponDiscount;
  const summaryShipping = isCardSelected && checkoutQuote ? checkoutQuote.shippingMinor / 100 : shippingCost;
  const summaryTax = isCardSelected && checkoutQuote ? checkoutQuote.taxMinor / 100 : 0;
  const summaryTotal = isCardSelected ? authoritativeDue : estimatedDue;
  const displayedSummaryItems = isCardSelected && checkoutQuote?.items?.length === summaryItems.length
    ? summaryItems.map((item, index) => ({
        ...item,
        name: checkoutQuote.items[index].name || item.name,
        quantity: checkoutQuote.items[index].quantity || item.quantity,
        lineTotal: checkoutQuote.items[index].totalMinor / 100,
      }))
    : summaryItems;

  const progressWidth = freeShippingUnlocked
    ? 100
    : Math.min(
        100,
        Math.round((cartTotal / FREE_SHIPPING_DISPLAY_MINIMUM) * 100)
      );

  const paymentButtonTitle = loading
    ? isZelleSelected
      ? "Creating Zelle order"
      : isEdebitSelected
        ? "Connecting secure bank payment"
        : isCardSelected
          ? "Processing card payment"
          : "Preparing secure card payment"
    : isZelleSelected
      ? "Place order with Zelle"
      : isEdebitSelected
      ? "Continue with eDebit"
        : `Pay ${formatMoney(authoritativeDue)} securely`;

  const paymentButtonDescription = isZelleSelected
    ? "Payment instructions and receipt upload will appear next. Zelle processing can take up to 24 hours."
    : isEdebitSelected
      ? "Your order will be created, then you will securely link your bank."
      : isCardSelected
        ? "Your payment details are encrypted and protected throughout checkout."
        : "Your WooCommerce order total is verified before payment.";

  const validateCouponWithWoo = async (cleanCoupon, customerEmail = "") => {
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
        customer_email: normalizeEmail(customerEmail || checkoutForm.email),
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

      const sessionCustomer = checkoutForm.email
        ? null
        : await loadSessionCustomer();
      const customerEmail = normalizeEmail(
        checkoutForm.email || sessionCustomer?.email || ""
      );
      const data = await validateCouponWithWoo(cleanCoupon, customerEmail);
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
    if (ADDRESS_CONFIRMATION_FIELDS.has(field)) {
      setShippingAddressConfirmed(false);
    }
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

    if (!finalSaleAcknowledged) {
      setError("Please acknowledge and accept the All Sales Final Policy before continuing.");
      return false;
    }

    if (requiresDirectDetails && !shippingAddressConfirmed) {
      setError("Please review and confirm your shipping address before continuing.");
      return false;
    }

    return true;
  };

  const validateCheckoutInventory = async () => {
    if (typeof cart?.validateStock !== "function") {
      setError("Inventory could not be verified. Please refresh and try again.");
      return false;
    }

    setError("");
    setPaymentNotice("Checking current inventory...");

    const validation = await cart.validateStock(cartItems, { reconcile: true });

    if (!validation?.success) {
      setPaymentNotice("");
      setError(validation?.message || "Inventory could not be verified. Please try again.");
      return false;
    }

    if (!validation.valid) {
      const unavailableNames = validation.items
        ?.filter((item) => !item.available)
        .map((item) => item.name)
        .filter(Boolean)
        .join(", ");

      setPaymentNotice("");
      setError(
        unavailableNames
          ? `Sold-out products were removed from your cart: ${unavailableNames}. Review the cart before continuing.`
          : "Some quantities were adjusted to current stock. Review the cart before continuing.",
      );
      return false;
    }

    setPaymentNotice("");
    return true;
  };

  const validateDirectPaymentForm = (paymentLabel) => {
    const normalizedForm = normalizeCheckoutFormForOrder(checkoutForm);

    if (!isValidEmail(normalizedForm.email)) {
      setError(`Enter a valid email before continuing with ${paymentLabel}.`);
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
      setError(`${missingField[1]} is required before continuing with ${paymentLabel}.`);
      return null;
    }

    const phoneDigits = normalizedForm.phone.replace(/\D/g, "");

    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
      setError("Enter a valid phone number with 10 to 15 digits.");
      return null;
    }

    return normalizedForm;
  };

  const createOrbitCardPayment = async (confirmationTokenId) => {
    if (orbitCardSubmittingRef.current || loading) return;

    if (!validateBaseCheckout()) return;

    if (couponInput && couponInput !== coupon) {
      setError("Apply or clear the coupon code before continuing.");
      return;
    }

    if (!(await validateCheckoutInventory())) return;

    const normalizedForm = validateDirectPaymentForm("card payment");
    if (!normalizedForm) return;

    const checkoutItems = buildCheckoutItems(cartItems);

    if (!checkoutItems.length || checkoutItems.some((item) => !item.product_id)) {
      setError("One or more products are missing a valid WooCommerce product ID.");
      throw new Error("One or more products are no longer available.");
    }

    if (!checkoutQuote || checkoutQuote.quoteExpiresAt <= Math.floor(Date.now() / 1000)) {
      setError("The secure order total is still updating. Please wait a moment.");
      throw new Error("The secure order total is still updating. Please wait a moment.");
    }

    const billing = { ...normalizedForm };
    const shipping = { ...normalizedForm };
    const controller = new AbortController();
    const requestTimeout = window.setTimeout(() => controller.abort(), 45000);

    try {
      orbitCardSubmittingRef.current = true;
      setLoading(true);
      setError("");
      setPaymentNotice("Creating your pending WooCommerce order and securing the card payment...");

      localStorage.setItem("rgv_checkout_email", billing.email);
      localStorage.setItem("rgv_checkout_shipping", JSON.stringify(checkoutForm));

      const response = await fetch(getOrbitCardCheckoutEndpoint(), {
        method: "POST",
        credentials: "include",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          billing,
          shipping,
          items: checkoutItems,
          couponCode: coupon,
          shippingMethod: selectedShippingMethod?.id,
          source: "rgv_custom_checkout_orbit_card",
          ageConfirmed: true,
          researchUseAcknowledged: true,
          termsAccepted: true,
          refundPolicyAccepted: true,
          finalSalePolicyAccepted: true,
          researchUsePolicyAccepted: true,
          policyAcknowledgedAt: new Date().toISOString(),
          confirmationTokenId,
          checkoutAttemptId: checkoutAttemptIdRef.current,
          quoteId: checkoutQuote.quoteId,
          quoteExpiresAt: checkoutQuote.quoteExpiresAt,
        }),
      });

      const responseText = await response.text();
      const data = safeJsonParse(responseText, {});

      if (!response.ok || data?.success === false) {
        throw new Error(
          data?.message ||
            data?.error ||
            "Unable to prepare secure card payment. Please try again.",
        );
      }

      if (
        !/^orb_tx_[A-Za-z0-9_-]+$/.test(String(data?.orbitTransactionId || "")) ||
        !/^pi_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+$/.test(String(data?.clientSecret || "")) ||
        !/^acct_[A-Za-z0-9]+$/.test(String(data?.connectedAccountId || "")) ||
        !/^pk_(?:test|live)_[A-Za-z0-9]+$/.test(String(data?.publishableKey || ""))
      ) {
        throw new Error("Secure card payment returned an invalid configuration.");
      }

      const checkout = {
        orbitTransactionId: data.orbitTransactionId,
        clientSecret: data.clientSecret,
        connectedAccountId: data.connectedAccountId,
        publishableKey: data.publishableKey,
        orderId: data.orderId,
        orderNumber: data.orderNumber || data.orderId,
        currency: String(data.currency || "USD").toUpperCase(),
        total: data.total,
        customerEmail: billing.email,
        customerName: `${billing.first_name} ${billing.last_name}`.trim(),
        customerPhone: billing.phone,
        billingAddress: {
          line1: billing.address_1,
          line2: billing.address_2 || undefined,
          city: billing.city,
          state: billing.state,
          postal_code: billing.postcode,
          country: billing.country,
        },
        isReturn: false,
      };

      sessionStorage.setItem(
        ORBIT_CARD_RETURN_STORAGE_KEY,
        JSON.stringify({
          orbitTransactionId: checkout.orbitTransactionId,
          connectedAccountId: checkout.connectedAccountId,
          publishableKey: checkout.publishableKey,
          orderId: checkout.orderId,
          orderNumber: checkout.orderNumber,
          currency: checkout.currency,
          total: checkout.total,
          customerEmail: checkout.customerEmail,
          customerName: checkout.customerName,
          customerPhone: checkout.customerPhone,
          billingAddress: checkout.billingAddress,
        }),
      );

      setOrbitCardCheckout(checkout);
      setPaymentNotice("Payment received. Confirming your order…");
      return checkout;
    } catch (err) {
      const safeMessage = err?.name === "AbortError"
          ? "Card payment setup took too long. Your order was not submitted twice; please try again."
          : err?.message || "Unable to prepare secure card payment. Please try again.";
      setError(safeMessage);
      setPaymentNotice("");
      throw new Error(safeMessage);
    } finally {
      window.clearTimeout(requestTimeout);
      orbitCardSubmittingRef.current = false;
      setLoading(false);
    }
  };

  const continueToCardCheckout = async () => {
    if (!validateBaseCheckout()) return;
    if (!validateDirectPaymentForm("card payment")) return;
    if (!checkoutQuote || quoteLoading) {
      setError("The secure order total is still updating. Please wait a moment.");
      return;
    }
    setError("");
    const result = await orbitCardPaymentRef.current?.confirm();
    if (!result || result.ignored) return;
    handleOrbitPaymentResult(result);
  };

  const clearCartAfterOrbitPayment = () => {
    if (typeof window === "undefined") return;

    CART_STORAGE_FALLBACK_KEYS.forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem("rgv_checkout_coupon");
    sessionStorage.removeItem(ORBIT_CARD_RETURN_STORAGE_KEY);

    const clearCartHandler = cart?.clearCart || cart?.emptyCart || cart?.resetCart;

    if (typeof clearCartHandler === "function") {
      try {
        clearCartHandler();
      } catch (clearError) {
        console.error("Unable to clear cart after card payment:", clearError);
      }
    }
  };

  const handleOrbitPaymentResult = (result = {}) => {
    if (result.error) {
      setError(result.error);
      setPaymentNotice("");
      return;
    }

    const status = result.paymentIntent?.status;
    const paymentCheckout = result.checkout || orbitCardCheckout;

    if (status === "succeeded" || status === "processing") {
      setOrbitPaymentResult({
        status,
        orderNumber: paymentCheckout?.orderNumber,
        orbitTransactionId: paymentCheckout?.orbitTransactionId,
      });
      clearCartAfterOrbitPayment();
      return;
    }

    if (status === "requires_payment_method") {
      setError("Your card was not accepted. Choose another card and try again.");
      setPaymentNotice("");
      return;
    }

    if (status === "canceled") {
      setError("The card payment was canceled. No new payment will be submitted automatically.");
      setPaymentNotice("");
      return;
    }

    setPaymentNotice("Payment authentication is still pending. Follow the instructions in the secure card form.");
  };

  const createEdebitOrder = async () => {
    if (edebitSubmittingRef.current || loading) return;
    if (!validateBaseCheckout()) return;

    if (couponInput && couponInput !== coupon) {
      setError("Apply or clear the coupon code before continuing with bank transfer.");
      return;
    }

    if (!(await validateCheckoutInventory())) return;

    const normalizedForm = validateDirectPaymentForm("bank transfer");
    if (!normalizedForm) return;

    const checkoutItems = buildCheckoutItems(cartItems);

    if (!checkoutItems.length || checkoutItems.some((item) => !item.product_id)) {
      setError("One or more products are missing a valid WooCommerce product ID.");
      return;
    }

    const finalBilling = { ...normalizedForm };
    const finalShipping = { ...normalizedForm };
    const freeShippingForOrder = isFreeShippingUnlocked();
    const shippingCostForApi = Number(
      freeShippingForOrder ? 0 : selectedShippingBaseCost
    ).toFixed(2);
    const shippingLabelForOrder = getShippingOrderLabel(
      selectedShippingMethod,
      freeShippingForOrder
    );
    const controller = new AbortController();
    const requestTimeout = window.setTimeout(() => controller.abort(), 70000);
    let redirecting = false;

    try {
      edebitSubmittingRef.current = true;
      setLoading(true);
      setError("");
      setPaymentNotice("Creating your order and opening secure bank payment...");

      localStorage.setItem("rgv_checkout_email", finalBilling.email);
      localStorage.setItem("rgv_checkout_shipping", JSON.stringify(checkoutForm));

      const response = await fetch(getEdebitOrderEndpoint(), {
        method: "POST",
        credentials: "include",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          paymentMethod: "edd_draft_yodlee_gateway",
          gatewayId: "edd_draft_yodlee_gateway",
          customer: {
            firstName: finalBilling.first_name,
            lastName: finalBilling.last_name,
            email: finalBilling.email,
            phone: finalBilling.phone,
          },
          billing: finalBilling,
          shipping: finalShipping,
          items: checkoutItems,
          couponCode: coupon,
          shippingMethod: {
            id: selectedShippingMethod?.id,
            method_id: selectedShippingMethod?.id,
            title: shippingLabelForOrder,
            label: shippingLabelForOrder,
            method_title: shippingLabelForOrder,
            carrier: selectedShippingMethod?.carrier,
            price: shippingCostForApi,
            total: shippingCostForApi,
          },
          shipping_method: selectedShippingMethod?.id,
          shippingMethodId: selectedShippingMethod?.id,
          shipping_method_id: selectedShippingMethod?.id,
          shippingMethodTitle: shippingLabelForOrder,
          shipping_method_title: shippingLabelForOrder,
          shippingMethodLabel: shippingLabelForOrder,
          shipping_method_label: shippingLabelForOrder,
          shippingCarrier: selectedShippingMethod?.carrier,
          shipping_carrier: selectedShippingMethod?.carrier,
          shippingTotal: shippingCostForApi,
          freeShippingUnlocked: freeShippingForOrder,
          free_shipping_unlocked: freeShippingForOrder,
          couponValidation,
          coupon_validation: couponValidation,
          source: "rgvprime_custom_checkout_edebit",
          ageConfirmed: true,
          researchUseAcknowledged: true,
          termsAccepted: true,
          refundPolicyAccepted: true,
          finalSalePolicyAccepted: true,
          researchUsePolicyAccepted: true,
          policyAcknowledgedAt: new Date().toISOString(),
        }),
      });

      const responseText = await response.text();
      const data = safeJsonParse(responseText, {});

      if (!response.ok || data?.success === false) {
        throw new Error(
          data?.message ||
            data?.error ||
            "Unable to start bank transfer payment. Please try again."
        );
      }

      const redirectUrl =
        data?.gatewayRedirectUrl || data?.redirectUrl || data?.paymentUrl || "";

      if (!redirectUrl) {
        throw new Error("Bank transfer did not return a secure payment URL.");
      }

      let parsedRedirect;

      try {
        parsedRedirect = new URL(redirectUrl);
      } catch {
        throw new Error("Bank transfer returned an invalid payment URL.");
      }

      if (parsedRedirect.protocol !== "https:") {
        throw new Error("The bank transfer payment URL was not secure.");
      }

      localStorage.setItem(
        "rgv_edebit_pending_order",
        JSON.stringify({
          orderId: data?.orderId || "",
          orderNumber: data?.orderNumber || "",
          createdAt: new Date().toISOString(),
        })
      );

      redirecting = true;
      window.location.assign(parsedRedirect.toString());
    } catch (err) {
      const message =
        err?.name === "AbortError"
          ? "Bank transfer took too long to respond. No second order was submitted. Please try again."
          : err?.message || "Unable to start bank transfer payment. Please try again.";

      setError(message);
      setPaymentNotice("");
    } finally {
      window.clearTimeout(requestTimeout);

      if (!redirecting) {
        edebitSubmittingRef.current = false;
        setLoading(false);
      }
    }
  };

  const createZelleOrder = async () => {
    if (!validateBaseCheckout()) return;

    if (couponInput && couponInput !== coupon) {
      setError("Apply or clear the coupon code before creating your Zelle order.");
      return;
    }

    if (!(await validateCheckoutInventory())) return;

    const normalizedForm = validateDirectPaymentForm("Zelle");
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

      // Keep a free-shipping value explicit for PHP. The string "0.00"
      // prevents endpoints using empty() from treating a valid zero as missing.
      const freeShippingForOrder = isFreeShippingUnlocked();
      const shippingCostForApi = Number(
        freeShippingForOrder ? 0 : selectedShippingBaseCost
      ).toFixed(2);
      const shippingLabelForOrder = getShippingOrderLabel(
        selectedShippingMethod,
        freeShippingForOrder
      );

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
          subtotal: cartTotal,
          cartSubtotal: cartTotal,
          cart_subtotal: cartTotal,
          subtotalBeforeCoupon: cartTotal,
          subtotal_before_coupon: cartTotal,
          subtotalBeforeDiscount: cartTotal,
          subtotal_before_discount: cartTotal,
          discountedSubtotal: discountedCartTotal,
          discounted_subtotal: discountedCartTotal,
          shippingMethod: selectedShippingMethod?.id,
          shipping_method: selectedShippingMethod?.id,
          shippingMethodId: selectedShippingMethod?.id,
          shipping_method_id: selectedShippingMethod?.id,
          shippingMethodTitle: shippingLabelForOrder,
          shipping_method_title: shippingLabelForOrder,
          shippingMethodLabel: shippingLabelForOrder,
          shipping_method_label: shippingLabelForOrder,
          shippingMethodName: shippingLabelForOrder,
          shipping_method_name: shippingLabelForOrder,
          shippingTitle: shippingLabelForOrder,
          shipping_title: shippingLabelForOrder,
          shippingCarrier: selectedShippingMethod?.carrier,
          shipping_carrier: selectedShippingMethod?.carrier,
          shippingCost: shippingCostForApi,
          shipping_cost: shippingCostForApi,
          shippingBaseCost: selectedShippingBaseCost,
          shipping_base_cost: selectedShippingBaseCost,
          freeShippingUnlocked: freeShippingForOrder,
          free_shipping_unlocked: freeShippingForOrder,
          freeShippingQualifiedBySubtotal,
          free_shipping_qualified_by_subtotal: freeShippingQualifiedBySubtotal,
          freeShippingEvaluationBasis: "subtotal_before_coupon",
          free_shipping_evaluation_basis: "subtotal_before_coupon",
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
          finalSalePolicyAccepted: true,
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
        shipping_method: selectedShippingMethod?.id || order.shipping_method,
        shipping_method_title:
          shippingLabelForOrder || order.shipping_method_title,
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

    if (isEdebitSelected) {
      createEdebitOrder();
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

  if (edebitReturn) {
    const paymentSucceeded = edebitReturn.payment === "success";
    const paymentCancelled = edebitReturn.payment === "cancelled";
    const orderLabel = edebitReturn.orderId ? `ORDER #${edebitReturn.orderId}` : "EDEBIT PAYMENT";
    const returnTitle = paymentSucceeded
      ? "Bank payment completed"
      : paymentCancelled
        ? "Bank payment cancelled"
        : "Bank payment was not completed";
    const returnMessage = edebitReturn.message ||
      (paymentSucceeded
        ? "Your bank transfer payment was received and your order is now being processed."
        : paymentCancelled
          ? "Your order was not paid. Your cart is still available so you can try again or choose another payment method."
          : "The bank payment could not be completed. Your cart is still available and no new payment attempt will be made automatically.");

    return (
      <main className="rgvx-page rgvx-thanks-page">
        <div className="rgvx-background-wash" />

        <section className="rgvx-shell rgvx-thanks-shell">
          <div className="rgvx-topbar">
            <a href="/shop" className="rgvx-ghost-link">
              <ArrowLeft size={14} /> Back to shop
            </a>

            <div className={`rgvx-lock-pill ${paymentSucceeded ? "rgvx-confirmed-pill" : ""}`}>
              {paymentSucceeded ? <BadgeCheck size={13} /> : <X size={13} />}
              {paymentSucceeded ? "Payment confirmed" : paymentCancelled ? "Payment cancelled" : "Payment failed"}
            </div>
          </div>

          <section className="rgvx-receipt-thanks-card" aria-live="polite">
            <div className="rgvx-receipt-thanks-icon">
              {paymentSucceeded ? <BadgeCheck size={36} /> : <X size={36} />}
            </div>

            <p>{orderLabel}</p>
            <h1>{returnTitle}</h1>
            <span>{returnMessage}</span>

            <div className="rgvx-receipt-thanks-details">
              <div>
                <Building2 size={17} />
                <span>Payment method</span>
                <strong>Bank transfer</strong>
              </div>

              <div>
                <ShieldCheck size={17} />
                <span>Current status</span>
                <strong>{paymentSucceeded ? "Processing" : paymentCancelled ? "Cancelled" : "Payment required"}</strong>
              </div>
            </div>

            <a
              href={paymentSucceeded ? "/shop" : "/checkout/"}
              className="rgvx-receipt-thanks-button"
            >
              {paymentSucceeded ? "Continue shopping" : "Return to checkout"}
              <ChevronRight size={18} />
            </a>
          </section>
        </section>

        <style>{styles}</style>
      </main>
    );
  }

  if (orbitPaymentResult) {
    const paymentSucceeded = orbitPaymentResult.status === "succeeded";

    return (
      <main className="rgvx-page rgvx-thanks-page">
        <div className="rgvx-background-wash" />

        <section className="rgvx-shell rgvx-thanks-shell">
          <div className="rgvx-topbar">
            <a href="/shop" className="rgvx-ghost-link">
              <ArrowLeft size={14} /> Back to shop
            </a>

            <div className="rgvx-lock-pill rgvx-confirmed-pill">
              <BadgeCheck size={13} /> Payment submitted
            </div>
          </div>

          <section className="rgvx-receipt-thanks-card" aria-live="polite">
            <div className="rgvx-receipt-thanks-icon">
              <BadgeCheck size={36} />
            </div>

            <p>ORDER #{orbitPaymentResult.orderNumber || "PENDING"}</p>
            <h1>Payment processing</h1>
            <span>
              {paymentSucceeded
                ? "Your payment was accepted. ORBIT is securely finalizing your WooCommerce order through its verified webhook."
                : "Your payment is processing. ORBIT will update your WooCommerce order only after secure verification is complete."}
            </span>

            <div className="rgvx-receipt-thanks-details">
              <div>
                <CreditCard size={17} />
                <span>Payment method</span>
                <strong>Card &amp; Wallets</strong>
              </div>

              <div>
                <ShieldCheck size={17} />
                <span>Order update</span>
                <strong>Secure webhook verification</strong>
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

  if (!hasItems && !orbitCardCheckout) return <EmptyState />;

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
                <small>
                  {shippingLabelForDisplay || manualOrder?.shipping_method_title}
                </small>
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
        <header className="rgvx-checkout-masthead">
          <a href="/shop" className="rgvx-checkout-brand" aria-label="RGVPRIME — back to shop">
            <img src="/logo.webp" alt="RGVPRIME" width="176" height="48" />
            <span>Research, refined.</span>
          </a>

          <div className="rgvx-masthead-actions">
            {estimatedLoyaltyPoints > 0 && (
              <div className="rgvx-points-chip" aria-label={`You will earn ${formatPoints(estimatedLoyaltyPoints)} loyalty points with this order`}>
                <span aria-hidden="true">★</span>
                <div>
                  <small>You&apos;ll earn</small>
                  <strong>+{formatPoints(estimatedLoyaltyPoints)} points</strong>
                </div>
              </div>
            )}

            <div className="rgvx-checkout-secure-note">
              <Lock size={14} /> <span>Encrypted &amp; secure</span>
            </div>
          </div>
        </header>

        <header className="rgvx-clean-header">
          <div>
            <p>Private client checkout</p>
            <h1>Complete your order</h1>
            <span>
              A calm, secure checkout for your RGVPRIME order.
            </span>
          </div>
        </header>

        <div className="rgvx-clean-layout">
          <section className="rgvx-flow">
            {requiresDirectDetails && (
              <div className="rgvx-zelle-area">
                <div className="rgvx-form-section">
                  <div className="rgvx-block-title">
                    <Mail size={16} />
                    <div>
                      <strong>Contact</strong>
                      <small>
                        {isCardSelected
                          ? "For your order confirmation and secure payment receipt."
                          : isEdebitSelected
                            ? "For your confirmation and bank-payment updates."
                            : "For order updates and payment instructions."}
                      </small>
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
                      <strong>Shipping address</strong>
                      <small>
                        Where should we discreetly deliver your order?
                      </small>
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

                    <Field label="Country" wide>
                      <select
                        value={checkoutForm.country}
                        onChange={(event) => updateCheckoutField("country", event.target.value)}
                        autoComplete="country"
                      >
                        <option value="US">United States</option>
                      </select>
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

                  <div className={`rgvx-address-confirmation ${shippingAddressConfirmed ? "confirmed" : ""}`}>
                    <div className="rgvx-address-confirmation-heading">
                      <ShieldCheck size={17} />
                      <div>
                        <strong>Confirm shipping address</strong>
                        <small>Review these details carefully before creating your order.</small>
                      </div>
                    </div>

                    <div className="rgvx-address-preview">
                      <strong>
                        {checkoutAddressPreview.fullName || "Name not entered"}
                      </strong>
                      {checkoutAddressPreview.lines.map((line) => (
                        <span key={line}>{line}</span>
                      ))}
                      {checkoutAddressPreview.phone && (
                        <span>{checkoutAddressPreview.phone}</span>
                      )}
                    </div>

                    <label className="rgvx-address-confirmation-check">
                      <input
                        type="checkbox"
                        checked={shippingAddressConfirmed}
                        onChange={(event) => {
                          setShippingAddressConfirmed(event.target.checked);
                          if (event.target.checked) setError("");
                        }}
                      />
                      <span>I confirm this shipping address is complete and correct.</span>
                    </label>
                  </div>
                </div>

              </div>
            )}

            <div className="rgvx-form-section rgvx-shipping-section">
              <div className="rgvx-block-title">
                <Truck size={16} />
                <div>
                  <strong>Delivery</strong>
                  <small>
                    Choose the delivery speed that works best for you.
                  </small>
                </div>
              </div>

              <div
                className="rgvx-shipping-options flow"
                role="radiogroup"
                aria-label="Shipping method"
              >
                <div className="rgvx-shipping-options-head">
                  <span>Delivery options</span>
                  <strong>
                    {freeShippingUnlocked
                      ? FREE_SHIPPING_METHOD_LABEL
                      : `${FREE_SHIPPING_METHOD_LABEL} — Only ${formatMoney(amountUntilFreeShipping)} more`}
                  </strong>
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
                        <div className="rgvx-shipping-option-main">
                          <CarrierLogo carrier={method.carrier} />
                          <div>
                            <strong>{method.title}</strong>
                            <small>{method.description}</small>
                            {freeShippingUnlocked && (
                              <small className="rgvx-shipping-free-note">
                                {FREE_SHIPPING_LABEL}
                              </small>
                            )}
                          </div>
                        </div>

                        <em>{freeShippingUnlocked ? FREE_SHIPPING_LABEL : formatMoney(method.price)}</em>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <section className="rgvx-review-confirm" aria-labelledby="rgvx-review-title">
              <div className="rgvx-section-heading">
                <p>Before payment</p>
                <h2 id="rgvx-review-title">Review &amp; confirm</h2>
                <span>Accept the required terms to unlock your payment options.</span>
              </div>

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

              <label className={`rgvx-policy ${!finalSaleAcknowledged && error ? "warning" : ""}`}>
                <input
                  type="checkbox"
                  checked={finalSaleAcknowledged}
                  onChange={(event) => {
                    setFinalSaleAcknowledged(event.target.checked);
                    if (event.target.checked) setError("");
                  }}
                />

                <span>
                  I understand and acknowledge that, due to the nature of these products, all sales
                  are final. RGVPRIME LLC does not offer returns, exchanges, refunds, or
                  reimbursements of any kind. By proceeding with my purchase, I expressly accept the{" "}
                  <a href={POLICY_LINKS.refund}>All Sales Final Policy</a>.
                </span>
              </label>
            </section>

            <div className="rgvx-flow-section first rgvx-payment-section">
              <div className="rgvx-section-heading">
                <p>Secure payment</p>
                <h2>Payment</h2>
                <span>All transactions are encrypted and securely processed.</span>
              </div>
              <div className="rgvx-payment-switch" role="radiogroup" aria-label="Payment method">
                {PAYMENT_METHODS.map((method) => {
                  const Icon = method.icon;
                  const active = selectedPaymentMethodId === method.id;
                  return <button key={method.id} type="button" role="radio" aria-checked={active} disabled={loading || Boolean(orbitCardCheckout)} className={`rgvx-payment-option ${active ? "active" : ""}`} onClick={() => { setSelectedPaymentMethodId(method.id); setManualOrder(null); setError(""); setPaymentNotice(""); }}>
                    <Icon size={18} /><span><strong>{method.title}</strong><small>{method.description}</small></span><em>{method.badge}</em>
                  </button>;
                })}
              </div>
              {isZelleSelected && <p className="rgvx-payment-method-note"><Building2 size={16} /> Manual bank payment. Instructions appear after your order is placed.</p>}
            </div>

            {isCardSelected && stripePaymentContext && (
              <div className="rgvx-orbit-card-panel">
                <div className="rgvx-block-title">
                  <Lock size={16} />
                  <div>
                    <strong>Secure card details</strong>
                    <small>
                      Eligible wallets appear automatically. ORION SENTINEL protects this secure checkout experience.
                    </small>
                  </div>
                </div>

                <OrbitCardPayment
                  ref={orbitCardPaymentRef}
                  context={stripePaymentContext}
                  enabled={cardPaymentEnabled || Boolean(orbitCardCheckout?.isReturn)}
                  onCreatePayment={createOrbitCardPayment}
                  onReadyChange={setOrbitCardReady}
                  onPaymentResult={handleOrbitPaymentResult}
                  onBlocked={() => {
                    setError("Complete your contact and shipping details, confirm the shipping address, and accept both required agreements before choosing a fast payment option.");
                    const target = !shippingAddressConfirmed
                      ? document.querySelector(".rgvx-address-confirmation")
                      : document.querySelector(".rgvx-review-confirm");
                    target?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                />
              </div>
            )}

            {isCardSelected && quoteLoading && <p className="rgvx-checkout-state">Updating secure total and payment methods…</p>}
            {isCardSelected && quoteError && <p className="rgvx-error">{quoteError}</p>}

            {error && <p className="rgvx-error">{error}</p>}
            {paymentNotice && !error && <p className="rgvx-success">{paymentNotice}</p>}

            <button
              type="button"
              onClick={handleContinuePayment}
              disabled={loading || (isCardSelected && (!stripePaymentContext || !orbitCardReady || quoteLoading))}
              className="rgvx-final-button"
            >
              <span>
                <strong>{paymentButtonTitle}</strong>
                <small>{paymentButtonDescription}</small>
              </span>
              <ChevronRight size={20} />
            </button>

            <div className="rgvx-checkout-assurance" aria-label="Payment security">
              <Lock size={13} />
              <span>Encrypted payment</span>
              <i aria-hidden="true" />
              <span>{isCardSelected ? "Protected by ORION SENTINEL" : "Secure checkout"}</span>
            </div>
          </section>

          <aside className={`rgvx-order-summary ${mobileSummaryOpen ? "is-open" : ""}`}>
            <button
              type="button"
              className="rgvx-mobile-summary-toggle"
              onClick={() => setMobileSummaryOpen((open) => !open)}
              aria-expanded={mobileSummaryOpen}
              aria-controls="rgvx-summary-content"
            >
              <span>Order summary</span>
              <strong>{formatMoney(summaryTotal)}</strong>
              <ChevronDown size={17} aria-hidden="true" />
            </button>

            <div id="rgvx-summary-content" className="rgvx-summary-content">
            <div className="rgvx-summary-head">
              <div>
                <p>Your order</p>
                <h2>Order summary</h2>
              </div>
              <PackageCheck size={18} />
            </div>

            <div className="rgvx-items-list">
              {displayedSummaryItems.map((item) => (
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
                <span>Free shipping starts at {formatMoney(FREE_SHIPPING_DISPLAY_MINIMUM)}</span>
                <strong>
                  {freeShippingUnlocked
                    ? FREE_SHIPPING_LABEL
                    : `${formatMoney(amountUntilFreeShipping)} away`}
                </strong>
              </div>
              <div className="progress-track">
                <span style={{ width: `${progressWidth}%` }} />
              </div>
            </div>

            <div className="rgvx-totals">
              <div className="rgvx-total-row">
                <span>Subtotal</span>
                <strong>{formatMoney(summarySubtotal)}</strong>
              </div>

              {summaryDiscount > 0 && (
                <div className="rgvx-total-row good">
                  <span>Coupon {coupon}</span>
                  <strong>-{formatMoney(summaryDiscount)}</strong>
                </div>
              )}

              <div className="rgvx-total-row">
                <span>{shippingLabelForDisplay}</span>
                <strong className={freeShippingUnlocked ? "free" : ""}>
                  {summaryShipping <= 0 ? FREE_SHIPPING_LABEL : formatMoney(summaryShipping)}
                </strong>
              </div>

              {summaryTax > 0 && <div className="rgvx-total-row"><span>Tax</span><strong>{formatMoney(summaryTax)}</strong></div>}

              <div className="rgvx-total-row total">
                <span>{isZelleSelected ? "Due now" : "Total USD"}</span>
                <strong>{formatMoney(summaryTotal)}</strong>
              </div>

              {estimatedLoyaltyPoints > 0 && (
                sessionCustomer ? (
                  <div className="rgvx-loyalty-progress-card" aria-live="polite">
                    <div className="rgvx-loyalty-progress-head">
                      <span className="rgvx-loyalty-star" aria-hidden="true">★</span>
                      <div>
                        <span>Your reward progress</span>
                        <strong>
                          {formatPoints(currentLoyaltyPoints)} current points
                        </strong>
                      </div>
                      <b>+{formatPoints(estimatedLoyaltyPoints)}</b>
                    </div>

                    <div className="rgvx-loyalty-progress-track">
                      <span
                        className="current"
                        style={{ width: `${currentLoyaltyProgress}%` }}
                      />
                      <span
                        className="projected"
                        style={{
                          left: `${currentLoyaltyProgress}%`,
                          width: `${Math.max(0, projectedLoyaltyProgress - currentLoyaltyProgress)}%`,
                        }}
                      />
                    </div>

                    <div className="rgvx-loyalty-progress-copy">
                      {pointsMissingNow === 0 ? (
                        <strong>Your {formatPoints(loyaltyGoal)}-point reward is already unlocked.</strong>
                      ) : pointsMissingAfterOrder === 0 ? (
                        <strong>
                          This order unlocks your {formatPoints(loyaltyGoal)}-point reward.
                        </strong>
                      ) : (
                        <>
                          <span>
                            You need {formatPoints(pointsMissingNow)} more points today.
                          </span>
                          <strong>
                            After this order, only {formatPoints(pointsMissingAfterOrder)} remain.
                          </strong>
                        </>
                      )}
                      <small>Order points are added after completion.</small>
                    </div>
                  </div>
                ) : (
                  <div className="rgvx-loyalty-earned" aria-live="polite">
                    <span className="rgvx-loyalty-star" aria-hidden="true">★</span>
                    <div>
                      <span>You’ll earn</span>
                      <strong>{formatPoints(estimatedLoyaltyPoints)} Loyalty Points</strong>
                      <small>Sign in to track progress toward your reward.</small>
                    </div>
                  </div>
                )
              )}

              <details className={`rgvx-mini-coupon ${couponStatus !== "idle" ? `is-${couponStatus}` : ""}`}>
                <summary className="rgvx-mini-coupon-header">
                  <div className="rgvx-mini-coupon-title">
                    <Tag size={12} />
                    <span>Have a promo code?</span>
                  </div>

                  {couponStatus === "valid" && <div className="rgvx-mini-coupon-pill">Applied</div>}
                  <ChevronDown className="rgvx-mini-coupon-chevron" size={14} aria-hidden="true" />
                </summary>

                <div className="rgvx-mini-coupon-body">
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
              </details>
            </div>

            <div className="rgvx-summary-trust" aria-label="Checkout benefits">
              <span><ShieldCheck size={15} /> Secure checkout</span>
              <span><PackageCheck size={15} /> Discreet packaging</span>
              <span><Lock size={15} /> Encrypted payments</span>
            </div>
            </div>
          </aside>
        </div>
      </section>

      <style>{styles}</style>
    </main>
  );
}

const styles = `
  * {
    box-sizing: border-box;
  }

  .rgvx-loyalty-earned {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 14px;
    padding: 14px;
    border: 1px solid rgba(252, 211, 77, 0.22);
    border-radius: 16px;
    background: linear-gradient(135deg, rgba(252, 211, 77, 0.1), rgba(220, 38, 38, 0.06));
    color: #fff;
  }

  .rgvx-loyalty-star {
    display: grid;
    width: 36px;
    height: 36px;
    flex: 0 0 36px;
    place-items: center;
    border-radius: 50%;
    background: rgba(252, 211, 77, 0.14);
    color: #fcd34d;
    font-size: 16px;
  }

  .rgvx-loyalty-earned div {
    display: grid;
    gap: 2px;
  }

  .rgvx-loyalty-earned div > span,
  .rgvx-loyalty-earned small {
    color: rgba(255, 255, 255, 0.48);
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .rgvx-loyalty-earned strong {
    color: #fde68a;
    font-size: 14px;
    font-weight: 900;
  }

  .rgvx-loyalty-progress-card {
    display: grid;
    gap: 12px;
    margin-top: 14px;
    padding: 14px;
    border: 1px solid rgba(252, 211, 77, 0.24);
    border-radius: 18px;
    background:
      radial-gradient(circle at 0% 0%, rgba(252, 211, 77, 0.12), transparent 46%),
      linear-gradient(135deg, rgba(28, 22, 10, 0.92), rgba(14, 8, 8, 0.94));
  }

  .rgvx-loyalty-progress-head {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
  }

  .rgvx-loyalty-progress-head div {
    display: grid;
    gap: 2px;
  }

  .rgvx-loyalty-progress-head div > span {
    color: rgba(255, 255, 255, 0.48);
    font-size: 8px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .rgvx-loyalty-progress-head strong {
    color: #ffffff;
    font-size: 13px;
    font-weight: 950;
  }

  .rgvx-loyalty-progress-head b {
    border: 1px solid rgba(252, 211, 77, 0.2);
    border-radius: 999px;
    background: rgba(252, 211, 77, 0.1);
    padding: 7px 9px;
    color: #fde68a;
    font-size: 11px;
    font-weight: 950;
    white-space: nowrap;
  }

  .rgvx-loyalty-progress-track {
    position: relative;
    height: 9px;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
  }

  .rgvx-loyalty-progress-track span {
    position: absolute;
    inset-block: 0;
    display: block;
    transition: width 300ms ease;
  }

  .rgvx-loyalty-progress-track .current {
    left: 0;
    border-radius: 999px 0 0 999px;
    background: linear-gradient(90deg, #b45309, #f59e0b);
  }

  .rgvx-loyalty-progress-track .projected {
    background: repeating-linear-gradient(
      135deg,
      #fde68a 0,
      #fde68a 5px,
      #d97706 5px,
      #d97706 10px
    );
  }

  .rgvx-loyalty-progress-copy {
    display: grid;
    gap: 3px;
  }

  .rgvx-loyalty-progress-copy > span {
    color: rgba(255, 255, 255, 0.58);
    font-size: 10px;
    font-weight: 750;
  }

  .rgvx-loyalty-progress-copy strong {
    color: #fde68a;
    font-size: 11px;
    font-weight: 950;
    line-height: 1.35;
  }

  .rgvx-loyalty-progress-copy small {
    color: rgba(255, 255, 255, 0.35);
    font-size: 8px;
    font-weight: 850;
    letter-spacing: 0.08em;
    text-transform: uppercase;
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
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .rgvx-payment-option {
    display: flex;
    min-height: 150px;
    flex-direction: column;
    justify-content: center;
    gap: 8px;
    align-items: center;
    width: 100%;
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 22px;
    background: rgba(255, 255, 255, 0.035);
    padding: 13px;
    color: #ffffff;
    cursor: pointer;
    text-align: center;
    transition: border-color 180ms ease, background 180ms ease, transform 180ms ease;
  }

  .rgvx-payment-option:hover,
  .rgvx-payment-option.active {
    border-color: rgba(248, 113, 113, 0.55);
    background: rgba(220, 38, 38, 0.10);
    transform: translateY(-1px);
  }

  .rgvx-payment-option:disabled {
    cursor: wait;
    opacity: 0.66;
  }

  .rgvx-payment-option > svg {
    display: block;
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
    font-size: 11px;
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

  .rgvx-orbit-card-panel {
    display: grid;
    gap: 18px;
    margin-top: 18px;
    border: 1px solid rgba(248, 113, 113, 0.24);
    border-radius: 22px;
    background:
      radial-gradient(circle at top right, rgba(220, 38, 38, 0.12), transparent 18rem),
      rgba(5, 5, 5, 0.72);
    padding: 18px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }

  .rgvx-orbit-card-panel .rgvx-block-title small {
    display: block;
    margin-top: 4px;
    color: rgba(255, 255, 255, 0.52);
    font-size: 11px;
    font-weight: 700;
    line-height: 1.45;
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

  .rgvx-address-confirmation {
    display: grid;
    gap: 14px;
    border: 1px solid rgba(248, 113, 113, 0.28);
    border-radius: 20px;
    background: rgba(220, 38, 38, 0.07);
    padding: 16px;
  }

  .rgvx-address-confirmation.confirmed {
    border-color: rgba(74, 222, 128, 0.34);
    background: rgba(34, 197, 94, 0.07);
  }

  .rgvx-address-confirmation-heading {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .rgvx-address-confirmation-heading svg {
    flex: 0 0 auto;
    margin-top: 1px;
    color: #fca5a5;
  }

  .rgvx-address-confirmation.confirmed .rgvx-address-confirmation-heading svg {
    color: #86efac;
  }

  .rgvx-address-confirmation-heading strong,
  .rgvx-address-preview strong {
    display: block;
    color: #ffffff;
    font-size: 13px;
    font-weight: 950;
  }

  .rgvx-address-confirmation-heading small {
    display: block;
    margin-top: 4px;
    color: rgba(255, 255, 255, 0.52);
    font-size: 11px;
    font-weight: 700;
    line-height: 1.45;
  }

  .rgvx-address-preview {
    display: grid;
    gap: 3px;
    border-radius: 14px;
    background: rgba(0, 0, 0, 0.24);
    padding: 12px;
  }

  .rgvx-address-preview span {
    color: rgba(255, 255, 255, 0.68);
    font-size: 12px;
    font-weight: 700;
    line-height: 1.4;
  }

  .rgvx-address-confirmation-check {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    color: rgba(255, 255, 255, 0.78);
    cursor: pointer;
    font-size: 12px;
    font-weight: 850;
    line-height: 1.5;
  }

  .rgvx-address-confirmation-check input {
    width: 17px;
    min-width: 17px;
    height: 17px;
    min-height: 17px;
    margin-top: 1px;
    accent-color: #dc2626;
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

  .rgvx-shipping-option-main {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .rgvx-carrier-logo {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 34px;
  }

  .rgvx-carrier-logo.ups svg {
    width: 31px;
    height: 36px;
  }

  .rgvx-carrier-logo.ups path {
    fill: #351c15;
    stroke: #ffb81c;
    stroke-width: 2;
  }

  .rgvx-carrier-logo.ups text {
    fill: #ffb81c;
    font-family: Arial, sans-serif;
    font-size: 10px;
    font-weight: 800;
  }

  .rgvx-carrier-logo.usps {
    width: 58px;
    height: 38px;
  }

  .rgvx-carrier-logo.usps img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
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
      grid-template-columns: 1fr !important;
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

  /* Desktop summary: no nested scrolling. Show totals, earned points and then
     the coupon in the same natural reading order. */
  @media (min-width: 981px) {
    .rgvx-order-summary {
      position: static !important;
      max-height: none !important;
      overflow: visible !important;
      padding-bottom: 18px !important;
    }

    .rgvx-summary-head {
      order: 1;
    }

    .rgvx-totals {
      order: 2;
      position: static !important;
      bottom: auto !important;
      display: contents;
    }

    .rgvx-mini-coupon {
      order: 5;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      align-items: center;
      gap: 10px 12px;
      margin: 14px 0 4px;
      padding: 11px 12px;
      border-radius: 16px;
    }

    .rgvx-mini-coupon-header {
      grid-column: 1;
    }

    .rgvx-mini-coupon-controls {
      grid-column: 1;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
    }

    .rgvx-mini-coupon-code-wrap,
    .rgvx-mini-coupon-action {
      min-height: 42px;
    }

    .rgvx-mini-coupon-action {
      width: auto;
      min-width: 108px;
      padding-inline: 16px;
    }

    .rgvx-coupon-message {
      grid-column: 1 / -1;
    }

    .rgvx-total-row {
      order: 3;
    }

    .rgvx-loyalty-earned,
    .rgvx-loyalty-progress-card {
      order: 4;
      margin-top: 4px;
      padding: 11px 12px;
    }

    .rgvx-items-list {
      order: 3;
      max-height: none !important;
      overflow: visible !important;
    }

    .rgvx-free-progress {
      order: 4;
    }

    .rgvx-shipping-options {
      order: 5;
    }
  }

  /* RGVPRIME editorial checkout — final visual layer */
  .rgvx-page {
    --rgvx-canvas: #0d0c0a;
    --rgvx-surface: #151411;
    --rgvx-surface-raised: #1b1916;
    --rgvx-ivory: #f2eee5;
    --rgvx-stone: #a49d93;
    --rgvx-stone-dim: #756f67;
    --rgvx-line: #2b2925;
    --rgvx-line-strong: #3a3631;
    --rgvx-red: #a9443c;
    --rgvx-red-soft: #c86f66;
    --rgvx-champagne: #c7ad82;
    min-height: 100dvh;
    padding: 0 22px 96px !important;
    background: var(--rgvx-canvas) !important;
    color: var(--rgvx-ivory);
    font-family: Inter, "Helvetica Neue", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .rgvx-background-wash {
    opacity: 1 !important;
    background:
      radial-gradient(circle at 8% 0%, rgba(126, 82, 65, .10), transparent 34rem),
      radial-gradient(circle at 92% 12%, rgba(161, 133, 91, .055), transparent 32rem) !important;
    mask-image: none !important;
  }

  .rgvx-shell {
    width: min(1340px, 100%) !important;
  }

  .rgvx-checkout-masthead {
    display: grid;
    min-height: 82px;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 24px;
    border-bottom: 1px solid var(--rgvx-line);
  }

  .rgvx-checkout-brand {
    display: inline-flex;
    width: fit-content;
    align-items: center;
  }

  .rgvx-checkout-brand img {
    width: 160px;
    height: auto;
  }

  .rgvx-masthead-title {
    color: #d8d2c8;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: .04em;
  }

  .rgvx-checkout-secure-note {
    display: inline-flex;
    justify-self: end;
    align-items: center;
    gap: 8px;
    color: var(--rgvx-stone);
    font-size: 11px;
    font-weight: 600;
  }

  .rgvx-checkout-secure-note svg {
    color: var(--rgvx-champagne);
  }

  .rgvx-checkout-progress {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    margin: 32px 0 0;
  }

  .rgvx-checkout-progress > div {
    position: relative;
    display: flex;
    align-items: baseline;
    gap: 9px;
    border-top: 1px solid var(--rgvx-line);
    padding: 14px 10px 0 0;
    color: var(--rgvx-stone-dim);
    transition: color 180ms ease, border-color 180ms ease;
  }

  .rgvx-checkout-progress > div::before {
    position: absolute;
    top: -1px;
    left: 0;
    width: 0;
    height: 1px;
    background: var(--rgvx-red-soft);
    content: "";
    transition: width 220ms ease;
  }

  .rgvx-checkout-progress > div.is-complete::before,
  .rgvx-checkout-progress > div.is-current::before {
    width: 100%;
  }

  .rgvx-checkout-progress > div.is-complete,
  .rgvx-checkout-progress > div.is-current {
    color: #d8d1c6;
  }

  .rgvx-checkout-progress > div.is-current {
    color: var(--rgvx-ivory);
  }

  .rgvx-checkout-progress span {
    color: inherit;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    letter-spacing: .08em;
  }

  .rgvx-checkout-progress strong {
    font-size: 12px;
    font-weight: 600;
  }

  .rgvx-clean-header {
    display: block !important;
    max-width: 720px;
    margin: clamp(48px, 6vw, 78px) 0 clamp(40px, 5vw, 62px) !important;
  }

  .rgvx-clean-header p,
  .rgvx-section-heading p,
  .rgvx-summary-head p {
    color: var(--rgvx-champagne) !important;
    font-size: 10px !important;
    font-weight: 650 !important;
    letter-spacing: .16em !important;
  }

  .rgvx-clean-header h1 {
    margin: 12px 0 0 !important;
    color: var(--rgvx-ivory) !important;
    font-family: "Iowan Old Style", "Baskerville", "Times New Roman", serif;
    font-size: clamp(42px, 5vw, 68px) !important;
    font-weight: 400 !important;
    letter-spacing: -.045em !important;
    line-height: .98 !important;
    text-transform: none !important;
  }

  .rgvx-clean-header > div > span {
    max-width: 520px !important;
    margin-top: 16px !important;
    color: var(--rgvx-stone) !important;
    font-size: 14px !important;
    font-weight: 450 !important;
    line-height: 1.65 !important;
  }

  .rgvx-clean-layout {
    display: grid !important;
    width: 100% !important;
    grid-template-columns: minmax(0, 1.62fr) minmax(360px, 1fr) !important;
    gap: clamp(48px, 6vw, 82px) !important;
    align-items: start !important;
  }

  .rgvx-flow {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0 !important;
  }

  .rgvx-zelle-area {
    display: grid;
    gap: 0 !important;
    margin: 0 !important;
    border: 0 !important;
    background: transparent !important;
    padding: 0 !important;
  }

  .rgvx-form-section,
  .rgvx-shipping-section,
  .rgvx-flow-section.first,
  .rgvx-review-confirm {
    display: grid;
    gap: 22px !important;
    margin: 0 !important;
    border: 0 !important;
    border-top: 1px solid var(--rgvx-line) !important;
    border-radius: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
    padding: 44px 0 !important;
  }

  .rgvx-zelle-area .rgvx-form-section:first-child {
    border-top: 0 !important;
    padding-top: 0 !important;
  }

  .rgvx-block-title,
  .rgvx-section-heading {
    margin: 0 !important;
  }

  .rgvx-block-title {
    align-items: flex-start !important;
    gap: 13px !important;
  }

  .rgvx-block-title svg {
    width: 17px;
    height: 17px;
    margin-top: 5px !important;
    color: var(--rgvx-champagne) !important;
  }

  .rgvx-block-title strong,
  .rgvx-section-heading h2 {
    color: var(--rgvx-ivory) !important;
    font-size: clamp(24px, 2.4vw, 31px) !important;
    font-weight: 520 !important;
    letter-spacing: -.035em !important;
    line-height: 1.1 !important;
  }

  .rgvx-block-title small,
  .rgvx-section-heading span,
  .rgvx-orbit-card-panel .rgvx-block-title small {
    max-width: 620px;
    margin-top: 7px !important;
    color: var(--rgvx-stone) !important;
    font-size: 12px !important;
    font-weight: 450 !important;
    line-height: 1.6 !important;
  }

  .rgvx-form-grid {
    gap: 18px 16px !important;
  }

  .rgvx-form-grid.two {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }

  .rgvx-form-grid.three {
    grid-template-columns: 1.35fr 1fr .8fr !important;
  }

  .rgvx-field {
    gap: 9px !important;
  }

  .rgvx-field > span {
    color: #c7c0b6 !important;
    font-size: 12px !important;
    font-weight: 560 !important;
    letter-spacing: .01em !important;
    text-transform: none !important;
  }

  .rgvx-field input,
  .rgvx-field select {
    width: 100%;
    min-height: 56px !important;
    border: 1px solid var(--rgvx-line-strong) !important;
    border-radius: 13px !important;
    outline: 0;
    background: var(--rgvx-surface) !important;
    padding: 0 16px !important;
    color: var(--rgvx-ivory) !important;
    font-size: 15px !important;
    font-weight: 450 !important;
    box-shadow: 0 1px 0 rgba(255, 255, 255, .015) inset !important;
    transition: border-color 180ms ease, background 180ms ease, box-shadow 180ms ease !important;
  }

  .rgvx-field input::placeholder {
    color: #69645d !important;
  }

  .rgvx-field input:hover,
  .rgvx-field select:hover {
    border-color: #514b44 !important;
  }

  .rgvx-field input:focus,
  .rgvx-field select:focus {
    border-color: #a75a52 !important;
    background: #191714 !important;
    box-shadow: 0 0 0 3px rgba(169, 68, 60, .12) !important;
  }

  .rgvx-marketing-inline {
    align-items: center !important;
    margin-top: -4px;
    color: var(--rgvx-stone) !important;
    font-size: 12px !important;
    font-weight: 450 !important;
  }

  .rgvx-address-confirmation {
    gap: 16px !important;
    border: 1px solid var(--rgvx-line) !important;
    border-radius: 16px !important;
    background: rgba(255, 255, 255, .018) !important;
    padding: 18px !important;
    transition: border-color 180ms ease, background 180ms ease !important;
  }

  .rgvx-address-confirmation.confirmed {
    border-color: rgba(117, 150, 118, .34) !important;
    background: rgba(94, 122, 95, .05) !important;
  }

  .rgvx-address-confirmation-heading svg {
    color: var(--rgvx-stone) !important;
  }

  .rgvx-address-confirmation.confirmed .rgvx-address-confirmation-heading svg {
    color: #93ae91 !important;
  }

  .rgvx-address-confirmation-heading strong,
  .rgvx-address-preview strong {
    color: #ddd7cd !important;
    font-size: 13px !important;
    font-weight: 620 !important;
  }

  .rgvx-address-confirmation-heading small,
  .rgvx-address-preview span {
    color: var(--rgvx-stone) !important;
    font-size: 12px !important;
    font-weight: 450 !important;
  }

  .rgvx-address-preview {
    border-radius: 12px !important;
    background: #11100e !important;
    padding: 14px !important;
  }

  .rgvx-address-confirmation-check {
    color: #c9c2b8 !important;
    font-size: 12px !important;
    font-weight: 520 !important;
  }

  .rgvx-address-confirmation-check input,
  .rgvx-marketing-inline input,
  .rgvx-policy input[type="checkbox"] {
    width: 18px !important;
    min-width: 18px !important;
    height: 18px !important;
    min-height: 18px !important;
    border: 1px solid #5a544c !important;
    border-radius: 5px !important;
    background: #171613 !important;
    box-shadow: none !important;
    accent-color: var(--rgvx-red) !important;
  }

  .rgvx-shipping-options,
  .rgvx-shipping-options.flow {
    display: grid !important;
    gap: 8px !important;
    margin: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: transparent !important;
    padding: 0 !important;
  }

  .rgvx-shipping-options-head {
    display: flex !important;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    border: 0 !important;
    padding: 0 2px 8px !important;
  }

  .rgvx-shipping-options-head span,
  .rgvx-shipping-options-head strong {
    color: var(--rgvx-stone-dim) !important;
    font-size: 10px !important;
    font-weight: 550 !important;
    letter-spacing: .06em !important;
    text-transform: none !important;
  }

  .rgvx-shipping-option-list {
    gap: 0 !important;
  }

  .rgvx-shipping-option {
    display: grid !important;
    min-height: 78px !important;
    grid-template-columns: 18px minmax(0, 1fr) auto !important;
    align-items: center !important;
    gap: 14px !important;
    border: 0 !important;
    border-top: 1px solid var(--rgvx-line) !important;
    border-radius: 0 !important;
    background: transparent !important;
    padding: 13px 14px !important;
    text-align: left !important;
    box-shadow: none !important;
    transform: none !important;
    transition: background 180ms ease, color 180ms ease !important;
  }

  .rgvx-shipping-option:last-child {
    border-bottom: 1px solid var(--rgvx-line) !important;
  }

  .rgvx-shipping-option::before {
    display: block;
    width: 16px;
    height: 16px;
    border: 1px solid #645e56;
    border-radius: 50%;
    background: transparent;
    box-shadow: inset 0 0 0 4px transparent;
    content: "";
    transition: border-color 180ms ease, background 180ms ease, box-shadow 180ms ease;
  }

  .rgvx-shipping-option:hover {
    background: rgba(255, 255, 255, .018) !important;
  }

  .rgvx-shipping-option.active {
    border-color: var(--rgvx-line) !important;
    border-radius: 13px !important;
    background: var(--rgvx-surface-raised) !important;
  }

  .rgvx-shipping-option.active::before {
    border-color: var(--rgvx-red-soft);
    background: var(--rgvx-red-soft);
    box-shadow: inset 0 0 0 4px var(--rgvx-surface-raised);
  }

  .rgvx-shipping-option-main {
    display: flex !important;
    align-items: center;
    gap: 13px !important;
  }

  .rgvx-carrier-logo {
    width: 30px !important;
    height: 30px !important;
    flex: 0 0 30px !important;
    opacity: .82;
  }

  .rgvx-shipping-option strong {
    color: #e2ddd4 !important;
    font-size: 13px !important;
    font-weight: 620 !important;
  }

  .rgvx-shipping-option small {
    margin-top: 3px !important;
    color: var(--rgvx-stone) !important;
    font-size: 11px !important;
    font-weight: 450 !important;
    text-transform: none !important;
  }

  .rgvx-shipping-option em {
    color: #ddd7ce !important;
    font-size: 12px !important;
    font-weight: 620 !important;
  }

  .rgvx-payment-switch {
    display: grid !important;
    grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
    gap: 4px !important;
    border: 1px solid var(--rgvx-line) !important;
    border-radius: 15px !important;
    background: #12110f !important;
    padding: 4px !important;
  }

  .rgvx-payment-option {
    display: flex !important;
    min-height: 48px !important;
    align-items: center !important;
    justify-content: center !important;
    border: 0 !important;
    border-radius: 11px !important;
    background: transparent !important;
    padding: 0 12px !important;
    color: var(--rgvx-stone) !important;
    text-align: center !important;
    box-shadow: none !important;
    transform: none !important;
    transition: background 180ms ease, color 180ms ease, box-shadow 180ms ease !important;
  }

  .rgvx-payment-option:hover {
    background: rgba(255, 255, 255, .025) !important;
    color: #d7d0c6 !important;
  }

  .rgvx-payment-option.active {
    background: #26221e !important;
    color: var(--rgvx-ivory) !important;
    box-shadow: 0 1px 6px rgba(0, 0, 0, .28) !important;
  }

  .rgvx-payment-option > svg,
  .rgvx-payment-option small,
  .rgvx-payment-option em {
    display: none !important;
  }

  .rgvx-payment-option span,
  .rgvx-payment-option strong {
    display: block !important;
  }

  .rgvx-payment-option strong {
    color: inherit !important;
    font-size: 12px !important;
    font-weight: 600 !important;
    letter-spacing: 0 !important;
    text-transform: none !important;
  }

  .rgvx-payment-method-note,
  .rgvx-checkout-state {
    display: flex;
    align-items: center;
    gap: 9px;
    margin: 14px 2px 0;
    color: var(--rgvx-stone);
    font-size: 12px;
    font-weight: 450;
    line-height: 1.55;
  }

  .rgvx-payment-method-note svg {
    color: var(--rgvx-champagne);
  }

  .rgvx-orbit-card-panel {
    display: grid !important;
    gap: 26px !important;
    margin: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: transparent !important;
    padding: 0 0 44px !important;
    box-shadow: none !important;
    animation: rgvx-section-enter 190ms ease both;
  }

  .rgvx-review-confirm {
    gap: 18px !important;
  }

  .rgvx-policy {
    display: flex !important;
    align-items: flex-start !important;
    gap: 12px !important;
    margin: 0 !important;
    border: 0 !important;
    border-top: 1px solid var(--rgvx-line) !important;
    background: transparent !important;
    padding: 17px 0 0 !important;
    color: var(--rgvx-stone) !important;
    font-size: 12px !important;
    font-weight: 450 !important;
    line-height: 1.65 !important;
  }

  .rgvx-policy > span {
    color: inherit !important;
    font-size: inherit !important;
    font-weight: inherit !important;
    line-height: inherit !important;
  }

  .rgvx-policy a {
    color: #d5c0a1 !important;
    font-weight: 560 !important;
    text-decoration-color: rgba(213, 192, 161, .45) !important;
    text-underline-offset: 3px !important;
  }

  .rgvx-policy.warning {
    color: #e5a09a !important;
  }

  .rgvx-final-button {
    display: flex !important;
    width: 100% !important;
    min-height: 58px !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 12px !important;
    margin: 4px 0 0 !important;
    border: 1px solid rgba(255, 255, 255, .06) !important;
    border-radius: 14px !important;
    background: #a23f38 !important;
    padding: 0 20px !important;
    color: #fff8f1 !important;
    text-align: center !important;
    box-shadow: 0 14px 34px rgba(85, 25, 21, .24) !important;
    transition: transform 180ms ease, background 180ms ease, box-shadow 180ms ease !important;
  }

  .rgvx-final-button:hover:not(:disabled) {
    background: #b64d45 !important;
    box-shadow: 0 17px 38px rgba(85, 25, 21, .3) !important;
    transform: translateY(-1px) !important;
  }

  .rgvx-final-button strong {
    color: #fffaf5 !important;
    font-size: 15px !important;
    font-weight: 650 !important;
    letter-spacing: .01em !important;
    text-transform: none !important;
  }

  .rgvx-final-button small {
    display: none !important;
  }

  .rgvx-final-button:disabled {
    opacity: .46 !important;
  }

  .rgvx-checkout-assurance {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-top: 13px;
    color: var(--rgvx-stone-dim);
    font-size: 10px;
    font-weight: 520;
  }

  .rgvx-checkout-assurance i {
    width: 1px;
    height: 11px;
    background: var(--rgvx-line-strong);
  }

  .rgvx-error,
  .rgvx-success {
    margin: 0 0 24px !important;
    border: 1px solid rgba(180, 82, 73, .24) !important;
    border-radius: 12px !important;
    background: rgba(128, 49, 43, .08) !important;
    padding: 13px 15px !important;
    color: #e7aaa4 !important;
    font-size: 12px !important;
    font-weight: 500 !important;
  }

  .rgvx-success {
    border-color: rgba(111, 145, 111, .24) !important;
    background: rgba(80, 113, 81, .07) !important;
    color: #b6cbb4 !important;
  }

  .rgvx-order-summary {
    position: sticky !important;
    top: 24px !important;
    display: block !important;
    align-self: start !important;
    max-height: calc(100dvh - 48px) !important;
    overflow: auto !important;
    border: 1px solid var(--rgvx-line) !important;
    border-radius: 24px !important;
    background: var(--rgvx-surface) !important;
    padding: 30px !important;
    box-shadow: 0 28px 70px rgba(0, 0, 0, .22) !important;
    scrollbar-width: thin !important;
    scrollbar-color: #3b3731 transparent !important;
  }

  .rgvx-mobile-summary-toggle {
    display: none;
  }

  .rgvx-summary-content {
    display: block;
  }

  .rgvx-summary-head {
    align-items: flex-start !important;
    border-bottom: 1px solid var(--rgvx-line) !important;
    padding: 0 0 22px !important;
  }

  .rgvx-summary-head h2 {
    margin: 7px 0 0 !important;
    color: var(--rgvx-ivory) !important;
    font-family: "Iowan Old Style", "Baskerville", "Times New Roman", serif;
    font-size: 28px !important;
    font-weight: 400 !important;
    letter-spacing: -.035em !important;
  }

  .rgvx-summary-head > svg {
    color: var(--rgvx-champagne) !important;
  }

  .rgvx-items-list {
    display: grid !important;
    gap: 0 !important;
    max-height: none !important;
    overflow: visible !important;
    padding: 8px 0 !important;
  }

  .rgvx-summary-item {
    display: grid !important;
    grid-template-columns: 64px minmax(0, 1fr) auto !important;
    align-items: center !important;
    gap: 14px !important;
    border: 0 !important;
    border-bottom: 1px solid var(--rgvx-line) !important;
    border-radius: 0 !important;
    background: transparent !important;
    padding: 16px 0 !important;
  }

  .rgvx-item-image {
    width: 62px !important;
    height: 68px !important;
    border: 1px solid #302d28 !important;
    border-radius: 12px !important;
    background: #11100e !important;
  }

  .rgvx-item-image img {
    width: 100% !important;
    height: 100% !important;
    object-fit: cover !important;
  }

  .rgvx-item-image span {
    top: -7px !important;
    right: -7px !important;
    border: 1px solid #48423b !important;
    background: #24211d !important;
    color: #eee8df !important;
    box-shadow: none !important;
  }

  .rgvx-summary-item strong {
    color: #e4ded5 !important;
    font-size: 13px !important;
    font-weight: 620 !important;
  }

  .rgvx-summary-item small {
    color: var(--rgvx-stone) !important;
    font-size: 11px !important;
    font-weight: 450 !important;
  }

  .rgvx-summary-item em {
    color: #ddd7ce !important;
    font-size: 12px !important;
    font-weight: 600 !important;
  }

  .rgvx-free-progress {
    display: grid !important;
    gap: 11px !important;
    margin: 0 !important;
    border: 0 !important;
    border-bottom: 1px solid var(--rgvx-line) !important;
    border-radius: 0 !important;
    background: transparent !important;
    padding: 18px 0 !important;
  }

  .rgvx-free-progress span,
  .rgvx-free-progress strong {
    color: var(--rgvx-stone) !important;
    font-size: 10px !important;
    font-weight: 520 !important;
    text-transform: none !important;
  }

  .rgvx-free-progress strong {
    color: #cdbda5 !important;
  }

  .rgvx-free-progress .progress-track {
    height: 2px !important;
    background: #302d28 !important;
  }

  .rgvx-free-progress .progress-track span {
    background: linear-gradient(90deg, #8f3c36, #c09f74) !important;
  }

  .rgvx-totals {
    display: grid !important;
    gap: 0 !important;
    padding: 16px 0 0 !important;
  }

  .rgvx-total-row {
    display: flex !important;
    order: initial !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 16px !important;
    padding: 7px 0 !important;
    color: var(--rgvx-stone) !important;
    font-size: 12px !important;
  }

  .rgvx-total-row strong {
    color: #d8d2c9 !important;
    font-weight: 600 !important;
  }

  .rgvx-total-row.good strong,
  .rgvx-total-row strong.free {
    color: #a9bf9f !important;
  }

  .rgvx-total-row.total {
    margin-top: 13px !important;
    border-top: 1px solid var(--rgvx-line) !important;
    padding: 20px 0 6px !important;
  }

  .rgvx-total-row.total span {
    color: #c8c1b7 !important;
    font-size: 11px !important;
    font-weight: 560 !important;
    letter-spacing: .04em !important;
  }

  .rgvx-total-row.total strong {
    color: var(--rgvx-ivory) !important;
    font-family: "Iowan Old Style", "Baskerville", "Times New Roman", serif;
    font-size: 30px !important;
    font-weight: 400 !important;
    letter-spacing: -.035em !important;
  }

  .rgvx-loyalty-earned,
  .rgvx-loyalty-progress-card {
    order: initial !important;
    gap: 10px !important;
    margin: 18px 0 0 !important;
    border: 0 !important;
    border-top: 1px solid var(--rgvx-line) !important;
    border-radius: 0 !important;
    background: transparent !important;
    padding: 17px 0 0 !important;
    box-shadow: none !important;
  }

  .rgvx-loyalty-star {
    width: 24px !important;
    height: 24px !important;
    flex-basis: 24px !important;
    background: transparent !important;
    color: var(--rgvx-champagne) !important;
    font-size: 11px !important;
  }

  .rgvx-loyalty-earned div > span,
  .rgvx-loyalty-earned small,
  .rgvx-loyalty-progress-head div > span,
  .rgvx-loyalty-progress-copy small {
    color: var(--rgvx-stone-dim) !important;
    font-size: 10px !important;
    font-weight: 500 !important;
    letter-spacing: .02em !important;
    text-transform: none !important;
  }

  .rgvx-loyalty-earned strong,
  .rgvx-loyalty-progress-head strong,
  .rgvx-loyalty-progress-copy strong {
    color: #cfc6b9 !important;
    font-size: 12px !important;
    font-weight: 600 !important;
  }

  .rgvx-loyalty-progress-head b {
    border: 0 !important;
    background: transparent !important;
    padding: 0 !important;
    color: var(--rgvx-champagne) !important;
    font-size: 11px !important;
  }

  .rgvx-loyalty-progress-track {
    height: 2px !important;
    background: #302d28 !important;
  }

  .rgvx-loyalty-progress-track .current,
  .rgvx-loyalty-progress-track .projected {
    background: var(--rgvx-champagne) !important;
  }

  .rgvx-mini-coupon {
    order: initial !important;
    display: block !important;
    margin: 18px 0 0 !important;
    border: 0 !important;
    border-top: 1px solid var(--rgvx-line) !important;
    border-radius: 0 !important;
    background: transparent !important;
    padding: 0 !important;
    box-shadow: none !important;
  }

  .rgvx-mini-coupon-header {
    display: grid !important;
    min-height: 46px;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 9px;
    padding: 12px 0 0 !important;
    color: var(--rgvx-stone);
    cursor: pointer;
    list-style: none;
  }

  .rgvx-mini-coupon-header::-webkit-details-marker {
    display: none;
  }

  .rgvx-mini-coupon-title span {
    color: #b9b2a8 !important;
    font-size: 11px !important;
    font-weight: 540 !important;
    letter-spacing: 0 !important;
    text-transform: none !important;
  }

  .rgvx-mini-coupon-title svg {
    color: var(--rgvx-stone-dim) !important;
  }

  .rgvx-mini-coupon-pill {
    border: 0 !important;
    background: transparent !important;
    padding: 0 !important;
    color: #a9bf9f !important;
    font-size: 10px !important;
  }

  .rgvx-mini-coupon-chevron {
    color: var(--rgvx-stone-dim);
    transition: transform 180ms ease;
  }

  .rgvx-mini-coupon[open] .rgvx-mini-coupon-chevron {
    transform: rotate(180deg);
  }

  .rgvx-mini-coupon-body {
    padding: 10px 0 2px;
    animation: rgvx-section-enter 180ms ease both;
  }

  .rgvx-mini-coupon-controls {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) auto !important;
    gap: 8px !important;
  }

  .rgvx-mini-coupon-code-wrap {
    border: 1px solid var(--rgvx-line-strong) !important;
    border-radius: 11px !important;
    background: #12110f !important;
  }

  .rgvx-mini-coupon-input {
    min-height: 44px !important;
    color: var(--rgvx-ivory) !important;
    font-size: 12px !important;
  }

  .rgvx-mini-coupon-action {
    min-height: 44px !important;
    border: 1px solid var(--rgvx-line-strong) !important;
    border-radius: 11px !important;
    background: #201d19 !important;
    color: #d7d0c6 !important;
    font-size: 11px !important;
    font-weight: 600 !important;
  }

  .rgvx-summary-trust {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-top: 24px;
    border-top: 1px solid var(--rgvx-line);
    padding-top: 20px;
  }

  .rgvx-summary-trust span {
    display: grid;
    justify-items: center;
    gap: 7px;
    color: var(--rgvx-stone-dim);
    font-size: 9px;
    font-weight: 500;
    line-height: 1.35;
    text-align: center;
  }

  .rgvx-summary-trust svg {
    color: #a69070;
  }

  .rgvx-floating-total-bar {
    display: none !important;
  }

  @keyframes rgvx-section-enter {
    from { opacity: 0; transform: translateY(5px); }
    to { opacity: 1; transform: none; }
  }

  :where(.rgvx-page button, .rgvx-page input, .rgvx-page select, .rgvx-page a):focus-visible {
    outline: 2px solid #bf6b62 !important;
    outline-offset: 3px !important;
  }

  @media (max-width: 980px) {
    .rgvx-page {
      padding-inline: 16px !important;
      padding-bottom: 120px !important;
    }

    .rgvx-checkout-masthead {
      min-height: 72px;
      grid-template-columns: 1fr auto;
    }

    .rgvx-checkout-brand img {
      width: 138px;
    }

    .rgvx-masthead-title {
      display: none;
    }

    .rgvx-checkout-progress {
      margin-top: 24px;
    }

    .rgvx-checkout-progress > div {
      display: grid;
      gap: 4px;
      padding-top: 11px;
    }

    .rgvx-clean-header {
      margin: 42px 0 36px !important;
    }

    .rgvx-clean-layout {
      grid-template-columns: 1fr !important;
      gap: 30px !important;
    }

    .rgvx-order-summary {
      order: 1 !important;
      position: static !important;
      max-height: none !important;
      overflow: hidden !important;
      border-radius: 18px !important;
      padding: 0 20px !important;
      box-shadow: 0 18px 46px rgba(0, 0, 0, .18) !important;
    }

    .rgvx-mobile-summary-toggle {
      display: grid;
      width: 100%;
      min-height: 66px;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 10px;
      border: 0;
      background: transparent;
      padding: 0;
      color: #d9d3c9;
      text-align: left;
    }

    .rgvx-mobile-summary-toggle span {
      font-size: 12px;
      font-weight: 600;
    }

    .rgvx-mobile-summary-toggle strong {
      color: var(--rgvx-ivory);
      font-family: "Iowan Old Style", "Baskerville", "Times New Roman", serif;
      font-size: 20px;
      font-weight: 400;
    }

    .rgvx-mobile-summary-toggle svg {
      color: var(--rgvx-stone);
      transition: transform 180ms ease;
    }

    .rgvx-order-summary.is-open .rgvx-mobile-summary-toggle svg {
      transform: rotate(180deg);
    }

    .rgvx-summary-content {
      max-height: 0;
      overflow: hidden;
      opacity: 0;
      transition: max-height 220ms ease, opacity 180ms ease, padding 220ms ease;
    }

    .rgvx-order-summary.is-open .rgvx-summary-content {
      max-height: 1800px;
      padding-bottom: 22px;
      opacity: 1;
    }

    .rgvx-summary-head {
      display: none !important;
    }

    .rgvx-flow {
      order: 2 !important;
    }

    .rgvx-zelle-area { order: 1 !important; }
    .rgvx-shipping-section { order: 2 !important; }
    .rgvx-payment-section { order: 3 !important; }
    .rgvx-orbit-card-panel,
    .rgvx-checkout-state { order: 4 !important; }
    .rgvx-error,
    .rgvx-success { order: 5 !important; }
    .rgvx-review-confirm { order: 6 !important; }
    .rgvx-final-button { order: 7 !important; }
    .rgvx-checkout-assurance { order: 8 !important; }

    .rgvx-final-button {
      position: sticky !important;
      bottom: max(12px, env(safe-area-inset-bottom)) !important;
      z-index: 20;
      box-shadow: 0 10px 0 10px var(--rgvx-canvas), 0 18px 38px rgba(85, 25, 21, .34) !important;
    }
  }

  @media (max-width: 620px) {
    .rgvx-page {
      padding-inline: 14px !important;
    }

    .rgvx-checkout-secure-note span {
      font-size: 10px;
    }

    .rgvx-checkout-progress strong {
      font-size: 10px;
    }

    .rgvx-clean-header h1 {
      font-size: clamp(38px, 12vw, 50px) !important;
    }

    .rgvx-form-section,
    .rgvx-shipping-section,
    .rgvx-flow-section.first,
    .rgvx-review-confirm {
      padding: 36px 0 !important;
    }

    .rgvx-form-grid.two,
    .rgvx-form-grid.three {
      grid-template-columns: 1fr !important;
    }

    .rgvx-payment-switch {
      grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
    }

    .rgvx-payment-option {
      min-height: 46px !important;
      padding: 0 7px !important;
    }

    .rgvx-payment-option strong {
      font-size: 10px !important;
    }

    .rgvx-shipping-options-head {
      display: grid !important;
      gap: 5px;
    }

    .rgvx-shipping-option {
      grid-template-columns: 18px minmax(0, 1fr) auto !important;
      gap: 10px !important;
      padding-inline: 9px !important;
    }

    .rgvx-carrier-logo {
      display: none !important;
    }

    .rgvx-summary-trust {
      grid-template-columns: 1fr;
    }

    .rgvx-summary-trust span {
      display: flex;
      align-items: center;
      justify-items: initial;
      text-align: left;
    }

    .rgvx-mini-coupon-controls {
      grid-template-columns: 1fr !important;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .rgvx-page *,
    .rgvx-page *::before,
    .rgvx-page *::after {
      scroll-behavior: auto !important;
      animation-duration: .01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: .01ms !important;
    }
  }

  /* Keep the premium composition anchored to the existing RGVPRIME brand. */
  .rgvx-page {
    --rgvx-canvas: #070708;
    --rgvx-surface: #101011;
    --rgvx-surface-raised: #181819;
    --rgvx-ivory: #f5f5f5;
    --rgvx-stone: #a1a1aa;
    --rgvx-stone-dim: #71717a;
    --rgvx-line: rgba(255, 255, 255, .085);
    --rgvx-line-strong: rgba(255, 255, 255, .16);
    --rgvx-red: #d82132;
    --rgvx-red-soft: #ef4350;
    --rgvx-champagne: #ef4350;
  }

  .rgvx-background-wash {
    background:
      radial-gradient(circle at 5% 0%, rgba(216, 33, 50, .105), transparent 34rem),
      radial-gradient(circle at 96% 14%, rgba(216, 33, 50, .05), transparent 30rem) !important;
  }

  .rgvx-clean-header h1,
  .rgvx-summary-head h2,
  .rgvx-total-row.total strong,
  .rgvx-mobile-summary-toggle strong {
    font-family: Inter, "Helvetica Neue", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
  }

  .rgvx-clean-header h1 {
    font-weight: 760 !important;
    letter-spacing: -.055em !important;
  }

  .rgvx-summary-head h2 {
    font-weight: 680 !important;
    letter-spacing: -.04em !important;
  }

  .rgvx-total-row.total strong,
  .rgvx-mobile-summary-toggle strong {
    font-weight: 670 !important;
  }

  .rgvx-field input,
  .rgvx-field select,
  .rgvx-address-preview,
  .rgvx-mini-coupon-code-wrap {
    background: #0d0d0e !important;
  }

  .rgvx-field input:focus,
  .rgvx-field select:focus {
    border-color: var(--rgvx-red-soft) !important;
    background: #101011 !important;
    box-shadow: 0 0 0 3px rgba(216, 33, 50, .12) !important;
  }

  .rgvx-payment-switch {
    background: #0b0b0c !important;
  }

  .rgvx-payment-option.active {
    background: #232124 !important;
    box-shadow: inset 0 -2px 0 rgba(239, 67, 80, .72), 0 1px 6px rgba(0, 0, 0, .3) !important;
  }

  .rgvx-final-button {
    background: #c91f30 !important;
    box-shadow: 0 14px 34px rgba(152, 16, 34, .25) !important;
  }

  .rgvx-final-button:hover:not(:disabled) {
    background: #df2b3b !important;
    box-shadow: 0 17px 38px rgba(152, 16, 34, .32) !important;
  }

  .rgvx-mini-coupon-action {
    background: #181819 !important;
    color: #d4d4d8 !important;
    letter-spacing: .01em !important;
    text-transform: none !important;
  }

  .rgvx-mini-coupon-input {
    color: #f4f4f5 !important;
    font-family: inherit !important;
    font-weight: 520 !important;
    letter-spacing: .01em !important;
    text-transform: none !important;
  }

  .rgvx-mini-coupon-input::placeholder {
    color: #62626a !important;
    font-weight: 500 !important;
    letter-spacing: 0 !important;
    text-transform: none !important;
  }

  .rgvx-mini-coupon-code-wrap:focus-within {
    border-color: var(--rgvx-red-soft) !important;
    box-shadow: 0 0 0 3px rgba(216, 33, 50, .12) !important;
  }

  .rgvx-field input:focus-visible,
  .rgvx-field select:focus-visible,
  .rgvx-mini-coupon-input:focus-visible {
    outline: none !important;
  }

  :where(.rgvx-page button, .rgvx-page a, .rgvx-page summary):focus-visible {
    outline: 2px solid var(--rgvx-red-soft) !important;
    outline-offset: 3px !important;
  }

  /* Compact RGVPRIME red edition. */
  .rgvx-page {
    padding: 0 20px 72px !important;
    background:
      radial-gradient(circle at 7% 3%, rgba(216, 33, 50, .13), transparent 28rem),
      radial-gradient(circle at 94% 18%, rgba(216, 33, 50, .07), transparent 24rem),
      #070708 !important;
  }

  .rgvx-shell {
    width: min(1420px, 100%) !important;
  }

  .rgvx-checkout-masthead {
    position: sticky;
    top: 0;
    z-index: 60;
    min-height: 74px;
    border-bottom: 1px solid rgba(239, 67, 80, .28);
    background: linear-gradient(180deg, rgba(7, 7, 8, .98), rgba(7, 7, 8, .91));
    box-shadow: 0 14px 34px rgba(0, 0, 0, .2);
    backdrop-filter: blur(18px);
  }

  .rgvx-checkout-brand {
    display: grid;
    gap: 1px;
    padding: 7px 0;
  }

  .rgvx-checkout-brand img {
    width: 194px;
    filter: drop-shadow(0 0 15px rgba(239, 67, 80, .18));
  }

  .rgvx-checkout-brand > span {
    padding-left: 3px;
    color: #8e8e96;
    font-size: 8px;
    font-weight: 720;
    letter-spacing: .2em;
    text-transform: uppercase;
  }

  .rgvx-masthead-title {
    display: inline-flex;
    min-height: 30px;
    align-items: center;
    border: 1px solid rgba(239, 67, 80, .22);
    border-radius: 999px;
    background: rgba(216, 33, 50, .055);
    padding: 0 13px;
    color: #d7d7dc;
    font-size: 9px;
    font-weight: 720;
    letter-spacing: .12em;
    text-transform: uppercase;
  }

  .rgvx-masthead-actions {
    display: flex;
    justify-self: end;
    align-items: center;
    gap: 14px;
  }

  .rgvx-points-chip {
    display: flex;
    min-height: 44px;
    align-items: center;
    gap: 9px;
    border: 1px solid rgba(239, 67, 80, .34);
    border-radius: 14px;
    background:
      linear-gradient(135deg, rgba(216, 33, 50, .19), rgba(216, 33, 50, .055)),
      #111113;
    padding: 6px 11px 6px 7px;
    box-shadow: 0 8px 24px rgba(108, 8, 23, .16), inset 0 1px 0 rgba(255, 255, 255, .04);
  }

  .rgvx-points-chip > span {
    display: grid;
    width: 30px;
    height: 30px;
    flex: 0 0 30px;
    place-items: center;
    border-radius: 10px;
    background: linear-gradient(145deg, #ef4350, #a91024);
    color: #fff;
    font-size: 12px;
    box-shadow: 0 6px 16px rgba(216, 33, 50, .24);
  }

  .rgvx-points-chip div {
    display: grid;
    gap: 1px;
  }

  .rgvx-points-chip small {
    color: #9c9ca5;
    font-size: 8px;
    font-weight: 650;
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  .rgvx-points-chip strong {
    color: #fff3f4;
    font-size: 11px;
    font-weight: 780;
    white-space: nowrap;
  }

  .rgvx-checkout-progress {
    gap: 10px;
    margin-top: 18px;
  }

  .rgvx-checkout-progress > div {
    padding-top: 10px;
  }

  .rgvx-clean-header {
    margin: 30px 0 30px !important;
  }

  .rgvx-clean-header p,
  .rgvx-section-heading p,
  .rgvx-summary-head p {
    color: var(--rgvx-red-soft) !important;
  }

  .rgvx-clean-header h1 {
    margin-top: 8px !important;
    font-size: clamp(40px, 4.4vw, 54px) !important;
  }

  .rgvx-clean-header > div > span {
    margin-top: 11px !important;
    font-size: 13px !important;
    line-height: 1.5 !important;
  }

  .rgvx-clean-layout {
    grid-template-columns: minmax(0, 1.7fr) minmax(390px, .92fr) !important;
    gap: clamp(34px, 4vw, 54px) !important;
  }

  .rgvx-form-section,
  .rgvx-shipping-section,
  .rgvx-flow-section.first,
  .rgvx-review-confirm {
    gap: 17px !important;
    padding: 30px 0 !important;
  }

  .rgvx-block-title {
    gap: 11px !important;
  }

  .rgvx-block-title > svg {
    width: 32px !important;
    height: 32px !important;
    margin-top: 0 !important;
    border: 1px solid rgba(239, 67, 80, .24);
    border-radius: 10px;
    background: rgba(216, 33, 50, .075);
    padding: 7px;
    color: var(--rgvx-red-soft) !important;
  }

  .rgvx-block-title strong,
  .rgvx-section-heading h2 {
    font-size: clamp(23px, 2vw, 28px) !important;
  }

  .rgvx-block-title small,
  .rgvx-section-heading span,
  .rgvx-orbit-card-panel .rgvx-block-title small {
    margin-top: 5px !important;
    line-height: 1.45 !important;
  }

  .rgvx-form-grid {
    gap: 13px 13px !important;
  }

  .rgvx-field {
    gap: 7px !important;
  }

  .rgvx-field input,
  .rgvx-field select {
    min-height: 50px !important;
    border-radius: 12px !important;
    padding-inline: 14px !important;
    font-size: 14px !important;
  }

  .rgvx-address-confirmation {
    gap: 13px !important;
    border-color: rgba(239, 67, 80, .13) !important;
    padding: 15px !important;
  }

  .rgvx-shipping-options-head {
    padding-bottom: 5px !important;
  }

  .rgvx-shipping-option-list {
    display: grid !important;
    gap: 7px !important;
  }

  .rgvx-shipping-option,
  .rgvx-shipping-option:last-child {
    min-height: 68px !important;
    border: 1px solid var(--rgvx-line) !important;
    border-radius: 14px !important;
    background: #0c0c0d !important;
    padding: 10px 12px !important;
  }

  .rgvx-shipping-option:hover {
    border-color: rgba(239, 67, 80, .25) !important;
    background: #121113 !important;
    transform: translateY(-1px) !important;
  }

  .rgvx-shipping-option.active {
    border-color: rgba(239, 67, 80, .55) !important;
    background:
      linear-gradient(100deg, rgba(216, 33, 50, .14), rgba(216, 33, 50, .025) 48%),
      #121113 !important;
    box-shadow: inset 3px 0 0 #e12f40, 0 10px 28px rgba(0, 0, 0, .15) !important;
  }

  .rgvx-payment-switch {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 6px !important;
    border-color: rgba(239, 67, 80, .18) !important;
    border-radius: 17px !important;
    padding: 5px !important;
  }

  .rgvx-payment-option {
    min-height: 50px !important;
    border: 1px solid transparent !important;
    border-radius: 12px !important;
  }

  .rgvx-payment-option:hover {
    border-color: rgba(239, 67, 80, .16) !important;
    background: rgba(216, 33, 50, .055) !important;
  }

  .rgvx-payment-option.active {
    border-color: rgba(255, 105, 117, .38) !important;
    background: linear-gradient(135deg, #d82132, #a61025) !important;
    box-shadow: 0 9px 22px rgba(134, 8, 27, .28), inset 0 1px 0 rgba(255, 255, 255, .14) !important;
  }

  .rgvx-payment-option.active strong {
    color: #fff !important;
  }

  .rgvx-orbit-card-panel {
    gap: 20px !important;
    padding-bottom: 30px !important;
  }

  .rgvx-review-confirm {
    gap: 14px !important;
  }

  .rgvx-policy {
    gap: 10px !important;
    padding-top: 14px !important;
    line-height: 1.55 !important;
  }

  .rgvx-final-button {
    position: relative;
    min-height: 64px !important;
    justify-content: space-between !important;
    overflow: hidden;
    border: 1px solid rgba(255, 116, 127, .42) !important;
    border-radius: 17px !important;
    background: linear-gradient(135deg, #ed3042 0%, #c5162d 52%, #961124 100%) !important;
    padding: 0 11px 0 22px !important;
    box-shadow: 0 18px 40px rgba(140, 8, 28, .3), inset 0 1px 0 rgba(255, 255, 255, .17) !important;
  }

  .rgvx-final-button::before {
    position: absolute;
    inset: 0;
    background: linear-gradient(110deg, transparent 20%, rgba(255, 255, 255, .1) 46%, transparent 68%);
    content: "";
    transform: translateX(-110%);
    transition: transform 520ms ease;
  }

  .rgvx-final-button:hover:not(:disabled)::before {
    transform: translateX(110%);
  }

  .rgvx-final-button:hover:not(:disabled) {
    background: linear-gradient(135deg, #f43d4f, #d51d33 52%, #a41328) !important;
    transform: translateY(-2px) !important;
  }

  .rgvx-final-button > span,
  .rgvx-final-button > svg {
    position: relative;
    z-index: 1;
  }

  .rgvx-final-button > span {
    display: grid;
    justify-items: start;
  }

  .rgvx-final-button > svg {
    width: 40px;
    height: 40px;
    border: 1px solid rgba(255, 255, 255, .2);
    border-radius: 12px;
    background: rgba(0, 0, 0, .13);
    padding: 10px;
  }

  .rgvx-order-summary {
    top: 88px !important;
    max-height: calc(100dvh - 106px) !important;
    border-color: rgba(239, 67, 80, .2) !important;
    border-radius: 21px !important;
    background:
      radial-gradient(circle at 100% 0%, rgba(216, 33, 50, .085), transparent 17rem),
      #101011 !important;
    padding: 23px !important;
    box-shadow: 0 28px 70px rgba(0, 0, 0, .3), inset 0 1px 0 rgba(255, 255, 255, .025) !important;
  }

  .rgvx-summary-head {
    padding-bottom: 16px !important;
  }

  .rgvx-summary-head h2 {
    font-size: 26px !important;
  }

  .rgvx-summary-head > svg {
    width: 34px;
    height: 34px;
    border: 1px solid rgba(239, 67, 80, .25);
    border-radius: 11px;
    background: rgba(216, 33, 50, .08);
    padding: 8px;
    color: var(--rgvx-red-soft) !important;
  }

  .rgvx-items-list {
    padding: 4px 0 !important;
  }

  .rgvx-summary-item {
    grid-template-columns: 54px minmax(0, 1fr) auto !important;
    gap: 12px !important;
    padding: 12px 0 !important;
  }

  .rgvx-item-image {
    width: 52px !important;
    height: 57px !important;
    border-color: rgba(239, 67, 80, .15) !important;
    border-radius: 11px !important;
  }

  .rgvx-free-progress {
    gap: 9px !important;
    padding: 14px 0 !important;
  }

  .rgvx-free-progress .progress-track {
    height: 4px !important;
    border-radius: 999px;
  }

  .rgvx-free-progress .progress-track span {
    background: linear-gradient(90deg, #d82132, #ff5361) !important;
  }

  .rgvx-totals {
    padding-top: 12px !important;
  }

  .rgvx-total-row {
    padding: 6px 0 !important;
  }

  .rgvx-total-row.total {
    margin-top: 10px !important;
    border-color: rgba(239, 67, 80, .18) !important;
    padding: 16px 0 4px !important;
  }

  .rgvx-total-row.total strong {
    font-size: 29px !important;
    text-shadow: 0 0 24px rgba(239, 67, 80, .12);
  }

  .rgvx-loyalty-earned,
  .rgvx-loyalty-progress-card {
    margin-top: 14px !important;
    border: 1px solid rgba(239, 67, 80, .35) !important;
    border-radius: 17px !important;
    background:
      radial-gradient(circle at 0% 0%, rgba(239, 67, 80, .19), transparent 54%),
      linear-gradient(135deg, #181012, #111113 68%) !important;
    padding: 15px !important;
    box-shadow: 0 13px 30px rgba(101, 4, 20, .14), inset 0 1px 0 rgba(255, 255, 255, .04) !important;
  }

  .rgvx-loyalty-star {
    width: 34px !important;
    height: 34px !important;
    flex-basis: 34px !important;
    border: 1px solid rgba(255, 112, 123, .32);
    border-radius: 11px;
    background: linear-gradient(145deg, #ed3042, #a91024) !important;
    color: #fff !important;
    font-size: 13px !important;
    box-shadow: 0 7px 18px rgba(216, 33, 50, .22);
  }

  .rgvx-loyalty-progress-head {
    grid-template-columns: 34px minmax(0, 1fr) auto;
  }

  .rgvx-loyalty-earned div > span,
  .rgvx-loyalty-progress-head div > span {
    color: #b4a4a7 !important;
    font-size: 9px !important;
    font-weight: 700 !important;
    letter-spacing: .08em !important;
    text-transform: uppercase !important;
  }

  .rgvx-loyalty-earned strong,
  .rgvx-loyalty-progress-head strong,
  .rgvx-loyalty-progress-copy strong {
    color: #fff1f2 !important;
    font-size: 13px !important;
    font-weight: 740 !important;
  }

  .rgvx-loyalty-progress-head b {
    border: 1px solid rgba(239, 67, 80, .3) !important;
    border-radius: 999px !important;
    background: rgba(216, 33, 50, .14) !important;
    padding: 6px 9px !important;
    color: #ff9ca5 !important;
    font-size: 11px !important;
  }

  .rgvx-loyalty-progress-track {
    height: 6px !important;
    border-radius: 999px;
    background: rgba(255, 255, 255, .075) !important;
  }

  .rgvx-loyalty-progress-track .current {
    background: #891326 !important;
  }

  .rgvx-loyalty-progress-track .projected {
    background: linear-gradient(90deg, #d82132, #ff5361) !important;
  }

  .rgvx-mini-coupon {
    margin-top: 14px !important;
  }

  .rgvx-mini-coupon-action {
    border-color: rgba(239, 67, 80, .25) !important;
    background: linear-gradient(180deg, #211719, #171416) !important;
  }

  .rgvx-mini-coupon-action:hover:not(:disabled) {
    border-color: rgba(239, 67, 80, .48) !important;
    background: rgba(216, 33, 50, .13) !important;
    color: #fff !important;
    transform: translateY(-1px);
  }

  .rgvx-summary-trust {
    margin-top: 18px;
    border-color: rgba(239, 67, 80, .13);
    padding-top: 16px;
  }

  .rgvx-summary-trust svg {
    color: var(--rgvx-red-soft);
  }

  :where(.rgvx-shipping-option, .rgvx-payment-option, .rgvx-mini-coupon-action, .rgvx-mobile-summary-toggle) {
    cursor: pointer;
    transition: border-color 180ms ease, background 180ms ease, color 180ms ease, transform 180ms ease, box-shadow 180ms ease !important;
  }

  @media (max-width: 980px) {
    .rgvx-page {
      padding-inline: 15px !important;
    }

    .rgvx-checkout-masthead {
      min-height: 68px;
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .rgvx-masthead-title {
      display: none !important;
    }

    .rgvx-checkout-brand img {
      width: 148px;
    }

    .rgvx-checkout-brand > span,
    .rgvx-checkout-secure-note {
      display: none;
    }

    .rgvx-masthead-actions {
      gap: 0;
    }

    .rgvx-clean-header {
      margin: 26px 0 24px !important;
    }

    .rgvx-clean-layout {
      grid-template-columns: 1fr !important;
      gap: 22px !important;
    }

    .rgvx-order-summary {
      border-color: rgba(239, 67, 80, .2) !important;
      padding: 0 18px !important;
    }

    .rgvx-mobile-summary-toggle {
      min-height: 60px;
    }

    .rgvx-order-summary.is-open .rgvx-summary-content {
      padding-bottom: 18px;
    }

    .rgvx-final-button {
      position: static !important;
      bottom: auto !important;
      box-shadow: 0 18px 38px rgba(120, 6, 26, .32) !important;
    }
  }

  @media (max-width: 620px) {
    .rgvx-checkout-progress {
      gap: 5px;
      margin-top: 14px;
    }

    .rgvx-clean-header h1 {
      font-size: clamp(36px, 11vw, 46px) !important;
    }

    .rgvx-form-section,
    .rgvx-shipping-section,
    .rgvx-flow-section.first,
    .rgvx-review-confirm {
      padding: 27px 0 !important;
    }

    .rgvx-points-chip {
      min-height: 40px;
      border-radius: 12px;
      padding: 5px 8px 5px 5px;
    }

    .rgvx-points-chip > span {
      width: 28px;
      height: 28px;
      flex-basis: 28px;
      border-radius: 9px;
    }

    .rgvx-points-chip small {
      display: none;
    }

    .rgvx-points-chip strong {
      font-size: 10px;
    }

    .rgvx-payment-switch {
      gap: 4px !important;
    }

    .rgvx-payment-option {
      min-height: 47px !important;
    }
  }

  @media (max-width: 400px) {
    .rgvx-checkout-brand img {
      width: 126px;
    }

    .rgvx-points-chip strong {
      font-size: 9px;
    }
  }

  /* Precision compact layer: tighter rhythm, lighter controls, RGVPRIME red accents. */
  .rgvx-page {
    padding: 0 16px 42px !important;
  }

  .rgvx-shell {
    width: min(1180px, 100%) !important;
  }

  .rgvx-checkout-masthead {
    min-height: 60px !important;
    grid-template-columns: 1fr auto !important;
    gap: 16px !important;
  }

  .rgvx-masthead-actions {
    grid-column: 2 !important;
    justify-self: end !important;
  }

  .rgvx-checkout-brand {
    display: inline-flex !important;
    gap: 0 !important;
    padding: 5px 0 !important;
  }

  .rgvx-checkout-brand img {
    width: 152px !important;
  }

  .rgvx-checkout-brand > span,
  .rgvx-masthead-title,
  .rgvx-checkout-secure-note {
    display: none !important;
  }

  .rgvx-points-chip {
    min-height: 36px !important;
    gap: 7px !important;
    border-radius: 10px !important;
    padding: 4px 9px 4px 4px !important;
    box-shadow: none !important;
  }

  .rgvx-points-chip > span {
    width: 27px !important;
    height: 27px !important;
    flex-basis: 27px !important;
    border-radius: 8px !important;
  }

  .rgvx-points-chip small {
    font-size: 7px !important;
  }

  .rgvx-points-chip strong {
    font-size: 10px !important;
  }

  .rgvx-checkout-progress {
    margin-top: 12px !important;
    gap: 7px !important;
  }

  .rgvx-checkout-progress > div {
    gap: 6px !important;
    padding-top: 8px !important;
  }

  .rgvx-checkout-progress strong {
    font-size: 10px !important;
  }

  .rgvx-clean-header {
    max-width: 600px !important;
    margin: 18px 0 20px !important;
  }

  .rgvx-clean-header p {
    font-size: 8px !important;
  }

  .rgvx-clean-header h1 {
    margin-top: 5px !important;
    font-size: clamp(31px, 3.4vw, 40px) !important;
    letter-spacing: -.045em !important;
    line-height: 1 !important;
  }

  .rgvx-clean-header > div > span {
    max-width: 470px !important;
    margin-top: 7px !important;
    font-size: 11px !important;
    line-height: 1.45 !important;
  }

  .rgvx-clean-layout {
    grid-template-columns: minmax(0, 1.55fr) minmax(330px, .85fr) !important;
    gap: 26px !important;
  }

  .rgvx-form-section,
  .rgvx-shipping-section,
  .rgvx-flow-section.first,
  .rgvx-review-confirm {
    gap: 13px !important;
    padding: 19px 0 !important;
  }

  .rgvx-block-title,
  .rgvx-section-heading {
    gap: 9px !important;
  }

  .rgvx-block-title > svg {
    width: 26px !important;
    height: 26px !important;
    margin: 0 !important;
    border-radius: 8px !important;
    padding: 6px !important;
  }

  .rgvx-block-title strong,
  .rgvx-section-heading h2 {
    font-size: 20px !important;
    font-weight: 650 !important;
    letter-spacing: -.025em !important;
  }

  .rgvx-block-title small,
  .rgvx-section-heading span,
  .rgvx-orbit-card-panel .rgvx-block-title small {
    margin-top: 2px !important;
    font-size: 10px !important;
    line-height: 1.4 !important;
  }

  .rgvx-form-grid {
    gap: 10px !important;
  }

  .rgvx-field {
    gap: 5px !important;
  }

  .rgvx-field > span {
    font-size: 10px !important;
  }

  .rgvx-field input,
  .rgvx-field select {
    min-height: 43px !important;
    border-radius: 9px !important;
    padding-inline: 12px !important;
    font-size: 13px !important;
  }

  .rgvx-address-confirmation {
    gap: 10px !important;
    border-radius: 11px !important;
    padding: 11px !important;
  }

  .rgvx-address-preview {
    padding: 10px !important;
  }

  .rgvx-shipping-options-head {
    padding-bottom: 2px !important;
  }

  .rgvx-shipping-option,
  .rgvx-shipping-option:last-child {
    min-height: 54px !important;
    gap: 10px !important;
    border-radius: 10px !important;
    padding: 8px 10px !important;
  }

  .rgvx-carrier-logo {
    width: 25px !important;
    height: 25px !important;
    flex-basis: 25px !important;
  }

  .rgvx-payment-switch {
    gap: 3px !important;
    border-radius: 12px !important;
    padding: 3px !important;
  }

  .rgvx-payment-option {
    min-height: 41px !important;
    gap: 8px !important;
    border: 1px solid transparent !important;
    border-radius: 9px !important;
    background: transparent !important;
  }

  .rgvx-payment-option:hover {
    border-color: rgba(239, 67, 80, .17) !important;
    background: rgba(216, 33, 50, .05) !important;
    transform: none !important;
  }

  .rgvx-payment-option.active {
    border-color: rgba(239, 67, 80, .34) !important;
    background: linear-gradient(180deg, #241518, #1a1113) !important;
    box-shadow: inset 0 -2px 0 #d82132 !important;
  }

  .rgvx-payment-option.active strong {
    color: #fff !important;
  }

  .rgvx-payment-option > svg {
    display: block !important;
    width: 15px !important;
    height: 15px !important;
    flex: 0 0 15px !important;
    padding: 0 !important;
    color: #777780 !important;
  }

  .rgvx-payment-option.active > svg {
    color: #ff6c79 !important;
  }

  .rgvx-orbit-card-panel {
    gap: 13px !important;
    padding-bottom: 19px !important;
  }

  .rgvx-review-confirm {
    gap: 10px !important;
  }

  .rgvx-policy {
    gap: 9px !important;
    padding-top: 11px !important;
    font-size: 10px !important;
    line-height: 1.5 !important;
  }

  .rgvx-final-button {
    min-height: 50px !important;
    justify-content: center !important;
    gap: 9px !important;
    border: 1px solid rgba(255, 106, 119, .36) !important;
    border-radius: 11px !important;
    background: linear-gradient(135deg, #dd283a, #b5162b) !important;
    padding: 0 16px !important;
    box-shadow: 0 10px 24px rgba(138, 9, 29, .24) !important;
  }

  .rgvx-final-button:hover:not(:disabled) {
    background: linear-gradient(135deg, #ed3446, #c51d31) !important;
    box-shadow: 0 12px 28px rgba(138, 9, 29, .31) !important;
    transform: translateY(-1px) !important;
  }

  .rgvx-final-button::before {
    display: none !important;
  }

  .rgvx-final-button > span {
    display: block !important;
  }

  .rgvx-final-button strong {
    font-size: 13px !important;
  }

  .rgvx-final-button > svg {
    width: 17px !important;
    height: 17px !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: transparent !important;
    padding: 0 !important;
  }

  .rgvx-checkout-assurance {
    margin-top: 8px !important;
    font-size: 9px !important;
  }

  .rgvx-order-summary {
    top: 70px !important;
    max-height: calc(100dvh - 84px) !important;
    border-radius: 16px !important;
    padding: 17px !important;
    box-shadow: 0 18px 44px rgba(0, 0, 0, .26) !important;
  }

  .rgvx-summary-head {
    padding-bottom: 11px !important;
  }

  .rgvx-summary-head h2 {
    margin-top: 3px !important;
    font-size: 22px !important;
  }

  .rgvx-summary-head > svg {
    width: 27px !important;
    height: 27px !important;
    border-radius: 8px !important;
    padding: 6px !important;
  }

  .rgvx-summary-item {
    grid-template-columns: 43px minmax(0, 1fr) auto !important;
    gap: 9px !important;
    padding: 9px 0 !important;
  }

  .rgvx-item-image {
    width: 42px !important;
    height: 46px !important;
    border-radius: 8px !important;
  }

  .rgvx-free-progress {
    gap: 7px !important;
    padding: 11px 0 !important;
  }

  .rgvx-total-row {
    padding: 4px 0 !important;
  }

  .rgvx-total-row.total {
    margin-top: 6px !important;
    padding: 12px 0 2px !important;
  }

  .rgvx-total-row.total strong {
    font-size: 25px !important;
  }

  .rgvx-loyalty-earned,
  .rgvx-loyalty-progress-card {
    margin-top: 10px !important;
    border-radius: 12px !important;
    padding: 11px !important;
  }

  .rgvx-loyalty-star {
    width: 29px !important;
    height: 29px !important;
    flex-basis: 29px !important;
    border-radius: 8px !important;
  }

  .rgvx-mini-coupon {
    margin-top: 10px !important;
  }

  .rgvx-summary-trust {
    margin-top: 12px !important;
    padding-top: 12px !important;
  }

  @media (max-width: 980px) {
    .rgvx-page {
      padding-inline: 13px !important;
    }

    .rgvx-clean-layout {
      grid-template-columns: 1fr !important;
      gap: 14px !important;
    }

    .rgvx-order-summary {
      top: auto !important;
      max-height: none !important;
      padding: 0 14px !important;
    }
  }

  @media (max-width: 620px) {
    .rgvx-checkout-brand img {
      width: 130px !important;
    }

    .rgvx-clean-header {
      margin: 14px 0 15px !important;
    }

    .rgvx-clean-header h1 {
      font-size: 30px !important;
    }

    .rgvx-form-section,
    .rgvx-shipping-section,
    .rgvx-flow-section.first,
    .rgvx-review-confirm {
      padding: 16px 0 !important;
    }

    .rgvx-form-grid.two,
    .rgvx-form-grid.three {
      grid-template-columns: 1fr !important;
    }

    .rgvx-payment-option {
      min-height: 40px !important;
    }

    .rgvx-final-button {
      position: static !important;
      min-height: 49px !important;
    }
  }

  /* Integrated checkout navigation. */
  .rgvx-checkout-masthead {
    min-height: 62px !important;
    grid-template-columns: auto minmax(390px, 1fr) auto !important;
    gap: clamp(18px, 3vw, 40px) !important;
    border: 0 !important;
    border-bottom: 1px solid rgba(239, 67, 80, .22) !important;
    background: rgba(7, 7, 8, .94) !important;
    box-shadow: 0 10px 30px rgba(0, 0, 0, .18) !important;
  }

  .rgvx-checkout-brand img {
    width: 142px !important;
  }

  .rgvx-masthead-actions {
    grid-column: 3 !important;
    justify-self: end !important;
  }

  .rgvx-checkout-progress {
    width: 100% !important;
    max-width: 520px !important;
    justify-self: center !important;
    align-self: center !important;
    gap: 3px !important;
    margin: 0 !important;
    border: 1px solid rgba(255, 255, 255, .07) !important;
    border-radius: 11px !important;
    background: #0c0c0e !important;
    padding: 3px !important;
  }

  .rgvx-checkout-progress > div {
    min-height: 31px !important;
    justify-content: center !important;
    gap: 6px !important;
    border: 0 !important;
    border-radius: 8px !important;
    padding: 0 8px !important;
  }

  .rgvx-checkout-progress > div::before {
    display: none !important;
  }

  .rgvx-checkout-progress > div.is-current {
    background: linear-gradient(180deg, rgba(216, 33, 50, .18), rgba(216, 33, 50, .09)) !important;
    color: #fff !important;
    box-shadow: inset 0 0 0 1px rgba(239, 67, 80, .24) !important;
  }

  .rgvx-checkout-progress > div.is-complete {
    color: #d9a6aa !important;
  }

  .rgvx-checkout-progress span {
    display: grid !important;
    width: 18px !important;
    height: 18px !important;
    place-items: center !important;
    border: 1px solid rgba(255, 255, 255, .11) !important;
    border-radius: 6px !important;
    background: rgba(255, 255, 255, .025) !important;
    font-size: 8px !important;
    line-height: 1 !important;
  }

  .rgvx-checkout-progress .is-current span {
    border-color: #d82132 !important;
    background: #d82132 !important;
    color: #fff !important;
  }

  .rgvx-checkout-progress strong {
    font-size: 9px !important;
    font-weight: 650 !important;
  }

  @media (max-width: 980px) {
    .rgvx-checkout-masthead {
      grid-template-columns: auto minmax(340px, 1fr) auto !important;
      gap: 12px !important;
    }

    .rgvx-checkout-progress {
      max-width: 430px !important;
    }
  }

  @media (max-width: 720px) {
    .rgvx-checkout-masthead {
      min-height: auto !important;
      grid-template-columns: 1fr auto !important;
      gap: 7px 12px !important;
      padding: 7px 0 9px !important;
    }

    .rgvx-masthead-actions {
      grid-column: 2 !important;
      grid-row: 1 !important;
    }

    .rgvx-checkout-progress {
      grid-column: 1 / -1 !important;
      grid-row: 2 !important;
      max-width: none !important;
    }

    .rgvx-checkout-progress > div {
      min-height: 28px !important;
      gap: 4px !important;
      padding-inline: 4px !important;
    }

    .rgvx-checkout-progress span {
      width: 16px !important;
      height: 16px !important;
      border-radius: 5px !important;
      font-size: 7px !important;
    }

    .rgvx-checkout-progress strong {
      font-size: 8px !important;
    }
  }

  /* The checkout does not need a second site navigation. */
  .rgvx-checkout-masthead {
    position: relative !important;
    top: auto !important;
    display: flex !important;
    height: 64px !important;
    min-height: 0 !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 18px !important;
    border: 0 !important;
    background: transparent !important;
    padding: 0 !important;
    box-shadow: none !important;
    backdrop-filter: none !important;
  }

  .rgvx-checkout-brand img {
    width: 154px !important;
  }

  .rgvx-masthead-actions {
    display: flex !important;
    margin-left: auto !important;
  }

  .rgvx-checkout-progress {
    display: none !important;
  }

  .rgvx-points-chip {
    border-color: rgba(239, 67, 80, .24) !important;
    background: rgba(17, 12, 14, .74) !important;
  }

  @media (max-width: 620px) {
    .rgvx-checkout-masthead {
      display: flex !important;
      height: 56px !important;
      padding: 0 !important;
    }

    .rgvx-checkout-brand img {
      width: 128px !important;
    }
  }

  @media (max-width: 980px) {
    .rgvx-review-confirm { order: 3 !important; }
    .rgvx-payment-section { order: 4 !important; }
    .rgvx-orbit-card-panel,
    .rgvx-checkout-state { order: 5 !important; }
    .rgvx-error,
    .rgvx-success { order: 6 !important; }
    .rgvx-final-button { order: 7 !important; }
    .rgvx-checkout-assurance { order: 8 !important; }
  }

`;
