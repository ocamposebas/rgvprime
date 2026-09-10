=== RGV eDebit Guard ===
Contributors: rgvprime
Requires at least: 6.4
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

Tracks the eDebit checkout lifecycle, labels unconfirmed orders accurately, expires abandoned pending orders after 60 minutes, and provides order-key-protected status verification for the RGVPRIME storefront.

== Installation ==

1. Upload and activate the plugin alongside WooCommerce and the eDebit Draft gateway.
2. Deploy the matching storefront update only after this plugin is active.
3. Confirm that COMPLIANCE_SIGNING_SECRET or PORTAL_API_SECRET matches the storefront proxy configuration.

== Safety ==

Only unpaid eDebit orders still in WooCommerce Pending payment status are eligible for automatic cancellation. On-hold, processing, completed, or paid orders are never expired by this plugin.

