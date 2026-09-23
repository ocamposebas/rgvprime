import { createHash } from "node:crypto";

// Permanent, exact-match denylist. Values are SHA-256 digests so customer
// identifiers are not stored in plaintext in the repository.
const BLOCKED_IDENTIFIER_DIGESTS = new Set([
  "038f89166798ef3c27382fd5c1e09b6a235cbbd85614163fc09b42e9c0214324",
  "4ceb911fd5081c1c65555087848a0a881ef788b7b1cb215f4f5530c3c7911dab",
]);
const BLOCKED_IP_DIGESTS = new Set([
  "840f304b043e6569dd4eaa1653810d5b83fb71e8e54710679792545a4e5279af",
]);
const BLOCKED_CUSTOMER_IDS = new Set([926]);
const MAX_JSON_INSPECTION_BYTES = 512 * 1024;
const MAX_INSPECTED_VALUES = 400;

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeIdentifier(value) {
  return String(value || "").trim().toLowerCase();
}

function isBlockedIdentifier(value) {
  const normalized = normalizeIdentifier(value);
  return Boolean(normalized && BLOCKED_IDENTIFIER_DIGESTS.has(digest(normalized)));
}

function getClientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";

  return String(
    request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-real-ip") ||
      forwarded.split(",")[0] ||
      "",
  )
    .trim()
    .toLowerCase()
    .slice(0, 80);
}

function isBlockedIp(request) {
  const ip = getClientIp(request);
  return Boolean(ip && BLOCKED_IP_DIGESTS.has(digest(ip)));
}

function decodeComplianceIdentity(cookies) {
  try {
    const token = String(cookies.get("rgv_compliance_session")?.value || "");
    const [encoded] = token.split(".");
    if (!encoded) return null;

    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));

    return {
      customerId: Number(payload?.userId || 0),
      email: normalizeIdentifier(payload?.email),
    };
  } catch {
    return null;
  }
}

function containsBlockedIdentifier(value) {
  const pending = [value];
  const visited = new Set();
  let inspected = 0;

  while (pending.length && inspected < MAX_INSPECTED_VALUES) {
    const current = pending.pop();
    inspected += 1;

    if (typeof current === "string") {
      if (isBlockedIdentifier(current)) return true;
      continue;
    }

    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);

    if (Array.isArray(current)) {
      pending.push(...current.slice(0, MAX_INSPECTED_VALUES - inspected));
      continue;
    }

    pending.push(...Object.values(current).slice(0, MAX_INSPECTED_VALUES - inspected));
  }

  return false;
}

async function requestContainsBlockedIdentifier(request) {
  if (!["POST", "PUT", "PATCH"].includes(request.method.toUpperCase())) return false;

  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return false;

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_JSON_INSPECTION_BYTES) return false;

  try {
    return containsBlockedIdentifier(await request.clone().json());
  } catch {
    return false;
  }
}

export async function isFraudBlockedRequest({ request, cookies }) {
  if (isBlockedIp(request)) return true;

  const complianceIdentity = decodeComplianceIdentity(cookies);
  if (
    complianceIdentity &&
    (BLOCKED_CUSTOMER_IDS.has(complianceIdentity.customerId) ||
      isBlockedIdentifier(complianceIdentity.email))
  ) {
    return true;
  }

  return requestContainsBlockedIdentifier(request);
}

