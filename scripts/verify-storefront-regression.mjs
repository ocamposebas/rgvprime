import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = String(
  process.env.STOREFRONT_BASE_URL || "http://127.0.0.1:4321",
).replace(/\/$/, "");
const chromePath =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profileDirectory = await mkdtemp(path.join(os.tmpdir(), "rgv-seo-browser-"));
let browserProcess;
let socket;

function wait(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function waitForDevToolsPort() {
  const portFile = path.join(profileDirectory, "DevToolsActivePort");
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    try {
      const [port] = (await readFile(portFile, "utf8")).split(/\r?\n/);
      if (port) return Number(port);
    } catch {}

    await wait(100);
  }

  throw new Error("Chrome DevTools endpoint did not become available.");
}

class CdpClient {
  constructor(webSocket) {
    this.webSocket = webSocket;
    this.nextId = 1;
    this.pending = new Map();

    webSocket.addEventListener("message", async (event) => {
      let raw = event.data;

      if (raw instanceof Blob) raw = await raw.text();
      if (raw instanceof ArrayBuffer) raw = Buffer.from(raw).toString("utf8");

      const message = JSON.parse(String(raw));
      if (!message.id) return;

      const handlers = this.pending.get(message.id);
      if (!handlers) return;

      this.pending.delete(message.id);
      if (message.error) handlers.reject(new Error(message.error.message));
      else handlers.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.webSocket.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Browser evaluation failed.");
  }

  return result.result?.value;
}

async function waitForExpression(client, expression, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      if (await evaluate(client, expression)) return;
    } catch {}

    await wait(150);
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

async function navigate(client, url) {
  await client.send("Page.navigate", { url });
  await waitForExpression(
    client,
    'document.readyState === "complete"',
    `page load: ${url}`,
  );
}

try {
  browserProcess = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDirectory}`,
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );

  const port = await waitForDevToolsPort();
  const pages = await fetch(`http://127.0.0.1:${port}/json`).then((response) =>
    response.json(),
  );
  const page = pages.find((entry) => entry.type === "page");

  if (!page?.webSocketDebuggerUrl) {
    throw new Error("Chrome did not expose a test page.");
  }

  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const client = new CdpClient(socket);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await navigate(client, `${baseUrl}/product/ss-31`);
  await waitForExpression(
    client,
    `[...document.querySelectorAll("button")].some((button) => /Add to Cart/i.test(button.innerText))`,
    "hydrated SS-31 purchase controls",
  );

  async function selectProductOption(label, option) {
    const selected = await evaluate(
      client,
      `(() => {
        const label = ${JSON.stringify(label)};
        const option = ${JSON.stringify(option)};
        const fieldLabel = [...document.querySelectorAll("label")]
          .find((node) => node.innerText.trim().toLowerCase().startsWith(label.toLowerCase()));
        const button = fieldLabel && [...fieldLabel.parentElement.querySelectorAll("button")]
          .find((node) => node.innerText.trim().toLowerCase().startsWith(option.toLowerCase()));
        if (!button) return false;
        button.click();
        return true;
      })()`,
    );

    if (!selected) throw new Error(`Could not select ${label}: ${option}`);
    await wait(250);
  }

  await selectProductOption("Option", "10mg");
  await selectProductOption("Purchase option", "Single");
  await waitForExpression(
    client,
    `[...document.querySelectorAll("button[aria-pressed='true']")].length >= 2 &&
      [...document.querySelectorAll("button")].some((button) => /Add to Cart/i.test(button.innerText) && !button.disabled)`,
    "valid variation selection",
  );

  const selection = await evaluate(
    client,
    `(() => ({
      pressed: [...document.querySelectorAll("button[aria-pressed='true']")]
        .map((button) => button.innerText.trim().replace(/\s+/g, " ")),
      skuText: document.body.innerText.includes("SS-31-SINGLE-10MG")
    }))()`,
  );

  const addClicked = await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll("button")]
        .find((node) => /^Add to Cart/i.test(node.innerText.trim()) && !node.disabled);
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );

  if (!addClicked) throw new Error("Enabled Add to Cart button was not found.");
  await waitForExpression(
    client,
    `(() => {
      try {
        const items = JSON.parse(localStorage.getItem("rgv-prime-cart-v1") || "[]");
        return items.length === 1 && Number(items[0].variationId) === 313;
      } catch { return false; }
    })()`,
    "cart storage after add-to-cart",
  );

  const cartBeforeReload = await evaluate(
    client,
    `JSON.parse(localStorage.getItem("rgv-prime-cart-v1") || "[]")`,
  );
  await client.send("Page.reload", { ignoreCache: true });
  await waitForExpression(
    client,
    `document.readyState === "complete" && (() => {
      try {
        const items = JSON.parse(localStorage.getItem("rgv-prime-cart-v1") || "[]");
        return items.length === 1 && Number(items[0].variationId) === 313;
      } catch { return false; }
    })()`,
    "cart persistence after reload",
  );

  const cartAfterReload = await evaluate(
    client,
    `JSON.parse(localStorage.getItem("rgv-prime-cart-v1") || "[]")`,
  );
  await navigate(client, `${baseUrl}/checkout`);
  await waitForExpression(
    client,
    `location.pathname === "/" && new URLSearchParams(location.search).get("mode") === "login"`,
    "protected checkout entry redirect",
  );

  const checkoutEntry = await evaluate(
    client,
    `({
      pathname: location.pathname,
      mode: new URLSearchParams(location.search).get("mode"),
      next: new URLSearchParams(location.search).get("next"),
      cart: JSON.parse(localStorage.getItem("rgv-prime-cart-v1") || "[]")
    })`,
  );

  if (checkoutEntry.next !== "/checkout") {
    throw new Error("Checkout login redirect did not preserve the checkout destination.");
  }
  if (checkoutEntry.cart.length !== 1 || Number(checkoutEntry.cart[0].variationId) !== 313) {
    throw new Error("Cart did not persist through checkout entry.");
  }

  console.log(
    JSON.stringify(
      {
        success: true,
        productUrl: `${baseUrl}/product/ss-31`,
        selection,
        cartBeforeReload: cartBeforeReload.map(({ id, variationId, sku, price, quantity }) => ({
          id,
          variationId,
          sku,
          price,
          quantity,
        })),
        cartAfterReloadCount: cartAfterReload.length,
        checkoutEntry: {
          pathname: checkoutEntry.pathname,
          mode: checkoutEntry.mode,
          next: checkoutEntry.next,
          cartCount: checkoutEntry.cart.length,
        },
        orderSubmitted: false,
      },
      null,
      2,
    ),
  );
} finally {
  socket?.close();
  browserProcess?.kill();
  await wait(250);
  await rm(profileDirectory, { recursive: true, force: true }).catch(() => {});
}
