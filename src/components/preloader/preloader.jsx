// src/components/loading/GlobalPreloader.jsx
import { useEffect, useState } from "react";

export default function GlobalPreloader({
  logoSrc = "/logo.webp",
  brand = "RGVPRIME",
  subtitle = "RESEARCH LLC",
}) {
  const [progress, setProgress] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const minDuration = 1700;
    const start = performance.now();

    document.documentElement.classList.add("rgv-preloader-lock");

    let raf;
    let current = 0;

    const animateProgress = () => {
      current += (92 - current) * 0.055;
      setProgress(Math.min(current, 92));

      if (current < 91.5) {
        raf = requestAnimationFrame(animateProgress);
      }
    };

    raf = requestAnimationFrame(animateProgress);

    const finish = () => {
      const elapsed = performance.now() - start;
      const delay = Math.max(0, minDuration - elapsed);

      window.setTimeout(() => {
        cancelAnimationFrame(raf);
        setProgress(100);

        window.setTimeout(() => {
          setLeaving(true);

          window.setTimeout(() => {
            setHidden(true);
            document.documentElement.classList.remove("rgv-preloader-lock");
          }, 680);
        }, 300);
      }, delay);
    };

    if (document.readyState === "complete") {
      finish();
    } else {
      window.addEventListener("load", finish, { once: true });
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("load", finish);
      document.documentElement.classList.remove("rgv-preloader-lock");
    };
  }, []);

  if (hidden) return null;

  return (
    <>
      <div
        className={`fixed inset-0 z-[999999] flex items-center justify-center overflow-hidden bg-[#030303] transition-all duration-700 ease-[cubic-bezier(.16,1,.3,1)] ${
          leaving
            ? "pointer-events-none opacity-0 scale-[1.015]"
            : "opacity-100"
        }`}
        aria-hidden={leaving}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_44%,rgba(220,38,38,0.20),transparent_42%)]" />

        <div className="relative z-10 flex w-full max-w-[420px] flex-col items-center px-8 text-center">
          <div className="relative mb-8">
            <img
              src={logoSrc}
              alt=""
              className="relative h-24 w-auto object-contain drop-shadow-[0_0_32px_rgba(220,38,38,0.28)] sm:h-28 rgv-logo"
              draggable="false"
            />
          </div>

          <div className="space-y-1">
            <h2 className="text-[0.86rem] font-black uppercase tracking-[0.42em] text-white/90 sm:text-[0.95rem]">
              {brand}
            </h2>

            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.34em] text-red-300/55">
              {subtitle}
            </p>
          </div>

          <div className="mt-9 h-[2px] w-full max-w-[260px] overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-red-600 shadow-[0_0_18px_rgba(220,38,38,0.65)] transition-[width] duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="mt-4 flex items-center gap-2 text-[0.62rem] font-black uppercase tracking-[0.28em] text-white/35">
            <span>Loading</span>
            <span className="rgv-dots">...</span>
          </div>
        </div>

        <div
          className="absolute bottom-0 left-0 h-px bg-red-600 shadow-[0_0_18px_rgba(220,38,38,0.75)] transition-[width] duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <style>{`
        html.rgv-preloader-lock,
        html.rgv-preloader-lock body {
          overflow: hidden;
        }

        .rgv-logo {
          animation: rgvLogoFloat 2.35s ease-in-out infinite;
        }

        .rgv-dots {
          display: inline-block;
          overflow: hidden;
          width: 1.8em;
          animation: rgvDots 1.2s steps(4, end) infinite;
        }

        @keyframes rgvLogoFloat {
          0%, 100% {
            transform: translateY(0) scale(1);
            opacity: 0.92;
          }

          50% {
            transform: translateY(-5px) scale(1.02);
            opacity: 1;
          }
        }

        @keyframes rgvDots {
          from {
            width: 0;
          }

          to {
            width: 1.8em;
          }
        }
      `}</style>
    </>
  );
}