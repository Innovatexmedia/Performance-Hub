/**
 * =============================================================================
 * InnovateX Revenue OS — Zoho CRM OAuth Routes
 * =============================================================================
 * FILE: src/modules/integrations/zoho/zohoOAuth.routes.js
 * Mounted SEPARATELY from integration.routes.js and BEFORE the
 * authenticated routes in app.js -- same precedent as
 * googleAdsOAuth.routes.js.
 * =============================================================================
 */

import { Router } from 'express';
import * as controller from './zohoOAuth.controller.js';
import { authenticate } from '../../../shared/middlewares/auth.middleware.js';
import { resolveTenant } from '../../../shared/middlewares/tenant.middleware.js';
import { requireRole } from '../../../shared/middlewares/role.middleware.js';

const router = Router();

router.get('/callback', controller.handleCallback);
router.get('/authorize', authenticate, resolveTenant, requireRole('tenant_admin'), controller.startAuthorization);

export default router;
