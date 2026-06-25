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
    <section className="relative overflow-hidden py-14 text-white sm:py-20 lg:py-24">
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-600/16 blur-[110px] sm:h-[560px] sm:w-[560px] sm:blur-[135px]" />
        <div className="absolute right-[-10%] top-[12%] h-[260px] w-[260px] rounded-full bg-red-500/10 blur-[90px] sm:right-[10%] sm:top-[20%] sm:h-[300px] sm:w-[300px]" />
        <div className="absolute bottom-[4%] left-[-12%] h-[240px] w-[240px] rounded-full bg-rose-700/10 blur-[90px] sm:bottom-[10%] sm:left-[8%] sm:h-[260px] sm:w-[260px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1240px] px-5 sm:px-8 lg:px-10">
        <div className="grid gap-9 lg:grid-cols-[0.9fr_1.1fr] lg:items-start lg:gap-14">
          <div className="mx-auto max-w-2xl text-center lg:mx-0 lg:text-left">
            <p className="mb-3 text-[10px] font-black uppercase tracking-[0.24em] text-red-400 sm:text-xs">
              FAQ
            </p>

            <h2 className="mx-auto max-w-xl text-[2.1rem] font-black leading-[0.98] tracking-[-0.055em] text-white sm:text-4xl md:text-5xl lg:mx-0">
              Questions Before You Order?
            </h2>

            <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-white/55 sm:text-base sm:leading-7 lg:mx-0">
              Quick answers about shopping with RGVPRIMER, product details,
              documentation, support, and the ordering process.
            </p>

            <div className="mx-auto mt-6 max-w-xl rounded-[1.45rem] border border-white/10 bg-white/[0.035] p-5 text-left shadow-[0_18px_60px_rgba(0,0,0,0.22)] backdrop-blur sm:mt-7 sm:rounded-3xl sm:p-6 lg:mx-0">
              <p className="text-sm font-medium leading-6 text-white/55">
                Built to keep your experience simple, organized, and easy to
                navigate from product selection to checkout.
              </p>
            </div>
          </div>

          <div className="mx-auto w-full max-w-2xl space-y-3 sm:space-y-4 lg:max-w-none">
            {faqs.map((item, index) => {
              const isOpen = openIndex === index;
              const answerId = `faq-answer-${index}`;

              return (
                <article
                  key={item.question}
                  className={`group relative overflow-hidden rounded-[1.45rem] border transition duration-300 sm:rounded-3xl ${
                    isOpen
                      ? "border-red-500/35 bg-[#0a0a0a] shadow-[0_22px_70px_rgba(0,0,0,0.34)]"
                      : "border-white/10 bg-[#0a0a0a]/95 hover:border-red-500/30"
                  }`}
                >
                  <div
                    className={`pointer-events-none absolute -right-14 -top-14 h-36 w-36 rounded-full blur-3xl transition duration-300 ${
                      isOpen
                        ? "bg-red-600/18"
                        : "bg-red-600/0 group-hover:bg-red-600/14"
                    }`}
                  />

                  <button
                    type="button"
                    onClick={() => setOpenIndex(isOpen ? null : index)}
                    className="relative flex w-full items-center justify-between gap-4 px-5 py-5 text-left sm:gap-5 sm:px-6 sm:py-5"
                    aria-expanded={isOpen}
                    aria-controls={answerId}
                  >
                    <h3 className="text-[15px] font-black leading-snug tracking-[-0.03em] text-white sm:text-lg">
                      {item.question}
                    </h3>

                    <span
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-2xl border text-xl font-black leading-none transition duration-300 sm:h-10 sm:w-10 sm:text-2xl ${
                        isOpen
                          ? "rotate-45 border-red-500/35 bg-red-600/15 text-red-300"
                          : "border-white/10 bg-white/[0.04] text-white/45 group-hover:border-red-500/35 group-hover:text-red-300"
                      }`}
                      aria-hidden="true"
                    >
                      +
                    </span>
                  </button>

                  <div
                    id={answerId}
                    className={`grid transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                      isOpen
                        ? "grid-rows-[1fr] opacity-100"
                        : "grid-rows-[0fr] opacity-0"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="px-5 pb-5 pt-1 sm:px-6 sm:pb-6 sm:pt-1">
                        <div className="rounded-[1.15rem] border border-white/[0.06] bg-white/[0.025] px-4 py-4 sm:rounded-2xl sm:px-5 sm:py-4">
                          <p className="text-[13px] leading-6 text-white/58 sm:text-[15px] sm:leading-7">
                            {item.answer}
                          </p>
                        </div>
                      </div>
                    </div>
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