import { ArrowUpRight, MessageSquareText } from "lucide-react";
import "./SiteFooter.css";

const footerLinks = [
  {
    title: "Shop",
    links: [
      { label: "Products", href: "/shop" },
      { label: "COA", href: "/coa" },
      { label: "Track Order", href: "/track-order" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Shipping Policy", href: "/policies#shipping" },
      { label: "Refund Policy", href: "/policies#refunds" },
      { label: "FAQ", href: "/faq" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms & Conditions", href: "/policies#terms" },
      { label: "Privacy Policy", href: "/policies#privacy" },
      {
        label: "Research Use Disclaimer",
        href: "/policies#research-use",
      },
    ],
  },
];

const supportPhone = "+19565408538";
const supportPhoneDisplay = "(956) 540-8538";

export default function SiteFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="rgv-footer">
      <div className="rgv-footer-shell">
        <div className="rgv-footer-main">
          <div className="rgv-footer-brand">
            <a href="/" aria-label="RGVPRIME Research Home">
              <img src="/logo.webp" alt="RGVPRIME LLC" width="336" height="168" loading="lazy" decoding="async" />
            </a>
            <p>RGVPRIME LLC provides research-use-only products intended strictly for qualified laboratory and in-vitro research purposes.</p>
            <a href="/shop" className="rgv-footer-collection">Explore the collection <ArrowUpRight aria-hidden="true" /></a>
          </div>
          <nav className="rgv-footer-links" aria-label="Footer navigation">
            {footerLinks.map((group) => (
              <div key={group.title}>
                <h2>{group.title}</h2>
                <ul>{group.links.map((link) => <li key={link.label}><a href={link.href}>{link.label}</a></li>)}</ul>
              </div>
            ))}
          </nav>
        </div>

        <section id="support" className="rgv-footer-support" aria-labelledby="rgv-footer-support-title">
          <div className="rgv-footer-support__intro">
            <span><MessageSquareText aria-hidden="true" /></span>
            <div><h2 id="rgv-footer-support-title">A direct line to our team.</h2><p>Text support for orders and product documentation.</p></div>
          </div>
          <div className="rgv-footer-support__contact">
            <a href={`sms:${supportPhone}`} aria-label={`Text RGVPRIME at ${supportPhoneDisplay}`}>{supportPhoneDisplay}</a>
            <p>Mon–Fri <span>8:00 AM–5:00 PM CT</span></p>
          </div>
          <a href={`sms:${supportPhone}`} aria-label={`Text support at ${supportPhoneDisplay}`} className="rgv-footer-button">Start a text <ArrowUpRight aria-hidden="true" /></a>
        </section>

        <section className="rgv-footer-research" aria-labelledby="rgv-footer-research-title">
          <h2 id="rgv-footer-research-title">For laboratory and research use only.</h2>
          <div>
            <p>Products displayed on this website are intended strictly for in-vitro laboratory research purposes only. They are not for human consumption, veterinary use, diagnostic use, therapeutic use, cosmetic use, food use, dietary supplement use, or clinical application.</p>
            <p>Statements on this website have not been evaluated by the U.S. Food and Drug Administration. Products are not intended to diagnose, treat, cure, or prevent any disease.</p>
          </div>
        </section>
        <div className="rgv-footer-bottom">
          <p>© {currentYear} RGVPRIME LLC. All rights reserved.</p>
          <span>Research Use Only · Not For Human Use</span>
        </div>
      </div>
    </footer>
  );
}
