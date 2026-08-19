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

function withSecurityHeaders(response: Response, requestUrl: URL) {
  const headers = new Headers(response.headers);

  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(self)",
  );

  if (requestUrl.protocol === "https:") {
    headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname;
  const method = context.request.method;
  const secure = (response: Response) =>
    withSecurityHeaders(response, context.url);

  if (isMaintenanceModeEnabled()) {
    const isStaticAsset =
      isPublicAsset(pathname) && !pathname.startsWith("/api/");

    if (isStaticAsset || pathname === "/api/health") {
      return secure(await next());
    }

    if (pathname.startsWith("/api/")) {
      return secure(maintenanceApiResponse());
    }

    if (method !== "GET" && method !== "HEAD") {
      return secure(maintenanceApiResponse());
    }

    if (pathname === "/maintenance" || pathname === "/maintenance/") {
      return secure(asMaintenanceResponse(await next()));
    }

    return secure(asMaintenanceResponse(await next("/maintenance")));
  }

  if (method !== "GET" && method !== "HEAD") {
    return secure(await next());
  }

  if (isPublicAsset(pathname)) {
    return secure(await next());
  }

  const hasServerOpenCookie =
    context.cookies.get(OPEN_COOKIE_NAME)?.value === "1";

  const storeOpen = hasServerOpenCookie || isStoreOpen(Date.now());

  if (storeOpen) {
    if (pathname === "/launch" || pathname === "/launch/") {
      return secure(context.redirect("/", 302));
    }

    return secure(await next());
  }

  if (pathname === "/launch" || pathname === "/launch/") {
    return secure(withNoCache(await next()));
  }

  const response = await next("/launch");
  const protectedResponse = withNoCache(response);
  protectedResponse.headers.set("X-Robots-Tag", "noindex");

  return secure(protectedResponse);
});
