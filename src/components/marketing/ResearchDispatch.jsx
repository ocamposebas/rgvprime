import { ArrowUpRight } from "lucide-react";

const dispatchVials = {
  left: {
    src: "https://wp.rgvprimellc.com/wp-content/uploads/2026/08/58130A3D-CA45-472C-8505-BF1995DFCB70-2-phase-one-labz-normalized-1200-600x600.png?v=2026-09-14T19%3A48%3A00",
    srcSet:
      "https://wp.rgvprimellc.com/wp-content/uploads/2026/08/58130A3D-CA45-472C-8505-BF1995DFCB70-2-phase-one-labz-normalized-1200-300x300.png?v=2026-09-14T19%3A48%3A00 300w, https://wp.rgvprimellc.com/wp-content/uploads/2026/08/58130A3D-CA45-472C-8505-BF1995DFCB70-2-phase-one-labz-normalized-1200-600x600.png?v=2026-09-14T19%3A48%3A00 600w",
  },
  middleRight: {
    src: "https://wp.rgvprimellc.com/wp-content/uploads/2026/08/A5FD6D7D-EA39-48AE-9453-483DB9E19935-2-phase-one-labz-normalized-1200-600x600.png?v=2026-09-14T15%3A58%3A28",
    srcSet:
      "https://wp.rgvprimellc.com/wp-content/uploads/2026/08/A5FD6D7D-EA39-48AE-9453-483DB9E19935-2-phase-one-labz-normalized-1200-300x300.png?v=2026-09-14T15%3A58%3A28 300w, https://wp.rgvprimellc.com/wp-content/uploads/2026/08/A5FD6D7D-EA39-48AE-9453-483DB9E19935-2-phase-one-labz-normalized-1200-600x600.png?v=2026-09-14T15%3A58%3A28 600w",
  },
  right: {
    src: "https://wp.rgvprimellc.com/wp-content/uploads/2026/08/73733CD7-C76D-4940-A4D4-725EF173419E-2-phase-one-labz-normalized-1200-600x600.png?v=2026-09-14T16%3A08%3A37",
    srcSet:
      "https://wp.rgvprimellc.com/wp-content/uploads/2026/08/73733CD7-C76D-4940-A4D4-725EF173419E-2-phase-one-labz-normalized-1200-300x300.png?v=2026-09-14T16%3A08%3A37 300w, https://wp.rgvprimellc.com/wp-content/uploads/2026/08/73733CD7-C76D-4940-A4D4-725EF173419E-2-phase-one-labz-normalized-1200-600x600.png?v=2026-09-14T16%3A08%3A37 600w",
  },
};

export default function ResearchDispatch({ currentPath = "" }) {
  const isCatalog = currentPath === "/shop";

  return (
    <section className="rgv-dispatch" aria-labelledby="rgv-dispatch-title">
      <div className="rgv-dispatch__shell">
        <div className="rgv-dispatch__hero">
          <div className="rgv-dispatch__hero-inner">
            <div className="rgv-dispatch__hero-copy">
            <p className="rgv-dispatch__eyebrow">A simpler research catalog</p>
            <h2 id="rgv-dispatch-title">
              Research products,
              <span>made easier to order.</span>
            </h2>
            <p className="rgv-dispatch__intro">
              Compare strengths, choose a single vial or kit, and find current
              availability without the guesswork.
            </p>
            <a
              className="rgv-dispatch__shop"
              href={isCatalog ? "#research-catalog" : "/shop"}
            >
              {isCatalog ? "Back to catalog" : "See all products"}
              <ArrowUpRight size={18} strokeWidth={2.2} aria-hidden="true" />
            </a>

            </div>

            <div className="rgv-dispatch__product-stage" aria-hidden="true">
            <span className="rgv-dispatch__stage-ring" />
            <span className="rgv-dispatch__stage-shadow" />
            <img
              className="rgv-dispatch__vial rgv-dispatch__vial--back"
              src={dispatchVials.left.src}
              srcSet={dispatchVials.left.srcSet}
              sizes="(max-width: 520px) 230px, (max-width: 900px) 460px, 27vw"
              width="600"
              height="600"
              alt=""
              loading="lazy"
              decoding="async"
            />
            <img
              className="rgv-dispatch__vial rgv-dispatch__vial--middle-right"
              src={dispatchVials.middleRight.src}
              srcSet={dispatchVials.middleRight.srcSet}
              sizes="17vw"
              width="600"
              height="600"
              alt=""
              loading="lazy"
              decoding="async"
            />
            <img
              className="rgv-dispatch__vial rgv-dispatch__vial--front"
              src={dispatchVials.right.src}
              srcSet={dispatchVials.right.srcSet}
              sizes="(max-width: 520px) 280px, (max-width: 900px) 470px, 34vw"
              width="600"
              height="600"
              alt=""
              loading="lazy"
              decoding="async"
            />
            </div>
          </div>
        </div>

        <div className="rgv-dispatch__newsletter">
          <div className="rgv-dispatch__newsletter-copy">
            <div className="rgv-dispatch__newsletter-line">
              <p>Join the RGV Dispatch</p>
              <strong>10% welcome</strong>
            </div>
            <h3>Stay close to what’s new.</h3>
            <p>
              Occasional catalog updates plus your welcome offer. No inbox
              noise.
            </p>
          </div>

          <form
            className="rgv-dispatch__form"
            method="post"
            action="/api/omnisend-welcome"
            data-rgv-newsletter-form
            data-endpoint="/api/omnisend-welcome"
          >
            <input type="hidden" name="source" value="site-prefooter-10" />
            <div className="rgv-dispatch__form-row">
              <label className="sr-only" htmlFor="rgv-dispatch-email">
                Email address
              </label>
              <input
                id="rgv-dispatch-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="Enter your email address"
                maxLength={254}
                aria-describedby="rgv-dispatch-status"
                required
              />
              <button type="submit" data-rgv-newsletter-submit>
                <span data-rgv-newsletter-button-label>Get 10% off</span>
                <ArrowUpRight size={17} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </div>

            <label className="rgv-dispatch__consent">
              <input name="consent" type="checkbox" required />
              <span aria-hidden="true" />
              <small>
                I agree to receive my welcome email and occasional catalog
                updates. Unsubscribe anytime.
              </small>
            </label>

            <div className="rgv-dispatch__honeypot" aria-hidden="true">
              <label htmlFor="rgv-dispatch-company">Company</label>
              <input
                id="rgv-dispatch-company"
                name="company"
                type="text"
                tabIndex={-1}
                autoComplete="off"
              />
            </div>

            <p
              id="rgv-dispatch-status"
              className="rgv-dispatch__status"
              data-rgv-newsletter-status
              role="status"
              aria-live="polite"
              hidden
            />
          </form>
        </div>
      </div>
    </section>
  );
}
