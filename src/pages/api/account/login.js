import {
  PORTAL_COOKIE,
  getCookieOptions,
  json,
  portalRequest,
} from "../../../lib/portalApi";

export async function POST({ request, cookies, url }) {
  try {
    const body = await request.json();
    const data = await portalRequest("login", {
      body: {
        login: body.login,
        password: body.password,
      },
    });

    cookies.set(PORTAL_COOKIE, data.token, getCookieOptions(url));

    return json({
      success: true,
      user: data.user,
      orders: data.orders || [],
    });
  } catch (error) {
    return json(
      {
        success: false,
        message: error.message || "Unable to sign in.",
      },
      error.status || 500
    );
  }
}