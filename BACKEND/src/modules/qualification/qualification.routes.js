/**
 * AI Qualification routes.
 * Pattern matches booking.routes.js and call.routes.js exactly.
 *
 * ROUTE MAP:
 *   POST  /api/qualification/run                   → runQualification (sales_user+)
 *   GET   /api/qualification                       → getQualifications (all roles)
 *   GET   /api/qualification/lead/:leadId          → getByLead (all roles)
 *   GET   /api/qualification/lead/:leadId/latest   → getLatestForLead (all roles)
 *   GET   /api/qualification/:id                   → getQualification (all roles)
 *   POST  /api/qualification/:id/apply             → applyResult (sales_user+)
 *   PATCH /api/qualification/:id/override          → overrideScore (sales_user+)
 *
 * Register in app.js:
 *   import qualificationRoutes from './modules/qualification/qualification.routes.js';
 *   app.use('/api/qualification', qualificationRoutes);
 */

import { Router } from 'express';
import * as controller from './qualification.controller.js';
import {
  validateRunQualification,
  validateApply,
  validateOverride,
  validateListQuery,
} from './qualification.validator.js';

import { authenticate }  from '../../shared/middlewares/auth.middleware.js';
import { resolveTenant } from '../../shared/middlewares/tenant.middleware.js';
import { requireModule } from '../../shared/middlewares/module.middleware.js';
import { requireRole }   from '../../shared/middlewares/role.middleware.js';

const router = Router();

// Apply auth + tenant resolution to ALL qualification routes
router.use(authenticate);
router.use(resolveTenant);
router.use(requireModule('qualification')); // plan-gated: 'whatsapp_only' plans don't include this module

// ── Static routes BEFORE /:id — prevents Express treating "run"/"lead" as :id
router.post('/run',                            requireRole('sales_user'), validateRunQualification, controller.runQualification);
router.get('/lead/:leadId',                    controller.getByLead);
router.get('/lead/:leadId/latest',             controller.getLatestForLead);

// ── Collection routes
router.get('/', validateListQuery, controller.getQualifications);

// ── Resource routes
router.get('/:id',                             controller.getQualification);
router.post('/:id/apply',  requireRole('sales_user'), validateApply,    controller.applyResult);
router.patch('/:id/override', requireRole('sales_user'), validateOverride, controller.overrideScore);

export default router;