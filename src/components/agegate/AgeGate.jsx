import { useEffect, useMemo, useRef, useState } from "react";
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
import "./AgeGate.css";

const PUBLIC_PATHS = ["/policies"];
const GOOGLE_CLIENT_ID = String(
  import.meta.env.PUBLIC_GOOGLE_CLIENT_ID || "",
).trim();
const TURNSTILE_SITE_KEY = String(
  import.meta.env.PUBLIC_TURNSTILE_SITE_KEY || "",
).trim();

function loadExternalScript({ id, src }) {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Browser scripts are unavailable."));
  }

  const existing = document.getElementById(id);

  if (existing?.dataset.loaded === "true") {
    return Promise.resolve();
  }

  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.defer = true;
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true },
    );
    script.addEventListener("error", reject, { once: true });
    document.head.appendChild(script);
  });
}

function isPublicPath() {
  if (typeof window === "undefined") return false;

  return PUBLIC_PATHS.some(
    (path) =>
      window.location.pathname === path ||
      window.location.pathname.startsWith(`${path}/`),
  );
}

function resetPageScrollPosition() {
  if (typeof window === "undefined") return;

  const root = document.documentElement;
  const previousScrollBehavior = root.style.scrollBehavior;

  root.style.scrollBehavior = "auto";
  window.scrollTo(0, 0);
  root.scrollTop = 0;
  document.body.scrollTop = 0;
  root.style.scrollBehavior = previousScrollBehavior;
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
    <label className="rgv-gate-field">
      <span className="rgv-gate-field__label">{label}</span>
      <span className="rgv-gate-field__control">
        <Icon
          className="rgv-gate-field__icon"
          strokeWidth={1.8}
          aria-hidden="true"
        />
        <input
          {...props}
          className="rgv-gate-field__input"
        />
      </span>
    </label>
  );
}

