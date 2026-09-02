import assert from "node:assert/strict";
import {
  buildProductOffers,
  getPermanentProductRedirect,
  getProductImageAlt,
  getProductSeo,
  getPublicProductSlug,
  getWooProductSlug,
  normalizeCanonicalPath,
  PERMANENT_PRODUCT_REDIRECTS,
} from "../src/lib/seo.js";

const SITE_URL = "https://rgvprimellc.com";
const baseUrl = String(process.env.SEO_BASE_URL || "").replace(/\/$/, "");

function assertHelperBehavior() {
  assert.equal(getPublicProductSlug("ll-375-5mg"), "ll-37-5mg");
  assert.equal(getWooProductSlug("ll-37-5mg"), "ll-375-5mg");
  assert.equal(getPublicProductSlug("ss-31-10mg"), "ss-31");
  assert.equal(getWooProductSlug("ss-31"), "ss-31-10mg");
  assert.equal(getPermanentProductRedirect("Retatrutide-20MG"), "/product/rg-rt");
  assert.equal(getPermanentProductRedirect("Tirzepatide-40MG"), "/product/rg-tz");
  assert.equal(normalizeCanonicalPath("/SHOP///"), "/shop");

  for (const target of PERMANENT_PRODUCT_REDIRECTS.values()) {
    const targetSlug = target.split("/").filter(Boolean).at(-1);
    assert.equal(
      getPermanentProductRedirect(targetSlug),
      undefined,
      `Redirect target ${target} must not redirect again`,
    );
  }

  const product = {
    name: "SS-31",
    slug: "ss-31-10mg",
    sku: "SS-31-10MG",
    type: "variable",
    categories: [{ slug: "research-peptides" }],
    variations: [
      {
        id: 1,
        sku: "SS-31-SINGLE-10MG",
        price: "24",
        stock_status: "instock",
        purchasable: true,
      },
      {
        id: 2,
        sku: "SS-31-SINGLE-50MG",
        price: "70",
        stock_status: "outofstock",
        purchasable: true,
      },
    ],
  };
  const offers = buildProductOffers(product, `${SITE_URL}/product/ss-31`);

  assert.equal(offers["@type"], "AggregateOffer");
  assert.equal(offers.lowPrice, "24.00");
  assert.equal(offers.highPrice, "70.00");
  assert.equal(offers.offerCount, 2);
  assert.equal(offers.priceCurrency, "USD");
  assert.equal(offers.url, `${SITE_URL}/product/ss-31`);
  assert.equal(offers.offers.length, 2);
  assert.equal(getProductImageAlt(product), "SS-31 laboratory research product");

  const seo = getProductSeo(product);
  assert.match(seo.title, /^SS-31 /);
  assert.match(seo.description, /SS-31/);
  assert.doesNotMatch(
    `${seo.title} ${seo.description}`,
    /human|therapeutic|weight[ -]?loss|recovery|performance|dosing|injection|administration/i,
  );
}

function getTagContent(html, pattern) {
  return html.match(pattern)?.[1] || "";
}

async function fetchManual(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    ...options,
  });
}

async function assertRedirect(path, status, location) {
  const response = await fetchManual(path);
  assert.equal(response.status, status, `${path} redirect status`);
  assert.equal(
    new URL(response.headers.get("location"), baseUrl).pathname,
    location,
    `${path} redirect target`,
  );
}

async function assertCanonicalRedirect(path, { host, protocol, status, location }) {
  const response = await fetchManual(path, {
    headers: {
      "x-forwarded-host": host,
      "x-forwarded-proto": protocol,
    },
  });

  assert.equal(response.status, status, `${protocol}://${host}${path} status`);
  assert.equal(response.headers.get("location"), location);
}

async function assertPage(path, { canonical, title, robots } = {}) {
  const response = await fetchManual(path);
  const html = await response.text();

  assert.equal(response.status, 200, `${path} status`);

  if (canonical) {
    assert.equal(
      getTagContent(html, /<link rel="canonical" href="([^"]+)"/i),
      canonical,
      `${path} canonical`,
    );
  }

  if (title) {
    assert.equal(getTagContent(html, /<title>([^<]+)<\/title>/i), title);
  }

  if (robots) {
    assert.equal(
      getTagContent(html, /<meta name="robots" content="([^"]+)"/i),
      robots,
      `${path} robots`,
    );
  }

  return { response, html };
}

