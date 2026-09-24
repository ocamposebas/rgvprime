import { json } from "../../../lib/portalApi";
import {
  COMPLIANCE_POLICY_VERSION,
  COMPLIANCE_TEXT_VERSION,
  getClientIp,
  hasRequiredAcknowledgements,
  requireApprovedSession,
} from "../../../lib/complianceSession";
import {
  checkRateLimit,
  isRequestBodyTooLarge,
  requestSecurityResponse,
} from "../../../lib/requestSecurity";
import {
  createCardWalletOrder,
  getCardWalletOrderStatus,
} from "../../../lib/cardWalletCheckout";

export const prerender = false;

const WP_URL = String(import.meta.env.PUBLIC_WP_URL || "").replace(/\/+$/, "");
const COMPLIANCE_SECRET = String(
  import.meta.env.COMPLIANCE_SIGNING_SECRET || import.meta.env.PORTAL_API_SECRET || "",
);
const ROUTES = {
  "card-quote": "/wp-json/orbit/v1/card-quote",
  "coupon-validate": "/wp-json/rgv/v1/validate-coupon",
  "card-order": "/wp-json/orbit/v1/card-checkout",
  "zelle-order": "/wp-json/rgv/v1/manual-zelle-order",
  "edebit-order": "/wp-json/rgvprime/v1/create-edebit-order",
  "edebit-status": "/wp-json/rgv-edebit/v1/order-status",
  "edebit-cancel": "/wp-json/rgv-edebit/v1/cancel-pending",
  "orbit-card-order": "/wp-json/rgv/v1/orbit-card-order",
  "orbit-hosted-status": "/wp-json/orbit/v1/card-hosted-status",
};

function containsPuertoRicoAddress(body = {}) {
  return [body?.billing, body?.shipping].some((address) => {
    const country = String(address?.country || "").trim().toUpperCase();
    const state = String(address?.state || "").trim().toUpperCase();
    return country === "PR" || state === "PR";
  });
}

function storefrontOrigin(request) {
  const configured = String(import.meta.env.PUBLIC_SITE_URL || "").replace(/\/+$/, "");
  return configured || new URL(request.url).origin;
}

export async function POST(context) {
  if (isRequestBodyTooLarge(context.request, 256 * 1024)) {
    return json({ success: false, message: "Checkout request is too large." }, 413);
  }

  const action = String(context.params.action || "");
  const route = ROUTES[action];
  const isCardWalletAction = action === "card-wallet-order" || action === "card-wallet-status";
  if ((!route && !isCardWalletAction) || !WP_URL || !COMPLIANCE_SECRET) {
    return json({ success: false, message: "Checkout route is unavailable." }, 503);
  }

  const approved = await requireApprovedSession(context);
  if (!approved) {
    return json({ success: false, sessionRequired: true, message: "Please sign in and complete the required access confirmations before checkout." }, 401);
  }

  let body;
  try { body = await context.request.json(); } catch { return json({ success: false, message: "Invalid checkout request." }, 400); }

  if (containsPuertoRicoAddress(body)) {
    return json({ success: false, message: "Shipping to Puerto Rico is not available." }, 400);
  }

  const isQuote = action === "card-quote" || action === "coupon-validate";
  const requiresCheckoutAcceptance = [
    "card-order",
    "card-wallet-order",
    "zelle-order",
    "edebit-order",
    "orbit-card-order",
  ].includes(action);
  if (requiresCheckoutAcceptance && !hasRequiredAcknowledgements(body)) {
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

  if (isCardWalletAction) {
    const rate = checkRateLimit(context.request, {
      namespace: action,
      limit: action === "card-wallet-order" ? 10 : 60,
      windowMs: action === "card-wallet-order" ? 10 * 60 * 1000 : 60 * 1000,
      identifier: String(approved.user?.id || approved.user?.user_id || approved.user?.email || ""),
    });
    if (!rate.allowed) {
      return requestSecurityResponse(
        action === "card-wallet-order"
          ? "Too many checkout attempts. Please wait before trying again."
          : "Too many payment status checks. Please wait and try again.",
        429,
        rate.retryAfter,
      );
    }

    try {
      const result = action === "card-wallet-order"
        ? await createCardWalletOrder({
            body,
            acceptance,
            attemptId: context.request.headers.get("idempotency-key") || body?.requestId,
          })
        : await getCardWalletOrderStatus({
            orderId: body?.orderId || body?.order_id,
            orderKey: body?.orderKey || body?.order_key,
            approvedUser: approved.user,
          });
      return json(result, 200);
    } catch (error) {
      console.error(`CARD WALLET ${action.toUpperCase()} ERROR:`, error?.code || error?.message || error);
      const status = Number(error?.status || 500);
      return json({
        success: false,
        message: status >= 500
          ? "Secure card and wallet checkout is temporarily unavailable."
          : String(error?.message || "The checkout request could not be completed."),
      }, status >= 400 && status < 600 ? status : 500);
    }
  }

  const origin = storefrontOrigin(context.request);
  try {
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
  } catch {
    return json({
      success: false,
      upstreamUncertain: !isQuote,
      message: isQuote
        ? "The checkout service is temporarily unavailable."
        : "The payment service did not return a response. Do not retry until the order is verified.",
    }, 502);
  }
}
