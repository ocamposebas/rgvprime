import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

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

const OrbitSecureCardPayment = forwardRef(function OrbitSecureCardPayment(
  { enabled, totalUsd, onCreatePayment, onReadyChange, onInteraction },
  ref,
) {
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState("");
  const [holder, setHolder] = useState("");
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [installments, setInstallments] = useState("1");
  const [acceptance, setAcceptance] = useState(false);
  const [personalAuth, setPersonalAuth] = useState(false);
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
    if (!acceptance || !personalAuth) return { error: "Accept both ORBIT agreements before paying." };

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
        processorAcceptance: acceptance,
        processorPersonalAuth: personalAuth,
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
    acceptance,
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
    personalAuth,
    submitting,
    totalUsd,
  ]);

  const update = (setter) => (event) => {
    setter(event.target.value);
    setFieldError("");
    onInteraction?.();
  };

  return (
    <section className={`rgvx-orbit-secure-card ${submitting ? "is-submitting" : ""}`} aria-busy={submitting}>
      <div className="rgvx-orbit-secure-card__brands" aria-label="Accepted cards">
        <strong>Secure card payment</strong>
        <span>VISA</span><span>Mastercard</span><span>AMEX</span>
      </div>

      <label>
        <span>Name on card</span>
        <input value={holder} onChange={update(setHolder)} autoComplete="cc-name" placeholder="Name as shown on card" maxLength={80} />
      </label>
      <label>
        <span>Card number</span>
        <input value={number} onChange={(event) => { setNumber(normalizeCardNumber(event.target.value)); setFieldError(""); onInteraction?.(); }} autoComplete="cc-number" inputMode="numeric" placeholder="1234 5678 9012 3456" maxLength={23} />
      </label>

      <div className="rgvx-orbit-secure-card__row">
        <label>
          <span>Expiration</span>
          <input value={expiry} onChange={(event) => { setExpiry(normalizeExpiry(event.target.value)); setFieldError(""); onInteraction?.(); }} autoComplete="cc-exp" inputMode="numeric" placeholder="MM/YY" maxLength={5} />
        </label>
        <label>
          <span>Security code</span>
          <input value={cvc} onChange={(event) => { setCvc(event.target.value.replace(/\D/g, "").slice(0, 4)); setFieldError(""); onInteraction?.(); }} autoComplete="cc-csc" inputMode="numeric" type="password" placeholder="CVC" maxLength={4} />
        </label>
        <label>
          <span>Installments</span>
          <select value={installments} onChange={update(setInstallments)}>
            {[1, 2, 3, 6, 9, 12, 18, 24, 36].map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
      </div>

      {config?.contracts && (
        <div className="rgvx-orbit-secure-card__agreements">
          <label><input type="checkbox" checked={acceptance} onChange={(event) => { setAcceptance(event.target.checked); setFieldError(""); }} /> <span>I accept ORBIT&apos;s <a href={config.contracts.acceptanceUrl} target="_blank" rel="noreferrer">end-user terms</a>.</span></label>
          <label><input type="checkbox" checked={personalAuth} onChange={(event) => { setPersonalAuth(event.target.checked); setFieldError(""); }} /> <span>I authorize ORBIT&apos;s <a href={config.contracts.personalAuthUrl} target="_blank" rel="noreferrer">personal-data processing</a>.</span></label>
        </div>
      )}

      {configError && <p className="rgvx-orbit-secure-card__error" role="alert">{configError}</p>}
      {fieldError && <p className="rgvx-orbit-secure-card__error" role="alert">{fieldError}</p>}
      <p className="rgvx-orbit-secure-card__powered">Encrypted card tokenization powered by ORBIT</p>
      {submitting && <div className="rgvx-orbit-secure-card__loading" role="status"><i /> Securing card and confirming payment...</div>}

      <style>{`
        .rgvx-orbit-secure-card{position:relative;display:grid;gap:13px;border:1px solid #2f292b;border-radius:14px;background:#0d0c0d;padding:16px;color:#f8f5f6}.rgvx-orbit-secure-card.is-submitting>*:not(.rgvx-orbit-secure-card__loading){pointer-events:none;opacity:.48}.rgvx-orbit-secure-card__brands{display:flex;align-items:center;gap:7px}.rgvx-orbit-secure-card__brands strong{margin-right:auto;font-size:12px}.rgvx-orbit-secure-card__brands span{border:1px solid #393235;border-radius:5px;background:#171416;padding:4px 6px;color:#c9c2c5;font-size:7px;font-weight:900}.rgvx-orbit-secure-card>label,.rgvx-orbit-secure-card__row label{display:grid;gap:6px}.rgvx-orbit-secure-card label>span{color:#d8cfd2;font-size:10px;font-weight:650}.rgvx-orbit-secure-card input,.rgvx-orbit-secure-card select{width:100%;height:44px;border:1px solid #302b2e;border-radius:9px;outline:0;background:#111;color:#fff;padding:0 12px;font:inherit;font-size:13px;transition:border-color .16s ease,box-shadow .16s ease}.rgvx-orbit-secure-card input:focus,.rgvx-orbit-secure-card select:focus{border-color:#e13a48;box-shadow:0 0 0 3px rgba(225,58,72,.12)}.rgvx-orbit-secure-card__row{display:grid;grid-template-columns:1fr 1fr 1.15fr;gap:10px}.rgvx-orbit-secure-card__conversion{margin:0;border:1px solid rgba(99,102,241,.18);border-radius:9px;background:rgba(99,102,241,.06);padding:9px 11px;color:#aaa4b8;font-size:9px;line-height:1.5}.rgvx-orbit-secure-card__conversion strong{color:#ded9e7}.rgvx-orbit-secure-card__agreements{display:grid;gap:8px}.rgvx-orbit-secure-card__agreements label{display:flex;align-items:flex-start;gap:8px;color:#aaa1a4;font-size:9px;line-height:1.45}.rgvx-orbit-secure-card__agreements input{width:14px;height:14px;flex:0 0 auto;margin-top:1px;accent-color:#dc2637}.rgvx-orbit-secure-card__agreements a{color:#f08089;text-decoration:underline}.rgvx-orbit-secure-card__error{margin:0;border:1px solid rgba(239,67,80,.35);border-radius:9px;background:rgba(216,33,50,.1);padding:9px 11px;color:#ffd4d7;font-size:10px;font-weight:600}.rgvx-orbit-secure-card__powered{margin:0;color:#77717a;font-size:9px;letter-spacing:.07em;text-align:center}.rgvx-orbit-secure-card__loading{display:flex;align-items:center;justify-content:center;gap:9px;min-height:42px;border:1px solid rgba(225,58,72,.18);border-radius:11px;background:#171113;color:#f4e9eb;font-size:11px;font-weight:650}.rgvx-orbit-secure-card__loading i{width:13px;height:13px;border:2px solid rgba(255,255,255,.16);border-top-color:#e13a48;border-radius:50%;animation:rgvx-orbit-secure-spin .7s linear infinite}@keyframes rgvx-orbit-secure-spin{to{transform:rotate(360deg)}}@media(max-width:560px){.rgvx-orbit-secure-card{padding:13px}.rgvx-orbit-secure-card__brands span{display:none}.rgvx-orbit-secure-card__row{grid-template-columns:1fr 1fr}.rgvx-orbit-secure-card__row label:last-child{grid-column:1/-1}}
      `}</style>
    </section>
  );
});

export default OrbitSecureCardPayment;
