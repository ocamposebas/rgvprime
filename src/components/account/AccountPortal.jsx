import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

function formatMoney(value, currency = "USD") {
  const number = Number(value || 0);

  if (!Number.isFinite(number)) {
    return `$${value}`;
  }

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

function initialsFromUser(user) {
  const first = user?.first_name?.trim()?.[0] || "";
  const last = user?.last_name?.trim()?.[0] || "";
  const display = user?.display_name?.trim()?.[0] || "";
  const email = user?.email?.trim()?.[0] || "";

  return `${first}${last}`.toUpperCase() || display.toUpperCase() || email.toUpperCase() || "C";
}

function getPasswordChecks(password = "") {
  return [
    {
      label: "At least 10 characters",
      valid: password.length >= 10,
    },
    {
      label: "One uppercase letter",
      valid: /[A-Z]/.test(password),
    },
    {
      label: "One lowercase letter",
      valid: /[a-z]/.test(password),
    },
    {
      label: "One number",
      valid: /[0-9]/.test(password),
    },
    {
      label: "One symbol",
      valid: /[^A-Za-z0-9]/.test(password),
    },
  ];
}

function getPasswordScore(password = "") {
  const checks = getPasswordChecks(password);
  const passed = checks.filter((item) => item.valid).length;

  if (!password) {
    return {
      score: 0,
      label: "Start typing",
      checks,
      canSubmit: false,
    };
  }

  if (passed <= 2) {
    return {
      score: 28,
      label: "Weak",
      checks,
      canSubmit: false,
    };
  }

  if (passed === 3) {
    return {
      score: 52,
      label: "Getting better",
      checks,
      canSubmit: false,
    };
  }

  if (passed === 4) {
    return {
      score: 76,
      label: "Strong",
      checks,
      canSubmit: password.length >= 10,
    };
  }

  return {
    score: 100,
    label: "Excellent",
    checks,
    canSubmit: true,
  };
}

function Icon({ name, className = "h-5 w-5" }) {
  const icons = {
    eye: (
      <>
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    eyeOff: (
      <>
        <path d="m3 3 18 18" />
        <path d="M10.58 10.58a2 2 0 0 0 2.84 2.84" />
        <path d="M9.88 5.09A10.8 10.8 0 0 1 12 4c6.5 0 10 8 10 8a17.8 17.8 0 0 1-3.23 4.19" />
        <path d="M6.61 6.61C3.72 8.54 2 12 2 12s3.5 8 10 8a10.9 10.9 0 0 0 5.39-1.42" />
      </>
    ),
    check: <path d="M20 6 9 17l-5-5" />,
    user: (
      <>
        <path d="M20 21a8 8 0 0 0-16 0" />
        <circle cx="12" cy="8" r="4" />
      </>
    ),
    box: (
      <>
        <path d="M21 8a2 2 0 0 0-1-1.73L13 2.27a2 2 0 0 0-2 0L4 6.27A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="m3.3 7 8.7 5 8.7-5" />
        <path d="M12 22V12" />
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
    shield: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path d="m9 12 2 2 4-5" />
      </>
    ),
    spark: (
      <>
        <path d="M12 2v5" />
        <path d="M12 17v5" />
        <path d="M4.22 4.22 7.76 7.76" />
        <path d="M16.24 16.24l3.54 3.54" />
        <path d="M2 12h5" />
        <path d="M17 12h5" />
        <path d="M4.22 19.78l3.54-3.54" />
        <path d="M16.24 7.76l3.54-3.54" />
      </>
    ),
    arrow: (
      <>
        <path d="M7 17 17 7" />
        <path d="M8 7h9v9" />
      </>
    ),
    lock: (
      <>
        <rect width="18" height="11" x="3" y="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </>
    ),
    logout: (
      <>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="M16 17l5-5-5-5" />
        <path d="M21 12H9" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.15"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name]}
    </svg>
  );
}

function Field({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  autoComplete,
  required = false,
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.18em] text-white/45">
        {label}
      </span>

      <input
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-[52px] w-full rounded-2xl border border-white/10 bg-black/35 px-4 text-sm font-bold text-white outline-none transition placeholder:text-white/24 focus:border-red-500/60 focus:bg-black/55 focus:shadow-[0_0_0_4px_rgba(220,38,38,0.12)]"
      />
    </label>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  placeholder = "Create a secure password",
  autoComplete = "new-password",
  showMeter = false,
}) {
  const [visible, setVisible] = useState(false);
  const strength = getPasswordScore(value);

  return (
    <div>
      <label className="block">
        <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.18em] text-white/45">
          {label}
        </span>

        <div className="relative">
          <input
            type={visible ? "text" : "password"}
            value={value}
            required
            autoComplete={autoComplete}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            className="h-[52px] w-full rounded-2xl border border-white/10 bg-black/35 px-4 pr-13 text-sm font-bold text-white outline-none transition placeholder:text-white/24 focus:border-red-500/60 focus:bg-black/55 focus:shadow-[0_0_0_4px_rgba(220,38,38,0.12)]"
          />

          <button
            type="button"
            onClick={() => setVisible((current) => !current)}
            className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-xl text-white/40 transition hover:bg-white/[0.06] hover:text-white"
            aria-label={visible ? "Hide password" : "Show password"}
          >
            <Icon name={visible ? "eyeOff" : "eye"} className="h-[18px] w-[18px]" />
          </button>
        </div>
      </label>

      {showMeter && (
        <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-white/38">
              Password strength
            </span>
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-red-200">
              {strength.label}
            </span>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <motion.div
              className="h-full rounded-full bg-red-500"
              initial={false}
              animate={{ width: `${strength.score}%` }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {strength.checks.map((item) => (
              <div
                key={item.label}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-2.5 py-2 text-[11px] font-bold transition",
                  item.valid
                    ? "bg-red-500/10 text-red-100"
                    : "bg-white/[0.025] text-white/34"
                )}
              >
                <span
                  className={cn(
                    "grid h-4 w-4 shrink-0 place-items-center rounded-full border",
                    item.valid
                      ? "border-red-400 bg-red-500 text-white"
                      : "border-white/15 text-transparent"
                  )}
                >
                  <Icon name="check" className="h-2.5 w-2.5" />
                </span>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({ children, loading, variant = "primary", ...props }) {
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className={cn(
        "group relative flex min-h-[52px] w-full items-center justify-center overflow-hidden rounded-2xl px-5 text-xs font-black uppercase tracking-[0.16em] transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" &&
          "bg-red-600 text-white shadow-[0_24px_70px_rgba(220,38,38,0.28)] hover:bg-red-500",
        variant === "ghost" &&
          "border border-white/10 bg-white/[0.035] text-white/72 hover:bg-white/[0.07] hover:text-white"
      )}
    >
      {variant === "primary" && (
        <span className="pointer-events-none absolute inset-0 -translate-x-full bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.24),transparent)] transition duration-700 group-hover:translate-x-full" />
      )}

      <span className="relative">{loading ? "Please wait..." : children}</span>
    </button>
  );
}

function Message({ type, children }) {
  if (!children) return null;

  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm font-bold leading-6",
        type === "error"
          ? "border-red-500/25 bg-red-500/10 text-red-100"
          : "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
      )}
    >
      {children}
    </div>
  );
}

function AuthPanel({ mode, setMode, onAuthSuccess, resetKey, resetLogin }) {
  const [login, setLogin] = useState("");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const passwordStrength = getPasswordScore(password);
  const resetPasswordStrength = getPasswordScore(resetPassword);

  async function submit(endpoint, payload) {
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const text = await response.text();

      let data = null;

      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        console.error("Non JSON response from:", endpoint);
        console.error(text);

        throw new Error("The portal returned an invalid response. Check the account connection.");
      }

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Something went wrong.");
      }

      return data;
    } catch (err) {
      setError(err.message || "Something went wrong.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(event) {
    event.preventDefault();

    const data = await submit("/api/account/login", {
      login,
      password,
    });

    if (data?.success) {
      onAuthSuccess(data);
    }
  }

  async function handleRegister(event) {
    event.preventDefault();

    if (!passwordStrength.canSubmit) {
      setError("Create a stronger password before continuing.");
      return;
    }

    const data = await submit("/api/account/register", {
      email,
      password,
      first_name: firstName,
      last_name: lastName,
    });

    if (data?.success) {
      onAuthSuccess(data);
    }
  }

  async function handleForgot(event) {
    event.preventDefault();

    const data = await submit("/api/account/forgot-password", {
      login,
    });

    if (data?.success) {
      setNotice("If an account exists, a secure reset link has been sent.");
    }
  }

  async function handleReset(event) {
    event.preventDefault();

    if (!resetPasswordStrength.canSubmit) {
      setError("Create a stronger password before continuing.");
      return;
    }

    const data = await submit("/api/account/reset-password", {
      login: resetLogin,
      key: resetKey,
      password: resetPassword,
    });

    if (data?.success) {
      setNotice("Password updated. You can now sign in.");
      setPassword("");
      setResetPassword("");
      setMode("login");
    }
  }

  const title =
    mode === "register"
      ? "Create your private portal"
      : mode === "forgot"
        ? "Recover your access"
        : mode === "reset"
          ? "Set a new password"
          : "Enter your private portal";

  const subtitle =
    mode === "register"
      ? "Create a secure customer profile connected to your private account."
      : mode === "forgot"
        ? "Enter your email and we will send a secure reset link."
        : mode === "reset"
          ? "Choose a stronger password before returning to your account."
          : "Access orders, profile details, and account tools from one clean space.";

  return (
    <section className="mx-auto flex w-full max-w-[620px] items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full overflow-hidden rounded-[2.2rem] border border-white/10 bg-[#080808]/94 p-4 shadow-[0_35px_140px_rgba(0,0,0,0.66)] backdrop-blur-xl sm:p-6 lg:p-7"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(220,38,38,0.19),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(127,29,29,0.18),transparent_38%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-400/65 to-transparent" />

        <div className="relative">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-red-400/20 bg-red-500/10 text-red-100 shadow-[0_18px_44px_rgba(220,38,38,0.18)]">
              <Icon name="shield" />
            </div>

            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-red-300">
              Secure Customer Portal
            </p>

            <h2 className="mx-auto mt-3 max-w-md text-3xl font-black tracking-[-0.065em] text-white sm:text-4xl">
              {title}
            </h2>

            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-white/45">
              {subtitle}
            </p>
          </div>

          <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/35 p-1.5">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError("");
                setNotice("");
              }}
              className={cn(
                "rounded-xl px-4 py-3 text-xs font-black uppercase tracking-[0.14em] transition",
                mode === "login"
                  ? "bg-red-600 text-white shadow-[0_12px_34px_rgba(220,38,38,0.28)]"
                  : "text-white/45 hover:bg-white/[0.06] hover:text-white"
              )}
            >
              Sign in
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("register");
                setError("");
                setNotice("");
              }}
              className={cn(
                "rounded-xl px-4 py-3 text-xs font-black uppercase tracking-[0.14em] transition",
                mode === "register"
                  ? "bg-red-600 text-white shadow-[0_12px_34px_rgba(220,38,38,0.28)]"
                  : "text-white/45 hover:bg-white/[0.06] hover:text-white"
              )}
            >
              Create
            </button>
          </div>

          <div className="mb-4 grid gap-3">
            <Message type="error">{error}</Message>
            <Message type="success">{notice}</Message>
          </div>

          <AnimatePresence mode="wait">
            {mode === "login" && (
              <motion.form
                key="login"
                onSubmit={handleLogin}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.24 }}
                className="grid gap-4"
              >
                <Field
                  label="Email or username"
                  value={login}
                  onChange={setLogin}
                  placeholder="you@email.com"
                  autoComplete="username"
                  required
                />

                <PasswordField
                  label="Password"
                  value={password}
                  onChange={setPassword}
                  placeholder="Your password"
                  autoComplete="current-password"
                />

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("forgot");
                      setError("");
                      setNotice("");
                    }}
                    className="text-xs font-black uppercase tracking-[0.14em] text-red-300 transition hover:text-white"
                  >
                    Forgot password?
                  </button>
                </div>

                <ActionButton loading={loading}>Enter Portal</ActionButton>
              </motion.form>
            )}

            {mode === "register" && (
              <motion.form
                key="register"
                onSubmit={handleRegister}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.24 }}
                className="grid gap-4"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="First name"
                    value={firstName}
                    onChange={setFirstName}
                    placeholder="First name"
                    autoComplete="given-name"
                    required
                  />

                  <Field
                    label="Last name"
                    value={lastName}
                    onChange={setLastName}
                    placeholder="Last name"
                    autoComplete="family-name"
                    required
                  />
                </div>

                <Field
                  label="Email"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="you@email.com"
                  autoComplete="email"
                  required
                />

                <PasswordField
                  label="Password"
                  value={password}
                  onChange={setPassword}
                  placeholder="Build a strong password"
                  autoComplete="new-password"
                  showMeter
                />

                <ActionButton loading={loading} disabled={!passwordStrength.canSubmit}>
                  Create Secure Account
                </ActionButton>
              </motion.form>
            )}

            {mode === "forgot" && (
              <motion.form
                key="forgot"
                onSubmit={handleForgot}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.24 }}
                className="grid gap-4"
              >
                <Field
                  label="Account email"
                  type="email"
                  value={login}
                  onChange={setLogin}
                  placeholder="you@email.com"
                  autoComplete="email"
                  required
                />

                <ActionButton loading={loading}>Send Reset Link</ActionButton>

                <ActionButton
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setMode("login");
                    setError("");
                    setNotice("");
                  }}
                >
                  Back to Sign In
                </ActionButton>
              </motion.form>
            )}

            {mode === "reset" && (
              <motion.form
                key="reset"
                onSubmit={handleReset}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.24 }}
                className="grid gap-4"
              >
                <PasswordField
                  label="New password"
                  value={resetPassword}
                  onChange={setResetPassword}
                  placeholder="Build a stronger password"
                  autoComplete="new-password"
                  showMeter
                />

                <ActionButton loading={loading} disabled={!resetPasswordStrength.canSubmit}>
                  Update Password
                </ActionButton>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </section>
  );
}

