import { defineMiddleware } from "astro:middleware";
import {
  isStoreOpen,
  OPEN_COOKIE_NAME,
} from "./lib/launch-config";
import {
  getMaintenanceRetryAfterSeconds,
  isMaintenanceModeEnabled,
} from "./lib/maintenance-config";

const publicPrefixes = [
  "/_astro/",
  "/_server-islands/",
  "/api/",
  "/images/",
  "/fonts/",
  "/videos/",
  "/assets/",
  "/coas/",
];

const publicFiles = new Set([
  "/logo.png",
  "/logo-small@2x.webp",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap-index.xml",
]);

function isPublicAsset(pathname: string) {
  return (
    publicFiles.has(pathname) ||
    publicPrefixes.some((prefix) => pathname.startsWith(prefix)) ||
    /\.(?:css|js|mjs|map|json|pdf|png|jpe?g|webp|avif|svg|gif|ico|woff2?|ttf|mp4|webm)$/i.test(
      pathname,
    )
  );
}

function withNoCache(response: Response) {
  const headers = new Headers(response.headers);

  headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  );
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function asMaintenanceResponse(response: Response) {
  const headers = new Headers(response.headers);

  headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  headers.set("Retry-After", String(getMaintenanceRetryAfterSeconds()));
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");

  return new Response(response.body, {
    status: 503,
    statusText: "Service Unavailable",
    headers,
  });
}

function maintenanceApiResponse() {
  return new Response(
    JSON.stringify({
      success: false,
      maintenance: true,
      message: "RGVPRIME is undergoing scheduled maintenance. Please try again shortly.",
      estimatedDurationHours: getMaintenanceRetryAfterSeconds() / 3600,
    }),
    {
      status: 503,
      statusText: "Service Unavailable",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": String(getMaintenanceRetryAfterSeconds()),
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    },
  );
}

export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname;
  const method = context.request.method;

  if (isMaintenanceModeEnabled()) {
    const isStaticAsset =
      isPublicAsset(pathname) && !pathname.startsWith("/api/");

    if (isStaticAsset || pathname === "/api/health") {
      return next();
    }

    if (pathname.startsWith("/api/")) {
      return maintenanceApiResponse();
    }

    if (method !== "GET" && method !== "HEAD") {
      return maintenanceApiResponse();
    }

    if (pathname === "/maintenance" || pathname === "/maintenance/") {
      return asMaintenanceResponse(await next());
    }

    return asMaintenanceResponse(await next("/maintenance"));
  }

  if (method !== "GET" && method !== "HEAD") {
    return next();
  }

  if (isPublicAsset(pathname)) {
    return next();
  }

  const hasServerOpenCookie =
    context.cookies.get(OPEN_COOKIE_NAME)?.value === "1";

  const storeOpen = hasServerOpenCookie || isStoreOpen(Date.now());

  if (storeOpen) {
    if (pathname === "/launch" || pathname === "/launch/") {
      return context.redirect("/", 302);
    }

    return next();
  }

  if (pathname === "/launch" || pathname === "/launch/") {
    return withNoCache(await next());
  }

  const response = await next("/launch");
  const protectedResponse = withNoCache(response);
  protectedResponse.headers.set("X-Robots-Tag", "noindex");

  return protectedResponse;
});
