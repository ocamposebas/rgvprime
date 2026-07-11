import { defineMiddleware } from "astro:middleware";

const launchDate =
  import.meta.env.PUBLIC_LAUNCH_DATE ||
  "2026-07-11T14:00:00-05:00";

const launchTime = new Date(launchDate).getTime();

const allowedStaticPrefixes = [
  "/_astro/",
  "/images/",
  "/fonts/",
  "/videos/",
  "/assets/",
];

const allowedStaticFiles = [
  "/logo.png",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap-index.xml",
];

function isStaticAsset(pathname: string) {
  if (allowedStaticFiles.includes(pathname)) {
    return true;
  }

  if (allowedStaticPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }

  return /\.(?:css|js|mjs|png|jpg|jpeg|webp|avif|svg|gif|ico|woff|woff2|ttf|mp4|webm)$/i.test(
    pathname,
  );
}

export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname;
  const method = context.request.method;
  const storeIsOpen = Date.now() >= launchTime;

  /*
   * No interferir con formularios, webhooks o endpoints.
   */
  if (method !== "GET" && method !== "HEAD") {
    return next();
  }

  /*
   * Permitir recursos necesarios para cargar la página.
   */
  if (isStaticAsset(pathname)) {
    return next();
  }

  /*
   * Permitir endpoints API.
   */
  if (pathname.startsWith("/api/")) {
    return next();
  }

  /*
   * Después de la apertura, la página /launch
   * deja de estar disponible y envía a la tienda.
   */
  if (storeIsOpen) {
    if (pathname === "/launch") {
      return context.redirect("/", 302);
    }

    return next();
  }

  /*
   * Antes de la apertura, permitir que Astro
   * renderice directamente la página interna del launch.
   */
  if (pathname === "/launch") {
    const response = await next();

    const headers = new Headers(response.headers);

    headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, max-age=0",
    );
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  /*
   * Cualquier otra ruta muestra el launch.
   *
   * La dirección del navegador no cambia:
   * /, /shop, /product/... y cualquier otra ruta
   * mostrarán el contenido de /launch.
   */
  const response = await next("/launch");

  const headers = new Headers(response.headers);

  headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0",
  );
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  headers.set("X-Robots-Tag", "noindex");

  return new Response(response.body, {
    status: 200,
    statusText: response.statusText,
    headers,
  });
});