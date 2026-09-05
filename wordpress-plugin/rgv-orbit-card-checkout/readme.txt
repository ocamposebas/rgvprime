=== RGV ORBIT Card Checkout ===
Contributors: rgvprime
Requires at least: 6.4
Requires PHP: 7.4
Requires Plugins: woocommerce
Stable tag: 1.0.2

Standalone embedded credit and debit card checkout branded as ORBIT. It does
not replace or modify the RGV Zelle Checkout plugin.

== Setup ==

Add the four processor credentials as private environment variables on the
WordPress service/container. Start with Sandbox:

WOMPI_PUBLIC_KEY=pub_test_REPLACE_ME
WOMPI_PRIVATE_KEY=prv_test_REPLACE_ME
WOMPI_INTEGRITY_SECRET=test_integrity_REPLACE_ME
WOMPI_EVENTS_SECRET=test_events_REPLACE_ME

The plugin automatically obtains the currently valid official Colombian TRM
from the Superfinanciera dataset on datos.gov.co. It caches the result for six
hours and can use its last successful result for up to three days if the service
has a temporary outage. Checkout fails closed if no safe rate is available.

WOMPI_COP_PER_USD is optional. Set it only when a deliberate manual rate must
override the official TRM.

Restart or redeploy the WordPress service after saving the variables. Do not add
these values to the Astro/frontend service. Constants in wp-config.php remain a
supported fallback, but are not required.

Configure the matching environment event URL in the processor dashboard:

https://YOUR-WORDPRESS-DOMAIN/wp-json/rgv/v1/orbit-card-events

The form stays embedded in the RGV storefront. Card number and CVC are JWE
encrypted in the browser and sent directly to the card processor. Only the
resulting token is submitted to the storefront and WordPress servers.

== Changelog ==

= 1.0.2 =
* Limits embedded ORBIT card checkout to orders of $150.00 USD or less.

= 1.0.1 =
* Automatically obtains and safely caches the official Colombian TRM.
* Makes the manual USD-to-COP environment variable optional.

= 1.0.0 =
* Adds standalone embedded ORBIT card fields and encrypted tokenization.
* Creates authoritative WooCommerce card orders.
* Verifies status server-side and processes signed transaction events.
* Prevents blind retries after uncertain responses.
