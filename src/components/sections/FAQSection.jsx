import { useState } from "react";

const faqs = [
  {
    question: "What makes RGVPRIMER different?",
    answer:
      "RGVPRIMER keeps the shopping experience clean, direct, and easy to understand with clear product details, organized pages, and a professional ordering flow.",
  },
  {
    question: "Do products include COAs?",
    answer:
      "When a COA is available, it will be shown clearly with the product so you can review the information before placing your order.",
  },
  {
    question: "How fast are orders processed?",
    answer:
      "Orders are prepared as quickly as possible after confirmation. You will receive updates so you can follow your purchase with confidence.",
  },
  {
    question: "Can I ask questions before ordering?",
    answer:
      "Yes. If you need help with product details, availability, documentation, or order support, you can contact us before completing your purchase.",
  },
  {
    question: "Is the ordering process simple?",
    answer:
      "Yes. The site is designed to make browsing, reviewing, and ordering products feel smooth, clear, and easy from start to finish.",
  },
];

export default function FAQSection() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section className="relative overflow-hidden py-16 text-white sm:py-20 lg:py-24">
      {/* RED BACK GLOW - NO SOLID BACKGROUND */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-600/20 blur-[135px]" />
        <div className="absolute right-[10%] top-[20%] h-[300px] w-[300px] rounded-full bg-red-500/14 blur-[95px]" />
        <div className="absolute bottom-[10%] left-[8%] h-[260px] w-[260px] rounded-full bg-rose-700/10 blur-[95px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1240px] px-6 sm:px-8 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start lg:gap-14">
          {/* LEFT CONTENT */}
          <div>
            <p className="mb-3 text-xs font-black uppercase tracking-[0.22em] text-red-500">
              FAQ
            </p>

            <h2 className="max-w-xl text-3xl font-black leading-tight tracking-[-0.04em] text-white sm:text-4xl md:text-5xl">
              Questions Before You Order?
            </h2>

            <p className="mt-4 max-w-xl text-sm leading-6 text-white/55 sm:text-base">
              Quick answers about shopping with RGVPRIMER, product details,
              documentation, support, and the ordering process.
            </p>

            <div className="mt-7 rounded-3xl border border-white/10 bg-white/[0.035] p-6">
              <p className="text-sm font-medium leading-6 text-white/55">
                Built to keep your experience simple, organized, and easy to
                navigate from product selection to checkout.
              </p>
            </div>
          </div>

          {/* FAQ ITEMS */}
          <div className="space-y-4">
            {faqs.map((item, index) => {
              const isOpen = openIndex === index;

              return (
                <article
                  key={item.question}
                  className={`group relative overflow-hidden rounded-3xl border transition-colors duration-200 ${
                    isOpen
                      ? "border-red-500/35 bg-[#0a0a0a] shadow-[0_22px_70px_rgba(0,0,0,0.32)]"
                      : "border-white/10 bg-[#0a0a0a] hover:border-red-500/35"
                  }`}
                >
                  <div
                    className={`pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-red-600/10 blur-3xl transition duration-200 ${
                      isOpen ? "bg-red-600/20" : "group-hover:bg-red-600/20"
                    }`}
                  />

                  <button
                    type="button"
                    onClick={() => setOpenIndex(isOpen ? null : index)}
                    className="relative flex w-full items-center justify-between gap-5 px-6 py-5 text-left"
                    aria-expanded={isOpen}
                  >
                    <h3 className="text-base font-black leading-tight tracking-[-0.03em] text-white sm:text-lg">
                      {item.question}
                    </h3>

                    <span
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl border text-2xl font-black leading-none transition duration-200 ${
                        isOpen
                          ? "rotate-45 border-red-500/35 bg-red-600/15 text-red-300"
                          : "border-white/10 bg-white/[0.04] text-white/45 group-hover:border-red-500/35 group-hover:text-red-300"
                      }`}
                    >
                      +
                    </span>
                  </button>

                  <div
                    className={`relative overflow-hidden transition-all duration-150 ease-out ${
                      isOpen ? "max-h-40 opacity-100" : "max-h-0 opacity-0"
                    }`}
                  >
                    <p className="px-6 pb-6 text-sm leading-6 text-white/55 sm:text-base">
                      {item.answer}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}