/**
 * =============================================================================
 * InnovateX Revenue OS — Razorpay Client
 * =============================================================================
 *
 * FILE: src/config/razorpay.js
 *
 * PURPOSE
 * ───────
 * Single shared Razorpay SDK instance for the whole app -- subscription
 * creation, plan creation, and signature verification all go through
 * this. Returns null (not a throwing constructor) when keys aren't
 * configured, so a dev environment without Razorpay set up doesn't crash
 * on boot -- callers check isRazorpayConfigured() and surface a clear
 * error instead of an unhandled exception deep in the SDK.
 * =============================================================================
 */

import Razorpay from 'razorpay';
import crypto from 'crypto';
import config from './config.js';

export const isRazorpayConfigured = () =>
  Boolean(config.RAZORPAY_KEY_ID && config.RAZORPAY_KEY_SECRET);

let client = null;
export const getRazorpayClient = () => {
  if (!isRazorpayConfigured()) return null;
  if (!client) {
    client = new Razorpay({
      key_id: config.RAZORPAY_KEY_ID,
      key_secret: config.RAZORPAY_KEY_SECRET,
    });
  }
  return client;
};

/**
 * verifyPaymentSignature — confirms a subscription's first-payment
 * callback actually came from Razorpay, not a spoofed client request.
 * Formula per Razorpay's docs: HMAC-SHA256(payment_id + "|" + subscription_id, key_secret).
 */
export const verifyPaymentSignature = ({ razorpay_payment_id, razorpay_subscription_id, razorpay_signature }) => {
  if (!config.RAZORPAY_KEY_SECRET) return false;
  const expected = crypto
    .createHmac('sha256', config.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
    .digest('hex');
  return expected === razorpay_signature;
};

/**
 * verifyWebhookSignature — confirms an inbound webhook call actually came
 * from Razorpay. Uses RAW request bytes (not the parsed/re-serialized
 * body) -- same reasoning as metaWebhook.service.js's req.rawBody: JSON
 * re-serialization can change byte-for-byte content (key order,
 * whitespace) and silently break HMAC verification.
 */
export const verifyWebhookSignature = (rawBody, signatureHeader) => {
  if (!config.RAZORPAY_WEBHOOK_SECRET || !signatureHeader) return false;
  const expected = crypto
    .createHmac('sha256', config.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return expected === signatureHeader;
};