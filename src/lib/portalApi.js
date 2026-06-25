const WP_URL = String(import.meta.env.PUBLIC_WP_URL || "").replace(/\/+$/, "");
const PORTAL_API_SECRET = import.meta.env.PORTAL_API_SECRET;
const PUBLIC_SITE_URL = String(import.meta.env.PUBLIC_SITE_URL || "").replace(/\/+$/, "");

export const PORTAL_COOKIE = "rgv_customer_session";

function getPortalBaseUrl() {
  if (!WP_URL) {
    throw new Error("PUBLIC_WP_URL is missing.");
  }

  return `${WP_URL}/wp-json/rgv-portal/v1`;
}

export function getCookieOptions(url) {
  const isSecure =
    import.meta.env.PROD || String(url?.protocol || "").toLowerCase() === "https:";

  return {
    path: "/",
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
  };
}

export function clearCookieOptions(url) {
  return {
    ...getCookieOptions(url),
    maxAge: 0,
  };
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function portalRequest(path, options = {}) {
  if (!PORTAL_API_SECRET) {
    throw new Error("PORTAL_API_SECRET is missing.");
  }

  const method = options.method || "POST";
  const token = options.token || "";
  const body = options.body || {};
  const cleanPath = String(path || "").replace(/^\/+|\/+$/g, "");

  const endpoint = `${getPortalBaseUrl()}/${cleanPath}/`;

  console.log("Portal request:", method, endpoint);

  const response = await fetch(endpoint, {
    method,
    redirect: "follow",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-RGV-Portal-Secret": PORTAL_API_SECRET,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body:
      method === "GET"
        ? undefined
        : JSON.stringify({
            ...body,
            site_url: PUBLIC_SITE_URL,
          }),
  });

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    console.error("WordPress returned non JSON from:", endpoint);
    console.error(text);

    throw new Error(
      "WordPress returned HTML instead of JSON. Check plugin routes and WordPress REST API."
    );
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.data?.message ||
      data?.error ||
      "Something went wrong.";

    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}