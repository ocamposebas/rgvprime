export const prerender = false;

import {
  checkRateLimit,
  isRequestBodyTooLarge,
  requestSecurityResponse,
} from "../../lib/requestSecurity";

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function getSafeAjaxUrl(candidate, wordpressUrl) {
  const fallback = new URL("/wp-admin/admin-ajax.php", wordpressUrl);

  try {
    const endpoint = new URL(String(candidate || fallback), wordpressUrl);
    return endpoint.origin === fallback.origin ? endpoint.toString() : fallback.toString();
  } catch {
    return fallback.toString();
  }
}

export async function POST({ request }) {
  if (isRequestBodyTooLarge(request, 16 * 1024)) {
    return requestSecurityResponse("Request is too large.", 413);
  }

  const rate = checkRateLimit(request, {
    namespace: "back-in-stock",
    limit: 10,
    windowMs: 60 * 60 * 1000,
  });

  if (!rate.allowed) {
    return requestSecurityResponse(
      "Too many subscription attempts. Please wait and try again.",
      429,
      rate.retryAfter,
    );
  }

  try {
    const body = await request.json();

    const productId = Number(body.productId);
    const variationId = Number(body.variationId || 0);
    const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
    const name = String(body.name || "").trim().slice(0, 120);

    if (!Number.isSafeInteger(productId) || productId <= 0) {
      return jsonResponse(
        {
          success: false,
          message: "Product ID is required.",
        },
        400
      );
    }

    if (!Number.isSafeInteger(variationId) || variationId < 0) {
      return jsonResponse(
        {
          success: false,
          message: "Variation ID is invalid.",
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
      getSafeAjaxUrl(nonceData.ajax_url, cleanWpUrl),
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
