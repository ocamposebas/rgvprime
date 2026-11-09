=== RGV Loyalty Program ===
Contributors: rgvprime
Tags: woocommerce, loyalty, points, rewards, store credit
Requires at least: 6.5
Requires PHP: 7.4
Requires Plugins: woocommerce
Stable tag: 1.3.0

A hardened WooCommerce loyalty program with a premium administration panel and automatic customer notifications.

== Description ==

Default program:

* One point per eligible currency unit spent on merchandise after discounts.
* Shipping and fees never earn points.
* 1,000 points unlocks redemption.
* Each 1,000 points can be exchanged for 25 units of store credit.
* Points are awarded at Completed, or at Processing when enabled.
* Partial refunds recalculate only refunded merchandise.
* Cancelled, failed and fully refunded orders reconcile their credited points to zero.
* Rewards generate an email-restricted, single-use, individual-use coupon.
* Coupon expiration is configurable and defaults to 90 days.

== Premium administration panel ==

* Command-center header with live security and compatibility indicators.
* KPI cards for tracked accounts, points in circulation, reward-ready customers, negative balances and active rewards.
* Search and filters for customers with points, redeemable balances or loyalty debt.
* Clear customer status, progress bar, available credit and recent activity.
* Secure expandable adjustment form for each customer.
* Every manual adjustment requires a customer-facing reason.
* Responsive layout for desktop, tablet and mobile WordPress administration.

== Automatic emails ==

The plugin can send branded HTML emails for:

* Points earned from an eligible order.
* Positive or negative manual adjustments.
* Reward coupon creation, including code, value and expiration.
* Reward points restored after cancellation, failure or full refund.
* Points reversed after a refund, cancellation or order reduction.

Emails are sent only after the related database transaction commits successfully. Failed mail delivery is logged under the WooCommerce log source `rgv-loyalty`. Manual adjustments also display an administrator warning when the points were saved but the email could not be sent.

== Security protections ==

* Per-customer database locking prevents simultaneous double redemptions.
* Database transactions keep balance, history, coupon and order metadata consistent.
* Optional Idempotency-Key support safely handles repeated API requests.
* Negative balances are preserved when a customer used a reward before refunding its source purchase.
* Unused active reward coupons are revoked and converted back to points before a reversal.
* Used reward coupons are restored only when the order that consumed them is cancelled, failed or fully refunded.
* Restored and revoked coupons are expired and permanently rejected by an additional validation filter.
* Loyalty coupons are limited to their account owner and billing email.
* A negative loyalty balance blocks all reward redemptions and reward coupon usage.
* Redemption requests are rate limited.
* All administrative adjustments require WooCommerce management permission, a valid nonce, a non-zero amount and a documented reason.
* WooCommerce HPOS compatibility is declared and all order access uses WooCommerce CRUD objects.

== Headless portal requirement ==

The plugin expects the existing RGV Portal authentication route at `/rgv-portal/v1/me` or its helper functions.
The `x-rgv-portal-secret` header must be sent only from your Astro server. Never expose that secret in browser JavaScript.

The redemption endpoint is:

`POST /wp-json/rgv-portal/v1/loyalty/redeem`

Headers:

* `Authorization: Bearer ...`
* `x-rgv-portal-secret: ...`
* Optional: `Idempotency-Key: unique-request-id`

Body:

`{"points":1000}`

Omit `points` to redeem the maximum currently available whole reward amount.

== Upgrade notice ==

Version 1.2.0 keeps the existing settings, balances, history, order metadata and coupons from versions 1.0.0 and 1.1.0. New email notification settings are enabled by default through backwards-compatible defaults and can be managed from WooCommerce → Loyalty Program.

Because version 1.0.0 prevented negative balances, historical abuse that happened before version 1.1.0 cannot be inferred automatically. Review suspicious customers manually after activation.

== Changelog ==

= 1.3.0 =

* Rebuilt rewards emails around the RGVPRIME storefront hero.
* Added intentional light and dark presentation with a consistent dark brand header.
* Improved reward summaries, calls to action and automated-notification footer styling.

= 1.2.0 =

* Rebuilt the WooCommerce administration panel with a premium responsive interface.
* Added live loyalty metrics, status filters, customer progress and cleaner adjustment controls.
* Added branded dark-mode-safe customer email templates.
* Added notifications for earning, manual adjustments, redemption, restoration and reversal events.
* Ensured transactional emails are triggered only after successful database commits.
* Added administrator visibility when a manual adjustment email fails.
* Added configurable email event switches, brand name and rewards-account URL.
* Preserved all previous fraud protection, locking, transaction and HPOS behavior.

= 1.1.0 =

* Rebuilt balance mutations with signed balances, locks and transactions.
* Added idempotent and rate-limited redemptions.
* Replaced additive refund logic with idempotent order-point reconciliation.
* Added merchandise-only partial refund calculations.
* Added automatic revocation of unused rewards during reversals.
* Added permanent invalidation and safe restoration of consumed rewards.
* Added owner and negative-balance coupon validation.
* Added HPOS declaration, plugin requirements and WooCommerce dependency header.
* Added customer pagination and negative-balance visibility in the administrator.
* Repacked the plugin with portable ZIP paths.
