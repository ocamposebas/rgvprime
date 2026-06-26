import { json, portalRequest } from "../../../lib/portalApi";

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

function getPublicSiteUrl(url) {
  const fromEnv =
    import.meta.env.PUBLIC_SITE_URL ||
    import.meta.env.SITE_URL ||
    "";

  if (fromEnv) {
    return String(fromEnv).replace(/\/+$/, "");
  }

  return `${url.protocol}//${url.host}`;
}

export async function POST({ request, url }) {
  let body = {};

  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const login = String(body?.login || "").trim();

  if (!login) {
    return noStore(
      json(
        {
          success: false,
          message: "Enter your account email.",
        },
        422
      )
    );
  }

  try {
    await portalRequest("forgot-password", {
      method: "POST",
      body: {
        login,
        site_url: getPublicSiteUrl(url),
      },
    });
  } catch (error) {
    console.error("FORGOT PASSWORD ERROR:", error);
  }

  return noStore(
    json({
      success: true,
      message: "If an account exists, a secure reset link has been sent.",
    })
  );
}