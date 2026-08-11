/**
 * Settings routes.
 *
 * FILE: src/modules/settings/settings.routes.js
 *
 * SOURCE: FRONTEND_SPEC §19 Settings (10 tabs):
 *   Company · Branding · Lead Fields · Pipeline Stages · Qualification Questions
 *   · Scoring Rules · Notifications · Consent & Data · Billing · Security
 *
 * ROUTE MAP:
 *   GET  /api/settings                      — all 10 tabs data (page load)
 *   PATCH /api/settings/company             — save Company tab
 *   PATCH /api/settings/branding            — save Branding tab
 *   GET  /api/settings/lead-fields          — read-only lead fields list
 *   GET  /api/settings/pipeline-stages      — read-only pipeline stages
 *   PATCH /api/settings/qualification       — save Qualification Questions
 *   PATCH /api/settings/scoring-rules       — save Scoring Rules
 *   PATCH /api/settings/notifications       — save Notification toggles
 *   PATCH /api/settings/consent             — save Consent & Data
 *   GET  /api/settings/billing              — read billing info
 *   PATCH /api/settings/security            — save Security toggles
 *
 * PERMISSIONS:
 *   GET  routes  — all authenticated roles (read_only_user can view settings)
 *   PATCH routes — tenant_admin and above only
 *
 * Register in app.js:
 *   import settingsRoutes from './modules/settings/settings.routes.js';
 *   app.use('/api/settings', settingsRoutes);
 */

import { Router } from 'express';
import * as controller from './settings.controller.js';
import {
  validateCompany,
  validateBranding,
  validateLeadFields,
  validatePipelineStages,
  validateQualification,
  validateScoringRules,
  validateNotifications,
  validateConsent,
  validateSecurity,
} from './settings.validator.js';

import { authenticate }  from '../../shared/middlewares/auth.middleware.js';
import { resolveTenant } from '../../shared/middlewares/tenant.middleware.js';
import { requireRole }   from '../../shared/middlewares/role.middleware.js';

const router = Router();

// Auth on ALL settings routes
router.use(authenticate);
router.use(resolveTenant);

// ── Narrow, ungated cross-module reads ────────────────────────────────────────
// Deliberately NOT gated to tenant_admin -- see settings.service.js's
// comments on why these exist separately from the full, admin-gated
// settings bundle below (AI Qualification / the Pipeline board are both
// legitimately usable by sales_user+, which can't call GET /settings).
router.get('/qualification-questions', controller.getQualificationQuestions);
router.get('/pipeline-stages/board',   controller.getPipelineStagesPublic);
router.get('/branding/public',         controller.getBrandingPublic);

// ── Full settings page — GET all tabs at once ─────────────────────────────────
router.get('/', requireRole('tenant_admin'), controller.getAllSettings);

// ── Tab 1: Company ────────────────────────────────────────────────────────────
router.patch('/company',       requireRole('tenant_admin'), validateCompany,       controller.updateCompany);

// ── Tab 2: Branding ───────────────────────────────────────────────────────────
router.patch('/branding',      requireRole('tenant_admin'), validateBranding,      controller.updateBranding);

// ── Tab 3: Lead Fields (which are required) ───────────────────────────────────
router.get('/lead-fields',     requireRole('tenant_admin'), controller.getLeadFields);
router.patch('/lead-fields',   requireRole('tenant_admin'), validateLeadFields,    controller.updateLeadFields);

// ── Tab 4: Pipeline Stages (fixed keys; label/color editable) ────────────────
router.get('/pipeline-stages',   requireRole('tenant_admin'), controller.getPipelineStages);
router.patch('/pipeline-stages', requireRole('tenant_admin'), validatePipelineStages, controller.updatePipelineStages);

// ── Tab 5: Qualification Questions ───────────────────────────────────────────
router.patch('/qualification',  requireRole('tenant_admin'), validateQualification, controller.updateQualification);

// ── Tab 6: Scoring Rules ──────────────────────────────────────────────────────
router.patch('/scoring-rules',  requireRole('tenant_admin'), validateScoringRules,  controller.updateScoringRules);

// ── Tab 7: Notifications ──────────────────────────────────────────────────────
router.patch('/notifications',  requireRole('tenant_admin'), validateNotifications, controller.updateNotifications);

// ── Tab 8: Consent & Data ─────────────────────────────────────────────────────
router.patch('/consent',        requireRole('tenant_admin'), validateConsent,       controller.updateConsent);

// ── Tab 9: Billing (read-only — updated by payment webhooks) ─────────────────
router.get('/billing',          requireRole('tenant_admin'), controller.getBilling);

// ── Tab 10: Security ──────────────────────────────────────────────────────────
router.patch('/security',       requireRole('tenant_admin'), validateSecurity,      controller.updateSecurity);

export default router;