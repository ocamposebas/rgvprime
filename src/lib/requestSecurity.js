import { createHash } from "node:crypto";

const MAX_BUCKETS = 5000;
const CLEANUP_INTERVAL_MS = 60_000;

const globalSecurityStore = globalThis;

const buckets =
  globalSecurityStore.__rgvRequestRateBuckets || new Map();

globalSecurityStore.__rgvRequestRateBuckets = buckets;

let lastCleanupAt = 0;

function getClientIp(request) {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";

  return String(
    request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-real-ip") ||
      forwardedFor.split(",")[0] ||
      "unknown",
  )
    .trim()
    .slice(0, 80);
}

function hashIdentifier(value) {
  return createHash("sha256")
    .update(String(value || "").trim().toLowerCase())
    .digest("hex")
    .slice(0, 24);
}

function cleanup(now) {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS && buckets.size < MAX_BUCKETS) {
    return;
  }

  lastCleanupAt = now;

  for (const [key, bucket] of buckets) {
    if (!bucket || bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }

  while (buckets.size >= MAX_BUCKETS) {
    const oldestKey = buckets.keys().next().value;
    if (!oldestKey) break;
    buckets.delete(oldestKey);
  }
}

export function checkRateLimit(
  request,
  { namespace, limit, windowMs, identifier = "" },
) {
  const now = Date.now();
  cleanup(now);

  const key = `${namespace}:${hashIdentifier(
    `${getClientIp(request)}:${identifier}`,
  )}`;

  const current = buckets.get(key);
  const bucket =
    current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + windowMs };

  if (bucket.count >= limit) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  buckets.delete(key);
  buckets.set(key, bucket);

  return {
    allowed: true,
    retryAfter: 0,
  };
}

export function isRequestBodyTooLarge(request, maxBytes = 64 * 1024) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  return Number.isFinite(contentLength) && contentLength > maxBytes;
}

export function requestSecurityResponse(message, status, retryAfter = 0) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };

  if (retryAfter > 0) {
    headers["Retry-After"] = String(retryAfter);
  }

  return new Response(
    JSON.stringify({
      success: false,
      message,
    }),
    { status, headers },
  );
}
