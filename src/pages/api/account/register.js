import {
  PORTAL_COOKIE,
  getCookieOptions,
  json,
  portalRequest,
} from "../../../lib/portalApi";

export async function POST({ request, cookies, url }) {
  try {
    const body = await request.json();

    const data = await portalRequest("register", {
      body: {
        email: body.email,
        password: body.password,
        first_name: body.first_name,
        last_name: body.last_name,
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
        message: error.message || "Unable to create account.",
      },
      error.status || 500
    );
  }
}