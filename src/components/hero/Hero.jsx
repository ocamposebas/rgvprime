import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import "./Hero.css";

const destinations = [
  { number: "01", title: "Single vials", detail: "Individual research formats", href: "/shop?format=singles" },
  { number: "02", title: "10 vial kits", detail: "Explore the kit collection", href: "/shop?format=kits" },
  { number: "03", title: "Certificate library", detail: "Review the published records", href: "/coa" },
];

export default function Hero() {
  const heroRef = useRef(null);
  const ribbonRef = useRef(null);
  const speedRampStartedRef = useRef(false);
  const speedRampCompletedRef = useRef(false);
  const [motionActive, setMotionActive] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true;
    const updateMotion = () => {
      setMotionActive(visible && !document.hidden && !reducedMotion.matches);
    };
    const observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting;
          updateMotion();
        })
      : null;

    if (heroRef.current) observer?.observe(heroRef.current);
    document.addEventListener("visibilitychange", updateMotion);
    reducedMotion.addEventListener("change", updateMotion);
    updateMotion();

    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", updateMotion);
      reducedMotion.removeEventListener("change", updateMotion);
    };
  }, []);

  useEffect(() => {
    if (!motionActive || speedRampStartedRef.current || speedRampCompletedRef.current) {
      return undefined;
    }

    speedRampStartedRef.current = true;
    let frame = 0;
    let ribbonAnimation = null;
    let cancelled = false;

    const settleDuration = 4400;
    const initialPlaybackRate = 2.75;

    const findRibbonAnimation = () => {
      if (cancelled) return;

      ribbonAnimation = ribbonRef.current
        ?.getAnimations()
        .find((animation) => animation.animationName === "rgv-hero-ribbon-drift");

      if (!ribbonAnimation) {
        frame = window.requestAnimationFrame(findRibbonAnimation);
        return;
      }

      const startedAt = performance.now();

      const easeIntoCruise = (now) => {
        if (cancelled || !ribbonAnimation) return;

        const progress = Math.min(1, (now - startedAt) / settleDuration);
        const remainingSpeed = (1 - progress) ** 2;
        ribbonAnimation.playbackRate = 1 + (initialPlaybackRate - 1) * remainingSpeed;

        if (progress < 1) {
          frame = window.requestAnimationFrame(easeIntoCruise);
        } else {
          ribbonAnimation.playbackRate = 1;
          speedRampCompletedRef.current = true;
          speedRampStartedRef.current = false;
        }
      };

      frame = window.requestAnimationFrame(easeIntoCruise);
    };

    frame = window.requestAnimationFrame(findRibbonAnimation);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (ribbonAnimation) ribbonAnimation.playbackRate = 1;
      speedRampStartedRef.current = false;
    };
  }, [motionActive]);

  return (
    <section
      ref={heroRef}
      className={`rgv-hero${motionActive ? " is-motion-active" : ""}`}
      aria-labelledby="home-hero-title"
    >
      <div className="rgv-hero__backdrop" aria-hidden="true">
        <div className="rgv-hero__ambient" />
        <svg ref={ribbonRef} className="rgv-hero__ribbon" viewBox="0 0 1200 900" width="1200" height="900" fill="none" focusable="false">
          <defs>
            <linearGradient id="rgv-hero-ribbon-surface" x1="690" y1="50" x2="1070" y2="850" gradientUnits="userSpaceOnUse">
              <stop stopColor="#140609" />
              <stop offset=".22" stopColor="#69101b" />
              <stop offset=".38" stopColor="#b5232c" />
              <stop offset=".48" stopColor="#3d090f" />
              <stop offset=".64" stopColor="#8f1522" />
              <stop offset=".84" stopColor="#2a080d" />
              <stop offset="1" stopColor="#090a0c" />
            </linearGradient>
            <linearGradient id="rgv-hero-ribbon-fold" x1="585" y1="400" x2="1030" y2="600" gradientUnits="userSpaceOnUse">
              <stop stopColor="#26070d" />
              <stop offset=".36" stopColor="#a21d29" />
              <stop offset=".63" stopColor="#580c17" />
              <stop offset="1" stopColor="#12070a" />
            </linearGradient>
            <linearGradient id="rgv-hero-ribbon-edge" x1="750" y1="100" x2="915" y2="860" gradientUnits="userSpaceOnUse">
              <stop stopColor="#a72830" stopOpacity="0" />
              <stop offset=".33" stopColor="#eb6256" stopOpacity=".7" />
              <stop offset=".56" stopColor="#a51f2b" stopOpacity=".4" />
              <stop offset=".78" stopColor="#d74741" stopOpacity=".6" />
              <stop offset="1" stopColor="#a72830" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M1085-90C1050 92 1094 164 895 277C713 380 522 391 561 516C608 666 929 649 1082 823L1165 965H1290C1233 731 1063 623 862 568C682 519 741 438 957 355C1171 273 1177 97 1249-90Z" fill="url(#rgv-hero-ribbon-surface)" />
          <path d="M561 516C595 625 923 617 1082 823C966 694 778 705 650 638C548 584 510 460 661 402C583 444 543 467 561 516Z" fill="url(#rgv-hero-ribbon-fold)" />
          <path d="M1085-90C1050 92 1094 164 895 277C713 380 522 391 561 516C608 666 929 649 1082 823" stroke="url(#rgv-hero-ribbon-edge)" strokeWidth="1.4" />
          <path d="M1249-90C1177 97 1171 273 957 355C741 438 682 519 862 568C1063 623 1233 731 1290 965" stroke="url(#rgv-hero-ribbon-edge)" strokeWidth="1" />
          <path d="M1154-90C1100 88 1155 185 939 300C757 396 602 422 644 511C695 615 963 630 1138 836" stroke="#a41d2a" strokeOpacity=".18" />
        </svg>
      </div>
      <div className="rgv-home-shell">
        <div className="rgv-hero__composition">
          <div className="rgv-hero__copy">
            <h1 id="home-hero-title" className="rgv-hero__title">
              <span className="rgv-hero__title-line">Research </span>
              <span className="rgv-hero__title-line rgv-hero__title-accent">
                in detail<span className="rgv-hero__title-punctuation" aria-hidden="true">.</span>
              </span>
            </h1>
            <div className="rgv-hero__introduction">
              <span className="rgv-hero__intro-rule" aria-hidden="true" />
              <p>A considered collection of laboratory research compounds.<br className="rgv-hero__desktop-break" /> Explore the specifications. Review the documentation.</p>
            </div>
            <div className="rgv-hero__actions">
              <a className="rgv-hero-primary" href="/shop">
                Shop the collection <ArrowUpRight size={18} strokeWidth={1.7} aria-hidden="true" />
              </a>
              <a className="rgv-hero-secondary" href="/coa">Explore COAs</a>
            </div>
          </div>
        </div>

        <nav className="rgv-hero__index" aria-label="Explore the research catalog">
          <div className="rgv-hero__index-links">
            {destinations.map(({ number, title, detail, href }) => (
              <a key={number} href={href}>
                <span className="rgv-hero__index-number">{number}</span>
                <span className="rgv-hero__index-copy"><strong>{title}</strong><small>{detail}</small></span>
                <ArrowUpRight size={18} strokeWidth={1.4} aria-hidden="true" />
              </a>
            ))}
          </div>
        </nav>

        <div className="rgv-hero__baseline">
          <p>For in-vitro laboratory research only.<span> Not for human or animal use.</span></p>
          <a href="#featured-products">Inside the collection <ArrowDown size={14} aria-hidden="true" /></a>
        </div>
      </div>
    </section>
  );
}
