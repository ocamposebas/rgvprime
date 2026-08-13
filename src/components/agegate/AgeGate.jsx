import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  FlaskConical,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { getMeOnce, resetMeCache } from "../../lib/accountSession";

const PUBLIC_PATHS = ["/policies"];
const ACCESS_STORAGE_KEY = "rgv_member_access_until_v1";
const ACCESS_DURATION = 30 * 24 * 60 * 60 * 1000;

function hasRememberedAccess() {
  if (typeof window === "undefined") return false;

  try {
    return Number(window.localStorage.getItem(ACCESS_STORAGE_KEY) || 0) > Date.now();
  } catch {
    return false;
  }
}

function rememberAccess() {
  try {
    window.localStorage.setItem(ACCESS_STORAGE_KEY, String(Date.now() + ACCESS_DURATION));
  } catch {
    // The account cookie still keeps the authenticated session when storage is unavailable.
  }
}

function isPublicPath() {
  if (typeof window === "undefined") return false;

  return PUBLIC_PATHS.some(
    (path) =>
      window.location.pathname === path ||
      window.location.pathname.startsWith(`${path}/`),
  );
}

function passwordChecks(password = "") {
  return [
    { label: "10+ characters", valid: password.length >= 10 },
    { label: "Upper & lowercase", valid: /[A-Z]/.test(password) && /[a-z]/.test(password) },
    { label: "One number", valid: /[0-9]/.test(password) },
    { label: "One symbol", valid: /[^A-Za-z0-9]/.test(password) },
  ];
}

function TextField({ icon: Icon, label, ...props }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-white/45 sm:mb-2 sm:text-[10px]">
        {label}
      </span>
      <span className="relative block">
        <Icon
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/28"
          strokeWidth={1.8}
          aria-hidden="true"
        />
        <input
          {...props}
          className="h-11 w-full rounded-xl border border-white/10 bg-black/35 pl-10 pr-3.5 text-[13px] font-semibold text-white outline-none transition placeholder:text-white/22 hover:border-white/16 focus:border-red-500/65 focus:bg-black/55 focus:shadow-[0_0_0_3px_rgba(220,38,38,0.11)] sm:h-12 sm:rounded-2xl sm:text-sm"
        />
      </span>
    </label>
  );
}

function PasswordField({ label, value, onChange, autoComplete, placeholder }) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="block">
      <span className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-white/45 sm:mb-2 sm:text-[10px]">
        {label}
      </span>
      <span className="relative block">
        <LockKeyhole
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/28"
          strokeWidth={1.8}
          aria-hidden="true"
        />
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required
          className="h-11 w-full rounded-xl border border-white/10 bg-black/35 pl-10 pr-11 text-[13px] font-semibold text-white outline-none transition placeholder:text-white/22 hover:border-white/16 focus:border-red-500/65 focus:bg-black/55 focus:shadow-[0_0_0_3px_rgba(220,38,38,0.11)] sm:h-12 sm:rounded-2xl sm:text-sm"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-white/35 transition hover:bg-white/[0.06] hover:text-white"
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </span>
    </label>
  );
}

function StatusMessage({ type, children }) {
  if (!children) return null;

  return (
    <div
      role={type === "error" ? "alert" : "status"}
      className={`rounded-xl border px-3.5 py-3 text-xs font-semibold leading-5 sm:rounded-2xl ${
        type === "error"
          ? "border-red-500/25 bg-red-500/10 text-red-100"
          : "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
      }`}
    >
      {children}
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="fixed inset-0 z-[2147483646] grid min-h-[100svh] place-items-center bg-[#050505] text-white">
      <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
        <img src="/logo.webp" alt="RGVPRIME" className="h-14 w-auto object-contain opacity-90" />
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/15 border-t-red-500" />
        <span className="text-[9px] font-black uppercase tracking-[0.22em] text-white/35">
          Securing access
        </span>
      </div>
    </div>
  );
}

