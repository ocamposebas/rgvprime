export const CHECKOUT_ADDRESS_KEYS = [
  "address1",
  "address2",
  "city",
  "state",
  "postcode",
  "country",
];

function clean(value) {
  return String(value || "").trim();
}

function componentValue(component, short = false) {
  return clean(
    short
      ? component?.shortText || component?.short_name || component?.longText || component?.long_name
      : component?.longText || component?.long_name || component?.shortText || component?.short_name,
  );
}

function findComponent(components, ...types) {
  return (Array.isArray(components) ? components : []).find((component) =>
    types.some((type) => component?.types?.includes(type)),
  );
}

export function normalizeAddress(address = {}) {
  return {
    address1: clean(address.address1),
    address2: clean(address.address2),
    city: clean(address.city),
    state: clean(address.state).toUpperCase(),
    postcode: clean(address.postcode).toUpperCase(),
    country: clean(address.country || "US").toUpperCase(),
  };
}

export function getAddressSignature(address = {}) {
  const normalized = normalizeAddress(address);

  return CHECKOUT_ADDRESS_KEYS.map((key) =>
    normalized[key]
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase(),
  ).join("|");
}

export function addressesMatch(left, right) {
  return getAddressSignature(left) === getAddressSignature(right);
}

export function formatCheckoutAddress(address = {}) {
  const normalized = normalizeAddress(address);
  const locality = [normalized.city, normalized.state, normalized.postcode]
    .filter(Boolean)
    .join(", ")
    .replace(/, ([A-Z]{2}), /, ", $1 ");

  return [normalized.address1, normalized.address2, locality]
    .filter(Boolean)
    .join(" · ");
}

export function parseGooglePlace(place = {}, fallback = {}) {
  const components = Array.isArray(place.addressComponents)
    ? place.addressComponents
    : Array.isArray(place.address_components)
      ? place.address_components
      : [];
  const streetNumber = componentValue(findComponent(components, "street_number"));
  const route = componentValue(findComponent(components, "route"));
  const subpremise = componentValue(findComponent(components, "subpremise"));
  const cityComponent = findComponent(
    components,
    "locality",
    "postal_town",
    "sublocality_level_1",
  );
  const stateComponent = findComponent(components, "administrative_area_level_1");
  const postcodeComponent = findComponent(components, "postal_code");
  const postcodeSuffix = findComponent(components, "postal_code_suffix");
  const countryComponent = findComponent(components, "country");
  const formattedAddress = clean(place.formattedAddress || place.formatted_address);
  const formattedStreet = formattedAddress.split(",")[0] || "";
  const postcode = [
    componentValue(postcodeComponent),
    componentValue(postcodeSuffix),
  ].filter(Boolean).join("-");

  return normalizeAddress({
    ...fallback,
    address1: [streetNumber, route].filter(Boolean).join(" ") || formattedStreet || fallback.address1,
    address2: subpremise || fallback.address2,
    city: componentValue(cityComponent) || fallback.city,
    state: componentValue(stateComponent, true) || fallback.state,
    postcode: postcode || fallback.postcode,
    country: componentValue(countryComponent, true) || fallback.country || "US",
  });
}

export function parseValidatedAddress(result = {}, fallback = {}) {
  const postal = result?.address?.postalAddress || result?.address?.postal_address || {};
  const addressLines = Array.isArray(postal.addressLines)
    ? postal.addressLines
    : Array.isArray(postal.address_lines)
      ? postal.address_lines
      : [];

  return normalizeAddress({
    ...fallback,
    address1: addressLines[0] || fallback.address1,
    address2: addressLines.slice(1).join(", ") || fallback.address2,
    city: postal.locality || fallback.city,
    state: postal.administrativeArea || postal.administrative_area || fallback.state,
    postcode: postal.postalCode || postal.postal_code || fallback.postcode,
    country: postal.regionCode || postal.region_code || fallback.country || "US",
  });
}

export function getLatLngLiteral(location) {
  if (!location) return null;

  const lat = typeof location.lat === "function"
    ? location.lat()
    : Number(location.lat ?? location.latitude);
  const lng = typeof location.lng === "function"
    ? location.lng()
    : Number(location.lng ?? location.longitude);

  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export function getAddressValidationDecision(result = {}, enteredAddress = {}) {
  const verdict = result?.verdict || {};
  const suggestedAddress = parseValidatedAddress(result, enteredAddress);
  const changed = !addressesMatch(enteredAddress, suggestedAddress);
  const incomplete = verdict.addressComplete === false;
  const hasUnconfirmed = verdict.hasUnconfirmedComponents === true;
  const changedByGoogle =
    verdict.hasInferredComponents === true || verdict.hasReplacedComponents === true;
  const nextAction = clean(verdict.possibleNextAction || verdict.possible_next_action).toUpperCase();
  const needsReview =
    changed || incomplete || hasUnconfirmed || changedByGoogle ||
    (nextAction && !nextAction.includes("ACCEPT"));

  return {
    kind: needsReview ? "review" : "verified",
    enteredAddress: normalizeAddress(enteredAddress),
    suggestedAddress,
    formattedAddress: clean(result?.address?.formattedAddress || result?.address?.formatted_address),
    needsReview,
    incomplete,
    hasUnconfirmed,
    changed,
    nextAction,
  };
}
