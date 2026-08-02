export const WELCOME10_FREE_SHIPPING_PROMOTION = Object.freeze({
  code: "WELCOME10",
  startsAt: "2026-08-02T15:59:33.133Z",
  endsAt: "2026-08-04T17:59:33.133Z",
});

export function isWelcome10FreeShippingActive(couponCode, now = Date.now()) {
  const normalizedCode = String(couponCode || "").trim().toUpperCase();
  const currentTime = now instanceof Date ? now.getTime() : Number(now);
  const startsAt = Date.parse(WELCOME10_FREE_SHIPPING_PROMOTION.startsAt);
  const endsAt = Date.parse(WELCOME10_FREE_SHIPPING_PROMOTION.endsAt);

  return (
    normalizedCode === WELCOME10_FREE_SHIPPING_PROMOTION.code &&
    Number.isFinite(currentTime) &&
    currentTime >= startsAt &&
    currentTime < endsAt
  );
}
