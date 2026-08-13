/**
 * Campaign routes.
 *
 * FILE: src/modules/campaigns/campaign.routes.js
 *
 * SCOPE NOTE: trimmed to match the spec EXACTLY -- MASTER_SPEC.md B11 and
 * DEVELOPER_HANDOFF.md's action table both name exactly ONE write action
 * for this module: `createMarketingCampaign`. No update, delete, or
 * regenerate-link action is named anywhere in any of the three spec docs
 * for marketing campaigns (contrast with e.g. Generic Templates, which
 * explicitly lists BOTH createGenericTemplate and deleteGenericTemplate --
 * when the spec wants multiple actions on a module it says so). Those
 * three endpoints existed in an earlier build of this backend and have
 * been removed to align with spec. If you want them back later, they were
 * straightforward CRUD -- easy to re-add.
 *
 * ROUTE MAP:
 *   GET  /api/campaigns/kpis    — 4 KPI cards
 *   GET  /api/campaigns/chart   — Revenue by Campaign bar chart
 *   GET  /api/campaigns/export  — CSV export data
 *   GET  /api/campaigns         — list (paginated + filtered)
 *   POST /api/campaigns         — create new campaign (generates UTM link once)
 *   GET  /api/campaigns/:id     — single campaign
 *
 * Register in app.js:
 *   import campaignRoutes from './modules/campaigns/campaign.routes.js';
 *   app.use('/api/campaigns', campaignRoutes);
 */

import { Router } from 'express';
import * as controller from './campaign.controller.js';
import {
  validateCreateCampaign,
  validateListQuery,
} from './campaign.validator.js';

import { authenticate }  from '../../shared/middlewares/auth.middleware.js';
import { resolveTenant } from '../../shared/middlewares/tenant.middleware.js';
import { requireModule } from '../../shared/middlewares/module.middleware.js';
import { requireRole }   from '../../shared/middlewares/role.middleware.js';

const router = Router();

// Auth on ALL campaign routes
router.use(authenticate);
router.use(resolveTenant);
router.use(requireModule('campaigns')); // plan-gated: 'whatsapp_only' plans don't include this module

// ── Static routes BEFORE /:id — prevents Express treating "kpis"/"chart"/"export" as :id
router.get('/kpis',   controller.getKpis);
router.get('/chart',  controller.getChartData);
router.get('/export', controller.exportCsv);

// ── Collection routes
router
  .route('/')
  .get(validateListQuery,                                   controller.getCampaigns)
  .post(requireRole('tenant_admin'), validateCreateCampaign, controller.createCampaign);

// ── Resource routes
router.get('/:id', controller.getCampaign);

export default router;