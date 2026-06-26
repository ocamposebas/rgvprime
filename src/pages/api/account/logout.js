import { portalRequest } from "../../../lib/portalApi";

export const prerender = false;

const COOKIE_NAME = "rgvp_portal_session";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "Set-Cookie": [
        `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
        `${COOKIE_NAME}=; Path=/api; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
        `${COOKIE_NAME}=; Path=/api/account; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      ].join(", "),
    },
  });
}

export async function POST({ cookies }) {
  const token = cookies.get(COOKIE_NAME)?.value || "";

  try {
    if (token) {
      await portalRequest("logout", {
        token,
      });
    }
  } catch (error) {
    console.error("LOGOUT API ERROR:", error);
  }

  cookies.delete(COOKIE_NAME, {
    path: "/",
  });

  cookies.delete(COOKIE_NAME, {
    path: "/api",
  });

  cookies.delete(COOKIE_NAME, {
    path: "/api/account",
  });

  return json({
    success: true,
    message: "Signed out securely.",
  });
}