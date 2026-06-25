import { json, portalRequest } from "../../../lib/portalApi";

export async function POST({ request }) {
  try {
    const body = await request.json();

    await portalRequest("forgot-password", {
      body: {
        login: body.login,
      },
    });

    return json({
      success: true,
      message: "If an account exists, a reset link has been sent.",
    });
  } catch {
    return json({
      success: true,
      message: "If an account exists, a reset link has been sent.",
    });
  }
}