function MetricCard({ label, value, icon }) {
  return (
    <div className="relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/[0.035] p-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(220,38,38,0.12),transparent_45%)]" />

      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">
            {label}
          </p>
          <p className="mt-3 text-4xl font-black tracking-[-0.06em] text-white">
            {value}
          </p>
        </div>

        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-red-400/20 bg-red-500/10 text-red-100">
          <Icon name={icon} className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function NavButton({ active, icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-xs font-black uppercase tracking-[0.14em] transition",
        active
          ? "bg-red-600 text-white shadow-[0_18px_44px_rgba(220,38,38,0.22)]"
          : "text-white/44 hover:bg-white/[0.055] hover:text-white"
      )}
    >
      <Icon name={icon} className="h-[18px] w-[18px]" />
      <span>{label}</span>
    </button>
  );
}

function getOrderTracking(order = {}) {
  const tracking = order.tracking || order.shipment || {};

  const number =
    order.tracking_number ||
    order.trackingNumber ||
    order.shipment_tracking_number ||
    tracking.number ||
    tracking.tracking_number ||
    "";

  const carrier =
    order.tracking_carrier ||
    order.carrier ||
    tracking.carrier ||
    tracking.provider ||
    tracking.tracking_provider ||
    "";

  const url =
    order.tracking_url ||
    order.trackingUrl ||
    tracking.url ||
    tracking.tracking_url ||
    "";

  return {
    number: String(number || "").trim(),
    carrier: String(carrier || "").trim(),
    url: String(url || "").trim(),
    eta: order.estimated_delivery || order.eta || tracking.eta || "",
  };
}

