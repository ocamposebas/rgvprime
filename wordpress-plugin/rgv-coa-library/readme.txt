=== RGV COA Library ===
Contributors: rgvprime
Tags: coa, certificates, woocommerce, laboratory, product documents
Requires at least: 6.4
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

An organized Certificate of Analysis library for WooCommerce.

== Description ==

RGV COA Library replaces manually maintained storefront data with a structured WordPress library.

* Upload COA PDF files through the WordPress Media Library.
* Store product name, SKU, report ID, batch/lot, purity, tested quantity, lab, sample ID, method, dates, aliases, and notes.
* Link each COA to one or more WooCommerce products or variations by ID.
* Mark records as Current Shipping or History.
* Current Shipping records are exposed for linked product pages.
* History records are grouped beneath the current certificate in the public library.
* Includes public read-only REST endpoints for a decoupled storefront.

== Installation ==

1. Upload the plugin ZIP from Plugins > Add New > Upload Plugin.
2. Activate RGV COA Library.
3. Open COA Library > Add New.
4. Upload a PDF, enter the certificate details, link products, and publish.

== REST API ==

* `/wp-json/rgv-coa/v1/library`
* `/wp-json/rgv-coa/v1/product/{product_id}`
* `/wp-json/rgv-coa/v1/health`

== Changelog ==

= 1.0.0 =
* Initial release.

