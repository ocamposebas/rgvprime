import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  addressesMatch,
  getAddressValidationDecision,
  getLatLngLiteral,
  parseGooglePlace,
} from "../src/lib/addressAssist.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const parsedPlace = parseGooglePlace({
  formattedAddress: "1600 Amphitheatre Parkway, Mountain View, CA 94043, USA",
  addressComponents: [
    { longText: "1600", shortText: "1600", types: ["street_number"] },
    { longText: "Amphitheatre Parkway", shortText: "Amphitheatre Pkwy", types: ["route"] },
    { longText: "Mountain View", shortText: "Mountain View", types: ["locality"] },
    { longText: "California", shortText: "CA", types: ["administrative_area_level_1"] },
    { longText: "94043", shortText: "94043", types: ["postal_code"] },
    { longText: "United States", shortText: "US", types: ["country"] },
  ],
});

assert.deepEqual(parsedPlace, {
  address1: "1600 Amphitheatre Parkway",
  address2: "",
  city: "Mountain View",
  state: "CA",
  postcode: "94043",
  country: "US",
});
assert.equal(
  addressesMatch(
    parsedPlace,
    { ...parsedPlace, address1: "1600 amphitheatre pkwy." },
  ),
  false,
  "Meaningfully different street text should remain reviewable",
);
assert.deepEqual(getLatLngLiteral({ latitude: 37.422, longitude: -122.084 }), {
  lat: 37.422,
  lng: -122.084,
});

const validationDecision = getAddressValidationDecision({
  verdict: {
    addressComplete: true,
    hasUnconfirmedComponents: false,
    hasInferredComponents: false,
    hasReplacedComponents: true,
    possibleNextAction: "CONFIRM",
  },
  address: {
    formattedAddress: "1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
    postalAddress: {
      regionCode: "US",
      administrativeArea: "CA",
      locality: "Mountain View",
      postalCode: "94043",
      addressLines: ["1600 Amphitheatre Pkwy"],
    },
  },
}, parsedPlace);

assert.equal(validationDecision.kind, "review");
assert.equal(validationDecision.suggestedAddress.address1, "1600 Amphitheatre Pkwy");

const [component, checkout, envExample, readme] = await Promise.all([
  read("src/components/checkout/AddressAssist.jsx"),
  read("src/components/checkout/RgvCheckout.jsx"),
  read(".env.example"),
  read("README.md"),
]);

for (const required of [
  "AutocompleteSuggestion.fetchAutocompleteSuggestions",
  "AutocompleteSessionToken",
  "AddressValidation.fetchAddressValidation",
  'maps.importLibrary("maps")',
  "Keep my address",
  "Powered by Google",
]) {
  assert(component.includes(required), `Address assistance is missing: ${required}`);
}

assert(checkout.includes("<AddressAssist"), "Checkout must render the address assistance component");
assert(checkout.includes("setShippingAddressConfirmed(false)"), "Address edits must clear final confirmation");
assert(envExample.includes("PUBLIC_GOOGLE_MAPS_API_KEY="), "Maps browser key must be documented");
assert(readme.includes("Places API (New)"), "Google Cloud setup must document the Places API");
assert(readme.includes("Address Validation API"), "Google Cloud setup must document address validation");

console.log("Checkout address suggestions, correction review, map preview, and manual fallback verified.");
