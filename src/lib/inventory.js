export function getStockQuantity(product = {}) {
  const rawQuantity = product?.stock_quantity;

  if (rawQuantity === null || rawQuantity === undefined || rawQuantity === "") {
    return null;
  }

  const quantity = Number(rawQuantity);
  return Number.isFinite(quantity) ? Math.max(0, quantity) : null;
}

export function allowsBackorders(product = {}) {
  return product?.backorders_allowed === true;
}

export function isProductAvailable(product = {}, requestedQuantity = 1) {
  if (!product || product.purchasable === false) return false;
  if (allowsBackorders(product)) return true;
  if (product.stock_status !== "instock") return false;

  const stockQuantity = getStockQuantity(product);
  const requested = Math.max(1, Number(requestedQuantity) || 1);

  return stockQuantity === null || stockQuantity >= requested;
}

export function getMaximumPurchasableQuantity(product = {}, fallback = 99) {
  if (allowsBackorders(product)) return fallback;

  const stockQuantity = getStockQuantity(product);
  return stockQuantity === null ? fallback : stockQuantity;
}
