=== RGV Mystery Vial Promotion ===
Contributors: rgvprime
Tags: woocommerce, free gift, promotion, fulfillment, inventory
Requires at least: 6.5
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

Awards complimentary Mystery Vials from net merchandise spend and adds them to WooCommerce orders as physical fulfillment items.

== Description ==

RGV Mystery Vial Promotion runs the limited 150-vial campaign from WooCommerce.

* $60.00-$149.99 net merchandise spend receives one Mystery Vial.
* $150.00 or more net merchandise spend receives two Mystery Vials.
* Net spend is calculated after product discounts and coupons, before shipping, fees, and tax.
* A transaction-safe allocation ledger prevents more than the configured campaign inventory from being awarded.
* The complimentary vial is a hidden, physical WooCommerce product with SKU RGV-MYSTERY-VIAL.
* The gift appears as a $0.00 order line in WooCommerce, emails, order APIs, Pirate Ship imports, and packing lists.
* Pending and on-hold orders reserve their awarded quantity. Failed or cancelled unpaid orders release it.
* Processing and completed orders permanently consume their allocation.
* A public read-only endpoint supplies live remaining inventory and tier information to the headless checkout.
* WooCommerce > Mystery Vials provides campaign controls, live counts, product details, and an allocation audit.

== Installation ==

1. Upload the plugin ZIP in WordPress under Plugins > Add New Plugin > Upload Plugin.
2. Activate RGV Mystery Vial Promotion.
3. Open WooCommerce > Mystery Vials.
4. Confirm the default 150-vial inventory and the $60 / $150 tiers, then enable the campaign.
5. Keep the existing Pirate Ship WooCommerce integration connected. No separate Pirate Ship API is required.

== Operational notes ==

Pirate Ship normally imports WooCommerce orders when they reach Processing status. The Mystery Vial line uses an ASCII-only product name and a stable SKU so it is included in imported order items and packing lists.

The generated WooCommerce product is hidden from the catalog and cannot be purchased directly. Its stock is governed by the campaign ledger rather than WooCommerce product stock so allocation can be released safely when an unpaid order fails or is cancelled.

== Changelog ==

= 1.0.0 =
* Initial limited Mystery Vial campaign.
* Transaction-safe 150-vial allocation ledger.
* Automatic $60 / $150 net-spend tiers.
* Standard WooCommerce fulfillment line for Pirate Ship visibility.
* Headless storefront status endpoint and professional admin dashboard.
