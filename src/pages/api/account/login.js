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

export async function POST({ request, cookies, url }) {
  if (isRequestBodyTooLarge(request, 16 * 1024)) {
    return requestSecurityResponse("Request is too large.", 413);
  }

  const rate = checkRateLimit(request, {
    namespace: "account-login",
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
    const body = await request.json();
    const data = await portalRequest("login", {
      body: {
        login: body.login,
        password: body.password,
      },
    });

    cookies.set(PORTAL_COOKIE, data.token, getCookieOptions(url));

    return json({
      success: true,
      user: data.user,
      orders: data.orders || [],
    });
  } catch (error) {
    return json(
      {
        success: false,
        message: error.message || "Unable to sign in.",
      },
      error.status || 500
    );
  }
}
