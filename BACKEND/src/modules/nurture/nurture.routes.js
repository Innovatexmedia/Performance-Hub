/**
 * Nurture routes.
 * Pattern matches call.routes.js / booking.routes.js exactly.
 *
 * FILE: src/modules/nurture/nurture.routes.js
 *
 * ROUTE MAP:
 *   GET   /api/nurture/kpis              — KPI row (all roles)
 *   GET   /api/nurture/enrollments       — list enrollments (all roles)
 *   GET   /api/nurture/enrollments/:id   — get single enrollment (all roles)
 *   GET   /api/nurture                   — list sequences (all roles)
 *   POST  /api/nurture                   — create sequence (tenant_admin+)
 *   GET   /api/nurture/:id               — get single sequence (all roles)
 *   PATCH /api/nurture/:id               — update sequence (tenant_admin+)
 *   DELETE /api/nurture/:id              — delete sequence (tenant_admin+)
 *   POST  /api/nurture/:id/toggle        — activate/pause (tenant_admin+)
 *   POST  /api/nurture/:id/assign        — enroll a lead (sales_user+)
 *
 * Route order matters: /kpis and /enrollments (+ /enrollments/:id) are
 * declared BEFORE the generic /:id sequence routes so Express does not
 * treat "kpis" or "enrollments" as a sequence :id.
 *
 * Register in app.js:
 *   import nurtureRoutes from './modules/nurture/nurture.routes.js';
 *   app.use('/api/nurture', nurtureRoutes);
 */

import { Router } from 'express';
import * as controller from './nurture.controller.js';
import {
  validateCreateSequence,
  validateUpdateSequence,
  validateListQuery,
  validateIdParam,
  validateAssignSequence,
  validateListEnrollmentsQuery,
} from './nurture.validator.js';

import { authenticate }  from '../../shared/middlewares/auth.middleware.js';
import { resolveTenant } from '../../shared/middlewares/tenant.middleware.js';
import { requireModule } from '../../shared/middlewares/module.middleware.js';
import { requireRole }   from '../../shared/middlewares/role.middleware.js';

const router = Router();

// Apply auth + tenant resolution to ALL nurture routes
router.use(authenticate);
router.use(resolveTenant);
router.use(requireModule('nurture')); // plan-gated: 'whatsapp_only' plans don't include this module

// ── Static routes BEFORE /:id — prevents Express treating
//    "kpis"/"enrollments" as a sequence :id
router.get('/kpis', controller.getKpis);
router.get('/enrollments', validateListEnrollmentsQuery, controller.getEnrollments);
router.get('/enrollments/:id', controller.getEnrollment);

// ── Collection routes (sequences)
router
  .route('/')
  .get(validateListQuery, controller.getSequences)
  .post(requireRole('tenant_admin'), validateCreateSequence, controller.createSequence);

// ── Resource routes (sequences)
router.get('/:id', validateIdParam, controller.getSequence);
router.patch('/:id', requireRole('tenant_admin'), validateUpdateSequence, controller.updateSequence);
router.delete('/:id', requireRole('tenant_admin'), validateIdParam, controller.deleteSequence);

router.post('/:id/toggle', requireRole('tenant_admin'), validateIdParam, controller.toggleSequence);
router.post('/:id/assign', requireRole('sales_user'), validateAssignSequence, controller.assignSequence);

export default router;
