import { PORTAL_COOKIE, json, portalRequest } from "../../../lib/portalApi";

export async function POST({ request, cookies }) {
  const token = cookies.get(PORTAL_COOKIE)?.value;

  if (!token) {
    return json({
      success: false,
      message: "Unauthorized.",
    }, 401);
  }

  try {
    const body = await request.json();

    const data = await portalRequest("update-profile", {
      token,
      body,
    });

    return json({
      success: true,
      user: data.user,
    });
  } catch (error) {
    return json(
      {
        success: false,
        message: error.message || "Unable to update profile.",
      },
      error.status || 500
    );
  }
}