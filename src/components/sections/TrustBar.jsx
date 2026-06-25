const trustItems = [
  {
    title: "Research Use Only",
    subtitle: "Not for human or animal use",
    icon: "flask",
  },
  {
    title: "Fast Fulfillment",
    subtitle: "Processed with care",
    icon: "bolt",
  },
  {
    title: "Quality Focused",
    subtitle: "Premium standards",
    icon: "shield",
  },
  {
    title: "Secure Checkout",
    subtitle: "Protected shopping",
    icon: "lock",
  },
];

function Icon({ name }) {
  const baseClass = "h-5 w-5 shrink-0 text-white";

  if (name === "flask") {
    return (
      <svg
        viewBox="0 0 24 24"
        className={baseClass}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 2h6" />
        <path d="M10 2v6l-5.5 9.5A3 3 0 0 0 7.1 22h9.8a3 3 0 0 0 2.6-4.5L14 8V2" />
        <path d="M7.5 16h9" />
      </svg>
    );
  }

  if (name === "bolt") {
    return (
      <svg
        viewBox="0 0 24 24"
        className={baseClass}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M13 2 4 14h7l-1 8 10-13h-7l1-7Z" />
      </svg>
    );
  }

  if (name === "shield") {
    return (
      <svg
        viewBox="0 0 24 24"
        className={baseClass}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path d="m9 12 2 2 4-5" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      className={baseClass}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export default function TrustBar() {
  return (
    <section className="relative overflow-hidden bg-black py-5 text-white sm:py-6">
      {/* BACKGROUND EFFECTS */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,rgba(220,38,38,0.18),transparent_28%),radial-gradient(circle_at_80%_50%,rgba(127,29,29,0.16),transparent_30%)]" />

      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-600/45 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="relative z-10 mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {trustItems.map((item) => (
            <div
              key={item.title}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] p-4 backdrop-blur transition duration-300 hover:-translate-y-1 hover:border-red-500/35 hover:bg-red-500/[0.055] sm:p-5"
            >
              <div className="absolute inset-0 opacity-0 transition duration-300 group-hover:opacity-100">
                <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-red-600/15 blur-2xl" />
              </div>

              <div className="relative flex items-center gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-red-600 to-red-950 shadow-[0_18px_45px_rgba(220,38,38,0.25)]">
                  <Icon name={item.icon} />
                </div>

                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase leading-4 tracking-[0.18em] text-white">
                    {item.title}
                  </p>
                  <p className="mt-1 text-[11px] font-semibold uppercase leading-4 tracking-[0.12em] text-white/45">
                    {item.subtitle}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* SMALL DISCLAIMER */}
        <p className="mx-auto mt-4 max-w-4xl text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
          Products are intended strictly for laboratory research use only.
        </p>
      </div>
    </section>
  );
}