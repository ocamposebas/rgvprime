export const prerender = false;

function cleanUrl(value = "") {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

function unavailable(reason) {
  return {
    active: false,
    available: false,
    reason,
    inventory_limit: 150,
    remaining: 0,
    product_name: "Mystery Vial Complimentary",
    product_sku: "RGV-MYSTERY-VIAL",
    tiers: [
      { minimum: 60, quantity: 1 },
      { minimum: 150, quantity: 2 },
    ],
  };
}

export async function GET() {
  const wordpressUrl = cleanUrl(
    import.meta.env.PUBLIC_WP_URL ||
      import.meta.env.WC_API_URL ||
      import.meta.env.WORDPRESS_URL ||
      import.meta.env.WP_URL,
  );

  if (!wordpressUrl) return json(unavailable("missing_wordpress_url"));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(
      `${wordpressUrl}/wp-json/rgv-mystery/v1/status`,
      {
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      },
    );

    if (!response.ok) {
      return json(unavailable(`wordpress_${response.status}`));
    }

    const payload = await response.json();
    const tiers = Array.isArray(payload?.tiers)
      ? payload.tiers.slice(0, 4).map((tier) => ({
          minimum: Math.max(0, Number(tier?.minimum || 0)),
          quantity: Math.max(0, Math.floor(Number(tier?.quantity || 0))),
        }))
      : unavailable("invalid_tiers").tiers;

    return json({
      active: payload?.active === true,
      available: payload?.available === true,
      inventory_limit: Math.max(
        0,
        Math.floor(Number(payload?.inventory_limit || 0)),
      ),
      remaining: Math.max(0, Math.floor(Number(payload?.remaining || 0))),
      product_name: String(
        payload?.product_name || "Mystery Vial Complimentary",
      ).slice(0, 120),
      product_sku: String(
        payload?.product_sku || "RGV-MYSTERY-VIAL",
      ).slice(0, 80),
      tiers,
      calculation: String(payload?.calculation || "").slice(0, 100),
      updated_at: payload?.updated_at || new Date().toISOString(),
    });
  } catch (error) {
    return json(
      unavailable(
        error?.name === "AbortError"
          ? "wordpress_timeout"
          : "wordpress_unavailable",
      ),
    );
  } finally {
    clearTimeout(timeout);
  }
}

