import { MessageSquareText } from "lucide-react";

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
    <footer className="relative overflow-hidden border-t border-white/[0.07] bg-[#030303] text-white">
      {/* Fondo ambiental */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-48 -top-40 h-[560px] w-[560px] rounded-full bg-red-950/30 blur-[160px]" />

        <div className="absolute left-[25%] top-0 h-[280px] w-[480px] rounded-full bg-red-900/[0.045] blur-[140px]" />

        <div className="absolute right-0 top-0 h-[300px] w-[380px] rounded-full bg-red-950/[0.08] blur-[140px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1320px] px-5 py-12 sm:px-8 lg:px-12 lg:py-16">
        {/* Contenido principal */}
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(560px,1fr)] lg:items-start lg:gap-20">
          {/* Marca */}
          <div className="min-w-0">
            <a
              href="/"
              aria-label="RGVPRIME Research Home"
              className="inline-flex transition duration-300 hover:opacity-80"
            >
              <img
                src="/logo.webp"
                alt="RGVPRIME LLC"
                className="h-16 w-auto object-contain sm:h-20 lg:h-24"
              />
            </a>

            <p className="mt-7 max-w-[590px] text-sm font-medium leading-7 text-white/45">
              RGVPRIME LLC provides research-use-only products
              intended strictly for qualified laboratory and in-vitro research
              purposes.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <a
                href="/shop"
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-red-600 px-6 text-[11px] font-black uppercase tracking-[0.12em] text-white shadow-[0_14px_40px_rgba(220,38,38,0.16)] transition duration-300 hover:-translate-y-0.5 hover:bg-red-500"
              >
                Shop Products
              </a>

              <a
                href="/track-order"
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-red-500/25 bg-red-950/20 px-6 text-[11px] font-black uppercase tracking-[0.12em] text-white transition duration-300 hover:-translate-y-0.5 hover:border-red-500/45 hover:bg-red-950/35"
              >
                Track Order
              </a>

              <a
                href="/contact"
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/[0.13] bg-white/[0.025] px-6 text-[11px] font-black uppercase tracking-[0.12em] text-white transition duration-300 hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.06]"
              >
                Contact Us
              </a>
            </div>
          </div>

          {/* Navegación y soporte */}
          <div className="min-w-0">
            {/* Enlaces */}
            <div className="grid grid-cols-3 gap-x-5 sm:gap-x-8 lg:gap-x-10">
              {footerLinks.map((group) => (
                <div key={group.title} className="min-w-0">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.22em] text-red-500 sm:text-[11px]">
                    {group.title}
                  </h3>

                  <ul className="mt-5 space-y-4">
                    {group.links.map((link) => (
                      <li key={link.label}>
                        <a
                          href={link.href}
                          className="block text-[11px] font-bold leading-5 text-white/70 transition duration-200 hover:text-red-400 sm:text-[13px]"
                        >
                          {link.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {/* Text Support */}
            <div
              id="support"
              className="relative mt-10 scroll-mt-36 overflow-hidden rounded-3xl border border-white/[0.1] bg-[#0a0708] shadow-[0_24px_70px_rgba(0,0,0,0.28)]"
            >
              {/* Fondo de la caja */}
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(127,29,29,0.16),transparent_52%,rgba(220,38,38,0.04))]" />

              <div className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full bg-red-600/[0.1] blur-[70px]" />

              <div className="relative p-5 sm:p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10 text-red-400">
                    <MessageSquareText
                      size={20}
                      strokeWidth={2.2}
                      aria-hidden="true"
                    />
                  </div>

                  <div className="min-w-0 pt-0.5">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-red-400">
                      Text Support
                    </p>

                    <p className="mt-1 text-[12px] font-medium leading-5 text-white/45">
                      Send our support team a message.
                    </p>
                  </div>
                </div>

                <div className="mt-5 border-t border-white/[0.08] pt-5">
                  <a
                    href={`sms:${supportPhone}`}
                    aria-label={`Text RGVPRIME at ${supportPhoneDisplay}`}
                    className="inline-block whitespace-nowrap text-[clamp(1.65rem,5vw,2.1rem)] font-black leading-none text-white transition hover:text-red-400"
                  >
                    {supportPhoneDisplay}
                  </a>

                  <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.55)]"
                      aria-hidden="true"
                    />

                    <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/55">
                      Mon–Fri
                    </span>

                    <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/35">
                      8:00 AM–5:00 PM CT
                    </span>
                  </div>

                  <a
                    href={`sms:${supportPhone}`}
                    aria-label={`Text support at ${supportPhoneDisplay}`}
                    className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-red-600 px-6 text-[10px] font-black uppercase tracking-[0.16em] text-white shadow-[0_12px_35px_rgba(220,38,38,0.2)] transition duration-300 hover:-translate-y-0.5 hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0708] sm:w-auto"
                  >
                    Start a Text
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="relative mt-12 overflow-hidden rounded-[24px] border border-red-500/25 bg-[#0c0506] px-6 py-6 sm:px-7 sm:py-7 lg:px-8">
          <div className="pointer-events-none absolute -left-24 -top-28 h-72 w-72 rounded-full bg-red-700/[0.07] blur-[100px]" />

          <div className="relative">
            <p className="text-[11px] font-black uppercase tracking-[0.17em] text-red-300">
              For laboratory and research use only.
            </p>

            <p className="mt-4 text-xs font-medium leading-6 text-white/48 sm:text-[13px] sm:leading-7">
              Products displayed on this website are intended strictly for
              in-vitro laboratory research purposes only. They are not for
              human consumption, veterinary use, diagnostic use, therapeutic
              use, cosmetic use, food use, dietary supplement use, or clinical
              application.
            </p>

            <p className="mt-3 text-xs font-medium leading-6 text-white/32 sm:text-[13px] sm:leading-7">
              Statements on this website have not been evaluated by the U.S.
              Food and Drug Administration. Products are not intended to
              diagnose, treat, cure, or prevent any disease.
            </p>
          </div>
        </div>

        {/* Parte inferior */}
        <div className="mt-8 flex items-center justify-between gap-5 border-t border-white/[0.08] pt-7">
          <p className="text-[9px] font-medium text-white/28 sm:text-[11px]">
            © {currentYear} RGVPRIME LLC. All rights reserved.
          </p>

          <p className="text-right text-[8px] font-black uppercase tracking-[0.16em] text-white/24 sm:text-[10px]">
            Research Use Only · Not For Human Use
          </p>
        </div>
      </div>
    </footer>
  );
}
