import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = "C:/Users/Sebastian/web2.0";
const component = fs.readFileSync(path.join(root, "src/components/checkout/RgvCheckout.jsx"), "utf8");
const stylesMatch = component.match(/const styles = `([\s\S]*?)`\.replaceAll\("!important", ""\);/);
if (!stylesMatch) throw new Error("Unable to extract checkout styles");

const componentStyles = stylesMatch[1].replaceAll("!important", "");
const shellStyles = fs.readFileSync(path.join(root, "src/components/checkout/Exrgvcheckout.css"), "utf8");
const premiumStyles = fs.readFileSync(path.join(root, "src/components/checkout/CheckoutPremium.css"), "utf8");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Payment confirmation preview</title>
  <style>
    html,body{margin:0;min-height:100%;background:#090a0c;color:#ededeb;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    a{color:inherit}
    ${shellStyles}
    ${premiumStyles}
    ${componentStyles}
  </style>
</head>
<body>
  <div class="rgv-checkout">
    <header class="rgvx-checkout-nav">
      <div class="rgvx-checkout-nav-inner">
        <a href="#" class="rgvx-checkout-logo" aria-label="RGVPRIME home"><img src="/logo.webp" alt="RGVPRIME" width="164" height="46"></a>
        <div class="rgvx-checkout-nav-secure">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span>Secure checkout</span>
        </div>
        <a href="#" class="rgvx-checkout-back"><span>Continue shopping</span></a>
      </div>
    </header>
    <main class="rgvx-page rgvx-thanks-page">
      <div class="rgvx-background-wash"></div>
      <section class="rgvx-shell rgvx-thanks-shell">
        <div class="rgvx-topbar">
          <a href="#" class="rgvx-ghost-link">&#8592;&nbsp; Back to shop</a>
          <div class="rgvx-lock-pill rgvx-confirmed-pill">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.8 10A10 10 0 1 1 17 3.3"/><path d="m9 11 3 3L22 4"/></svg>
            Payment confirmed
          </div>
        </div>
        <section class="rgvx-receipt-thanks-card" aria-live="polite">
          <div class="rgvx-receipt-thanks-icon">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.8 10A10 10 0 1 1 17 3.3"/><path d="m9 11 3 3L22 4"/></svg>
          </div>
          <p>ORDER #4321</p>
          <h1>Payment completed</h1>
          <span>Your payment was confirmed and your order is now being processed.</span>
          <div class="rgvx-receipt-thanks-details">
            <div>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
              <span>Payment method</span><strong>Card &amp; Wallets</strong>
            </div>
            <div>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3z"/><path d="m9 12 2 2 4-4"/></svg>
              <span>Current status</span><strong>Processing</strong>
            </div>
          </div>
          <div class="rgvx-receipt-thanks-actions">
            <a href="#" class="rgvx-receipt-thanks-button">Go to my account&nbsp; &#8250;</a>
            <a href="#" class="rgvx-receipt-thanks-button rgvx-receipt-thanks-button--secondary">Back to store</a>
          </div>
          <small class="rgvx-receipt-thanks-redirect">Taking you to your account in 5 seconds.</small>
        </section>
      </section>
    </main>
  </div>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === "/logo.webp") {
    const logo = fs.readFileSync(path.join(root, "public/logo.webp"));
    res.writeHead(200, { "Content-Type": "image/webp" });
    res.end(logo);
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
});

server.listen(8766, "127.0.0.1", () => console.log("Thank-you preview: http://127.0.0.1:8766"));
