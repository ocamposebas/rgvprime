const ALWAYS_VISIBLE_ACCOUNT_ORDER_STATUSES = new Set([
  "processing",
  "completed",
]);
const ZELLE_PAYMENT_METHODS = new Set(["zelle"]);
const ZELLE_PAYMENT_SOURCES = new Set(["zelle", "rgv_custom_checkout_zelle"]);

function normalizeValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

function getOrderMetaValue(order, key) {
  if (!Array.isArray(order?.meta_data)) return "";

  const entry = [...order.meta_data]
    .reverse()
    .find((item) => normalizeValue(item?.key) === key);

  return entry?.value ?? "";
}

export function normalizeAccountOrderStatus(status) {
  return normalizeValue(status)
    .replace(/^wc[-_]/, "")
    .replace(/[\s_]+/g, "-");
}

export function isZelleAccountOrder(order = {}) {
  if (order?.is_zelle === true || order?.isZelle === true) return true;

  const paymentDetails = order?.payment_details || order?.paymentDetails || {};
  const zelleReceipt = order?.zelle_receipt || order?.zelleReceipt || {};
  const paymentMethods = [
    order?.payment_method,
    order?.paymentMethod,
    paymentDetails?.id,
    paymentDetails?.method,
  ];
  const paymentTitles = [
    order?.payment_method_title,
    order?.paymentMethodTitle,
    paymentDetails?.title,
  ];
  const paymentSources = [
    order?.payment_source,
    order?.paymentSource,
    getOrderMetaValue(order, "_rgv_payment_source"),
  ];

  if (
    paymentMethods.some((value) =>
      ZELLE_PAYMENT_METHODS.has(normalizeValue(value))
    ) ||
    paymentTitles.some((value) => normalizeValue(value) === "zelle") ||
    paymentSources.some((value) =>
      ZELLE_PAYMENT_SOURCES.has(normalizeValue(value))
    )
  ) {
    return true;
  }

  if (
    normalizeValue(getOrderMetaValue(order, "_rgv_manual_zelle_order")) ===
    "yes"
  ) {
    return true;
  }

  return Boolean(
    order?.zelle_payment_reference ||
      order?.zellePaymentReference ||
      zelleReceipt?.payment_reference ||
      zelleReceipt?.paymentReference ||
      getOrderMetaValue(order, "_rgv_zelle_payment_reference")
  );
}

export function isVisibleAccountOrder(order) {
  if (!order || typeof order !== "object") return false;

  const status = normalizeAccountOrderStatus(order.status);

  if (ALWAYS_VISIBLE_ACCOUNT_ORDER_STATUSES.has(status)) return true;

  return status === "on-hold" && isZelleAccountOrder(order);
}

export function filterVisibleAccountOrders(orders) {
  return Array.isArray(orders) ? orders.filter(isVisibleAccountOrder) : [];
}
