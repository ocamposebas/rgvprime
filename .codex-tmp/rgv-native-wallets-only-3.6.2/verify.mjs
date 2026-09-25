import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sourcePath = new URL('./rgv-prism-checkout/assets/js/order-pay.js', import.meta.url);
const source = fs.readFileSync(sourcePath, 'utf8');

for (const forbidden of [
  'us_bank_account',
  'gestureSubmit',
  'confirm_pending',
  'location.reload',
  'Express checkout is disabled'
]) {
  assert.equal(source.includes(forbidden), false, `forbidden runtime logic found: ${forbidden}`);
}

const calls = {
  elements: [],
  create: [],
  submit: 0
};

function Stripe() {
  return {
    elements(options) {
      calls.elements.push(options);
      return {
        create(type, options) {
          calls.create.push({ type, options });
          return { type, options };
        },
        submit() {
          calls.submit += 1;
          return Promise.resolve({});
        }
      };
    }
  };
}

const controller = {
  paymentElementOptions(options) {
    return { ...(options || {}), originalOption: true };
  }
};

const document = {
  readyState: 'loading',
  addEventListener() {}
};

const window = {
  Stripe,
  PSCCheckoutController: controller,
  setInterval() {
    throw new Error('Stripe wrapper should install synchronously');
  },
  clearInterval() {},
  setTimeout() {},
  requestAnimationFrame() {},
  addEventListener() {}
};

vm.runInNewContext(source, {
  window,
  document,
  MutationObserver: class {},
  Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
  console,
  Proxy,
  Reflect,
  Object,
  String,
  RegExp,
  Promise
}, { filename: sourcePath.pathname });

assert.notEqual(window.Stripe, Stripe, 'Stripe factory was not wrapped');

const stripe = window.Stripe('pk_test_wallets');
const elements = stripe.elements({ clientSecret: 'pi_test_secret', paymentMethodTypes: ['card', 'link'] });
assert.deepEqual(Array.from(calls.elements[0].paymentMethodTypes), ['card']);

elements.create('payment', { wallets: { applePay: 'auto', googlePay: 'auto', link: 'auto' } });
const paymentCall = calls.create.at(-1);
assert.equal(paymentCall.type, 'payment');
assert.deepEqual(Array.from(paymentCall.options.paymentMethodOrder), ['card']);
assert.deepEqual({ ...paymentCall.options.wallets }, {
  applePay: 'never',
  googlePay: 'never',
  link: 'never'
});

elements.create('expressCheckout', {
  paymentMethods: { amazonPay: 'auto' },
  layout: { maxRows: 1 }
});
const expressCall = calls.create.at(-1);
assert.equal(expressCall.type, 'expressCheckout');
assert.deepEqual(Array.from(expressCall.options.paymentMethodOrder), ['applePay', 'googlePay', 'link']);
assert.deepEqual({ ...expressCall.options.paymentMethods }, {
  amazonPay: 'never',
  applePay: 'auto',
  googlePay: 'auto',
  link: 'auto',
  klarna: 'never',
  paypal: 'never'
});
assert.equal(expressCall.options.layout.maxRows, 1);
assert.equal(expressCall.options.layout.maxColumns, 2);
assert.equal(expressCall.options.layout.overflow, 'never');

await elements.submit();
assert.equal(calls.submit, 1, 'native Elements submit was not preserved');
assert.equal(elements.__rgvBeginGestureSubmit, undefined, 'gesture bridge was unexpectedly added');

const controllerOptions = controller.paymentElementOptions({ wallets: { applePay: 'auto' } });
assert.deepEqual(Array.from(controllerOptions.paymentMethodOrder), ['card']);
assert.deepEqual({ ...controllerOptions.wallets }, {
  applePay: 'never',
  googlePay: 'never',
  link: 'never'
});

const phpPath = new URL('./rgv-prism-checkout/rgv-prism-checkout.php', import.meta.url);
const phpSource = fs.readFileSync(phpPath, 'utf8');
const embeddedScripts = [...phpSource.matchAll(/<<<'JS'\r?\n([\s\S]*?)\r?\nJS;/g)];
assert.equal(embeddedScripts.length, 3, 'unexpected embedded JavaScript block count');
for (const [, embeddedScript] of embeddedScripts) {
  new Function(embeddedScript);
}

console.log('WALLET_ONLY_BEHAVIOR_OK');
console.log(`EMBEDDED_JS_OK=${embeddedScripts.length}`);
