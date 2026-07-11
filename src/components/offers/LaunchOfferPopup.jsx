import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  Check,
  Copy,
  ShieldCheck,
  X,
} from "lucide-react";

const OFFER_CODE = "RGVPRIME10";
const STORAGE_KEY = "rgvprime_launch_offer_closed_at";

const ONE_DAY = 24 * 60 * 60 * 1000;
const SHOW_DELAY = 1800;

// Cambia esta ruta si tu catálogo está en otra página.
const STORE_URL = "/shop";

export default function LaunchOfferPopup() {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const lastClosed = Number(
        window.localStorage.getItem(STORAGE_KEY) || 0
      );

      const shouldShow =
        !lastClosed || Date.now() - lastClosed >= ONE_DAY;

      if (!shouldShow) return;

      const timer = window.setTimeout(() => {
        setIsOpen(true);
      }, SHOW_DELAY);

      return () => window.clearTimeout(timer);
    } catch {
      const timer = window.setTimeout(() => {
        setIsOpen(true);
      }, SHOW_DELAY);

      return () => window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const rememberClose = () => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        Date.now().toString()
      );
    } catch {
      // El popup seguirá funcionando aunque localStorage esté bloqueado.
    }
  };

  const closePopup = () => {
    rememberClose();
    setIsOpen(false);
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(OFFER_CODE);
    } catch {
      const textarea = document.createElement("textarea");

      textarea.value = OFFER_CODE;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";

      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }

    setCopied(true);

    window.setTimeout(() => {
      setCopied(false);
    }, 2200);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[9000] flex items-center justify-center overflow-y-auto bg-black/80 px-4 py-6 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closePopup();
            }
          }}
        >
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby="launch-offer-title"
            className="relative w-full max-w-[840px] overflow-hidden rounded-[28px] border border-white/10 bg-[#080808] shadow-[0_35px_120px_rgba(0,0,0,0.8)]"
            initial={{
              opacity: 0,
              y: 30,
              scale: 0.97,
            }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
            }}
            exit={{
              opacity: 0,
              y: 20,
              scale: 0.98,
            }}
            transition={{
              duration: 0.42,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
            >
              <div className="absolute -left-36 -top-40 h-[420px] w-[420px] rounded-full bg-red-700/20 blur-[110px]" />

              <div className="absolute -bottom-48 right-[-100px] h-[400px] w-[400px] rounded-full bg-red-950/25 blur-[120px]" />

              <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.04),transparent_35%,transparent_70%,rgba(110,0,0,0.08))]" />

              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-600/70 to-transparent" />
            </div>

            <button
              type="button"
              aria-label="Close offer"
              onClick={closePopup}
              className="absolute right-4 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white/65 backdrop-blur-md transition hover:border-white/20 hover:bg-white/10 hover:text-white"
            >
              <X size={19} strokeWidth={1.8} />
            </button>

            <div className="relative z-10 grid md:grid-cols-[0.88fr_1.12fr]">
              <div className="relative flex min-h-[280px] flex-col justify-between overflow-hidden border-b border-white/10 p-7 sm:p-9 md:min-h-[510px] md:border-b-0 md:border-r">
                <div>
                  <img
                    src="/logo.webp"
                    alt="RGVPRIME LLC"
                    className="h-auto w-[150px] object-contain"
                  />

                  <div className="mt-10 inline-flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-red-300">
                    Official opening offer
                  </div>
                </div>

                <div className="mt-12 md:mt-0">
                  <p className="text-[72px] font-semibold leading-[0.82] tracking-[-0.07em] text-white sm:text-[88px]">
                    10%
                  </p>

                  <p className="mt-3 text-xl font-medium tracking-[-0.02em] text-white">
                    OFF YOUR ORDER
                  </p>

                  <p className="mt-3 max-w-[270px] text-sm leading-6 text-white/50">
                    A special offer to celebrate the official opening of
                    RGVPRIME LLC.
                  </p>
                </div>
              </div>

              <div className="flex flex-col justify-center p-7 sm:p-10 md:p-12">
                <p className="text-[11px] font-medium uppercase tracking-[0.27em] text-red-400">
                  The store is now live
                </p>

                <h2
                  id="launch-offer-title"
                  className="mt-4 max-w-[430px] text-[32px] font-medium leading-[1.08] tracking-[-0.045em] text-white sm:text-[40px]"
                >
                  Welcome to the new RGVPRIME experience.
                </h2>

                <p className="mt-5 max-w-[470px] text-[15px] leading-7 text-white/55">
                  Explore our 24/7 online store, access available COAs,
                  pay securely and track your order whenever needed.
                </p>

                <div className="mt-8">
                  <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.23em] text-white/40">
                    Use code at checkout
                  </p>

                  <button
                    type="button"
                    onClick={copyCode}
                    className="group flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.045] px-5 py-4 text-left transition hover:border-red-500/30 hover:bg-white/[0.07]"
                  >
                    <span className="font-mono text-lg font-semibold tracking-[0.13em] text-white sm:text-xl">
                      {OFFER_CODE}
                    </span>

                    <span className="flex items-center gap-2 text-xs font-medium text-white/50 transition group-hover:text-white">
                      {copied ? (
                        <>
                          <Check
                            size={17}
                            className="text-emerald-400"
                          />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy size={16} />
                          Copy
                        </>
                      )}
                    </span>
                  </button>
                </div>

                <a
                  href={STORE_URL}
                  onClick={rememberClose}
                  className="group mt-5 flex w-full items-center justify-center gap-3 rounded-2xl bg-red-700 px-6 py-4 text-sm font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-red-600"
                >
                  Shop now

                  <ArrowRight
                    size={18}
                    className="transition-transform duration-300 group-hover:translate-x-1"
                  />
                </a>

                <div className="mt-5 flex items-center justify-center gap-2 text-[11px] text-white/35">
                  <ShieldCheck size={15} />
                  Secure checkout and 24/7 order tracking
                </div>
              </div>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}