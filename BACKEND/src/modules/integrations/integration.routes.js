/**
 * Integration routes.
 * Pattern matches template.routes.js / automation.routes.js exactly.
 *
 * FILE: src/modules/integrations/integration.routes.js
 *
 * ROUTE MAP:
 *   GET   /api/integrations/counts         - per-category counts (all roles)
 *   GET   /api/integrations                - list, auto-seeds catalog (all roles)
 *   GET   /api/integrations/:id            - view (all roles)
 *   GET   /api/integrations/:id/error-logs - error-log modal data (all roles)
 *   POST  /api/integrations/:id/toggle     - connect/disconnect (tenant_admin+)
 *   POST  /api/integrations/:id/sync       - sync, updates last_sync (tenant_admin+)
 *   PATCH /api/integrations/:id/config     - settings modal save (tenant_admin+)
 *
 * Role floor matches MASTER_SPEC.md A4 permission matrix exactly:
 * "Manage integrations" = Super Admin / Tenant Owner / Tenant Admin only;
 * Sales User and Read-Only get view access only (no requireRole on GETs).
 *
 * Register in app.js:
 *   import integrationRoutes from './modules/integrations/integration.routes.js';
 *   app.use('/api/integrations', integrationRoutes);
 */

import { Router } from 'express';
import * as controller from './integration.controller.js';
import {
  validateListQuery,
  validateIdParam,
  validateUpdateConfig,
} from './integration.validator.js';

import { authenticate }  from '../../shared/middlewares/auth.middleware.js';
import { resolveTenant } from '../../shared/middlewares/tenant.middleware.js';
import { requireRole }   from '../../shared/middlewares/role.middleware.js';

const router = Router();

router.use(authenticate);
router.use(resolveTenant);

router.get('/counts', requireRole('tenant_admin'), controller.getCounts);

router.get('/', requireRole('tenant_admin'), validateListQuery, controller.getIntegrations);

router.get('/:id', requireRole('tenant_admin'), validateIdParam, controller.getIntegration);
router.get('/:id/error-logs', requireRole('tenant_admin'), validateIdParam, controller.getErrorLogs);

router.post('/:id/toggle', requireRole('tenant_admin'), validateIdParam, controller.toggleIntegration);
router.post('/:id/sync', requireRole('tenant_admin'), validateIdParam, controller.syncIntegration);
router.patch('/:id/config', requireRole('tenant_admin'), validateUpdateConfig, controller.updateConfig);

export default router;