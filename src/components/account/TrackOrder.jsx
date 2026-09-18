import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import "../../styles/experience.css";
import "./TrackOrder.css";

function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

function formatMoney(value, currency = "USD") {
  const number = Number(value || 0);

  if (!Number.isFinite(number)) return `$${value}`;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(number);
}

function statusLabel(status = "") {
  const labels = {
    pending: "Pending",
    processing: "Processing",
    "on-hold": "On hold",
    completed: "Completed",
    cancelled: "Cancelled",
    refunded: "Refunded",
    failed: "Failed",
  };

  return labels[status] || status || "Unknown";
}

function firstValue(...values) {
  for (const value of values) {
    if (value === 0) return value;
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return "";
}

function stripHtml(value = "") {
  return String(value)
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function metaValue(metaData, keys) {
  if (!Array.isArray(metaData)) return "";

  const wanted = new Set(keys.map((key) => String(key).toLowerCase()));
  const match = [...metaData]
    .reverse()
    .find((item) => wanted.has(String(item?.key || "").toLowerCase()));

  return match?.value ?? "";
}

function addObjectSources(target, value) {
  if (Array.isArray(value)) {
    value.forEach((item) => addObjectSources(target, item));
    return;
  }

  if (value && typeof value === "object") target.push(value);
}

function sourceValue(sources, keys) {
  for (const source of sources) {
    for (const key of keys) {
      const value = source?.[key];
      if (value === 0) return value;
      if (
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ""
      ) {
        return value;
      }
    }
  }

  return "";
}

function trackingFromNote(noteValue) {
  const raw = typeof noteValue === "object" ? noteValue?.note : noteValue;
  const plain = stripHtml(raw);
  if (!plain) return {};

  const numberMatch = plain.match(
    /tracking(?:\s+(?:number|no\.?))?\s*[:#-]?\s*([A-Z0-9]{8,40})/i,
  );
  const carrierMatch = plain.match(
    /shipped\s+via\s+([a-z0-9 .&-]+?)(?=\s+with\s+tracking|\s+tracking|[,.]|$)/i,
  );
  const hrefMatch = String(raw || "").match(/href=["']([^"']+)["']/i);
  const urlMatch = plain.match(/https?:\/\/[^\s<]+/i);

  return {
    number: numberMatch?.[1] || "",
    carrier: carrierMatch?.[1]?.trim() || "",
    url: hrefMatch?.[1] || urlMatch?.[0] || "",
  };
}

function carrierTrackingUrl(carrier, number) {
  if (!number) return "";

  const name = String(carrier || "").toLowerCase();
  const encoded = encodeURIComponent(String(number).trim());

  if (name.includes("usps") || name.includes("postal service")) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
  }
  if (name.includes("ups") && !name.includes("usps")) {
    return `https://www.ups.com/track?loc=en_US&tracknum=${encoded}`;
  }
  if (name.includes("fedex")) {
    return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
  }
  if (name.includes("dhl")) {
    return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${encoded}`;
  }

  return "";
}

function normalizeTracking(result = {}) {
  const metaData = result?.meta_data || result?.metaData || [];
  const sources = [];

  [
    result?.tracking,
    result?.shipment_tracking,
    result?.shipmentTracking,
    result?.tracking_items,
    result?.trackingItems,
    result?.shipments,
    metaValue(metaData, [
      "_wc_shipment_tracking_items",
      "wc_shipment_tracking_items",
      "_ast_tracking_items",
      "ast_tracking_items",
    ]),
  ].forEach((value) => addObjectSources(sources, value));

  const notes = [
    ...(Array.isArray(result?.notes) ? result.notes : []),
    result?.latest_note,
    result?.customer_note,
  ].filter(Boolean);
  const noteTracking =
    notes
      .map(trackingFromNote)
      .find((item) => item.number || item.url || item.carrier) || {};

  const number = String(
    firstValue(
      sourceValue(sources, [
        "number",
        "tracking_number",
        "trackingNumber",
        "tracking_no",
        "tracking_id",
      ]),
      result?.tracking_number,
      result?.trackingNumber,
      metaValue(metaData, [
        "tracking_number",
        "_tracking_number",
        "_shipment_tracking_number",
        "_wc_shipment_tracking_number",
        "_aftership_tracking_number",
      ]),
      noteTracking.number,
    ),
  ).trim();

  const carrier = String(
    firstValue(
      sourceValue(sources, [
        "carrier",
        "provider",
        "tracking_provider",
        "trackingProvider",
        "custom_tracking_provider",
        "shipping_provider",
      ]),
      result?.carrier,
      result?.shipping_provider,
      metaValue(metaData, [
        "tracking_provider",
        "_tracking_provider",
        "_shipment_tracking_provider",
        "_wc_shipment_tracking_provider",
      ]),
      noteTracking.carrier,
    ),
  ).trim();

  const status = String(
    firstValue(
      sourceValue(sources, [
        "shipment_status",
        "tracking_status",
        "status_description",
        "latest_status",
        "status",
      ]),
      result?.shipment_status,
      result?.tracking_status,
      metaValue(metaData, [
        "shipment_status",
        "_shipment_status",
        "tracking_status",
        "_tracking_status",
      ]),
      number ? "Shipped" : "",
    ),
  ).trim();

  const eta = String(
    firstValue(
      sourceValue(sources, [
        "eta",
        "estimated_delivery",
        "estimatedDelivery",
        "estimated_delivery_date",
        "expected_delivery",
        "expected_delivery_date",
        "expectedDeliveryDate",
        "delivery_date",
      ]),
      result?.estimated_delivery,
      result?.estimatedDelivery,
      result?.expected_delivery_date,
      metaValue(metaData, [
        "estimated_delivery",
        "_estimated_delivery",
        "expected_delivery_date",
        "delivery_date",
      ]),
    ),
  ).trim();

  const live = Boolean(
    sourceValue(sources, ["live", "is_live", "live_tracking"]) ||
      result?.live_tracking,
  );

  const suppliedUrl = String(
    firstValue(
      sourceValue(sources, [
        "url",
        "tracking_url",
        "trackingUrl",
        "tracking_link",
        "custom_tracking_link",
      ]),
      result?.tracking_url,
      metaValue(metaData, [
        "tracking_url",
        "_tracking_url",
        "custom_tracking_link",
      ]),
      noteTracking.url,
    ),
  ).trim();

  return {
    number,
    carrier,
    status,
    eta,
    live,
    url: suppliedUrl || carrierTrackingUrl(carrier, number),
  };
}

function Icon({ name, className = "h-5 w-5" }) {
  const icons = {
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
    truck: (
      <>
        <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
        <path d="M15 18H9" />
        <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a2 2 0 0 0-.45-1.26l-2.1-2.65A2 2 0 0 0 17.88 8H14" />
        <circle cx="7" cy="18" r="2" />
        <circle cx="17" cy="18" r="2" />
      </>
    ),
    check: <path d="M20 6 9 17l-5-5" />,
    arrow: (
      <>
        <path d="M7 17 17 7" />
        <path d="M8 7h9v9" />
      </>
    ),
    alert: (
      <>
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      </>
    ),
    mail: (
      <>
        <rect width="20" height="16" x="2" y="4" rx="2" />
        <path d="m22 7-10 6L2 7" />
      </>
    ),
    hash: (
      <>
        <path d="M4 9h16" />
        <path d="M4 15h16" />
        <path d="M10 3 8 21" />
        <path d="m16 3-2 18" />
      </>
    ),
    lock: (
      <>
        <rect width="18" height="11" x="3" y="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name]}
    </svg>
  );
}

function getTrackingSteps(status = "", tracking = {}) {
  const hasTracking = Boolean(tracking?.number || tracking?.url);
  const stopped = ["cancelled", "refunded", "failed"].includes(status);

  if (stopped) {
    return [
      { label: "Received", state: "done" },
      { label: "Stopped", state: "current" },
      { label: "Shipment", state: "idle" },
    ];
  }

  return [
    { label: "Received", state: "done" },
    {
      label: "Preparing",
      state:
        hasTracking || ["processing", "on-hold", "completed"].includes(status)
          ? "done"
          : "current",
    },
    {
      label: "Shipped",
      state: hasTracking ? "done" : "idle",
    },
  ];
}

function Field({
  icon,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  autoComplete,
  required = false,
}) {
  return (
    <label className="rgv-tracking-field group block">
      <span className="mb-2 block text-[10px] font-semibold normal-case tracking-normal text-[#9698a1] transition group-focus-within:text-[#cf928b]">
        {label}
      </span>

      <div className="relative">
        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9698a1] transition group-focus-within:text-[#cf928b]">
          <Icon name={icon} className="h-4 w-4" />
        </div>

        <input
          type={type}
          value={value}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="rgv-tracking-field__input"
        />
      </div>
    </label>
  );
}

function ErrorMessage({ children }) {
  if (!children) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-[#aa3943]/20 bg-[#8f1d27]/[0.08] px-4 py-3 text-sm font-medium leading-6 text-[#cf928b]"
    >
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </motion.div>
  );
}

function StatusPill({ status }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[#aa3943]/18 bg-[#8f1d27]/[0.08] px-3 py-1.5 text-[10px] font-semibold normal-case tracking-normal text-[#cf928b]">
      <span className="h-1.5 w-1.5 rounded-full bg-red-300 shadow-none" />
      {statusLabel(status)}
    </span>
  );
}

function ProgressRail({ status, tracking }) {
  const steps = useMemo(
    () => getTrackingSteps(status, tracking),
    [status, tracking],
  );

  const activeIndex = steps.reduce((lastActive, step, index) => {
    if (step.state === "done" || step.state === "current") return index;
    return lastActive;
  }, 0);

  const percent =
    steps.length > 1 ? (activeIndex / (steps.length - 1)) * 100 : 0;

  return (
    <div className="mt-8">
      <div className="relative">
        <div className="absolute left-0 right-0 top-4 h-px bg-white/[0.09]" />

        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
          className="absolute left-0 top-4 h-px bg-gradient-to-r from-red-600 via-red-300 to-red-100"
        />

        <div
          className="relative grid gap-3"
          style={{
            gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
          }}
        >
          {steps.map((step, index) => {
            const active = step.state === "done" || step.state === "current";

            return (
              <div key={step.label}>
                <div
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded-full border text-[10px] font-semibold transition",
                    step.state === "done" &&
                      "border-[#aa3943] bg-[#8f1d27] text-white shadow-none",
                    step.state === "current" &&
                      "border-[#aa3943]/50 bg-[#8f1d27]/[0.10] text-[#cf928b]",
                    step.state === "idle" &&
                      "border-white/[0.10] bg-white/[0.025] text-[#9698a1]",
                  )}
                >
                  {step.state === "done" ? (
                    <Icon name="check" className="h-4 w-4" />
                  ) : (
                    index + 1
                  )}
                </div>

                <p
                  className={cn(
                    "mt-3 text-[10px] font-semibold normal-case tracking-normal",
                    active ? "text-white/72" : "text-[#9698a1]",
                  )}
                >
                  {step.label}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EmptyTracking() {
  return (
    <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rgv-tracking-empty">
      <div className="rgv-tracking-empty__icon"><Icon name="truck" /></div>
      <p className="rgv-experience-kicker">ORDER STATUS</p>
      <h2>Your order, at a glance.</h2>
      <p>Enter your details to view the current status and available carrier tracking information.</p>
      <div className="rgv-tracking-empty__steps" aria-hidden="true">
        {["Order received", "Preparing", "Shipped"].map((label, index) => (
          <div key={label}><span>0{index + 1}</span><p>{label}</p></div>
        ))}
      </div>
      <span className="rgv-tracking-empty__waiting">Awaiting your order details</span>
    </motion.div>
  );
}

function TrackingResult({ result }) {
  const tracking = useMemo(() => normalizeTracking(result), [result]);

  return (
    <motion.div
      key="result"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -14 }}
      transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
      className="rgv-tracking-result relative"
    >
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-semibold normal-case tracking-normal text-[#cf928b]/70">
            Order Verified
          </p>

          <h2 className="mt-3 text-5xl font-semibold tracking-normal text-white sm:text-6xl">
            #{result.number}
          </h2>

          <p className="mt-3 text-sm font-medium text-[#9698a1]">
            {result.date || "Date pending"}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 sm:justify-end">
          <StatusPill status={result.status} />

          <span className="rounded-full border border-white/[0.08] bg-white/[0.025] px-3 py-1.5 text-[10px] font-semibold normal-case tracking-normal text-white/55">
            {formatMoney(result.total, result.currency)}
          </span>
        </div>
      </div>

      <ProgressRail status={result.status} tracking={tracking} />

      <div className="mt-10 grid gap-6 border-t border-white/[0.07] pt-6 sm:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold normal-case tracking-normal text-[#9698a1]">
            Carrier
          </p>

          <p className="mt-2 text-sm font-medium leading-6 text-white/72">
            {tracking.carrier || "Carrier pending"}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-semibold normal-case tracking-normal text-[#9698a1]">
            Tracking Number
          </p>

          {tracking.number && tracking.url ? (
            <a
              href={tracking.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block break-words text-sm font-medium leading-6 text-[#cf928b] underline decoration-red-300/30 underline-offset-4 transition hover:text-white"
            >
              {tracking.number}
            </a>
          ) : (
            <p className="mt-2 break-words text-sm font-medium leading-6 text-white/72">
              {tracking.number || "Tracking not assigned yet"}
            </p>
          )}
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-semibold normal-case tracking-normal text-[#9698a1]">
            Shipment Status
          </p>

          <p className="mt-2 text-sm font-medium leading-6 text-white/72">
            {tracking.status || "Pending"}
          </p>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-semibold normal-case tracking-normal text-[#9698a1]">
              Estimated Delivery
            </p>

            {tracking.live && tracking.eta && (
              <span className="rounded-full border border-[#aa3943]/20 bg-[#8f1d27]/[0.08] px-2 py-0.5 text-[8px] font-semibold normal-case tracking-normal text-[#cf928b]/80">
                Live USPS
              </span>
            )}
          </div>

          <p className="mt-2 text-sm font-medium leading-6 text-white/72">
            {tracking.eta || "Pending"}
          </p>
        </div>
      </div>

      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {tracking.url ? (
          <a
            href={tracking.url}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-5 text-[10px] font-semibold normal-case tracking-normal text-white/62 transition hover:bg-[#8f1d27] hover:text-white"
          >
            {String(tracking.carrier).toLowerCase().includes("usps")
              ? "Check live status on USPS"
              : "Check live carrier status"}
            <Icon
              name="arrow"
              className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          </a>
        ) : (
          <p className="text-xs font-medium leading-6 text-[#9698a1]">
            {tracking.number
              ? "The carrier page will be available once its tracking link is recognized."
              : "Carrier tracking will appear once the shipment is assigned."}
          </p>
        )}

        {result.items?.length > 0 && (
          <span className="text-[10px] font-semibold normal-case tracking-normal text-[#9698a1]">
            {result.items.length} item{result.items.length === 1 ? "" : "s"} in
            order
          </span>
        )}
      </div>

      {result.items?.length > 0 && (
        <div className="mt-7 border-t border-white/[0.07] pt-5">
          <div className="grid gap-3">
            {result.items.map((item, index) => (
              <div
                key={`${item.name}-${index}`}
                className="flex items-center justify-between gap-4 border-b border-white/[0.06] pb-3 text-sm last:border-b-0 last:pb-0"
              >
                <span className="min-w-0 truncate font-medium text-white/60">
                  {item.name}
                </span>

                <span className="shrink-0 text-xs font-semibold normal-case tracking-normal text-[#9698a1]">
                  Qty {item.quantity}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default function TrackOrder() {
  const [email, setEmail] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderParam = params.get("order") || "";
    const emailParam = params.get("email") || "";

    if (orderParam) setOrderNumber(orderParam);
    if (emailParam) setEmail(emailParam);
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/orders/track", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
          order_number: orderNumber.trim().replace(/^#/, ""),
        }),
      });

      const text = await response.text();
      let data = {};

      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error("The tracking service returned an invalid response.");
      }

      if (!response.ok || data.success === false) {
        throw new Error(
          data.message || "We could not find an order with those details.",
        );
      }

      const order = data.order || data.data?.order || data.data;

      if (!order || (!order.id && !order.number)) {
        throw new Error(
          "The tracking service returned incomplete order details.",
        );
      }

      setResult(order);
    } catch (err) {
      setError(err.message || "Unable to track this order right now.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="rgv-experience rgv-tracking">
      <div className="rgv-experience-shell">
        <header className="rgv-experience-heading">
          <p className="rgv-experience-kicker">RGVPRIME / ORDER TRACKING</p>
          <h1 className="rgv-experience-title">Track your order<span>.</span></h1>
          <p className="rgv-experience-description">
            From confirmation to shipment. Enter your billing email and order number to see the latest available updates.
          </p>
        </header>

        <div className="rgv-tracking-panel">
          <section className="rgv-tracking-lookup" aria-labelledby="rgv-tracking-lookup-title">
            <div className="rgv-tracking-lookup__heading">
              <h2 id="rgv-tracking-lookup-title">Find your order</h2>
              <Icon name="search" />
            </div>
            <p>Use the details from your confirmation email.</p>
            <form onSubmit={handleSubmit} className="rgv-tracking-form" aria-busy={loading}>
              <Field icon="mail" label="Billing email" type="email" value={email} onChange={setEmail} placeholder="you@email.com" autoComplete="email" required />
              <Field icon="hash" label="Confirmation number" value={orderNumber} onChange={setOrderNumber} placeholder="Example: 1042" autoComplete="off" required />
              <AnimatePresence mode="wait">{error && <ErrorMessage key="error">{error}</ErrorMessage>}</AnimatePresence>
              <button type="submit" disabled={loading} className="rgv-experience-button">
                {loading ? "Checking your order…" : "Track order"}
                {!loading && <Icon name="arrow" />}
              </button>
            </form>
            <div className="rgv-tracking-privacy">
              <Icon name="lock" />
              <p>Your billing email must match the order number to view its details.</p>
            </div>
            <a href="/contact" className="rgv-experience-link">Need help finding your order? <Icon name="arrow" /></a>
          </section>
          <section className="rgv-tracking-details" aria-live="polite" aria-busy={loading} aria-label="Order details">
            <AnimatePresence mode="wait">{result ? <TrackingResult result={result} /> : <EmptyTracking />}</AnimatePresence>
          </section>
        </div>
        <p className="rgv-experience-notice">Carrier tracking becomes available after shipment. You can also review your order history in <a href="/account">your account</a>.</p>
      </div>
    </main>
  );
}
