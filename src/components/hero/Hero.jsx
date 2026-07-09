import { useEffect, useState } from "react";
import { motion } from "motion/react";

const trustBadges = ["Research Use Only", "Verified Quality", "Secure Checkout"];

const stats = [
  {
    value: "99%+",
    label: "Purity Standards",
  },
  {
    value: "RUO",
    label: "Research Use Only",
  },
  {
    value: "COA",
    label: "Quality Documentation",
  },
];

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");

    const update = () => {
      setIsDesktop(media.matches);
    };

    update();

    if (media.addEventListener) {
      media.addEventListener("change", update);
    } else {
      media.addListener(update);
    }

    return () => {
      if (media.removeEventListener) {
        media.removeEventListener("change", update);
      } else {
        media.removeListener(update);
      }
    };
  }, []);

  return isDesktop;
}

export default function Hero() {
  const isDesktop = useIsDesktop();

  return (
    <section className="relative min-h-[100svh] overflow-hidden bg-[#030303] text-white">
      {/* BACKGROUND */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(220,38,38,0.22),transparent_28%),radial-gradient(circle_at_82%_16%,rgba(127,29,29,0.16),transparent_30%),linear-gradient(180deg,#030303_0%,#080808_48%,#020202_100%)]" />

      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.026)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.026)_1px,transparent_1px)] bg-[size:48px_48px] opacity-20 [mask-image:radial-gradient(circle_at_center,black,transparent_76%)] sm:bg-[size:64px_64px]" />

      <div className="absolute left-1/2 top-[45%] h-[360px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-700/10 blur-[95px] sm:h-[520px] sm:w-[520px] sm:blur-[120px]" />

      <div className="absolute left-1/2 top-[61%] h-px w-[82vw] -translate-x-1/2 bg-gradient-to-r from-transparent via-red-600/35 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 h-[30%] bg-gradient-to-t from-black via-black/75 to-transparent" />

      {isDesktop && (
        <motion.img
          src="/logo.webp"
          alt="RGV Prime background logo"
          className="pointer-events-none absolute left-1/2 top-[45%] z-0 w-[460px] max-w-[55vw] -translate-x-1/2 -translate-y-1/2 grayscale lg:w-[580px] xl:w-[680px]"
          style={{ opacity: 0.018 }}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 0.018, scale: 1 }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        />
      )}

      {/* CONTENT */}
      <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-[1440px] items-center justify-center px-4 pb-10 pt-[160px] text-center sm:px-6 sm:pb-16 sm:pt-[140px] md:px-10 lg:pb-20">
        <div className="mx-auto w-full max-w-6xl">
          {/* EYEBROW */}
          <motion.div
            initial={{ opacity: 0, y: 14, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto mb-4 flex w-fit max-w-full items-center justify-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 backdrop-blur sm:mb-6 sm:gap-3 sm:px-4"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500 shadow-[0_0_18px_rgba(239,68,68,0.9)]" />

            <p className="max-w-[82vw] truncate text-[8px] font-black uppercase leading-5 tracking-[0.18em] text-red-300 sm:text-[10px] sm:tracking-[0.28em] md:text-[11px]">
              RGVPRIME Performance Research
            </p>
          </motion.div>

          {/* TITLE */}
          <motion.h1
            initial={{ opacity: 0, y: 20, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{
              delay: 0.08,
              duration: 0.8,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="mx-auto max-w-4xl text-[2rem] font-black uppercase leading-[0.95] tracking-[-0.045em] text-white sm:text-[3rem] md:text-[3.65rem] lg:text-[4.25rem] [font-family:Inter,ui-sans-serif,system-ui,sans-serif]"
          >
            RGVPRIME LLC
            <br />
            <span className="text-white/74">Research Peptides</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.7 }}
            className="mx-auto mt-5 max-w-[700px] text-[13px] leading-6 text-white/58 sm:mt-7 sm:text-[15px] sm:leading-7 md:text-base"
          >
            Premium research-use-only peptides presented through a clean,
            secure, and professional shopping experience. Products are intended
            strictly for in-vitro laboratory research and are not for human or
            animal use.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.28, duration: 0.7 }}
            className="mx-auto mt-7 grid max-w-[390px] grid-cols-1 gap-3 sm:mt-9 sm:flex sm:max-w-none sm:items-center sm:justify-center"
          >
            <a
              href="/shop"
              className="group inline-flex min-h-12 items-center justify-center rounded-full bg-red-600 px-7 text-[10px] font-black uppercase tracking-[0.18em] text-white shadow-[0_22px_55px_rgba(220,38,38,0.28)] transition duration-300 hover:-translate-y-1 hover:bg-red-500 sm:px-8 sm:text-[11px]"
            >
              Shop Catalog
              <span className="ml-2 transition duration-300 group-hover:translate-x-1">
                →
              </span>
            </a>

            <a
              href="/coa"
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] px-7 text-[10px] font-black uppercase tracking-[0.18em] text-white/82 backdrop-blur transition duration-300 hover:-translate-y-1 hover:border-white/25 hover:bg-white/10 hover:text-white sm:px-8 sm:text-[11px]"
            >
              View COA
            </a>

            <a
              href="https://staging.rgvprimellc.com/track-order"
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-red-500/25 bg-red-500/10 px-7 text-[10px] font-black uppercase tracking-[0.18em] text-red-100 backdrop-blur transition duration-300 hover:-translate-y-1 hover:border-red-500/45 hover:bg-red-600 hover:text-white sm:px-8 sm:text-[11px]"
            >
              Track Order
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.38, duration: 0.7 }}
            className="mx-auto mt-7 flex max-w-[640px] flex-wrap items-center justify-center gap-2 sm:mt-9 sm:gap-3"
          >
            {trustBadges.map((badge) => (
              <div
                key={badge}
                className="rounded-full border border-white/10 bg-white/[0.045] px-3 py-2 text-[8px] font-bold uppercase tracking-[0.11em] text-white/72 backdrop-blur sm:px-4 sm:text-[10px]"
              >
                <span className="mr-1 text-red-400">✓</span>
                {badge}
              </div>
            ))}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.48, duration: 0.7 }}
            className="mx-auto mt-7 grid max-w-[800px] grid-cols-1 gap-2 sm:mt-9 sm:grid-cols-3 sm:gap-3"
          >
            {stats.map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 backdrop-blur-md transition duration-300 hover:border-red-500/30 hover:bg-red-500/[0.055] sm:px-5 sm:py-4"
              >
                <p className="text-xl font-black tracking-[-0.05em] text-white sm:text-2xl">
                  {item.value}
                </p>

                <p className="mt-1 text-[8px] font-black uppercase tracking-[0.16em] text-white/45 sm:text-[9px] sm:tracking-[0.18em]">
                  {item.label}
                </p>
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}