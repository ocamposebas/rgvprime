import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Elements, ExpressCheckoutElement, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

const stripeClients = new Map();
const PAYMENT_METHOD_CONFIGURATION_ID = String(
  import.meta.env.PUBLIC_STRIPE_PAYMENT_METHOD_CONFIGURATION_ID || "pmc_1U73G7Il4GfQ7wyOLVk9cYHV",
).trim();
const appearance = {
  theme: "stripe",
  inputs: "spaced",
  labels: "above",
  variables: {
    colorPrimary: "#b91c34",
    colorBackground: "#ffffff",
    colorText: "#281c20",
    colorDanger: "#b91c34",
    colorTextSecondary: "#74686b",
    colorTextPlaceholder: "#aaa0a3",
    fontFamily: 'Inter, "Helvetica Neue", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSizeBase: "14px",
    borderRadius: "9px",
    spacingUnit: "4px",
    focusBoxShadow: "0 0 0 3px rgba(185, 28, 52, 0.10)",
    focusOutline: "none",
  },
  rules: {
    ".Input": { backgroundColor: "#ffffff", border: "1px solid #ddd3d6", boxShadow: "0 1px 2px rgba(48,24,30,.035)", padding: "12px" },
    ".Input:hover": { borderColor: "#bfaeb3" },
    ".Input:focus": { borderColor: "#b91c34", boxShadow: "0 0 0 3px rgba(185,28,52,.10)" },
    ".Input--invalid": { borderColor: "#b91c34", boxShadow: "0 0 0 3px rgba(185,28,52,.08)" },
    ".Label": { color: "#584b4f", fontSize: "11px", fontWeight: "600" },
    ".Label--invalid, .Error": { color: "#a51d33" },
    ".Tab, .AccordionItem": { backgroundColor: "#ffffff", border: "1px solid #ded4d7", boxShadow: "none" },
    ".Tab:hover": { color: "#281c20", borderColor: "#d5aeb6" },
    ".Tab:focus": { boxShadow: "0 0 0 3px rgba(185,28,52,.10)" },
    ".Tab--selected": { backgroundColor: "#fff0f3", borderColor: "#b91c34", boxShadow: "none" },
    ".TabLabel": { fontWeight: "600" },
    ".TermsText": { color: "#827579", fontSize: "11px" },
    ".Link, .TermsLink": { color: "#94182c" },
  },
};

function getStripeClient(key, account) {
  const cacheKey = `${key}:${account}`;
  if (!stripeClients.has(cacheKey)) stripeClients.set(cacheKey, loadStripe(key, { stripeAccount: account }));
  return stripeClients.get(cacheKey);
}

function hasExpressMethods(methods) {
  return Boolean(methods) && Object.values(methods).some((value) => typeof value === "boolean" ? value : Boolean(value?.available));
}

function getExpressAvailability(methods) {
  const isAvailable = (method) => {
    const value = methods?.[method];
    return typeof value === "boolean" ? value : Boolean(value?.available);
  };

  return {
    applePayAvailable: isAvailable("applePay"),
    googlePayAvailable: isAvailable("googlePay"),
    linkAvailable: isAvailable("link"),
    paypalAvailable: isAvailable("paypal"),
    amazonPayAvailable: isAvailable("amazonPay"),
    klarnaAvailable: isAvailable("klarna"),
  };
}

function getWalletBrowserDiagnostics() {
  if (typeof window === "undefined") return {};

  const applePaySession = window.ApplePaySession;
  let applePayCanMakePayments = null;
  try {
    applePayCanMakePayments = typeof applePaySession?.canMakePayments === "function"
      ? applePaySession.canMakePayments()
      : null;
  } catch {
    applePayCanMakePayments = false;
  }

  const permissionsPolicy = document.permissionsPolicy || document.featurePolicy;
  let paymentPolicyAllowed = null;
  try {
    paymentPolicyAllowed = typeof permissionsPolicy?.allowsFeature === "function"
      ? permissionsPolicy.allowsFeature("payment")
      : null;
  } catch {
    paymentPolicyAllowed = false;
  }

  return {
    secureContext: window.isSecureContext,
    topLevel: window.top === window.self,
    applePaySessionPresent: Boolean(applePaySession),
    applePayCanMakePayments,
    paymentPolicyAllowed,
    userAgent: window.navigator.userAgent,
  };
}

