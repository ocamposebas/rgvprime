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
<footer
  id="support"
  className="relative scroll-mt-32 overflow-hidden border-t border-white/[0.07] bg-[#030303] text-white"
>      {/* Fondo ambiental */}
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
                alt="RGVPRIME Research LLC"
                className="h-16 w-auto object-contain sm:h-20 lg:h-24"
              />
            </a>

            <p className="mt-7 max-w-[590px] text-sm font-medium leading-7 text-white/45">
              RGVPRIME RESEARCH LLC provides research-use-only products
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

          {/* Navegación y soporte integrados */}
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

            {/* Soporte integrado en el mismo lado */}
            <div className="relative mt-8 overflow-hidden rounded-[22px] border border-white/[0.09] bg-white/[0.025]">
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,rgba(127,29,29,0.13),transparent_48%,rgba(220,38,38,0.025))]" />

              <div className="relative grid grid-cols-[1fr_auto] items-center gap-5 px-5 py-5 sm:px-6 lg:grid-cols-[auto_1fr_auto] lg:gap-7">
                {/* Need help */}
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.24em] text-red-400/80">
                    Need Help?
                  </p>

                  <p className="mt-1.5 text-[11px] font-semibold text-white/40">
                    Call or text support
                  </p>
                </div>

                {/* Teléfono */}
                <div className="min-w-0 lg:border-l lg:border-white/[0.08] lg:pl-7">
                  <a
                    href={`tel:${supportPhone}`}
                    aria-label={`Call RGVPRIME at ${supportPhoneDisplay}`}
                    className="block whitespace-nowrap text-[20px] font-black tracking-[-0.035em] text-white transition hover:text-red-400 sm:text-2xl"
                  >
                    {supportPhoneDisplay}
                  </a>

                  <p className="mt-1 text-[9px] font-black uppercase tracking-[0.16em] text-white/30">
                    Central Time · CT
                  </p>
                </div>

                {/* Botones */}
                <div className="col-span-2 flex items-center gap-2 lg:col-span-1">
                  <a
                    href={`tel:${supportPhone}`}
                    className="inline-flex min-h-10 flex-1 items-center justify-center rounded-xl bg-red-600 px-4 text-[9px] font-black uppercase tracking-[0.12em] text-white transition hover:bg-red-500 lg:flex-none"
                  >
                    Call
                  </a>

                  <a
                    href={`sms:${supportPhone}`}
                    className="inline-flex min-h-10 flex-1 items-center justify-center rounded-xl border border-red-500/25 bg-red-500/[0.07] px-4 text-[9px] font-black uppercase tracking-[0.12em] text-white transition hover:border-red-500/45 hover:bg-red-500/[0.12] lg:flex-none"
                  >
                    Text
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
            © {currentYear} RGVPRIME RESEARCH LLC. All rights reserved.
          </p>

          <p className="text-right text-[8px] font-black uppercase tracking-[0.16em] text-white/24 sm:text-[10px]">
            Research Use Only · Not For Human Use
          </p>
        </div>
      </div>
    </footer>
  );
}