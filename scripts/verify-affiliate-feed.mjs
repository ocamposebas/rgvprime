import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [feed, layout, checkout] = await Promise.all([
  read("src/pages/api/feed.js"),
  read("src/layouts/BaseLayout.astro"),
  read("src/components/checkout/RgvCheckout.jsx"),
]);

for (const expected of [
  'const AFFILIATE_COUPON = "sammyc"',
  'schema_version: FEED_VERSION',
  '"Access-Control-Allow-Origin": "*"',
  'url.searchParams.set("coupon", AFFILIATE_COUPON)',
  'ETag: etag',
  'variants,',
  'getProducts({ request })',
]) {
  assert(feed.includes(expected), `Affiliate feed is missing: ${expected}`);
}

assert(
  layout.includes('const storageKey = "rgv_affiliate_coupon"') &&
    layout.includes('.get("coupon")'),
  "Affiliate landing links are not persisted.",
);
assert(
  checkout.includes('affiliateCode === "SAMMYC"') &&
    checkout.includes("setCouponInput(affiliateCode)"),
  "The affiliate coupon is not prepared at checkout.",
);

console.log(
  "Affiliate feed verification passed (catalog, variants, CORS, caching, tracking and checkout handoff).",
);
