/**
 * Attribution routes.
 *
 * FILE: src/modules/attribution/attribution.routes.js
 *
 * ROUTE MAP:
 *   GET  /api/attribution/dashboard          — full page load (all data)
 *   GET  /api/attribution/kpis               — 4 KPI cards
 *   GET  /api/attribution/leads-by-source    — pie chart data
 *   GET  /api/attribution/revenue-by-source  — bar chart data
 *   GET  /api/attribution/bookings-by-source — bar chart data
 *   GET  /api/attribution/events-by-type     — donut/bar chart data
 *   GET  /api/attribution/source-to-revenue  — breakdown table
 *   GET  /api/attribution/events             — recent events table (paginated)
 *   GET  /api/attribution/export             — CSV export
 *   POST /api/attribution/events             — create tracking event
 *
 * Register in app.js:
 *   import attributionRoutes from './modules/attribution/attribution.routes.js';
 *   app.use('/api/attribution', attributionRoutes);
 */

import { Router } from 'express';
import * as controller from './attribution.controller.js';
import {
  validateCreateEvent,
  validateListQuery,
} from './attribution.validator.js';

import { authenticate }  from '../../shared/middlewares/auth.middleware.js';
import { resolveTenant } from '../../shared/middlewares/tenant.middleware.js';
import { requireModule } from '../../shared/middlewares/module.middleware.js';
import { requireRole }   from '../../shared/middlewares/role.middleware.js';

const router = Router();

// Auth on all attribution routes
router.use(authenticate);
router.use(resolveTenant);
router.use(requireModule('attribution')); // plan-gated: 'whatsapp_only' plans don't include this module

// ── Dashboard — full page in one call ────────────────────────────────────────
router.get('/dashboard',           controller.getDashboard);

// ── KPIs ─────────────────────────────────────────────────────────────────────
router.get('/kpis',                controller.getKpis);

// ── Charts ────────────────────────────────────────────────────────────────────
// Static routes before /events to prevent Express routing conflicts
router.get('/leads-by-source',     controller.getLeadsBySource);
router.get('/revenue-by-source',   controller.getRevenueBySource);
router.get('/bookings-by-source',  controller.getBookingsBySource);
router.get('/events-by-type',      controller.getEventsByType);
router.get('/source-to-revenue',   controller.getSourceToRevenue);

// ── CSV Export ────────────────────────────────────────────────────────────────
router.get('/export',              controller.exportCsv);

// ── Recent Events table + create event ───────────────────────────────────────
router
  .route('/events')
  .get(validateListQuery,                               controller.getRecentEvents)
  .post(requireRole('sales_user'), validateCreateEvent, controller.createEvent);

export default router;