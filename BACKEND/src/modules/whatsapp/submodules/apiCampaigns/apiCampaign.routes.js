/**
 * API Campaign — dashboard routes (JWT-authenticated).
 *
 * Mount at: app.use('/api/whatsapp/campaign-runs', apiCampaignRoutes)
 *
 * Read-only. Creating and configuring an API campaign goes through the
 * EXISTING campaign endpoints (/api/whatsapp/campaigns) with type: 'API' —
 * there is no separate creation path, because an API campaign is an ordinary
 * campaign with a different trigger, not a different entity.
 */

import { Router } from 'express';

import { authenticate } from '../../../../shared/middlewares/auth.middleware.js';
import { resolveTenant } from '../../../../shared/middlewares/tenant.middleware.js';
import * as controller from './apiCampaign.controller.js';

const router = Router();

// Lifecycle first: '/:runId' would otherwise swallow '/campaigns/...'.
router.post('/campaigns/:campaignId/activate', authenticate, resolveTenant, controller.activateCampaign);
router.post('/campaigns/:campaignId/pause',    authenticate, resolveTenant, controller.pauseCampaign);

router.get('/', authenticate, resolveTenant, controller.listRuns);
router.get('/:runId', authenticate, resolveTenant, controller.getRun);

export default router;