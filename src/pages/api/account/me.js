import { PORTAL_COOKIE, clearCookieOptions, json, portalRequest } from "../../../lib/portalApi";

export async function GET({ cookies, url }) {
  const token = cookies.get(PORTAL_COOKIE)?.value;

  if (!token) {
    return json({
      success: false,
      user: null,
      orders: [],
    }, 401);
  }

  try {
    const data = await portalRequest("me", {
      method: "GET",
      token,
    });

    return json({
      success: true,
      user: data.user,
      orders: data.orders || [],
    });
  } catch (error) {
    cookies.set(PORTAL_COOKIE, "", clearCookieOptions(url));

    return json({
      success: false,
      user: null,
      orders: [],
    }, 401);
  }
}