function getInlineTrackingSteps(order = {}) {
  const tracking = getOrderTracking(order);
  const status = order?.status || "";
  const hasTracking = Boolean(tracking.number || tracking.url);
  const completed = status === "completed";
  const stopped = ["cancelled", "refunded", "failed"].includes(status);

  if (stopped) {
    return [
      ["Order placed", "done"],
      ["Order stopped", "current"],
      ["Shipment", "idle"],
      ["Completed", "idle"],
    ];
  }

  return [
    ["Order placed", "done"],
    [
      "Preparing",
      ["processing", "on-hold", "completed"].includes(status)
        ? "done"
        : "current",
    ],
    [
      "Tracking",
      hasTracking || completed
        ? "done"
        : ["processing", "on-hold"].includes(status)
          ? "current"
          : "idle",
    ],
    ["Completed", completed ? "done" : "idle"],
  ];
}

function TrackingPreview({ order }) {
  const tracking = getOrderTracking(order);

  if (!tracking.number && !tracking.eta) return null;

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.025] p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/35">
            Shipment
          </p>

          <p className="mt-1 truncate text-xs font-bold text-white/70">
            {tracking.number
              ? `${tracking.carrier || "Carrier pending"} · ${tracking.number}`
              : tracking.carrier || "Carrier pending"}
          </p>
        </div>

        {tracking.eta && (
          <span className="shrink-0 rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.13em] text-white/55">
            ETA {tracking.eta}
          </span>
        )}
      </div>
    </div>
  );
}