async function completePayment({ stripe, elements, context, onCreatePayment }) {
  const submitted = await elements.submit();
  if (submitted.error) throw new Error(submitted.error.message || "Check your payment details and try again.");

  const returnUrl = new URL("/checkout", window.location.origin);
  returnUrl.searchParams.set("orbit_card_return", "1");
  const { confirmationToken, error: tokenError } = await stripe.createConfirmationToken({
    elements,
    params: {
      return_url: returnUrl.toString(),
      payment_method_data: {
        billing_details: {
          name: context.customerName,
          email: context.customerEmail,
          phone: context.customerPhone,
          address: context.billingAddress,
        },
      },
      shipping: { name: context.customerName, phone: context.customerPhone, address: context.billingAddress },
    },
  });
  if (tokenError || !confirmationToken) throw new Error(tokenError?.message || "Unable to secure the payment details.");

  const checkout = await onCreatePayment(confirmationToken.id);
  if (!checkout?.clientSecret) {
    throw new Error("The secure payment service could not prepare your payment. Please try again.");
  }
  const result = await stripe.confirmPayment({
    clientSecret: checkout.clientSecret,
    confirmParams: {
      confirmation_token: confirmationToken.id,
      return_url: returnUrl.toString(),
    },
    redirect: "if_required",
  });

  if (result.paymentIntent) return { paymentIntent: result.paymentIntent, checkout };

  const latest = await stripe.retrievePaymentIntent(checkout.clientSecret);
  if (latest.paymentIntent && ["succeeded", "processing"].includes(latest.paymentIntent.status)) {
    return { paymentIntent: latest.paymentIntent, checkout };
  }

  if (result.error) throw new Error(result.error.message || "Payment authentication was not completed.");
  if (latest.error) throw new Error(latest.error.message || "Unable to verify the payment status.");
  return { paymentIntent: latest.paymentIntent, checkout };
}

