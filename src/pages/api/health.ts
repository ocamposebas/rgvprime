import type { APIRoute } from "astro";
import { isMaintenanceModeEnabled } from "../../lib/maintenance-config";

export const prerender = false;

export const GET: APIRoute = () => {
  return new Response(
    JSON.stringify({
      ok: true,
      maintenance: isMaintenanceModeEnabled(),
      timestamp: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
};
