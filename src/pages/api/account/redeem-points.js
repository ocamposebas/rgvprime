import {
  PORTAL_COOKIE,
  json,
  portalRequest,
} from "../../../lib/portalApi";

export const prerender = false;

export async function POST({ request, cookies }) {
  const token = cookies.get(PORTAL_COOKIE)?.value || "";

  if (!token) {
    return json({ success: false, message: "Your session has expired." }, 401);
  }

  try {
    const body = await request.json();
    const data = await portalRequest("loyalty/redeem", {
      token,
      body: { points: Number(body?.points || 0) },
    });

    return json(data);
  } catch (error) {
    return json(
      {
        success: false,
        message: error.message || "Unable to redeem points.",
      },
      error.status || 500
    );
  }
}
