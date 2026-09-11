import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applySourceTruth,
  buildCanonicalRecord,
  parseCoaText,
  resolveCatalogMapping,
  validateCanonicalRecords,
} from "../src/lib/coaPipeline.js";
import manifest from "../src/components/data/coa-source-truth.json" with { type: "json" };

const ilsFixture = readFileSync(new URL("./fixtures/coa-ils.txt", import.meta.url), "utf8");
const freedomFixture = readFileSync(new URL("./fixtures/coa-freedom.txt", import.meta.url), "utf8");

const ils = parseCoaText(ilsFixture);
assert.equal(ils.compound_name, "GHK-Cu");
assert.equal(ils.purity, "99.77%");
assert.equal(ils.sample_id, "ACC-2026-15573");
assert.equal(ils.received_date, "2026-08-11");
assert.equal(ils.test_date, "2026-08-15");
assert.equal(ils.report_date, "2026-08-17");
assert.equal(ils.report_code, "COA-2026-956051");
assert.deepEqual(
  ils.tests.find((test) => test.name === "Fentanyl Screen"),
  {
    name: "Fentanyl Screen",
    result: "Not Detected",
    specification: "Immunoassay, 50 ng/mL cutoff",
    unit: null,
    status: "PASS",
    method: "Immunoassay",
  },
);

const freedom = parseCoaText(freedomFixture);
assert.equal(freedom.product_name, "GHK-Cu + KPV 60mg");
assert.equal(freedom.compound_name, "GHK-Cu/KPV");
assert.equal(freedom.sample_id, "2607280197");
assert.equal(freedom.received_date, "2026-07-28");
assert.equal(freedom.report_date, "2026-07-31");
assert.equal(freedom.purity, "99.84%");
assert.deepEqual(
  freedom.tests.filter((test) => /Fentanyl/i.test(test.name)),
  [
    {
      name: "Fentanyl",
      result: "No Fentanyl Detected",
      specification: null,
      unit: null,
      status: null,
      method: null,
    },
  ],
);

const mapping = resolveCatalogMapping(
  { product_ids: [114] },
  [{ id: 114, sku: "GHK-CU-SINGLE-50MG", name: "50mg, Single", parent_name: "GHK-CU" }],
);
assert.equal(mapping.status, "deterministic");
assert.equal(mapping.sku, "GHK-CU-SINGLE-50MG");

const canonical = buildCanonicalRecord(
  {
    id: 2634,
    product: "GHK-CU 50MG",
    aliases: ["Fentanyl"],
    product_ids: [114],
    status: "current",
    url: "https://example.test/2634.pdf",
    group_key: "wc-53-50mg",
  },
  ils,
  mapping,
  { pdf_sha256: "abc", captured_at: "2026-09-11T00:00:00.000Z" },
);
assert.equal(canonical.compound_name, "GHK-Cu");
assert.equal(canonical.purity, "99.77%");
assert.equal(canonical.aliases.includes("Fentanyl"), false);
assert.equal(canonical.tests.some((test) => test.name === "Fentanyl Screen"), true);

assert.equal(manifest.record_count, 87);
assert.equal(manifest.records.filter((record) => record.is_current).length, 49);
assert.equal(manifest.records.filter((record) => !record.is_current).length, 38);
assert.equal(
  manifest.records.some((record) =>
    record.aliases.some((alias) => alias.toLowerCase() === "fentanyl"),
  ),
  false,
);
assert.equal(
  manifest.records.some((record) => record.purity && !/^(?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)%$/.test(record.purity)),
  false,
);

const ghk50 = manifest.records.find((record) => record.id === 2634);
assert.equal(ghk50.purity, "99.77%");
assert.equal(ghk50.sample_id, "ACC-2026-15573");
assert.equal(ghk50.sku, "GHK-CU-SINGLE-50MG");

const ghkKpv = manifest.records.find((record) => record.id === 2011);
assert.deepEqual(
  ghkKpv.results.filter((result) => /fentanyl/i.test(result.analyte)),
  [{ analyte: "Fentanyl", value: "No Fentanyl Detected", unit: null, status: null }],
);

for (const id of [1975, 1969, 2004, 2007, 1967, 1977]) {
  const record = manifest.records.find((entry) => entry.id === id);
  assert.equal(record.received_date, "2026-07-17");
  assert.equal(record.test_date, "2026-07-31");
  assert.equal(record.report_date, "2026-07-31");
}
const ss31 = manifest.records.find((record) => record.id === 1973);
assert.equal(ss31.received_date, "2026-07-17");
assert.equal(ss31.test_date, "2026-07-31");
assert.equal(ss31.report_date, "2026-08-03");

const issues = validateCanonicalRecords(manifest.records);
assert.equal(issues.some((issue) => issue.code === "alias_from_analyte"), false);
assert.equal(issues.some((issue) => issue.code === "invalid_purity"), false);
assert.equal(issues.some((issue) => issue.code === "malformed_sample_id"), false);
assert.equal(issues.some((issue) => issue.code === "contradictory_results"), false);
assert.equal(issues.some((issue) => issue.code === "duplicate"), false);
assert.equal(issues.some((issue) => issue.code === "current_history_inconsistent"), false);

const legacyPayload = {
  items: [
    {
      id: 2634,
      product: "GHK-CU 50MG",
      identity: "Fentanyl",
      aliases: ["Fentanyl"],
      purity: "NPC%",
      url: ghk50.pdf_url,
    },
  ],
};
const normalized = applySourceTruth(legacyPayload, manifest);
assert.equal(normalized.items[0].identity, "GHK-Cu");
assert.equal(normalized.items[0].aliases.includes("Fentanyl"), false);
assert.equal(normalized.items[0].purity, "99.77%");

console.log(`COA pipeline regression checks passed (${manifest.record_count} source PDFs)`);
