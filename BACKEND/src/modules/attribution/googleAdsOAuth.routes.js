/**
 * =============================================================================
 * InnovateX Revenue OS — Google Ads OAuth Routes
 * =============================================================================
 *
 * FILE: src/modules/attribution/googleAdsOAuth.routes.js
 *
 * Mounted SEPARATELY from integration.routes.js and BEFORE it in app.js,
 * matching the exact same precedent already established for WhatsApp's
 * public webhook routes (see whatsapp.routes.js's own comment about
 * this). /authorize is a real, authenticated action (a logged-in
 * tenant_admin+ clicking "Connect"); /callback is Google's own browser
 * redirect back to this server and genuinely cannot carry an
 * Authorization header, so it cannot live behind this app's normal
 * `authenticate` middleware -- the tenant is instead identified via the
 * `state` param, which /authorize encoded when it built the consent URL.
 *
 * ROUTE MAP:
 *   GET /api/integrations/google-ads/oauth/authorize  (tenant_admin+, authenticated)
 *   GET /api/integrations/google-ads/oauth/callback   (public -- Google's own redirect)
 * =============================================================================
 */

import { Router } from 'express';
import * as controller from './googleAdsOAuth.controller.js';
import { authenticate } from '../../shared/middlewares/auth.middleware.js';
import { resolveTenant } from '../../shared/middlewares/tenant.middleware.js';
import { requireRole } from '../../shared/middlewares/role.middleware.js';

const router = Router();

// Public -- Google's own redirect, no auth header possible. Mounted first,
// same ordering principle as WhatsApp's webhook-before-authenticate fix.
router.get('/callback', controller.handleCallback);

// Authenticated -- a real person clicking "Connect" needs their own
// session so we know which tenant this is for.
router.get('/authorize', authenticate, resolveTenant, requireRole('tenant_admin'), controller.startAuthorization);

export default router;