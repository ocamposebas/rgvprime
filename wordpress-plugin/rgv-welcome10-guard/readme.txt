=== RGV WELCOME10 First Order Guard ===
Contributors: rgvprime
Tags: woocommerce, coupon, first order, welcome discount
Requires at least: 6.4
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

Restricts WELCOME10 to a customer's first WooCommerce purchase.

== Behavior ==

* Forces WELCOME10 to one redemption per customer.
* Rejects WELCOME10 when the WooCommerce customer ID has a prior paid or refunded order.
* Also checks prior orders by normalized billing email, covering guest purchases.
* Trusts account identity from the RGV storefront only when the request carries the configured compliance secret.
* Uses HPOS-compatible WooCommerce order queries.
* Leaves failed, cancelled and unpaid pending orders out of first-purchase history.

== Installation ==

1. Upload and activate the plugin in WordPress.
2. Keep the WooCommerce coupon code named WELCOME10.
3. The plugin automatically persists a one-use-per-customer limit on that coupon.

