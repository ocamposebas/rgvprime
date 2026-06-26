import { portalRequest } from "../../../lib/portalApi";

export const prerender = false;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function POST({ request }) {
  try {
    const body = await request.json().catch(() => ({}));

    if (!body.login || !body.key || !body.password) {
      return json(
        {
          success: false,
          message: "Missing reset information. Request a new reset link.",
        },
        400
      );
    }

    const data = await portalRequest("reset-password", {
      body: {
        login: body.login,
        key: body.key,
        password: body.password,
      },
    });

    return json({
      success: true,
      message: data?.message || "Password updated successfully.",
    });
  } catch (error) {
    console.error("RESET PASSWORD API ERROR:", error);

    return json(
      {
        success: false,
        message:
          error?.message ||
          "This reset link is invalid or expired. Request a new reset link.",
      },
      500
    );
  }
}