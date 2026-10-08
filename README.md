# RGVPRIME Storefront

Astro and React storefront backed by WooCommerce. The repository also contains
the WordPress plugins used for checkout, promotions, loyalty, order handling,
and Certificate of Analysis records.

## Requirements

- Node.js 22.12 or newer
- A WordPress installation with WooCommerce
- Private WooCommerce REST API credentials for server-side checkout operations

## Local development

```sh
npm install
Copy-Item .env.example .env
npm run dev
```

Review `.env.example` before starting the app. Private keys and secrets must
never use a `PUBLIC_` prefix.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Astro development server |
| `npm run build` | Create the production server build |
| `npm run preview` | Preview the production build locally |
| `npm run test:seo` | Run SEO checks |
| `npm run test:storefront` | Run storefront regression checks |
| `npm run test:compliance` | Verify checkout compliance controls |
| `npm run test:coa` | Verify the COA data pipeline and WordPress plugin |
| `npm run test:account-orders` | Verify account order visibility |
| `npm run test:orbit-card` | Verify the card and wallet handoff |
| `npm run test:edebit` | Verify the eDebit guard |

## Repository layout

```text
public/             Static assets, fonts, and COA PDFs
src/                Astro pages, React components, styles, and server APIs
scripts/            Verification and WordPress packaging scripts
docs/               Operational documentation for COA and payment support
wordpress-plugin/   Canonical plugin sources and installable packages
```

Generated builds, browser profiles, review screenshots, temporary worktrees,
and ad hoc root-level ZIP exports are intentionally excluded from version control.

## WordPress plugins

Canonical plugin source lives under `wordpress-plugin/`. Packaging scripts in
`scripts/` create installable ZIP files in that same directory.

| Feature | Package |
| --- | --- |
| Card and wallet return | `rgv-prism-checkout-3.8.3.zip` |
| Card and wallet stock hold | `rgv-card-wallet-stability-1.4.0.zip` |
| Zelle checkout | `rgv-zelle-checkout-1.4.0.zip` |
| ORBIT Relay | `orbit-relay-for-woocommerce-1.5.2.zip` |
| ORBIT card checkout | `rgv-orbit-card-checkout-1.2.0.zip` |
| eDebit abandonment guard | `rgv-edebit-guard-1.1.2.zip` |
| COA library | `rgv-coa-library-1.12.0.zip` |
| Storewide promotion | `rgv-storewide-promotion-1.1.0.zip` |
| Rush processing | `rgv-rush-processing-orders-1.0.0.zip` |
| Welcome coupon guard | `rgv-welcome10-guard-1.0.0.zip` |

Deploy matching storefront and plugin versions together when a change spans
both applications.

## Checkout configuration

Set `WC_API_URL`, `WC_CONSUMER_KEY`, and `WC_CONSUMER_SECRET` as private server
variables. The WooCommerce API key requires read/write access. The server
validates the signed-in storefront session, inventory, prices, coupons,
shipping, and fees before creating a pending order.

The storefront and WordPress plugins must share the same compliance secret.
By default the Node app uses `PORTAL_API_SECRET` and WordPress uses
`RGV_PORTAL_API_SECRET`. To use a dedicated value, set
`COMPLIANCE_SIGNING_SECRET` in the Node deployment and the identical
`RGV_COMPLIANCE_SIGNING_SECRET` value in WordPress.

WooCommerce's **Hold stock (minutes)** setting should remain at `60` so unpaid
pending orders expire automatically.

### ORBIT card processor

Configure processor credentials only on the WordPress service:

```env
WOMPI_PUBLIC_KEY=pub_test_REPLACE_ME
WOMPI_PRIVATE_KEY=prv_test_REPLACE_ME
WOMPI_INTEGRITY_SECRET=test_integrity_REPLACE_ME
WOMPI_EVENTS_SECRET=test_events_REPLACE_ME
```

Use sandbox credentials until both approved and declined test transactions have
been verified. Configure the matching transaction event URL as:

```text
https://YOUR-WORDPRESS-DOMAIN/wp-json/rgv/v1/orbit-card-events
```

The plugin obtains the official Colombian TRM from datos.gov.co and keeps a
bounded cache for temporary upstream outages. `WOMPI_COP_PER_USD` is optional
and should only be set for an intentional manual override.

### Omnisend

Set `PUBLIC_OMNISEND_BRAND_ID` for browser tracking and the private Omnisend API
key described in `.env.example` for server-side contact updates. The storefront
sends native cart events plus enriched line-item and COA data for abandoned-cart
campaigns.

## Maintenance mode

```env
MAINTENANCE_MODE=true
MAINTENANCE_DURATION_HOURS=2
```

Restart or redeploy after changing maintenance settings. While enabled, public
pages return HTTP `503`; static assets and `/api/health` remain available.

## Certificate of Analysis pipeline

The storefront reads COA records from the `RGV COA Library` plugin through
`/api/coas`. WordPress exposes the source endpoints under
`/wp-json/rgv-coa/v1`.

Laboratory PDFs remain the analytical source of truth. Source hashes are
validated before migration, while analytes and results remain separate from
product aliases. See [docs/coa-pipeline.md](docs/coa-pipeline.md) for the
reprocessing and migration workflow.
