export default function CoaIssuerLink({ certificate, className, icon }) {
  const verification = certificate?.issuer_verification;
  if (!verification) return null;

  const { url, kind, accessCode } = verification;
  const label = {
    pdf: "Open lab PDF",
    report: "View lab report",
    lookup: "Verify on lab site",
  }[kind];
  if (!label || !url) return null;

  return (
    <div className="rgv-coa-issuer">
      <a className={className} href={url} target="_blank" rel="noopener noreferrer">
        {label} {icon}
      </a>
      {accessCode && (
        <p>Report {certificate.report_code || certificate.code} · Access code <code>{accessCode}</code></p>
      )}
    </div>
  );
}
