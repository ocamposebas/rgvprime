import { portalRequest } from "../../../lib/portalApi";
import {
  checkRateLimit,
  isRequestBodyTooLarge,
  requestSecurityResponse,
} from "../../../lib/requestSecurity";

export const prerender = false;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function POST({ request }) {
  if (isRequestBodyTooLarge(request, 16 * 1024)) {
    return requestSecurityResponse("Request is too large.", 413);
  }

  const rate = checkRateLimit(request, {
    namespace: "account-reset-password",
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });

  if (!rate.allowed) {
    return requestSecurityResponse(
      "Too many reset attempts. Please wait and try again.",
      429,
      rate.retryAfter,
    );
  }

  try {
    const body = await request.json().catch(() => ({}));

    if (!body.login || !body.key || !body.password) {
      return jsonResponse(
        {
          success: false,
          message: "Missing reset information. Please request a new reset link.",
        },
        400
      );
    }

    const data = await portalRequest("reset-password", {
      body: {
        login: body.login,
        key: body.key,
        password: body.password,
      },
    });

    return jsonResponse({
      success: true,
      message: data?.message || "Password updated successfully.",
    });
  } catch (error) {
    console.error("RESET PASSWORD API ERROR:", error);

    return jsonResponse(
      {
        success: false,
        message:
          error?.message ||
          "This reset link is invalid or expired. Please request a new reset link.",
      },
      500
    );
  }
}
