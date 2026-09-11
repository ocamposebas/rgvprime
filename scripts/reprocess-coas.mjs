import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import {
  buildCanonicalRecord,
  parseCoaText,
  resolveCatalogMapping,
  validateCanonicalRecords,
} from "../src/lib/coaPipeline.js";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function findPdfToText() {
  const candidates = [
    process.env.PDFTOTEXT_BIN,
    "pdftotext",
    "C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (/^[A-Za-z]:[\\/]/.test(candidate) && existsSync(candidate)) return candidate;
    try {
      execFileSync(candidate, ["-h"], { stdio: "ignore" });
      return candidate;
    } catch {
      // Try the next known installation.
    }
  }
  throw new Error("pdftotext is required. Set PDFTOTEXT_BIN to its executable path.");
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

let ocrWorker;

async function extractWithOcr(pdfPath) {
  const canvasModule = await import("@napi-rs/canvas");
  globalThis.DOMMatrix ||= canvasModule.DOMMatrix;
  globalThis.ImageData ||= canvasModule.ImageData;
  globalThis.Path2D ||= canvasModule.Path2D;
  const [{ getDocument }, { createWorker }] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("tesseract.js"),
  ]);
  const cachePath = resolve(tmpdir(), "rgv-coa-tesseract-cache");
  mkdirSync(cachePath, { recursive: true });
  ocrWorker ||= await createWorker("eng", undefined, { cachePath, logger: () => {} });
  const document = await getDocument({
    data: new Uint8Array(readFileSync(pdfPath)),
    disableWorker: true,
  }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 3 });
    const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const recognition = await ocrWorker.recognize(canvas.toBuffer("image/png"));
    pages.push(recognition.data.text);
    page.cleanup();
  }
  if (typeof document.destroy === "function") await document.destroy();
  return pages.join("\n\f\n");
}

async function extractText(tool, pdfPath) {
  const embeddedText = execFileSync(tool, ["-raw", "-enc", "UTF-8", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return embeddedText.replace(/\f/g, "").trim().length >= 20
    ? embeddedText
    : extractWithOcr(pdfPath);
}

function summarizeChanges(before, after) {
  const tracked = [
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
  ];
  const changes = [];
  for (const [oldField, newField] of tracked) {
    const oldValue = before[oldField] ?? null;
    const newValue = after[newField] ?? null;
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes.push({ field: newField, before: oldValue, after: newValue });
    }
  }
  return changes;
}

const snapshotDir = resolve(option("--snapshot-dir", ""));
if (!snapshotDir || !existsSync(snapshotDir)) {
  throw new Error("Pass an existing --snapshot-dir containing the pre-migration snapshots and PDFs.");
}

const outputPath = resolve(option("--output", "src/components/data/coa-source-truth.json"));
const wordpressOutputPath = resolve(
  option("--wordpress-output", "wordpress-plugin/rgv-coa-library/data/coa-source-truth.json"),
);
const reportPath = resolve(option("--report", "docs/coa-reprocessing-report.json"));
const upstreamPath = resolve(snapshotDir, "before-upstream-library.json");
const catalogPath = resolve(snapshotDir, "before-woocommerce-products.json");
const pdfManifestPath = resolve(snapshotDir, "pdf-manifest.csv");
const overridesPath = resolve(option("--overrides", "scripts/coa-source-overrides.json"));

for (const required of [upstreamPath, catalogPath, pdfManifestPath]) {
  if (!existsSync(required)) throw new Error(`Missing snapshot input: ${required}`);
}

const upstream = JSON.parse(readFileSync(upstreamPath, "utf8"));
const catalogSnapshot = JSON.parse(readFileSync(catalogPath, "utf8"));
const overrides = existsSync(overridesPath)
  ? JSON.parse(readFileSync(overridesPath, "utf8")).records || []
  : [];
const catalog = [
  ...(catalogSnapshot.products || []),
  ...(catalogSnapshot.variations || []),
];
const pdfToText = findPdfToText();
const capturedAt = new Date().toISOString();
const records = [];
const changes = [];
const extractedTextDir = resolve(snapshotDir, "reprocessed-text");
const reuseExtractedText = process.argv.includes("--reuse-extracted-text");
mkdirSync(extractedTextDir, { recursive: true });

for (const record of upstream.items || []) {
  const pdfPath = resolve(snapshotDir, "pdfs", `${record.id}.pdf`);
  if (!existsSync(pdfPath)) throw new Error(`Missing source PDF for COA ${record.id}: ${pdfPath}`);
  const pdfHash = sha256(pdfPath);
  const extractedTextPath = resolve(extractedTextDir, `${record.id}.txt`);
  const text = reuseExtractedText && existsSync(extractedTextPath)
    ? readFileSync(extractedTextPath, "utf8")
    : await extractText(pdfToText, pdfPath);
  if (!reuseExtractedText) writeFileSync(extractedTextPath, text, "utf8");
  let parsed = parseCoaText(text);
  const override = overrides.find(
    (entry) => Number(entry.id) === Number(record.id) && entry.pdf_sha256 === pdfHash,
  );
  if (override) {
    parsed = { ...parsed, ...(override.fields || {}) };
  }
  const mapping = resolveCatalogMapping(record, catalog);
  const canonical = buildCanonicalRecord(record, parsed, mapping, {
    pdf_sha256: pdfHash,
    captured_at: capturedAt,
  });
  if (override) canonical.source.visual_override = override.evidence;
  records.push(canonical);
  const recordChanges = summarizeChanges(record, canonical);
  if (recordChanges.length) {
    changes.push({ id: canonical.id, product_name: canonical.product_name, changes: recordChanges });
  }
}

const issues = validateCanonicalRecords(records);
const manifest = {
  schema_version: 2,
  parser_version: "2026-09-11.1",
  generated_at: capturedAt,
  source_snapshot_sha256: sha256(upstreamPath),
  record_count: records.length,
  records,
};
const report = {
  generated_at: capturedAt,
  before: upstream.meta,
  after: {
    total: records.length,
    current_shipping: records.filter((record) => record.is_current).length,
    history: records.filter((record) => !record.is_current).length,
  },
  changed_record_count: changes.length,
  changes,
  issue_count: issues.length,
  issues,
};

mkdirSync(dirname(outputPath), { recursive: true });
mkdirSync(dirname(wordpressOutputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
writeFileSync(wordpressOutputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (ocrWorker) await ocrWorker.terminate();

console.log(
  JSON.stringify(
    {
      output: outputPath,
      wordpress_output: wordpressOutputPath,
      report: reportPath,
      records: records.length,
      changed_records: changes.length,
      issues: issues.length,
      errors: issues.filter((issue) => issue.severity === "error").length,
      manual_review: issues.filter((issue) => issue.severity === "review").length,
    },
    null,
    2,
  ),
);
