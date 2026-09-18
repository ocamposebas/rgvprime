import { useState } from "react";
import { ArrowUpRight, Plus } from "lucide-react";
import "../../styles/experience.css";
import "./FAQSection.css";

import { CartProvider } from "../cart/CartContext";
import LazyCartDrawer from "../cart/LazyCartDrawer";

import Navbar from "../nav/Navbar";

const faqs = [
  {
    tag: "General",
    question: "What makes RGVPRIME different?",
    answer:
      "RGVPRIME keeps the experience clean, organized, and professional, with clear product details, documentation access, and a simple ordering flow.",
  },
  {
    tag: "COA",
    question: "Do products include COAs?",
    answer:
      "When a Certificate of Analysis is available, it will be shown clearly so you can review product documentation before placing an order.",
  },
  {
    tag: "Orders",
    question: "How fast are orders processed?",
    answer:
      "Orders are reviewed and prepared as quickly as possible after confirmation. Processing times may vary depending on order volume, verification, availability, and carrier conditions.",
  },
  {
    tag: "Support",
    question: "Can I ask questions before ordering?",
    answer:
      "Yes. You can contact support before placing an order if you need help with documentation, product records, order questions, or website navigation.",
  },
  {
    tag: "Research Use",
    question: "Are the products for research use only?",
    answer:
      "Yes. Products displayed by RGVPRIME LLC are intended strictly for laboratory and in-vitro research purposes only. They are not for human consumption, veterinary use, diagnostic use, therapeutic use, cosmetic use, food use, dietary supplement use, or clinical application.",
  },
  {
    tag: "Tracking",
    question: "Can I track my order?",
    answer:
      "Yes. You can use the Track Order page to check the latest available order status and shipping updates.",
  },
];

export default function FAQExperience() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <CartProvider>
      <Navbar transparent />
      <main className="rgv-experience rgv-faq">
        <div className="rgv-experience-shell">
          <header className="rgv-experience-heading">
            <p className="rgv-experience-kicker">RGVPRIME / CUSTOMER HELP</p>
            <h1 className="rgv-experience-title">Questions, <span>answered.</span></h1>
            <p className="rgv-experience-description">A clear guide to ordering, documentation, and support. Find the details you need before and after your purchase.</p>
          </header>
          <div className="rgv-faq-layout">
            <aside className="rgv-faq-aside" aria-label="Helpful links">
              <p className="rgv-faq-aside__label">Helpful links</p>
              {[
                ["/coa", "Product documentation", "Browse available Certificates of Analysis."],
                ["/track-order", "Track your order", "Check order status and shipment updates."],
                ["/account", "Your account", "Review purchases and manage your details."],
              ].map(([href, title, description]) => (
                <a key={href} href={href} className="rgv-faq-resource">
                  <div><span>{title}</span><p>{description}</p></div>
                  <ArrowUpRight aria-hidden="true" />
                </a>
              ))}
              <div className="rgv-faq-support">
                <h2>Still have a question?</h2>
                <p>Our team can help with orders, product records, and website support.</p>
                <a href="/contact" className="rgv-experience-button">Contact support <ArrowUpRight aria-hidden="true" /></a>
              </div>
            </aside>
            <section className="rgv-faq-list" aria-label="Frequently asked questions">
              {faqs.map((item, index) => {
                const isOpen = openIndex === index;
                return (
                  <article key={item.question} className={isOpen ? "is-open" : ""}>
                    <h2>
                      <button type="button" id={`rgv-faq-question-${index}`} aria-expanded={isOpen} aria-controls={`rgv-faq-answer-${index}`} onClick={() => setOpenIndex(isOpen ? null : index)}>
                        <span className="rgv-faq-number" aria-hidden="true">0{index + 1}</span>
                        <span className="rgv-faq-question"><small>{item.tag}</small><span>{item.question}</span></span>
                        <span className="rgv-faq-toggle"><Plus aria-hidden="true" /></span>
                      </button>
                    </h2>
                    <div id={`rgv-faq-answer-${index}`} role="region" aria-labelledby={`rgv-faq-question-${index}`} hidden={!isOpen} className="rgv-faq-answer"><p>{item.answer}</p></div>
                  </article>
                );
              })}
            </section>
          </div>
          <p className="rgv-experience-notice">Products shown are intended strictly for laboratory research use only. Not for human consumption, veterinary use, diagnostic use, therapeutic use, cosmetic use, food use, dietary supplement use, or clinical application.</p>
        </div>
      </main>
      <LazyCartDrawer checkoutPath="/checkout" />
    </CartProvider>
  );
}
