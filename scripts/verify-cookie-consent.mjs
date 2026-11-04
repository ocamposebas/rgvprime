import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [layout, banner, tracking, policies, footer] = await Promise.all([
  read("src/layouts/BaseLayout.astro"),
  read("src/components/privacy/CookieConsent.astro"),
  read("src/lib/omnisendCart.js"),
  read("src/pages/policies.astro"),
  read("src/components/footer/SiteFooter.jsx"),
]);

assert.match(layout, /<CookieConsent\s*\/>/, "Cookie consent UI must be mounted globally.");
assert.match(layout, /rgv-cookie-consent-change/, "Consent changes must reach the global script gate.");
assert.match(
  layout,
  /__RGV_COOKIE_CONSENT__\?\.marketing !== true[\s\S]*?window\.omnisend =/,
  "Omnisend must not initialize before marketing consent.",
);

for (const control of [
  "data-cookie-accept",
  "data-cookie-reject",
  "data-cookie-manage",
  "data-cookie-save",
]) {
  assert.ok(banner.includes(control), `Cookie UI is missing ${control}.`);
}
assert.match(banner, /navigator\.globalPrivacyControl === true/, "GPC must be recognized.");
assert.match(banner, /180 \* 24 \* 60 \* 60|consentMaxAge/, "Consent must have a bounded lifetime.");

assert.match(tracking, /function hasMarketingConsent\(\)/, "Tracking needs a consent guard.");
assert.match(
  tracking,
  /trackOmnisendCart[\s\S]*?if \(!canUseOmnisend\(\)[\s\S]*?buildOmnisendCartEvent/,
  "Cart payloads must not be built before consent.",
);
assert.match(
  tracking,
  /identifyOmnisendContact[\s\S]*?!hasMarketingConsent\(\)/,
  "Contact identification must require marketing consent.",
);

for (const section of ['id: "privacy"', 'id: "cookies"', 'id: "accessibility"']) {
  assert.ok(policies.includes(section), `Policies are missing ${section}.`);
}
assert.match(policies, /Global Privacy Control/, "Policies must explain GPC handling.");
assert.match(footer, /data-cookie-preferences/, "Footer must reopen privacy choices.");

console.log("Cookie consent, tracking gate, privacy choices, and policy coverage verified.");
