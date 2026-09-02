import { PERMANENT_PRODUCT_REDIRECTS } from "../lib/seo";

export const prerender = false;

const SITE_URL = "https://rgvprimellc.com";

const STATIC_PAGES = [
  "/",
  "/shop",
  "/coa",
  "/contact",
  "/faq",
  "/policies",
  "/track-order",
];

// Keeps the sitemap complete if WooCommerce is temporarily unavailable while
// the request is being generated. The live API response replaces this list
// whenever it is reachable.
const ACTIVE_PRODUCT_SLUGS = [
  "5amino-1mq-50mg",
  "acetic-acid-3ml",
  "adamax-10mg",
  "ahk-cu-100mg",
  "aod-9604",
  "ara-290-10mg",
  "bpc-157-10mg",
  "bpc-tb",
  "cartalax-20mg",
  "cjc-ipa-no-dac-10mg",
  "detoxione-1200mg",
  "dsip-10mg",
  "e-recon-water-30ml",
  "epithalon-10mg",
  "ghk-cu",
  "ghk-cu-cap",
  "ghkkpv-60mg",
  "glow-70mg",
  "guthione-1200mg",
  "hosp-recon-water",
  "igf1-lr3-1mg",
  "ipamorelin-10mg",
  "kisspeptin-10mg",
  "klow-80mg",
  "korean-gluta-1200mg",
  "kpv-10mg",
  "l-carnitine-600mg",
  "lemon-bottle-10ml",
  "lipo-c-b12-10ml",
  "ll-37-5mg",
  "mots-c",
  "mt1-10mg",
  "mt2-10mg",
  "nad-500mg",
  "pt-141-10mg",
  "raw-ghk-1g",
  "recon-water",
  "rg-cag",
  "rg-pump-10ml",
  "rg-rt",
  "rg-tesa",
  "rg-tz",
  "rgv-lipo-b",
  "selank-10mg",
  "semax-10mg",
  "semaxselank-20mg",
  "snap8-10mg",
  "ss-31",
];

const RETIRED_PRODUCT_SLUGS = new Set(PERMANENT_PRODUCT_REDIRECTS.keys());

function escapeXml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeLastModified(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function renderUrlEntry({ path, lastModified }) {
  const location = new URL(path, SITE_URL).toString();
  const lastmod = normalizeLastModified(lastModified);

  return [
    "  <url>",
    `    <loc>${escapeXml(location)}</loc>`,
    ...(lastmod ? [`    <lastmod>${escapeXml(lastmod)}</lastmod>`] : []),
    "  </url>",
  ].join("\n");
}

export async function GET({ url }) {
  let products = ACTIVE_PRODUCT_SLUGS.map((slug) => ({ slug }));

  try {
    const response = await fetch(new URL("/api/products?limit=100", url.origin), {
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    });

    if (response.ok) {
      const payload = await response.json();
      if (Array.isArray(payload?.products) && payload.products.length > 0) {
        products = payload.products;
      }
    }
  } catch {}

  const productPages = products
    .filter((product) => {
      const slug = String(product?.slug || "").trim();
      return slug && !RETIRED_PRODUCT_SLUGS.has(slug);
    })
    .map((product) => ({
      path: `/product/${encodeURIComponent(product.slug)}`,
      lastModified: product.date_modified_gmt || product.date_modified,
    }));

  const entries = [
    ...STATIC_PAGES.map((path) => ({ path })),
    ...productPages,
  ];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(renderUrlEntry),
    "</urlset>",
    "",
  ].join("\n");

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
