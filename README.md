# Astro Starter Kit: Basics

## Checkout compliance deployment

The storefront and WooCommerce plugins now require the same private compliance
secret. By default the Node app uses `PORTAL_API_SECRET` and WordPress must expose
the matching value as `RGV_PORTAL_API_SECRET`. To use a separate secret, set
`COMPLIANCE_SIGNING_SECRET` in the Node deployment and define the identical value
as `RGV_COMPLIANCE_SIGNING_SECRET` in `wp-config.php`. Never use a `PUBLIC_`
prefix. Deploy the updated RGV Zelle Checkout and ORBIT Relay plugins together
with the storefront; otherwise checkout fails closed.

## Maintenance mode

The storefront includes a maintenance screen for VPS cleanup and code reviews.
Configure these environment variables in Coolify (or in `.env` locally):

```env
MAINTENANCE_MODE=true
MAINTENANCE_DURATION_HOURS=2
```

Restart or redeploy the Node service after changing the value. Set
`MAINTENANCE_MODE=false` and restart/redeploy to reopen the storefront. While
enabled, public pages return HTTP `503` with a two-hour `Retry-After` header and
API routes return a JSON maintenance response. Static assets and `/api/health`
remain available; use `/api/health` as the VPS/container health-check path.

## WordPress COA Library

The storefront reads Certificate of Analysis records from the companion
`RGV COA Library` WordPress plugin instead of importing
`src/components/data/coas.json`.

1. Install `wordpress-plugin/rgv-coa-library-1.0.0.zip` in WordPress.
2. Activate the plugin and open **COA Library** in WordPress admin.
3. Add a certificate, upload its PDF, link its WooCommerce product IDs, and
   choose **Current Shipping** or **History**.
4. Set `PUBLIC_WP_URL` to the WordPress base URL and redeploy the storefront.

The storefront proxy is available at `/api/coas`. WordPress exposes the
read-only source endpoints under `/wp-json/rgv-coa/v1`.

## Omnisend dynamic abandoned cart

Set `PUBLIC_OMNISEND_BRAND_ID` in the deployment environment. The storefront then
sends the official `added product to cart` and `started checkout` events with:

- all current cart products in `properties.lineItems` for Omnisend's native
  Abandoned Products block;
- enriched product data in `properties.rgvLineItems`, including the variant,
  research summary, product URL, and matching COA/documentation URL;
- a cross-device recovery URL in `properties.abandonedCheckoutURL`.

The Omnisend workflow must use the **Added product to cart** trigger. In the email
builder, use one **Abandoned Products** item for the standard layout, or a Dynamic
Content layout with `Raw -> Rgv Line Items` for separate product and COA buttons.

```sh
npm create astro@latest -- --template basics
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
│   └── favicon.svg
├── src
│   ├── assets
│   │   └── astro.svg
│   ├── components
│   │   └── Welcome.astro
│   ├── layouts
│   │   └── Layout.astro
│   └── pages
│       └── index.astro
└── package.json
```

To learn more about the folder structure of an Astro project, refer to [our guide on project structure](https://docs.astro.build/en/basics/project-structure/).

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
