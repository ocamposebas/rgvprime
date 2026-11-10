import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildOpenStreetMapUrls,
  getGeoapifyValidationDecision,
  getLatLngLiteral,
  parseGeoapifySuggestion,
} from "../src/lib/addressAssist.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const geoapifyResult = {
  place_id: "51f2-example",
  housenumber: "1600",
  street: "Amphitheatre Parkway",
  city: "Mountain View",
  state: "California",
  state_code: "CA",
  postcode: "94043",
  country_code: "us",
  formatted: "1600 Amphitheatre Parkway, Mountain View, CA 94043, United States",
  lat: 37.422,
  lon: -122.084,
  rank: {
    confidence: 0.98,
    match_type: "full_match",
  },
};

const parsedSuggestion = parseGeoapifySuggestion(geoapifyResult);
assert.deepEqual(parsedSuggestion, {
  address1: "1600 Amphitheatre Parkway",
  address2: "",
  city: "Mountain View",
  state: "CA",
  postcode: "94043",
  country: "US",
});

assert.deepEqual(getLatLngLiteral(geoapifyResult), {
  lat: 37.422,
  lng: -122.084,
});
assert.equal(getLatLngLiteral(null), null);

const normalizedDecision = getGeoapifyValidationDecision(
  geoapifyResult,
  parsedSuggestion,
);
assert.equal(normalizedDecision.kind, "verified");
assert.equal(normalizedDecision.needsReview, false);

const correctionDecision = getGeoapifyValidationDecision(
  {
    ...geoapifyResult,
    street: "Amphitheatre Pkwy",
    formatted: "1600 Amphitheatre Pkwy, Mountain View, CA 94043, United States",
  },
  parsedSuggestion,
);
assert.equal(correctionDecision.kind, "review");
assert.equal(correctionDecision.suggestedAddress.address1, "1600 Amphitheatre Pkwy");

const mapUrls = buildOpenStreetMapUrls(geoapifyResult);
assert(mapUrls.embedUrl.startsWith("https://www.openstreetmap.org/export/embed.html?"));
assert(mapUrls.embedUrl.includes("marker=37.422%2C-122.084"));
assert(mapUrls.openUrl.includes("#map=17/37.422/-122.084"));

const [component, checkout, envExample, readme, dockerfile] = await Promise.all([
  read("src/components/checkout/AddressAssist.jsx"),
  read("src/components/checkout/RgvCheckout.jsx"),
  read(".env.example"),
  read("README.md"),
  read("Dockerfile"),
]);

for (const required of [
  "api.geoapify.com/v1/geocode/autocomplete",
  "PUBLIC_GEOAPIFY_API_KEY",
  "Use recommended",
  "Keep my address",
  "Powered by",
  "OpenStreetMap preview",
  "Manual address entry still works",
  "selectTypedAddressWithKeyboard",
  "event.key === \"Enter\"",
  "event.key === \"Home\"",
  "event.key === \"End\"",
  "enterKeyHint=\"search\"",
  "press Enter to use the best match",
]) {
  assert(component.includes(required), `Address assistance is missing: ${required}`);
}

assert(!component.includes("google.maps"), "Google Maps must not be loaded by checkout");
assert(
  component.includes('value={String(form.address1 || "")}'),
  "The address input must preserve spaces exactly as the customer types them",
);
assert(
  !component.includes("value={address.address1}"),
  "The controlled address input must not render the trimmed normalized value",
);
assert(checkout.includes("<AddressAssist"), "Checkout must render the address assistance component");
assert(checkout.includes("setShippingAddressConfirmed(false)"), "Address edits must clear final confirmation");
assert(envExample.includes("PUBLIC_GEOAPIFY_API_KEY="), "Geoapify browser key must be documented");
assert(!envExample.includes("PUBLIC_GOOGLE_MAPS_API_KEY="), "Paid Google Maps key should be removed");
assert(
  dockerfile.includes("ARG PUBLIC_GEOAPIFY_API_KEY"),
  "The Docker build must accept the public Geoapify key from Coolify",
);
assert(
  dockerfile.includes("ENV PUBLIC_GEOAPIFY_API_KEY=${PUBLIC_GEOAPIFY_API_KEY}"),
  "The Geoapify key must be available while Astro builds the browser bundle",
);
assert(readme.includes("3,000 credits"), "Free daily allowance must be documented");
assert(readme.includes("does not require a credit card"), "No-card setup must be documented");

console.log("Free Geoapify suggestions, correction review, OpenStreetMap preview, and manual fallback verified.");
