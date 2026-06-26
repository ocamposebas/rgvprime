import {
  PORTAL_COOKIE,
  clearCookieOptions,
  json,
  portalRequest,
} from "../../../lib/portalApi";

export const prerender = false;

const COOKIE_PATHS = ["/", "/account", "/api", "/api/account"];

function noStore(response) {
  response.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0"
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

function expiredCookie(name, path = "/") {
  return `${name}=; Path=${path}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`;
}

function safeNext(url) {
  const next = url.searchParams.get("next") || "/account?mode=login&logged_out=1";

  if (!next.startsWith("/") || next.startsWith("//")) {
    return "/account?mode=login&logged_out=1";
  }

  return next;
}

async function destroySession(token) {
  if (!token) return;

  try {
    await portalRequest("logout", {
      method: "POST",
      token,
    });
  } catch (error) {
    console.error("LOGOUT WORDPRESS ERROR:", error);
  }
}

function clearPortalSession(cookies, url, response) {
  cookies.set(PORTAL_COOKIE, "", clearCookieOptions(url));

  try {
    cookies.delete(PORTAL_COOKIE, {
      path: "/",
    });
  } catch {}

  for (const path of COOKIE_PATHS) {
    response.headers.append("Set-Cookie", expiredCookie(PORTAL_COOKIE, path));
  }
}

async function logout({ cookies, url, redirect = false }) {
  const token = cookies.get(PORTAL_COOKIE)?.value || "";

  await destroySession(token);

  if (redirect) {
    const response = new Response(null, {
      status: 303,
      headers: {
        Location: safeNext(url),
      },
    });

    clearPortalSession(cookies, url, response);

    return noStore(response);
  }

  const response = json({
    success: true,
    message: "Signed out securely.",
  });

  clearPortalSession(cookies, url, response);

  return noStore(response);
}

export async function GET(context) {
  return logout({
    ...context,
    redirect: true,
  });
}

export async function POST(context) {
  return logout({
    ...context,
    redirect: false,
  });
}