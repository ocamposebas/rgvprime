import sourceTruth from "../components/data/coa-source-truth.json" with { type: "json" };
import { applySourceTruth, validateCanonicalRecords } from "./coaPipeline.js";

const sourceTruthIssues = validateCanonicalRecords(sourceTruth.records);

/**
 * Applies only source-verified values whose COA id and PDF URL both match the
 * reprocessing manifest. Unknown/new records pass through unchanged.
 */
export function normalizeCoaPayload(payload) {
  const normalized = applySourceTruth(payload, sourceTruth);
  if (!normalized || typeof normalized !== "object") return normalized;
  return {
    ...normalized,
    meta: {
      ...(normalized.meta || {}),
      schema_version: sourceTruth.schema_version,
      parser_version: sourceTruth.parser_version,
      source_verified_records: sourceTruth.record_count,
      integrity_issue_count: sourceTruthIssues.length,
    },
  };
}

// Compatibility export for callers deployed with the earlier function name.
export const correctVerifiedCoaIdentities = normalizeCoaPayload;
