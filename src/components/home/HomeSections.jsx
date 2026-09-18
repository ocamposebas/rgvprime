import { useEffect, useId, useMemo, useState } from "react";
import { ArrowUpRight, Plus } from "lucide-react";

const formats = [
  { amount: "1", unit: "VIAL", title: "Single vials", description: "Explore individual vials and the available specifications for each compound.", href: "/shop?format=singles", action: "Explore single vials" },
  { amount: "10", unit: "VIALS / KIT", title: "10 vial kits", description: "Browse the kit selection. Available strengths and pricing are listed by product.", href: "/shop?format=kits", action: "Explore the kits" },
];

export function ResearchFormats() {
  return (
    <section id="research-formats" className="rgv-home-formats rgv-home-section" aria-labelledby="home-formats-title">
      <div className="rgv-home-shell rgv-home-formats__layout">
        <div className="rgv-home-formats__intro">
          <p className="rgv-home-kicker"><span>02</span> YOUR FORMAT</p>
          <h2 id="home-formats-title">One vial.<br />Or the full set.</h2>
          <p>Start with the format that fits your laboratory requirements. Review the product specifications before ordering.</p>
          <span className="rgv-home-formats__note">Same catalog. Two ways to explore.</span>
        </div>
        <div className="rgv-home-formats__options">
          {formats.map((format) => (
            <a key={format.amount} className="rgv-home-format" href={format.href}>
              <div className="rgv-home-format__top"><span>RESEARCH FORMAT</span><ArrowUpRight size={19} strokeWidth={1.4} aria-hidden="true" /></div>
              <div className="rgv-home-format__quantity"><span>{format.amount}</span><small>{format.unit}</small></div>
              <h3>{format.title}</h3>
              <p>{format.description}</p>
              <span className="rgv-home-format__action">{format.action} <ArrowUpRight size={14} aria-hidden="true" /></span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function publishedRecords(payload) {
  const companies = Array.isArray(payload?.companies) ? payload.companies : [];
  const files = companies.flatMap((company) =>
    (Array.isArray(company.files) ? company.files : []).map((file) => ({
      ...file,
      lab: file.lab || "",
    })),
  );
  const items = files.length ? files : Array.isArray(payload?.items) ? payload.items : [];
  const seen = new Set();
  return items
    .map((file) => ({
      product: file.product || file.product_name || file.title || "Certificate of Analysis",
      code: file.code || file.report_code || "",
      lot: file.lot || file.batch || "",
      lab: file.lab || "",
      purity: file.purity || "",
      url: String(file.url || file.pdf_url || "").trim(),
    }))
    .filter((file) => {
      if (!/^(https?:\/\/|\/(?!\/))/i.test(file.url) || seen.has(file.url)) return false;
      seen.add(file.url);
      return true;
    })
    .slice(0, 3);
}

export function CertificateRecords() {
  const [payload, setPayload] = useState(null);
  const [status, setStatus] = useState("loading");
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/coas", { headers: { Accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error("Certificate library unavailable");
        setPayload(data);
        setStatus("ready");
      })
      .catch((error) => {
        if (error.name !== "AbortError") setStatus("error");
      });
    return () => controller.abort();
  }, []);

  const records = useMemo(() => publishedRecords(payload), [payload]);
  const record = records[selected] || records[0];
  const fields = record ? [
    { label: "Report reference", value: record.code },
    { label: "Batch / lot", value: record.lot },
    { label: "Laboratory", value: record.lab },
    { label: "Reported purity", value: record.purity },
  ].filter((field) => field.value) : [];

  return (
    <section id="home-documentation" className="rgv-home-records rgv-home-section" aria-labelledby="home-records-title">
      <div className="rgv-home-shell rgv-home-records__layout">
        <div className="rgv-home-records__intro">
          <p className="rgv-home-kicker"><span>03</span> THE DOCUMENTATION</p>
          <h2 id="home-records-title">Read the record.<br /><span>Before you order.</span></h2>
          <p>Explore the available Certificates of Analysis. Review the published record and open the original PDF for the full report.</p>
          {records.length > 0 && (
            <div className="rgv-home-record-list" aria-label="Available certificate records">
              {records.map((item, index) => (
                <button type="button" key={item.url} onClick={() => setSelected(index)} aria-pressed={selected === index}>
                  <span className="rgv-home-record-list__number">{"0" + (index + 1)}</span>
                  <span><strong>{item.product}</strong><small>{item.code || "Certificate of Analysis"}</small></span>
                  <ArrowUpRight size={16} strokeWidth={1.3} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
          <a className="rgv-home-text-link" href="/coa">Explore the COA library <ArrowUpRight size={16} aria-hidden="true" /></a>
        </div>

        <div className="rgv-home-record-sheet" aria-live="polite" aria-busy={status === "loading"}>
          <div className="rgv-home-record-sheet__header"><span>RGV / DOCUMENTATION</span><span>COA</span></div>
          <p className="rgv-home-record-sheet__label">PUBLISHED CERTIFICATE RECORD</p>
          <h3>Certificate<br />of Analysis.</h3>
          {record ? (
            <>
              <p className="rgv-home-record-sheet__product">{record.product}</p>
              <dl>{fields.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
              <a href={record.url} target="_blank" rel="noopener noreferrer">Open the original PDF <ArrowUpRight size={17} aria-hidden="true" /></a>
              <p className="rgv-home-record-sheet__caption">Summary of the published record. Refer to the original report for complete results.</p>
            </>
          ) : (
            <div className="rgv-home-record-sheet__empty">
              <p>{status === "loading" ? "Loading the published records…" : status === "error" ? "Record previews are temporarily unavailable." : "Browse available documentation in the certificate library."}</p>
              <a href="/coa">Visit the certificate library <ArrowUpRight size={17} aria-hidden="true" /></a>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const questions = [
  { question: "Where can I find product specifications?", answer: "Open a product in the catalog to review its listed specifications, available strengths, formats, pricing, and current availability." },
  { question: "Can I review a COA before ordering?", answer: "Yes. Available Certificates of Analysis can be reviewed in the COA library. Check that the published product and batch information correspond to the record you need." },
  { question: "How do I track an order?", answer: "Use the Track Order page to check the latest available order status and shipping updates.", href: "/track-order", action: "Track your order" },
  { question: "Who are these products intended for?", answer: "Products are intended strictly for laboratory and in-vitro research. They are not for human or animal use, diagnostic use, therapeutic use, or clinical application.", href: "/policies#research-use", action: "Read the research-use policy" },
];

export function HomeQuestions() {
  const [openIndex, setOpenIndex] = useState(null);
  const id = useId();
  return (
    <section className="rgv-home-questions rgv-home-section" aria-labelledby="home-questions-title">
      <div className="rgv-home-shell rgv-home-questions__layout">
        <div>
          <p className="rgv-home-kicker"><span>04</span> BEFORE YOU BEGIN</p>
          <h2 id="home-questions-title">Good questions.<br />Clear answers.</h2>
          <p className="rgv-home-questions__description">A few practical details before exploring the collection.</p>
          <a className="rgv-home-text-link" href="/faq">View all FAQs <ArrowUpRight size={16} aria-hidden="true" /></a>
        </div>
        <div className="rgv-home-questions__list">
          {questions.map((item, index) => {
            const open = index === openIndex;
            const panelId = id + "-answer-" + index;
            const buttonId = id + "-question-" + index;
            return (
              <article key={item.question}>
                <h3><button id={buttonId} type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpenIndex(open ? null : index)}>
                  <span>{item.question}</span><Plus className={open ? "is-open" : ""} size={18} strokeWidth={1.4} aria-hidden="true" />
                </button></h3>
                <div id={panelId} aria-labelledby={buttonId} hidden={!open} className="rgv-home-questions__answer">
                  <p>{item.answer}</p>
                  {item.href && <a className="rgv-home-text-link" href={item.href}>{item.action} <ArrowUpRight size={14} aria-hidden="true" /></a>}
                </div>
              </article>
            );
          })}
          <div className="rgv-home-questions__support"><span>Need a hand with the details?</span><a href="/contact">Contact support <ArrowUpRight size={14} aria-hidden="true" /></a></div>
        </div>
      </div>
    </section>
  );
}
