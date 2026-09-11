import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  CreditCard,
  FileUp,
  Gift,
  Lock,
  Mail,
  MapPin,
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
import OrbitSecureCardPayment from "./OrbitSecureCardPayment";
import "./RgvCheckout.clean.css";

const OrbitCardPayment = lazy(() => import("./OrbitCardPayment"));
const LegacyCheckoutStyles = lazy(() => import("./LegacyCheckoutStyles"));

function LegacyStyles() {
  return (
    <Suspense fallback={null}>
      <LegacyCheckoutStyles />
    </Suspense>
  );
}

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
const FREE_SHIPPING_METHOD_LABEL = "Free shipping on orders over $200";
const ORDER_PROCESSING_FEE_RATE = 0.03;
const PRIORITY_PROCESSING_FEE_RATE = 0.05;
const PAYMENT_SESSION_IDLE_MS = 20 * 60 * 1000;
const PAYMENT_SESSION_CHECK_MS = 30 * 1000;
const CHECKOUT_DETAILS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PAYMENT_RETURN_TTL_MS = 60 * 60 * 1000;
const EDEBIT_PENDING_TTL_MS = 60 * 60 * 1000;
const EDEBIT_PENDING_STORAGE_KEY = "rgv_edebit_pending_order";
const EDEBIT_ACTIVE_SESSION_KEY = "rgv_edebit_active_payment";

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
    id: "ups_expedited",
    title: "UPS Shipping",
    label: "UPS Shipping",
    description: "Estimated 2-4 Business days after processing",
    price: 45,
    carrier: "UPS",
    freeShippingEligible: false,
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
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M11.668 14.544l-.028-5.226c.138-.055.387-.111.608-.111.995 0 1.41.774 1.41 2.682 0 1.853-.47 2.765-1.438 2.765-.22 0-.441-.055-.552-.11zM3.124 7.438c4.203-3.843 9.29-4.866 14.018-4.866 1.3 0 2.544.083 3.76.194h-.028v11.253c0 2.184-.774 3.926-2.295 5.171-1.355 1.134-5.447 2.959-6.581 3.456-1.161-.525-5.253-2.378-6.581-3.456-1.493-1.244-2.295-3.014-2.295-5.171V7.438zm12.664 2.599c.028.912.276 1.576 1.687 2.406.747.442 1.051.747 1.051 1.272 0 .581-.387.94-1.023.94-.553 0-1.189-.304-1.631-.691v1.576c.553.304 1.217.525 1.88.525 1.687 0 2.433-1.189 2.461-2.267.028-.995-.249-1.742-1.659-2.571-.608-.387-1.134-.636-1.106-1.244 0-.581.525-.802.995-.802.581 0 1.161.332 1.521.691V8.378c-.304-.221-.94-.581-1.88-.553-1.135.028-2.296.829-2.296 2.212zm-5.834 9.484h1.714l-.028-3.594c.166.028.415.083.774.083 1.908 0 2.986-1.687 2.986-4.175 0-2.461-1.106-4.009-3.152-4.009-.94 0-1.687.221-2.295.608v11.087zm-5.945-6.166c0 1.797.829 2.71 2.516 2.71 1.051 0 1.908-.249 2.571-.691V7.991H7.41v6.387c-.194.138-.47.221-.802.221-.774 0-.885-.719-.885-1.189V7.991H4.009v5.364zM22.12 2.295v11.723c0 2.516-.94 4.645-2.765 6.111-1.549 1.3-6.332 3.429-7.355 3.871-1.023-.442-5.806-2.571-7.355-3.843-1.797-1.465-2.765-3.594-2.765-6.111V2.295C4.756.747 8.074 0 12 0s7.244.747 10.12 2.295z" />
        </svg>
        <span className="rgvx-carrier-wordmark" aria-hidden="true">UPS</span>
      </span>
    );
  }

  return (
    <span className="rgvx-carrier-logo usps" aria-label="USPS">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.145 4.577 0 19.423h20.855L24 4.577H3.145zm-.157 3.806h9.436c.157 0 5.064 0 5.159.975H9.09l1.321 4.026c1.51-.723 5.222-2.233 7.455-2.328.944-.031 1.321.126 1.132.252-.126.063-1.038.189-1.761.377-1.258.315-1.321.315-2.642.755-1.478.503-2.705 1.069-4.53 1.919L.723 18.983l2.265-10.6zm16.483 1.698c-.535-.094-2.768.063-3.334.063-.126 0-.472.031-.472-.063 0-.063.126-.063.377-.094s1.006-.157 1.258-.283c.063-.063.22-.157.315-.252.031-.063.063-.094.157-.094h1.164c.755 0 1.195.094 1.132.723-.031.315-.472 1.132-.629 1.384-.063.094-.189.189-.157 0 .126-.503.597-1.321.189-1.384zm.88 8.902H2.076s17.363-6.794 17.552-6.92c0 0 1.541-2.076.629-2.925-.283-.283-.692-.283-2.265-.283 0 0-.063-.598-2.485-1.164-.283-.063-11.858-2.517-11.858-2.517h19.628l-2.926 13.809z" />
      </svg>
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

const LEGACY_ORBIT_CARD_CHECKOUT_VISIBLE = false;
const ORBIT_PAYMENT_MODE = "embedded";
const ORBIT_EMBEDDED_CHECKOUT_VISIBLE = ORBIT_PAYMENT_MODE === "embedded";
const ORBIT_HOSTED_CHECKOUT_VISIBLE = ORBIT_PAYMENT_MODE === "hosted";
const ORBIT_PAYMENTS_MAX_ORDER_USD_CENTS = 60000;

const PAYMENT_METHODS = [
  ...(LEGACY_ORBIT_CARD_CHECKOUT_VISIBLE ? [{
    id: "card",
    label: "Card & Wallets",
    eyebrow: "Fast route",
    title: "Card & Wallets",
    description: "Apple Pay · Google Pay · Cards",
    badge: "Secure",
    icon: CreditCard,
  }] : []),
  ...(ORBIT_EMBEDDED_CHECKOUT_VISIBLE || ORBIT_HOSTED_CHECKOUT_VISIBLE ? [{
    id: "orbit_secure",
    label: "ORBIT Payments",
    eyebrow: "Secure card payments",
    title: "ORBIT Payments",
    description: ORBIT_EMBEDDED_CHECKOUT_VISIBLE ? "Credit or debit card" : "Card & wallets on pay.orbit",
    badge: "Secure",
    icon: CreditCard,
  }] : []),
  {
    id: "edebit",
    label: "eDebit",
    eyebrow: "Secure bank route",
    title: "eDebit",
    description: "Secure bank payment",
    badge: "Secure",
    icon: Building2,
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
  try {
    const saved = safeJsonParse(localStorage.getItem("rgv_checkout_details_v2"), null);
    if (
      saved?.version === 2 &&
      Number(saved.savedAt) > Date.now() - CHECKOUT_DETAILS_TTL_MS &&
      saved.form && typeof saved.form === "object"
    ) {
      return {
        ...blankForm,
        ...saved.form,
        email: normalizeEmail(saved.form.email || saved.email),
        country: "US",
        state: String(saved.form.state || "").trim().toUpperCase() === "PR" ? "" : saved.form.state,
      };
    }
    localStorage.removeItem("rgv_checkout_details_v2");
    localStorage.removeItem("rgv_checkout_email");
    localStorage.removeItem("rgv_checkout_shipping");
  } catch {
    // Storage can be blocked in privacy modes; checkout remains fully usable.
  }
  return blankForm;
}

function calculatePercentageFee(amount, rate) {
  return Math.round((Math.max(Number(amount) || 0, 0) * rate + Number.EPSILON) * 100) / 100;
}

function persistCheckoutDetails(form, email) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("rgv_checkout_details_v2", JSON.stringify({
      version: 2,
      savedAt: Date.now(),
      email: normalizeEmail(email || form?.email),
      form: {
        ...form,
        email: normalizeEmail(email || form?.email),
        country: "US",
        state: String(form?.state || "").trim().toUpperCase() === "PR" ? "" : form?.state,
      },
    }));
    localStorage.removeItem("rgv_checkout_email");
    localStorage.removeItem("rgv_checkout_shipping");
  } catch {
    // Payment must not fail because browser storage is unavailable.
  }
}

function normalizeCheckoutFormForOrder(form = {}) {
  const state = String(form.state || "").trim().toUpperCase();

  return {
    first_name: String(form.firstName || "").trim(),
    last_name: String(form.lastName || "").trim(),
    email: normalizeEmail(form.email || ""),
    phone: String(form.phone || "").trim(),
    address_1: String(form.address1 || "").trim(),
    address_2: String(form.address2 || "").trim(),
    city: String(form.city || "").trim(),
    state: state === "PR" ? "" : state,
    postcode: String(form.postcode || "").trim(),
    country: "US",
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
  return "/api/checkout/zelle-order";
}

function getPaymentProofEndpoint() {
  return `${cleanUrl(WP_URL)}/wp-json/rgv/v1/payment-proof`;
}

function getCouponValidateEndpoint() {
  return `${cleanUrl(WP_URL)}/wp-json/rgv/v1/validate-coupon`;
}

function getEdebitOrderEndpoint() {
  return "/api/checkout/edebit-order";
}

function getEdebitStatusEndpoint() {
  return "/api/checkout/edebit-status";
}

function getEdebitCancelEndpoint() {
  return "/api/checkout/edebit-cancel";
}

function getOrbitSecureCardOrderEndpoint() {
  return "/api/checkout/orbit-card-order";
}

function getOrbitSecureCardStatusEndpoint() {
  return "/api/checkout/orbit-card-status";
}

function getOrbitHostedStatusEndpoint() {
  return "/api/checkout/orbit-hosted-status";
}

function getOrbitCardCheckoutEndpoint() {
  return "/api/checkout/card-order";
}

function getOrbitCardQuoteEndpoint() {
  return "/api/checkout/card-quote";
}

function createCheckoutAttemptId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function isOrbitQuoteFresh(quote, bufferSeconds = 30) {
  return Boolean(
    quote?.quoteId &&
      Number(quote?.quoteExpiresAt || 0) > Math.floor(Date.now() / 1000) + bufferSeconds
  );
}

function isRecoverableOrbitQuoteFailure(response, data) {
  const message = String(data?.message || data?.error || "").toLowerCase();

  return Boolean(
    data?.quoteChanged ||
      (response?.status === 400 && message.includes("secure checkout session")) ||
      (response?.status === 409 && message.includes("order total changed"))
  );
}

function clearStoredEdebitAttempt() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(EDEBIT_PENDING_STORAGE_KEY);
  sessionStorage.removeItem(EDEBIT_ACTIVE_SESSION_KEY);
}