async function assertIntegration() {
  await assertCanonicalRedirect("/SHOP/?page=2", {
    host: "rgvprimellc.com",
    protocol: "https",
    status: 308,
    location: `${SITE_URL}/shop?page=2`,
  });
  await assertCanonicalRedirect("/shop", {
    host: "www.rgvprimellc.com",
    protocol: "https",
    status: 308,
    location: `${SITE_URL}/shop`,
  });
  await assertCanonicalRedirect("/shop", {
    host: "rgvprimellc.com",
    protocol: "http",
    status: 308,
    location: `${SITE_URL}/shop`,
  });
  await assertCanonicalRedirect("/PRODUCT/RETATRUTIDE-20MG/", {
    host: "www.rgvprimellc.com",
    protocol: "http",
    status: 301,
    location: `${SITE_URL}/product/rg-rt`,
  });

  await assertRedirect("/product/ll-375-5mg", 301, "/product/ll-37-5mg");
  await assertRedirect("/product/ss-31-10mg", 301, "/product/ss-31");
  await assertRedirect("/product/retatrutide-30mg", 301, "/product/rg-rt");
  await assertRedirect("/product/tirzepatide-40mg", 301, "/product/rg-tz");

  await assertPage("/", {
    canonical: `${SITE_URL}/`,
    title: "Laboratory Research Products | RGVPRIME LLC",
  });
  await assertPage("/shop", {
    canonical: `${SITE_URL}/shop`,
    title: "Research Product Catalog | RGVPRIME LLC",
  });
  await assertPage("/track-order", {
    canonical: `${SITE_URL}/track-order`,
    title: "Track Your Order | RGVPRIME LLC",
  });

  const account = await assertPage("/account", {
    robots: "noindex, follow, noarchive",
  });
  assert.equal(
    account.response.headers.get("x-robots-tag"),
    "noindex, follow, noarchive",
  );

  for (const slug of ["rg-rt", "rg-tz", "ll-37-5mg", "ss-31"]) {
    const { html } = await assertPage(`/product/${slug}`, {
      canonical: `${SITE_URL}/product/${slug}`,
    });
    const schemas = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
      .map((match) => JSON.parse(match[1]))
      .filter((schema) => schema?.["@type"] === "Product");

    assert.equal(schemas.length, 1, `${slug} Product schema count`);
    assert.equal(schemas[0].url, `${SITE_URL}/product/${slug}`);
    assert.equal(schemas[0].offers?.["@type"], "AggregateOffer");
    assert.ok(Number(schemas[0].offers?.offerCount) > 0);
    assert.ok(Number(schemas[0].offers?.lowPrice) > 0);
    assert.ok(Number(schemas[0].offers?.highPrice) >= Number(schemas[0].offers?.lowPrice));
  }

  const catalogResponse = await fetchManual("/api/products?limit=100");
  const catalog = await catalogResponse.json();
  const productTitles = new Set();
  const productDescriptions = new Set();
  const prohibitedMetadataTerms =
    /human|therapeutic|weight[ -]?loss|recovery|performance|dosing|injection|administration/i;

  assert.equal(catalogResponse.status, 200);
  assert.ok(catalog.products.length > 0);

  for (const product of catalog.products) {
    const response = await fetchManual(`/product/${product.slug}`);
    const html = await response.text();
    const title = getTagContent(html, /<title>([^<]+)<\/title>/i);
    const description = getTagContent(
      html,
      /<meta name="description" content="([^"]+)"/i,
    );
    const canonical = getTagContent(
      html,
      /<link rel="canonical" href="([^"]+)"/i,
    );
    const productSchemas = [
      ...html.matchAll(
        /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
      ),
    ]
      .map((match) => JSON.parse(match[1]))
      .filter((schema) => schema?.["@type"] === "Product");

    assert.equal(response.status, 200, `${product.slug} page status`);
    assert.equal(canonical, `${SITE_URL}/product/${product.slug}`);
    assert.ok(title && !productTitles.has(title), `${product.slug} unique title`);
    assert.ok(
      description && !productDescriptions.has(description),
      `${product.slug} unique description`,
    );
    assert.ok(description.length <= 160, `${product.slug} description length`);
    assert.doesNotMatch(`${title} ${description}`, prohibitedMetadataTerms);
    assert.ok(product.image_alt?.length > 10, `${product.slug} meaningful image alt`);
    assert.doesNotMatch(product.image_alt, /phase one|normalized|product image/i);
    assert.ok(product.sku, `${product.slug} parent SKU`);
    assert.equal(productSchemas.length, 1, `${product.slug} Product schema`);
    assert.equal(productSchemas[0].url, canonical);
    assert.equal(productSchemas[0].sku, product.sku);
    assert.equal(productSchemas[0].offers?.url, canonical);
    assert.equal(productSchemas[0].offers?.priceCurrency, "USD");
    assert.match(
      productSchemas[0].offers?.availability || "",
      /^https:\/\/schema\.org\/(?:InStock|OutOfStock)$/,
    );

    if (product.type === "variable") {
      assert.equal(productSchemas[0].offers?.["@type"], "AggregateOffer");
      assert.ok(Number(productSchemas[0].offers?.offerCount) > 0);
      assert.ok(Number(productSchemas[0].offers?.lowPrice) > 0);
      assert.ok(
        Number(productSchemas[0].offers?.highPrice) >=
          Number(productSchemas[0].offers?.lowPrice),
      );
    } else {
      assert.equal(productSchemas[0].offers?.["@type"], "Offer");
      assert.ok(Number(productSchemas[0].offers?.price) > 0);
    }

    productTitles.add(title);
    productDescriptions.add(description);
  }

  const missing = await fetchManual("/product/definitely-missing-product");
  const missingHtml = await missing.text();

  assert.equal(missing.status, 404);
  assert.match(missingHtml, /<title>Product Not Found \| RGVPRIME LLC<\/title>/i);
  assert.match(missingHtml, /<meta name="robots" content="noindex, follow, noarchive"/i);
  assert.doesNotMatch(missingHtml, /rel="canonical"/i);
  assert.doesNotMatch(missingHtml, /property="og:/i);
  assert.doesNotMatch(missingHtml, /name="twitter:/i);

  const robots = await fetchManual("/robots.txt");
  const robotsText = await robots.text();
  assert.equal(robots.status, 200);
  assert.doesNotMatch(robotsText, /Disallow:\s*\/account/i);

  const sitemap = await fetchManual("/sitemap.xml");
  const sitemapText = await sitemap.text();
  assert.equal(sitemap.status, 200);
  assert.match(sitemapText, /\/product\/ll-37-5mg<\/loc>/);
  assert.match(sitemapText, /\/product\/ss-31<\/loc>/);
  assert.doesNotMatch(sitemapText, /\/product\/ll-375-5mg<\/loc>/);
  assert.doesNotMatch(sitemapText, /\/product\/ss-31-10mg<\/loc>/);
}

assertHelperBehavior();

if (baseUrl) {
  await assertIntegration();
  console.log(`SEO checks passed against ${baseUrl}`);
} else {
  console.log("SEO helper checks passed (set SEO_BASE_URL for integration checks)");
}
