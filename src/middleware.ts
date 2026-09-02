import { defineMiddleware } from "astro:middleware";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  isStoreOpen,
  OPEN_COOKIE_NAME,
} from "./lib/launch-config";
import {
  getMaintenanceBypassToken,
  getMaintenanceRetryAfterSeconds,
  isMaintenanceModeEnabled,
} from "./lib/maintenance-config";
import { requireApprovedSession } from "./lib/complianceSession";
import {
  getPermanentProductRedirect,
  normalizeCanonicalPath,
} from "./lib/seo";

const MAINTENANCE_ACCESS_PARAM = "maintenance_access";
const MAINTENANCE_ACCESS_COOKIE = "rgv_maintenance_access";
const CANONICAL_HOST = "rgvprimellc.com";
const PRODUCTION_HOSTS = new Set([CANONICAL_HOST, `www.${CANONICAL_HOST}`]);

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
  headers.set("CDN-Cache-Control", "no-store");
  headers.set("Surrogate-Control", "no-store");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withNoindexFollow(response: Response) {
  const headers = new Headers(response.headers);

  headers.set("X-Robots-Tag", "noindex, follow, noarchive");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function getRequestHostname(context) {
  const forwardedHost = context.request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const requestHost = forwardedHost || context.request.headers.get("host");

  try {
    return new URL(`https://${requestHost || context.url.host}`).hostname.toLowerCase();
  } catch {
    return context.url.hostname.toLowerCase();
  }
}

function getRequestProtocol(context) {
  const forwardedProtocol = context.request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    ?.toLowerCase();

  return forwardedProtocol ? `${forwardedProtocol}:` : context.url.protocol;
}

function getPermanentDocumentRedirect(context) {
  if (context.request.method !== "GET" && context.request.method !== "HEAD") {
    return null;
  }

  const pathname = context.url.pathname;
  const lowerPathname = pathname.toLowerCase();

  if (lowerPathname.startsWith("/api/") || isPublicAsset(pathname)) {
    return null;
  }

  const requestHostname = getRequestHostname(context);

  if (!PRODUCTION_HOSTS.has(requestHostname)) {
    return null;
  }

  const normalizedPath = normalizeCanonicalPath(pathname);
  const productMatch = normalizedPath.match(/^\/product\/([^/]+)$/);
  const productRedirect = productMatch
    ? getPermanentProductRedirect(productMatch[1])
    : null;
  const targetPath = productRedirect || normalizedPath;
  const requestProtocol = getRequestProtocol(context);
  const needsRedirect =
    requestProtocol !== "https:" ||
    requestHostname !== CANONICAL_HOST ||
    pathname !== targetPath;

  if (!needsRedirect) return null;

  const targetUrl = new URL(context.url);
  targetUrl.protocol = "https:";
  targetUrl.hostname = CANONICAL_HOST;
  targetUrl.port = "";
  targetUrl.pathname = targetPath;

  return {
    location: targetUrl.toString(),
    status: productRedirect ? 301 : 308,
  };
}

function maintenanceTokenDigest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function maintenanceTokensMatch(candidate: string, configured: string) {
  if (!candidate || !configured) return false;

  const candidateDigest = Buffer.from(maintenanceTokenDigest(candidate), "hex");
  const configuredDigest = Buffer.from(maintenanceTokenDigest(configured), "hex");

  return timingSafeEqual(candidateDigest, configuredDigest);
}

function asMaintenanceResponse(response: Response) {
  const headers = new Headers(response.headers);

  headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  headers.set("CDN-Cache-Control", "no-store");
  headers.set("Surrogate-Control", "no-store");
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
    // Stripe's Express Checkout Element renders wallet buttons in a
    // cross-origin iframe. The iframe's `allow="payment *"` attribute can
    // narrow this permission, but it cannot override a `payment=(self)`
    // response policy from the top-level checkout page.
    "camera=(), microphone=(), geolocation=(), payment=*",
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
  const permanentRedirect = getPermanentDocumentRedirect(context);

  if (permanentRedirect) {
    return secure(
      context.redirect(permanentRedirect.location, permanentRedirect.status),
    );
  }

  if (isMaintenanceModeEnabled()) {
    const configuredBypassToken = getMaintenanceBypassToken();
    const requestedBypassToken = context.url.searchParams.get(
      MAINTENANCE_ACCESS_PARAM,
    ) || "";
    const expectedCookieValue = configuredBypassToken
      ? maintenanceTokenDigest(configuredBypassToken)
      : "";
    const hasBypassCookie = Boolean(
      expectedCookieValue &&
      context.cookies.get(MAINTENANCE_ACCESS_COOKIE)?.value === expectedCookieValue,
    );

    if (maintenanceTokensMatch(requestedBypassToken, configuredBypassToken)) {
      context.cookies.set(MAINTENANCE_ACCESS_COOKIE, expectedCookieValue, {
        httpOnly: true,
        path: "/",
        sameSite: "strict",
        secure: context.url.protocol === "https:",
      });

      const cleanUrl = new URL(context.url);
      cleanUrl.searchParams.delete(MAINTENANCE_ACCESS_PARAM);
      const cleanDestination = `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`;

      return secure(withNoCache(context.redirect(cleanDestination || "/", 303)));
    }

    if (hasBypassCookie) {
      return secure(await next());
    }

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

    const isCheckoutDocument = pathname === "/checkout" || pathname === "/checkout/";

    if (isCheckoutDocument) {
      const approved = await requireApprovedSession({ cookies: context.cookies });
      if (!approved) {
        return secure(withNoCache(context.redirect("/?mode=login&next=%2Fcheckout", 303)));
      }
    }

    let response = await next();

    if (normalizeCanonicalPath(pathname) === "/account") {
      response = withNoindexFollow(response);
    }

    return secure(isCheckoutDocument ? withNoCache(response) : response);
  }

  if (pathname === "/launch" || pathname === "/launch/") {
    return secure(withNoCache(await next()));
  }

  const response = await next("/launch");
  const protectedResponse = withNoCache(response);
  protectedResponse.headers.set("X-Robots-Tag", "noindex");

  return secure(protectedResponse);
});
