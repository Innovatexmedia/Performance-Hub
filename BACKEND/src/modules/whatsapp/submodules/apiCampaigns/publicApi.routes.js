/**
 * Public API — /api/v1/**
 *
 * The ONLY externally-callable surface. Separate from the dashboard routes on
 * purpose:
 *   - different authentication (API key, never a JWT or cookie)
 *   - different rate limit (per key, not per IP)
 *   - a versioned path, so this contract can be kept stable for customers
 *     whose code we don't control, while internal routes keep changing freely
 *
 * Nothing here touches Meta directly. The controller validates, records a run
 * and enqueues; the existing worker does the sending. Meta credentials are
 * resolved server-side inside the provider, exactly as for dashboard sends,
 * and never travel anywhere near this layer.
 */

import { Router } from 'express';

import { authenticateApiKey, requireScope } from '../../../../shared/middlewares/apiKeyAuth.middleware.js';
import { publicApiRateLimit } from '../../../../shared/middlewares/rateLimit.middleware.js';
import { API_KEY_SCOPE } from '../../../apiKeys/apiKey.model.js';
import * as controller from './apiCampaign.controller.js';

const router = Router();

// Order matters: authenticate first so the limiter can key on the resolved
// API key rather than on an IP.
router.use(authenticateApiKey);
router.use(publicApiRateLimit);

/**
 * POST /api/v1/campaigns/:campaignId/trigger
 *
 * Body:
 *   {
 *     "recipients": [
 *       { "phone": "919XXXXXXXXX", "name": "Ravi", "variables": { "1": "Ravi", "2": "ORD123" } }
 *     ]
 *   }
 *
 * Headers:
 *   Authorization: Bearer ixk_live_...   (or X-API-Key)
 *   Idempotency-Key: <unique per request>  (optional, strongly recommended)
 *
 * Returns 202 Accepted — the messages have been queued, not yet delivered.
 * 200 would claim more than we know.
 */
router.post(
  '/campaigns/:campaignId/trigger',
  requireScope(API_KEY_SCOPE.CAMPAIGNS_SEND),
  controller.triggerCampaign
);

/**
 * Convenience alias taking campaignId in the body instead of the path. Some
 * no-code tools (Zapier-style builders) can only issue a request to a fixed
 * URL, so requiring the id in the path would lock them out.
 */
router.post(
  '/campaigns/send',
  requireScope(API_KEY_SCOPE.CAMPAIGNS_SEND),
  controller.triggerCampaignFromBody
);

/** GET /api/v1/campaigns/runs/:runId — poll a run's progress. */
router.get('/campaigns/runs/:runId', controller.getRunPublic);

export default router;