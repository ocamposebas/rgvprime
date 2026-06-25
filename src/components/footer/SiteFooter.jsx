const footerLinks = [
  {
    title: "Shop",
    links: [
      { label: "Products", href: "/shop" },
      { label: "COA", href: "/coa" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Shipping Policy", href: "/shipping-policy" },
      { label: "Refund Policy", href: "/refund-policy" },
      { label: "FAQ", href: "/faq" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms & Conditions", href: "/terms" },
      { label: "Privacy Policy", href: "/privacy-policy" },
      { label: "Research Use Disclaimer", href: "/research-use-disclaimer" },
    ],
  },
];

export default function SiteFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="relative overflow-hidden bg-[#030303] text-white">
      {/* BACKGROUND */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(220,38,38,0.12),transparent_30%),radial-gradient(circle_at_85%_20%,rgba(127,29,29,0.1),transparent_34%)]" />

      <div className="relative z-10 mx-auto max-w-[1320px] px-6 py-14 sm:px-8 lg:px-12 lg:py-16">
        {/* TOP */}
        <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:gap-14">
          {/* BRAND */}
          <div>
            <a href="/" aria-label="RGV Prime Home" className="inline-flex">
              <img
                src="/logo.webp"
                alt="RGV Prime"
                className="h-20 w-auto object-contain sm:h-24"
              />
            </a>

            <p className="mt-5 max-w-xl text-sm leading-7 text-white/55">
              RGV Prime Peps & Performance provides research-use-only products
              intended strictly for laboratory and in-vitro research purposes.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href="/shop"
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-red-600 px-5 text-xs font-black uppercase tracking-[0.1em] text-white transition hover:bg-red-500"
              >
                Shop Products
              </a>

              <a
                href="/contact"
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-5 text-xs font-black uppercase tracking-[0.1em] text-white transition hover:border-red-500/35 hover:bg-white/[0.08]"
              >
                Contact Us
              </a>
            </div>
          </div>

          {/* LINKS */}
          <div className="grid gap-8 sm:grid-cols-3">
            {footerLinks.map((group) => (
              <div key={group.title}>
                <h3 className="text-xs font-black uppercase tracking-[0.18em] text-red-500">
                  {group.title}
                </h3>

                <ul className="mt-4 space-y-3">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        className="text-sm font-semibold text-white/55 transition hover:text-white"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* DISCLAIMER */}
        <div className="mt-12 rounded-3xl border border-red-500/20 bg-red-500/[0.055] p-5 sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-red-300">
            For laboratory and research use only.
          </p>

          <p className="mt-3 text-xs leading-6 text-white/55 sm:text-sm sm:leading-7">
            Products displayed on this website are intended strictly for
            in-vitro laboratory research purposes only. They are not for human
            consumption, veterinary use, diagnostic use, therapeutic use,
            cosmetic use, food use, dietary supplement use, or clinical
            application.
          </p>

          <p className="mt-3 text-xs leading-6 text-white/55 sm:text-sm sm:leading-7">
            Statements on this website have not been evaluated by the U.S. Food
            and Drug Administration. Products are not intended to diagnose,
            treat, cure, or prevent any disease.
          </p>
        </div>

        {/* BOTTOM */}
        <div className="mt-8 flex flex-col gap-4 border-t border-white/10 pt-6 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
          <p className="text-xs text-white/35">
            © {currentYear} RGVPRIME RESEARCH LLC & Performance. All rights reserved.
          </p>

          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/30">
            Research Use Only · Not For Human Use
          </p>
        </div>
      </div>
    </footer>
  );
}