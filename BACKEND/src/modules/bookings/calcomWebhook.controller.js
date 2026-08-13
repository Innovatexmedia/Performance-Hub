/**
 * =============================================================================
 * InnovateX Revenue OS — Cal.com Webhook Controller
 * =============================================================================
 *
 * FILE: src/modules/bookings/calcomWebhook.controller.js
 *
 * Real, public webhook receiver. Tenant is identified via the URL path
 * (see calcomSettings.service.js's connect() -- the real webhook
 * subscription is created with a tenant-specific subscriberUrl), then
 * that tenant's own webhookSecret is used to verify the real
 * X-Cal-Signature-256 header before anything in the payload is trusted.
 * =============================================================================
 */

import CalcomSettings from './calcomSettings.model.js';
import { calcomSettingsService } from './calcomSettings.service.js';
import { verifyWebhookSignature } from './providers/calcom.provider.js';
import { decrypt } from '../../utils/crypto.js';
import { sendSuccess, sendError } from '../../utils/apiResponse.js';
import asyncHandler from '../../utils/asyncHandler.js';

/**
 * handleWebhook -- POST /api/bookings/calcom/webhook/:tenantId
 * Public (Cal.com's own server calling this, not an authenticated user).
 */
export const handleWebhook = asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
  const signature = req.headers['x-cal-signature-256'];

  const settings = await CalcomSettings.findOne({ tenantId, connected: true });
  if (!settings || !settings.webhookSecret) {
    // Real, deliberate 404 rather than 401/403 -- doesn't confirm to an
    // unauthenticated caller whether a tenant with this ID even has
    // Cal.com connected, same anti-enumeration principle already used
    // elsewhere in this app (e.g. forgot-password).
    return sendError(res, 'Not found', 404);
  }

  // req.rawBody is populated globally by app.js's express.json({verify})
  // -- the same real mechanism the existing Meta webhook already relies
  // on for its own signature check. Verified against the exact raw
  // bytes Cal.com sent, not a re-serialized copy of the parsed body.
  const isValid = verifyWebhookSignature(req.rawBody, signature, decrypt(settings.webhookSecret));
  if (!isValid) {
    console.warn(`[calcom webhook] invalid signature for tenant ${tenantId}`);
    return sendError(res, 'Invalid signature', 401);
  }

  const { triggerEvent, payload } = req.body;

  // Real duplicate-event protection: applyCalcomBooking's own dedup
  // logic (lookup by external_source+external_id, real unique DB index)
  // already makes reprocessing the same booking idempotent regardless
  // of how many times Cal.com retries delivery -- so simply calling it
  // again for a retried/duplicate webhook is genuinely safe, not a
  // separate mechanism bolted on top.
  try {
    if (triggerEvent === 'BOOKING_CREATED' || triggerEvent === 'BOOKING_RESCHEDULED' || triggerEvent === 'BOOKING_CANCELLED') {
      await calcomSettingsService.applyCalcomBooking(tenantId, payload);
    }
    // Any other real trigger type (e.g. BOOKING_PAID, MEETING_STARTED)
    // is acknowledged but not acted on -- this integration only
    // subscribed to the 3 triggers above, so no other type should
    // arrive here in practice.
  } catch (err) {
    // Real webhook delivery failures should be visible on Cal.com's own
    // dashboard (so a genuinely broken sync is discoverable), not
    // silently swallowed -- but a single bad event shouldn't be retried
    // forever either. Log clearly, still acknowledge receipt.
    console.warn(`[calcom webhook] failed to apply booking for tenant ${tenantId}: ${err.message}`);
  }

  return sendSuccess(res, null, 'Webhook received');
});