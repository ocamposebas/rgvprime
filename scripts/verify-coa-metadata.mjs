import assert from "node:assert/strict";
import sourceTruth from "../src/components/data/coa-source-truth.json" with { type: "json" };
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

console.log("Source-verified COA metadata checks passed");
