import type { PaymentMethodId, RazorpayCheckoutOptions } from './types';

/**
 * Inline HTML that loads Razorpay Standard Checkout.
 * Card/UPI secrets never touch ScanG — Razorpay owns PCI scope.
 *
 * `bridgeMode`:
 * - `rn`  → postMessage via ReactNativeWebView (native)
 * - `web` → postMessage via window.parent (iframe on web)
 */
export function buildCheckoutHtml(
  options: RazorpayCheckoutOptions,
  bridgeMode: 'rn' | 'web' = 'rn',
): string {
  const { method, ...rest } = options;
  const payload: Record<string, unknown> = { ...rest };
  if (method) {
    payload.method = method;
  }
  const optsJson = JSON.stringify(payload).replace(/</g, '\\u003c');

  const postFn =
    bridgeMode === 'web'
      ? `function post(type, payload) {
        try {
          window.parent.postMessage(JSON.stringify({ type: type, payload: payload || null }), '*');
        } catch (e) {}
      }`
      : `function post(type, payload) {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, payload: payload || null }));
        }
      }`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <style>
    html, body { margin:0; padding:0; background:#0A0A0C; color:#fff; font-family: -apple-system, system-ui, sans-serif; }
    .wrap { display:flex; align-items:center; justify-content:center; min-height:100vh; flex-direction:column; gap:12px; }
    .muted { color:#A1A1AA; font-size:14px; }
  </style>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
</head>
<body>
  <div class="wrap">
    <span>Opening secure checkout…</span>
    <span class="muted">Encrypted · PCI-DSS compliant</span>
  </div>
  <script>
    (function () {
      var options = ${optsJson};
      ${postFn}
      options.handler = function (response) {
        post('success', response);
      };
      options.modal = {
        ondismiss: function () { post('close'); }
      };
      try {
        var rzp = new Razorpay(options);
        rzp.on('payment.failed', function (resp) {
          post('failure', (resp && resp.error) ? resp.error : { description: 'Payment failed' });
        });
        rzp.open();
      } catch (e) {
        post('failure', { description: (e && e.message) || 'Checkout failed to open' });
      }
    })();
  </script>
</body>
</html>`;
}

export function formatCheckoutAmount(paise: number, currency = 'INR'): string {
  const rupees = paise / 100;
  if (currency === 'INR') {
    return `₹${rupees.toLocaleString('en-IN', {
      minimumFractionDigits: rupees % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `${currency} ${rupees.toFixed(2)}`;
}

export function isValidVpa(vpa: string): boolean {
  // Client-side format only — never used to charge. Razorpay owns real UPI.
  return /^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}$/.test(vpa.trim());
}

export type { PaymentMethodId };
