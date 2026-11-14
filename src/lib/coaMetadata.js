import sourceTruth from "../components/data/coa-source-truth.json" with { type: "json" };
import issuerLinks from "../components/data/coa-issuer-links.json" with { type: "json" };
import { applySourceTruth, validateCanonicalRecords } from "./coaPipeline.js";

const sourceTruthIssues = validateCanonicalRecords(sourceTruth.records);
const issuerLinksById = new Map(issuerLinks.map((entry) => [entry.id, entry]));

function attachIssuerLink(record) {
  const entry = issuerLinksById.get(Number(record?.id));
  if (
    !entry ||
    entry.pdf !== (record.pdf_url || record.url) ||
    entry.report !== (record.report_code || record.code) ||
    entry.lot !== (record.batch || record.lot)
  ) return record;

  const { url, kind, accessCode } = entry;
  return { ...record, issuer_verification: { url, kind, ...(accessCode && { accessCode }) } };
}

function attachIssuerLinks(records) {
  return Array.isArray(records) ? records.map(attachIssuerLink) : records;
}

/**
 * Applies only source-verified values whose COA id and PDF URL both match the
 * reprocessing manifest. Issuer links also require a matching lot and report.
 */
export function normalizeCoaPayload(payload) {
  const normalized = applySourceTruth(payload, sourceTruth);
  if (!normalized || typeof normalized !== "object") return normalized;
  return {
    ...normalized,
    items: attachIssuerLinks(normalized.items),
    companies: Array.isArray(normalized.companies) ? normalized.companies.map((company) => ({
      ...company,
      files: Array.isArray(company.files) ? company.files.map((file) => ({
        ...attachIssuerLink(file),
        history: attachIssuerLinks(file.history),
      })) : company.files,
    })) : normalized.companies,
    families: Array.isArray(normalized.families) ? normalized.families.map((family) => ({
      ...family,
      current: attachIssuerLinks(family.current),
      history: attachIssuerLinks(family.history),
    })) : normalized.families,
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
