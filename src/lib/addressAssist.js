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

function normalizeState(value) {
  return clean(value).replace(/^US-/i, "").toUpperCase();
}

export function normalizeAddress(address = {}) {
  return {
    address1: clean(address.address1),
    address2: clean(address.address2),
    city: clean(address.city),
    state: normalizeState(address.state),
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

export function parseGeoapifySuggestion(result = {}, fallback = {}) {
  const streetAddress = [clean(result.housenumber), clean(result.street)]
    .filter(Boolean)
    .join(" ");

  return normalizeAddress({
    ...fallback,
    address1: streetAddress || clean(result.address_line1) || fallback.address1,
    address2: fallback.address2,
    city:
      clean(result.city) ||
      clean(result.town) ||
      clean(result.village) ||
      clean(result.municipality) ||
      fallback.city,
    state: normalizeState(result.state_code || result.state) || fallback.state,
    postcode: clean(result.postcode) || fallback.postcode,
    country: clean(result.country_code || fallback.country || "US"),
  });
}

export function getLatLngLiteral(location = {}) {
  if (!location) return null;

  const lat = Number(location.lat ?? location.latitude);
  const lng = Number(location.lon ?? location.lng ?? location.longitude);

  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export function getGeoapifyValidationDecision(result = {}, enteredAddress = {}) {
  const suggestedAddress = parseGeoapifySuggestion(result, enteredAddress);
  const confidence = Number(result?.rank?.confidence || 0);
  const matchType = clean(result?.rank?.match_type);
  const changed = !addressesMatch(enteredAddress, suggestedAddress);
  const incomplete = !(
    suggestedAddress.address1 &&
    suggestedAddress.city &&
    suggestedAddress.state &&
    suggestedAddress.postcode &&
    clean(result.housenumber)
  );
  const lowConfidence = confidence < 0.9;
  const needsReview = changed || incomplete || lowConfidence;

  let message = "The address matches a complete, high-confidence result.";
  if (incomplete) {
    message = "We found the area, but the building number or another delivery detail may be missing.";
  } else if (lowConfidence) {
    message = "This is the closest match we found. Review it before choosing which version to use.";
  } else if (changed) {
    message = "We found a standardized version that may be easier for the carrier to locate.";
  }

  return {
    kind: needsReview ? "review" : "verified",
    enteredAddress: normalizeAddress(enteredAddress),
    suggestedAddress,
    formattedAddress: clean(result.formatted) || formatCheckoutAddress(suggestedAddress),
    needsReview,
    incomplete,
    lowConfidence,
    changed,
    confidence,
    matchType,
    message,
  };
}

export function buildOpenStreetMapUrls(location) {
  const point = getLatLngLiteral(location);
  if (!point) return { embedUrl: "", openUrl: "" };

  const offset = 0.006;
  const bbox = [
    point.lng - offset,
    point.lat - offset,
    point.lng + offset,
    point.lat + offset,
  ].join(",");
  const embedParams = new URLSearchParams({
    bbox,
    layer: "mapnik",
    marker: `${point.lat},${point.lng}`,
  });

  return {
    embedUrl: `https://www.openstreetmap.org/export/embed.html?${embedParams.toString()}`,
    openUrl: `https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lng}#map=17/${point.lat}/${point.lng}`,
  };
}
