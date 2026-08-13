/**
 * Payment routes.
 *
 * FILE: src/modules/payments/payment.routes.js
 *
 * ROUTE MAP:
 *   GET  /api/payments/kpis           — KPI cards + donut chart
 *   GET  /api/payments/export         — CSV export
 *   GET  /api/payments/lead/:leadId   — payments for a lead (lead drawer)
 *   GET  /api/payments                — paginated list
 *   POST /api/payments                — create payment link
 *   GET  /api/payments/:id            — single payment
 *   PATCH /api/payments/:id           — update (status change etc.)
 *   POST /api/payments/:id/mark-paid  — Mark Paid (fires all connected effects)
 *   POST /api/payments/:id/refund     — Refund
 *
 * Register in app.js:
 *   import paymentRoutes from './modules/payments/payment.routes.js';
 *   app.use('/api/payments', paymentRoutes);
 */

import { Router } from 'express';
import * as controller from './payment.controller.js';
import {
  validateCreatePayment,
  validateUpdatePayment,
  validateRefund,
  validateListQuery,
} from './payment.validator.js';

import { authenticate }  from '../../shared/middlewares/auth.middleware.js';
import { resolveTenant } from '../../shared/middlewares/tenant.middleware.js';
import { requireModule } from '../../shared/middlewares/module.middleware.js';
import { requireRole }   from '../../shared/middlewares/role.middleware.js';

const router = Router();

// Auth on ALL payment routes
router.use(authenticate);
router.use(resolveTenant);
router.use(requireModule('payments')); // plan-gated: 'whatsapp_only' plans don't include this module

// ── Static routes BEFORE /:id ─────────────────────────────────────────────────
router.get('/kpis',          controller.getKpis);
router.get('/export',        controller.exportCsv);
router.get('/lead/:leadId',  controller.getPaymentsByLead);

// ── Collection routes ─────────────────────────────────────────────────────────
router
  .route('/')
  .get(validateListQuery,                               controller.getPayments)
  .post(requireRole('sales_user'), validateCreatePayment, controller.createPayment);

// ── Resource routes ───────────────────────────────────────────────────────────
router.get('/:id',    controller.getPayment);

router.patch(
  '/:id',
  requireRole('sales_user'),
  validateUpdatePayment,
  controller.updatePayment
);

// Mark Paid — the key connected action
router.post(
  '/:id/mark-paid',
  requireRole('sales_user'),
  controller.markPaid
);

// Refund — only on Paid payments
router.post(
  '/:id/refund',
  requireRole('sales_user'),
  validateRefund,
  controller.refund
);

export default router;