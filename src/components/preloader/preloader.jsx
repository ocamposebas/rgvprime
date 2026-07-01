// src/components/loading/GlobalPreloader.jsx
import { useEffect, useState } from "react";

export default function GlobalPreloader({
  logoSrc = "logo.webp",
  brand = "RGVPRIMER",
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
          }, 720);
        }, 320);
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
        className={`fixed inset-0 z-[999999] flex items-center justify-center overflow-hidden bg-[#030000] transition-all duration-700 ease-[cubic-bezier(.16,1,.3,1)] ${
          leaving ? "pointer-events-none opacity-0 scale-[1.015] blur-sm" : "opacity-100"
        }`}
        aria-hidden={leaving}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(170,0,18,0.28),transparent_38%),radial-gradient(circle_at_50%_100%,rgba(80,0,8,0.22),transparent_42%)]" />

        <div className="absolute inset-0 opacity-[0.08] rgv-grid" />

        <div className="absolute left-1/2 top-1/2 h-[360px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-950/20 blur-3xl rgv-pulse" />

        <div className="relative z-10 flex w-full max-w-[420px] flex-col items-center px-8 text-center">
          <div className="relative mb-8">
            <div className="absolute inset-0 scale-125 bg-red-900/20 blur-3xl" />

            <img
              src={logoSrc}
              alt=""
              className="relative h-24 w-auto object-contain drop-shadow-[0_0_34px_rgba(185,0,24,0.32)] sm:h-28 rgv-logo"
              draggable="false"
            />
          </div>

          <div className="space-y-1">
            <h2 className="text-[0.86rem] font-semibold tracking-[0.42em] text-white/90 sm:text-[0.95rem]">
              {brand}
            </h2>

            <p className="text-[0.62rem] font-medium tracking-[0.34em] text-red-200/55">
              {subtitle}
            </p>
          </div>

          <div className="mt-9 h-px w-full max-w-[260px] overflow-hidden bg-white/10">
            <div
              className="h-full bg-gradient-to-r from-transparent via-red-500 to-transparent transition-[width] duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="mt-4 flex items-center gap-2 text-[0.62rem] font-medium uppercase tracking-[0.28em] text-white/38">
            <span>Loading</span>
            <span className="rgv-dots">...</span>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 h-px bg-red-500/70 transition-[width] duration-300 ease-out" style={{ width: `${progress}%` }} />
      </div>

      <style>{`
        html.rgv-preloader-lock,
        html.rgv-preloader-lock body {
          overflow: hidden;
        }

        .rgv-grid {
          background-image:
            linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px);
          background-size: 52px 52px;
          mask-image: radial-gradient(circle at center, black 0%, transparent 68%);
        }

        .rgv-logo {
          animation: rgvLogoFloat 2.4s ease-in-out infinite;
        }

        .rgv-pulse {
          animation: rgvPulse 2.6s ease-in-out infinite;
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
            transform: translateY(-6px) scale(1.025);
            opacity: 1;
          }
        }

        @keyframes rgvPulse {
          0%, 100% {
            opacity: 0.55;
            transform: translate(-50%, -50%) scale(0.92);
          }

          50% {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1.08);
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