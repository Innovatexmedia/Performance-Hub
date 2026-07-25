/**
 * Automation routes.
 * Pattern matches call.routes.js / booking.routes.js exactly.
 *
 * FILE: src/modules/automations/automation.routes.js
 *
 * SCOPE NOTE: trimmed to match spec exactly. Three independent spec
 * documents describe this module's action surface and all three agree:
 *   - DEVELOPER_HANDOFF.md's action table: `toggleAutomation, simulateAutomation, createAutomation`
 *   - MASTER_SPEC.md B14: "Rule cards..., enable/disable, simulate run, logs"
 *   - FRONTEND_SPEC.md section 15 (cited in automation.constants.js's own
 *     header): "create rule -> toggle active -> 'Simulate run' -> view logs"
 * None of the three ever names an update or delete action. PATCH /:id and
 * DELETE /:id existed in an earlier build of this backend and have been
 * removed to align -- same fix already applied to the Campaigns module.
 *
 * ROUTE MAP:
 *   GET   /api/automations/kpis          — KPI row (all roles)
 *   GET   /api/automations               — list (all roles)
 *   POST  /api/automations               — create rule (tenant_admin+)
 *   GET   /api/automations/:id           — get single rule (all roles)
 *   POST  /api/automations/:id/toggle    — enable/disable (tenant_admin+)
 *   POST  /api/automations/:id/simulate  — simulate run (sales_user+)
 *   GET   /api/automations/:id/logs      — run history (all roles)
 *
 * Register in app.js:
 *   import automationRoutes from './modules/automations/automation.routes.js';
 *   app.use('/api/automations', automationRoutes);
 */

import { Router } from 'express';
import * as controller from './automation.controller.js';
import {
  validateCreateAutomation,
  validateListQuery,
  validateIdParam,
  validateSimulate,
} from './automation.validator.js';

import { authenticate }  from '../../shared/middlewares/auth.middleware.js';
import { resolveTenant } from '../../shared/middlewares/tenant.middleware.js';
import { requireRole }   from '../../shared/middlewares/role.middleware.js';

const router = Router();

// Apply auth + tenant resolution to ALL automation routes
router.use(authenticate);
router.use(resolveTenant);

// ── Static routes BEFORE /:id — prevents Express treating "kpis" as :id
router.get('/kpis', controller.getKpis);

// ── Collection routes
router
  .route('/')
  .get(validateListQuery, controller.getAutomations)
  .post(requireRole('tenant_admin'), validateCreateAutomation, controller.createAutomation);

// ── Resource routes
router.get('/:id', validateIdParam, controller.getAutomation);

router.post('/:id/toggle', requireRole('tenant_admin'), validateIdParam, controller.toggleAutomation);
router.post('/:id/simulate', requireRole('sales_user'), validateSimulate, controller.simulateAutomation);
router.get('/:id/logs', validateIdParam, controller.getLogs);

export default router;