/**
 * API Keys — dashboard routes.
 *
 * Mount at: app.use('/api/api-keys', apiKeyRoutes)
 *
 * These are the INTERNAL routes the customer's own dashboard uses to manage
 * their keys, so they authenticate with a JWT like every other dashboard
 * route. An API key can never be used to mint another API key — that would
 * make a single leaked key impossible to contain, since the attacker could
 * issue replacements faster than they could be revoked.
 *
 * Restricted to workspace owners and admins: issuing a credential that can
 * message a tenant's entire contact list is an owner-level action, not
 * something every seat should hold.
 */

import { Router } from 'express';

import { authenticate } from '../../shared/middlewares/auth.middleware.js';
import { requireRole } from '../../shared/middlewares/role.middleware.js';
import { ROLES } from '../auth/constants/roles.js';
import * as controller from './apiKey.controller.js';

const router = Router();

// requireRole is a MINIMUM-role check (see role.middleware.js hasRole), so
// TENANT_ADMIN admits TENANT_OWNER and SUPER_ADMIN above it and excludes
// every seat below.
const MIN_ROLE = ROLES.TENANT_ADMIN;

router.get('/', authenticate, requireRole(MIN_ROLE), controller.list);
router.post('/', authenticate, requireRole(MIN_ROLE), controller.create);
router.delete('/:id', authenticate, requireRole(MIN_ROLE), controller.revoke);

export default router;