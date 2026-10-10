=== RGV Ofertas y Anuncios ===
Contributors: rgvprime
Tags: woocommerce, promotion, sale, countdown, product discount
Requires at least: 6.5
Requires PHP: 7.4
Stable tag: 1.3.0
License: GPLv2 or later

Publishes informational banners and schedules WooCommerce storewide or single-product discounts.

== Description ==

RGV Ofertas y Anuncios keeps pricing and storefront messaging on the same schedule.

* Apply a percentage discount to simple products and variations without rewriting saved product prices.
* Publish information-only messages such as stock arrivals, greetings, or store notices without changing prices.
* Choose between an entire-store campaign and one specific product, including all of its variations.
* Select products from a reliable native list loaded directly from WooCommerce.
* Set optional start and end times in the WordPress site timezone.
* Show or hide the countdown independently from the campaign schedule.
* Publish campaign data through /wp-json/rgv-promotion/v1/current for a headless storefront.
* Optionally show a clean countdown banner on the native WordPress storefront.
* Send the banner button directly to the selected product when no custom URL is entered.
* Restore regular pricing automatically when the campaign expires or is paused.
* Store the campaign percentage as private order metadata for operational traceability.

The discount is calculated from each product's current effective price. Existing product sales may therefore receive the campaign discount as well.

== Installation ==

1. Upload the plugin ZIP in WordPress under Plugins > Add New Plugin > Upload Plugin.
2. Activate RGV Ofertas y Anuncios.
3. Open WooCommerce > Promotions.
4. Choose an information-only message, one-product discount, or storewide discount.
5. Configure the message, optional discount, schedule, countdown, and button.
6. Enable the campaign and save.

== Changelog ==

= 1.3.0 =
* Added information-only banners that do not change product prices.
* Added optional campaign dates, countdown, and call-to-action button.
* Replaced the AJAX product search with a reliable native WooCommerce product list.
* Reorganized and translated the administration screen for simpler setup.

= 1.2.0 =
* Added single-product promotions with WooCommerce product search.
* Applied product promotions to every variation of the selected product.
* Added automatic banner links to the selected product.
* Exposed the campaign scope and selected product through the storefront endpoint.

= 1.1.0 =
* Redesigned the offer banner around the RGVPRIME storefront structure.
* Added a larger campaign headline and countdown tiles for clearer mobile visibility.
* Kept pricing, campaign expiration, and the public storefront message synchronized.

= 1.0.0 =
* Initial release.
* Scheduled storewide product pricing.
* Public headless campaign endpoint.
* Native storefront countdown.
* HPOS compatibility declaration and order metadata.
