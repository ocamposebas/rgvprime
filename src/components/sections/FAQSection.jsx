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
    <section className="relative overflow-hidden px-4 py-14 text-white sm:px-6 sm:py-20 lg:px-8 lg:py-24">
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute left-1/2 top-[24%] h-[360px] w-[360px] -translate-x-1/2 rounded-full bg-red-600/10 blur-[95px] sm:h-[520px] sm:w-[520px] sm:bg-red-600/14 sm:blur-[130px]" />
        <div className="absolute bottom-[-10%] right-[-18%] h-[280px] w-[280px] rounded-full bg-red-900/10 blur-[95px] sm:right-[8%] sm:h-[340px] sm:w-[340px]" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-[1180px]">
        <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-12">
          <div className="mx-auto w-full max-w-[620px] text-center lg:mx-0 lg:text-left">
            <p className="mb-3 text-[10px] font-black uppercase tracking-[0.22em] text-red-400">
              FAQ
            </p>

            <h2 className="mx-auto max-w-[520px] text-[2rem] font-black leading-[0.98] tracking-[-0.055em] text-white sm:text-4xl md:text-5xl lg:mx-0">
              Questions Before You Order?
            </h2>

            <p className="mx-auto mt-4 max-w-[540px] text-sm leading-6 text-white/50 sm:text-base sm:leading-7 lg:mx-0">
              Quick answers about shopping with RGVPRIMER, product details,
              documentation, support, and the ordering process.
            </p>

            <div className="mx-auto mt-6 max-w-[540px] rounded-2xl border border-white/10 bg-white/[0.025] px-5 py-4 text-left lg:mx-0">
              <p className="text-sm leading-6 text-white/48">
                Built to keep your experience simple, organized, and easy to
                navigate from product selection to checkout.
              </p>
            </div>
          </div>

          <div className="mx-auto w-full max-w-[680px] space-y-3 lg:max-w-none">
            {faqs.map((item, index) => {
              const isOpen = openIndex === index;

              return (
                <article
                  key={item.question}
                  className={`relative overflow-hidden rounded-2xl border transition-colors duration-200 sm:rounded-[1.6rem] ${
                    isOpen
                      ? "border-red-500/35 bg-white/[0.045]"
                      : "border-white/10 bg-white/[0.025] hover:border-red-500/25 hover:bg-white/[0.035]"
                  }`}
                >
                  <div
                    className={`pointer-events-none absolute right-[-60px] top-[-60px] h-[150px] w-[150px] rounded-full blur-3xl transition-opacity duration-200 ${
                      isOpen ? "bg-red-600/16 opacity-100" : "opacity-0"
                    }`}
                  />

                  <button
                    type="button"
                    onClick={() => setOpenIndex(isOpen ? null : index)}
                    className="relative flex w-full items-center justify-between gap-4 px-4 py-4 text-left sm:px-5 sm:py-5"
                    aria-expanded={isOpen}
                  >
                    <h3 className="pr-2 text-[15px] font-black leading-snug tracking-[-0.025em] text-white sm:text-lg">
                      {item.question}
                    </h3>

                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl border text-lg font-black leading-none transition duration-200 sm:h-9 sm:w-9 ${
                        isOpen
                          ? "rotate-45 border-red-400/35 bg-red-600/15 text-red-300"
                          : "border-white/10 bg-white/[0.035] text-white/45"
                      }`}
                      aria-hidden="true"
                    >
                      +
                    </span>
                  </button>

                  {isOpen && (
                    <div className="relative px-4 pb-5 sm:px-5 sm:pb-5">
                      <div className="h-px w-full bg-white/[0.07]" />

                      <p className="pt-4 text-[13px] leading-6 text-white/55 sm:text-[15px] sm:leading-7">
                        {item.answer}
                      </p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}