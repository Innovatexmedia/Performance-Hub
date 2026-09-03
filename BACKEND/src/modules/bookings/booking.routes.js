import { Router } from 'express';
import * as controller from './booking.controller.js';
import {
  validateCreateBooking,
  validateUpdateBooking,
  validateUpdateStatus,
  validateReschedule,
  validateListQuery,
} from './booking.validator.js';

import { authenticate }  from '../../shared/middlewares/auth.middleware.js';
import { resolveTenant } from '../../shared/middlewares/tenant.middleware.js';
import { requireModule } from '../../shared/middlewares/module.middleware.js';
import { requireRole }   from '../../shared/middlewares/role.middleware.js';

const router = Router();

// Apply auth + tenant resolution to ALL booking routes
router.use(authenticate);
router.use(resolveTenant);
router.use(requireModule('bookings')); // plan-gated: 'whatsapp_only' plans don't include this module

// ── Static routes BEFORE /:id — prevents Express treating "kpis"/"lead" as :id
router.get('/kpis',           controller.getKpis);
router.get('/lead/:leadId',   controller.getBookingsByLead);

// ── Collection routes
router
  .route('/')
  .get(validateListQuery,                              controller.getBookings)
  .post(requireRole('sales_user'), validateCreateBooking, controller.createBooking);

// ── Resource routes
router.get('/:id',                                                 controller.getBooking);
router.patch('/:id',         requireRole('sales_user'), validateUpdateBooking, controller.updateBooking);
router.patch('/:id/status',  requireRole('sales_user'), validateUpdateStatus, controller.updateStatus);
router.post('/:id/reschedule', requireRole('sales_user'), validateReschedule,  controller.reschedule);

export default router;