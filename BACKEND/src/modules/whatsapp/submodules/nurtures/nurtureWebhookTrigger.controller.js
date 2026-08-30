/**
 * =============================================================================
 * InnovateX Revenue OS — Nurture Incoming Webhook Controller
 * =============================================================================
 *
 * FILE: src/modules/whatsapp/submodules/nurtures/nurtureWebhookTrigger.controller.js
 *
 * Real, public endpoint -- an external system calling in, not an
 * authenticated InnovateX user. Token-based auth (in the URL itself),
 * not a session.
 * =============================================================================
 */

import asyncHandler from '../../../../utils/asyncHandler.js';
import { sendSuccess } from '../../../../utils/responses.js';
import { handleIncomingWebhook } from './nurtureWebhookTrigger.service.js';

export const nurtureWebhookTriggerController = {
  /**
   * trigger -- POST /api/whatsapp/nurtures/webhook-trigger/:sequenceId/:token
   * req.rawBody is populated globally by app.js's express.json({verify})
   * -- the same real mechanism every other real webhook in this app
   * (Shopify, Cal.com) relies on for exact-byte hashing. Thrown AppErrors
   * are handled correctly by the global error handler (confirmed: it
   * duck-types on .statusCode/.isOperational, not instanceof, so this
   * doesn't need its own try/catch -- same pattern as every other
   * controller in this codebase).
   */
  trigger: asyncHandler(async (req, res) => {
    const result = await handleIncomingWebhook({
      sequenceId: req.params.sequenceId,
      token: req.params.token,
      rawBody: req.rawBody,
      payload: req.body,
    });
    return sendSuccess(res, result, result.duplicate ? 'Duplicate delivery ignored' : 'Enrolled');
  }),
};