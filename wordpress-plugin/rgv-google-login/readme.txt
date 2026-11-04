=== RGV Google Login Bridge ===
Contributors: rgvprime
Tags: google, login, woocommerce, customer portal
Requires at least: 6.4
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

Links verified Google identities to the existing WordPress customer account and
returns a normal RGV Customer Portal session.

== Requirements ==

* The existing RGV Customer Portal API plugin must be active.
* The Astro storefront must verify the Google ID token before calling this plugin.
* The storefront and WordPress must use the same private portal API secret.

== Account linking behavior ==

1. A returning Google subject uses its already linked WordPress user.
2. An unlinked verified Google email is matched case-insensitively to the existing WordPress user and linked to that same user ID.
3. A new customer is created only when no WordPress user owns the verified email.
4. A WordPress account already linked to a different Google subject is rejected and sent to support; it is never silently reassigned.

== Installation ==

1. Upload and activate rgv-google-login-1.0.0.zip in WordPress.
2. Keep the RGV Customer Portal API plugin active.
3. Deploy the storefront with GOOGLE_CLIENT_ID and PUBLIC_GOOGLE_CLIENT_ID set to the same Google OAuth Web client ID.
4. Add the production and preview storefront domains as authorized JavaScript origins in Google Cloud.
