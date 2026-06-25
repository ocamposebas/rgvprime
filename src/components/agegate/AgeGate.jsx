import { useEffect, useState } from "react";

const STORAGE_KEY = "rgv_age_gate_verified_v1";

function ShieldIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l7 3v6c0 5-3.5 8.5-7 9-3.5-.5-7-4-7-9V6l7-3z" />
      <path d="M9.5 12.5l1.8 1.8 3.2-3.8" />
    </svg>
  );
}

export default function AgeGate() {
  const [isOpen, setIsOpen] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [researchConfirmed, setResearchConfirmed] = useState(false);

  useEffect(() => {
    const verified = window.localStorage.getItem(STORAGE_KEY);

    if (verified === "true") return;

    setIsOpen(true);
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
  }, [isOpen]);

  function handleConfirm() {
    if (!ageConfirmed || !researchConfirmed) return;

    window.localStorage.setItem(STORAGE_KEY, "true");
    setIsOpen(false);
  }

  function handleExit() {
    window.location.href = "https://www.google.com";
  }

  if (!isOpen) return null;

  const canEnter = ageConfirmed && researchConfirmed;

  return (
    <div className="fixed inset-0 z-[9999] flex min-h-[100svh] items-center justify-center overflow-hidden bg-black/82 px-3 py-3 text-white backdrop-blur-md">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(220,38,38,0.16),transparent_36%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:42px_42px] opacity-20" />

      <div className="relative w-full max-w-[460px] overflow-hidden rounded-[1.55rem] border border-white/10 bg-[#080808] shadow-[0_28px_100px_rgba(0,0,0,0.7)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(220,38,38,0.13),transparent_42%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-500/50 to-transparent" />

        <div className="relative px-4 py-5 sm:px-6 sm:py-6">
          <div className="text-center">
            <img
              src="/logo.webp"
              alt="RGV Prime"
              className="mx-auto mb-3 h-12 w-auto object-contain sm:h-14"
            />

            <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.15em] text-red-200">
              <ShieldIcon />
              Restricted Access
            </div>

            <h2 className="mt-4 text-[1.65rem] font-black uppercase leading-[0.92] tracking-[-0.055em] text-white sm:text-[2rem]">
              Age & Research
              <span className="block text-white/70">Verification</span>
            </h2>

            <p className="mx-auto mt-3 max-w-[360px] text-xs leading-5 text-white/52 sm:text-sm sm:leading-6">
              You must be <strong className="text-white">21+</strong> and
              understand that this site is intended for lawful research-use-only
              access.
            </p>
          </div>

          <div className="mt-4 rounded-[1.15rem] border border-white/10 bg-white/[0.035] p-3">
            <p className="text-center text-[10px] font-black uppercase tracking-[0.15em] text-red-300">
              Please Confirm
            </p>

            <div className="mt-3 space-y-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/30 p-3 transition hover:border-red-500/30">
                <input
                  type="checkbox"
                  checked={ageConfirmed}
                  onChange={(event) => setAgeConfirmed(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-transparent text-red-600 focus:ring-red-500"
                />

                <span className="text-xs leading-5 text-white/70 sm:text-sm">
                  I confirm that I am{" "}
                  <strong className="text-white">21 years of age or older</strong>.
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/30 p-3 transition hover:border-red-500/30">
                <input
                  type="checkbox"
                  checked={researchConfirmed}
                  onChange={(event) =>
                    setResearchConfirmed(event.target.checked)
                  }
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-transparent text-red-600 focus:ring-red-500"
                />

                <span className="text-xs leading-5 text-white/70 sm:text-sm">
                  I understand this site is for{" "}
                  <strong className="text-white">research-use-only information</strong>.
                </span>
              </label>
            </div>
          </div>

          <div className="mt-4 grid gap-2">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canEnter}
              className={`inline-flex h-11 items-center justify-center rounded-xl px-5 text-[10px] font-black uppercase tracking-[0.14em] transition sm:h-12 ${
                canEnter
                  ? "bg-red-600 text-white hover:bg-red-500 active:scale-[0.99]"
                  : "cursor-not-allowed bg-white/10 text-white/35"
              }`}
            >
              I Confirm — Enter Site
            </button>

            <button
              type="button"
              onClick={handleExit}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-transparent px-5 text-[10px] font-black uppercase tracking-[0.14em] text-white/50 transition hover:border-red-500/25 hover:bg-white/[0.035] hover:text-white"
            >
              I am under 21 — Exit
            </button>
          </div>

          <p className="mt-3 text-center text-[9px] leading-4 text-white/25 sm:text-[10px]">
            By entering, you agree to the site terms and restricted access
            requirements.
          </p>
        </div>
      </div>
    </div>
  );
}