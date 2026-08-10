/**
 * =============================================================================
 * InnovateX Revenue OS — Super Admin Routes
 * =============================================================================
 * FILE: src/modules/superAdmin/superAdmin.routes.js
 *
 * Mounted at /api/super-admin in app.js. Every route requires the EXACT
 * super_admin role (not "this rank or above" -- requireExactRole, not
 * requireRole, since there is no rank above super_admin for this to mean
 * anything different, and exact-match is the more explicit, correct
 * intent for a platform-only surface).
 *
 * SOURCE: MASTER_SPEC.md B19 / FRONTEND_SPEC.md §20 -- exactly 5 tabs:
 * Tenants, All Users, Integration Health, Global Activity Log, Global
 * Templates -- plus the platform KPI dashboard. No delete-tenant route,
 * no platform-settings route -- neither exists in spec.
 * =============================================================================
 */

import { Router } from 'express';
import * as superAdminController from './superAdmin.controller.js';
import { authenticate } from '../../shared/middlewares/auth.middleware.js';
import { requireExactRole } from '../../shared/middlewares/role.middleware.js';
import { validateCreateTenant, validateUpdateTenant } from './superAdmin.validator.js';

const router = Router();

router.use(authenticate);
router.use(requireExactRole('super_admin'));

// Platform dashboard (KPI row)
router.get('/dashboard', superAdminController.getDashboard);

// Tab 1: Tenants
router.get('/tenants', superAdminController.listTenants);
router.get('/tenants/:id', superAdminController.getTenant);
router.post('/tenants', validateCreateTenant, superAdminController.createTenant);
router.patch('/tenants/:id', validateUpdateTenant, superAdminController.updateTenant);
router.post('/tenants/:id/suspend', superAdminController.suspendTenant);
router.post('/tenants/:id/reactivate', superAdminController.reactivateTenant);

// Tab 2: All Users
router.get('/users', superAdminController.listAllUsers);

// Tab 3: Integration Health
router.get('/integration-health', superAdminController.getIntegrationHealth);

// Tab 4: Global Activity Log
router.get('/activity-log', superAdminController.getActivityLog);

// Tab 5: Global Templates
router.get('/templates', superAdminController.listGlobalTemplates);

export default router;