function InlineTrackingDetails({ order, loading, error }) {
  const tracking = getOrderTracking(order);
  const steps = getInlineTrackingSteps(order);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0, y: -6 }}
      animate={{ opacity: 1, height: "auto", y: 0 }}
      exit={{ opacity: 0, height: 0, y: -6 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="overflow-hidden"
    >
      <div className="mt-4 rounded-[1.25rem] border border-white/10 bg-white/[0.025] p-4">
        <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-300">
              Tracking
            </p>

            <p className="mt-1 text-sm font-black text-white">
              Order #{order.number}
            </p>
          </div>

          <span className="w-fit rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-red-100">
            {statusLabel(order.status)}
          </span>
        </div>

        {loading && (
          <div className="mb-4 rounded-2xl border border-white/10 bg-black/25 p-3 text-xs font-bold text-white/45">
            Loading latest tracking details...
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-xs font-bold leading-5 text-red-100">
            {error}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
          <div className="grid gap-2">
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/32">
                Carrier
              </p>
              <p className="mt-1 text-sm font-bold text-white/72">
                {tracking.carrier || "Carrier pending"}
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/32">
                Tracking number
              </p>
              <p className="mt-1 break-all text-sm font-bold text-white/72">
                {tracking.number || "Tracking not assigned yet"}
              </p>
            </div>

            {tracking.eta && (
              <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/32">
                  Estimated delivery
                </p>
                <p className="mt-1 text-sm font-bold text-white/72">
                  {tracking.eta}
                </p>
              </div>
            )}

            {tracking.url && (
              <a
                href={tracking.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 flex min-h-10 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[10px] font-black uppercase tracking-[0.14em] text-white/62 transition hover:bg-white/[0.07] hover:text-white"
              >
                Carrier page
                <Icon name="arrow" className="h-4 w-4" />
              </a>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="mb-4 text-[10px] font-black uppercase tracking-[0.16em] text-white/32">
              Order progress
            </p>

            <div className="grid gap-3">
              {steps.map(([label, state], index) => (
                <div key={label} className="grid grid-cols-[28px_1fr] gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        "grid h-7 w-7 place-items-center rounded-full border text-[10px] font-black",
                        state === "done" &&
                          "border-red-400/45 bg-red-600 text-white",
                        state === "current" &&
                          "border-red-300/40 bg-red-500/10 text-red-100",
                        state === "idle" &&
                          "border-white/10 bg-white/[0.035] text-white/25"
                      )}
                    >
                      {state === "done" ? (
                        <Icon name="check" className="h-3.5 w-3.5" />
                      ) : (
                        index + 1
                      )}
                    </span>

                    {index < steps.length - 1 && (
                      <span className="mt-2 h-5 w-px bg-white/10" />
                    )}
                  </div>

                  <div>
                    <p
                      className={cn(
                        "text-sm font-black",
                        state === "idle" ? "text-white/35" : "text-white/76"
                      )}
                    >
                      {label}
                    </p>

                    <p className="mt-0.5 text-xs font-bold text-white/30">
                      {state === "done"
                        ? "Completed"
                        : state === "current"
                          ? "Current step"
                          : "Pending"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {!tracking.number && !tracking.url && (
          <p className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs font-bold leading-5 text-white/34">
            Tracking details will appear here once the shipment is assigned.
          </p>
        )}
      </div>
    </motion.div>
  );
}

function OrderCard({ order, customerEmail = "" }) {
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [trackingOrder, setTrackingOrder] = useState(null);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState("");

  const displayedOrder = trackingOrder || order;
  const tracking = getOrderTracking(displayedOrder);

  async function handleTrackOrder() {
    if (trackingOpen) {
      setTrackingOpen(false);
      return;
    }

    setTrackingOpen(true);
    setTrackingError("");

    if (trackingOrder || !customerEmail) {
      return;
    }

    setTrackingLoading(true);

    try {
      const response = await fetch("/api/orders/track", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          email: customerEmail,
          order_number: String(order.number || order.id || "").replace(/^#/, ""),
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
        throw new Error(data.message || "Tracking details are not available yet.");
      }

      setTrackingOrder({
        ...order,
        ...data.order,
        id: order.id || data.order?.id,
        number: data.order?.number || order.number,
      });
    } catch (err) {
      setTrackingError(
        err.message || "Tracking details are not available right now."
      );
    } finally {
      setTrackingLoading(false);
    }
  }

  return (
    <div className="rounded-[1.4rem] border border-white/10 bg-black/28 p-4 transition hover:border-red-500/30 hover:bg-white/[0.04]">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-black text-white">Order #{order.number}</p>
          <p className="mt-1 text-xs text-white/35">
            {order.date || "No date"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-red-100">
            {statusLabel(order.status)}
          </span>

          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-white/60">
            {formatMoney(order.total, order.currency)}
          </span>
        </div>
      </div>

      {order.items?.length > 0 && (
        <div className="mt-4 grid gap-2">
          {order.items.slice(0, 4).map((item, index) => (
            <div
              key={`${order.id}-${item.name}-${index}`}
              className="flex justify-between gap-4 rounded-xl bg-white/[0.025] px-3 py-2 text-xs"
            >
              <span className="line-clamp-1 font-bold text-white/65">
                {item.name}
              </span>
              <span className="shrink-0 text-white/35">
                Qty {item.quantity}
              </span>
            </div>
          ))}
        </div>
      )}

      <TrackingPreview order={displayedOrder} />

      <div className="mt-4 border-t border-white/10 pt-4">
        <button
          type="button"
          onClick={handleTrackOrder}
          className={cn(
            "group flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl px-4 text-[10px] font-black uppercase tracking-[0.16em] transition",
            trackingOpen
              ? "border border-white/10 bg-white/[0.04] text-white/64 hover:bg-white/[0.07] hover:text-white"
              : "bg-red-600 text-white shadow-[0_18px_46px_rgba(220,38,38,0.24)] hover:bg-red-500"
          )}
        >
          <Icon name="truck" className="h-4 w-4" />
          {trackingOpen ? "Hide Tracking" : "Track Order"}
        </button>

        <AnimatePresence initial={false}>
          {trackingOpen && (
            <InlineTrackingDetails
              order={displayedOrder}
              loading={trackingLoading}
              error={trackingError}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.035] p-7 text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-red-400/20 bg-red-500/10 text-red-100">
        <Icon name="box" />
      </div>

      <p className="text-sm font-black text-white">{title}</p>
      <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-white/40">
        {text}
      </p>
    </div>
  );
}

function Dashboard({ user, orders, onLogout, onProfileUpdate }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const [profile, setProfile] = useState({
    first_name: user?.first_name || "",
    last_name: user?.last_name || "",
    billing_phone: user?.billing_phone || "",
    billing_address_1: user?.billing_address_1 || "",
    billing_address_2: user?.billing_address_2 || "",
    billing_city: user?.billing_city || "",
    billing_state: user?.billing_state || "",
    billing_postcode: user?.billing_postcode || "",
    billing_country: user?.billing_country || "US",
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setProfile({
      first_name: user?.first_name || "",
      last_name: user?.last_name || "",
      billing_phone: user?.billing_phone || "",
      billing_address_1: user?.billing_address_1 || "",
      billing_address_2: user?.billing_address_2 || "",
      billing_city: user?.billing_city || "",
      billing_state: user?.billing_state || "",
      billing_postcode: user?.billing_postcode || "",
      billing_country: user?.billing_country || "US",
    });
  }, [user]);

  const completedOrders = useMemo(
    () => orders.filter((order) => order.status === "completed").length,
    [orders]
  );

  const latestOrder = orders?.[0] || null;

  const totalSpent = useMemo(
    () =>
      orders.reduce((sum, order) => {
        const number = Number(order.total || 0);
        return sum + (Number.isFinite(number) ? number : 0);
      }, 0),
    [orders]
  );

  function setField(key, value) {
    setProfile((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function updateProfile(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/account/update-profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(profile),
      });

      const text = await response.text();

      let data = null;

      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error("The portal returned an invalid profile response.");
      }

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to update profile.");
      }

      onProfileUpdate(data.user);
      setMessage("Profile updated successfully.");
      setEditing(false);
    } catch (err) {
      setError(err.message || "Unable to update profile.");
    } finally {
      setLoading(false);
    }
  }

  const navItems = [
    ["overview", "Overview", "spark"],
    ["orders", "Orders", "box"],
    ["profile", "Profile", "user"],
    ["security", "Security", "shield"],
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto w-full max-w-[1240px]"
    >
      <div className="mb-6 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-red-300">
            Private Client Console
          </p>

          <h1 className="mt-3 text-4xl font-black tracking-[-0.075em] text-white sm:text-5xl lg:text-6xl">
            Private portal,
            <span className="block text-white/52">built around you.</span>
          </h1>

          <p className="mt-4 max-w-2xl text-sm leading-6 text-white/42">
            A cleaner customer space for order history, account details, and secure access management.
          </p>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.035] px-5 text-xs font-black uppercase tracking-[0.16em] text-white/65 transition hover:bg-red-600 hover:text-white"
        >
          <Icon name="logout" className="h-4 w-4" />
          Sign Out
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#080808]/92 p-4 shadow-[0_30px_120px_rgba(0,0,0,0.45)] lg:sticky lg:top-32 lg:h-fit">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(220,38,38,0.16),transparent_42%)]" />

          <div className="relative">
            <div className="mb-5 flex items-center gap-3 rounded-[1.35rem] border border-white/10 bg-black/28 p-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-red-600 text-sm font-black text-white shadow-[0_18px_40px_rgba(220,38,38,0.28)]">
                {initialsFromUser(user)}
              </div>

              <div className="min-w-0">
                <p className="truncate text-sm font-black text-white">
                  {user?.first_name || user?.display_name || "Customer"}
                </p>
                <p className="truncate text-xs text-white/38">{user?.email}</p>
              </div>
            </div>

            <div className="hidden gap-1 lg:grid">
              {navItems.map(([id, label, icon]) => (
                <NavButton
                  key={id}
                  label={label}
                  icon={icon}
                  active={activeTab === id}
                  onClick={() => setActiveTab(id)}
                />
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 lg:hidden">
              {navItems.map(([id, label, icon]) => (
                <NavButton
                  key={id}
                  label={label}
                  icon={icon}
                  active={activeTab === id}
                  onClick={() => setActiveTab(id)}
                />
              ))}
            </div>
          </div>
        </aside>

        <section className="min-w-0">
          <AnimatePresence mode="wait">
            {activeTab === "overview" && (
              <motion.div
                key="overview"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.22 }}
                className="grid gap-5"
              >
                <div className="grid gap-4 md:grid-cols-3">
                  <MetricCard label="Total Orders" value={orders.length} icon="box" />
                  <MetricCard label="Completed" value={completedOrders} icon="check" />
                  <MetricCard label="Account Value" value={formatMoney(totalSpent)} icon="spark" />
                </div>

                <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                  <div className="rounded-[2rem] border border-white/10 bg-[#080808]/92 p-5 shadow-[0_30px_120px_rgba(0,0,0,0.42)] sm:p-6">
                    <div className="mb-5 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-300">
                          Client Timeline
                        </p>
                        <h2 className="mt-2 text-2xl font-black tracking-[-0.05em] text-white">
                          Latest Movement
                        </h2>
                      </div>

                      <button
                        type="button"
                        onClick={() => setActiveTab("orders")}
                        className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.035] text-white/45 transition hover:bg-red-600 hover:text-white"
                      >
                        <Icon name="arrow" className="h-4 w-4" />
                      </button>
                    </div>

                    {latestOrder ? (
                      <OrderCard order={latestOrder} customerEmail={user?.email} />
                    ) : (
                      <EmptyState
                        title="No order activity yet."
                        text="Your first checkout will open a private order timeline here, organized with status, totals, and product details."
                      />
                    )}
                  </div>

                  <div className="rounded-[2rem] border border-white/10 bg-[#080808]/92 p-5 shadow-[0_30px_120px_rgba(0,0,0,0.42)] sm:p-6">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-300">
                      Account Status
                    </p>

                    <h2 className="mt-2 text-2xl font-black tracking-[-0.05em] text-white">
                      Account ready
                    </h2>

                    <div className="mt-5 grid gap-3">
                      {[
                        ["Access", "Private session active"],
                        ["Profile", user?.billing_phone ? "Customer details completed" : "Customer details ready to complete"],
                        ["Recovery", "Secure reset available"],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"
                        >
                          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/35">
                            {label}
                          </p>
                          <p className="mt-1 text-sm font-bold text-white/70">
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === "orders" && (
              <motion.div
                key="orders"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.22 }}
                className="rounded-[2rem] border border-white/10 bg-[#080808]/92 shadow-[0_30px_120px_rgba(0,0,0,0.42)]"
              >
                <div className="border-b border-white/10 p-5 sm:p-6">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-300">
                    Orders
                  </p>
                  <h2 className="mt-2 text-2xl font-black tracking-[-0.05em] text-white">
                    Purchase history
                  </h2>
                </div>

                <div className="grid gap-3 p-4 sm:p-5">
                  {orders.length === 0 ? (
                    <EmptyState
                      title="Your order timeline is clear."
                      text="Completed purchases will appear here with order status, totals, and product details in one organized view."
                    />
                  ) : (
                    orders.map((order) => (
                      <OrderCard key={order.id} order={order} customerEmail={user?.email} />
                    ))
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === "profile" && (
              <motion.div
                key="profile"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.22 }}
                className="rounded-[2rem] border border-white/10 bg-[#080808]/92 p-5 shadow-[0_30px_120px_rgba(0,0,0,0.42)] sm:p-6"
              >
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-300">
                      Profile
                    </p>
                    <h2 className="mt-2 text-2xl font-black tracking-[-0.05em] text-white">
                      Customer details
                    </h2>
                  </div>

                  <button
                    type="button"
                    onClick={() => setEditing((current) => !current)}
                    className="rounded-full border border-white/10 bg-white/[0.035] px-4 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-white/55 transition hover:bg-white/[0.07] hover:text-white"
                  >
                    {editing ? "Cancel" : "Edit"}
                  </button>
                </div>

                <div className="mb-4 grid gap-3">
                  <Message type="error">{error}</Message>
                  <Message type="success">{message}</Message>
                </div>

                {!editing && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      ["Email", user.email],
                      ["Name", `${user.first_name || ""} ${user.last_name || ""}`.trim() || "Not added"],
                      ["Phone", user.billing_phone || "Not added"],
                      ["Address", user.billing_address_1 || "Not added"],
                      ["City", user.billing_city || "Not added"],
                      ["State", user.billing_state || "Not added"],
                      ["ZIP", user.billing_postcode || "Not added"],
                      ["Country", user.billing_country || "Not added"],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"
                      >
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/35">
                          {label}
                        </p>
                        <p className="mt-1 text-sm font-bold text-white/75">
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {editing && (
                  <form onSubmit={updateProfile} className="grid gap-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="First name"
                        value={profile.first_name}
                        onChange={(value) => setField("first_name", value)}
                      />

                      <Field
                        label="Last name"
                        value={profile.last_name}
                        onChange={(value) => setField("last_name", value)}
                      />
                    </div>

                    <Field
                      label="Phone"
                      value={profile.billing_phone}
                      onChange={(value) => setField("billing_phone", value)}
                    />

                    <Field
                      label="Address"
                      value={profile.billing_address_1}
                      onChange={(value) => setField("billing_address_1", value)}
                    />

                    <Field
                      label="Apartment, suite, etc."
                      value={profile.billing_address_2}
                      onChange={(value) => setField("billing_address_2", value)}
                    />

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="City"
                        value={profile.billing_city}
                        onChange={(value) => setField("billing_city", value)}
                      />

                      <Field
                        label="State"
                        value={profile.billing_state}
                        onChange={(value) => setField("billing_state", value)}
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="ZIP"
                        value={profile.billing_postcode}
                        onChange={(value) => setField("billing_postcode", value)}
                      />

                      <Field
                        label="Country"
                        value={profile.billing_country}
                        onChange={(value) => setField("billing_country", value)}
                      />
                    </div>

                    <ActionButton loading={loading}>Save Profile</ActionButton>
                  </form>
                )}
              </motion.div>
            )}

            {activeTab === "security" && (
              <motion.div
                key="security"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.22 }}
                className="rounded-[2rem] border border-white/10 bg-[#080808]/92 p-5 shadow-[0_30px_120px_rgba(0,0,0,0.42)] sm:p-6"
              >
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-300">
                  Security
                </p>

                <h2 className="mt-2 text-2xl font-black tracking-[-0.05em] text-white">
                  Account protection
                </h2>

                <div className="mt-5 grid gap-3">
                  <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5">
                    <div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl border border-red-400/20 bg-red-500/10 text-red-100">
                      <Icon name="lock" />
                    </div>

                    <p className="text-sm font-black text-white">
                      Password recovery is enabled
                    </p>

                    <p className="mt-2 text-sm leading-6 text-white/42">
                      Customers can reset their password through a private, time-sensitive email link.
                    </p>
                  </div>

                  <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5">
                    <div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl border border-red-400/20 bg-red-500/10 text-red-100">
                      <Icon name="shield" />
                    </div>

                    <p className="text-sm font-black text-white">
                      Session protected
                    </p>

                    <p className="mt-2 text-sm leading-6 text-white/42">
                      Your session is protected through a private server-side flow designed to keep access details away from the browser.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>
    </motion.div>
  );
}

export default function AccountPortal() {
  const [mode, setMode] = useState("login");
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [resetParams, setResetParams] = useState({
    key: "",
    login: "",
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextMode = params.get("mode");
    const key = params.get("key") || "";
    const login = params.get("login") || "";

    if (nextMode === "reset" && key && login) {
      setResetParams({ key, login });
      setMode("reset");
    } else if (["login", "register", "forgot"].includes(nextMode)) {
      setMode(nextMode);
    }

    async function loadMe() {
      try {
        const response = await fetch("/api/account/me", {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        });

        const text = await response.text();

        let data = null;

        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = {};
        }

        if (response.ok && data.success && data.user) {
          setUser(data.user);
          setOrders(Array.isArray(data.orders) ? data.orders : []);
        }
      } catch {
      } finally {
        setBooting(false);
      }
    }

    loadMe();
  }, []);

  function handleAuthSuccess(data) {
    setUser(data.user);
    setOrders(Array.isArray(data.orders) ? data.orders : []);

    const cleanUrl = `${window.location.origin}${window.location.pathname}`;
    window.history.replaceState({}, "", cleanUrl);
  }

async function handleLogout() {
  try {
    await fetch("/api/account/logout", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-store",
      },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (error) {
    console.error("Logout failed:", error);
  }

  setUser(null);
  setOrders([]);
  setResetParams({
    key: "",
    login: "",
  });
  setMode("login");

  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {}

  const cleanUrl = `${window.location.origin}${window.location.pathname}`;
  window.history.replaceState({}, "", cleanUrl);

  window.location.href = "/account?mode=login&logged_out=1";
}
  if (booting) {
    return (
      <main className="relative min-h-screen overflow-hidden bg-[#030000] px-4 pb-20 pt-44 text-white sm:px-6 sm:pt-48 lg:px-8 lg:pt-52">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(220,38,38,0.18),transparent_35%),radial-gradient(circle_at_bottom,rgba(127,29,29,0.16),transparent_42%)]" />
        <div className="relative mx-auto h-[560px] max-w-[1240px] animate-pulse rounded-[2rem] border border-white/10 bg-white/[0.035]" />
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#030000] px-4 pb-20 pt-44 text-white sm:px-6 sm:pt-48 lg:px-8 lg:pt-52">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(220,38,38,0.16),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(127,29,29,0.18),transparent_42%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[linear-gradient(180deg,rgba(127,29,29,0.20),transparent)]" />

      <div className="relative">
        {user ? (
          <Dashboard
            user={user}
            orders={orders}
            onLogout={handleLogout}
            onProfileUpdate={setUser}
          />
        ) : (
          <AuthPanel
            mode={mode}
            setMode={setMode}
            onAuthSuccess={handleAuthSuccess}
            resetKey={resetParams.key}
            resetLogin={resetParams.login}
          />
        )}
      </div>
    </main>
  );
}
