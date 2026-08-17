/**
 * Thin wrapper around the globally-loaded Razorpay Checkout script (see
 * index.html's <script src="https://checkout.razorpay.com/v1/checkout.js">).
 * Not an npm package -- Razorpay's own docs specify loading it this way,
 * so `window.Razorpay` is a global, not an importable module.
 */

interface RazorpayOptions {
  key: string;
  subscription_id: string;
  name: string;
  description?: string;
  theme?: { color?: string };
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_subscription_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: { ondismiss?: () => void };
}

interface RazorpayInstance {
  open: () => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

/**
 * openRazorpaySubscriptionCheckout -- opens the Checkout modal for a
 * subscription (not a one-time order). `onSuccess` fires only after
 * Razorpay's own client-side payment flow completes; the caller is still
 * responsible for calling verifySubscriptionPayment server-side before
 * treating the plan as switched -- this handler alone is not proof of
 * payment, just Razorpay's signal to go verify it.
 */
export function openRazorpaySubscriptionCheckout({
  keyId, subscriptionId, planName, onSuccess, onDismiss,
}: {
  keyId: string;
  subscriptionId: string;
  planName: string;
  onSuccess: (response: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) => void;
  onDismiss?: () => void;
}): boolean {
  if (!window.Razorpay) return false; // script hasn't loaded yet (e.g. blocked, slow network)

  const instance = new window.Razorpay({
    key: keyId,
    subscription_id: subscriptionId,
    name: 'InnovateX Revenue OS',
    description: `Subscribe to ${planName}`,
    theme: { color: '#4f46e5' },
    handler: onSuccess,
    modal: { ondismiss: onDismiss },
  });
  instance.open();
  return true;
}