/**
 * =============================================================================
 * InnovateX Revenue OS — Cashfree Client
 * =============================================================================
 *
 * FILE: src/config/cashfree.js
 *
 * PURPOSE
 * ───────
 * Thin REST wrapper around Cashfree's Subscriptions API (recurring
 * mandate billing -- eNACH/UPI Autopay/card). There is no first-party
 * Node SDK method surface stable enough to depend on for this API, so
 * this talks to Cashfree's HTTP endpoints directly via the built-in
 * `fetch` (already used everywhere else in this codebase -- see e.g.
 * whatsapp/providers/meta.provider.js), the same way the previous
 * Razorpay integration used the `razorpay` SDK package.
 *
 * TWO DIFFERENT SUBSCRIPTIONS API FAMILIES
 * ─────────────────────────────────────────
 * Cashfree has both a newer unified Subscriptions API (base `/pg`,
 * versioned via x-api-version, hosted-checkout-with-JS-widget flow) and
 * an older-but-still-current "Subscriptions v2" API (base `/api/v2`,
 * no version header, a direct authLink the customer is redirected to).
 * WHICH one is active depends on how Cashfree provisioned the merchant
 * account -- there's no reliable way to detect this up front, and this
 * account was confirmed (via real request/response testing) to be on
 * the v2 family, so subscription.service.js is written against that:
 * POST /api/v2/subscriptions/seamless/subscription to create, GET
 * /api/v2/subscriptions/{subReferenceId} to fetch (which is where the
 * authLink to redirect the customer to comes from), POST
 * /api/v2/subscriptions/{subReferenceId}/cancel to cancel.
 *
 * isCashfreeConfigured() returns false (not a throwing constructor) when
 * keys aren't set, so a dev environment without Cashfree configured
 * doesn't crash on boot -- callers check this and surface a clear error
 * instead of an unhandled exception deep in a fetch call.
 * =============================================================================
 */

import crypto from 'crypto';
import config from './config.js';

export const isCashfreeConfigured = () =>
  Boolean(config.CASHFREE_APP_ID && config.CASHFREE_SECRET_KEY);

const V2_BASE_URLS = {
  sandbox: 'https://sandbox.cashfree.com',
  production: 'https://api.cashfree.com',
};

export const getCashfreeMode = () => (config.CASHFREE_ENV === 'production' ? 'production' : 'sandbox');

const getV2BaseUrl = () => V2_BASE_URLS[getCashfreeMode()];

/**
 * CashfreeApiError — carries the parsed error body so callers can surface
 * Cashfree's own message instead of a generic "request failed", same
 * role asRazorpayError() played for the old SDK's thrown error shape.
 */
export class CashfreeApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'CashfreeApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * parseCashfreeJson — Cashfree returns some ids (notably subReferenceId)
 * as integers that exceed Number.MAX_SAFE_INTEGER. Native JSON.parse
 * silently rounds those to the nearest representable double, which then
 * doesn't match anything when used to look the subscription back up
 * ("Subscription Does not exist for subReferenceId: <rounded value>").
 * Quotes any bare integer literal of 16+ digits (a safe threshold -- JS
 * represents integers exactly only up to 2^53, ~16 digits) before
 * parsing, so it comes through as a string instead of a lossy float.
 * This only touches raw numeric VALUES (":<digits><delimiter>"), never
 * content inside quoted strings, so it can't corrupt normal fields.
 */
const parseCashfreeJson = (text) => {
  if (!text) return {};
  const safe = text.replace(/:(-?\d{16,})([,}\]\s])/g, ':"$1"$2');
  return JSON.parse(safe);
};

/**
 * cashfreeV2Request — calls the Subscriptions v2 API (`/api/v2/...`).
 * `path` is the FULL path including `/api/v2` (e.g.
 * '/api/v2/subscriptions/seamless/subscription').
 */
export const cashfreeV2Request = async (path, { method = 'GET', body } = {}) => {
  if (!isCashfreeConfigured()) {
    throw new CashfreeApiError('Cashfree is not configured on this server -- set CASHFREE_APP_ID and CASHFREE_SECRET_KEY.');
  }

  const response = await fetch(`${getV2BaseUrl()}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': config.CASHFREE_APP_ID,
      'X-Client-Secret': config.CASHFREE_SECRET_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const data = parseCashfreeJson(text);

  // The v2 API returns 200 with a body `status` field for some errors
  // rather than always using the HTTP status code -- check both.
  if (!response.ok || data?.status === 'ERROR') {
    // Real, complete logging of every Cashfree failure -- previously
    // the full response (status + body) was captured on the thrown
    // error but never actually printed anywhere, so a failure only ever
    // showed up as a generic 400 in Render's access log (method, path,
    // status, byte count) with zero indication of WHAT Cashfree actually
    // said. Confirmed in practice: a live-mode subscription-creation
    // failure showed nothing more specific than "Cashfree request
    // failed" client-side, with no way to diagnose it further without
    // this.
    console.error(
      `[cashfree] ${method} ${path} failed -- HTTP ${response.status}, body:`,
      JSON.stringify(data ?? text).slice(0, 2000),
    );
    throw new CashfreeApiError(data?.message || 'Cashfree request failed', { status: response.status, body: data });
  }
  return data;
};

/**
 * verifyWebhookSignature — confirms an inbound webhook call actually came
 * from Cashfree, not a spoofed client request. Per Cashfree's docs:
 * Base64(HMAC-SHA256(timestamp + rawBody, client_secret)), compared
 * against the x-webhook-signature header. Uses RAW request bytes (not
 * the parsed/re-serialized body) -- same reasoning as the old
 * razorpay.js verifyWebhookSignature and metaWebhook.service.js's
 * req.rawBody: JSON re-serialization can change byte-for-byte content
 * (key order, whitespace) and silently break HMAC verification.
 *
 * Uses CASHFREE_SECRET_KEY by default (Cashfree's documented scheme
 * signs with the merchant's client secret, not a separate webhook-only
 * secret), but honors CASHFREE_WEBHOOK_SECRET if explicitly set, in
 * case the dashboard's webhook configuration ever issues a distinct one.
 */
export const verifyWebhookSignature = (rawBody, timestampHeader, signatureHeader) => {
  const secret = config.CASHFREE_WEBHOOK_SECRET || config.CASHFREE_SECRET_KEY;
  if (!secret || !timestampHeader || !signatureHeader || !rawBody) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestampHeader}${rawBody}`)
    .digest('base64');

  // Constant-time comparison -- signatures are fixed-length base64 hashes,
  // so this never leaks length info the way a naive === wouldn't already.
  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(signatureHeader);
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
};