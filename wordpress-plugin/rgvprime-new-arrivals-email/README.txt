RGVPRIME New Arrival Emails
Version 1.3.0

INSTALL
1. Upload the ZIP in WordPress > Plugins > Add New > Upload Plugin.
2. Activate it with WooCommerce active.
3. Open WooCommerce > New Arrival Emails.
4. New Arrivals automatically lists published WooCommerce products from the last 7 days.
5. Select products, create a campaign, edit copy, preview Desktop/Mobile, send a test, then queue the live campaign.

SMTP / DELIVERY
- SMTP remains 100% controlled by the site's existing WordPress SMTP configuration.
- The plugin does not store or override SMTP host, username, password, port, encryption, From Email or From Name.
- Mail is handed to wp_mail().
- Live campaigns use controlled batches with Action Scheduler when available and WP-Cron fallback.

EMAIL DESIGN
- Completely refreshed premium email layout.
- Light/Dark color-scheme support plus Outlook mobile data-ogsc dark-mode rules.
- The brand header remains dark in every mode so the white RGVPRIME logo is always readable.
- Responsive product cards, mobile layout, CTA and unsubscribe footer.

LOGO
- The previous code-drawn logo has been removed.
- The plugin now bundles a cleaned, optimized version of the original RGVPRIME logo supplied for this project.
- The transparent PNG is only a few KB and is served directly from the plugin, so no WordPress Media Library upload is required.

OMNISEND IMPORT
- Subscribers includes an Import Omnisend contacts panel.
- Upload an Omnisend CSV or paste a simple email/name list.
- Common email, first-name and subscription-status columns are detected automatically.
- Explicit unsubscribed, suppressed, bounced or opted-out contacts are kept unsubscribed and will not receive campaigns.
- Duplicate addresses are updated instead of duplicated.
- Existing unsubscribed contacts are never silently reactivated by a bulk import.

PREVIEW / TEST
- Live preview works before the campaign is saved.
- Desktop and Mobile preview sizes are available.
- A test can be sent to any valid email address through the site's existing SMTP transport.


= 1.3.0 =
* Adds intentional light and dark presentation for the campaign body, product cards, benefits and footer.
* Keeps the branded hero dark and consistent with the RGVPRIME storefront in every mode.
* Preserves responsive campaign previews and existing SMTP delivery behavior.

= 1.2.1 =
* Keeps the email body white in both light and dark mode while preserving the black brand header.
* Centers and refines the New Arrivals CTA.
* Adds rewards messaging for points on every order and 10% off the first order for new customers.
