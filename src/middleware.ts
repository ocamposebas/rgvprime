import { defineMiddleware } from "astro:middleware";
import {
  isStoreOpen,
  OPEN_COOKIE_NAME,
} from "./lib/launch-config";

const publicPrefixes = [
  "/_astro/",
  "/_server-islands/",
  "/api/",
  "/images/",
  "/fonts/",
  "/videos/",
  "/assets/",
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
    /\.(?:css|js|mjs|map|json|png|jpe?g|webp|avif|svg|gif|ico|woff2?|ttf|mp4|webm)$/i.test(
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

export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname;
  const method = context.request.method;

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