export default function AgeGate() {
  const [status, setStatus] = useState("checking");
  const [mode, setMode] = useState("login");
  const [login, setLogin] = useState("");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetParams, setResetParams] = useState({ key: "", login: "" });
  const [accessConfirmed, setAccessConfirmed] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const checks = useMemo(() => passwordChecks(password), [password]);
  const resetChecks = useMemo(() => passwordChecks(resetPassword), [resetPassword]);
  const strongPassword = checks.every((item) => item.valid);
  const strongResetPassword = resetChecks.every((item) => item.valid);

  useEffect(() => {
    if (isPublicPath()) {
      setStatus("authenticated");
      return undefined;
    }

    const params = new URLSearchParams(window.location.search);
    const nextMode = params.get("mode");
    const key = params.get("key") || "";
    const resetLogin = params.get("login") || "";

    if (nextMode === "reset" && key && resetLogin) {
      setResetParams({ key, login: resetLogin });
      setMode("reset");
    } else if (nextMode === "register" || nextMode === "forgot") {
      setMode(nextMode);
    }

    let active = true;

    async function verifySession() {
      if (nextMode !== "reset" && hasRememberedAccess()) {
        if (active) setStatus("authenticated");
        return;
      }

      const result = await getMeOnce({ force: true });
      const authenticated = Boolean(result?.ok && result?.data?.success && result?.data?.user);

      if (authenticated) rememberAccess();

      if (active) {
        setStatus(
          authenticated || hasRememberedAccess() ? "authenticated" : "locked",
        );
      }
    }

    function keepSiteOpenAfterLogout() {
      resetMeCache();
      setStatus(hasRememberedAccess() ? "authenticated" : "locked");
    }

    function handleStorage(event) {
      if (event.key !== "rgv-account-event") return;

      if (String(event.newValue || "").startsWith("logout:")) {
        keepSiteOpenAfterLogout();
      } else if (String(event.newValue || "").startsWith("login:")) {
        verifySession();
      }
    }

    verifySession();
    window.addEventListener("rgv-account-login", verifySession);
    window.addEventListener("rgv-account-logout", keepSiteOpenAfterLogout);
    window.addEventListener("storage", handleStorage);

    return () => {
      active = false;
      window.removeEventListener("rgv-account-login", verifySession);
      window.removeEventListener("rgv-account-logout", keepSiteOpenAfterLogout);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    if (status !== "locked") return undefined;

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [status]);

  function changeMode(nextMode) {
    setMode(nextMode);
    setError("");
    setNotice("");
  }

  async function submit(endpoint, payload) {
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      let data = {};

      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error("The account service returned an invalid response. Please try again.");
      }

      if (!response.ok || data.success !== true) {
        throw new Error(data.message || "We could not complete that request.");
      }

      return data;
    } catch (requestError) {
      setError(requestError?.message || "We could not complete that request.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  function openAuthenticatedSession(data) {
    resetMeCache();
    rememberAccess();

    try {
      window.localStorage.setItem("rgv-account-event", `login:${Date.now()}`);
    } catch {}

    window.dispatchEvent(new Event("rgv-account-login"));
    setStatus("authenticated");

    if (data?.user) {
      window.dispatchEvent(new CustomEvent("rgv-access-granted", { detail: { user: data.user } }));
    }
  }

  async function subscribeToWelcomeOffer() {
    try {
      const response = await fetch("/api/omnisend-welcome", {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          firstName,
          email: email.trim().toLowerCase(),
          consent: true,
          company: "",
          source: "access-gate-registration",
          pagePath: window.location.pathname + window.location.search,
        }),
      });

      if (response.ok) {
        try {
          window.localStorage.setItem(
            "rgv_welcome_popup_subscribed_until_v1",
            String(Date.now() + 365 * 24 * 60 * 60 * 1000),
          );
        } catch {}
      }
    } catch {
      // Account creation must never fail because the optional offer service is unavailable.
    }
  }

  async function handleLogin(event) {
    event.preventDefault();

    if (!accessConfirmed) {
      setError("Please confirm the age and research-use requirements to continue.");
      return;
    }

    const data = await submit("/api/account/login", { login, password });
    if (data?.success) openAuthenticatedSession(data);
  }

  async function handleRegister(event) {
    event.preventDefault();

    if (!accessConfirmed) {
      setError("Please confirm the age and research-use requirements to continue.");
      return;
    }

    if (!strongPassword) {
      setError("Create a password that meets all four security requirements.");
      return;
    }

    const data = await submit("/api/account/register", {
      email,
      password,
      first_name: firstName,
      last_name: lastName,
    });

    if (!data?.success) return;
    if (marketingOptIn) void subscribeToWelcomeOffer();
    openAuthenticatedSession(data);
  }

  async function handleForgot(event) {
    event.preventDefault();
    const data = await submit("/api/account/forgot-password", { login });

    if (data?.success) {
      setNotice("If an account exists, a secure reset link has been sent to your email.");
    }
  }

  async function handleReset(event) {
    event.preventDefault();

    if (!strongResetPassword) {
      setError("Create a password that meets all four security requirements.");
      return;
    }

    const data = await submit("/api/account/reset-password", {
      login: resetParams.login,
      key: resetParams.key,
      password: resetPassword,
    });

    if (data?.success) {
      setResetPassword("");
      setNotice("Password updated. You can now sign in with your new password.");
      setMode("login");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }

  if (status === "checking") return <LoadingScreen />;
  if (status === "authenticated") return null;

  const isAccessMode = mode === "login" || mode === "register";
  const formTitle =
    mode === "register"
      ? "Create your account"
      : mode === "forgot"
        ? "Recover your access"
        : mode === "reset"
          ? "Set a new password"
          : "Welcome back";
  const formSubtitle =
    mode === "register"
      ? "Join the private RGVPRIME research portal."
      : mode === "forgot"
        ? "We will send a secure recovery link to your account email."
        : mode === "reset"
          ? "Choose a new password to restore your account access."
          : "Sign in to continue to the private catalog.";
  const activePasswordChecks = mode === "reset" ? resetChecks : checks;

  return (
    <div
      className="fixed inset-0 z-[2147483646] min-h-[100svh] overflow-y-auto overscroll-contain bg-[#050505] text-white"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rgv-access-title"
      style={{
        paddingTop: "max(10px, env(safe-area-inset-top))",
        paddingBottom: "max(10px, env(safe-area-inset-bottom))",
        paddingLeft: "max(10px, env(safe-area-inset-left))",
        paddingRight: "max(10px, env(safe-area-inset-right))",
      }}
    >
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_12%,rgba(220,38,38,0.19),transparent_30rem),radial-gradient(circle_at_88%_88%,rgba(127,29,29,0.16),transparent_32rem),linear-gradient(145deg,#050505_0%,#090707_48%,#050505_100%)]" />
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:54px_54px] opacity-30 [mask-image:radial-gradient(circle_at_center,black,transparent_82%)]" />

      <div className="relative flex min-h-[calc(100svh-20px)] items-center justify-center">
        <div className="grid w-full max-w-[1080px] overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#090909] shadow-[0_40px_160px_rgba(0,0,0,0.78)] lg:grid-cols-[0.9fr_1.1fr] lg:rounded-[2rem]">
          <section className="relative hidden overflow-hidden border-r border-white/10 p-9 lg:flex lg:min-h-[680px] lg:flex-col lg:justify-between xl:p-11">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(220,38,38,0.24),transparent_42%),linear-gradient(160deg,rgba(255,255,255,0.035),transparent_45%)]" />
            <div className="pointer-events-none absolute -bottom-28 -right-24 h-80 w-80 rounded-full border border-red-500/10" />
            <div className="pointer-events-none absolute -bottom-16 -right-12 h-56 w-56 rounded-full border border-red-500/10" />

            <div className="relative">
              <img src="/logo.webp" alt="RGVPRIME" className="h-[66px] w-auto object-contain" />
              <div className="mt-9 inline-flex items-center gap-2 rounded-full border border-red-400/20 bg-red-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-[0.2em] text-red-200">
                <ShieldCheck className="h-3.5 w-3.5" />
                Private member access
              </div>

              <h1 id="rgv-access-title" className="mt-6 max-w-[430px] text-[3.2rem] font-black leading-[0.94] tracking-[-0.055em] text-white">
                Research access,
                <span className="block text-white/48">reserved for verified members.</span>
              </h1>

              <p className="mt-5 max-w-[410px] text-sm leading-6 text-white/46">
                Create an account or sign in to enter the RGVPRIME catalog, manage orders and access your private customer tools.
              </p>
            </div>

            <div className="relative grid gap-3">
              {[
                [ShieldCheck, "21+ verified access", "Age-restricted member entry"],
                [FlaskConical, "Research-use-only", "Clear responsible-use requirements"],
                [LockKeyhole, "Secure account session", "Connected to your existing portal"],
              ].map(([Icon, title, description]) => (
                <div key={title} className="flex items-center gap-3 rounded-2xl border border-white/9 bg-white/[0.028] p-3.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-red-400/15 bg-red-500/10 text-red-200">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span>
                    <strong className="block text-xs font-black text-white/82">{title}</strong>
                    <span className="mt-0.5 block text-[11px] text-white/34">{description}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="relative flex items-center p-4 sm:p-6 lg:p-8 xl:p-10">
            <div className="mx-auto w-full max-w-[500px]">
              <div className="mb-4 flex items-center justify-between gap-4 lg:hidden">
                <img src="/logo.webp" alt="RGVPRIME" className="h-11 w-auto object-contain sm:h-12" />
                <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/20 bg-red-500/10 px-2.5 py-1.5 text-[8px] font-black uppercase tracking-[0.16em] text-red-200">
                  <ShieldCheck className="h-3 w-3" />
                  21+ Access
                </span>
              </div>

              {isAccessMode && (
                <div className="mb-4 grid grid-cols-2 gap-1.5 rounded-xl border border-white/10 bg-black/40 p-1 sm:mb-5 sm:rounded-2xl">
                  <button
                    type="button"
                    onClick={() => changeMode("login")}
                    className={`min-h-10 rounded-lg px-3 text-[9px] font-black uppercase tracking-[0.15em] transition sm:rounded-xl sm:text-[10px] ${
                      mode === "login"
                        ? "bg-red-600 text-white shadow-[0_12px_35px_rgba(220,38,38,0.24)]"
                        : "text-white/42 hover:bg-white/[0.05] hover:text-white"
                    }`}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    onClick={() => changeMode("register")}
                    className={`min-h-10 rounded-lg px-3 text-[9px] font-black uppercase tracking-[0.15em] transition sm:rounded-xl sm:text-[10px] ${
                      mode === "register"
                        ? "bg-red-600 text-white shadow-[0_12px_35px_rgba(220,38,38,0.24)]"
                        : "text-white/42 hover:bg-white/[0.05] hover:text-white"
                    }`}
                  >
                    Create account
                  </button>
                </div>
              )}

              <div className="mb-4 sm:mb-5">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-red-300 sm:text-[10px]">
                  {mode === "register" ? "New member" : mode === "forgot" || mode === "reset" ? "Secure recovery" : "Member portal"}
                </p>
                <h2 className="mt-1.5 text-2xl font-black tracking-[-0.045em] text-white sm:mt-2 sm:text-3xl">
                  {formTitle}
                </h2>
                <p className="mt-1.5 text-xs leading-5 text-white/42 sm:mt-2 sm:text-sm">
                  {formSubtitle}
                </p>
              </div>

              <div className="mb-3 grid gap-2">
                <StatusMessage type="error">{error}</StatusMessage>
                <StatusMessage type="success">{notice}</StatusMessage>
              </div>

              {mode === "login" && (
                <form onSubmit={handleLogin} className="grid gap-3 sm:gap-4">
                  <TextField
                    icon={Mail}
                    label="Email or username"
                    value={login}
                    onChange={(event) => setLogin(event.target.value)}
                    placeholder="you@email.com"
                    autoComplete="username"
                    autoFocus
                    required
                  />
                  <PasswordField
                    label="Password"
                    value={password}
                    onChange={setPassword}
                    autoComplete="current-password"
                    placeholder="Your password"
                  />
                  <div className="flex justify-end">
                    <button type="button" onClick={() => changeMode("forgot")} className="text-[9px] font-black uppercase tracking-[0.14em] text-red-300 transition hover:text-white sm:text-[10px]">
                      Forgot password?
                    </button>
                  </div>

                  <AccessConfirmation checked={accessConfirmed} onChange={setAccessConfirmed} />
                  <SubmitButton loading={loading} disabled={!accessConfirmed}>
                    Sign in & enter
                  </SubmitButton>
                </form>
              )}

              {mode === "register" && (
                <form onSubmit={handleRegister} className="grid gap-3 sm:gap-4">
                  <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                    <TextField
                      icon={UserRound}
                      label="First name"
                      value={firstName}
                      onChange={(event) => setFirstName(event.target.value)}
                      placeholder="First name"
                      autoComplete="given-name"
                      autoFocus
                      required
                    />
                    <TextField
                      icon={UserRound}
                      label="Last name"
                      value={lastName}
                      onChange={(event) => setLastName(event.target.value)}
                      placeholder="Last name"
                      autoComplete="family-name"
                      required
                    />
                  </div>
                  <TextField
                    icon={Mail}
                    label="Email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@email.com"
                    autoComplete="email"
                    required
                  />
                  <PasswordField
                    label="Create password"
                    value={password}
                    onChange={setPassword}
                    autoComplete="new-password"
                    placeholder="Build a secure password"
                  />
                  <PasswordRequirements checks={checks} />

                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/9 bg-white/[0.025] p-3 transition hover:border-red-500/20 sm:rounded-2xl">
                    <input
                      type="checkbox"
                      checked={marketingOptIn}
                      onChange={(event) => setMarketingOptIn(event.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-red-600"
                    />
                    <span className="text-[11px] leading-[1.45] text-white/48">
                      <strong className="text-white/76">Send me the 10% welcome offer</strong> and occasional product news by email. Optional; unsubscribe anytime.
                    </span>
                  </label>

                  <AccessConfirmation checked={accessConfirmed} onChange={setAccessConfirmed} />
                  <SubmitButton loading={loading} disabled={!accessConfirmed || !strongPassword}>
                    Create account & enter
                  </SubmitButton>
                </form>
              )}

              {mode === "forgot" && (
                <form onSubmit={handleForgot} className="grid gap-4">
                  <TextField
                    icon={Mail}
                    label="Account email"
                    type="email"
                    value={login}
                    onChange={(event) => setLogin(event.target.value)}
                    placeholder="you@email.com"
                    autoComplete="email"
                    autoFocus
                    required
                  />
                  <SubmitButton loading={loading}>Send secure link</SubmitButton>
                  <button type="button" onClick={() => changeMode("login")} className="min-h-11 rounded-xl border border-white/10 bg-white/[0.025] px-4 text-[9px] font-black uppercase tracking-[0.15em] text-white/58 transition hover:bg-white/[0.06] hover:text-white">
                    Back to sign in
                  </button>
                </form>
              )}

              {mode === "reset" && (
                <form onSubmit={handleReset} className="grid gap-4">
                  <PasswordField
                    label="New password"
                    value={resetPassword}
                    onChange={setResetPassword}
                    autoComplete="new-password"
                    placeholder="Build a secure password"
                  />
                  <PasswordRequirements checks={activePasswordChecks} />
                  <SubmitButton loading={loading} disabled={!strongResetPassword}>
                    Update password
                  </SubmitButton>
                </form>
              )}

              <p className="mt-4 text-center text-[9px] leading-4 text-white/27 sm:mt-5 sm:text-[10px]">
                Secure access powered by your RGVPRIME account. Need help?{" "}
                <a href="mailto:sales@rgvprimellc.com" className="text-white/52 underline decoration-white/20 underline-offset-2 transition hover:text-white">
                  Contact support
                </a>
                .
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function AccessConfirmation({ checked, onChange }) {
  return (
    <div className="rounded-xl border border-red-500/18 bg-red-500/[0.055] p-3 sm:rounded-2xl">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-red-600"
        />
        <span className="text-[11px] leading-[1.5] text-white/57 sm:text-xs">
          I confirm that I am <strong className="text-white">21 or older</strong> and understand that products and information are intended strictly for <strong className="text-white">research use only</strong>.
        </span>
      </label>
      <p className="mt-2 pl-7 text-[9px] leading-4 text-white/31">
        By continuing, you agree to our{" "}
        <a href="/policies#terms" target="_blank" rel="noreferrer" className="text-white/58 underline decoration-white/25 underline-offset-2 hover:text-white">Terms & Conditions</a>
        {" "}and{" "}
        <a href="/policies#privacy" target="_blank" rel="noreferrer" className="text-white/58 underline decoration-white/25 underline-offset-2 hover:text-white">Privacy Policy</a>.
      </p>
    </div>
  );
}

function PasswordRequirements({ checks }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-white/8 bg-white/[0.02] p-2.5 sm:rounded-2xl">
      {checks.map((item) => (
        <span key={item.label} className={`flex items-center gap-1.5 text-[9px] font-bold ${item.valid ? "text-emerald-200" : "text-white/28"}`}>
          <span className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border ${item.valid ? "border-emerald-400/45 bg-emerald-400/15" : "border-white/12"}`}>
            {item.valid && <Check className="h-2.5 w-2.5" strokeWidth={2.5} />}
          </span>
          {item.label}
        </span>
      ))}
    </div>
  );
}

function SubmitButton({ loading, disabled = false, children }) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className="group relative flex min-h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-red-600 px-5 text-[9px] font-black uppercase tracking-[0.16em] text-white shadow-[0_20px_55px_rgba(220,38,38,0.25)] transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-white/8 disabled:text-white/28 disabled:shadow-none sm:min-h-12 sm:rounded-2xl sm:text-[10px]"
    >
      {!disabled && !loading && <span className="pointer-events-none absolute inset-0 -translate-x-full bg-[linear-gradient(115deg,transparent,rgba(255,255,255,0.20),transparent)] transition duration-700 group-hover:translate-x-full" />}
      <span className="relative inline-flex items-center gap-2">
        {loading ? (
          <>
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/25 border-t-white" />
            Please wait
          </>
        ) : (
          <>
            {children}
            <ArrowRight className="h-3.5 w-3.5" />
          </>
        )}
      </span>
    </button>
  );
}
