import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Check, CreditCard, LockKeyhole, ShieldCheck } from "lucide-react";

function base64Url(bytes) {
  let binary = "";
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let index = 0; index < source.length; index += 1) binary += String.fromCharCode(source[index]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemBytes(pem) {
  const clean = String(pem || "")
    .replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, "");
  const binary = atob(clean);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptCard(card, publicKeyPem) {
  if (!window.crypto?.subtle) throw new Error("This browser cannot secure card details. Use an updated browser.");

  const encoder = new TextEncoder();
  const protectedHeader = base64Url(encoder.encode(JSON.stringify({ alg: "RSA-OAEP-256", enc: "A256GCM" })));
  const rsaKey = await window.crypto.subtle.importKey(
    "spki",
    pemBytes(publicKeyPem),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const contentKey = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"],
  );
  const rawContentKey = await window.crypto.subtle.exportKey("raw", contentKey);
  const encryptedKey = await window.crypto.subtle.encrypt({ name: "RSA-OAEP" }, rsaKey, rawContentKey);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(protectedHeader),
      tagLength: 128,
    },
    contentKey,
    encoder.encode(JSON.stringify(card)),
  ));
  const tag = encrypted.slice(encrypted.length - 16);
  const ciphertext = encrypted.slice(0, encrypted.length - 16);

  return [
    protectedHeader,
    base64Url(encryptedKey),
    base64Url(iv),
    base64Url(ciphertext),
    base64Url(tag),
  ].join(".");
}

function passesLuhn(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let total = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    total += digit;
    doubleDigit = !doubleDigit;
  }
  return total % 10 === 0;
}

function normalizeCardNumber(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 19).replace(/(.{4})/g, "$1 ").trim();
}

function normalizeExpiry(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

function validateExpiry(value) {
  const match = String(value || "").match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  const now = new Date();
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) return null;
  return { month: match[1], year: match[2] };
}

function detectCardBrand(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^4/.test(digits)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(digits)) return "mastercard";
  if (/^3[47]/.test(digits)) return "amex";
  return "";
}

