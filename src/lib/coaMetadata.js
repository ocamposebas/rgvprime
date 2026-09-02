export const VERIFIED_COA_IDENTITIES = Object.freeze({
  1967: "GHK-Cu",
  1969: "Retatrutide",
  1973: "SS-31 (Elamipretide)",
  1975: "Tirzepatide",
  1977: "ARA-290",
  1979: "BPC-157",
  2004: "Retatrutide",
  2007: "Retatrutide",
  2009: "GHK-Cu",
  2630: "5-amino-1MQ",
  2632: "KPV",
  2634: "GHK-Cu",
});

function normalizeIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Corrects a verified upstream parser defect without changing the source COA,
 * analytical notes, or any other record field. The guard deliberately applies
 * only to known COA post IDs whose current identity was misread as "Fentanyl".
 */
export function correctVerifiedCoaIdentities(value) {
  if (Array.isArray(value)) {
    return value.map(correctVerifiedCoaIdentities);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const corrected = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      correctVerifiedCoaIdentities(entry),
    ]),
  );
  const verifiedIdentity = VERIFIED_COA_IDENTITIES[Number(corrected.id)];

  if (
    verifiedIdentity &&
    normalizeIdentity(corrected.identity) === "fentanyl"
  ) {
    corrected.identity = verifiedIdentity;
  }

  return corrected;
}
