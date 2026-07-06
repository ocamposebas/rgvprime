import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

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
  const completed = status === "completed";
  const stopped = ["cancelled", "refunded", "failed"].includes(status);

  if (stopped) {
    return [
      { label: "Received", state: "done" },
      { label: "Stopped", state: "current" },
      { label: "Shipment", state: "idle" },
      { label: "Completed", state: "idle" },
    ];
  }

  return [
    { label: "Received", state: "done" },
    {
      label: "Preparing",
      state: ["processing", "on-hold", "completed"].includes(status)
        ? "done"
        : "current",
    },
    {
      label: "Tracking",
      state:
        hasTracking || completed
          ? "done"
          : ["processing", "on-hold"].includes(status)
            ? "current"
            : "idle",
    },
    {
      label: "Completed",
      state: completed ? "done" : "idle",
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
    <label className="group block">
      <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.2em] text-white/36 transition group-focus-within:text-red-200">
        {label}
      </span>

      <div className="relative">
        <div className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-white/26 transition group-focus-within:text-red-200">
          <Icon name={icon} className="h-4 w-4" />
        </div>

        <input
          type={type}
          value={value}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="h-[52px] w-full border-0 border-b border-white/[0.11] bg-transparent pl-7 pr-2 text-sm font-bold text-white outline-none transition placeholder:text-white/22 focus:border-red-300/70"
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
      className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/[0.08] px-4 py-3 text-sm font-bold leading-6 text-red-100"
    >
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </motion.div>
  );
}

function StatusPill({ status }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-red-400/18 bg-red-500/[0.08] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-red-100">
      <span className="h-1.5 w-1.5 rounded-full bg-red-300 shadow-[0_0_14px_rgba(252,165,165,0.9)]" />
      {statusLabel(status)}
    </span>
  );
}

