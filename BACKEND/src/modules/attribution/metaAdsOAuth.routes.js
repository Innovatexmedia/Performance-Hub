/**
 * =============================================================================
 * InnovateX Revenue OS — Meta Ads OAuth Routes
 * =============================================================================
 *
 * FILE: src/modules/attribution/metaAdsOAuth.routes.js
 *
 * Mirrors googleAdsOAuth.routes.js exactly -- mounted SEPARATELY from
 * integration.routes.js and BEFORE it in app.js. /authorize is a real,
 * authenticated action; /callback is Meta's own browser redirect and
 * genuinely cannot carry an Authorization header, so the tenant is
 * identified via the signed `state` param instead.
 *
 * ROUTE MAP:
 *   GET /api/integrations/meta-ads/oauth/authorize  (tenant_admin+, authenticated)
 *   GET /api/integrations/meta-ads/oauth/callback   (public -- Meta's own redirect)
 * =============================================================================
 */

import { Router } from 'express';
import * as controller from './metaAdsOAuth.controller.js';
import { authenticate } from '../../shared/middlewares/auth.middleware.js';
import { resolveTenant } from '../../shared/middlewares/tenant.middleware.js';
import { requireRole } from '../../shared/middlewares/role.middleware.js';

const router = Router();

// Public -- Meta's own redirect, no auth header possible.
router.get('/callback', controller.handleCallback);

// Authenticated -- a real person clicking "Connect" needs their own
// session so we know which tenant this is for.
router.get('/authorize', authenticate, resolveTenant, requireRole('tenant_admin'), controller.startAuthorization);

export default router;