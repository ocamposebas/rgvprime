import { createHmac, timingSafeEqual } from "node:crypto";
import {
  PORTAL_COOKIE,
  getCookieOptions,
  portalRequest,
} from "./portalApi";
import {
  COMPLIANCE_POLICY_VERSION,
  COMPLIANCE_TEXT_VERSION,
  hasRequiredAcknowledgements,
} from "./complianceRules";

export {
  COMPLIANCE_POLICY_VERSION,
  COMPLIANCE_TEXT_VERSION,
  hasRequiredAcknowledgements,
};

export const COMPLIANCE_COOKIE = "rgv_compliance_session";

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function signingSecret() {
  const secret = String(
    import.meta.env.COMPLIANCE_SIGNING_SECRET || import.meta.env.PORTAL_API_SECRET || "",
  );

  if (!secret) throw new Error("COMPLIANCE_SIGNING_SECRET or PORTAL_API_SECRET is missing.");
  return secret;
}

function encode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(encodedPayload) {
  return createHmac("sha256", signingSecret()).update(encodedPayload).digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function getClientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return String(
    request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-real-ip") ||
      forwarded.split(",")[0] ||
      "unknown",
  ).trim().slice(0, 80);
}

export function issueComplianceSession({ user, request, cookies, url }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    policyVersion: COMPLIANCE_POLICY_VERSION,
    textVersion: COMPLIANCE_TEXT_VERSION,
    userId: Number(user?.id || user?.user_id || 0),
    email: String(user?.email || "").trim().toLowerCase(),
    ip: getClientIp(request),
    acceptedAt: new Date(now * 1000).toISOString(),
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
    ageConfirmed: true,
    researchUseAcknowledged: true,
    termsAccepted: true,
  };
  const encoded = encode(JSON.stringify(payload));
  const token = `${encoded}.${sign(encoded)}`;

  cookies.set(COMPLIANCE_COOKIE, token, {
    ...getCookieOptions(url),
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return payload;
}

export function readComplianceSession(token) {
  try {
    const [encoded, signature, extra] = String(token || "").split(".");
    if (!encoded || !signature || extra || !safeEqual(signature, sign(encoded))) return null;

    const payload = JSON.parse(decode(encoded));
    const now = Math.floor(Date.now() / 1000);
    if (
      payload?.v !== 1 ||
      payload?.policyVersion !== COMPLIANCE_POLICY_VERSION ||
      Number(payload?.exp || 0) <= now ||
      payload?.ageConfirmed !== true ||
      payload?.researchUseAcknowledged !== true ||
      payload?.termsAccepted !== true
    ) return null;

    return payload;
  } catch {
    return null;
  }
}

export async function requireApprovedSession({ cookies }) {
  const portalToken = cookies.get(PORTAL_COOKIE)?.value || "";
  const compliance = readComplianceSession(cookies.get(COMPLIANCE_COOKIE)?.value || "");
  if (!portalToken || !compliance) return null;

  try {
    const account = await portalRequest("me", { method: "GET", token: portalToken });
    const user = account?.user || null;
    const userId = Number(user?.id || user?.user_id || 0);
    const email = String(user?.email || "").trim().toLowerCase();

    if (!user || (compliance.userId && userId !== compliance.userId) || email !== compliance.email) {
      return null;
    }

    return { user, compliance };
  } catch {
    return null;
  }
}

export function clearComplianceSession(cookies, url) {
  cookies.set(COMPLIANCE_COOKIE, "", { ...getCookieOptions(url), maxAge: 0 });
  try { cookies.delete(COMPLIANCE_COOKIE, { path: "/" }); } catch {}
}
