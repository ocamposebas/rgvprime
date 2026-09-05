=== RGV Storewide Promotion ===
Contributors: rgvprime
Tags: woocommerce, promotion, sale, countdown, storewide discount
Requires at least: 6.5
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

Schedules a WooCommerce storewide discount and exposes a synchronized countdown announcement.

== Description ==

RGV Storewide Promotion keeps pricing and promotion messaging on the same schedule.

* Apply a percentage discount to simple products and variations without rewriting saved product prices.
* Set an optional start time and a required end time in the WordPress site timezone.
* Publish campaign data through /wp-json/rgv-promotion/v1/current for a headless storefront.
* Optionally show a clean countdown banner on the native WordPress storefront.
* Restore regular pricing automatically when the campaign expires or is paused.
* Store the campaign percentage as private order metadata for operational traceability.

The discount is calculated from each product's current effective price. Existing product sales may therefore receive the campaign discount as well.

== Installation ==

1. Upload the plugin ZIP in WordPress under Plugins > Add New Plugin > Upload Plugin.
2. Activate RGV Storewide Promotion.
3. Open WooCommerce > Storewide Promotion.
4. Configure the discount, announcement, schedule and destination URL.
5. Enable the campaign and save.

== Changelog ==

= 1.0.0 =
* Initial release.
* Scheduled storewide product pricing.
* Public headless campaign endpoint.
* Native storefront countdown.
* HPOS compatibility declaration and order metadata.
