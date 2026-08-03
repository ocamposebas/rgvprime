export const prerender = false;

const CACHE_CONTROL = "public, max-age=30, s-maxage=300, stale-while-revalidate=600";

function cleanUrl(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status === 200 ? CACHE_CONTROL : "no-store",
      ...extraHeaders,
    },
  });
}

export async function GET({ request }) {
  const wordpressUrl = cleanUrl(
    import.meta.env.PUBLIC_WP_URL ||
      import.meta.env.WC_API_URL ||
      import.meta.env.WORDPRESS_URL ||
      import.meta.env.WP_URL
  );

  if (!wordpressUrl) {
    return json(
      { error: "COA library is not configured.", code: "missing_wordpress_url" },
      503
    );
  }

  const requestUrl = new URL(request.url);
  const productId = Math.max(0, Number.parseInt(requestUrl.searchParams.get("product_id") || "0", 10) || 0);
  const variationId = Math.max(0, Number.parseInt(requestUrl.searchParams.get("variation_id") || "0", 10) || 0);
  const endpoint = productId
    ? `${wordpressUrl}/wp-json/rgv-coa/v1/product/${productId}${variationId ? `?variation_id=${variationId}` : ""}`
    : `${wordpressUrl}/wp-json/rgv-coa/v1/library`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    const body = await response.text();
    let payload;

    try {
      payload = JSON.parse(body);
    } catch {
      payload = { error: "WordPress returned an invalid COA response." };
    }

    if (!response.ok) {
      return json(
        {
          error: payload?.message || payload?.error || "Could not load the COA library.",
          code: payload?.code || "coa_upstream_error",
        },
        response.status >= 400 && response.status < 600 ? response.status : 502
      );
    }

    return json(payload, 200);
  } catch (error) {
    return json(
      {
        error:
          error?.name === "AbortError"
            ? "The COA library took too long to respond."
            : "Could not reach the COA library.",
        code: error?.name === "AbortError" ? "coa_timeout" : "coa_unavailable",
      },
      502
    );
  } finally {
    clearTimeout(timeout);
  }
}

