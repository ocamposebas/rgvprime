import type { APIRoute } from "astro";

export const prerender = false;

const ALLOWED_EVENTS = new Set([
  "page_view",
  "product_view",
  "add_to_cart",
  "checkout",
  "search",
]);
const rateWindows = new Map<string, { startedAt: number; count: number }>();

function runtimeEnv(name: string) {
  return String(process.env[name] || import.meta.env[name] || "").trim();
}

function clean(value: unknown, limit: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function requestOrigin(request: Request) {
  const origin = request.headers.get("origin");

  if (origin) return origin.replace(/\/+$/, "");

  const referrer = request.headers.get("referer");
  if (!referrer) return "";

  try {
    return new URL(referrer).origin;
  } catch {
    return "";
  }
}

function originIsAllowed(origin: string, requestUrl: URL) {
  if (!origin) return false;

  const configured = runtimeEnv("PUBLIC_SITE_URL") || "https://rgvprimellc.com";
  const allowed = new Set([
    new URL(configured).origin,
    "https://rgvprimellc.com",
    "https://www.rgvprimellc.com",
  ]);

  if (requestUrl.hostname === "localhost" || requestUrl.hostname === "127.0.0.1") {
    allowed.add(requestUrl.origin);
  }

  return allowed.has(origin);
}

function withinRateLimit(sessionId: string) {
  const now = Date.now();
  const current = rateWindows.get(sessionId);

  if (!current || now - current.startedAt >= 60_000) {
    rateWindows.set(sessionId, { startedAt: now, count: 1 });
    return true;
  }

  if (current.count >= 90) return false;

  current.count += 1;
  return true;
}

export const POST: APIRoute = async ({ request, url }) => {
  const origin = requestOrigin(request);

  if (!originIsAllowed(origin, url)) {
    return new Response(JSON.stringify({ accepted: false }), {
      status: 403,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 16_384) {
    return new Response(JSON.stringify({ accepted: false }), {
      status: 413,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return new Response(JSON.stringify({ accepted: false }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const eventType = clean(input.event_type, 32).toLowerCase();
  const sessionId = clean(input.session_id, 100);
  const searchQuery = clean(input.search_query, 160);
  const deviceType = clean(input.device_type, 16).toLowerCase();

  if (
    !ALLOWED_EVENTS.has(eventType)
    || !/^[a-zA-Z0-9._-]{8,100}$/.test(sessionId)
    || !["desktop", "mobile", "tablet", "unknown"].includes(deviceType)
    || (eventType === "search" && searchQuery.length < 2)
    || !withinRateLimit(sessionId)
  ) {
    return new Response(JSON.stringify({ accepted: false }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const mailerBaseUrl = (runtimeEnv("MAILER_BASE_URL") || "https://mailer.rgvprimellc.com")
    .replace(/\/+$/, "");
  const token = runtimeEnv("MAILER_STOREFRONT_TOKEN") || runtimeEnv("PORTAL_API_SECRET");
  const payload = {
    event: {
      event_id: `web-${crypto.randomUUID()}`,
      event_type: eventType,
      occurred_at: Math.floor(Date.now() / 1000),
      session_id: sessionId,
      source: clean(input.source, 64).toLowerCase() || "direct",
      campaign_name: clean(input.campaign_name, 120),
      product_id: clean(input.product_id, 100),
      product_name: clean(input.product_name, 180),
      page_path: clean(input.page_path, 500),
      page_title: clean(input.page_title, 180),
      search_query: searchQuery,
      device_type: deviceType,
      referrer_host: clean(input.referrer_host, 180).toLowerCase(),
    },
  };

  try {
    const response = await fetch(`${mailerBaseUrl}/api/storefront/events`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-RGV-Origin": origin,
        ...(token ? { "X-RGV-Storefront-Token": token } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4_000),
    });

    return new Response(JSON.stringify({ accepted: response.ok }), {
      status: response.ok ? 202 : 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return new Response(JSON.stringify({ accepted: false }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
};
