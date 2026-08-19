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
    namespace: "account-register",
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });

  if (!rate.allowed) {
    return requestSecurityResponse(
      "Too many registration attempts. Please wait and try again.",
      429,
      rate.retryAfter,
    );
  }

  try {
    const body = await request.json();

    const data = await portalRequest("register", {
      body: {
        email: body.email,
        password: body.password,
        first_name: body.first_name,
        last_name: body.last_name,
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
        message: error.message || "Unable to create account.",
      },
      error.status || 500
    );
  }
}
