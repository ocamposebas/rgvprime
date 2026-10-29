const DEFAULT_TIERS = [
  { minimum: 60, quantity: 1 },
  { minimum: 150, quantity: 2 },
];

function finiteNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

export function normalizeMysteryPromotion(payload = {}) {
  const tiers = (Array.isArray(payload?.tiers) ? payload.tiers : DEFAULT_TIERS)
    .map((tier) => ({
      minimum: finiteNonNegative(tier?.minimum),
      quantity: Math.max(0, Math.floor(finiteNonNegative(tier?.quantity))),
    }))
    .filter((tier) => tier.minimum > 0 && tier.quantity > 0)
    .sort((left, right) => left.minimum - right.minimum);

  return {
    active: payload?.active === true,
    available: payload?.available === true,
    inventoryLimit: Math.max(
      0,
      Math.floor(
        finiteNonNegative(payload?.inventory_limit ?? payload?.inventoryLimit),
      ),
    ),
    remaining: Math.max(0, Math.floor(finiteNonNegative(payload?.remaining))),
    productName: String(
      payload?.product_name ||
        payload?.productName ||
        "Mystery Vial Complimentary",
    ).slice(0, 120),
    productSku: String(
      payload?.product_sku || payload?.productSku || "RGV-MYSTERY-VIAL",
    ).slice(0, 80),
    tiers: tiers.length ? tiers : DEFAULT_TIERS,
  };
}

export function getMysteryRewardState(netSubtotal, promotion = {}) {
  const normalized = normalizeMysteryPromotion(promotion);
  const spend = finiteNonNegative(netSubtotal);
  const highestThreshold = Math.max(
    1,
    ...normalized.tiers.map((tier) => tier.minimum),
  );
  const eligibleTier = normalized.tiers
    .filter((tier) => spend + 0.0001 >= tier.minimum)
    .at(-1);
  const eligibleQuantity = eligibleTier?.quantity || 0;
  const quantity =
    normalized.active && normalized.available && normalized.remaining > 0
      ? Math.min(eligibleQuantity, normalized.remaining)
      : 0;
  const nextTier = normalized.tiers.find((tier) => tier.minimum > spend);

  return {
    ...normalized,
    netSubtotal: spend,
    quantity,
    nextThreshold: nextTier?.minimum || null,
    amountToNext: nextTier ? Math.max(0, nextTier.minimum - spend) : 0,
    progress: Math.min(100, Math.max(0, (spend / highestThreshold) * 100)),
    fullyUnlocked:
      quantity > 0 && quantity >= Math.max(...normalized.tiers.map((tier) => tier.quantity)),
  };
}

