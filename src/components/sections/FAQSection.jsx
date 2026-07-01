import { useState } from "react";

import { CartProvider } from "../cart/CartContext";
import CartDrawer from "../cart/CartDrawer";

import Navbar from "../nav/Navbar";
import SiteFooter from "../footer/SiteFooter";

const faqs = [
  {
    tag: "General",
    question: "What makes RGVPRIMER different?",
    answer:
      "RGVPRIMER keeps the experience clean, organized, and professional, with clear product details, documentation access, and a simple ordering flow.",
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
      "Yes. Products displayed by RGVPRIMER RESEARCH LLC are intended strictly for laboratory and in-vitro research purposes only. They are not for human consumption, veterinary use, diagnostic use, therapeutic use, cosmetic use, food use, dietary supplement use, or clinical application.",
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
      <div className="min-h-screen overflow-x-hidden bg-[#030303] text-white">
        <Navbar transparent />

        <main className="relative overflow-hidden bg-[#030303]">
          <section className="relative overflow-hidden bg-[#030303] px-5 pb-20 pt-[160px] text-white sm:px-6 sm:pt-[180px] lg:px-8 lg:pt-[195px]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_6%,rgba(220,38,38,0.1),transparent_30%)]" />

            <div className="relative z-10 mx-auto w-full max-w-[980px]">
              {/* HEADER */}
              <div className="border-b border-white/10 pb-7 text-center">
                <p className="mb-3 text-[10px] font-black uppercase tracking-[0.22em] text-red-500">
                  RGVPRIMER FAQ
                </p>

                <h1 className="mx-auto max-w-[760px] text-4xl font-black uppercase leading-[0.9] tracking-[-0.055em] text-white sm:text-5xl lg:text-6xl">
                  Questions
                  <span className="block text-white/65">Answered</span>
                </h1>

                <p className="mx-auto mt-5 max-w-[620px] text-sm leading-6 text-white/45 sm:text-base sm:leading-7">
                  Clear answers about orders, COA documentation, tracking,
                  support, and research-use-only product information.
                </p>
              </div>

              {/* FAQ LIST */}
              <div className="mt-8 space-y-3">
                {faqs.map((item, index) => {
                  const isOpen = openIndex === index;

                  return (
                    <article
                      key={item.question}
                      className={`overflow-hidden rounded-[1.35rem] border bg-[#080808] transition duration-300 sm:rounded-3xl ${
                        isOpen
                          ? "border-red-500/35"
                          : "border-white/10 hover:border-red-500/25 hover:bg-[#0d0d0d]"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setOpenIndex(isOpen ? null : index)}
                        className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left sm:px-6"
                        aria-expanded={isOpen}
                      >
                        <div className="min-w-0">
                          <p className="mb-2 text-[9px] font-black uppercase tracking-[0.18em] text-red-400/80">
                            {item.tag}
                          </p>

                          <h2 className="text-[15px] font-black uppercase leading-[1.12] tracking-[-0.025em] text-white sm:text-lg">
                            {item.question}
                          </h2>
                        </div>

                        <span
                          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border text-lg font-black leading-none transition duration-300 ${
                            isOpen
                              ? "rotate-45 border-red-500/40 bg-red-600 text-white"
                              : "border-white/10 bg-white/[0.035] text-white/45"
                          }`}
                          aria-hidden="true"
                        >
                          +
                        </span>
                      </button>

                      <div
                        className={`grid transition-all duration-300 ${
                          isOpen
                            ? "grid-rows-[1fr] opacity-100"
                            : "grid-rows-[0fr] opacity-0"
                        }`}
                      >
                        <div className="overflow-hidden">
                          <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                            <div className="h-px w-full bg-white/10" />

                            <p className="pt-4 text-sm leading-7 text-white/50">
                              {item.answer}
                            </p>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* BOTTOM */}
              <div className="mt-9 rounded-[1.35rem] border border-white/10 bg-white/[0.03] p-5 text-center sm:rounded-3xl sm:p-6">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-500">
                  Need more help?
                </p>

                <p className="mx-auto mt-3 max-w-[540px] text-sm leading-6 text-white/45">
                  Contact our support team or track an existing order directly.
                </p>

                <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
                  <a
                    href="/contact"
                    className="inline-flex min-h-11 items-center justify-center rounded-full bg-red-600 px-6 text-[10px] font-black uppercase tracking-[0.14em] text-white transition hover:bg-red-500"
                  >
                    Contact Support
                  </a>

                  <a
                    href="/track-order"
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-black/35 px-6 text-[10px] font-black uppercase tracking-[0.14em] text-white/55 transition hover:border-red-500/35 hover:bg-red-500/[0.06] hover:text-white"
                  >
                    Track Order
                  </a>
                </div>
              </div>

              <p className="mx-auto mt-8 max-w-3xl text-center text-[10px] leading-5 text-white/30">
                Products shown are intended strictly for laboratory research use
                only. Not for human consumption, veterinary use, diagnostic use,
                therapeutic use, cosmetic use, food use, dietary supplement use,
                or clinical application.
              </p>
            </div>
          </section>
        </main>

        <SiteFooter />
        <CartDrawer checkoutPath="/checkout" />
      </div>
    </CartProvider>
  );
}