# Astro Starter Kit: Basics

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
