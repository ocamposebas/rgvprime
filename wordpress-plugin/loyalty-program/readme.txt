=== Loyalty Program ===
Contributors: rgvprime
Tags: woocommerce, loyalty, points, rewards, store credit
Requires at least: 6.5
Requires PHP: 7.4
Stable tag: 1.0.0

WooCommerce loyalty points with a configurable redemption threshold.

== Description ==

Default program:

* $1 eligible merchandise spend = 1 point.
* 1,000 points unlocks redemption.
* Each 1,000 points can be exchanged for $25 store credit.
* Points are awarded when an order is completed (or Processing, if enabled).
* Cancelled, failed and refunded orders reverse previously awarded points.
* Rewards generate a customer-email-restricted, single-use coupon valid for 90 days.
* WooCommerce > Loyalty Program lists customer balances, supports searching and manual adjustments, and contains all program settings.

Install the folder in wp-content/plugins, activate it, and configure it under WooCommerce > Loyalty Program.

The plugin expects the existing RGV Portal plugin. It validates headless redemptions through that plugin's authenticated `me` route.
