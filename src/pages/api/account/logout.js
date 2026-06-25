import {
  PORTAL_COOKIE,
  clearCookieOptions,
  json,
  portalRequest,
} from "../../../lib/portalApi";

export async function POST({ cookies, url }) {
  const token = cookies.get(PORTAL_COOKIE)?.value;

  try {
    if (token) {
      await portalRequest("logout", {
        token,
        body: {},
      });
    }
  } catch {}

  cookies.set(PORTAL_COOKIE, "", clearCookieOptions(url));

  return json({
    success: true,
  });
}