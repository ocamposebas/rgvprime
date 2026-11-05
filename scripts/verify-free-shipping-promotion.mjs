import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  FREE_SHIPPING_PROMOTION_ENDS_AT,
  getFreeShippingPromotionPayload,
  isFreeShippingPromotionActive,
} from "../src/lib/freeShippingPromotion.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

assert.equal(FREE_SHIPPING_PROMOTION_ENDS_AT, "2026-11-09T04:00:00.000Z");
assert.equal(isFreeShippingPromotionActive("2026-11-09T03:59:59.999Z"), true);
assert.equal(isFreeShippingPromotionActive("2026-11-09T04:00:00.000Z"), false);
assert.match(
  getFreeShippingPromotionPayload("2026-11-08T12:00:00.000Z").headline,
  /no minimum/i,
);
assert.equal(getFreeShippingPromotionPayload("2026-11-09T04:00:00.000Z"), null);

const [checkout, cardWallet, promotionApi, zelle, edebit, orbitCard, orbitRelay] = await Promise.all([
  read("src/components/checkout/RgvCheckout.jsx"),
  read("src/lib/cardWalletCheckout.js"),
  read("src/pages/api/promotion.js"),
  read("wordpress-plugin/rgv-zelle-checkout/rgv-zelle-checkout.php"),
  read("wordpress-plugin/rgvprime-edebit-order-endpoint/rgvprime-edebit-order-endpoint.php"),
  read("wordpress-plugin/rgv-orbit-card-checkout/rgv-orbit-card-checkout.php"),
  read("wordpress-plugin/orbit-relay/includes/class-orbit-relay-card-checkout.php"),
]);

assert.match(checkout, /freeShippingPromotionActive \|\|\s*freeShippingQualifiedBySubtotal/);
assert.match(checkout, /Free standard shipping — no minimum through Sunday at 11 PM/);
assert.match(checkout, /`\$\{methodLabel\} - \$\{FREE_SHIPPING_LABEL\}`/);
assert.match(cardWallet, /freeShippingPromotionActive \|\|\s*subtotal >= FREE_SHIPPING_MINIMUM/);
assert.match(cardWallet, /method_id: selectedShippingMethodId/);
assert.match(cardWallet, /`\$\{method\.title\} - Free Shipping`/);
assert.doesNotMatch(cardWallet, /method_id: freeShipping \? "free_shipping"/);
assert.match(promotionApi, /getFreeShippingPromotionPayload/);

for (const source of [zelle, edebit, orbitCard, orbitRelay]) {
  assert.match(source, /2026-11-09T04:00:00Z/);
  assert.match(source, /is_free_shipping_promotion_active/);
}

for (const source of [zelle, edebit]) {
  assert.match(source, / - Free Shipping/);
  assert.doesNotMatch(source, /'id'\s*=>\s*'free_shipping'/);
}

for (const source of [orbitCard, orbitRelay]) {
  assert.match(source, /Free Shipping \(Limited-Time Promotion\)/);
}

assert.match(edebit, /rgvprime_edebit_shipping_rates/);
assert.match(edebit, /\$order->get_subtotal\(\)/);
assert.match(edebit, /\$shipping_item->set_total\(\$shipping_total\)/);

console.log(
  "Free-shipping promotion verification passed (no minimum, automatic cutoff, banner, storefront, and WordPress checkout paths).",
);