function readStoredEdebitAttempt() {
  if (typeof window === "undefined") return null;

  try {
    const stored = JSON.parse(sessionStorage.getItem(EDEBIT_ACTIVE_SESSION_KEY) || "null");
    const expiresAt = Number(stored?.expiresAt || 0);
    const redirectUrl = new URL(String(stored?.redirectUrl || ""));

    if (
      !stored?.orderId ||
      redirectUrl.protocol !== "https:" ||
      expiresAt <= Date.now()
    ) {
      clearStoredEdebitAttempt();
      return null;
    }

    return { ...stored, redirectUrl: redirectUrl.toString(), expiresAt };
  } catch {
    clearStoredEdebitAttempt();
    return null;
  }
}

function storeEdebitAttempt(attempt) {
  if (typeof window === "undefined") return;

  sessionStorage.setItem(EDEBIT_ACTIVE_SESSION_KEY, JSON.stringify(attempt));
  localStorage.setItem(
    EDEBIT_PENDING_STORAGE_KEY,
    JSON.stringify({
      orderId: attempt.orderId,
      orderNumber: attempt.orderNumber,
      createdAt: attempt.createdAt,
      expiresAt: attempt.expiresAt,
      lifecycle: "initiated",
    })
  );
}

function buildEdebitAttemptFingerprint(items, email, total, checkoutOptions = {}) {
  return JSON.stringify({
    email: String(email || "").trim().toLowerCase(),
    total: Number(total || 0).toFixed(2),
    shippingMethodId: String(checkoutOptions.shippingMethodId || ""),
    coupon: String(checkoutOptions.coupon || "").trim().toUpperCase(),
    priorityProcessing: checkoutOptions.priorityProcessing === true,
    items: items.map((item) => [
      Number(item.product_id || 0),
      Number(item.variation_id || 0),
      Number(item.quantity || 0),
    ]),
  });
}

const ORBIT_SECURE_ATTEMPT_STORAGE_KEY = "rgv_orbit_secure_checkout_attempt_id";

function getOrCreateOrbitSecureAttemptId() {
  if (typeof window === "undefined") return createCheckoutAttemptId();
  const existing = sessionStorage.getItem(ORBIT_SECURE_ATTEMPT_STORAGE_KEY);
  if (existing) return existing;
  const created = createCheckoutAttemptId();
  sessionStorage.setItem(ORBIT_SECURE_ATTEMPT_STORAGE_KEY, created);
  return created;
}

function replaceOrbitSecureAttemptId() {
  const created = createCheckoutAttemptId();
  if (typeof window !== "undefined") sessionStorage.setItem(ORBIT_SECURE_ATTEMPT_STORAGE_KEY, created);
  return created;
}

function clearOrbitSecureAttemptId() {
  if (typeof window !== "undefined") sessionStorage.removeItem(ORBIT_SECURE_ATTEMPT_STORAGE_KEY);
}

function isStaleStripeSessionError(message) {
  const normalized = String(message || "").toLowerCase();

  return (
    (normalized.includes("confirmation token") && normalized.includes("mounted element")) ||
    normalized.includes("payment_method_types") ||
    normalized.includes("automatic payment methods") ||
    normalized.includes("automatic_payment_methods") ||
    normalized.includes("client_secret") ||
    (normalized.includes("paymentintent") && normalized.includes("expired"))
  );
}

const ORBIT_CARD_RETURN_STORAGE_KEY = "rgv_orbit_card_return";

function getInitialOrbitCardReturn() {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const clientSecret = String(params.get("payment_intent_client_secret") || "");

  if (params.get("orbit_card_return") !== "1" || !/^pi_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+$/.test(clientSecret)) {
    return null;
  }

  let stored = null;
  try {
    stored = safeJsonParse(sessionStorage.getItem(ORBIT_CARD_RETURN_STORAGE_KEY), null);
  } catch {
    return null;
  }

  if (
    !stored ||
    !/^pk_(?:test|live)_[A-Za-z0-9]+$/.test(String(stored.publishableKey || "")) ||
    !/^acct_[A-Za-z0-9]+$/.test(String(stored.connectedAccountId || "")) ||
    Number(stored.savedAt || 0) < Date.now() - PAYMENT_RETURN_TTL_MS
  ) {
    return null;
  }

  return {
    ...stored,
    clientSecret,
    isReturn: true,
  };
}

