import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hasRequiredAcknowledgements } from "../src/lib/complianceRules.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [ageGate, cart, checkout, proxy, middleware, zelle, orbit] = await Promise.all([
  read("src/components/agegate/AgeGate.jsx"),
  read("src/components/cart/CartContext.jsx"),
  read("src/components/checkout/RgvCheckout.jsx"),
  read("src/pages/api/checkout/[action].js"),
  read("src/middleware.ts"),
  read("wordpress-plugin/rgv-zelle-checkout/rgv-zelle-checkout.php"),
  read("wordpress-plugin/orbit-relay/includes/class-orbit-relay-card-checkout.php"),
]);

assert.equal(hasRequiredAcknowledgements({ ageConfirmed: true, researchUseAcknowledged: true, termsAccepted: true }), true);
assert.equal(hasRequiredAcknowledgements({ ageConfirmed: false, researchUseAcknowledged: true, termsAccepted: true }), false);
assert.equal(hasRequiredAcknowledgements({ ageConfirmed: true, researchUseAcknowledged: false, termsAccepted: true }), false);
assert.equal(hasRequiredAcknowledgements({ ageConfirmed: true, researchUseAcknowledged: true, termsAccepted: false }), false);

assert(ageGate.includes("useState(false)"), "confirmations must start unchecked");
assert(!ageGate.includes("Continue as guest"), "checkout access must require an account session");
assert(!ageGate.includes("rgv_member_access_until"), "a stale localStorage value must not replace a live account session");
for (const label of ["21 years of age or older", "Research Use Only policy", "Terms &amp; Conditions"]) {
  assert(ageGate.includes(label), `entry gate is missing: ${label}`);
}

assert(!cart.includes("hasApprovedComplianceSession"), "cart and add-to-cart must not perform their own session blocking");
assert(middleware.includes("requireApprovedSession"), "checkout document must require a live approved account session");
assert(proxy.includes("requireApprovedSession(context)"), "order creation must require a live approved account session");
assert(proxy.includes("hasRequiredAcknowledgements(body)"), "final order must reject missing acknowledgements");

const exactCertification = "I certify that I am 21 years of age or older and that all products in this order are";
assert(checkout.includes(exactCertification), "final checkout certification text is missing");
assert(checkout.includes("researchUseAcknowledged={researchUseAcknowledged}"), "RUO checkbox must be present at final checkout");
assert(checkout.includes("termsAccepted={termsAccepted}"), "Terms checkbox must be separate at final checkout");
assert(checkout.includes("/api/checkout/card-order") && checkout.includes("/api/checkout/zelle-order"), "orders must use protected server routes");
assert(!checkout.includes('<option value="PR">'), "Puerto Rico must not be selectable as a checkout country");
assert(!checkout.includes('["PR", "Puerto Rico"]'), "Puerto Rico must not be selectable as a checkout state");
assert(proxy.includes('country === "PR" || state === "PR"'), "the checkout proxy must reject Puerto Rico addresses");
assert(zelle.includes("$country === 'PR' || $state === 'PR'"), "Zelle checkout must reject Puerto Rico addresses");

for (const backend of [zelle, orbit]) {
  assert(backend.includes("x-rgv-compliance-secret"), "WordPress must reject calls outside the protected storefront proxy");
  for (const key of [
    "_rgv_compliance_order_id",
    "_rgv_compliance_policy_version",
    "_rgv_compliance_final_accepted_at_utc",
    "_rgv_compliance_user_id",
    "_rgv_compliance_user_email",
    "_rgv_compliance_ip",
    "_rgv_research_use_only_accepted",
    "_rgv_terms_accepted",
  ]) assert(backend.includes(key), `order audit metadata is missing: ${key}`);
  assert(backend.includes("_rgv_manual_misuse_review_required"), "misuse signals must trigger manual review");
  assert(backend.includes("Cancel the order"), "manual review must include cancellation guidance");
}

console.log("Compliance control verification passed (entry, cart, checkout, audit, and misuse review). ");