function PasswordField({ label, value, onChange, autoComplete, placeholder }) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="rgv-gate-field">
      <span className="rgv-gate-field__label">{label}</span>
      <span className="rgv-gate-field__control">
        <LockKeyhole
          className="rgv-gate-field__icon"
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
          className="rgv-gate-field__input rgv-gate-field__input--password"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="rgv-gate-field__reveal"
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
      className={`rgv-gate-status rgv-gate-status--${type}`}
    >
      {children}
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
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [researchUseAcknowledged, setResearchUseAcknowledged] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileFailed, setTurnstileFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const gateWasVisibleRef = useRef(false);
  const resetTurnstileRef = useRef(() => {});

  const checks = useMemo(() => passwordChecks(password), [password]);
  const resetChecks = useMemo(() => passwordChecks(resetPassword), [resetPassword]);
  const strongPassword = checks.every((item) => item.valid);
  const strongResetPassword = resetChecks.every((item) => item.valid);
  const confirmationsComplete =
    ageConfirmed && researchUseAcknowledged && termsAccepted;
  const botReady = !TURNSTILE_SITE_KEY || Boolean(turnstileToken);

  useEffect(() => {
    if (isPublicPath()) {
      setStatus("authenticated");
      return undefined;
    }

    const params = new URLSearchParams(window.location.search);
    const nextMode = params.get("mode");
    const key = params.get("key") || "";
    const resetLogin = params.get("login") || "";

    if (params.get("next") === "/checkout") {
      setNotice("Please sign in to continue to checkout. Your cart is still saved.");
    }

    if (nextMode === "reset" && key && resetLogin) {
      setResetParams({ key, login: resetLogin });
      setMode("reset");
    } else if (nextMode === "register" || nextMode === "forgot") {
      setMode(nextMode);
    }

    let active = true;

    async function verifySession() {
      const [result, complianceResponse] = await Promise.all([
        getMeOnce({ force: true }),
        fetch("/api/compliance/session", { credentials: "same-origin", cache: "no-store" }).catch(() => null),
      ]);
      const compliance = await complianceResponse?.json().catch(() => null);
      const authenticated = Boolean(
        result?.ok && result?.data?.success && result?.data?.user &&
        complianceResponse?.ok && compliance?.approved === true,
      );

      if (active) {
        setStatus(authenticated ? "authenticated" : "locked");
      }
    }

    function keepSiteOpenAfterLogout() {
      resetMeCache();
      setAgeConfirmed(false);
      setResearchUseAcknowledged(false);
      setTermsAccepted(false);
      setStatus("locked");
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
    window.addEventListener("rgv-compliance-required", keepSiteOpenAfterLogout);
    window.addEventListener("storage", handleStorage);

    return () => {
      active = false;
      window.removeEventListener("rgv-account-login", verifySession);
      window.removeEventListener("rgv-account-logout", keepSiteOpenAfterLogout);
      window.removeEventListener("rgv-compliance-required", keepSiteOpenAfterLogout);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    if (status !== "locked") return undefined;

    gateWasVisibleRef.current = true;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    resetPageScrollPosition();
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(resetPageScrollPosition);

    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated" || !gateWasVisibleRef.current) {
      return undefined;
    }

    gateWasVisibleRef.current = false;
    resetPageScrollPosition();

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      resetPageScrollPosition();
      secondFrame = window.requestAnimationFrame(resetPageScrollPosition);
    });
    const settleTimer = window.setTimeout(resetPageScrollPosition, 120);

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(settleTimer);
    };
  }, [status]);

  function changeMode(nextMode) {
    setMode(nextMode);
    setError("");
    setNotice("");
  }

  async function submit(endpoint, payload) {
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setError("Please wait for the security check and try again.");
      return null;
    }

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
        body: JSON.stringify({
          ...payload,
          turnstileToken,
        }),
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
      setTurnstileToken("");
      resetTurnstileRef.current();
    }
  }

  function openAuthenticatedSession(data) {
    resetMeCache();

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
          pagePath: window.location.pathname,
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

    if (!ageConfirmed || !researchUseAcknowledged || !termsAccepted) {
      setError("Please complete all three required confirmations to continue.");
      return;
    }

    const data = await submit("/api/account/login", {
      login,
      password,
      ageConfirmed,
      researchUseAcknowledged,
      termsAccepted,
    });
    if (data?.success) openAuthenticatedSession(data);
  }

  async function handleGoogleCredential(credential) {
    if (!confirmationsComplete) {
      setError("Please complete all three required confirmations to continue.");
      return;
    }

    const data = await submit("/api/account/google", {
      credential,
      ageConfirmed,
      researchUseAcknowledged,
      termsAccepted,
    });

    if (data?.success) openAuthenticatedSession(data);
  }

  async function handleRegister(event) {
    event.preventDefault();

    if (!ageConfirmed || !researchUseAcknowledged || !termsAccepted) {
      setError("Please complete all three required confirmations to continue.");
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
      ageConfirmed,
      researchUseAcknowledged,
      termsAccepted,
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

  if (status === "checking") return null;
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
      className="rgv-gate"
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
      <div className="rgv-gate__atmosphere" aria-hidden="true">
        <span className="rgv-gate__ambient" />
        <svg className="rgv-gate__ribbon" viewBox="0 0 1200 900" width="1200" height="900" fill="none" focusable="false">
          <defs>
            <linearGradient id="rgv-gate-surface" x1="690" y1="50" x2="1070" y2="850" gradientUnits="userSpaceOnUse">
              <stop stopColor="#140609" />
              <stop offset=".22" stopColor="#61101a" />
              <stop offset=".38" stopColor="#a8212a" />
              <stop offset=".49" stopColor="#36090f" />
              <stop offset=".68" stopColor="#831520" />
              <stop offset="1" stopColor="#090a0c" />
            </linearGradient>
            <linearGradient id="rgv-gate-fold" x1="585" y1="400" x2="1030" y2="600" gradientUnits="userSpaceOnUse">
              <stop stopColor="#22070c" />
              <stop offset=".4" stopColor="#8f1a25" />
              <stop offset=".7" stopColor="#4a0c15" />
              <stop offset="1" stopColor="#100609" />
            </linearGradient>
            <linearGradient id="rgv-gate-edge" x1="750" y1="100" x2="915" y2="860" gradientUnits="userSpaceOnUse">
              <stop stopColor="#9c252d" stopOpacity="0" />
              <stop offset=".38" stopColor="#d35b50" stopOpacity=".58" />
              <stop offset=".75" stopColor="#bd3938" stopOpacity=".45" />
              <stop offset="1" stopColor="#9c252d" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M1085-90C1050 92 1094 164 895 277C713 380 522 391 561 516C608 666 929 649 1082 823L1165 965H1290C1233 731 1063 623 862 568C682 519 741 438 957 355C1171 273 1177 97 1249-90Z" fill="url(#rgv-gate-surface)" />
          <path d="M561 516C595 625 923 617 1082 823C966 694 778 705 650 638C548 584 510 460 661 402C583 444 543 467 561 516Z" fill="url(#rgv-gate-fold)" />
          <path d="M1085-90C1050 92 1094 164 895 277C713 380 522 391 561 516C608 666 929 649 1082 823" stroke="url(#rgv-gate-edge)" strokeWidth="1.3" />
        </svg>
      </div>

      <div className="rgv-gate__stage">
        <div className="rgv-gate__panel">
          <section className="rgv-gate__editorial">
            <div className="rgv-gate__editorial-top">
              <img src="/logo.webp" alt="RGVPRIME" className="rgv-gate__logo rgv-gate__logo--desktop" />
              <p className="rgv-gate__eyebrow"><span /> Private catalog access</p>
              <h1 id="rgv-access-title" className="rgv-gate__title">
                Research<br /><span>in detail.</span>
              </h1>
              <p className="rgv-gate__lead">
                Sign in or create an account to access the catalog, laboratory documentation and private customer tools.
              </p>
            </div>

            <div className="rgv-gate__assurances">
              {[
                [ShieldCheck, "21+ access", "Age-restricted entry"],
                [FlaskConical, "Research use", "Clear use requirements"],
                [LockKeyhole, "Private account", "Secure customer session"],
              ].map(([Icon, title, description], index) => (
                <div key={title} className="rgv-gate__assurance">
                  <span className="rgv-gate__assurance-number">0{index + 1}</span>
                  <Icon aria-hidden="true" />
                  <span className="rgv-gate__assurance-copy">
                    <strong>{title}</strong>
                    <small>{description}</small>
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rgv-gate__form-panel">
            <div className="rgv-gate__form-wrap">
              <div className="rgv-gate__mobile-masthead">
                <img src="/logo.webp" alt="RGVPRIME" className="rgv-gate__logo" />
                <span className="rgv-gate__access-mark">
                  <ShieldCheck aria-hidden="true" />
                  21+ Access
                </span>
              </div>

              {isAccessMode && (
                <div className="rgv-gate__tabs">
                  <button
                    type="button"
                    onClick={() => changeMode("login")}
                    className={mode === "login" ? "is-active" : ""}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    onClick={() => changeMode("register")}
                    className={mode === "register" ? "is-active" : ""}
                  >
                    Create account
                  </button>
                </div>
              )}

              <div className="rgv-gate__form-heading">
                <p>
                  {mode === "register" ? "New member" : mode === "forgot" || mode === "reset" ? "Secure recovery" : "Member portal"}
                </p>
                <h2>{formTitle}</h2>
                <span>{formSubtitle}</span>
              </div>

              <div className="rgv-gate__messages">
                <StatusMessage type="error">
                  {error ||
                    (turnstileFailed
                      ? "The security check could not load. Please refresh and try again."
                      : "")}
                </StatusMessage>
                <StatusMessage type="success">{notice}</StatusMessage>
              </div>

              <BotChallenge
                siteKey={TURNSTILE_SITE_KEY}
                onToken={(token) => {
                  setTurnstileToken(token);
                  setTurnstileFailed(false);
                }}
                onError={() => {
                  setTurnstileToken("");
                  setTurnstileFailed(true);
                }}
                registerReset={(reset) => {
                  resetTurnstileRef.current = reset;
                }}
              />

              {isAccessMode && (
                <div className="rgv-gate__access-options">
                  <AccessConfirmation
                    ageConfirmed={ageConfirmed}
                    researchUseAcknowledged={researchUseAcknowledged}
                    termsAccepted={termsAccepted}
                    onAgeChange={setAgeConfirmed}
                    onResearchUseChange={setResearchUseAcknowledged}
                    onTermsChange={setTermsAccepted}
                  />

                  {GOOGLE_CLIENT_ID && (
                    <>
                      <GoogleSignInButton
                        clientId={GOOGLE_CLIENT_ID}
                        enabled={confirmationsComplete && botReady && !loading}
                        pendingMessage={
                          loading
                            ? "Signing you in securely…"
                            : confirmationsComplete
                              ? "Completing the security check…"
                              : "Complete the required confirmations to continue."
                        }
                        onCredential={handleGoogleCredential}
                        onError={() =>
                          setError(
                            "Google sign-in could not load. Please use email and password or try again.",
                          )
                        }
                      />
                      <div className="rgv-gate__divider" aria-hidden="true">
                        <span>or continue with email</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {mode === "login" && (
                <form onSubmit={handleLogin} className="rgv-gate__form">
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
                  <div className="rgv-gate__form-link-row">
                    <button type="button" onClick={() => changeMode("forgot")} className="rgv-gate__text-button">
                      Forgot password?
                    </button>
                  </div>

                  <SubmitButton loading={loading} disabled={!confirmationsComplete || !botReady}>
                    Sign in & enter
                  </SubmitButton>
                </form>
              )}

              {mode === "register" && (
                <form onSubmit={handleRegister} className="rgv-gate__form">
                  <div className="rgv-gate__name-grid">
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

                  <label className="rgv-gate__marketing">
                    <input
                      type="checkbox"
                      checked={marketingOptIn}
                      onChange={(event) => setMarketingOptIn(event.target.checked)}
                      className="rgv-gate__checkbox"
                    />
                    <span>
                      <strong>Send me the one-time 10% first-order offer</strong> and occasional product news by email. Optional; unsubscribe anytime.
                    </span>
                  </label>

                  <SubmitButton loading={loading} disabled={!confirmationsComplete || !strongPassword || !botReady}>
                    Create account & enter
                  </SubmitButton>
                </form>
              )}

              {mode === "forgot" && (
                <form onSubmit={handleForgot} className="rgv-gate__form">
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
                  <SubmitButton loading={loading} disabled={!botReady}>Send secure link</SubmitButton>
                  <button type="button" onClick={() => changeMode("login")} className="rgv-gate__secondary-button">
                    Back to sign in
                  </button>
                </form>
              )}

              {mode === "reset" && (
                <form onSubmit={handleReset} className="rgv-gate__form">
                  <PasswordField
                    label="New password"
                    value={resetPassword}
                    onChange={setResetPassword}
                    autoComplete="new-password"
                    placeholder="Build a secure password"
                  />
                  <PasswordRequirements checks={activePasswordChecks} />
                  <SubmitButton loading={loading} disabled={!strongResetPassword || !botReady}>
                    Update password
                  </SubmitButton>
                </form>
              )}

              <p className="rgv-gate__support">
                Secure access powered by your RGVPRIME account. Need help?{" "}
                <a href="mailto:sales@rgvprimellc.com">
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

function BotChallenge({ siteKey, onToken, onError, registerReset }) {
  const containerRef = useRef(null);
  const onTokenRef = useRef(onToken);
  const onErrorRef = useRef(onError);
  const registerResetRef = useRef(registerReset);

  onTokenRef.current = onToken;
  onErrorRef.current = onError;
  registerResetRef.current = registerReset;

  useEffect(() => {
    if (!siteKey) return undefined;

    let active = true;
    let widgetId = null;

    const ready = window.turnstile
      ? Promise.resolve()
      : loadExternalScript({
          id: "rgv-turnstile-script",
          src: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
        });

    ready
      .then(() => {
        if (!active || !containerRef.current || !window.turnstile) return;

        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: "dark",
          size: "flexible",
          appearance: "interaction-only",
          action: "account_access",
          callback: (token) => onTokenRef.current(String(token || "")),
          "expired-callback": () => onTokenRef.current(""),
          "timeout-callback": () => onTokenRef.current(""),
          "error-callback": () => {
            onTokenRef.current("");
            onErrorRef.current();
          },
          "refresh-expired": "auto",
          "refresh-timeout": "auto",
        });

        registerResetRef.current(() => {
          onTokenRef.current("");

          if (widgetId !== null && window.turnstile) {
            window.turnstile.reset(widgetId);
          }
        });
      })
      .catch(() => {
        if (active) onErrorRef.current();
      });

    return () => {
      active = false;
      registerResetRef.current(() => {});

      if (widgetId !== null && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
    };
  }, [siteKey]);

  if (!siteKey) return null;

  return (
    <div
      ref={containerRef}
      className="rgv-gate__turnstile"
      aria-label="Automated traffic security check"
    />
  );
}

function GoogleSignInButton({
  clientId,
  enabled,
  pendingMessage,
  onCredential,
  onError,
}) {
  const containerRef = useRef(null);
  const onCredentialRef = useRef(onCredential);
  const onErrorRef = useRef(onError);

  onCredentialRef.current = onCredential;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!clientId || !enabled) {
      if (containerRef.current) {
        containerRef.current.replaceChildren();
      }

      return undefined;
    }

    let active = true;
    const ready = window.google?.accounts?.id
      ? Promise.resolve()
      : loadExternalScript({
          id: "rgv-google-identity-script",
          src: "https://accounts.google.com/gsi/client",
        });

    ready
      .then(() => {
        if (
          !active ||
          !containerRef.current ||
          !window.google?.accounts?.id
        ) {
          return;
        }

        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            const credential = String(response?.credential || "");

            if (!credential) {
              onErrorRef.current();
              return;
            }

            onCredentialRef.current(credential);
          },
          ux_mode: "popup",
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        containerRef.current.replaceChildren();
        window.google.accounts.id.renderButton(containerRef.current, {
          type: "standard",
          theme: "filled_black",
          size: "large",
          text: "continue_with",
          shape: "pill",
          logo_alignment: "left",
          width: Math.min(340, containerRef.current.clientWidth || 340),
        });
      })
      .catch(() => {
        if (active) onErrorRef.current();
      });

    return () => {
      active = false;

      if (containerRef.current) {
        containerRef.current.replaceChildren();
      }
    };
  }, [clientId, enabled]);

  if (!enabled) {
    return (
      <div className="rgv-gate-google rgv-gate-google--pending">
        <div className="rgv-gate-google__prompt" role="status">
          <span className="rgv-gate-google__prompt-dot" aria-hidden="true" />
          <span>
            <strong>Google sign-in</strong>
            {pendingMessage}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="rgv-gate-google">
      <div className="rgv-gate-google__button">
        <div ref={containerRef} />
      </div>
    </div>
  );
}

function AccessConfirmation({
  ageConfirmed,
  researchUseAcknowledged,
  termsAccepted,
  onAgeChange,
  onResearchUseChange,
  onTermsChange,
}) {
  return (
    <div className="rgv-gate-confirmations">
      <RequiredConfirmation checked={ageConfirmed} onChange={onAgeChange}>
        I certify that I am <strong>21 years of age or older</strong>. Users under 21 may not access or order from this site.
      </RequiredConfirmation>
      <RequiredConfirmation checked={researchUseAcknowledged} onChange={onResearchUseChange}>
        I accept the <a href="/policies#research-use" target="_blank" rel="noreferrer">Research Use Only policy</a>. Products are not for human or animal use.
      </RequiredConfirmation>
      <RequiredConfirmation checked={termsAccepted} onChange={onTermsChange}>
        I separately accept the <a href="/policies#terms" target="_blank" rel="noreferrer">Terms &amp; Conditions</a>.
      </RequiredConfirmation>
    </div>
  );
}

function RequiredConfirmation({ checked, onChange, children }) {
  return (
    <label className="rgv-gate-confirmation">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="rgv-gate__checkbox"
      />
      <span>{children}</span>
    </label>
  );
}

function PasswordRequirements({ checks }) {
  return (
    <div className="rgv-gate-password-rules">
      {checks.map((item) => (
        <span key={item.label} className={item.valid ? "is-valid" : ""}>
          <span className="rgv-gate-password-rules__mark">
            {item.valid && <Check strokeWidth={2.5} />}
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
      className="rgv-gate__submit"
    >
      <span>
        {loading ? (
          <>
            <span className="rgv-gate__spinner" />
            Please wait
          </>
        ) : (
          <>
            {children}
            <ArrowRight aria-hidden="true" />
          </>
        )}
      </span>
    </button>
  );
}
