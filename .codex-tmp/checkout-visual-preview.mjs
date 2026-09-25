import http from "node:http";
import fs from "node:fs";

const sourcePath = "C:/Users/Sebastian/web2.0/work/rgv-2.2.0-visual-clean-20260925/rgv-prism-checkout/rgv-prism-checkout.php";
const source = fs.readFileSync(sourcePath, "utf8");
const match = source.match(/return <<<'CSS'\s*([\s\S]*?)\nCSS;/);
if (!match) throw new Error("Unable to extract payment CSS");

const css = match[1];
const products = [
  ["GHK-CU", "$20.00"],
  ["CJC/IPA (no DAC) 10mg – Single", "$32.00"],
  ["E-RECON WATER 30ML", "$16.00"],
];

const vialPreview = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect x='23' y='7' width='18' height='8' rx='2' fill='%23ddd'/%3E%3Crect x='20' y='14' width='24' height='43' rx='7' fill='%23f4f4f1'/%3E%3Crect x='22' y='31' width='20' height='16' rx='2' fill='%239f343c'/%3E%3Cpath d='M25 36h14M25 40h10' stroke='%23fff' stroke-width='2'/%3E%3C/svg%3E";

const productRows = products.map(([name, price]) => `
  <tr class="order_item">
    <td class="product-name"><span class="rgv-order-product"><span class="rgv-order-product__media"><img class="rgv-order-product__image" src="${vialPreview}" alt=""></span><span class="rgv-order-product__name">${name}</span></span><dl class="variation"><dt>Option:</dt><dd>Single</dd></dl></td>
    <td class="product-quantity"><strong class="product-quantity">×&nbsp;1</strong></td>
    <td class="product-subtotal"><span class="amount">${price}</span></td>
  </tr>`).join("");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RGV payment visual preview</title>
<style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#090a0c}body{font-family:Inter,system-ui,sans-serif}.screen-reader-text{display:none}
${css}
.preview-payment-surface{margin:0 24px;padding:19px;border-right:1px solid rgba(255,255,255,.11);border-left:1px solid rgba(255,255,255,.11);background:#111215}
.preview-wallet{height:48px;border-radius:10px;background:#61d57c;color:#07150b;display:flex;align-items:center;justify-content:center;font-weight:750;font-size:17px}
.preview-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}.preview-tabs span{padding:12px;border:1px solid rgba(255,255,255,.10);border-radius:9px;background:#181b20;color:#bbbcc3;font-size:11px}.preview-tabs span:first-child{border-color:rgba(162,70,76,.58);color:#f3e8e7;background:rgba(125,39,45,.18)}
.preview-fields{display:grid;grid-template-columns:2fr 1fr 1fr;gap:9px;margin-top:14px}.preview-fields span{padding:13px;border:1px solid #34363d;border-radius:9px;background:#0b0c0f;color:#777a82;font-size:11px}
@media(max-width:700px){.preview-payment-surface{margin:0 16px;padding:14px}.preview-fields{grid-template-columns:1fr 1fr}.preview-fields span:first-child{grid-column:1/-1}}
</style></head>
<body class="rgv-card-wallet-payment-page">
<nav class="rgv-pay-nav"><div class="rgv-pay-nav__inner"><a class="rgv-pay-nav__brand" href="#">RGV<span>PRIME</span></a><div></div><a class="rgv-pay-nav__back" href="#">← Back to checkout</a></div></nav>
<main><div class="woocommerce">
  <section class="rgv-payment-intro" aria-labelledby="rgv-payment-title"><h1 id="rgv-payment-title">Complete your payment</h1><p class="rgv-payment-intro__copy">Review your total and choose how you would like to pay.</p></section>
  <section id="psc-research-checkout" data-psc-step="complete"><div class="psc-r-shell"><div class="psc-r-body"><div class="psc-r-recognized"><span class="psc-r-checkmark">✓</span><div><strong>Sebastian Ocampo</strong><span>sebassocampo1414@gmail.com · Independent</span></div></div><button data-action="edit">Edit details</button></div></div></section>
  <form id="order_review" class="psc-layout-standard psc-gateway-selected">
    <div class="psc-checkout" id="psc-checkout"><div class="preview-payment-surface"><div class="preview-wallet">link</div><div class="preview-tabs"><span>Card</span><span>Bank</span><span>Cash App Pay</span></div><div class="preview-fields"><span>Card number</span><span>MM / YY</span><span>CVC</span></div></div></div>
    <table class="shop_table"><thead><tr><th class="product-name">Product</th><th class="product-quantity">Qty</th><th class="product-total">Totals</th></tr></thead><tbody>${productRows}</tbody><tfoot>
      <tr><th scope="row" colspan="2">Subtotal:</th><td class="product-total"><span class="amount">$68.00</span></td></tr>
      <tr><th scope="row" colspan="2">Shipping:</th><td class="product-total"><span class="amount">$15.00</span> <small class="shipped_via">via UPS Shipping</small></td></tr>
      <tr><th scope="row" colspan="2">Service &amp; Processing:</th><td class="product-total"><span class="amount">$2.49</span></td></tr>
      <tr><th scope="row" colspan="2">Total:</th><td class="product-total"><span class="amount">$85.49</span></td></tr>
      <tr><th scope="row" colspan="2">Payment method:</th><td class="product-total">Card &amp; Wallets</td></tr>
    </tfoot></table>
    <div id="payment"><ul class="wc_payment_methods payment_methods methods"><li class="wc_payment_method payment_method_psc"><input id="payment_method_psc" type="radio" checked><label for="payment_method_psc">Card &amp; Wallets</label><div class="payment_box payment_method_psc"><p class="psc-gateway-description">Complete research verification, then pay securely.</p></div></li></ul><div class="form-row"><button type="button" id="place_order">Pay securely · $85.49</button></div></div>
  </form>
</div></main></body></html>`;

http.createServer((req, res) => {
  res.writeHead(200, {"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
  res.end(html);
}).listen(8767, "127.0.0.1", () => console.log("Checkout preview: http://127.0.0.1:8767"));
