/**
 * Reports routes.
 *
 * FILE: src/modules/reports/report.routes.js
 *
 * ROUTE MAP:
 *   GET /api/reports/lead              — Lead report
 *   GET /api/reports/pipeline          — Pipeline report
 *   GET /api/reports/attribution       — Attribution report (reuses attribution module)
 *   GET /api/reports/whatsapp          — WhatsApp report (reuses whatsappAnalytics module)
 *   GET /api/reports/campaign          — Campaign (marketing) report
 *   GET /api/reports/revenue           — Revenue report
 *   GET /api/reports/sales-activity    — Sales Activity report (per agent)
 *   GET /api/reports/nurture           — Nurture report (reuses whatsappAnalytics module)
 *   GET /api/reports/ai-qualification  — AI Qualification report
 *   GET /api/reports/export            — CSV export data (?tab=<tab> required)
 *
 * All 9 report tabs + export are readable by ANY authenticated role
 * (sales_user and above) — reports are dashboards, not data-mutating actions.
 * Pattern matches call.routes.js / attribution.routes.js exactly:
 * authenticate + resolveTenant applied to the whole router, no requireRole
 * needed for read-only GETs.
 *
 * Register in app.js:
 *   import reportRoutes from './modules/reports/report.routes.js';
 *   app.use('/api/reports', reportRoutes);
 */

import { Router } from 'express';
import * as controller from './report.controller.js';
import { validateReportQuery, validateExportQuery } from './report.validator.js';

import { authenticate }  from '../../shared/middlewares/auth.middleware.js';
import { resolveTenant } from '../../shared/middlewares/tenant.middleware.js';
import { requireModule } from '../../shared/middlewares/module.middleware.js';

const router = Router();

// Auth + tenant resolution on all report routes.
router.use(authenticate);
router.use(resolveTenant);
router.use(requireModule('reports')); // plan-gated: 'whatsapp_only' plans don't include this module

// ── Export — static path, declared before nothing conflicts but kept first
//    for clarity alongside the other static tab routes. ─────────────────────
router.get('/export', validateExportQuery, controller.exportReport);

// ── 9 report tabs ──────────────────────────────────────────────────────────
router.get('/lead',             validateReportQuery, controller.getLeadReport);
router.get('/pipeline',         validateReportQuery, controller.getPipelineReport);
router.get('/attribution',      validateReportQuery, controller.getAttributionReport);
router.get('/whatsapp',         validateReportQuery, controller.getWhatsAppReport);
router.get('/campaign',         validateReportQuery, controller.getCampaignReport);
router.get('/revenue',          validateReportQuery, controller.getRevenueReport);
router.get('/sales-activity',   validateReportQuery, controller.getSalesActivityReport);
router.get('/nurture',          controller.getNurtureReport);
router.get('/ai-qualification', validateReportQuery, controller.getAiQualificationReport);

export default router;
