export const COMPLIANCE_POLICY_VERSION = "rgv-ruo-terms-2026-08-31-v1";
export const COMPLIANCE_TEXT_VERSION = "checkout-certification-2026-08-31-v1";

export function hasRequiredAcknowledgements(body = {}) {
  return body.ageConfirmed === true &&
    body.researchUseAcknowledged === true &&
    body.termsAccepted === true;
}
