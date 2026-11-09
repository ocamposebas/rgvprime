# RGV Loyalty Program security notes

1. Keep the portal API secret on the Astro server only. Do not put it in `PUBLIC_*` environment variables or client-side JavaScript.
2. Use HTTPS for WordPress and the storefront.
3. Keep WooCommerce order webhooks and status transitions protected by administrator permissions.
4. A negative points balance is intentional. Do not reset it unless a reviewed manual adjustment is warranted.
5. Every manual adjustment must include a customer-facing reason and is recorded with the administrator ID.
6. Loyalty notification emails are dispatched only after the related database transaction commits.
7. Review WooCommerce logs with source `rgv-loyalty` after any database, coupon or email delivery error.
8. Configure a reliable SMTP provider; WordPress mail delivery is outside the database transaction and cannot be guaranteed by the plugin alone.
9. Test upgrades on staging and take a database backup before replacing the plugin in production.
