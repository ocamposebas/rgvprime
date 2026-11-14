import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildProductOffer,
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
  const checkoutTemplate = readFileSync(
    new URL("../src/pages/checkout.astro", import.meta.url),
    "utf8",
  );

  assert.match(checkoutTemplate, /noindex=\{true\}/);
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
  const productUrl = `${SITE_URL}/product/ss-31`;
  const price = { currentPrice: 24, currency: "USD" };
  const offer = buildProductOffer(product.variations[0], price, productUrl);
  assert.equal(offer["@type"], "Offer");
  assert.equal(offer.price, "24.00");
  assert.equal(offer.availability, "https://schema.org/InStock");
  assert.equal(offer.priceCurrency, "USD");
  assert.equal(offer.url, productUrl);
  assert.equal(offer.sku, "SS-31-SINGLE-10MG");
  assert.equal(
    buildProductOffer({ ...product.variations[0], stock_quantity: 0, backorders_allowed: true }, price, productUrl).availability,
    "https://schema.org/BackOrder",
  );
  assert.equal(buildProductOffer(product, { currentPrice: null }, productUrl), null);
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

function getJsonLdSchemas(html) {
  return [
    ...html.matchAll(
      /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ].map((match) => JSON.parse(match[1]));
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

  const home = await assertPage("/", {
    canonical: `${SITE_URL}/`,
    title: "Research Peptides and Laboratory Products | RGVPRIME LLC",
  });
  const organizationSchema = getJsonLdSchemas(home.html).find(
    (schema) => schema?.["@type"] === "OnlineStore",
  );
  assert.equal(organizationSchema?.email, "sales@rgvprimellc.com");
  assert.equal(organizationSchema?.telephone, "+1-956-540-8538");
  assert.equal(organizationSchema?.contactPoint?.areaServed, "US");

  const shop = await assertPage("/shop", {
    canonical: `${SITE_URL}/shop`,
    title: "Research Peptides and Laboratory Product Catalog | RGVPRIME LLC",
  });
  const shopCollectionSchema = getJsonLdSchemas(shop.html).find(
    (schema) => schema?.["@type"] === "CollectionPage",
  );
  assert.equal(shopCollectionSchema?.url, `${SITE_URL}/shop`);
  assert.ok(
    shopCollectionSchema?.mainEntity?.itemListElement?.length > 0,
    "Shop ItemList contains products",
  );
  assert.match(shop.html, /href="\/shop\?page=2"/i);

  const shopPageTwo = await assertPage("/shop?page=2", {
    canonical: `${SITE_URL}/shop?page=2`,
  });
  assert.ok(
    /aria-label="Page 2" aria-current="page"/.test(shopPageTwo.html),
    "Page 2 is marked as the current page",
  );
  assert.match(shopPageTwo.html, /href="\/shop" aria-label="Previous page"/i);

  const shopPageTwoSchema = getJsonLdSchemas(shopPageTwo.html).find(
    (schema) => schema?.["@type"] === "CollectionPage",
  );
  const firstPageUrls = new Set(
    shopCollectionSchema.mainEntity.itemListElement.map(({ url }) => url),
  );
  const secondPageItems = shopPageTwoSchema?.mainEntity?.itemListElement;
  assert.ok(secondPageItems?.length > 0, "Page 2 ItemList contains products");
  for (const { url } of secondPageItems) {
    assert.ok(!firstPageUrls.has(url), `Page 2 repeats ${url} from page 1`);
    assert.ok(shopPageTwo.html.includes(`href="${new URL(url).pathname}"`));
  }

  const missingShopPage = await fetchManual("/shop?page=999");
  assert.equal(missingShopPage.status, 404);
  const coa = await assertPage("/coa", { canonical: `${SITE_URL}/coa` });
  assert.match(coa.html, /href="\/research-guides\/how-to-read-a-certificate-of-analysis"/i);
  assert.ok(coa.html.includes('href="/research-guides/find-a-coa-by-lot-number"'));

  await assertPage("/track-order", {
    canonical: `${SITE_URL}/track-order`,
    title: "Track an RGVPRIME Order | Status and Shipping Updates | RGVPRIME LLC",
  });

  const faq = await assertPage("/faq", {
    canonical: `${SITE_URL}/faq`,
    title: "Ordering, COA and Shipping FAQ | RGVPRIME LLC",
  });
  const faqSchema = getJsonLdSchemas(faq.html).find(
    (schema) => schema?.["@type"] === "FAQPage",
  );
  assert.equal(faqSchema?.mainEntity?.length, 6);
  assert.ok(
    faqSchema.mainEntity.every(
      (question) =>
        question?.["@type"] === "Question" &&
        question?.acceptedAnswer?.["@type"] === "Answer",
    ),
  );

  await assertPage("/research-guides", {
    canonical: `${SITE_URL}/research-guides`,
    title: "Research Documentation Guides | RGVPRIME LLC",
  });
  await assertPage("/research-guides/how-to-read-a-certificate-of-analysis", {
    canonical: `${SITE_URL}/research-guides/how-to-read-a-certificate-of-analysis`,
    title: "How to Read a Certificate of Analysis (COA) | RGVPRIME LLC",
  });
  const lotGuidePath = "/research-guides/find-a-coa-by-lot-number";
  const lotGuide = await assertPage(lotGuidePath, {
    canonical: `${SITE_URL}${lotGuidePath}`,
    title: "How to Find a Certificate of Analysis by Lot Number | RGVPRIME LLC",
  });
  assert.ok(lotGuide.html.includes('<form action="/coa" method="get"'));
  assert.ok(lotGuide.html.includes('name="q"'));
  assert.equal(
    getJsonLdSchemas(lotGuide.html).find((schema) => schema?.["@type"] === "Article")?.url,
    `${SITE_URL}${lotGuidePath}`,
  );
  await assertPage("/research-guides/research-product-documentation", {
    canonical: `${SITE_URL}/research-guides/research-product-documentation`,
    title:
      "Research Product Documentation: SKU, Lot and COA Guide | RGVPRIME LLC",
  });
  await assertPage("/research-guides/order-processing-and-tracking", {
    canonical: `${SITE_URL}/research-guides/order-processing-and-tracking`,
    title: "Order Processing and Shipment Tracking Guide | RGVPRIME LLC",
  });

  const account = await assertPage("/account", {
    robots: "noindex, follow, noarchive",
  });
  assert.equal(
    account.response.headers.get("x-robots-tag"),
    "noindex, follow, noarchive",
  );

  for (const slug of ["rg-rt", "rg-tz", "ll-37-5mg", "ss-31", "elora-10mg"]) {
    const { html } = await assertPage(`/product/${slug}`, {
      canonical: `${SITE_URL}/product/${slug}`,
    });
    const schemas = getJsonLdSchemas(html)
      .filter((schema) => schema?.["@type"] === "Product");

    assert.equal(schemas.length, 1, `${slug} Product schema count`);
    assert.equal(schemas[0].url, `${SITE_URL}/product/${slug}`);
    assert.equal(schemas[0].brand?.name, "RGVPRIME");
    assert.equal(schemas[0].itemCondition, "https://schema.org/NewCondition");
    const offer = schemas[0].offers;
    assert.equal(offer?.["@type"], "Offer");
    assert.ok(Number(offer?.price) > 0);
    assert.equal(offer?.seller?.["@id"], `${SITE_URL}/#organization`);
    const displayedSku = getTagContent(html, /class="rgv-product-sku">([^<]+)<\/span>/i);
    assert.equal(offer?.sku, displayedSku, `${slug} offer matches the visible selection`);
    assert.ok(
      html.includes(`$${offer.price}`),
      `${slug} structured price appears in the page`,
    );
    if (slug === "elora-10mg") {
      assert.ok(html.includes("Listed as a single vial or a 10-vial kit."));
      assert.ok(html.includes('href="/coa?product='));
    }
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
    const productSchemas = getJsonLdSchemas(html)
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
    assert.equal(productSchemas[0].brand?.name, "RGVPRIME");
    assert.equal(
      productSchemas[0].itemCondition,
      "https://schema.org/NewCondition",
    );
    assert.equal(productSchemas[0].offers?.url, canonical);
    assert.equal(productSchemas[0].offers?.priceCurrency, "USD");
    assert.match(
      productSchemas[0].offers?.availability || "",
      /^https:\/\/schema\.org\/(?:InStock|OutOfStock|BackOrder)$/,
    );

    assert.equal(productSchemas[0].offers?.["@type"], "Offer");
    assert.ok(Number(productSchemas[0].offers?.price) > 0);

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
  assert.doesNotMatch(robotsText, /Disallow:\s*\/checkout/i);

  const checkout = await fetchManual("/checkout");
  assert.equal(checkout.status, 303);
  assert.equal(
    checkout.headers.get("x-robots-tag"),
    "noindex, follow, noarchive",
  );

  const sitemap = await fetchManual("/sitemap.xml");
  const sitemapText = await sitemap.text();
  assert.equal(sitemap.status, 200);
  assert.match(sitemapText, /\/product\/ll-37-5mg<\/loc>/);
  assert.match(sitemapText, /\/product\/ss-31<\/loc>/);
  assert.match(sitemapText, /\/research-guides<\/loc>/);
  assert.ok(sitemapText.includes(`${SITE_URL}${lotGuidePath}</loc>`));
  assert.match(
    sitemapText,
    /\/research-guides\/how-to-read-a-certificate-of-analysis<\/loc>/,
  );
  assert.match(
    sitemapText,
    /\/research-guides\/research-product-documentation<\/loc>/,
  );
  assert.match(
    sitemapText,
    /\/research-guides\/order-processing-and-tracking<\/loc>/,
  );
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
