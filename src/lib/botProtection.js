import { getClientIp } from "./requestSecurity";

const TURNSTILE_SITE_KEY = String(
  import.meta.env.PUBLIC_TURNSTILE_SITE_KEY || "",
).trim();
const TURNSTILE_SECRET_KEY = String(
  import.meta.env.TURNSTILE_SECRET_KEY || "",
).trim();

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function isBotProtectionConfigured() {
  return Boolean(TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY);
}

export async function verifyBotProtection({
  request,
  token,
  expectedAction = "account_access",
}) {
  if (!TURNSTILE_SITE_KEY && !TURNSTILE_SECRET_KEY) {
    return { success: true, configured: false };
  }

  if (!TURNSTILE_SITE_KEY || !TURNSTILE_SECRET_KEY) {
    console.error(
      "Turnstile is partially configured. Set both PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY.",
    );

    return {
      success: false,
      configured: true,
      status: 503,
      message: "Bot protection is temporarily unavailable. Please try again shortly.",
    };
  }

  const cleanToken = String(token || "").trim();

  if (!cleanToken || cleanToken.length > 2048) {
    return {
      success: false,
      configured: true,
      status: 400,
      message: "Please wait for the security check and try again.",
    };
  }

  const form = new URLSearchParams({
    secret: TURNSTILE_SECRET_KEY,
    response: cleanToken,
  });
  const remoteIp = getClientIp(request);

  if (remoteIp && remoteIp !== "unknown") {
    form.set("remoteip", remoteIp);
  }

  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      signal: AbortSignal.timeout(8000),
    });
    const result = await response.json().catch(() => null);
    const actionMatches =
      !expectedAction || !result?.action || result.action === expectedAction;

    if (!response.ok || result?.success !== true || !actionMatches) {
      console.warn("Turnstile rejected an account request.", {
        action: result?.action || "",
        errors: Array.isArray(result?.["error-codes"])
          ? result["error-codes"]
          : [],
      });

      return {
        success: false,
        configured: true,
        status: 403,
        message: "Security verification expired or failed. Please try again.",
      };
    }

    return { success: true, configured: true };
  } catch (error) {
    console.error("Turnstile verification failed:", error);

    return {
      success: false,
      configured: true,
      status: 503,
      message: "Security verification is temporarily unavailable. Please try again.",
    };
  }
}

export function botProtectionResponse(result) {
  return new Response(
    JSON.stringify({
      success: false,
      message:
        result?.message ||
        "Security verification failed. Please refresh and try again.",
    }),
    {
      status: result?.status || 403,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
