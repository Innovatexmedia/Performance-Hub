/**
 * Cashfree's Subscriptions v2 API (confirmed to be what this account is
 * actually provisioned on -- see BACKEND's subscription.service.js
 * comment) doesn't use a JS checkout widget at all. createSubscriptionCheckout
 * returns a plain `authLink` URL, and completing the mandate is just a
 * normal browser navigation to Cashfree's own hosted authorization page
 * -- no SDK script, no modal, nothing to load or initialize here.
 *
 * The customer's browser leaves the app entirely during this step and
 * comes back via the `return_url` the backend set (which encodes
 * `billing_subscription_id` -- see Settings.tsx's effect that picks that
 * param back up on return and finishes verification server-side).
 */
export function redirectToCashfreeAuth(authLink: string): void {
  window.location.href = authLink;
}