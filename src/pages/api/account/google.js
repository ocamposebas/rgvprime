import {
  PORTAL_COOKIE,
  getCookieOptions,
  json,
  portalRequest,
} from "../../../lib/portalApi";
import {
  checkRateLimit,
  isRequestBodyTooLarge,
  requestSecurityResponse,
} from "../../../lib/requestSecurity";
import {
  hasRequiredAcknowledgements,
  issueComplianceSession,
} from "../../../lib/complianceSession";
import {
  botProtectionResponse,
  verifyBotProtection,
} from "../../../lib/botProtection";
import { verifyGoogleCredential } from "../../../lib/googleIdentity";
import { filterVisibleAccountOrders } from "../../../lib/accountOrderVisibility";

export const prerender = false;

export async function POST({ request, cookies, url }) {
  if (isRequestBodyTooLarge(request, 24 * 1024)) {
    return requestSecurityResponse("Request is too large.", 413);
  }

  const rate = checkRateLimit(request, {
    namespace: "account-google",
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });

  if (!rate.allowed) {
    return requestSecurityResponse(
      "Too many sign-in attempts. Please wait and try again.",
      429,
      rate.retryAfter,
    );
  }

  try {
    const body = await request.json().catch(() => ({}));

    if (!hasRequiredAcknowledgements(body)) {
      return json(
        {
          success: false,
          message:
            "Confirm that you are 21+, accept the Research Use Only policy, and accept the Terms.",
        },
        400,
      );
    }

    const botCheck = await verifyBotProtection({
      request,
      token: body.turnstileToken,
    });

    if (!botCheck.success) {
      return botProtectionResponse(botCheck);
    }

    const googleIdentity = await verifyGoogleCredential(body.credential);
    const data = await portalRequest("google-login", {
      body: googleIdentity,
    });

    cookies.set(PORTAL_COOKIE, data.token, getCookieOptions(url));
    const compliance = issueComplianceSession({
      user: data.user,
      request,
      cookies,
      url,
    });

    return json({
      success: true,
      user: data.user,
      orders: filterVisibleAccountOrders(data.orders),
      account: {
        created: data.created === true,
        linkedExisting: data.linked_existing === true,
      },
      compliance: {
        approved: true,
        policyVersion: compliance.policyVersion,
      },
    });
  } catch (error) {
    return json(
      {
        success: false,
        message: error?.message || "Unable to sign in with Google.",
      },
      error?.status || 500,
    );
  }
}