function ProgressRail({ status, tracking }) {
  const steps = useMemo(
    () => getTrackingSteps(status, tracking),
    [status, tracking]
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

        <div className="relative grid grid-cols-4 gap-3">
          {steps.map((step, index) => {
            const active = step.state === "done" || step.state === "current";

            return (
              <div key={step.label}>
                <div
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded-full border text-[10px] font-black transition",
                    step.state === "done" &&
                      "border-red-300 bg-red-600 text-white shadow-[0_0_24px_rgba(220,38,38,0.28)]",
                    step.state === "current" &&
                      "border-red-200/50 bg-red-500/[0.10] text-red-100",
                    step.state === "idle" &&
                      "border-white/[0.10] bg-white/[0.025] text-white/22"
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
                    "mt-3 text-[10px] font-black uppercase tracking-[0.13em]",
                    active ? "text-white/72" : "text-white/24"
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
    <motion.div
      key="empty"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.28 }}
      className="relative min-h-[420px]"
    >
      <div className="flex h-full flex-col justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-red-200/68">
            Tracking Console
          </p>

          <h2 className="mt-3 max-w-xl text-4xl font-black leading-[0.95] tracking-[-0.075em] text-white sm:text-5xl">
            Your order details will appear here.
          </h2>

          <p className="mt-4 max-w-lg text-sm font-medium leading-7 text-white/36">
            Enter your checkout email and confirmation number to reveal the
            current order status, shipment movement, and carrier information.
          </p>
        </div>

        <div className="mt-10">
          <div className="mb-6 flex items-center justify-between gap-4 border-b border-white/[0.07] pb-5">
            <div>
              <div className="h-3 w-28 rounded-full bg-white/[0.08]" />
              <div className="mt-3 h-8 w-44 rounded-full bg-white/[0.045]" />
            </div>

            <div className="h-8 w-28 rounded-full bg-red-500/[0.055]" />
          </div>

          <div className="relative">
            <div className="absolute left-0 right-0 top-4 h-px bg-white/[0.08]" />

            <div className="relative grid grid-cols-4 gap-3">
              {["Received", "Preparing", "Tracking", "Completed"].map(
                (label, index) => (
                  <div key={label}>
                    <div
                      className={cn(
                        "grid h-8 w-8 place-items-center rounded-full border text-[10px] font-black",
                        index === 0
                          ? "border-red-300/40 bg-red-500/[0.08] text-red-100"
                          : "border-white/[0.10] bg-white/[0.02] text-white/22"
                      )}
                    >
                      {index + 1}
                    </div>

                    <p
                      className={cn(
                        "mt-3 text-[10px] font-black uppercase tracking-[0.13em]",
                        index === 0 ? "text-white/58" : "text-white/24"
                      )}
                    >
                      {label}
                    </p>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function TrackingResult({ result }) {
  const tracking = result?.tracking || {};

  return (
    <motion.div
      key="result"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -14 }}
      transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
      className="relative"
    >
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-red-200/70">
            Order Verified
          </p>

          <h2 className="mt-3 text-5xl font-black tracking-[-0.085em] text-white sm:text-6xl">
            #{result.number}
          </h2>

          <p className="mt-3 text-sm font-medium text-white/36">
            {result.date || "Date pending"}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 sm:justify-end">
          <StatusPill status={result.status} />

          <span className="rounded-full border border-white/[0.08] bg-white/[0.025] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white/55">
            {formatMoney(result.total, result.currency)}
          </span>
        </div>
      </div>

      <ProgressRail status={result.status} tracking={tracking} />

      <div className="mt-10 grid gap-6 border-t border-white/[0.07] pt-6 sm:grid-cols-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.17em] text-white/28">
            Carrier
          </p>

          <p className="mt-2 text-sm font-bold leading-6 text-white/72">
            {tracking.carrier || "Carrier pending"}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.17em] text-white/28">
            Tracking Number
          </p>

          <p className="mt-2 break-words text-sm font-bold leading-6 text-white/72">
            {tracking.number || "Tracking not assigned yet"}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.17em] text-white/28">
            Estimated Delivery
          </p>

          <p className="mt-2 text-sm font-bold leading-6 text-white/72">
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
            className="group inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-5 text-[10px] font-black uppercase tracking-[0.16em] text-white/62 transition hover:bg-red-600 hover:text-white"
          >
            Open carrier page
            <Icon
              name="arrow"
              className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          </a>
        ) : (
          <p className="text-xs font-bold leading-6 text-white/32">
            Carrier tracking will appear once the shipment is assigned.
          </p>
        )}

        {result.items?.length > 0 && (
          <span className="text-[10px] font-black uppercase tracking-[0.17em] text-white/28">
            {result.items.length} item{result.items.length === 1 ? "" : "s"} in order
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
                <span className="min-w-0 truncate font-bold text-white/60">
                  {item.name}
                </span>

                <span className="shrink-0 text-xs font-black uppercase tracking-[0.14em] text-white/32">
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

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "We could not find an order with those details."
        );
      }

      setResult(data.order);
    } catch (err) {
      setError(err.message || "Unable to track this order right now.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#030000] px-4 pb-20 pt-[8.5rem] text-white sm:px-6 sm:pt-40 lg:px-8 lg:pt-44">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(220,38,38,0.18),transparent_32%),radial-gradient(circle_at_84%_16%,rgba(127,29,29,0.13),transparent_30%),linear-gradient(180deg,#060000_0%,#030000_48%,#080101_100%)]" />
      <div className="pointer-events-none absolute left-1/2 top-20 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-red-600/[0.08] blur-[130px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-200/40 to-transparent" />

      <div className="relative mx-auto w-full max-w-[1160px]">
        <section className="mb-10 grid gap-8 lg:grid-cols-[0.9fr_0.7fr] lg:items-end">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-red-300/12 bg-red-500/[0.07] px-3 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-red-100">
              <span className="h-1.5 w-1.5 rounded-full bg-red-300 shadow-[0_0_14px_rgba(252,165,165,0.8)]" />
              RGVPRIME ORDER TRACKING
            </div>

            <h1 className="max-w-4xl text-5xl font-black leading-[0.92] tracking-[-0.085em] text-white sm:text-6xl lg:text-7xl">
              Track your order
              <span className="block bg-gradient-to-r from-white via-white/70 to-red-200 bg-clip-text text-transparent">
                with confidence.
              </span>
            </h1>

            <p className="mt-5 max-w-2xl text-sm font-medium leading-7 text-white/40 sm:text-base">
              Enter your billing email and confirmation number to view your
              latest order status, shipment movement, and carrier details.
            </p>
          </div>

          <div className="hidden justify-end lg:flex">
            <div className="relative h-56 w-56">
              <div className="absolute inset-0 rounded-full border border-white/[0.07]" />
              <div className="absolute inset-8 rounded-full border border-red-300/[0.08]" />
              <div className="absolute inset-16 rounded-full border border-white/[0.07]" />

              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
                className="absolute inset-4 rounded-full border border-transparent border-t-red-300/35"
              />

              <motion.div
                animate={{ y: [-5, 5, -5] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="absolute left-1/2 top-1/2 grid h-24 w-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[1.7rem] border border-red-300/16 bg-red-500/[0.055] text-red-100 shadow-[0_22px_70px_rgba(220,38,38,0.16)] backdrop-blur-xl"
              >
                <Icon name="truck" className="h-9 w-9" />
              </motion.div>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden rounded-[2rem] border border-white/[0.07] bg-white/[0.025] shadow-[0_28px_100px_rgba(0,0,0,0.38)] backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_90%_0%,rgba(220,38,38,0.12),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.035),transparent_30%)]" />
          <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-red-200/42 to-transparent" />

          <div className="relative grid lg:grid-cols-[390px_minmax(0,1fr)]">
            <aside className="border-b border-white/[0.08] p-5 sm:p-7 lg:border-b-0 lg:border-r lg:border-white/[0.08]">
              <div className="mb-7 flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-red-200/68">
                    Order Lookup
                  </p>

                  <h2 className="mt-2 text-2xl font-black tracking-[-0.06em] text-white">
                    Verify details
                  </h2>
                </div>

                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-red-300/12 bg-red-500/[0.07] text-red-100">
                  <Icon name="search" className="h-5 w-5" />
                </div>
              </div>

              <form onSubmit={handleSubmit} className="grid gap-5">
                <Field
                  icon="mail"
                  label="Billing email"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="you@email.com"
                  autoComplete="email"
                  required
                />

                <Field
                  icon="hash"
                  label="Confirmation number"
                  value={orderNumber}
                  onChange={setOrderNumber}
                  placeholder="Example: 1042"
                  autoComplete="off"
                  required
                />

                <AnimatePresence mode="wait">
                  {error && <ErrorMessage key="error">{error}</ErrorMessage>}
                </AnimatePresence>

                <button
                  type="submit"
                  disabled={loading}
                  className="group relative mt-1 flex min-h-[54px] w-full items-center justify-center overflow-hidden rounded-full bg-red-600 px-5 text-xs font-black uppercase tracking-[0.18em] text-white shadow-[0_16px_46px_rgba(220,38,38,0.22)] transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="pointer-events-none absolute inset-0 -translate-x-full bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.24),transparent)] transition duration-700 group-hover:translate-x-full" />

                  <span className="relative flex items-center gap-2">
                    {loading ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/25 border-t-white" />
                        Checking
                      </>
                    ) : (
                      <>
                        Track Order
                        <Icon
                          name="arrow"
                          className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                        />
                      </>
                    )}
                  </span>
                </button>
              </form>

              <div className="mt-7 flex items-start gap-3 border-t border-white/[0.07] pt-5">
                <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-red-300/12 bg-red-500/[0.06] text-red-100">
                  <Icon name="lock" className="h-4 w-4" />
                </div>

                <p className="text-xs font-bold leading-6 text-white/34">
                  For privacy, details only appear when the billing email matches
                  the confirmation number.
                </p>
              </div>
            </aside>

            <section className="min-h-[500px] p-5 sm:p-8">
              <AnimatePresence mode="wait">
                {result ? (
                  <TrackingResult result={result} />
                ) : (
                  <EmptyTracking />
                )}
              </AnimatePresence>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
} 