function getInitialOrbitHostedReturn() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const outcome = String(params.get("orbit_checkout") || "").toLowerCase();
  if (!["success", "cancel"].includes(outcome)) return null;
  return {
    outcome,
    processing: params.get("orbit_confirmation") === "processing",
    orderId: String(params.get("order_id") || "").replace(/\D/g, "").slice(0, 20),
    orderKey: String(params.get("order_key") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 100),
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

  const rawPayment = String(params.get("payment") || "pending").toLowerCase();
  const payment = ["success", "failed", "cancelled", "pending"].includes(rawPayment)
    ? rawPayment
    : ["cancel", "canceled"].includes(rawPayment)
      ? "cancelled"
      : "pending";

  return {
    payment,
    orderId: String(params.get("order_id") || "").replace(/[^0-9]/g, "").slice(0, 20),
    orderKey: String(params.get("order_key") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 100),
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

function ComplianceConfirm({
  placement,
  researchUseAcknowledged,
  termsAccepted,
  hasError,
  onResearchUseChange,
  onTermsChange,
}) {
  const titleId = `rgvx-review-title-${placement}`;

  return (
    <section
      className={`rgvx-review-confirm rgvx-review-confirm-${placement}`}
      aria-labelledby={titleId}
    >
      <div className="rgvx-section-heading">
        <p>Required</p>
        <h2 id={titleId}>Confirm your order</h2>
        <span>Each confirmation is required and starts unchecked.</span>
      </div>

      <label className={`rgvx-policy ${researchUseAcknowledged ? "is-checked" : ""} ${!researchUseAcknowledged && hasError ? "warning" : ""}`}>
        <span className="rgvx-policy-control">
          <input
            type="checkbox"
            checked={researchUseAcknowledged}
            onChange={(event) => onResearchUseChange(event.target.checked)}
          />
          <Check size={15} aria-hidden="true" />
        </span>

        <span className="rgvx-policy-copy">
          <strong>21+ and Research Use Only certification</strong>
          <span>
            I certify that I am 21 years of age or older and that all products in this order are
            being purchased exclusively for qualified laboratory and in-vitro research. They are
            not for human or animal use, administration, consumption, diagnostic, therapeutic,
            cosmetic or clinical application. I accept the{" "}
            <a href={POLICY_LINKS.researchUse}>Research Use Only policy</a>.
          </span>
        </span>
      </label>

      <label className={`rgvx-policy ${termsAccepted ? "is-checked" : ""} ${!termsAccepted && hasError ? "warning" : ""}`}>
        <span className="rgvx-policy-control">
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={(event) => onTermsChange(event.target.checked)}
          />
          <Check size={15} aria-hidden="true" />
        </span>

        <span className="rgvx-policy-copy">
          <strong>Terms &amp; Conditions</strong>
          <span>
            I separately read and accept the <a href={POLICY_LINKS.terms}>Terms &amp; Conditions</a>
            {" "}and the{" "}
            <a href={POLICY_LINKS.refund}>All Sales Final Policy</a>.
          </span>
        </span>
      </label>
    </section>
  );
}

export default function RgvCheckout() {
  const cart = useCart?.();
  const [localCartItems] = useState(() => readStoredCartItems());
  const [edebitReturn] = useState(() => getInitialEdebitReturn());
  const [verifiedEdebitReturn, setVerifiedEdebitReturn] = useState(() =>
    edebitReturn ? { ...edebitReturn, payment: "checking" } : null
  );
  const [orbitCardCheckout, setOrbitCardCheckout] = useState(() => getInitialOrbitCardReturn());
  const [orbitHostedReturn] = useState(() => getInitialOrbitHostedReturn());
  const [checkoutQuote, setCheckoutQuote] = useState(null);
  const [quoteRefreshVersion, setQuoteRefreshVersion] = useState(0);
  const [paymentSessionVersion, setPaymentSessionVersion] = useState(0);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [orbitCardReady, setOrbitCardReady] = useState(false);
  const [orbitPaymentResult, setOrbitPaymentResult] = useState(null);
  const [orbitSecureCardReady, setOrbitSecureCardReady] = useState(false);
  const [orbitSecurePaymentResult, setOrbitSecurePaymentResult] = useState(null);
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState("orbit_secure");
  const [selectedShippingMethodId, setSelectedShippingMethodId] = useState(
    SHIPPING_METHODS[0].id
  );
  const [priorityProcessing, setPriorityProcessing] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState("");
  const [couponMessage, setCouponMessage] = useState("");
  const [couponStatus, setCouponStatus] = useState("idle");
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponValidation, setCouponValidation] = useState(null);
  const [checkoutForm, setCheckoutForm] = useState(() => getInitialCheckoutForm());
  const [shippingAddressConfirmed, setShippingAddressConfirmed] = useState(false);
  const [researchUseAcknowledged, setResearchUseAcknowledged] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [paymentNotice, setPaymentNotice] = useState("");
  const [edebitConfirmationOpen, setEdebitConfirmationOpen] = useState(false);
  const [edebitModalBusy, setEdebitModalBusy] = useState(false);
  const [pendingEdebitAttempt, setPendingEdebitAttempt] = useState(() => readStoredEdebitAttempt());
  const [manualOrder, setManualOrder] = useState(null);
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [receiptMessage, setReceiptMessage] = useState("");
  const [receiptSubmitted, setReceiptSubmitted] = useState(false);
  const [memoCopied, setMemoCopied] = useState(false);
  const [mobileSummaryOpen, setMobileSummaryOpen] = useState(true);
  const [sessionCustomer, setSessionCustomer] = useState(null);
  const omnisendFingerprintRef = useRef("");
  const sessionCustomerPromiseRef = useRef(null);
  const edebitSubmittingRef = useRef(false);
  const edebitCheckoutAttemptIdRef = useRef(createCheckoutAttemptId());
  const orbitCardSubmittingRef = useRef(false);
  const orbitCardPaymentRef = useRef(null);
  const orbitSecureCardPaymentRef = useRef(null);
  const checkoutAttemptIdRef = useRef(createCheckoutAttemptId());
  const orbitSecureCheckoutAttemptIdRef = useRef(getOrCreateOrbitSecureAttemptId());
  const quoteRequestIdRef = useRef(0);
  const lastPaymentActivityRef = useRef(Date.now());
  const couponEmailRef = useRef(normalizeEmail(checkoutForm.email));

  const markPaymentActivity = useCallback(() => {
    lastPaymentActivityRef.current = Date.now();
  }, []);

  const renewOrbitPaymentSession = useCallback((notice = "We refreshed your secure payment session. Your checkout details were preserved.") => {
    if (orbitCardSubmittingRef.current || loading || orbitCardCheckout?.isReturn) return false;

    checkoutAttemptIdRef.current = createCheckoutAttemptId();
    lastPaymentActivityRef.current = Date.now();
    setOrbitCardCheckout(null);
    setOrbitPaymentResult(null);
    setOrbitCardReady(false);
    setPaymentSessionVersion((version) => version + 1);
    setQuoteRefreshVersion((version) => version + 1);
    setError("");
    setPaymentNotice(notice);

    if (typeof window !== "undefined") {
      sessionStorage.removeItem(ORBIT_CARD_RETURN_STORAGE_KEY);
    }

    return true;
  }, [loading, orbitCardCheckout?.isReturn]);

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
    setCheckoutForm((current) => {
      const userEmail = normalizeEmail(user.email);
      const belongsToCurrentUser = !current.email || normalizeEmail(current.email) === userEmail;
      const base = belongsToCurrentUser ? current : getBlankCheckoutForm();
      return {
        ...base,
        email: userEmail,
        firstName: base.firstName || user.first_name || "",
        lastName: base.lastName || user.last_name || "",
        phone: base.phone || user.billing_phone || "",
        address1: base.address1 || user.billing_address_1 || "",
        address2: base.address2 || user.billing_address_2 || "",
        city: base.city || user.billing_city || "",
        state: String(base.state || user.billing_state || "").trim().toUpperCase() === "PR"
          ? ""
          : base.state || user.billing_state || "",
        postcode: base.postcode || user.billing_postcode || "",
        country: "US",
      };
    });

    return user;
  }

  const providerCartItems = useMemo(() => {
    const sources = [cart?.cartItems, cart?.items];
    const validSource = sources.find((source) => Array.isArray(source));

    return Array.isArray(validSource) ? validSource : [];
  }, [cart?.cartItems, cart?.items]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    clearForeignCartCache();
    localStorage.removeItem("rgv_checkout_coupon");
  }, []);

  useEffect(() => {
    loadSessionCustomer();
  }, []);

  useEffect(() => {
    if (!edebitReturn || typeof window === "undefined") return undefined;

    const cleanReturnUrl = new URL(window.location.href);
    EDEBIT_RETURN_QUERY_KEYS.forEach((key) => cleanReturnUrl.searchParams.delete(key));
    window.history.replaceState(
      {},
      "",
      `${cleanReturnUrl.pathname}${cleanReturnUrl.search}${cleanReturnUrl.hash}`
    );

    const controller = new AbortController();

    const verifyPayment = async () => {
      if (!edebitReturn.orderId || !edebitReturn.orderKey) {
        setVerifiedEdebitReturn({
          ...edebitReturn,
          payment: "unverified",
          message: "We could not verify this bank payment yet. Your cart was preserved and no additional payment was started.",
        });
        return;
      }

      try {
        const response = await fetch(getEdebitStatusEndpoint(), {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            orderId: edebitReturn.orderId,
            orderKey: edebitReturn.orderKey,
          }),
        });
        const data = safeJsonParse(await response.text(), {});

        if (!response.ok || data?.success === false) {
          throw new Error(data?.message || "The payment status service is temporarily unavailable.");
        }

        const lifecycle = String(data?.lifecycle || "pending").toLowerCase();
        const payment = lifecycle === "confirmed"
          ? "success"
          : ["cancelled", "expired"].includes(lifecycle)
            ? "cancelled"
            : lifecycle === "failed"
              ? "failed"
              : "pending";

        setVerifiedEdebitReturn({
          ...edebitReturn,
          payment,
          status: String(data?.orderStatus || edebitReturn.status || ""),
          message: String(data?.message || ""),
        });

        if (["confirmed", "cancelled", "expired", "failed"].includes(lifecycle)) {
          clearStoredEdebitAttempt();
          setPendingEdebitAttempt(null);
        }

        if (lifecycle !== "confirmed") return;

        CART_STORAGE_FALLBACK_KEYS.forEach((key) => localStorage.removeItem(key));
        localStorage.removeItem("rgv_checkout_coupon");
        const clearCartHandler = cart?.clearCart || cart?.emptyCart || cart?.resetCart;

        if (typeof clearCartHandler === "function") {
          try {
            clearCartHandler();
          } catch (clearError) {
            console.error("Unable to clear cart after verified eDebit payment:", clearError);
          }
        }
      } catch (statusError) {
        if (statusError?.name === "AbortError") return;
        setVerifiedEdebitReturn({
          ...edebitReturn,
          payment: "unverified",
          message: "We could not verify this bank payment yet. Your cart was preserved; check your email or order history before trying again.",
        });
      }
    };

    verifyPayment();
    return () => controller.abort();
  }, [edebitReturn?.orderId, edebitReturn?.orderKey]);

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

  const cartItems = cart?.hasHydrated ? providerCartItems : localCartItems;

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
  const isOrbitSecureSelected = selectedPaymentMethodId === "orbit_secure";
  const isCardSelected = LEGACY_ORBIT_CARD_CHECKOUT_VISIBLE && selectedPaymentMethodId === "card";
  const usesOrbitQuote = isCardSelected || (isOrbitSecureSelected && ORBIT_HOSTED_CHECKOUT_VISIBLE);
  const hasSelectedPaymentMethod = Boolean(selectedPaymentMethodId);
  const requiresDirectDetails = isCardSelected || isOrbitSecureSelected || isEdebitSelected || isZelleSelected;
  const hasItems = cartItems.length > 0;
  const freeShippingQualifiedBySubtotal =
    Math.max(cartTotal, 0) >= FREE_SHIPPING_MINIMUM;
  const freeShippingBenefitUnlocked =
    freeShippingQualifiedBySubtotal ||
    (couponStatus === "valid" && Boolean(couponValidation?.free_shipping));
  const isFreeShippingUnlocked = (shippingMethod = selectedShippingMethod) =>
    freeShippingBenefitUnlocked && shippingMethod?.freeShippingEligible !== false;
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
  const processingFeeBase = Math.max(discountedCartTotal + shippingCost, 0);
  const estimatedProcessingFee = calculatePercentageFee(
    processingFeeBase,
    ORDER_PROCESSING_FEE_RATE
  );
  const estimatedPriorityProcessingFee = priorityProcessing
    ? calculatePercentageFee(processingFeeBase, PRIORITY_PROCESSING_FEE_RATE)
    : 0;
  const estimatedDue = Math.max(
    processingFeeBase + estimatedProcessingFee + estimatedPriorityProcessingFee,
    0
  );
  const orbitPaymentsAvailable = Boolean(
    (ORBIT_EMBEDDED_CHECKOUT_VISIBLE || ORBIT_HOSTED_CHECKOUT_VISIBLE) &&
    Math.round(estimatedDue * 100) <= ORBIT_PAYMENTS_MAX_ORDER_USD_CENTS
  );
  const availablePaymentMethods = PAYMENT_METHODS.filter(
    (method) => method.id !== "orbit_secure" || orbitPaymentsAvailable
  );

  useEffect(() => {
    if (!orbitPaymentsAvailable && selectedPaymentMethodId === "orbit_secure") {
      setSelectedPaymentMethodId("");
      setOrbitSecurePaymentResult(null);
      setError("");
      setPaymentNotice("");
    }
  }, [selectedPaymentMethodId, orbitPaymentsAvailable]);

  const refreshCheckoutQuote = async ({ signal } = {}) => {
    const items = buildCheckoutItems(cartItems);

    if (!items.length || items.some((item) => !item.product_id)) {
      throw new Error("One or more products are no longer available.");
    }

    const requestId = quoteRequestIdRef.current + 1;
    quoteRequestIdRef.current = requestId;
    setQuoteLoading(true);
    setQuoteError("");

    try {
      const address = normalizeCheckoutFormForOrder(checkoutForm);
      const response = await fetch(getOrbitCardQuoteEndpoint(), {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        signal,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          items,
          billing: address,
          shipping: address,
          couponCode: coupon,
          shippingMethod: selectedShippingMethodId,
          priorityProcessing,
        }),
      });
      const data = await response.json().catch(() => null);

      if (
        !response.ok ||
        data?.success === false ||
        !/^orb_quote_[a-f0-9]{32}$/.test(String(data?.quoteId || "")) ||
        (data?.hostedCheckout !== true && (
          !/^acct_[A-Za-z0-9]+$/.test(String(data?.connectedAccountId || "")) ||
          !/^pk_(?:test|live)_[A-Za-z0-9]+$/.test(String(data?.publishableKey || "")) ||
          !/^pmc_[A-Za-z0-9]+$/.test(String(data?.paymentMethodConfigurationId || ""))
        )) ||
        !Number.isSafeInteger(Number(data?.totalMinor)) || Number(data?.totalMinor) <= 0
      ) {
        throw new Error(String(data?.message || "We could not refresh the secure order total."));
      }

      if (requestId === quoteRequestIdRef.current) setCheckoutQuote(data);
      return data;
    } catch (cause) {
      if (cause?.name !== "AbortError" && requestId === quoteRequestIdRef.current) {
        setCheckoutQuote(null);
        setQuoteError("Secure checkout totals are temporarily unavailable. Please try again.");
      }
      throw cause;
    } finally {
      if (requestId === quoteRequestIdRef.current) setQuoteLoading(false);
    }
  };

  useEffect(() => {
    if (!hasItems || !usesOrbitQuote || orbitCardCheckout?.isReturn) return undefined;
    setCheckoutQuote(null);
    setOrbitCardReady(false);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        await refreshCheckoutQuote({ signal: controller.signal });
      } catch (cause) {
        if (cause?.name === "AbortError") return;
      }
    }, 450);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [cartItems, checkoutForm.email, checkoutForm.firstName, checkoutForm.lastName, checkoutForm.phone, checkoutForm.address1, checkoutForm.address2, checkoutForm.city, checkoutForm.country, checkoutForm.postcode, checkoutForm.state, coupon, hasItems, usesOrbitQuote, orbitCardCheckout?.isReturn, priorityProcessing, quoteRefreshVersion, selectedShippingMethodId]);

  useEffect(() => {
    if (!checkoutQuote?.quoteExpiresAt || orbitCardCheckout?.isReturn) return undefined;

    const refreshAt = Number(checkoutQuote.quoteExpiresAt) * 1000 - 45000;
    const timer = window.setTimeout(
      () => setQuoteRefreshVersion((version) => version + 1),
      Math.max(1000, refreshAt - Date.now()),
    );

    return () => window.clearTimeout(timer);
  }, [checkoutQuote?.quoteExpiresAt, orbitCardCheckout?.isReturn]);

  useEffect(() => {
    if (typeof document === "undefined" || orbitCardCheckout?.isReturn) return undefined;

    const refreshAfterReturning = () => {
      if (document.visibilityState === "visible" && !isOrbitQuoteFresh(checkoutQuote, 45)) {
        setQuoteRefreshVersion((version) => version + 1);
      }
    };

    document.addEventListener("visibilitychange", refreshAfterReturning);
    return () => document.removeEventListener("visibilitychange", refreshAfterReturning);
  }, [checkoutQuote, orbitCardCheckout?.isReturn]);

  useEffect(() => {
    if (typeof window === "undefined" || !hasItems || !isCardSelected || orbitCardCheckout?.isReturn) {
      return undefined;
    }

    const recordActivity = () => markPaymentActivity();
    const refreshIfIdle = () => {
      if (
        document.visibilityState !== "visible" ||
        orbitCardSubmittingRef.current ||
        loading ||
        Date.now() - lastPaymentActivityRef.current < PAYMENT_SESSION_IDLE_MS
      ) {
        return;
      }

      renewOrbitPaymentSession();
    };

    const activityEvents = ["pointerdown", "keydown", "input", "touchstart"];
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, recordActivity, { passive: true });
    });
    document.addEventListener("visibilitychange", refreshIfIdle);
    const interval = window.setInterval(refreshIfIdle, PAYMENT_SESSION_CHECK_MS);

    return () => {
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, recordActivity));
      document.removeEventListener("visibilitychange", refreshIfIdle);
      window.clearInterval(interval);
    };
  }, [hasItems, isCardSelected, loading, markPaymentActivity, orbitCardCheckout?.isReturn, renewOrbitPaymentSession]);

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
  const normalizedCardAddress = normalizeCheckoutFormForOrder(checkoutForm);
  const directPaymentDetailsReady = Boolean(
    !loading && researchUseAcknowledged && termsAccepted && shippingAddressConfirmed &&
    isValidEmail(normalizedCardAddress.email) && normalizedCardAddress.first_name &&
    normalizedCardAddress.last_name && normalizedCardAddress.address_1 && normalizedCardAddress.city &&
    normalizedCardAddress.state && normalizedCardAddress.postcode && normalizedCardAddress.phone
  );
  const cardPaymentEnabled = Boolean(
    checkoutQuote && isOrbitQuoteFresh(checkoutQuote, 20) && !quoteLoading && directPaymentDetailsReady
  );
  const orbitHostedPaymentEnabled = Boolean(
    directPaymentDetailsReady && checkoutQuote?.hostedCheckout === true && isOrbitQuoteFresh(checkoutQuote, 20) && !quoteLoading
  );
  const orbitEmbeddedPaymentEnabled = directPaymentDetailsReady && orbitSecureCardReady;
  const stripePaymentContext = orbitCardCheckout?.isReturn ? orbitCardCheckout : checkoutQuote ? {
    publishableKey: checkoutQuote.publishableKey,
    connectedAccountId: checkoutQuote.connectedAccountId,
    paymentMethodConfigurationId: checkoutQuote.paymentMethodConfigurationId,
    quoteId: checkoutQuote.quoteId,
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
  const summarySubtotal = usesOrbitQuote && checkoutQuote ? checkoutQuote.subtotalMinor / 100 : cartTotal;
  const summaryDiscount = usesOrbitQuote && checkoutQuote ? checkoutQuote.discountMinor / 100 : couponDiscount;
  const summaryShipping = usesOrbitQuote && checkoutQuote ? checkoutQuote.shippingMinor / 100 : shippingCost;
  const summaryTax = usesOrbitQuote && checkoutQuote ? checkoutQuote.taxMinor / 100 : 0;
  const summaryProcessingFee = usesOrbitQuote && checkoutQuote
    ? Number(checkoutQuote.processingFeeMinor || 0) / 100
    : estimatedProcessingFee;
  const summaryPriorityProcessingFee = usesOrbitQuote && checkoutQuote
    ? Number(checkoutQuote.priorityProcessingFeeMinor || 0) / 100
    : estimatedPriorityProcessingFee;
  const summaryTotal = usesOrbitQuote ? authoritativeDue : estimatedDue;
  const edebitAttemptFingerprint = buildEdebitAttemptFingerprint(
    buildCheckoutItems(cartItems),
    checkoutForm.email,
    estimatedDue,
    {
      shippingMethodId: selectedShippingMethod?.id,
      coupon,
      priorityProcessing,
    }
  );
  const canResumePendingEdebit = Boolean(
    pendingEdebitAttempt && pendingEdebitAttempt.fingerprint === edebitAttemptFingerprint
  );
  const displayedSummaryItems = usesOrbitQuote && checkoutQuote?.items?.length === summaryItems.length
    ? summaryItems.map((item, index) => ({
        ...item,
        name: checkoutQuote.items[index].name || item.name,
        quantity: checkoutQuote.items[index].quantity || item.quantity,
        lineTotal: checkoutQuote.items[index].totalMinor / 100,
      }))
    : summaryItems;

  const progressWidth = freeShippingBenefitUnlocked
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
        : isOrbitSecureSelected
          ? ORBIT_EMBEDDED_CHECKOUT_VISIBLE ? "Processing ORBIT Payments" : "Opening ORBIT Payments"
        : isCardSelected
          ? "Processing card payment"
          : "Preparing secure card payment"
    : !hasSelectedPaymentMethod
      ? "Choose a payment method"
      : isZelleSelected
      ? "Place order with Zelle"
      : isEdebitSelected
      ? "Continue with eDebit"
        : isOrbitSecureSelected
          ? ORBIT_EMBEDDED_CHECKOUT_VISIBLE
            ? `Pay ${formatMoney(authoritativeDue)} with ORBIT`
            : `Continue to ORBIT · ${formatMoney(authoritativeDue)}`
        : `Pay ${formatMoney(authoritativeDue)} securely`;

  const paymentButtonDescription = isZelleSelected
    ? "Payment instructions and receipt upload will appear next. Zelle processing can take up to 24 hours."
    : isEdebitSelected
      ? "Your order will be created, then you will securely link your bank."
      : isOrbitSecureSelected
        ? ORBIT_EMBEDDED_CHECKOUT_VISIBLE
          ? "Your card is tokenized securely and the payment is confirmed before the order is completed."
          : "You will be redirected to ORBIT's secure payment page and returned automatically."
      : isCardSelected
        ? "Your payment details are encrypted and protected throughout checkout."
        : !hasSelectedPaymentMethod
          ? "Select eDebit or Zelle above before continuing."
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

    if (!isValidEmail(normalizeEmail(checkoutForm.email))) {
      setCouponStatus("invalid");
      setCouponMessage("Enter your email first so we can verify this one-use coupon.");
      setError("Enter a valid email before applying a coupon.");
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

  useEffect(() => {
    const email = normalizeEmail(checkoutForm.email);
    if (email === couponEmailRef.current) return;
    couponEmailRef.current = email;
    if (!coupon) return;
    setCoupon("");
    setCouponValidation(null);
    setCouponStatus("idle");
    setCouponMessage("Email changed. Apply the coupon again so we can verify its one-use limit.");
  }, [checkoutForm.email, coupon]);

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

  const validateBaseCheckout = ({ throwOnFailure = false } = {}) => {
    const fail = (message) => {
      setError(message);
      if (throwOnFailure) throw new Error(message);
      return false;
    };
    if (!hasItems) {
      return fail("Your cart is empty.");
    }

    if (!researchUseAcknowledged) {
      return fail("Please complete the 21+ and Research Use Only certification.");
    }

    if (!termsAccepted) {
      return fail("Please separately accept the Terms & Conditions.");
    }

    if (requiresDirectDetails && !shippingAddressConfirmed) {
      return fail("Please review and confirm your shipping address before continuing.");
    }

    return true;
  };

  const validateCheckoutInventory = async ({ throwOnFailure = false } = {}) => {
    const fail = (message) => {
      setPaymentNotice("");
      setError(message);
      if (throwOnFailure) throw new Error(message);
      return false;
    };
    if (typeof cart?.validateStock !== "function") {
      return fail("Inventory could not be verified. Please refresh and try again.");
    }

    setError("");
    setPaymentNotice("Checking current inventory...");

    const validation = await cart.validateStock(cartItems, { reconcile: true });

    if (!validation?.success) {
      return fail(validation?.message || "Inventory could not be verified. Please try again.");
    }

    if (!validation.valid) {
      const unavailableNames = validation.items
        ?.filter((item) => !item.available)
        .map((item) => item.name)
        .filter(Boolean)
        .join(", ");

      return fail(
        unavailableNames
          ? `Sold-out products were removed from your cart: ${unavailableNames}. Review the cart before continuing.`
          : "Some quantities were adjusted to current stock. Review the cart before continuing.",
      );
    }

    setPaymentNotice("");
    return true;
  };

  const validateDirectPaymentForm = (paymentLabel, { throwOnFailure = false } = {}) => {
    const fail = (message) => {
      setError(message);
      if (throwOnFailure) throw new Error(message);
      return null;
    };
    const normalizedForm = normalizeCheckoutFormForOrder(checkoutForm);

    if (!isValidEmail(normalizedForm.email)) {
      return fail(`Enter a valid email before continuing with ${paymentLabel}.`);
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
      return fail(`${missingField[1]} is required before continuing with ${paymentLabel}.`);
    }

    const phoneDigits = normalizedForm.phone.replace(/\D/g, "");

    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
      return fail("Enter a valid phone number with 10 to 15 digits.");
    }

    return normalizedForm;
  };

  const preflightOrbitPayment = async ({ quoteId, totalMinor } = {}) => {
    validateBaseCheckout({ throwOnFailure: true });
    if (couponInput && couponInput !== coupon) {
      throw new Error("Apply or clear the coupon code before continuing.");
    }
    await validateCheckoutInventory({ throwOnFailure: true });
    validateDirectPaymentForm("card payment", { throwOnFailure: true });

    let activeQuote = checkoutQuote;
    if (!isOrbitQuoteFresh(activeQuote, 30)) {
      activeQuote = await refreshCheckoutQuote();
    }
    if (
      String(activeQuote?.quoteId || "") !== String(quoteId || "") ||
      Number(activeQuote?.totalMinor) !== Number(totalMinor)
    ) {
      throw new Error("Your total was refreshed. Review it and tap the payment option again.");
    }
    return activeQuote;
  };

  const createOrbitCardPayment = async (confirmationTokenId) => {
    if (orbitCardSubmittingRef.current || loading) throw new Error("Your payment is already being prepared.");

    validateBaseCheckout({ throwOnFailure: true });

    if (couponInput && couponInput !== coupon) {
      const couponError = "Apply or clear the coupon code before continuing.";
      setError(couponError);
      throw new Error(couponError);
    }

    await validateCheckoutInventory({ throwOnFailure: true });

    const normalizedForm = validateDirectPaymentForm("card payment", { throwOnFailure: true });

    const checkoutItems = buildCheckoutItems(cartItems);

    if (!checkoutItems.length || checkoutItems.some((item) => !item.product_id)) {
      setError("One or more products are missing a valid WooCommerce product ID.");
      throw new Error("One or more products are no longer available.");
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

      let activeQuote = checkoutQuote;

      if (!isOrbitQuoteFresh(activeQuote, 20)) {
        setPaymentNotice("Refreshing your secure order total...");
        activeQuote = await refreshCheckoutQuote({ signal: controller.signal });
      }

      persistCheckoutDetails(checkoutForm, billing.email);

      const submitCardCheckout = async (quote) => {
        const response = await fetch(getOrbitCardCheckoutEndpoint(), {
          method: "POST",
          cache: "no-store",
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
            priorityProcessing,
            source: "rgv_custom_checkout_orbit_card",
            ageConfirmed: researchUseAcknowledged,
            researchUseAcknowledged,
            termsAccepted,
            refundPolicyAccepted: termsAccepted,
            finalSalePolicyAccepted: termsAccepted,
            researchUsePolicyAccepted: true,
            policyAcknowledgedAt: new Date().toISOString(),
            confirmationTokenId,
            checkoutAttemptId: checkoutAttemptIdRef.current,
            quoteId: quote.quoteId,
            quoteExpiresAt: quote.quoteExpiresAt,
          }),
        });
        const responseText = await response.text();

        return { response, data: safeJsonParse(responseText, {}) };
      };

      let { response, data } = await submitCardCheckout(activeQuote);

      if (isRecoverableOrbitQuoteFailure(response, data)) {
        setPaymentNotice("Your checkout was refreshed. Finishing payment...");
        checkoutAttemptIdRef.current = createCheckoutAttemptId();
        activeQuote = await refreshCheckoutQuote({ signal: controller.signal });
        ({ response, data } = await submitCardCheckout(activeQuote));
      }

      if ([502, 503, 504].includes(response.status)) {
        setPaymentNotice("The payment service took longer than expected. Retrying safely...");
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        ({ response, data } = await submitCardCheckout(activeQuote));
      }

      if (!response.ok || data?.success === false) {
        const serviceMessage = String(data?.message || data?.error || "");
        const reference = String(data?.requestId || response.headers.get("x-orbit-request-id") || "").slice(0, 64);
        throw new Error(`${serviceMessage || "Unable to prepare secure card payment. Please try again."}${reference ? ` (Reference: ${reference})` : ""}`);
      }

      if (
        !/^orb_tx_[A-Za-z0-9_-]+$/.test(String(data?.orbitTransactionId || "")) ||
        !/^pi_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+$/.test(String(data?.clientSecret || "")) ||
        !/^acct_[A-Za-z0-9]+$/.test(String(data?.connectedAccountId || "")) ||
        !/^pk_(?:test|live)_[A-Za-z0-9]+$/.test(String(data?.publishableKey || "")) ||
        !/^pmc_[A-Za-z0-9]+$/.test(String(data?.paymentMethodConfigurationId || "")) ||
        data.connectedAccountId !== activeQuote.connectedAccountId ||
        data.publishableKey !== activeQuote.publishableKey ||
        data.paymentMethodConfigurationId !== activeQuote.paymentMethodConfigurationId
      ) {
        throw new Error("Secure card payment returned an invalid configuration.");
      }

      const checkout = {
        orbitTransactionId: data.orbitTransactionId,
        clientSecret: data.clientSecret,
        connectedAccountId: data.connectedAccountId,
        publishableKey: data.publishableKey,
        paymentMethodConfigurationId: data.paymentMethodConfigurationId,
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
          paymentMethodConfigurationId: checkout.paymentMethodConfigurationId,
          orderId: checkout.orderId,
          orderNumber: checkout.orderNumber,
          currency: checkout.currency,
          total: checkout.total,
          customerEmail: checkout.customerEmail,
          customerName: checkout.customerName,
          customerPhone: checkout.customerPhone,
          billingAddress: checkout.billingAddress,
          savedAt: Date.now(),
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
    if (!checkoutQuote && quoteLoading) {
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
      if (isStaleStripeSessionError(result.error)) {
        renewOrbitPaymentSession("Your secure payment session was updated. Please review the card details and try again.");
        return;
      }

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

  const clearCartAfterOrbitSecurePayment = () => {
    if (typeof window === "undefined") return;
    CART_STORAGE_FALLBACK_KEYS.forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem("rgv_checkout_coupon");
    const clearCartHandler = cart?.clearCart || cart?.emptyCart || cart?.resetCart;
    if (typeof clearCartHandler === "function") {
      try {
        clearCartHandler();
      } catch (clearError) {
        console.error("Unable to clear cart after ORBIT payment:", clearError);
      }
    }
  };

  const checkOrbitSecurePaymentStatus = async (payment, signal) => {
    let latest = payment;
    for (let attempt = 0; attempt < 20 && String(latest?.transactionStatus).toUpperCase() === "PENDING"; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      const response = await fetch(getOrbitSecureCardStatusEndpoint(), {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        signal,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ orderId: payment.orderId, orderKey: payment.orderKey }),
      });
      const data = safeJsonParse(await response.text(), {});
      if (!response.ok || data?.success === false) {
        if ([502, 503, 504].includes(response.status)) continue;
        throw new Error(data?.message || "Unable to verify the ORBIT Payments transaction.");
      }
      latest = data;
    }
    return latest;
  };

  const createOrbitSecureCardPayment = async (secureCard) => {
    if (loading) return { error: "Your payment is already being prepared." };
    try {
      validateBaseCheckout({ throwOnFailure: true });
      if (couponInput && couponInput !== coupon) throw new Error("Apply or clear the coupon code before continuing.");
      await validateCheckoutInventory({ throwOnFailure: true });
      const normalizedForm = validateDirectPaymentForm("card payment", { throwOnFailure: true });
      const checkoutItems = buildCheckoutItems(cartItems);
      if (!checkoutItems.length || checkoutItems.some((item) => !item.product_id)) {
        throw new Error("One or more products are no longer available.");
      }

      setLoading(true);
      setError("");
      setPaymentNotice("Creating your WooCommerce order and processing with ORBIT Payments...");
      persistCheckoutDetails(checkoutForm, normalizedForm.email);
      const controller = new AbortController();
      const requestTimeout = window.setTimeout(() => controller.abort(), 70000);

      try {
        const response = await fetch(getOrbitSecureCardOrderEndpoint(), {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            billing: normalizedForm,
            shipping: normalizedForm,
            items: checkoutItems,
            couponCode: coupon,
            shippingMethod: selectedShippingMethod?.id,
            priorityProcessing,
            source: "rgv_custom_checkout_orbit_card",
            ageConfirmed: researchUseAcknowledged,
            researchUseAcknowledged,
            termsAccepted,
            refundPolicyAccepted: termsAccepted,
            finalSalePolicyAccepted: termsAccepted,
            researchUsePolicyAccepted: true,
            policyAcknowledgedAt: new Date().toISOString(),
            requestId: orbitSecureCheckoutAttemptIdRef.current,
            ...secureCard,
          }),
        });
        let data = safeJsonParse(await response.text(), {});
        if (!response.ok || data?.success === false) {
          if (data?.verificationRequired && data?.orderId) {
            const pendingPayment = { ...data, status: "PENDING", verificationRequired: true };
            setOrbitSecurePaymentResult(pendingPayment);
            clearOrbitSecureAttemptId();
            clearCartAfterOrbitSecurePayment();
            return { success: true, status: "PENDING", payment: pendingPayment };
          }
          const paymentError = new Error(data?.message || "ORBIT could not process the card payment.");
          paymentError.retrySafe = response.status >= 400 && response.status < 500 && data?.processing !== true;
          throw paymentError;
        }

        if (String(data.transactionStatus || "").toUpperCase() === "PENDING") {
          setPaymentNotice("Card submitted. Waiting for ORBIT confirmation...");
          try {
            data = await checkOrbitSecurePaymentStatus(data, controller.signal);
          } catch (verificationError) {
            console.error("ORBIT status verification will continue by webhook:", verificationError);
            data = { ...data, verificationRequired: true };
          }
        }

        const status = String(data.transactionStatus || "PENDING").toUpperCase();
        if (status === "APPROVED") {
          setOrbitSecurePaymentResult({ ...data, status });
          clearOrbitSecureAttemptId();
          clearCartAfterOrbitSecurePayment();
          return { success: true, status, payment: data };
        }
        if (status === "PENDING") {
          setOrbitSecurePaymentResult({ ...data, status });
          clearOrbitSecureAttemptId();
          clearCartAfterOrbitSecurePayment();
          return { success: true, status, payment: data };
        }
        orbitSecureCheckoutAttemptIdRef.current = replaceOrbitSecureAttemptId();
        throw new Error(status === "DECLINED"
          ? "The card was declined. Try another card or choose eDebit or Zelle."
          : "The ORBIT Payments transaction could not be completed.");
      } finally {
        window.clearTimeout(requestTimeout);
      }
    } catch (err) {
      if (err?.retrySafe) orbitSecureCheckoutAttemptIdRef.current = replaceOrbitSecureAttemptId();
      const message = err?.name === "AbortError"
        ? "ORBIT took too long to respond. Check the order before trying again."
        : err?.message || "The ORBIT Payments transaction could not be completed.";
      setError(message);
      setPaymentNotice("");
      return { error: message };
    } finally {
      setLoading(false);
    }
  };

  const continueToOrbitSecureCard = async () => {
    if (!validateBaseCheckout()) return;
    if (!validateDirectPaymentForm("card payment")) return;
    setError("");
    const result = await orbitSecureCardPaymentRef.current?.confirm();
    if (result?.error) {
      setError(result.error);
      setPaymentNotice("");
    }
  };

  useEffect(() => {
    if (!orbitHostedReturn) return undefined;
    if (orbitHostedReturn.outcome === "cancel") {
      setError("The ORBIT payment was canceled. Your cart is still here and no new payment will be submitted automatically.");
      setPaymentNotice("");
      return undefined;
    }

    const controller = new AbortController();
    let active = true;
    const verify = async () => {
      setLoading(true);
      setError("");
      setPaymentNotice("Confirming your ORBIT payment with WooCommerce...");
      for (let attempt = 0; attempt < 20 && active; attempt += 1) {
        const response = await fetch(getOrbitHostedStatusEndpoint(), {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ orderId: orbitHostedReturn.orderId, orderKey: orbitHostedReturn.orderKey }),
        });
        const data = safeJsonParse(await response.text(), {});
        if (!response.ok || data?.success === false) {
          if ([502, 503, 504].includes(response.status)) {
            await new Promise((resolve) => window.setTimeout(resolve, 1500));
            continue;
          }
          throw new Error(data?.message || "Unable to verify the ORBIT payment.");
        }
        if (data?.paid) {
          sessionStorage.removeItem("rgv_orbit_hosted_pending");
          clearOrbitSecureAttemptId();
          clearCartAfterOrbitSecurePayment();
          if (active) setOrbitSecurePaymentResult({ ...data, status: "APPROVED" });
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
      if (active) setOrbitSecurePaymentResult({
        orderId: orbitHostedReturn.orderId,
        status: "PENDING",
        verificationRequired: true,
        currency: "USD",
      });
    };
    void verify().catch((cause) => {
      if (!active || cause?.name === "AbortError") return;
      setError(cause?.message || "Unable to verify the ORBIT payment.");
      setPaymentNotice("");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [orbitHostedReturn]);

  const continueToOrbitHostedCheckout = async () => {
    if (orbitCardSubmittingRef.current || loading) return;
    let redirecting = false;
    const controller = new AbortController();
    const requestTimeout = window.setTimeout(() => controller.abort(), 45000);
    try {
      validateBaseCheckout({ throwOnFailure: true });
      if (couponInput && couponInput !== coupon) throw new Error("Apply or clear the coupon code before continuing.");
      await validateCheckoutInventory({ throwOnFailure: true });
      const normalizedForm = validateDirectPaymentForm("ORBIT Payments", { throwOnFailure: true });
      const checkoutItems = buildCheckoutItems(cartItems);
      if (!checkoutItems.length || checkoutItems.some((item) => !item.product_id)) throw new Error("One or more products are no longer available.");

      orbitCardSubmittingRef.current = true;
      setLoading(true);
      setError("");
      setPaymentNotice("Preparing your secure ORBIT payment page...");
      let activeQuote = checkoutQuote;
      if (!isOrbitQuoteFresh(activeQuote, 20)) activeQuote = await refreshCheckoutQuote({ signal: controller.signal });
      persistCheckoutDetails(checkoutForm, normalizedForm.email);

      const submit = async (quote) => {
        const response = await fetch(getOrbitCardCheckoutEndpoint(), {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            billing: normalizedForm,
            shipping: normalizedForm,
            items: checkoutItems,
            couponCode: coupon,
            shippingMethod: selectedShippingMethod?.id,
            priorityProcessing,
            source: "rgv_custom_checkout_orbit_hosted",
            ageConfirmed: researchUseAcknowledged,
            researchUseAcknowledged,
            termsAccepted,
            refundPolicyAccepted: termsAccepted,
            finalSalePolicyAccepted: termsAccepted,
            researchUsePolicyAccepted: true,
            policyAcknowledgedAt: new Date().toISOString(),
            checkoutAttemptId: orbitSecureCheckoutAttemptIdRef.current,
            quoteId: quote.quoteId,
            quoteExpiresAt: quote.quoteExpiresAt,
          }),
        });
        return { response, data: safeJsonParse(await response.text(), {}) };
      };

      let { response, data } = await submit(activeQuote);
      if (isRecoverableOrbitQuoteFailure(response, data)) {
        orbitSecureCheckoutAttemptIdRef.current = replaceOrbitSecureAttemptId();
        activeQuote = await refreshCheckoutQuote({ signal: controller.signal });
        ({ response, data } = await submit(activeQuote));
      }
      if (!response.ok || data?.success === false) throw new Error(data?.message || "ORBIT could not prepare the hosted payment page.");

      const redirectUrl = new URL(String(data?.redirectUrl || ""));
      if (data?.hostedCheckout !== true || redirectUrl.protocol !== "https:" || redirectUrl.username || redirectUrl.password || !data?.orderId || !data?.orderKey) {
        throw new Error("ORBIT returned an invalid hosted payment page.");
      }
      sessionStorage.setItem("rgv_orbit_hosted_pending", JSON.stringify({
        orderId: data.orderId,
        orderNumber: data.orderNumber || data.orderId,
        orderKey: data.orderKey,
        redirectUrl: redirectUrl.toString(),
        expiresAt: data.expiresAt,
      }));
      setPaymentNotice("Redirecting to ORBIT Payments...");
      redirecting = true;
      window.location.assign(redirectUrl.toString());
    } catch (err) {
      const message = err?.name === "AbortError"
        ? "ORBIT took too long to prepare the payment page. Your attempt is protected from duplicates; please try again."
        : err?.message || "The ORBIT payment page could not be opened.";
      setError(message);
      setPaymentNotice("");
    } finally {
      window.clearTimeout(requestTimeout);
      orbitCardSubmittingRef.current = false;
      if (!redirecting) setLoading(false);
    }
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

      persistCheckoutDetails(checkoutForm, finalBilling.email);

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
          checkoutAttemptId: edebitCheckoutAttemptIdRef.current,
          ageConfirmed: researchUseAcknowledged,
          researchUseAcknowledged,
          termsAccepted,
          refundPolicyAccepted: termsAccepted,
          finalSalePolicyAccepted: termsAccepted,
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

      const createdAt = new Date().toISOString();
      const nextPendingAttempt = {
        orderId: String(data?.orderId || data?.order_id || ""),
        orderNumber: String(data?.orderNumber || data?.order_number || data?.orderId || ""),
        orderKey: String(data?.orderKey || data?.order_key || ""),
        redirectUrl: parsedRedirect.toString(),
        fingerprint: edebitAttemptFingerprint,
        checkoutAttemptId: edebitCheckoutAttemptIdRef.current,
        createdAt,
        expiresAt: Date.now() + EDEBIT_PENDING_TTL_MS,
      };

      if (nextPendingAttempt.orderId) {
        storeEdebitAttempt(nextPendingAttempt);
        setPendingEdebitAttempt(nextPendingAttempt);
      }

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

  const openEdebitConfirmation = () => {
    if (!validateBaseCheckout()) return;

    if (couponInput && couponInput !== coupon) {
      setError("Apply or clear the coupon code before continuing with bank transfer.");
      return;
    }

    if (!validateDirectPaymentForm("bank transfer")) return;

    const activeAttempt = readStoredEdebitAttempt();
    setPendingEdebitAttempt(activeAttempt);
    setError("");
    setPaymentNotice("");
    setEdebitConfirmationOpen(true);
  };

  const resumePendingEdebit = () => {
    if (!canResumePendingEdebit || !pendingEdebitAttempt?.redirectUrl) return;

    try {
      const redirectUrl = new URL(pendingEdebitAttempt.redirectUrl);
      if (redirectUrl.protocol !== "https:") throw new Error("Invalid payment URL");
      setEdebitConfirmationOpen(false);
      window.location.assign(redirectUrl.toString());
    } catch {
      clearStoredEdebitAttempt();
      setPendingEdebitAttempt(null);
      setError("The previous bank session expired. Start a new secure bank payment.");
    }
  };

  const cancelPendingEdebit = async () => {
    if (!pendingEdebitAttempt?.orderId || !pendingEdebitAttempt?.orderKey) {
      throw new Error("The previous bank order cannot be closed automatically. Continue that payment or choose Zelle; no duplicate order was created.");
    }

    const response = await fetch(getEdebitCancelEndpoint(), {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        orderId: pendingEdebitAttempt.orderId,
        orderKey: pendingEdebitAttempt.orderKey,
        checkoutAttemptId: pendingEdebitAttempt.checkoutAttemptId || "",
      }),
    });
    const data = safeJsonParse(await response.text(), {});

    if (!response.ok || data?.success === false) {
      throw new Error(data?.message || "The previous bank payment could not be closed safely.");
    }

    if (String(data?.lifecycle || "").toLowerCase() === "confirmed") {
      throw new Error("The previous bank payment is already confirmed. Check your order history; no new payment was started.");
    }

    clearStoredEdebitAttempt();
    setPendingEdebitAttempt(null);
    return true;
  };

  const startFreshEdebit = async () => {
    if (edebitModalBusy) return;
    setEdebitModalBusy(true);
    setError("");

    try {
      if (pendingEdebitAttempt) await cancelPendingEdebit();
      edebitCheckoutAttemptIdRef.current = createCheckoutAttemptId();
      setEdebitConfirmationOpen(false);
      await createEdebitOrder();
    } catch (replaceError) {
      setError(replaceError?.message || "Unable to safely restart bank payment.");
      setPaymentNotice("");
      setEdebitConfirmationOpen(false);
    } finally {
      setEdebitModalBusy(false);
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
        persistCheckoutDetails(checkoutForm, finalBilling.email);
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
          priorityProcessing,
          priority_processing: priorityProcessing,
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
          ageConfirmed: researchUseAcknowledged,
          researchUseAcknowledged,
          termsAccepted,
          refundPolicyAccepted: termsAccepted,
          finalSalePolicyAccepted: termsAccepted,
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
    if (isOrbitSecureSelected) {
      if (ORBIT_EMBEDDED_CHECKOUT_VISIBLE) {
        void continueToOrbitSecureCard();
      } else {
        void continueToOrbitHostedCheckout();
      }
      return;
    }

    if (isZelleSelected) {
      createZelleOrder();
      return;
    }

    if (isEdebitSelected) {
      openEdebitConfirmation();
      return;
    }

    setError("Choose a payment method before continuing.");
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
      <LegacyStyles />
      <div className="rgvx-background-wash" />
      <section className="rgvx-empty-state">
        <p>RGVPRIME CHECKOUT</p>
        <h1>Your cart is empty</h1>
        <span>Add products to your cart before continuing to checkout.</span>
        <a href="/shop">Back to shop</a>
      </section>
    </main>
  );

  const CheckoutLoadingState = () => (
    <main className="rgvx-page rgvx-checkout-loading-page" aria-busy="true">
      <LegacyStyles />
      <div className="rgvx-background-wash" />
      <section className="rgvx-checkout-loading" role="status" aria-live="polite">
        <span aria-hidden="true" />
        <p>Preparing secure checkout…</p>
      </section>
    </main>
  );

  if (verifiedEdebitReturn) {
    const paymentSucceeded = verifiedEdebitReturn.payment === "success";
    const paymentCancelled = verifiedEdebitReturn.payment === "cancelled";
    const paymentChecking = verifiedEdebitReturn.payment === "checking";
    const paymentPending = ["pending", "unverified"].includes(verifiedEdebitReturn.payment);
    const orderLabel = verifiedEdebitReturn.orderId ? `ORDER #${verifiedEdebitReturn.orderId}` : "EDEBIT PAYMENT";
    const returnTitle = paymentChecking
      ? "Verifying bank payment"
      : paymentSucceeded
      ? "Bank payment completed"
      : paymentCancelled
        ? "Bank payment cancelled"
        : paymentPending
          ? "Bank payment is not confirmed"
          : "Bank payment was not completed";
    const returnMessage = verifiedEdebitReturn.message ||
      (paymentChecking
        ? "Please wait while we confirm the order directly with WooCommerce."
        : paymentSucceeded
        ? "Your bank transfer payment was received and your order is now being processed."
        : paymentCancelled
          ? "Your order was not paid. Your cart is still available so you can try again or choose another payment method."
          : paymentPending
            ? "No payment has been confirmed. Your cart is preserved; check your email or order history before trying again."
            : "The bank payment could not be completed. Your cart is still available and no new payment attempt will be made automatically.");

    return (
      <main className="rgvx-page rgvx-thanks-page">
        <LegacyStyles />
        <div className="rgvx-background-wash" />

        <section className="rgvx-shell rgvx-thanks-shell">
          <div className="rgvx-topbar">
            <a href="/shop" className="rgvx-ghost-link">
              <ArrowLeft size={14} /> Back to shop
            </a>

            <div className={`rgvx-lock-pill ${paymentSucceeded ? "rgvx-confirmed-pill" : ""}`}>
              {paymentSucceeded ? <BadgeCheck size={13} /> : paymentChecking || paymentPending ? <ShieldCheck size={13} /> : <X size={13} />}
              {paymentChecking ? "Checking status" : paymentSucceeded ? "Payment confirmed" : paymentCancelled ? "Payment cancelled" : paymentPending ? "Confirmation pending" : "Payment failed"}
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
                <strong>{paymentChecking ? "Verifying" : paymentSucceeded ? "Processing" : paymentCancelled ? "Cancelled" : paymentPending ? "Not confirmed" : "Payment required"}</strong>
              </div>
            </div>

            <a
              href={paymentSucceeded ? "/shop" : paymentChecking ? "#" : "/checkout/"}
              className="rgvx-receipt-thanks-button"
              aria-disabled={paymentChecking}
              onClick={paymentChecking ? (event) => event.preventDefault() : undefined}
            >
              {paymentChecking ? "Verifying payment..." : paymentSucceeded ? "Continue shopping" : "Return to checkout"}
              <ChevronRight size={18} />
            </a>
          </section>
        </section>
      </main>
    );
  }

  if (orbitSecurePaymentResult) {
    const approved = orbitSecurePaymentResult.status === "APPROVED";
    const paidAmount = Number(orbitSecurePaymentResult.total ?? orbitSecurePaymentResult.totalUsd ?? 0);
    const paidCurrency = String(orbitSecurePaymentResult.currency || "USD").toUpperCase();
    const amountCop = Number(orbitSecurePaymentResult.amountCopInCents || 0) / 100;
    const secureCharge = amountCop > 0
      ? `${amountCop.toLocaleString("es-CO")} COP`
      : paidAmount > 0 ? formatMoney(paidAmount) : paidCurrency;

    return (
      <main className="rgvx-page rgvx-thanks-page">
        <LegacyStyles />
        <div className="rgvx-background-wash" />
        <section className="rgvx-shell rgvx-thanks-shell">
          <div className="rgvx-topbar">
            <a href="/shop" className="rgvx-ghost-link"><ArrowLeft size={14} /> Back to shop</a>
            <div className={`rgvx-lock-pill ${approved ? "rgvx-confirmed-pill" : ""}`}>
              <BadgeCheck size={13} /> {approved ? "Payment confirmed" : "Confirmation pending"}
            </div>
          </div>
          <section className="rgvx-receipt-thanks-card" aria-live="polite">
            <div className="rgvx-receipt-thanks-icon"><BadgeCheck size={36} /></div>
            <p>ORDER #{orbitSecurePaymentResult.orderNumber || orbitSecurePaymentResult.orderId}</p>
            <h1>{approved ? "ORBIT payment completed" : "ORBIT payment submitted"}</h1>
            <span>{approved
              ? "ORBIT confirmed your payment and your WooCommerce order is now being processed."
              : orbitSecurePaymentResult.verificationRequired
                ? "The payment was submitted but the immediate response could not be confirmed. Do not retry it; the secure payment event will update the order."
                : "ORBIT is still confirming the transaction. Your order will update automatically through the secure payment event."}</span>
            <div className="rgvx-receipt-thanks-details">
              <div><CreditCard size={17} /><span>Payment method</span><strong>ORBIT Payments</strong></div>
              <div><ShieldCheck size={17} /><span>Secure charge</span><strong>{secureCharge}</strong></div>
            </div>
            <a href="/shop" className="rgvx-receipt-thanks-button">Continue shopping <ChevronRight size={18} /></a>
          </section>
        </section>
      </main>
    );
  }

  if (orbitPaymentResult) {
    const paymentSucceeded = orbitPaymentResult.status === "succeeded";

    return (
      <main className="rgvx-page rgvx-thanks-page">
        <LegacyStyles />
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
      </main>
    );
  }

  if (!cart?.hasHydrated && !orbitCardCheckout) return <CheckoutLoadingState />;

  if (!hasItems && !orbitCardCheckout) return <EmptyState />;

  if (receiptSubmitted && manualOrder && isZelleSelected) {
    const orderNumber = manualOrder.order_number || manualOrder.number || manualOrder.id;

    return (
      <main className="rgvx-page rgvx-thanks-page">
        <LegacyStyles />
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
      </main>
    );
  }

  if (manualOrder && isZelleSelected) {
    const orderNumber = manualOrder.order_number || manualOrder.number || manualOrder.id;

    return (
      <main className="rgvx-page rgvx-thanks-page">
        <LegacyStyles />
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
      </main>
    );
  }

  return (
    <main className="rgvx-page">
      <div className="rgvx-background-wash" />

      <section className="rgvx-shell">
        <div className="rgvx-clean-layout">
          <section className="rgvx-flow">
            <header className="rgvx-clean-header">
              <div>
                <p>Secure checkout</p>
                <h1>Complete your order</h1>
                <span>
                  Review your details, choose how to pay, and you&apos;re all set.
                </span>

                <div className="rgvx-header-proof" aria-label="Checkout benefits">
                  <span><ShieldCheck size={15} /> Protected payment</span>
                  <span><Gift size={15} /> Loyalty rewards</span>
                </div>
              </div>
            </header>

            {requiresDirectDetails && (
              <div className="rgvx-zelle-area">
                <div className="rgvx-form-section">
                  <div className="rgvx-block-title">
                    <Mail size={16} />
                    <div>
                      <strong>Contact</strong>
                      <small>
                        {isCardSelected || isOrbitSecureSelected
                          ? "We will send your receipt and order updates here."
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
                        Enter the address where you want your order delivered.
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
                    <label className="rgvx-address-confirmation-check">
                      <input
                        type="checkbox"
                        checked={shippingAddressConfirmed}
                        onChange={(event) => {
                          setShippingAddressConfirmed(event.target.checked);
                          if (event.target.checked) setError("");
                        }}
                      />
                      <span>
                        <strong>Address verified</strong>
                        <small>I confirm that the shipping information above is complete and correct.</small>
                      </span>
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
                    Select a shipping method.
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
                      : freeShippingBenefitUnlocked
                        ? "Free shipping available on eligible methods"
                      : `${formatMoney(amountUntilFreeShipping)} away from free shipping`}
                  </strong>
                </div>

                <div className="rgvx-shipping-option-list">
                  {SHIPPING_METHODS.map((method) => {
                    const active = selectedShippingMethodId === method.id;
                    const methodHasFreeShipping = isFreeShippingUnlocked(method);

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
                            {methodHasFreeShipping && (
                              <small className="rgvx-shipping-free-note">
                                {FREE_SHIPPING_LABEL}
                              </small>
                            )}
                            {method.freeShippingEligible === false && (
                              <small className="rgvx-shipping-exclusion-note">
                                Does not apply for free shipping
                              </small>
                            )}
                          </div>
                        </div>

                        <em>{methodHasFreeShipping ? FREE_SHIPPING_LABEL : formatMoney(method.price)}</em>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="rgvx-form-section rgvx-processing-section">
              <div className="rgvx-block-title">
                <ShieldCheck size={16} />
                <div>
                  <strong>Order processing</strong>
                  <small>Choose the handling speed that works for you.</small>
                </div>
              </div>

              <div className="rgvx-processing-options">
                <div className="rgvx-processing-option is-required">
                  <span className="rgvx-processing-check"><Check size={15} /></span>
                  <span>
                    <strong>Service &amp; Processing</strong>
                    <small>Required for every order</small>
                  </span>
                  <em>3%</em>
                </div>

                <label className={`rgvx-processing-option is-optional ${priorityProcessing ? "active" : ""}`}>
                  <input
                    type="checkbox"
                    checked={priorityProcessing}
                    disabled={loading || Boolean(orbitCardCheckout)}
                    onChange={(event) => {
                      setPriorityProcessing(event.target.checked);
                      setError("");
                      setPaymentNotice("");
                    }}
                  />
                  <span className="rgvx-processing-check"><Check size={15} /></span>
                  <span>
                    <strong>⚡ SKIP THE LINE — RUSH PROCESSING (+5%)</strong>
                    <small>This speeds up processing only. Carrier delivery times are not guaranteed.</small>
                  </span>
                  <em>+5%</em>
                </label>
              </div>
            </div>

            <ComplianceConfirm
              placement="flow"
              researchUseAcknowledged={researchUseAcknowledged}
              termsAccepted={termsAccepted}
              hasError={Boolean(error)}
              onResearchUseChange={(checked) => {
                setResearchUseAcknowledged(checked);
                if (checked) setError("");
              }}
              onTermsChange={(checked) => {
                setTermsAccepted(checked);
                if (checked) setError("");
              }}
            />

            <div className="rgvx-flow-section first rgvx-payment-section">
              <div className="rgvx-section-heading">
                <p>Payment</p>
                <h2>How would you like to pay?</h2>
                <span>{orbitPaymentsAvailable
                  ? ORBIT_EMBEDDED_CHECKOUT_VISIBLE
                    ? "Pay here with ORBIT Payments, by secure eDebit, or with manual Zelle."
                    : "Pay on ORBIT's secure hosted page, by eDebit, or with manual Zelle."
                  : "Pay by secure eDebit or manual Zelle."}</span>
              </div>
              <div className={`rgvx-payment-switch ${availablePaymentMethods.length === 3 ? "has-three" : ""}`} role="radiogroup" aria-label="Payment method">
                {availablePaymentMethods.map((method) => {
                  const Icon = method.icon;
                  const active = selectedPaymentMethodId === method.id;
                  return <button key={method.id} type="button" role="radio" aria-checked={active} disabled={loading || Boolean(orbitCardCheckout)} className={`rgvx-payment-option ${active ? "active" : ""}`} onClick={() => { setSelectedPaymentMethodId(method.id); setEdebitConfirmationOpen(false); setManualOrder(null); setError(""); setPaymentNotice(""); }}>
                    <Icon size={18} /><span><strong>{method.title}</strong><small>{method.description}</small></span><em>{method.badge}</em>
                  </button>;
                })}
              </div>
              {isOrbitSecureSelected && <p className="rgvx-payment-method-note"><CreditCard size={16} /> {ORBIT_EMBEDDED_CHECKOUT_VISIBLE
                ? "Enter your credit or debit card securely without leaving this page."
                : "You will finish securely on pay.orbit, then return here automatically."}</p>}
              {isEdebitSelected && <p className="rgvx-payment-method-note"><Building2 size={16} /> Secure bank payment. You will link your bank after your order is created.</p>}
              {isZelleSelected && <p className="rgvx-payment-method-note"><Building2 size={16} /> Manual bank payment. Instructions appear after your order is placed.</p>}
            </div>

            {isOrbitSecureSelected && ORBIT_EMBEDDED_CHECKOUT_VISIBLE && orbitPaymentsAvailable && (
              <div className="rgvx-orbit-card-panel">
                <OrbitSecureCardPayment
                  ref={orbitSecureCardPaymentRef}
                  enabled={orbitEmbeddedPaymentEnabled}
                  onCreatePayment={createOrbitSecureCardPayment}
                  onReadyChange={setOrbitSecureCardReady}
                  onInteraction={markPaymentActivity}
                />
              </div>
            )}

            {isOrbitSecureSelected && ORBIT_HOSTED_CHECKOUT_VISIBLE && orbitPaymentsAvailable && (
              <div className="rgvx-orbit-card-panel">
                <div className="rgvx-block-title">
                  <Lock size={16} />
                  <div>
                    <strong>Secure ORBIT checkout</strong>
                    <small>Card details stay on ORBIT's Stripe-secured payment page and never pass through RGVPRIME.</small>
                  </div>
                </div>
                <p className="rgvx-payment-method-note"><ShieldCheck size={16} /> Your order is created once. ORBIT confirms payment by signed webhook before WooCommerce marks it paid.</p>
              </div>
            )}

            {isCardSelected && stripePaymentContext && (
              <div className="rgvx-orbit-card-panel">
                <div className="rgvx-block-title">
                  <Lock size={16} />
                  <div>
                    <strong>Secure card details</strong>
                    <small>
                      Eligible wallets appear automatically. Payment details are encrypted.
                    </small>
                  </div>
                </div>

                <Suspense fallback={<p className="rgvx-checkout-state">Loading secure payment form…</p>}>
                  <OrbitCardPayment
                    key={`orbit-card-${paymentSessionVersion}`}
                    ref={orbitCardPaymentRef}
                    context={stripePaymentContext}
                    enabled={cardPaymentEnabled || Boolean(orbitCardCheckout?.isReturn)}
                    onCreatePayment={createOrbitCardPayment}
                    onPreflight={preflightOrbitPayment}
                    onReadyChange={setOrbitCardReady}
                    onPaymentResult={handleOrbitPaymentResult}
                    onInteraction={markPaymentActivity}
                    onBlocked={() => {
                      setError("Complete your contact and shipping details, confirm the shipping address, and accept both required agreements before choosing a fast payment option.");
                      const target = !shippingAddressConfirmed
                        ? document.querySelector(".rgvx-address-confirmation")
                        : document.querySelector(".rgvx-review-confirm-flow");
                      target?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }}
                  />
                </Suspense>
              </div>
            )}

            {(isCardSelected || (isOrbitSecureSelected && ORBIT_HOSTED_CHECKOUT_VISIBLE)) && quoteLoading && <p className="rgvx-checkout-state">Updating secure total and payment methods…</p>}
            {(isCardSelected || (isOrbitSecureSelected && ORBIT_HOSTED_CHECKOUT_VISIBLE)) && quoteError && <p className="rgvx-error">{quoteError}</p>}

            {error && <p className="rgvx-error">{error}</p>}
            {paymentNotice && !error && <p className="rgvx-success">{paymentNotice}</p>}

            <button
              type="button"
              onClick={handleContinuePayment}
              disabled={
                !hasSelectedPaymentMethod ||
                loading ||
                (isOrbitSecureSelected && ORBIT_EMBEDDED_CHECKOUT_VISIBLE && !orbitSecureCardReady) ||
                (isOrbitSecureSelected && ORBIT_HOSTED_CHECKOUT_VISIBLE && !orbitHostedPaymentEnabled) ||
                (isCardSelected && (!stripePaymentContext || !orbitCardReady || quoteLoading))
              }
              className="rgvx-final-button"
            >
              <span>
                <strong>{paymentButtonTitle}</strong>
                <small>{paymentButtonDescription}</small>
              </span>
              <ChevronRight size={20} />
            </button>

            {edebitConfirmationOpen && (
              <div className="rgvx-edebit-confirm-backdrop" role="presentation">
                <section
                  className="rgvx-edebit-confirm"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="rgvx-edebit-confirm-title"
                >
                  <button
                    type="button"
                    className="rgvx-edebit-confirm-close"
                    aria-label="Close bank payment confirmation"
                    disabled={edebitModalBusy}
                    onClick={() => setEdebitConfirmationOpen(false)}
                  >
                    <X size={18} />
                  </button>
                  <span className="rgvx-edebit-confirm-icon"><Building2 size={24} /></span>
                  <p>SECURE BANK PAYMENT</p>
                  <h2 id="rgvx-edebit-confirm-title">
                    {pendingEdebitAttempt ? "You already started a bank payment" : "Ready to connect your bank?"}
                  </h2>
                  <span>
                    {pendingEdebitAttempt
                      ? canResumePendingEdebit
                        ? `Order #${pendingEdebitAttempt.orderNumber || pendingEdebitAttempt.orderId} is still awaiting payment. Continue it to avoid creating a duplicate order.`
                        : `Order #${pendingEdebitAttempt.orderNumber || pendingEdebitAttempt.orderId} belongs to an earlier checkout. We will cancel it before starting this one.`
                      : "Your WooCommerce order will be created and eDebit will open its secure bank-linking flow. The payment is not complete until your bank connection and authorization finish."}
                  </span>
                  <div className="rgvx-edebit-confirm-points">
                    <div><Check size={15} /><span>Finish every eDebit/Yodlee screen before closing the window.</span></div>
                    <div><Check size={15} /><span>No additional attempt starts automatically if you cancel or leave.</span></div>
                    <div><ShieldCheck size={15} /><span>We confirm payment directly with WooCommerce before processing.</span></div>
                  </div>
                  <div className="rgvx-edebit-confirm-actions">
                    {canResumePendingEdebit && (
                      <button type="button" disabled={edebitModalBusy} onClick={resumePendingEdebit}>
                        Continue order #{pendingEdebitAttempt.orderNumber || pendingEdebitAttempt.orderId}
                      </button>
                    )}
                    <button type="button" disabled={edebitModalBusy} onClick={startFreshEdebit}>
                      {edebitModalBusy
                        ? "Preparing secure payment..."
                        : pendingEdebitAttempt
                          ? "Cancel old attempt and start new"
                          : "Create order and continue"}
                    </button>
                    <button type="button" className="secondary" disabled={edebitModalBusy} onClick={() => setEdebitConfirmationOpen(false)}>
                      Go back
                    </button>
                  </div>
                  <small>Having trouble linking your bank? Go back and choose Zelle instead.</small>
                </section>
              </div>
            )}

            <div className="rgvx-checkout-assurance" aria-label="Payment security">
              <Lock size={13} />
              <span>Secure, encrypted checkout</span>
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
              <h2>Order summary</h2>
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

              <div className="rgvx-total-row">
                <span>Service &amp; Processing (3%)</span>
                <strong>{formatMoney(summaryProcessingFee)}</strong>
              </div>

              {summaryPriorityProcessingFee > 0 && (
                <div className="rgvx-total-row">
                  <span>⚡ Rush Processing (+5%)</span>
                  <strong>{formatMoney(summaryPriorityProcessingFee)}</strong>
                </div>
              )}

              {summaryTax > 0 && <div className="rgvx-total-row"><span>Tax</span><strong>{formatMoney(summaryTax)}</strong></div>}

              <div className="rgvx-total-row total">
                <span>{isZelleSelected ? "Due now" : "Total USD"}</span>
                <strong>{formatMoney(summaryTotal)}</strong>
              </div>

              <section className="rgvx-reward-rail" aria-label="Shipping and loyalty progress">
                <div className="rgvx-reward-rail-grid">
                  <div className={`rgvx-reward-line shipping ${freeShippingBenefitUnlocked ? "is-unlocked" : ""}`}>
                    <div className="rgvx-reward-line-head">
                      <span className="rgvx-reward-icon"><Truck size={16} /></span>
                      <div>
                        <strong>Free shipping</strong>
                        <small>{freeShippingBenefitUnlocked ? "Available on eligible methods" : `${formatMoney(amountUntilFreeShipping)} to unlock`}</small>
                      </div>
                      <em>{freeShippingBenefitUnlocked ? "Ready" : `${progressWidth}%`}</em>
                    </div>

                    <div
                      className="rgvx-reward-track"
                      role="progressbar"
                      aria-label="Free shipping progress"
                      aria-valuemin="0"
                      aria-valuemax="100"
                      aria-valuenow={progressWidth}
                    >
                      <span className="shipping-fill" style={{ width: `${progressWidth}%` }} />
                    </div>
                  </div>

                  <div className={`rgvx-reward-line loyalty ${pointsMissingAfterOrder === 0 ? "is-unlocked" : ""}`}>
                    <div className="rgvx-reward-line-head">
                      <span className="rgvx-reward-icon"><Gift size={16} /></span>
                      <div>
                        <strong>{sessionCustomer ? "Loyalty points" : "Earn loyalty points"}</strong>
                        <small>
                          {sessionCustomer
                            ? `${formatPoints(projectedLoyaltyPoints)} after this order`
                            : `${formatPoints(estimatedLoyaltyPoints)} added after checkout`}
                        </small>
                      </div>
                      <em>+{formatPoints(estimatedLoyaltyPoints)}</em>
                    </div>

                    <div
                      className="rgvx-reward-track"
                      role="progressbar"
                      aria-label="Loyalty reward progress after this order"
                      aria-valuemin="0"
                      aria-valuemax="100"
                      aria-valuenow={Math.round(projectedLoyaltyProgress)}
                    >
                      <span className="loyalty-current" style={{ width: `${currentLoyaltyProgress}%` }} />
                      <span
                        className="loyalty-projected"
                        style={{
                          left: `${currentLoyaltyProgress}%`,
                          width: `${Math.max(0, projectedLoyaltyProgress - currentLoyaltyProgress)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </section>

              <section
                className={`rgvx-mini-coupon ${couponStatus !== "idle" ? `is-${couponStatus}` : ""}`}
                aria-label="Discount code"
              >
                <div className="rgvx-mini-coupon-header">
                  <div className="rgvx-mini-coupon-title">
                    <Tag size={12} />
                    <span>Discount code</span>
                  </div>

                  {couponStatus === "valid" && <div className="rgvx-mini-coupon-pill">Applied</div>}
                </div>

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
              </section>
            </div>

            <div className="rgvx-summary-trust" aria-label="Checkout benefits">
              <span><Lock size={14} /> Secure payment and discreet packaging</span>
            </div>

            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
