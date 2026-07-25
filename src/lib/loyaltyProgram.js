export const LOYALTY_POINTS_PER_DOLLAR = 1;
export const LOYALTY_UNLOCK_POINTS = 1000;
export const LOYALTY_REWARD_CREDIT = 25;

export function calculateLoyaltyPoints(amount, quantity = 1) {
  const cleanAmount = Number(amount || 0);
  const cleanQuantity = Math.max(1, Number(quantity || 1));

  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) return 0;

  return Math.max(
    0,
    Math.floor(cleanAmount * cleanQuantity * LOYALTY_POINTS_PER_DOLLAR),
  );
}

export function getProductLoyaltyPoints(product = {}, quantity = 1) {
  const price =
    product?.price ?? product?.sale_price ?? product?.regular_price ?? 0;

  return calculateLoyaltyPoints(price, quantity);
}

export function formatPoints(points) {
  return Math.max(0, Number(points || 0)).toLocaleString("en-US");
}
