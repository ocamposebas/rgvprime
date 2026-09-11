# RGVPRIME COA data pipeline

The laboratory PDF is the authoritative source for analytical metadata. WooCommerce is authoritative only for the explicit product/variation ID to SKU relationship. Product names are never matched by similarity.

## Flow

1. Capture the current public/upstream payload and WooCommerce catalog before a migration.
2. Download every original PDF without modifying it and record its SHA-256.
3. Extract embedded text; use local OCR only when the PDF is image-only.
4. Parse an identified laboratory template (`ILS`, modern/legacy `Freedom Diagnostics`, or `Chromate`).
5. Resolve SKU only when the linked catalog IDs identify one SKU. If a parent and one variation are linked, the variation is the deterministic target.
6. Validate the complete corpus and generate the source-truth manifest plus a field-level audit report.
7. WordPress creates a complete pre-migration database snapshot, rechecks every PDF URL and SHA-256, and only then writes the verified fields.
8. The REST API exposes schema v2 and legacy compatibility names. The Astro proxy applies the same source-hashed manifest while WordPress migration is pending.

## Canonical record

Each record has independent `product_name`, `compound_name`, `aliases`, `sku`, `batch`, `lab`, `sample_id`, `received_date`, `test_date`, `report_date`, `report_code`, `purity`, `analytes`, `tests`, `results`, `notes`, `pdf_url`, and `is_current` fields. `tests` hold the full structured laboratory rows; `analytes` and `results` are explicit projections. An analyte or result is never added to `aliases`.

Unknown values are `null` (or an empty SKU for the legacy compatibility field). Source conflicts and catalog ambiguity are retained in `manual_review`; they are not guessed away.

## Reprocessing

Run from an immutable snapshot directory containing:

- `before-upstream-library.json`
- `before-woocommerce-products.json`
- `pdf-manifest.csv`
- `pdfs/{coa_id}.pdf`

```powershell
node scripts/reprocess-coas.mjs --snapshot-dir "C:\path\to\snapshot"
npm run test:coa
node scripts/compare-coa-endpoint.mjs --before "C:\path\to\snapshot\before-public-api-coas.json"
```

`pdftotext` is used for embedded text. `pdfjs-dist`, `@napi-rs/canvas`, and `tesseract.js` provide the image-only fallback. Visual overrides are allowed only in `scripts/coa-source-overrides.json`, must be tied to the exact PDF SHA-256, and must state the visual evidence.

## Migration safety

The WordPress migration is available under **COA Library -> Settings**. It:

- saves every COA post and all metadata to a non-autoloaded `rgv_coa_backup_*` option before the first write;
- requires the stored URL to equal the audited URL;
- requires the current PDF SHA-256 to equal the audited SHA-256;
- skips changed/unavailable sources and records the reason;
- leaves product/variation links untouched;
- clears only the COA API cache.

The migration does not modify PDFs or any product, checkout, payment, order, inventory, pricing, or other commercial data.
