import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  BadgeCheck,
  FileCheck2,
  FlaskConical,
  LockKeyhole,
  PackageSearch,
  ShieldCheck,
  ShoppingBag,
  Truck,
} from "lucide-react";

const trustBadges = [
  { label: "Research Use Only", icon: FlaskConical },
  { label: "Verified Quality", icon: BadgeCheck },
  { label: "Secure Checkout", icon: ShieldCheck },
];

const mobileBenefits = [
  {
    title: "Verified",
    description: "Quality documentation",
    icon: FileCheck2,
  },
  {
    title: "Secure",
    description: "Protected checkout",
    icon: LockKeyhole,
  },
  {
    title: "Fast",
    description: "Same or next day",
    icon: Truck,
  },
];

const stats = [
  { value: "99%+", label: "Purity Standards" },
  { value: "RUO", label: "Research Use Only" },
  { value: "COA", label: "Quality Documentation" },
];

const easing = [0.16, 1, 0.3, 1];

function reveal(reduceMotion, delay = 0, distance = 16) {
  return {
    initial: reduceMotion
      ? false
      : { opacity: 0, y: distance, filter: "blur(8px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    transition: { delay, duration: 0.72, ease: easing },
  };
}

export default function Hero() {
  const reduceMotion = useReducedMotion();

  return (
    <section className="relative isolate min-h-[100svh] overflow-hidden bg-[#020202] text-white">
      {/* Layered background */}
      <div className="pointer-events-none absolute inset-0 -z-30 bg-[radial-gradient(circle_at_50%_20%,rgba(220,38,38,0.18),transparent_32%),radial-gradient(circle_at_8%_55%,rgba(127,29,29,0.12),transparent_32%),radial-gradient(circle_at_95%_70%,rgba(220,38,38,0.08),transparent_28%),linear-gradient(180deg,#020202_0%,#080303_48%,#020202_100%)]" />

      <div className="pointer-events-none absolute inset-0 -z-20 bg-[linear-gradient(rgba(255,255,255,0.022)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.022)_1px,transparent_1px)] bg-[size:38px_38px] opacity-30 [mask-image:radial-gradient(circle_at_50%_38%,black,transparent_76%)] sm:bg-[size:56px_56px]" />

      <div className="pointer-events-none absolute left-1/2 top-[40%] -z-20 h-[320px] w-[320px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-600/[0.10] blur-[85px] sm:top-[41%] sm:h-[500px] sm:w-[500px] sm:blur-[120px] md:top-[50%] lg:top-[51%] lg:h-[650px] lg:w-[650px]" />

      <div className="pointer-events-none absolute inset-x-0 top-[58%] -z-20 h-px bg-gradient-to-r from-transparent via-red-500/20 to-transparent md:top-[68%] lg:top-[69%]" />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-20 h-[38%] bg-gradient-to-t from-black via-black/75 to-transparent" />

      <motion.img
        src="/logo.webp"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[51%] -z-10 hidden w-[560px] max-w-[58vw] -translate-x-1/2 -translate-y-1/2 grayscale md:block xl:w-[680px]"
        initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
        animate={{ opacity: 0.025, scale: 1 }}
        transition={{ duration: 1.1, ease: easing }}
      />

      {/* Main content */}
      <div className="relative z-10 mx-auto flex min-h-[100svh] w-full max-w-[1440px] items-center justify-center px-4 pb-7 pt-[158px] sm:px-6 sm:pb-10 sm:pt-[166px] md:px-10 md:pb-20 md:pt-[150px]">
        <div className="mx-auto w-full max-w-[1120px] translate-y-3 text-center sm:translate-y-4 md:translate-y-[48px] lg:translate-y-[54px] xl:translate-y-[60px]">
          <motion.h1
            {...reveal(reduceMotion, 0.07, 20)}
            className="mx-auto max-w-[980px] font-black uppercase leading-[0.88] tracking-[-0.062em] text-white [font-family:Inter,ui-sans-serif,system-ui,sans-serif]"
          >
            <span className="block whitespace-nowrap text-[clamp(2.05rem,9.8vw,3.15rem)] md:text-[clamp(3.3rem,5.2vw,5.2rem)]">
              RGVPRIME LLC
            </span>
            <span className="mt-1.5 block whitespace-nowrap bg-gradient-to-b from-white via-white/90 to-white/50 bg-clip-text text-[clamp(1.45rem,7.3vw,2.7rem)] text-transparent md:mt-2 md:text-[clamp(2.9rem,4.7vw,4.65rem)]">
              Research Peptides
            </span>
          </motion.h1>

          <motion.div
            {...reveal(reduceMotion, 0.16, 15)}
            className="mx-auto mt-6 max-w-[720px] md:mt-8"
          >
            <p className="text-[13px] font-medium leading-[1.65] text-white/62 sm:text-[14px] md:hidden">
              Research-use-only peptides with verified quality documentation,
              secure checkout, and a professional ordering experience.
            </p>

            <p className="hidden text-[15px] font-medium leading-7 text-white/60 md:block md:text-base">
              Research-use-only peptides presented through a clean, secure,
              and professional shopping experience. Products are intended
              strictly for in-vitro laboratory research and are not for human
              or animal use.
            </p>
          </motion.div>

          {/* CTAs: full-width primary + two compact secondary actions on mobile */}
          <motion.div
            {...reveal(reduceMotion, 0.25, 14)}
            className="mx-auto mt-6 grid w-full max-w-[410px] grid-cols-2 gap-2 sm:mt-8 sm:gap-2.5 md:mt-9 md:flex md:max-w-none md:items-center md:justify-center md:gap-3"
          >
            <a
              href="/shop"
              className="group relative col-span-2 inline-flex min-h-[52px] items-center justify-center overflow-hidden rounded-[18px] border border-red-400/25 bg-gradient-to-r from-red-700 via-red-600 to-red-700 px-5 text-[9px] font-black uppercase tracking-[0.17em] text-white shadow-[0_18px_44px_rgba(220,38,38,0.25)] transition duration-300 hover:-translate-y-0.5 hover:brightness-110 sm:min-h-[54px] sm:text-[9.5px] md:col-auto md:min-h-12 md:rounded-full md:px-8 md:text-[11px] md:tracking-[0.19em]"
            >
              <span className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/55 to-transparent" />
              <ShoppingBag className="mr-2 h-4 w-4 md:mr-2.5 md:h-[18px] md:w-[18px]" strokeWidth={1.8} />
              Shop Catalog
              <ArrowRight className="ml-2 h-4 w-4 transition duration-300 group-hover:translate-x-1 md:ml-2.5 md:h-[17px] md:w-[17px]" />
            </a>

            <a
              href="/coa"
              className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-white/13 bg-white/[0.045] px-2.5 text-[8.5px] font-black uppercase tracking-[0.11em] text-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-red-400/30 hover:bg-red-500/[0.08] hover:text-white sm:min-h-[50px] sm:text-[9px] md:min-h-12 md:rounded-full md:px-8 md:text-[11px] md:tracking-[0.18em]"
            >
              <FileCheck2 className="mr-1.5 h-[15px] w-[15px] text-red-400 md:mr-2 md:h-[17px] md:w-[17px]" strokeWidth={1.8} />
              View COA
            </a>

            <a
              href="/track-order"
              className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-white/13 bg-white/[0.045] px-2.5 text-[8.5px] font-black uppercase tracking-[0.11em] text-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-red-400/30 hover:bg-red-500/[0.08] hover:text-white sm:min-h-[50px] sm:text-[9px] md:min-h-12 md:rounded-full md:px-8 md:text-[11px] md:tracking-[0.18em]"
            >
              <PackageSearch className="mr-1.5 h-[15px] w-[15px] text-red-400 md:mr-2 md:h-[17px] md:w-[17px]" strokeWidth={1.8} />
              Track Order
            </a>
          </motion.div>

          {/* Mobile benefit cards */}
          <motion.div
            {...reveal(reduceMotion, 0.34, 14)}
            className="mx-auto mt-7 grid w-full max-w-[440px] grid-cols-3 gap-2.5 md:hidden"
          >
            {mobileBenefits.map(({ title, description, icon: Icon }) => (
              <div
                key={title}
                className="group relative flex min-h-[116px] min-w-0 flex-col items-center justify-center overflow-hidden rounded-[20px] border border-white/10 bg-[linear-gradient(145deg,rgba(255,255,255,0.055),rgba(255,255,255,0.018))] px-2.5 py-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.045),0_18px_50px_rgba(0,0,0,0.22)] backdrop-blur-xl"
              >
                <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-red-400/50 to-transparent" />
                <div className="grid h-9 w-9 place-items-center rounded-xl border border-red-500/20 bg-red-500/[0.09] text-red-400 shadow-[0_10px_28px_rgba(127,29,29,0.18)]">
                  <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
                </div>

                <p className="mt-3 truncate text-[9px] font-black uppercase tracking-[0.11em] text-white">
                  {title}
                </p>

                <p className="mt-1 line-clamp-2 text-[8.5px] font-semibold leading-[1.35] text-white/43">
                  {description}
                </p>
              </div>
            ))}
          </motion.div>

          {/* Trust pills */}
          <motion.div
            {...reveal(reduceMotion, 0.42, 12)}
            className="mx-auto mt-6 flex max-w-[580px] flex-wrap items-center justify-center gap-2 sm:mt-8 sm:gap-3"
          >
            {trustBadges.map(({ label, icon: Icon }) => (
              <div
                key={label}
                className="inline-flex min-h-9 items-center rounded-full border border-white/10 bg-black/35 px-3 text-[7.5px] font-black uppercase tracking-[0.105em] text-white/66 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl sm:px-4 sm:text-[9px] sm:tracking-[0.14em]"
              >
                <Icon className="mr-1.5 h-3.5 w-3.5 text-red-500" strokeWidth={2.2} />
                {label}
              </div>
            ))}
          </motion.div>

          {/* Desktop-only research stats */}
          <motion.div
            {...reveal(reduceMotion, 0.48, 14)}
            className="mx-auto mt-10 hidden max-w-[800px] grid-cols-3 gap-3 md:grid"
          >
            {stats.map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-white/10 bg-white/[0.035] px-5 py-4 backdrop-blur-md transition duration-300 hover:-translate-y-0.5 hover:border-red-500/30 hover:bg-red-500/[0.055]"
              >
                <p className="text-2xl font-black tracking-[-0.05em] text-white">
                  {item.value}
                </p>
                <p className="mt-1 text-[9px] font-black uppercase tracking-[0.18em] text-white/45">
                  {item.label}
                </p>
              </div>
            ))}
          </motion.div>

          <motion.p
            {...reveal(reduceMotion, 0.5, 8)}
            className="mx-auto mt-5 max-w-[390px] text-[8px] font-bold uppercase leading-4 tracking-[0.12em] text-white/27 md:hidden"
          >
            For in-vitro laboratory research only · Not for human or animal use
          </motion.p>
        </div>
      </div>
    </section>
  );
}