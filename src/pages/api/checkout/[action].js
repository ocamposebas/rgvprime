import { json } from "../../../lib/portalApi";
import {
  COMPLIANCE_POLICY_VERSION,
  COMPLIANCE_TEXT_VERSION,
  getClientIp,
  hasRequiredAcknowledgements,
  requireApprovedSession,
} from "../../../lib/complianceSession";
import { isRequestBodyTooLarge } from "../../../lib/requestSecurity";

export const prerender = false;

const WP_URL = String(import.meta.env.PUBLIC_WP_URL || "").replace(/\/+$/, "");
const COMPLIANCE_SECRET = String(
  import.meta.env.COMPLIANCE_SIGNING_SECRET || import.meta.env.PORTAL_API_SECRET || "",
);
const ROUTES = {
  "card-quote": "/wp-json/orbit/v1/card-quote",
  "card-order": "/wp-json/orbit/v1/card-checkout",
  "zelle-order": "/wp-json/rgv/v1/manual-zelle-order",
  "edebit-order": "/wp-json/rgvprime/v1/create-edebit-order",
};

function storefrontOrigin(request) {
  const configured = String(import.meta.env.PUBLIC_SITE_URL || "").replace(/\/+$/, "");
  return configured || new URL(request.url).origin;
}

export async function POST(context) {
  if (isRequestBodyTooLarge(context.request, 256 * 1024)) {
    return json({ success: false, message: "Checkout request is too large." }, 413);
  }

  const route = ROUTES[String(context.params.action || "")];
  if (!route || !WP_URL || !COMPLIANCE_SECRET) return json({ success: false, message: "Checkout route is unavailable." }, 503);

  const approved = await requireApprovedSession(context);
  if (!approved) {
    return json({ success: false, sessionRequired: true, message: "Please sign in and complete the required access confirmations before checkout." }, 401);
  }

  let body;
  try { body = await context.request.json(); } catch { return json({ success: false, message: "Invalid checkout request." }, 400); }

  const isQuote = context.params.action === "card-quote";
  if (!isQuote && !hasRequiredAcknowledgements(body)) {
    return json({ success: false, message: "The separate RUO and Terms confirmations are required at final checkout." }, 400);
  }

  const acceptedAt = new Date().toISOString();
  const acceptance = {
    ...approved.compliance,
    v: 1,
    finalAcceptedAt: acceptedAt,
    requestIp: getClientIp(context.request),
    userId: Number(approved.user?.id || approved.user?.user_id || approved.compliance.userId || 0),
    userEmail: String(approved.user?.email || approved.compliance.email || "").trim().toLowerCase(),
    ageConfirmed: body?.ageConfirmed === true,
    researchUseAcknowledged: body?.researchUseAcknowledged === true,
    termsAccepted: body?.termsAccepted === true,
    policyVersion: COMPLIANCE_POLICY_VERSION,
    textVersion: COMPLIANCE_TEXT_VERSION,
  };

  const origin = storefrontOrigin(context.request);
  const upstream = await fetch(`${WP_URL}${route}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: origin,
      Referer: `${origin}/checkout`,
      "X-RGV-Compliance-Secret": COMPLIANCE_SECRET,
    },
    body: JSON.stringify({ ...body, complianceAcceptance: acceptance }),
  });

  const responseBody = await upstream.arrayBuffer();
  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  const location = upstream.headers.get("location");
  if (location) headers.set("Location", location);

  return new Response(responseBody, { status: upstream.status, headers });
}
