export const prerender = false;

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function POST({ request }) {
  try {
    const body = await request.json();

    const productId = Number(body.productId);
    const variationId = Number(body.variationId || 0);
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();

    if (!productId) {
      return jsonResponse(
        {
          success: false,
          message: "Product ID is required.",
        },
        400
      );
    }

    if (!isValidEmail(email)) {
      return jsonResponse(
        {
          success: false,
          message: "Please enter a valid email address.",
        },
        400
      );
    }

    const wpUrl =
      import.meta.env.WP_URL ||
      import.meta.env.PUBLIC_WP_URL ||
      import.meta.env.WORDPRESS_URL ||
      import.meta.env.PUBLIC_WORDPRESS_URL;

    if (!wpUrl) {
      return jsonResponse(
        {
          success: false,
          message: "WordPress URL is not configured.",
        },
        500
      );
    }

    const cleanWpUrl = wpUrl.replace(/\/$/, "");

    const nonceResponse = await fetch(
      `${cleanWpUrl}/wp-json/rgv/v1/instock-notifier/nonce?product_id=${productId}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      }
    );

    const nonceData = await nonceResponse.json().catch(() => null);

    if (!nonceResponse.ok || !nonceData?.success) {
      return jsonResponse(
        {
          success: false,
          message: "Could not prepare the notifier request.",
          details: nonceData,
        },
        500
      );
    }

    const formData = new URLSearchParams();

    formData.set("action", "cwginstock_product_subscribe");
    formData.set("product_id", String(productId));
    formData.set("variation_id", String(variationId || 0));
    formData.set("subscriber_name", name);
    formData.set("subscriber_phone", "");
    formData.set("subscriber_phone_meta", "");
    formData.set("user_email", email);
    formData.set("user_id", "0");
    formData.set("security", nonceData.product_nonce);

    const subscribeResponse = await fetch(
      nonceData.ajax_url || `${cleanWpUrl}/wp-admin/admin-ajax.php`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-WP-Nonce": nonceData.security,
        },
        body: formData.toString(),
      }
    );

    const rawText = await subscribeResponse.text();

    let parsedResponse = null;

    try {
      parsedResponse = JSON.parse(rawText);
    } catch {
      parsedResponse = null;
    }

    if (!subscribeResponse.ok) {
      return jsonResponse(
        {
          success: false,
          message: "Could not save your notification request.",
          details: parsedResponse || rawText,
        },
        500
      );
    }

    return jsonResponse({
      success: true,
      message:
        parsedResponse?.msg ||
        parsedResponse?.message ||
        "You are on the list. We will notify you when this product is back in stock.",
      details: parsedResponse,
    });
  } catch (error) {
    console.error("Back in stock notifier error:", error);

    return jsonResponse(
      {
        success: false,
        message: "Something went wrong. Please try again.",
      },
      500
    );
  }
}