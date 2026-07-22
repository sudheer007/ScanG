/** Shared Razorpay checkout types — used by native WebView and web iframe hosts. */

export type PaymentMethodId = 'card' | 'upi' | 'netbanking' | 'wallet';

export type RazorpayCheckoutOptions = {
  key: string;
  amount: number;
  currency: string;
  subscription_id?: string;
  order_id?: string;
  name?: string;
  description?: string;
  image?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  /** Prefer this rail when opening Razorpay hosted checkout. */
  method?: PaymentMethodId;
};

export type RazorpaySuccessPayload = {
  razorpay_payment_id: string;
  razorpay_subscription_id?: string;
  razorpay_order_id?: string;
  razorpay_signature: string;
};

export type RazorpayFailurePayload = {
  code?: string;
  description?: string;
  reason?: string;
  source?: string;
  step?: string;
  message?: string;
};

export type RazorpayCheckoutCallbacks = {
  onSuccess: (data: RazorpaySuccessPayload) => void;
  onFailure: (error: RazorpayFailurePayload) => void;
  onClose?: () => void;
};

export type CheckoutHostMessage =
  | { type: 'success'; payload: RazorpaySuccessPayload }
  | { type: 'failure'; payload: RazorpayFailurePayload }
  | { type: 'close'; payload?: null };

export const CHECKOUT_MESSAGE_TYPES = new Set(['success', 'failure', 'close']);
