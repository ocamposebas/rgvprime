import {
  PORTAL_COOKIE,
  clearCookieOptions,
  json,
  portalRequest,
} from "../../../lib/portalApi";

export const prerender = false;

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

function clearPortalCookie(cookies, url, response) {
  cookies.set(PORTAL_COOKIE, "", clearCookieOptions(url));

  try {
    cookies.delete(PORTAL_COOKIE, {
      path: "/",
    });
  } catch {}

  response.headers.append("Set-Cookie", expiredCookie(PORTAL_COOKIE, "/"));
  response.headers.append("Set-Cookie", expiredCookie(PORTAL_COOKIE, "/account"));
  response.headers.append("Set-Cookie", expiredCookie(PORTAL_COOKIE, "/api"));
  response.headers.append("Set-Cookie", expiredCookie(PORTAL_COOKIE, "/api/account"));
}

export async function POST({ cookies, url }) {
  const token = cookies.get(PORTAL_COOKIE)?.value || "";

  try {
    if (token) {
      await portalRequest("logout", {
        method: "POST",
        token,
      });
    }
  } catch (error) {
    console.error("LOGOUT API ERROR:", error);
  }

  const response = json({
    success: true,
    message: "Signed out securely.",
  });

  clearPortalCookie(cookies, url, response);

  return noStore(response);
}