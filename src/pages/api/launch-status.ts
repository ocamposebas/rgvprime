import type { APIRoute } from "astro";
import {
  getLaunchDate,
  getLaunchTimestamp,
  isStoreOpen,
  OPEN_COOKIE_NAME,
} from "../../lib/launch-config";

export const prerender = false;

export const GET: APIRoute = ({ cookies }) => {
  const serverTime = Date.now();
  const open = isStoreOpen(serverTime);

  if (open) {
    cookies.set(OPEN_COOKIE_NAME, "1", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: import.meta.env.PROD,
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return new Response(
    JSON.stringify({
      open,
      launchDate: getLaunchDate(),
      launchTimestamp: getLaunchTimestamp(),
      serverTime,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      },
    },
  );
};