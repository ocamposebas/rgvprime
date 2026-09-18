import { ArrowDown, ArrowUpRight } from "lucide-react";
import "./Hero.css";

const destinations = [
  { number: "01", title: "Single vials", detail: "Individual research formats", href: "/shop?format=singles" },
  { number: "02", title: "10 vial kits", detail: "Explore the kit collection", href: "/shop?format=kits" },
  { number: "03", title: "Certificate library", detail: "Review the published records", href: "/coa" },
];

export default function Hero() {
  return (
    <section className="rgv-hero" aria-labelledby="home-hero-title">
      <div className="rgv-home-shell">
        <div className="rgv-hero__composition">
          <div className="rgv-hero__copy">
            <h1 id="home-hero-title" className="rgv-hero__title">
              <span className="rgv-hero__title-line">Research </span>
              <span className="rgv-hero__title-line rgv-hero__title-accent">In detail</span>
            </h1>
            <div className="rgv-hero__introduction">
              <span className="rgv-hero__intro-rule" aria-hidden="true" />
              <p>A considered collection of laboratory research compounds.<br className="rgv-hero__desktop-break" /> Explore the specifications. Review the documentation.</p>
            </div>
            <div className="rgv-hero__actions">
              <a className="rgv-hero-primary" href="/shop">
                Shop the collection <ArrowUpRight size={18} strokeWidth={1.7} aria-hidden="true" />
              </a>
              <a className="rgv-hero-secondary" href="/coa">Explore COAs</a>
            </div>
          </div>

          <nav className="rgv-hero__index" aria-label="Explore the research catalog">
            <div className="rgv-hero__index-header">
              <span>EXPLORE / RGVPRIME</span>
              <ArrowUpRight size={22} strokeWidth={1.3} aria-hidden="true" />
            </div>
            <p className="rgv-hero__index-title">Choose a format.<br />Review the record.</p>
            <div className="rgv-hero__index-links">
              {destinations.map(({ number, title, detail, href }) => (
                <a key={number} href={href}>
                  <span className="rgv-hero__index-number">{number}</span>
                  <span className="rgv-hero__index-copy"><strong>{title}</strong><small>{detail}</small></span>
                  <ArrowUpRight size={18} strokeWidth={1.4} aria-hidden="true" />
                </a>
              ))}
            </div>
          </nav>
        </div>

        <div className="rgv-hero__baseline">
          <p>For in-vitro laboratory research only.<span> Not for human or animal use.</span></p>
          <a href="#featured-products">Inside the collection <ArrowDown size={14} aria-hidden="true" /></a>
        </div>
      </div>
    </section>
  );
}
