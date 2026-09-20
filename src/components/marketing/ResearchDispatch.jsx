import { ArrowUpRight } from "lucide-react";
import "../../styles/research-dispatch.css";

export default function ResearchDispatch() {
  return (
    <section
      id="rgv-dispatch"
      className="rgv-dispatch"
      aria-labelledby="rgv-dispatch-title"
    >
      <div className="rgv-dispatch__shell">
        <div className="rgv-dispatch__offer">
          <span className="rgv-dispatch__reference">RGV / WELCOME</span>
          <p className="rgv-dispatch__offer-value">
            10<span>%</span>
          </p>
          <p className="rgv-dispatch__offer-caption">Welcome offer</p>
        </div>
        <div className="rgv-dispatch__newsletter">
          <div className="rgv-dispatch__newsletter-copy">
            <p className="rgv-dispatch__eyebrow">Catalog updates</p>
            <h2 id="rgv-dispatch-title">RGV Dispatch.</h2>
            <p>Occasional catalog updates, delivered to your inbox.</p>
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
                <span data-rgv-newsletter-button-label>Get 10% off your first order</span>
                <ArrowUpRight size={17} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </div>

            <label className="rgv-dispatch__consent">
              <input name="consent" type="checkbox" required />
              <span aria-hidden="true" />
              <small>
                I agree to receive my one-time first-order offer and occasional
                catalog updates. Unsubscribe anytime.
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
