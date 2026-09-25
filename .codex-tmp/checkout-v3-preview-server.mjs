import http from "node:http";
import fs from "node:fs";

const source = fs.readFileSync(
  "C:/Users/Sebastian/web2.0/work/rgv-2.2.0-visual-v3/rgv-prism-checkout/rgv-prism-checkout.php",
  "utf8",
);
const cssStart = source.indexOf("return <<<'CSS'");
const cssEnd = source.indexOf("\nCSS;", cssStart);
const css = source.slice(source.indexOf("\n", cssStart) + 1, cssEnd);

const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style></head>
<body class="rgv-card-wallet-payment-page woocommerce-order-pay">
  <nav class="rgv-pay-nav"><div class="rgv-pay-nav__inner">
    <a class="rgv-pay-nav__brand"><img src="https://rgvprimellc.com/logo.webp" alt="RGVPRIME"></a>
    <a class="rgv-pay-nav__back"><span>←</span> Back to checkout</a>
  </div></nav>
  <div class="woocommerce">
    <section id="psc-research-checkout" data-psc-step="complete">
      <div class="psc-r-shell"><div class="psc-r-body">
        <div class="psc-r-recognized"><span class="psc-r-checkmark">✓</span><div><strong>sebastian ocampo</strong><span>sebasocampo1414@gmail.com</span><span>Independent</span></div></div>
        <button data-action="edit">Edit details</button>
      </div></div>
    </section>
    <section class="rgv-payment-intro">
      <p class="rgv-payment-intro__eyebrow"><span></span> Final payment</p>
      <h1>Complete your order</h1>
      <p class="rgv-payment-intro__copy">Review your order, then complete your payment securely.</p>
      <div class="rgv-payment-intro__trust"><span><b>✓</b> Encrypted payment</span><span><b>✓</b> Card details stay private</span></div>
    </section>
    <form id="order_review">
      <div id="psc-checkout" class="psc-checkout psc-checkout--research-payment psc-checkout--standard psc-checkout--theme-dark">
        <div class="psc-wallet-stage"><div style="height:52px;border-radius:10px;background:#55d47b;color:#07140b;display:grid;place-items:center;font-weight:750;font-size:18px">◉ link&nbsp;&nbsp; <span style="font-size:12px;font-weight:550">2 saved payment methods</span></div></div>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px"><div style="padding:13px;border-radius:9px;background:#aaa0f2;color:#101114">Card</div><div style="padding:13px;border-radius:9px;background:#191c22">Bank</div><div style="padding:13px;border-radius:9px;background:#191c22">Affirm</div><div style="padding:13px;border-radius:9px;background:#191c22">Cash App Pay</div><div style="padding:13px;border-radius:9px;background:#191c22">K</div></div>
        <div class="psc-card-stage" style="display:grid;grid-template-columns:1.6fr .8fr .8fr;gap:10px"><label>Card number<div style="margin-top:6px;padding:13px;border:1px solid #34363d;border-radius:9px;color:#8e9098">1234 1234 1234 1234</div></label><label>Expiration date<div style="margin-top:6px;padding:13px;border:1px solid #34363d;border-radius:9px;color:#8e9098">MM / YY</div></label><label>Security code<div style="margin-top:6px;padding:13px;border:1px solid #34363d;border-radius:9px;color:#8e9098">CVC</div></label></div>
      </div>
      <table class="shop_table"><thead><tr><th class="product-name">Product</th><th class="product-quantity">Qty</th><th class="product-total">Totals</th></tr></thead>
        <tbody><tr><td class="product-name">GHK-CU<dl class="variation"><p>Option: 50mg<br>Purchase option: Single</p></dl></td><td class="product-quantity">× 1</td><td class="product-subtotal">$20.00</td></tr><tr><td class="product-name">CJC/IPA (no DAC) 10mg – Single</td><td class="product-quantity">× 1</td><td class="product-subtotal">$32.00</td></tr><tr><td class="product-name">E-RECON WATER 30ML</td><td class="product-quantity">× 1</td><td class="product-subtotal">$16.00</td></tr></tbody>
        <tfoot><tr><th colspan="2">Subtotal:</th><td class="product-total">$68.00</td></tr><tr><th colspan="2">Shipping:</th><td class="product-total">$15.00 via UPS Shipping</td></tr><tr><th colspan="2">Service & Processing:</th><td class="product-total">$2.49</td></tr><tr class="order-total"><th colspan="2">Total:</th><td class="product-total"><span class="amount">$85.49</span></td></tr><tr><th colspan="2">Payment method:</th><td class="product-total">Card & Wallets</td></tr></tfoot>
      </table>
      <div id="payment"><ul class="payment_methods"><li class="payment_method_psc"><label>Card & Wallets</label><div class="payment_box"><p class="psc-gateway-description">Pay securely with card, Link, Apple Pay, or Google Pay when available.</p></div></li></ul><div class="form-row"><button id="place_order">Pay for order</button></div></div>
    </form>
  </div>
</body></html>`;

http.createServer((_, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}).listen(8765, "127.0.0.1");
