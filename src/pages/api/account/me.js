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

function clearPortalCookie(cookies, url) {
  cookies.set(PORTAL_COOKIE, "", clearCookieOptions(url));

  try {
    cookies.delete(PORTAL_COOKIE, {
      path: "/",
    });
  } catch {}
}

export async function GET({ cookies, url }) {
  const token = cookies.get(PORTAL_COOKIE)?.value || "";

  if (!token) {
    return noStore(
      json(
        {
          success: false,
          user: null,
          orders: [],
        },
        401
      )
    );
  }

  try {
    const data = await portalRequest("me", {
      method: "GET",
      token,
    });

    return noStore(
      json({
        success: true,
        user: data.user,
        orders: data.orders || [],
      })
    );
  } catch (error) {
    console.error("ME API ERROR:", error);

    clearPortalCookie(cookies, url);

    return noStore(
      json(
        {
          success: false,
          user: null,
          orders: [],
        },
        401
      )
    );
  }
}