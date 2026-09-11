import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { applySourceTruth } from "../src/lib/coaPipeline.js";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const beforePath = option("--before");
if (!beforePath) throw new Error("Pass --before with the pre-migration /api/coas snapshot.");
const manifestPath = resolve(option("--manifest", "src/components/data/coa-source-truth.json"));
const outputPath = resolve(option("--output", "docs/coa-before-after.json"));
const before = JSON.parse(readFileSync(resolve(beforePath), "utf8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const after = applySourceTruth(before, manifest);

const purityPattern = /^(?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)%$/;
const samplePattern = /^(?:ACC-[A-Z0-9-]+|\d{8,})$/i;
const metrics = (payload) => ({
  total: payload.items.length,
  current: payload.items.filter((record) => record.status === "current" || record.is_current).length,
  history: payload.items.filter((record) => record.status === "history" || record.is_current === false).length,
  fentanyl_aliases: payload.items.filter((record) =>
    (record.aliases || []).some((alias) => /^fentanyl$/i.test(alias)),
  ).length,
  malformed_purity: payload.items.filter((record) => record.purity && !purityPattern.test(record.purity)).length,
  empty_sku: payload.items.filter((record) => !String(record.sku || "").trim()).length,
  malformed_sample_id: payload.items.filter((record) => record.sample_id && !samplePattern.test(record.sample_id)).length,
  contradictory_fentanyl: payload.items.filter((record) => {
    const notes = String(record.notes || "");
    return /Fentanyl:\s*Detected/i.test(notes) && /Fentanyl:\s*No Fentanyl Detected/i.test(notes);
  }).length,
  strict_schema_records: payload.items.filter((record) =>
    [
      "product_name",
      "compound_name",
      "aliases",
      "sku",
      "batch",
      "lab",
      "sample_id",
      "received_date",
      "test_date",
      "report_date",
      "purity",
      "analytes",
      "tests",
      "results",
      "notes",
      "pdf_url",
      "is_current",
    ].every((field) => Object.hasOwn(record, field)),
  ).length,
});

const beforeById = new Map(before.items.map((record) => [Number(record.id), record]));
const changedRecords = [];
for (const record of after.items) {
  const old = beforeById.get(Number(record.id));
  const changedFields = [
    ["product", "product_name"],
    ["identity", "compound_name"],
    ["aliases", "aliases"],
    ["sku", "sku"],
    ["batch", "batch"],
    ["lab_name", "lab"],
    ["sample_id", "sample_id"],
    ["received_date", "received_date"],
    ["test_date", "test_date"],
    ["report_date", "report_date"],
    ["code", "report_code"],
    ["purity", "purity"],
    ["notes", "notes"],
  ].filter(([beforeField, afterField]) =>
    JSON.stringify(old?.[beforeField] ?? null) !== JSON.stringify(record?.[afterField] ?? null),
  ).map(([, afterField]) => afterField);
  if (changedFields.length) changedRecords.push({ id: record.id, product_name: record.product_name, changed_fields: changedFields });
}

const beforeUrls = new Map(before.items.map((record) => [Number(record.id), record.url]));
const changedPdfUrls = after.items.filter((record) => beforeUrls.get(Number(record.id)) !== record.pdf_url);
const comparison = {
  generated_at: new Date().toISOString(),
  before: metrics(before),
  after: metrics(after),
  changed_record_count: changedRecords.length,
  changed_records: changedRecords,
  pdf_urls_unchanged: changedPdfUrls.length === 0,
  changed_pdf_url_ids: changedPdfUrls.map((record) => record.id),
};
writeFileSync(outputPath, `${JSON.stringify(comparison, null, 2)}\n`, "utf8");
console.log(JSON.stringify(comparison, null, 2));
