import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Elements, ExpressCheckoutElement, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

const stripeClients = new Map();
const appearance = {
  theme: "night",
  inputs: "spaced",
  labels: "above",
  variables: {
    colorPrimary: "#e13a48",
    colorBackground: "#101011",
    colorText: "#f5f5f5",
    colorDanger: "#f16b76",
    colorTextSecondary: "#a1a1aa",
    colorTextPlaceholder: "#71717a",
    fontFamily: 'Inter, "Helvetica Neue", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSizeBase: "15px",
    borderRadius: "14px",
    spacingUnit: "5px",
    focusBoxShadow: "0 0 0 3px rgba(216, 33, 50, 0.14)",
    focusOutline: "none",
  },
  rules: {
    ".Input": { backgroundColor: "#101011", border: "1px solid rgba(255,255,255,.16)", boxShadow: "none", padding: "15px" },
    ".Input:hover": { borderColor: "rgba(255,255,255,.28)" },
    ".Input:focus": { borderColor: "#e13a48", boxShadow: "0 0 0 3px rgba(216,33,50,.12)" },
    ".Input--invalid": { borderColor: "#f16b76", boxShadow: "0 0 0 3px rgba(241,107,118,.1)" },
    ".Label": { color: "#d4d4d8", fontSize: "12px", fontWeight: "600" },
    ".Label--invalid, .Error": { color: "#f48a93" },
    ".Tab, .AccordionItem": { backgroundColor: "#101011", border: "1px solid rgba(255,255,255,.1)", boxShadow: "none" },
    ".Tab:hover": { color: "#f5f5f5", borderColor: "rgba(255,255,255,.22)" },
    ".Tab:focus": { boxShadow: "0 0 0 3px rgba(216,33,50,.12)" },
    ".Tab--selected": { backgroundColor: "#1b1b1d", borderColor: "#c72b39", boxShadow: "none" },
    ".TabLabel": { fontWeight: "600" },
    ".TermsText": { color: "#85858e", fontSize: "12px" },
    ".Link, .TermsLink": { color: "#ef727d" },
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

function ExpressPaymentForm({ context, enabled, onCreatePayment, onPaymentResult, setSubmitting, submittingRef }) {
  const stripe = useStripe();
  const elements = useElements();
  const [expressStatus, setExpressStatus] = useState("loading");

  function updateExpressStatus(methods) {
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

  return <div className={`rgvx-express-checkout is-${expressStatus}`}>
    <p className="rgvx-express-label">Fast payment options</p>
    <ExpressCheckoutElement
      onClick={(event) => enabled && !submittingRef.current ? event.resolve() : event.reject()}
      onReady={(event) => updateExpressStatus(event.availablePaymentMethods)}
      onAvailablePaymentMethodsChange={(event) => updateExpressStatus(event.paymentMethods)}
      onLoadError={() => setExpressStatus("unavailable")}
      onConfirm={(event) => void confirmExpress(event)}
      options={{
        paymentMethods: { applePay: "auto", googlePay: "auto", link: "auto" },
        paymentMethodOrder: ["apple_pay", "google_pay", "link", "paypal", "amazon_pay", "klarna"],
        buttonHeight: 52,
        buttonTheme: { applePay: "white-outline", googlePay: "black", paypal: "black" },
        layout: { maxColumns: 3, maxRows: 0, overflow: "never" },
      }}
    />
    <div className="rgvx-stripe-divider" aria-hidden="true"><span /><small>or pay with card</small><span /></div>
  </div>;
}

const OrbitCardPayment = forwardRef(function OrbitCardPayment({ context, enabled, onCreatePayment, onPaymentResult, onReadyChange }, ref) {
  const stripePromise = useMemo(() => getStripeClient(context.publishableKey, context.connectedAccountId), [context.publishableKey, context.connectedAccountId]);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const standardOptions = useMemo(() => context.isReturn
    ? { clientSecret: context.clientSecret, appearance, locale: "en", loader: "auto" }
    : {
        mode: "payment",
        amount: context.totalMinor,
        currency: context.currency.toLowerCase(),
        appearance,
        locale: "en",
        loader: "auto",
        paymentMethodTypes: ["card"],
      },
  [context.clientSecret, context.currency, context.isReturn, context.totalMinor]);
  const expressOptions = useMemo(() => ({
    mode: "payment",
    amount: context.totalMinor,
    currency: context.currency.toLowerCase(),
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
    <p className="rgvx-stripe-powered">Securely processed by Stripe</p>
    {submitting && <div className="rgvx-stripe-processing" role="status" aria-live="polite"><span /> Securing payment and confirming your order...</div>}
    <style>{`
      .rgvx-stripe-elements{position:relative;display:grid;gap:22px;min-width:0}.rgvx-express-checkout{display:grid;gap:14px;min-width:0;visibility:hidden;opacity:0}.rgvx-express-checkout.is-loading{min-height:92px}.rgvx-express-checkout.is-unavailable{display:none}.rgvx-express-checkout.is-available{visibility:visible;opacity:1;animation:rgvx-stripe-reveal 180ms ease both}.rgvx-express-label{margin:0;color:#d8d1c7;font-size:12px;font-weight:650;letter-spacing:.01em}.rgvx-stripe-divider{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:14px;margin-top:4px}.rgvx-stripe-divider span{height:1px;background:#312e29}.rgvx-stripe-divider small,.rgvx-stripe-powered{color:#827b72;font-size:11px;font-weight:550}.rgvx-stripe-divider small{letter-spacing:.01em}.rgvx-payment-element-inline{min-width:0;overflow:hidden;background:transparent;padding:0}.rgvx-stripe-powered{margin:-4px 0 0;text-align:center}.rgvx-stripe-elements.is-submitting{pointer-events:none}.rgvx-stripe-elements.is-submitting>:not(.rgvx-stripe-processing){opacity:.46;transition:opacity 180ms ease}.rgvx-stripe-processing{display:flex;align-items:center;justify-content:center;gap:10px;min-height:46px;border-radius:14px;background:#1f1b18;color:#eee8df;font-size:12px;font-weight:650}.rgvx-stripe-processing span{width:14px;height:14px;border:2px solid rgba(255,255,255,.16);border-top-color:#c66b62;border-radius:50%;animation:rgvx-stripe-spin .7s linear infinite}@keyframes rgvx-stripe-spin{to{transform:rotate(360deg)}}@keyframes rgvx-stripe-reveal{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}@media(max-width:520px){.rgvx-stripe-elements{gap:18px}.rgvx-stripe-divider{gap:10px}}
    `}</style>
  </div>;
});

export default OrbitCardPayment;
