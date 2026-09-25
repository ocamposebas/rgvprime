import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  filterVisibleAccountOrders,
  isVisibleAccountOrder,
  isZelleAccountOrder,
  normalizeAccountOrderStatus,
} from "../src/lib/accountOrderVisibility.js";

assert.equal(normalizeAccountOrderStatus(" WC-Processing "), "processing");
assert.equal(normalizeAccountOrderStatus("on_hold"), "on-hold");
assert.equal(normalizeAccountOrderStatus("On Hold"), "on-hold");
assert.equal(normalizeAccountOrderStatus("WC_On_Hold"), "on-hold");

assert.equal(isVisibleAccountOrder(null), false);
assert.equal(isVisibleAccountOrder({}), false);
assert.equal(isVisibleAccountOrder({ status: "processing" }), true);
assert.equal(isVisibleAccountOrder({ status: "completed" }), true);
assert.equal(isVisibleAccountOrder({ status: "WC-Completed" }), true);
assert.equal(
  isVisibleAccountOrder({ status: "pending", payment_method: "zelle" }),
  false,
);
assert.equal(
  isVisibleAccountOrder({ status: "pending", payment_method: "psc" }),
  false,
);
assert.equal(
  isVisibleAccountOrder({ status: "on-hold", payment_method: "zelle" }),
  true,
);
assert.equal(
  isVisibleAccountOrder({ status: "WC_On_Hold", payment_method: "zelle" }),
  true,
);
assert.equal(
  isVisibleAccountOrder({ status: "on-hold", payment_method: "psc" }),
  false,
);
assert.equal(
  isVisibleAccountOrder({ status: "on-hold", payment_source: "not_zelle" }),
  false,
);
for (const paymentMethod of [
  "rgv_orbit_card",
  "orbit_card",
  "edd_draft_yodlee_gateway",
]) {
  assert.equal(
    isVisibleAccountOrder({ status: "on-hold", payment_method: paymentMethod }),
    false,
  );
}
assert.equal(
  isVisibleAccountOrder({
    status: "on-hold",
    payment_method: "psc",
    payment_reference: "pi_not_a_zelle_reference",
    zelle_receipt: {},
  }),
  false,
);
assert.equal(
  isVisibleAccountOrder({ status: "failed", payment_method: "zelle" }),
  false,
);
assert.equal(isVisibleAccountOrder({ status: "refunded" }), false);
assert.equal(isVisibleAccountOrder({ status: "cancelled" }), false);
assert.equal(isVisibleAccountOrder({ status: "unknown" }), false);

assert.equal(
  isZelleAccountOrder({
    status: "on-hold",
    meta_data: [{ key: "_rgv_manual_zelle_order", value: "yes" }],
  }),
  true,
);
assert.equal(
  isZelleAccountOrder({
    status: "on-hold",
    zelleReceipt: { paymentReference: "RGV-123" },
  }),
  true,
);
assert.deepEqual(filterVisibleAccountOrders(null), []);
assert.equal(
  isZelleAccountOrder({
    status: "on-hold",
    payment_details: { title: "Zelle" },
  }),
  true,
);
assert.equal(
  isZelleAccountOrder({
    status: "on-hold",
    payment_source: "rgv_custom_checkout_zelle",
  }),
  true,
);

const visibleOrders = filterVisibleAccountOrders([
  { id: 1, status: "pending", payment_method: "psc" },
  { id: 2, status: "processing", payment_method: "psc" },
  { id: 3, status: "completed", payment_method: "zelle" },
  { id: 4, status: "on-hold", payment_method: "zelle" },
  { id: 5, status: "on-hold", payment_method: "psc" },
  { id: 6, status: "cancelled", payment_method: "zelle" },
]);

assert.deepEqual(
  visibleOrders.map((order) => order.id),
  [2, 3, 4],
);

const wiringFiles = {
  login: await readFile(
    new URL("../src/pages/api/account/login.js", import.meta.url),
    "utf8",
  ),
  register: await readFile(
    new URL("../src/pages/api/account/register.js", import.meta.url),
    "utf8",
  ),
  me: await readFile(
    new URL("../src/pages/api/account/me.js", import.meta.url),
    "utf8",
  ),
  accountPortal: await readFile(
    new URL("../src/components/account/AccountPortal.jsx", import.meta.url),
    "utf8",
  ),
};

assert.match(
  wiringFiles.login,
  /orders:\s*filterVisibleAccountOrders\(data\.orders\)/,
);
assert.match(
  wiringFiles.register,
  /orders:\s*filterVisibleAccountOrders\(data\.orders\)/,
);
assert.ok(
  wiringFiles.me.indexOf("filterVisibleAccountOrders(mergedOrders)") >
    wiringFiles.me.indexOf("cardWalletOrders.forEach"),
  "The account session must filter after portal and Card/Wallet orders are merged.",
);
assert.match(wiringFiles.me, /orders:\s*visibleOrders/);
assert.match(
  wiringFiles.accountPortal,
  /const visibleOrders = useMemo\([\s\S]*filterVisibleAccountOrders\(orders\)/,
);

console.log("Account order visibility checks passed.");
