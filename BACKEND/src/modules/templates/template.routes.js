/**
 * Generic Template routes.
 * Pattern matches automation.routes.js / booking.routes.js exactly.
 *
 * FILE: src/modules/templates/template.routes.js
 *
 * ROUTE MAP:
 *   GET   /api/templates/counts          — per-type counts for tabs (all roles)
 *   GET   /api/templates                 — list (all roles; scope-filtered)
 *   POST  /api/templates                 — create (tenant_admin+; scope=global needs super_admin)
 *   GET   /api/templates/:id             — view (all roles; scope-filtered)
 *   PATCH /api/templates/:id             — edit (owner tenant_admin+, or super_admin for global)
 *   DELETE /api/templates/:id            — delete (owner tenant_admin+, or super_admin for global)
 *   POST  /api/templates/:id/duplicate   — duplicate into own scope (sales_user+)
 *   GET   /api/templates/:id/versions    — version history (all roles; scope-filtered)
 *
 * super_admin has tenantId: null in the JWT — resolveTenant explicitly
 * bypasses tenant lookup for that role (see tenant.middleware.js), so
 * super_admin can hit every route here without a workspace.
 *
 * Register in app.js:
 *   import templateRoutes from './modules/templates/template.routes.js';
 *   app.use('/api/templates', templateRoutes);
 */

import { Router } from 'express';
import * as controller from './template.controller.js';
import {
  validateCreateTemplate,
  validateUpdateTemplate,
  validateListQuery,
  validateIdParam,
} from './template.validator.js';

import { authenticate }  from '../../shared/middlewares/auth.middleware.js';
import { resolveTenant } from '../../shared/middlewares/tenant.middleware.js';
import { requireModule } from '../../shared/middlewares/module.middleware.js';
import { requireRole }   from '../../shared/middlewares/role.middleware.js';

const router = Router();

// Apply auth + tenant resolution to ALL template routes
router.use(authenticate);
router.use(resolveTenant);
router.use(requireModule('templates')); // plan-gated: 'whatsapp_only' plans don't include this module

// ── Static routes BEFORE /:id — prevents Express treating "counts" as :id
router.get('/counts', controller.getCounts);

// ── Collection routes
router
  .route('/')
  .get(validateListQuery, controller.getTemplates)
  .post(requireRole('tenant_admin'), validateCreateTemplate, controller.createTemplate);

// ── Resource routes
router.get('/:id', validateIdParam, controller.getTemplate);
router.patch('/:id', requireRole('tenant_admin'), validateUpdateTemplate, controller.updateTemplate);
router.delete('/:id', requireRole('tenant_admin'), validateIdParam, controller.deleteTemplate);

router.post('/:id/duplicate', requireRole('sales_user'), validateIdParam, controller.duplicateTemplate);
router.get('/:id/versions', validateIdParam, controller.getVersions);

export default router;
