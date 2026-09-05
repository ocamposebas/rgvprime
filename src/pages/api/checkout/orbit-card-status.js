export const prerender = false;

import { requireApprovedSession } from "../../../lib/complianceSession";
import { isRequestBodyTooLarge } from "../../../lib/requestSecurity";

const NO_STORE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: NO_STORE_HEADERS });
}

export async function POST(context) {
  if (isRequestBodyTooLarge(context.request, 16 * 1024)) {
    return response({ success: false, message: "Request is too large." }, 413);
  }

  const approved = await requireApprovedSession(context);
  if (!approved) return response({ success: false, message: "Secure checkout session required." }, 401);

  const wordpressUrl = String(
    import.meta.env.PUBLIC_WP_URL || import.meta.env.PUBLIC_WP_SITE_URL || "",
  ).replace(/\/+$/, "");
  const secret = String(
    import.meta.env.COMPLIANCE_SIGNING_SECRET || import.meta.env.PORTAL_API_SECRET || "",
  );
  if (!wordpressUrl || !secret) return response({ success: false, message: "ORBIT is not configured." }, 503);

  const body = await context.request.text();
  try {
    const upstream = await fetch(`${wordpressUrl}/wp-json/rgv/v1/orbit-card-status`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-RGV-Compliance-Secret": secret,
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const payload = await upstream.json().catch(() => ({}));
    return response(payload, upstream.status);
  } catch {
    return response({ success: false, message: "Unable to verify the ORBIT payment." }, 503);
  }
}