const CardPaymentForm = forwardRef(function CardPaymentForm({ context, enabled, onCreatePayment, onPaymentResult, onReadyChange, submitting, setSubmitting, submittingRef }, ref) {
  const stripe = useStripe();
  const elements = useElements();
  const [paymentReady, setPaymentReady] = useState(false);
  const returnCheckedRef = useRef(false);

  useEffect(() => onReadyChange(Boolean(stripe && elements && paymentReady && !submitting)), [stripe, elements, paymentReady, submitting, onReadyChange]);

  useEffect(() => {
    if (!context.isReturn || !stripe || returnCheckedRef.current) return;
    returnCheckedRef.current = true;
    stripe.retrievePaymentIntent(context.clientSecret).then(({ paymentIntent, error }) => onPaymentResult(error ? { error: error.message } : { paymentIntent, checkout: context }));
  }, [context, onPaymentResult, stripe]);

  const runPayment = useCallback(async () => {
    if (submittingRef.current) return { ignored: true };
    if (!enabled || !stripe || !elements || !paymentReady) return { error: "Complete the contact, shipping, and policy details before paying." };
    submittingRef.current = true;
    setSubmitting(true);
    try {
      return await completePayment({ stripe, elements, context, onCreatePayment });
    } catch (cause) {
      return { error: cause?.message || "Your payment could not be completed." };
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [context, elements, enabled, onCreatePayment, paymentReady, setSubmitting, stripe, submittingRef]);

  useImperativeHandle(ref, () => ({ confirm: () => runPayment() }), [runPayment]);

  return <div className="rgvx-payment-element-inline">
    <PaymentElement
      onReady={() => setPaymentReady(true)}
      onLoadError={() => onReadyChange(false)}
      options={{
        paymentMethodOrder: ["card"],
        layout: { type: "accordion", defaultCollapsed: false, radios: "never", spacedAccordionItems: false },
        fields: { billingDetails: { address: "never" } },
        defaultValues: {
          billingDetails: {
            name: context.customerName,
            email: context.customerEmail,
            phone: context.customerPhone,
            address: context.billingAddress,
          },
        },
      }}
    />
  </div>;
});

function ExpressPaymentForm({ context, enabled, onCreatePayment, onPaymentResult, onBlocked, setSubmitting, submittingRef }) {
  const stripe = useStripe();
  const elements = useElements();
  const [expressStatus, setExpressStatus] = useState("loading");
  const [blockedNotice, setBlockedNotice] = useState("");
  const [availableMethods, setAvailableMethods] = useState(null);
  const [loadError, setLoadError] = useState("");
  const walletDebug = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("wallet_debug");

  useEffect(() => {
    if (enabled) setBlockedNotice("");
  }, [enabled]);

  function updateExpressStatus(methods, reportAvailability = false) {
    const availability = getExpressAvailability(methods);
    setAvailableMethods(availability);
    if (reportAvailability) {
      console.info("ORION_EXPRESS_PAYMENT_METHODS", availability);
    }

    setExpressStatus(hasExpressMethods(methods) ? "available" : "unavailable");
  }

  async function confirmExpress(event) {
    if (submittingRef.current) return;
    if (!enabled || !stripe || !elements) {
      event.paymentFailed({ reason: "fail", message: "Complete the contact, shipping, and policy details before paying." });
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      onPaymentResult(await completePayment({ stripe, elements, context, onCreatePayment }));
    } catch (cause) {
      const error = cause?.message || "Your payment could not be completed.";
      event.paymentFailed({ reason: "fail", message: error });
      onPaymentResult({ error });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const walletDiagnostics = walletDebug ? {
    stripeStatus: expressStatus,
    stripeMethods: availableMethods,
    stripeLoadError: loadError || null,
    ...getWalletBrowserDiagnostics(),
  } : null;

  return <div className={`rgvx-express-checkout is-${expressStatus}${walletDebug ? " is-debug" : ""}`}>
    <p className="rgvx-express-label">Fast payment options</p>
    <ExpressCheckoutElement
      onClick={(event) => {
        if (submittingRef.current) {
          setBlockedNotice("Your payment is already being prepared.");
          event.reject();
          return;
        }

        if (enabled) {
          setBlockedNotice("");
          event.resolve();
          return;
        }

        setBlockedNotice("Finish the required checkout details and agreements to unlock fast payment.");
        onBlocked?.();
        event.reject();
      }}
      onReady={(event) => updateExpressStatus(event.availablePaymentMethods, true)}
      onAvailablePaymentMethodsChange={(event) => updateExpressStatus(event.paymentMethods, true)}
      onLoadError={(event) => {
        setLoadError(event?.error?.message || "Stripe Express Checkout failed to load.");
        setExpressStatus("unavailable");
      }}
      onConfirm={(event) => void confirmExpress(event)}
      options={{
        paymentMethods: { applePay: "always", googlePay: "auto", link: "auto" },
        paymentMethodOrder: ["apple_pay", "google_pay", "link"],
        buttonHeight: 46,
        buttonTheme: { applePay: "white-outline", googlePay: "black" },
        layout: { maxColumns: 3, maxRows: 0, overflow: "never" },
      }}
    />
    {walletDebug && (
      <div className="rgvx-wallet-debug" role="status">
        <strong>Wallet diagnostics</strong>
        <pre>{JSON.stringify(walletDiagnostics, null, 2)}</pre>
      </div>
    )}
    {!enabled && !blockedNotice && (
      <p className="rgvx-express-requirements" role="status">
        Complete the required checkout details and agreements to enable these buttons.
      </p>
    )}
    {blockedNotice && <p className="rgvx-express-feedback" role="alert">{blockedNotice}</p>}
    <div className="rgvx-stripe-divider" aria-hidden="true"><span /><small>or pay with card</small><span /></div>
  </div>;
}

const OrbitCardPayment = forwardRef(function OrbitCardPayment({ context, enabled, onCreatePayment, onPaymentResult, onReadyChange, onBlocked }, ref) {
  const stripePromise = useMemo(() => getStripeClient(context.publishableKey, context.connectedAccountId), [context.publishableKey, context.connectedAccountId]);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const standardOptions = useMemo(() => context.isReturn
    ? { clientSecret: context.clientSecret, appearance, locale: "en", loader: "auto" }
    : {
        mode: "payment",
        amount: context.totalMinor,
        currency: context.currency.toLowerCase(),
        paymentMethodTypes: ["card"],
        appearance,
        locale: "en",
        loader: "auto",
      },
  [context.clientSecret, context.currency, context.isReturn, context.totalMinor]);
  const expressOptions = useMemo(() => ({
    mode: "payment",
    amount: context.totalMinor,
    currency: context.currency.toLowerCase(),
    paymentMethodConfiguration: PAYMENT_METHOD_CONFIGURATION_ID,
    appearance,
    locale: "en",
    loader: "auto",
  }), [context.currency, context.totalMinor]);

  return <div className={`rgvx-stripe-elements ${submitting ? "is-submitting" : ""}`}>
    {!context.isReturn && <Elements stripe={stripePromise} options={expressOptions}>
      <ExpressPaymentForm
        context={context}
        enabled={enabled}
        onCreatePayment={onCreatePayment}
        onPaymentResult={onPaymentResult}
        onBlocked={onBlocked}
        setSubmitting={setSubmitting}
        submittingRef={submittingRef}
      />
    </Elements>}
    <Elements stripe={stripePromise} options={standardOptions}>
      <CardPaymentForm
        ref={ref}
        context={context}
        enabled={enabled}
        onCreatePayment={onCreatePayment}
        onPaymentResult={onPaymentResult}
        onReadyChange={onReadyChange}
        submitting={submitting}
        setSubmitting={setSubmitting}
        submittingRef={submittingRef}
      />
    </Elements>
    <p className="rgvx-stripe-powered">Secure payment powered by Stripe</p>
    {submitting && <div className="rgvx-stripe-processing" role="status" aria-live="polite"><span /> Securing payment and confirming your order...</div>}
    <style>{`
      .rgvx-stripe-elements{position:relative;display:grid;gap:14px;min-width:0}.rgvx-express-checkout{display:grid;gap:10px;min-width:0;visibility:hidden;opacity:0}.rgvx-express-checkout.is-loading{min-height:76px}.rgvx-express-checkout.is-unavailable:not(.is-debug){display:none}.rgvx-express-checkout.is-available,.rgvx-express-checkout.is-debug{visibility:visible;opacity:1;animation:rgvx-stripe-reveal 180ms ease both}.rgvx-express-label{margin:0;color:#d8d1c7;font-size:11px;font-weight:650;letter-spacing:.01em}.rgvx-express-requirements,.rgvx-express-feedback{margin:0;border:1px solid rgba(239,67,80,.2);border-radius:9px;background:rgba(216,33,50,.06);padding:9px 11px;color:#d9a6aa;font-size:10px;font-weight:600;line-height:1.45}.rgvx-express-feedback{border-color:rgba(239,67,80,.35);background:rgba(216,33,50,.1);color:#ffd4d7}.rgvx-wallet-debug{overflow:auto;border:1px solid rgba(245,158,11,.42);border-radius:9px;background:rgba(120,53,15,.16);padding:10px;color:#fde68a;font-size:10px;line-height:1.45}.rgvx-wallet-debug strong{display:block;margin-bottom:6px;letter-spacing:.05em;text-transform:uppercase}.rgvx-wallet-debug pre{margin:0;white-space:pre-wrap;word-break:break-word;font:inherit}.rgvx-stripe-divider{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:11px;margin-top:1px}.rgvx-stripe-divider span{height:1px;background:#2b2527}.rgvx-stripe-divider small,.rgvx-stripe-powered{color:#77717a;font-size:10px;font-weight:550}.rgvx-stripe-divider small{letter-spacing:.01em}.rgvx-payment-element-inline{min-width:0;overflow:hidden;background:transparent;padding:0}.rgvx-stripe-powered{margin:-2px 0 0;text-align:center;letter-spacing:.08em}.rgvx-stripe-elements.is-submitting{pointer-events:none}.rgvx-stripe-elements.is-submitting>:not(.rgvx-stripe-processing){opacity:.46;transition:opacity 180ms ease}.rgvx-stripe-processing{display:flex;align-items:center;justify-content:center;gap:9px;min-height:42px;border:1px solid rgba(225,58,72,.18);border-radius:11px;background:#171113;color:#f4e9eb;font-size:11px;font-weight:650}.rgvx-stripe-processing span{width:13px;height:13px;border:2px solid rgba(255,255,255,.16);border-top-color:#e13a48;border-radius:50%;animation:rgvx-stripe-spin .7s linear infinite}@keyframes rgvx-stripe-spin{to{transform:rotate(360deg)}}@keyframes rgvx-stripe-reveal{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}@media(max-width:520px){.rgvx-stripe-elements{gap:12px}.rgvx-stripe-divider{gap:8px}}
    `}</style>
  </div>;
});

export default OrbitCardPayment;
