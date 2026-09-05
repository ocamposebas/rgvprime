export const prerender = false;

const CACHE_CONTROL =
  "public, max-age=10, s-maxage=20, stale-while-revalidate=30";

function cleanUrl(value = "") {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status === 200 ? CACHE_CONTROL : "no-store",
    },
  });
}

function inactivePayload(reason) {
  return {
    active: false,
    status: "unavailable",
    reason,
    server_time: new Date().toISOString(),
    remaining_seconds: 0,
  };
}

export async function GET() {
  const wordpressUrl = cleanUrl(
    import.meta.env.PUBLIC_WP_URL ||
      import.meta.env.WC_API_URL ||
      import.meta.env.WORDPRESS_URL ||
      import.meta.env.WP_URL,
  );

  if (!wordpressUrl) {
    return json(inactivePayload("missing_wordpress_url"));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(
      `${wordpressUrl}/wp-json/rgv-promotion/v1/current`,
      {
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      },
    );

    if (!response.ok) {
      return json(inactivePayload(`wordpress_${response.status}`));
    }

    const payload = await response.json();

    return json({
      active: payload?.active === true,
      status: String(payload?.status || "disabled"),
      discount_percent: Number(payload?.discount_percent || 0),
      eyebrow: String(payload?.eyebrow || "LIMITED-TIME OFFER").slice(0, 40),
      headline: String(payload?.headline || "").slice(0, 80),
      cta_label: String(payload?.cta_label || "SHOP NOW").slice(0, 24),
      cta_url: String(payload?.cta_url || "/shop"),
      starts_at: payload?.starts_at || null,
      ends_at: payload?.ends_at || null,
      server_time: payload?.server_time || new Date().toISOString(),
      remaining_seconds: Math.max(0, Number(payload?.remaining_seconds || 0)),
    });
  } catch (error) {
    return json(
      inactivePayload(
        error?.name === "AbortError" ? "wordpress_timeout" : "wordpress_unavailable",
      ),
    );
  } finally {
    clearTimeout(timeout);
  }
}
