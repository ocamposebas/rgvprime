import assert from "node:assert/strict";
import sourceTruth from "../src/components/data/coa-source-truth.json" with { type: "json" };
import issuerLinks from "../src/components/data/coa-issuer-links.json" with { type: "json" };
import { normalizeCoaPayload } from "../src/lib/coaMetadata.js";

const ghk = sourceTruth.records.find((record) => record.id === 2634);
const unrelated = {
  id: 999999,
  identity: "Fentanyl",
  aliases: ["Fentanyl"],
  url: "https://example.test/genuine-fentanyl-product.pdf",
};
const payload = {
  items: [
    {
      id: ghk.id,
      identity: "Fentanyl",
      aliases: ["Fentanyl"],
      purity: "NPC%",
      url: ghk.pdf_url,
    },
    unrelated,
  ],
};

const normalized = normalizeCoaPayload(payload);
assert.equal(normalized.items[0].identity, "GHK-Cu");
assert.equal(normalized.items[0].aliases.includes("Fentanyl"), false);
assert.equal(normalized.items[0].purity, "99.77%");
assert.equal(
  normalized.items[0].results.some(
    (result) => result.analyte === "Fentanyl Screen" && result.value === "Not Detected",
  ),
  true,
);
assert.deepEqual(normalized.items[1], unrelated, "unverified records must not be rewritten");
assert.equal(payload.items[0].identity, "Fentanyl", "normalization must not mutate upstream data");
assert.equal(normalized.meta.schema_version, 2);

assert.equal(new Set(issuerLinks.map(({ id }) => id)).size, issuerLinks.length);
for (const { id, pdf, report, lot, url, kind, accessCode } of issuerLinks) {
  assert.ok(lot && report, `record ${id} has a lot and report number`);
  if (kind === "pdf") {
    assert.equal(url, `https://coas.freedomdiagnosticstesting.com/${report}.pdf`);
  } else if (kind === "report") {
    assert.match(url, /^https:\/\/portal\.ils-lab\.com\/verify\/[\w-]+$/);
  } else {
    assert.equal(kind, "lookup");
    assert.ok(["https://ils-lab.com/verify/", "https://www.chromate.org/verify"].includes(url));
    assert.match(accessCode, /^[A-Z0-9]{7,12}$/);
  }

  const record = { id, pdf_url: pdf, report_code: report, lot };
  const wrongReport = { ...record, pdf_url: `${pdf}?different` };
  const result = normalizeCoaPayload({
    items: [record],
    companies: [{ files: [{ ...record, history: [record, wrongReport] }] }],
    families: [{ current: [record], history: [record] }],
  });
  const expected = { url, kind, ...(accessCode && { accessCode }) };
  const [current] = result.companies[0].files;
  assert.deepEqual(result.items[0].issuer_verification, expected);
  assert.deepEqual(current.issuer_verification, expected);
  assert.deepEqual(current.history[0].issuer_verification, expected);
  assert.equal(current.history[1].issuer_verification, undefined);
  assert.deepEqual(result.families[0].current[0].issuer_verification, expected);
  assert.deepEqual(result.families[0].history[0].issuer_verification, expected);
}

console.log("Source-verified COA metadata checks passed");
