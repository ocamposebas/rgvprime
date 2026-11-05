export const STANDARD_FREE_SHIPPING_MINIMUM = 200;

// Sunday, November 8, 2026 at 11:00 p.m. in America/Bogota (UTC-05:00).
export const FREE_SHIPPING_PROMOTION_ENDS_AT = "2026-11-09T04:00:00.000Z";

export function isFreeShippingPromotionActive(now = Date.now()) {
  const timestamp = now instanceof Date ? now.getTime() : Number(new Date(now));
  const endsAt = Date.parse(FREE_SHIPPING_PROMOTION_ENDS_AT);

  return Number.isFinite(timestamp) && timestamp < endsAt;
}

export function getFreeShippingPromotionPayload(now = Date.now()) {
  if (!isFreeShippingPromotionActive(now)) return null;

  const timestamp = now instanceof Date ? now.getTime() : Number(new Date(now));
  const endsAt = Date.parse(FREE_SHIPPING_PROMOTION_ENDS_AT);

  return {
    active: true,
    status: "active",
    scope: "storewide",
    product_id: 0,
    product_name: "",
    discount_percent: 0,
    eyebrow: "FREE STANDARD SHIPPING",
    headline: "Free shipping on every order — no minimum. Ends Sunday at 11 PM.",
    cta_label: "SHOP NOW",
    cta_url: "/shop",
    show_countdown: true,
    starts_at: null,
    ends_at: FREE_SHIPPING_PROMOTION_ENDS_AT,
    server_time: new Date(timestamp).toISOString(),
    remaining_seconds: Math.max(0, Math.floor((endsAt - timestamp) / 1000)),
  };
}
