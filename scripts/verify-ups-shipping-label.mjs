import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const sources = await Promise.all([
  read("src/components/checkout/RgvCheckout.jsx"),
  read("src/lib/cardWalletCheckout.js"),
  read("wordpress-plugin/rgv-zelle-checkout/rgv-zelle-checkout.php"),
  read("wordpress-plugin/orbit-relay/includes/class-orbit-relay-card-checkout.php"),
  read("wordpress-plugin/rgv-orbit-card-checkout/rgv-orbit-card-checkout.php"),
]);

for (const source of sources) {
  assert(source.includes("UPS 45"), "The $45 shipping option must be named UPS 45");
  assert(!source.includes("UPS Expedited Shipping"), "The old expedited label must be removed");
}

console.log("UPS shipping label verification passed (the $45 order shipping line is named UPS 45 in every checkout path).");