const OrbitSecureCardPayment = forwardRef(function OrbitSecureCardPayment(
  { enabled, onCreatePayment, onReadyChange, onInteraction },
  ref,
) {
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState("");
  const [holder, setHolder] = useState("");
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [installments, setInstallments] = useState("1");
  const [agreementsAccepted, setAgreementsAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/checkout/orbit-card-config", {
      cache: "no-store",
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data?.configured !== true) throw new Error(data?.message || "ORBIT is not configured.");
        setConfig(data);
        setConfigError("");
      })
      .catch((error) => {
        if (error?.name !== "AbortError") setConfigError(error?.message || "ORBIT is unavailable.");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    onReadyChange?.(Boolean(config && !configError && !submitting));
  }, [config, configError, onReadyChange, submitting]);

  async function confirm() {
    if (submitting) return { ignored: true };
    if (!enabled) return { error: "Complete the contact, shipping, address confirmation, and required agreements before paying." };
    if (!config) return { error: configError || "ORBIT card payments are still loading." };

    const cleanHolder = holder.trim().replace(/\s+/g, " ");
    const cleanNumber = number.replace(/\D/g, "");
    const cleanExpiry = validateExpiry(expiry);
    const cleanCvc = cvc.replace(/\D/g, "");
    if (cleanHolder.length < 3) return { error: "Enter the cardholder name." };
    if (!passesLuhn(cleanNumber)) return { error: "Enter a valid card number." };
    if (!cleanExpiry) return { error: "Enter a valid future expiration date." };
    if (!/^\d{3,4}$/.test(cleanCvc)) return { error: "Enter a valid security code." };
    if (!agreementsAccepted) return { error: "Accept the ORBIT payment terms before paying." };

    setSubmitting(true);
    setFieldError("");
    try {
      onInteraction?.();
      const payload = await encryptCard({
        number: cleanNumber,
        cvc: cleanCvc,
        exp_month: cleanExpiry.month,
        exp_year: cleanExpiry.year,
        card_holder: cleanHolder,
      }, config.tokenizationPublicKey);
      const tokenResponse = await fetch(`${config.baseUrl}/tokens/cards`, {
        method: "POST",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.publicKey}`,
        },
        body: JSON.stringify({ payload }),
      });
      const tokenData = await tokenResponse.json().catch(() => ({}));
      const cardToken = String(tokenData?.data?.id || "");
      if (!tokenResponse.ok || !/^tok_(?:test|prod)_[A-Za-z0-9_]+$/.test(cardToken)) {
        throw new Error(tokenData?.error?.reason || tokenData?.error?.message || "ORBIT could not secure this card.");
      }

      return await onCreatePayment({
        cardToken,
        installments: Number(installments),
        processorAcceptance: agreementsAccepted,
        processorPersonalAuth: agreementsAccepted,
      });
    } catch (error) {
      const message = error?.message || "The ORBIT card payment could not be completed.";
      setFieldError(message);
      return { error: message };
    } finally {
      setSubmitting(false);
    }
  }

  useImperativeHandle(ref, () => ({ confirm }), [
    agreementsAccepted,
    config,
    configError,
    cvc,
    enabled,
    expiry,
    holder,
    installments,
    number,
    onCreatePayment,
    onInteraction,
    submitting,
  ]);

  const update = (setter) => (event) => {
    setter(event.target.value);
    setFieldError("");
    onInteraction?.();
  };

  const activeBrand = detectCardBrand(number);

  return (
    <section className={`rgvx-orbit-secure-card ${submitting ? "is-submitting" : ""}`} aria-busy={submitting}>
      <header className="rgvx-orbit-secure-card__header">
        <span className="rgvx-orbit-secure-card__shield" aria-hidden="true"><ShieldCheck size={20} /></span>
        <span className="rgvx-orbit-secure-card__heading">
          <small>ORBIT SECURE</small>
          <strong>Enter your card details</strong>
        </span>
        <span className="rgvx-orbit-secure-card__brands" aria-label="Accepted cards">
          <b className={activeBrand === "visa" ? "is-active" : ""}>VISA</b>
          <b className={activeBrand === "mastercard" ? "is-active" : ""}>MC</b>
          <b className={activeBrand === "amex" ? "is-active" : ""}>AMEX</b>
        </span>
      </header>

      <div className="rgvx-orbit-secure-card__divider" />

      <div className="rgvx-orbit-secure-card__fields">
        <label className="rgvx-orbit-secure-card__field">
          <span>Cardholder name</span>
          <span className="rgvx-orbit-secure-card__input-wrap">
            <input value={holder} onChange={update(setHolder)} autoComplete="cc-name" placeholder="Name as shown on card" maxLength={80} />
          </span>
        </label>

        <label className="rgvx-orbit-secure-card__field rgvx-orbit-secure-card__field--number">
          <span>Card number</span>
          <span className="rgvx-orbit-secure-card__input-wrap has-icon">
            <CreditCard size={18} aria-hidden="true" />
            <input value={number} onChange={(event) => { setNumber(normalizeCardNumber(event.target.value)); setFieldError(""); onInteraction?.(); }} autoComplete="cc-number" inputMode="numeric" placeholder="1234 5678 9012 3456" maxLength={23} />
          </span>
        </label>

        <div className="rgvx-orbit-secure-card__row">
          <label className="rgvx-orbit-secure-card__field">
            <span>Expiration</span>
            <span className="rgvx-orbit-secure-card__input-wrap">
              <input value={expiry} onChange={(event) => { setExpiry(normalizeExpiry(event.target.value)); setFieldError(""); onInteraction?.(); }} autoComplete="cc-exp" inputMode="numeric" placeholder="MM / YY" maxLength={5} />
            </span>
          </label>
          <label className="rgvx-orbit-secure-card__field">
            <span>Security code <small title="The 3 or 4 digits printed on your card">?</small></span>
            <span className="rgvx-orbit-secure-card__input-wrap">
              <input value={cvc} onChange={(event) => { setCvc(event.target.value.replace(/\D/g, "").slice(0, 4)); setFieldError(""); onInteraction?.(); }} autoComplete="cc-csc" inputMode="numeric" type="password" placeholder="CVC" maxLength={4} />
            </span>
          </label>
          <label className="rgvx-orbit-secure-card__field">
            <span>Installments</span>
            <span className="rgvx-orbit-secure-card__input-wrap">
              <select value={installments} onChange={update(setInstallments)} aria-label="Number of installments">
                {[1, 2, 3, 6, 9, 12, 18, 24, 36].map((count) => <option key={count} value={count}>{count === 1 ? "1 payment" : `${count} payments`}</option>)}
              </select>
            </span>
          </label>
        </div>
      </div>

      <label className={`rgvx-orbit-secure-card__consent ${agreementsAccepted ? "is-checked" : ""}`}>
        <span className="rgvx-orbit-secure-card__check">
          <input type="checkbox" checked={agreementsAccepted} onChange={(event) => { setAgreementsAccepted(event.target.checked); setFieldError(""); onInteraction?.(); }} />
          <Check size={14} aria-hidden="true" />
        </span>
        <span>I agree to the ORBIT <a href="/policies#terms" target="_blank" rel="noreferrer">payment terms</a> and <a href="/policies#privacy" target="_blank" rel="noreferrer">data authorization</a>.</span>
      </label>

      {configError && <p className="rgvx-orbit-secure-card__error" role="alert">{configError}</p>}
      {fieldError && <p className="rgvx-orbit-secure-card__error" role="alert">{fieldError}</p>}
      <footer className="rgvx-orbit-secure-card__security"><LockKeyhole size={14} aria-hidden="true" /><span>Your card details are encrypted and never stored by RGVPRIME.</span></footer>
      {submitting && <div className="rgvx-orbit-secure-card__loading" role="status"><i /> Securing card and confirming payment...</div>}

      <style>{`
        .rgvx-orbit-secure-card{position:relative;overflow:hidden;display:grid;gap:18px;border:1px solid rgba(255,255,255,.09);border-radius:18px;background:linear-gradient(155deg,#151316 0%,#0c0b0d 62%,#120b0d 100%);padding:22px;box-shadow:0 22px 55px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.035);color:#f8f5f6}.rgvx-orbit-secure-card:before{content:"";position:absolute;right:-90px;top:-110px;width:230px;height:230px;border-radius:50%;background:radial-gradient(circle,rgba(220,38,55,.13),transparent 68%);pointer-events:none}.rgvx-orbit-secure-card.is-submitting>*:not(.rgvx-orbit-secure-card__loading){pointer-events:none;opacity:.42}.rgvx-orbit-secure-card__header{position:relative;display:grid;grid-template-columns:38px minmax(0,1fr) auto;align-items:center;gap:11px}.rgvx-orbit-secure-card__shield{display:grid;place-items:center;width:38px;height:38px;border:1px solid rgba(243,72,91,.24);border-radius:11px;background:linear-gradient(145deg,rgba(226,45,66,.18),rgba(111,22,34,.12));color:#f05a6b}.rgvx-orbit-secure-card__heading{display:grid;gap:2px;min-width:0}.rgvx-orbit-secure-card__heading small{color:#e94c5e;font-size:8px;font-weight:850;letter-spacing:.18em}.rgvx-orbit-secure-card__heading strong{color:#f7f3f4;font-size:13px;font-weight:680;letter-spacing:.01em}.rgvx-orbit-secure-card__brands{display:flex;align-items:center;gap:5px}.rgvx-orbit-secure-card__brands b{display:grid;place-items:center;min-width:32px;height:22px;border:1px solid #373238;border-radius:6px;background:#19171a;padding:0 6px;color:#79737b;font-size:7px;font-weight:900;letter-spacing:.03em;transition:.18s ease}.rgvx-orbit-secure-card__brands b.is-active{border-color:rgba(240,82,100,.45);background:rgba(217,40,60,.13);color:#fff}.rgvx-orbit-secure-card__divider{height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.1) 12%,rgba(255,255,255,.1) 88%,transparent)}.rgvx-orbit-secure-card__fields{display:grid;grid-template-columns:minmax(0,.82fr) minmax(0,1.18fr);gap:14px}.rgvx-orbit-secure-card__field{display:grid;gap:7px;min-width:0}.rgvx-orbit-secure-card__field>span:first-child{color:#bdb6ba;font-size:10px;font-weight:680;letter-spacing:.035em}.rgvx-orbit-secure-card__field>span:first-child small{display:inline-grid;place-items:center;width:13px;height:13px;margin-left:3px;border:1px solid #4a4449;border-radius:50%;color:#8f878c;font-size:8px;cursor:help}.rgvx-orbit-secure-card__field--number{grid-column:auto}.rgvx-orbit-secure-card__input-wrap{position:relative;display:block}.rgvx-orbit-secure-card__input-wrap>svg{position:absolute;z-index:1;left:13px;top:50%;transform:translateY(-50%);color:#777178;pointer-events:none}.rgvx-orbit-secure-card__input-wrap input,.rgvx-orbit-secure-card__input-wrap select{display:block;box-sizing:border-box;width:100%;height:48px;border:1px solid #353136!important;border-radius:11px!important;outline:0!important;background:rgba(5,5,6,.68)!important;color:#fff!important;padding:0 14px!important;font:inherit!important;font-size:12px!important;font-weight:520!important;letter-spacing:.015em;box-shadow:inset 0 1px 0 rgba(255,255,255,.02)!important;transition:border-color .16s ease,box-shadow .16s ease,background .16s ease}.rgvx-orbit-secure-card__input-wrap.has-icon input{padding-left:42px!important}.rgvx-orbit-secure-card__input-wrap input::placeholder{color:#625d62;opacity:1}.rgvx-orbit-secure-card__input-wrap input:focus,.rgvx-orbit-secure-card__input-wrap select:focus{border-color:#dd3d52!important;background:#0c090b!important;box-shadow:0 0 0 3px rgba(221,61,82,.12),inset 0 1px 0 rgba(255,255,255,.025)!important}.rgvx-orbit-secure-card__row{grid-column:1/-1;display:grid;grid-template-columns:.78fr .78fr 1.2fr;gap:12px}.rgvx-orbit-secure-card__consent{display:grid!important;grid-template-columns:20px minmax(0,1fr)!important;align-items:center!important;gap:10px!important;margin:0!important;border:1px solid #2c292d;border-radius:11px;background:rgba(255,255,255,.018);padding:11px 13px!important;color:#999297!important;font-size:9.5px!important;font-weight:520!important;line-height:1.55!important;cursor:pointer;transition:.16s ease}.rgvx-orbit-secure-card__consent:hover,.rgvx-orbit-secure-card__consent.is-checked{border-color:rgba(224,65,84,.3);background:rgba(220,38,55,.045)}.rgvx-orbit-secure-card__check{position:relative;display:grid;place-items:center;width:18px!important;height:18px!important}.rgvx-orbit-secure-card__check input{position:absolute;inset:0;width:18px!important;height:18px!important;margin:0!important;border:1px solid #565057!important;border-radius:5px!important;appearance:none;background:#0d0c0e!important;cursor:pointer}.rgvx-orbit-secure-card__check svg{position:relative;z-index:1;color:white;opacity:0;pointer-events:none}.rgvx-orbit-secure-card__consent.is-checked .rgvx-orbit-secure-card__check input{border-color:#e04255!important;background:linear-gradient(145deg,#e84156,#ae2033)!important}.rgvx-orbit-secure-card__consent.is-checked .rgvx-orbit-secure-card__check svg{opacity:1}.rgvx-orbit-secure-card__consent a{color:#ef7b89!important;text-decoration-color:rgba(239,123,137,.45);text-underline-offset:2px}.rgvx-orbit-secure-card__error{margin:0;border:1px solid rgba(239,67,80,.35);border-radius:10px;background:rgba(216,33,50,.1);padding:10px 12px;color:#ffd4d7;font-size:10px;font-weight:600}.rgvx-orbit-secure-card__security{display:flex;align-items:center;justify-content:center;gap:7px;color:#706a70;font-size:9px;letter-spacing:.025em}.rgvx-orbit-secure-card__security svg{color:#8a8389}.rgvx-orbit-secure-card__loading{position:absolute;z-index:4;inset:0;display:flex;align-items:center;justify-content:center;gap:9px;background:rgba(10,8,9,.88);backdrop-filter:blur(5px);color:#f4e9eb;font-size:11px;font-weight:650}.rgvx-orbit-secure-card__loading i{width:14px;height:14px;border:2px solid rgba(255,255,255,.16);border-top-color:#e8495e;border-radius:50%;animation:rgvx-orbit-secure-spin .7s linear infinite}@keyframes rgvx-orbit-secure-spin{to{transform:rotate(360deg)}}@media(max-width:700px){.rgvx-orbit-secure-card{padding:17px}.rgvx-orbit-secure-card__fields{grid-template-columns:1fr}.rgvx-orbit-secure-card__row{grid-template-columns:1fr 1fr}.rgvx-orbit-secure-card__row .rgvx-orbit-secure-card__field:last-child{grid-column:1/-1}.rgvx-orbit-secure-card__brands b{min-width:29px;padding:0 4px}.rgvx-orbit-secure-card__field--number{grid-column:auto}}@media(max-width:420px){.rgvx-orbit-secure-card__header{grid-template-columns:36px minmax(0,1fr)}.rgvx-orbit-secure-card__brands{grid-column:1/-1;padding-left:47px}.rgvx-orbit-secure-card__row{grid-template-columns:1fr 1fr}.rgvx-orbit-secure-card__consent{align-items:start!important}}
      `}</style>
    </section>
  );
});

export default OrbitSecureCardPayment;
