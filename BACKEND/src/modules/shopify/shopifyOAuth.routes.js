/**
 * =============================================================================
 * InnovateX Revenue OS — Shopify OAuth Routes
 * =============================================================================
 * FILE: src/modules/shopify/shopifyOAuth.routes.js
 * =============================================================================
 */

import { Router } from 'express';
import * as controller from './shopifyOAuth.controller.js';
import { authenticate } from '../../shared/middlewares/auth.middleware.js';
import { resolveTenant } from '../../shared/middlewares/tenant.middleware.js';
import { requireRole } from '../../shared/middlewares/role.middleware.js';

const router = Router();

router.get('/callback', controller.handleCallback);
router.get('/authorize', authenticate, resolveTenant, requireRole('tenant_admin'), controller.startAuthorization);

export default router;