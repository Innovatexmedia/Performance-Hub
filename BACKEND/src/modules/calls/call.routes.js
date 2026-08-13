/**
 * Call Intelligence routes.
 * Pattern matches booking.routes.js exactly.
 *
 * ROUTE MAP:
 *   GET  /api/calls/kpis             → getKpis (all roles)
 *   GET  /api/calls/lead/:leadId     → getCallsByLead (all roles)
 *   GET  /api/calls                  → getCalls (all roles)
 *   POST /api/calls                  → createCall (sales_user+)
 *   GET  /api/calls/:id              → getCall (all roles)
 *   PATCH /api/calls/:id             → updateCall (sales_user+)
 *   POST /api/calls/:id/ai-summary   → regenerateAiSummary (sales_user+)
 *
 * Register in app.js:
 *   import callRoutes from './modules/calls/call.routes.js';
 *   app.use('/api/calls', callRoutes);
 */

import { Router } from 'express';
import * as controller from './call.controller.js';
import {
  validateCreateCall,
  validateUpdateCall,
  validateListQuery,
} from './call.validator.js';

import { authenticate }  from '../../shared/middlewares/auth.middleware.js';
import { resolveTenant } from '../../shared/middlewares/tenant.middleware.js';
import { requireModule } from '../../shared/middlewares/module.middleware.js';
import { requireRole }   from '../../shared/middlewares/role.middleware.js';

const router = Router();

// Apply auth + tenant resolution to ALL call routes
// Pattern matches booking.routes.js exactly
router.use(authenticate);
router.use(resolveTenant);
router.use(requireModule('calls')); // plan-gated: 'whatsapp_only' plans don't include this module

// ── Static routes BEFORE /:id — prevents Express treating "kpis"/"lead" as :id
// Pattern matches booking.routes.js ordering exactly
router.get('/kpis',          controller.getKpis);
router.get('/lead/:leadId',  controller.getCallsByLead);

// ── Collection routes
router
  .route('/')
  .get(validateListQuery,                             controller.getCalls)
  .post(requireRole('sales_user'), validateCreateCall, controller.createCall);

// ── Resource routes
router.get('/:id',                                                    controller.getCall);
router.patch('/:id',       requireRole('sales_user'), validateUpdateCall, controller.updateCall);
router.post('/:id/ai-summary', requireRole('sales_user'),             controller.regenerateAiSummary);

export default router;