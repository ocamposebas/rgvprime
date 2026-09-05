export const prerender = false;

const NO_STORE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: NO_STORE_HEADERS });
}

export async function GET() {
  const wordpressUrl = String(
    import.meta.env.PUBLIC_WP_URL || import.meta.env.PUBLIC_WP_SITE_URL || "",
  ).replace(/\/+$/, "");

  if (!wordpressUrl) {
    return response({ success: false, configured: false, message: "ORBIT is not configured." }, 503);
  }

  try {
    const upstream = await fetch(`${wordpressUrl}/wp-json/rgv/v1/orbit-card-config`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const payload = await upstream.json().catch(() => ({}));
    return response(payload, upstream.status);
  } catch {
    return response({ success: false, configured: false, message: "ORBIT is temporarily unavailable." }, 503);
  }
}


