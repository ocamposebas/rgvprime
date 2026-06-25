  const steps = [
    {
      number: "01",
      title: "Choose Your Product",
      description:
        "Browse the product selection and choose the item that fits what you are looking for.",
      icon: "product",
    },
    {
      number: "02",
      title: "Review the Details",
      description:
        "Check the price, product information, and availability before continuing.",
      icon: "details",
    },
    {
      number: "03",
      title: "Place Your Order",
      description:
        "Continue to checkout and complete your order through a simple, secure process.",
      icon: "checkout",
    },
  ];

  function ProductIcon() {
    return (
      <svg
        viewBox="0 0 24 24"
        className="h-7 w-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="m3.3 7 8.7 5 8.7-5" />
        <path d="M12 22V12" />
      </svg>
    );
  }

  function DetailsIcon() {
    return (
      <svg
        viewBox="0 0 24 24"
        className="h-7 w-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8" />
        <path d="M8 17h5" />
      </svg>
    );
  }

  function CheckoutIcon() {
    return (
      <svg
        viewBox="0 0 24 24"
        className="h-7 w-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 6h15l-1.5 8.5a2 2 0 0 1-2 1.5H9a2 2 0 0 1-2-1.5L5 3H2" />
        <path d="M9 21h.01" />
        <path d="M18 21h.01" />
        <path d="M10 11l2 2 4-4" />
      </svg>
    );
  }

  function StepIcon({ type }) {
    if (type === "product") return <ProductIcon />;
    if (type === "details") return <DetailsIcon />;

    return <CheckoutIcon />;
  }

  export default function HowToOrder() {
    return (
      <section className="relative overflow-hidden bg-black py-16 text-white sm:py-20 lg:py-24">
        {/* BACKGROUND */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(220,38,38,0.12),transparent_30%),radial-gradient(circle_at_82%_30%,rgba(127,29,29,0.1),transparent_32%)]" />

        <div className="relative z-10 mx-auto max-w-[1240px] px-6 sm:px-8 lg:px-10">
          {/* HEADER */}
          <div className="mx-auto mb-10 max-w-3xl text-center sm:mb-12">
            <p className="mb-3 text-xs font-black uppercase tracking-[0.22em] text-red-500">
              How To Order
            </p>

            <h2 className="text-3xl font-black leading-tight tracking-[-0.04em] text-white sm:text-4xl md:text-5xl">
              Ordering Made Simple
            </h2>

            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/55 sm:text-base">
              A clear step-by-step process designed to make ordering easy.
            </p>
          </div>

          {/* STEPS */}
          <div className="grid gap-5 md:grid-cols-3">
            {steps.map((step) => (
              <article
                key={step.number}
                className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0a] p-6 shadow-[0_22px_70px_rgba(0,0,0,0.32)] transition duration-300 hover:-translate-y-1 hover:border-red-500/35"
              >
                <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-red-600/10 blur-3xl transition duration-300 group-hover:bg-red-600/20" />

                <div className="relative">
                  <div className="mb-6 flex items-center justify-between gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-red-500/25 bg-red-600/15 text-red-300">
                      <StepIcon type={step.icon} />
                    </div>

                    <span className="text-4xl font-black leading-none tracking-[-0.08em] text-white/10">
                      {step.number}
                    </span>
                  </div>

                  <h3 className="text-xl font-black leading-tight tracking-[-0.03em] text-white">
                    {step.title}
                  </h3>

                  <p className="mt-3 text-sm leading-6 text-white/55">
                    {step.description}
                  </p>
                </div>
              </article>
            ))}
          </div>

          {/* CTA BOX */}
          <div className="mt-8 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] p-6 text-center sm:mt-10 sm:p-8">
            <p className="text-lg font-black tracking-[-0.03em] text-white sm:text-2xl">
              Ready to browse the full product lineup?
            </p>

            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-white/55">
              Start with the shop page and choose the product you want to review.
            </p>

            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <a
                href="/shop"
                className="inline-flex min-h-12 items-center justify-center rounded-xl bg-red-600 px-7 text-sm font-black uppercase tracking-[0.08em] text-white transition hover:bg-red-500"
              >
                Shop Products
              </a>

              <a
                href="/contact"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-7 text-sm font-black uppercase tracking-[0.08em] text-white transition hover:border-red-500/35 hover:bg-white/[0.08]"
              >
                Need Help?
              </a>
            </div>
          </div>

          <p className="mx-auto mt-7 max-w-3xl text-center text-xs leading-6 text-white/35">
            Products are intended strictly for laboratory research use only. Not
            for human or animal use.
          </p>
        </div>
      </section>
    );
  }