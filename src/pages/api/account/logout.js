export const prerender = false;

const COOKIE_NAMES = [
  "rgvp_portal_session",
  "rgvp_session",
  "rgv_portal_session",
  "rgv_customer_session",
  "rgv_session",
  "portal_session",
];

const COOKIE_PATHS = ["/", "/account", "/api", "/api/account"];

const WORDPRESS_URL = (
  import.meta.env.WORDPRESS_URL ||
  import.meta.env.WP_URL ||
  import.meta.env.WP_SITE_URL ||
  "https://wp.rgvprimellc.com"
).replace(/\/$/, "");

const PORTAL_SECRET =
  import.meta.env.PORTAL_API_SECRET ||
  import.meta.env.RGV_PORTAL_SECRET ||
  "";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

function expiredCookie(name, path) {
  return `${name}=; Path=${path}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`;
}

async function destroyWordPressSession(token) {
  if (!token || !PORTAL_SECRET) return;

  const response = await fetch(`${WORDPRESS_URL}/wp-json/rgv-portal/v1/logout`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "x-rgv-portal-secret": PORTAL_SECRET,
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("WordPress logout failed:", response.status, text);
  }
}

export async function POST({ cookies }) {
  let token = "";

  for (const name of COOKIE_NAMES) {
    const value = cookies.get(name)?.value;

    if (value) {
      token = value;
      break;
    }
  }

  try {
    await destroyWordPressSession(token);
  } catch (error) {
    console.error("Logout destroy session error:", error);
  }

  const response = json({
    success: true,
    message: "Signed out securely.",
  });

  for (const name of COOKIE_NAMES) {
    for (const path of COOKIE_PATHS) {
      response.headers.append("Set-Cookie", expiredCookie(name, path));
    }
  }

  return response;
}