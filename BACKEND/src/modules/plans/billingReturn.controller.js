/**
 * FILE: src/modules/plans/billingReturn.controller.js
 *
 * Unauthenticated -- this is Cashfree's own hosted checkout page
 * redirecting the CUSTOMER'S browser back after the mandate flow, not a
 * logged-in user's request. There's no session/auth token to check here
 * at all, same principle as cashfreeWebhook.controller.js -- except this
 * is a genuine browser navigation (accepts both GET and POST; confirmed
 * in practice that Cashfree does this via an HTML form POST, not a
 * plain link), not a server-to-server call.
 *
 * Authenticity of the RESULT doesn't come from trusting anything in this
 * request -- verifySubscriptionByCashfreeId always re-fetches the real
 * status from Cashfree using our own credentials before ever touching
 * the account's plan. This endpoint's only job is: figure out which
 * subscriptionId this is about, trigger that real verification, and
 * then hand the browser back to the frontend via a normal GET redirect
 * (which is what makes this exist as a separate backend route at all --
 * see subscription.service.js's comment on returnUrl for why a POST
 * straight to the frontend dev server 404s).
 */

import { verifySubscriptionByCashfreeId } from './subscription.service.js';

export const handleReturn = async (req, res) => {
  const subscriptionId = req.query.subscriptionId || req.body?.subscriptionId;
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

  if (!subscriptionId) {
    return res.redirect(302, `${clientUrl}/settings?billing_result=error&billing_message=${encodeURIComponent('Missing subscription reference')}`);
  }

  try {
    const result = await verifySubscriptionByCashfreeId(subscriptionId);
    return res.redirect(302, `${clientUrl}/settings?billing_result=success&billing_plan=${encodeURIComponent(result.plan)}`);
  } catch (err) {
    console.error('[billing return] verification failed:', err);
    const message = err?.message || 'Could not confirm the subscription';
    return res.redirect(302, `${clientUrl}/settings?billing_result=error&billing_message=${encodeURIComponent(message)}`);
  }
};