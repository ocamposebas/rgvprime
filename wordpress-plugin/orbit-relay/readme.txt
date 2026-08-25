=== ORBIT Relay for WooCommerce ===
Contributors: orbit
Tags: woocommerce, integration, hmac, order synchronization
Requires at least: 6.5
Requires PHP: 8.1
Stable tag: 1.3.3
License: Proprietary

Secure commerce synchronization layer between RGVPRIME WooCommerce and the ORBIT platform.

== Version 1.3.3 ==

* Enforces one redemption per WooCommerce customer or guest billing email for the WELCOME10 coupon across standard, ORBIT card, and manual-payment checkout paths.

== ORBIT Relay 1.2 ==

This plugin does not process card data or call Stripe directly. ORBIT performs payment verification server-side and sends a signed completion callback to Relay.

It provides:
* Public minimal health endpoint.
* Public storefront card-checkout bridge that creates an authoritative pending WooCommerce order before requesting ORBIT payment configuration.
* HMAC-SHA256 authenticated private order verification.
* Timestamp and nonce replay protection.
* Production payment-completion synchronization for signed ORBIT orb_tx_* transactions using WooCommerce payment_complete().
* Controlled, disabled-by-default test payment-completion callback for orb_test_* transactions.
* HPOS-compatible WooCommerce order access through wc_get_order().
* Polished ORBIT Relay administration interface.

== REST endpoints ==

GET /wp-json/orbit/v1/health
POST /wp-json/orbit/v1/card-checkout                  (storefront origin restricted)
GET /wp-json/orbit/v1/orders/{orderId}              (signed)
POST /wp-json/orbit/v1/orders/{orderId}/payment    (signed; production orb_tx_* or controlled orb_test_*)

== Signing specification ==

Headers:
X-Orbit-Merchant
X-Orbit-Timestamp
X-Orbit-Nonce
X-Orbit-Signature

Canonical string, joined with a literal newline character:
merchantId
timestamp
nonce
HTTP_METHOD_UPPERCASE
URL_PATH_ONLY
sha256(rawBody)

Signature:
hex_lowercase(HMAC-SHA256(sharedSecret, canonicalString))

Timestamp tolerance: 300 seconds.
Nonce replay cache: 600 seconds.

For GET requests with an empty body, bodySha256 is SHA-256 of the empty string.

== Security ==

The Stripe secret key must never be installed in this plugin.
For stronger secret storage, ORBIT_RELAY_SIGNING_SECRET can be defined in wp-config.php; this overrides the database option.
Database-backed Relay secrets are encrypted at rest with Sodium or AES-256-GCM and existing legacy secrets are migrated automatically.
Controlled payment-completion testing can also be enabled by defining ORBIT_RELAY_ALLOW_TEST_PAYMENT_COMPLETION as true, otherwise it is controlled from the admin and disabled by default.

== Version 1.1.0 ==

* Accepts HMAC-authenticated production orb_tx_* payment completions in the Production environment.
* Keeps orb_test_* completions behind the explicit test-mode switch.
* Adds idempotent WooCommerce payment completion and conflict protection.
* Stores ORBIT transaction and optional Stripe payment reference metadata for reconciliation.
* Never stores Stripe secret keys or card data.

== Version 1.2.0 ==

* Moves ORBIT Card checkout ownership out of the Zelle plugin and into Relay.
* Creates idempotent pending WooCommerce card orders with server-authoritative inventory, prices, coupons, shipping and totals.
* Mints short-lived signed checkout tokens and calls ORBIT /api/payments/checkout server-to-server.
* Returns only the Stripe.js configuration and minimal order identifiers needed by the custom checkout.

== Version 1.3.0 ==

* Adds server-authoritative card checkout quotes without creating WooCommerce orders.
* Adds deferred Stripe ConfirmationToken checkout with quote revalidation and stable attempt idempotency.

== Version 1.3.1 ==

* Keeps WooCommerce card quotes fully in memory while calculating products, coupons, shipping, taxes and totals.
* Adds safe server-side diagnostics for quote calculation exceptions.

== Version 1.3.2 ==

* Adds redacted WooCommerce diagnostics for ORBIT checkout configuration failures.
