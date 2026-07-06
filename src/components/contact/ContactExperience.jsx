// src/components/contact/ContactExperience.jsx
import { CartProvider } from "../cart/CartContext";
import CartDrawer from "../cart/CartDrawer";

import Navbar from "../nav/Navbar";
import SiteFooter from "../footer/SiteFooter";

const supportEmail = "support@rgvprimellc.com";

const contactOptions = [
  {
    title: "Order Support",
    text: "Questions about an existing order, payment confirmation, or delivery status.",
    href: "/track-order",
    action: "Track Order",
  },
  {
    title: "Documentation",
    text: "Requests related to COA records or product documentation.",
    href: "/coa",
    action: "View COA",
  },
  {
    title: "Direct Support",
    text: "For general questions, account help, or research-use-only product support.",
    href: `mailto:${supportEmail}`,
    action: "Email Us",
  },
];

export default function ContactExperience() {
  return (
    <CartProvider>
      <div className="min-h-screen bg-[#030303] text-white">
        <Navbar transparent />

        <main className="relative overflow-hidden bg-[#030303]">
          {/* FONDO NEGRO CON GLOW ROJO TIPO CATALOG */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_6%,rgba(220,38,38,0.18),transparent_32%),radial-gradient(circle_at_82%_8%,rgba(127,29,29,0.12),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_24%)]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-500/35 to-transparent" />

          <section className="relative z-10 pb-20 pt-[180px] text-white sm:pt-[192px] lg:pt-[205px]">
            <div className="mx-auto max-w-[1220px] px-3 sm:px-5 lg:px-6">
              {/* HEADER */}
              <div className="mb-8 flex flex-col gap-5 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-red-500">
                    Contact RGVPRIME
                  </p>

                  <h1 className="text-4xl font-black uppercase leading-[0.88] tracking-[-0.06em] text-white sm:text-5xl lg:text-6xl">
                    Support
                    <span className="block text-white/65">Center</span>
                  </h1>

                  <p className="mt-4 max-w-xl text-sm leading-6 text-white/45">
                    Get assistance with orders, documentation, product records,
                    and research-use-only inquiries.
                  </p>
                </div>

                <a
                  href={`mailto:${supportEmail}`}
                  className="rounded-2xl border border-white/10 bg-black/35 px-5 py-4 backdrop-blur transition hover:border-red-500/40 hover:bg-red-500/[0.06]"
                >
                  <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-red-500">
                    Official Email
                  </span>

                  <span className="mt-2 block text-sm font-black text-white">
                    {supportEmail}
                  </span>
                </a>
              </div>

              {/* OPTIONS */}
              <div className="grid gap-3 md:grid-cols-3">
                {contactOptions.map((item) => (
                  <a
                    key={item.title}
                    href={item.href}
                    className="group flex min-h-[210px] flex-col justify-between rounded-[1.35rem] border border-white/10 bg-[#080808]/95 p-5 transition duration-300 hover:-translate-y-1 hover:border-red-500/40 hover:bg-[#0d0d0d] hover:shadow-[0_28px_80px_rgba(0,0,0,0.42)] sm:rounded-3xl sm:p-6"
                  >
                    <div>
                      <h2 className="text-lg font-black uppercase leading-none tracking-[-0.04em] text-white transition group-hover:text-red-100">
                        {item.title}
                      </h2>

                      <p className="mt-4 text-sm leading-6 text-white/42">
                        {item.text}
                      </p>
                    </div>

                    <span className="mt-8 inline-flex text-[10px] font-black uppercase tracking-[0.14em] text-red-400 transition group-hover:text-red-300">
                      {item.action} →
                    </span>
                  </a>
                ))}
              </div>

              {/* NOTICE CON ROJO PERO NO PESADO */}
              <div className="mt-8 rounded-[1.35rem] border border-red-500/20 bg-red-500/[0.045] p-5 backdrop-blur sm:rounded-3xl sm:p-6">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-300">
                  Research Use Only
                </p>

                <p className="mt-3 max-w-4xl text-xs leading-6 text-white/45 sm:text-sm sm:leading-7">
                  Products displayed by RGVPRIME RESEARCH LLC are intended
                  strictly for laboratory and in-vitro research purposes only.
                  They are not for human consumption, veterinary use, diagnostic
                  use, therapeutic use, cosmetic use, food use, dietary
                  supplement use, or clinical application.
                </p>
              </div>

              {/* SIMPLE CONTACT BLOCK */}
              <div className="mt-10 grid gap-6 border-t border-white/10 pt-8 lg:grid-cols-[0.75fr_1fr] lg:items-center">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-red-500">
                    Need help?
                  </p>

                  <h2 className="mt-2 text-2xl font-black uppercase leading-none tracking-[-0.045em] text-white sm:text-3xl">
                    Send us a message.
                  </h2>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
                  <a
                    href={`mailto:${supportEmail}`}
                    className="inline-flex min-h-11 items-center justify-center rounded-full bg-red-600 px-6 text-[10px] font-black uppercase tracking-[0.14em] text-white transition hover:bg-red-500"
                  >
                    Email Support
                  </a>

                  <a
                    href="/track-order"
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-black/35 px-6 text-[10px] font-black uppercase tracking-[0.14em] text-white/55 transition hover:border-red-500/35 hover:bg-red-500/[0.06] hover:text-white"
                  >
                    Track Order
                  </a>
                </div>
              </div>
            </div>
          </section>
        </main>

        <SiteFooter />
        <CartDrawer checkoutPath="/checkout" />
      </div>
    </CartProvider>
  );
}