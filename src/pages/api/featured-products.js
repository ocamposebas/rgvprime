export async function GET() {
  const wcUrl = import.meta.env.WC_API_URL || import.meta.env.PUBLIC_WP_URL;
  const consumerKey = import.meta.env.WC_CONSUMER_KEY;
  const consumerSecret = import.meta.env.WC_CONSUMER_SECRET;

  if (!wcUrl || !consumerKey || !consumerSecret) {
    return new Response(
      JSON.stringify(
        {
          success: false,
          message: "Missing WooCommerce API environment variables.",
          received: {
            WC_API_URL: Boolean(import.meta.env.WC_API_URL),
            PUBLIC_WP_URL: Boolean(import.meta.env.PUBLIC_WP_URL),
            WC_CONSUMER_KEY: Boolean(consumerKey),
            WC_CONSUMER_SECRET: Boolean(consumerSecret),
          },
        },
        null,
        2
      ),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }

  const cleanUrl = wcUrl.replace(/\/$/, "");
  const endpoint = new URL(`${cleanUrl}/wp-json/wc/v3/products`);

  endpoint.searchParams.set("status", "publish");
  endpoint.searchParams.set("stock_status", "instock");
  endpoint.searchParams.set("per_page", "4");
  endpoint.searchParams.set("orderby", "date");
  endpoint.searchParams.set("order", "desc");
  endpoint.searchParams.set("featured", "true");

  endpoint.searchParams.set("consumer_key", consumerKey);
  endpoint.searchParams.set("consumer_secret", consumerSecret);

  try {
    const response = await fetch(endpoint.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    const rawText = await response.text();

    if (!response.ok) {
      return new Response(
        JSON.stringify(
          {
            success: false,
            message: "WooCommerce API request failed.",
            status: response.status,
            statusText: response.statusText,
            request_url: endpoint
              .toString()
              .replace(consumerKey, "HIDDEN_KEY")
              .replace(consumerSecret, "HIDDEN_SECRET"),
            response_preview: rawText.slice(0, 1600),
          },
          null,
          2
        ),
        {
          status: response.status,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    let products;

    try {
      products = JSON.parse(rawText);
    } catch (error) {
      return new Response(
        JSON.stringify(
          {
            success: false,
            message: "WooCommerce did not return valid JSON.",
            response_preview: rawText.slice(0, 1600),
          },
          null,
          2
        ),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    const mappedProducts = products.map((product) => {
      const image =
        product.images && product.images.length > 0
          ? product.images[0].src
          : "/logo.webp";

      const categories =
        product.categories && product.categories.length > 0
          ? product.categories.map((category) => ({
              id: category.id,
              name: category.name,
              slug: category.slug,
            }))
          : [];

      return {
        id: product.id,
        name: product.name,
        slug: product.slug,
        type: product.type,
        price: product.price,
        regular_price: product.regular_price,
        sale_price: product.sale_price,
        price_html: product.price_html,
        description: product.description,
        short_description: product.short_description,
        image,
        stock_status: product.stock_status,
        stock_quantity: product.stock_quantity,
        manage_stock: product.manage_stock,
        backorders_allowed: product.backorders_allowed,
        featured: product.featured,
        categories,
        permalink: product.permalink,
      };
    });

    return new Response(
      JSON.stringify(
        {
          success: true,
          count: mappedProducts.length,
          products: mappedProducts,
        },
        null,
        2
      ),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify(
        {
          success: false,
          message: "Server could not reach WooCommerce.",
          error: error.message,
          request_url: endpoint
            .toString()
            .replace(consumerKey, "HIDDEN_KEY")
            .replace(consumerSecret, "HIDDEN_SECRET"),
        },
        null,
        2
      ),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
}