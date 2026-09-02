import assert from "node:assert/strict";
import {
  correctVerifiedCoaIdentities,
  VERIFIED_COA_IDENTITIES,
} from "../src/lib/coaMetadata.js";

const fentanylResult = "Fentanyl Screen: Not Detected";
const affectedRecords = Object.entries(VERIFIED_COA_IDENTITIES).map(
  ([id, expectedIdentity]) => ({
    id: Number(id),
    identity: "Fentanyl",
    notes: fentanylResult,
    expectedIdentity,
  }),
);
const payload = {
  items: affectedRecords,
  companies: [
    {
      files: [
        {
          ...affectedRecords[0],
          history: affectedRecords.slice(1, 4),
        },
      ],
    },
  ],
  unrelated: {
    id: 999999,
    identity: "Fentanyl",
    notes: "A genuine unrelated identity must not be rewritten.",
  },
};

const corrected = correctVerifiedCoaIdentities(payload);

for (const record of corrected.items) {
  assert.equal(record.identity, record.expectedIdentity);
  assert.equal(record.notes, fentanylResult);
}

for (const record of corrected.companies[0].files[0].history) {
  assert.equal(record.identity, record.expectedIdentity);
  assert.equal(record.notes, fentanylResult);
}

assert.equal(corrected.unrelated.identity, "Fentanyl");
assert.equal(
  payload.items[0].identity,
  "Fentanyl",
  "normalization must not mutate upstream data",
);

console.log("Verified COA identity metadata checks passed");
