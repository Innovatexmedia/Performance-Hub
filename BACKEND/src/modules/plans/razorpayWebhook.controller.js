/**
 * FILE: src/modules/plans/razorpayWebhook.controller.js
 *
 * Unauthenticated -- this is Razorpay's own server calling in, not a
 * logged-in user, so it cannot sit behind `authenticate`. Authenticity
 * is verified via HMAC signature instead (verifyWebhookSignature), same
 * principle as metaWebhook.service.js's X-Hub-Signature-256 check.
 *
 * Always returns 200 once the signature check passes, REGARDLESS of
 * whether the event was one we recognized/handled -- Razorpay retries
 * (with backoff, eventually disabling the webhook) on any non-2xx
 * response, so acknowledging receipt of an event we don't care about is
 * correct; only a bad signature should be rejected.
 */

import { verifyWebhookSignature } from '../../config/razorpay.js';
import { handleWebhookEvent } from './subscription.service.js';

export const handleWebhook = async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const rawBody = req.rawBody;

  if (!rawBody || !verifyWebhookSignature(rawBody, signature)) {
    return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
  }

  try {
    await handleWebhookEvent(req.body);
  } catch (err) {
    // Log and still ack -- Razorpay retrying an event that fails for a
    // reason on OUR side (e.g. a transient DB blip) is fine; but if we
    // instead return non-2xx, Razorpay will hammer retries for an event
    // that may never succeed (e.g. a genuinely malformed/unexpected
    // payload), which helps no one. Real error visibility should come
    // from server logs / monitoring, not from making Razorpay's retry
    // queue the alerting mechanism.
    console.error('[razorpay webhook] handler error:', err);
  }

  return res.status(200).json({ success: true });
};