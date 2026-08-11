/**
 * Settings controller — thin HTTP layer only.
 *
 * FILE: src/modules/settings/settings.controller.js
 * Pattern matches all other controllers exactly.
 */

import * as settingsService from './settings.service.js';
import { sendSuccess }      from '../../utils/apiResponse.js';
import asyncHandler         from '../../utils/asyncHandler.js';

/**
 * getAllSettings — GET /api/settings
 * Returns all 10 tabs data in one call.
 * SOURCE: FRONTEND_SPEC §19 Settings — full page load
 */
export const getAllSettings = asyncHandler(async (req, res) => {
  const data = await settingsService.getAllSettings(req.user.tenantId);
  return sendSuccess(res, data, 'Settings fetched successfully');
});

/**
 * getQualificationQuestions — GET /api/settings/qualification-questions
 * Narrow, ungated (below tenant_admin) endpoint for AI Qualification's
 * real cross-module read -- see settings.service.js's comment on why
 * this exists separately from the now admin-gated getAllSettings.
 */
export const getQualificationQuestions = asyncHandler(async (req, res) => {
  const data = await settingsService.getQualificationQuestions(req.user.tenantId);
  return sendSuccess(res, data, 'Qualification questions fetched successfully');
});

/**
 * updateCompany — PATCH /api/settings/company
 * SOURCE: FRONTEND_SPEC §19 Company tab — Company Name + Website + Save button
 */
export const updateCompany = asyncHandler(async (req, res) => {
  const data = await settingsService.updateCompany(req.user.tenantId, req.body, req.user);
  return sendSuccess(res, data, 'Company settings saved successfully');
});

/**
 * updateBranding — PATCH /api/settings/branding
 * SOURCE: FRONTEND_SPEC §19 Branding tab — Accent Color picker + Save
 */
export const updateBranding = asyncHandler(async (req, res) => {
  const data = await settingsService.updateBranding(req.user.tenantId, req.body, req.user);
  return sendSuccess(res, data, 'Branding settings saved successfully');
});

/**
 * getLeadFields — GET /api/settings/lead-fields
 * SOURCE: FRONTEND_SPEC §19 Lead Fields tab
 */
export const getLeadFields = asyncHandler(async (req, res) => {
  const data = await settingsService.getLeadFieldsConfig(req.user.tenantId);
  return sendSuccess(res, data, 'Lead fields fetched successfully');
});

/**
 * updateLeadFields — PATCH /api/settings/lead-fields
 * SOURCE: FRONTEND_SPEC §19 Lead Fields tab — which fields are required
 */
export const updateLeadFields = asyncHandler(async (req, res) => {
  const data = await settingsService.updateLeadFields(req.user.tenantId, req.body, req.user);
  return sendSuccess(res, data, 'Lead fields saved successfully');
});

/**
 * getPipelineStages — GET /api/settings/pipeline-stages
 * SOURCE: FRONTEND_SPEC §19 Pipeline Stages tab
 */
export const getPipelineStages = asyncHandler(async (req, res) => {
  const data = await settingsService.getPipelineStageOverrides(req.user.tenantId);
  return sendSuccess(res, data.stages, 'Pipeline stages fetched successfully');
});

/**
 * getPipelineStagesPublic — GET /api/settings/pipeline-stages/board
 * Narrow, ungated (below tenant_admin) read for the real Pipeline board
 * (sales_user+) -- same reasoning as getQualificationQuestions.
 */
export const getPipelineStagesPublic = asyncHandler(async (req, res) => {
  const data = await settingsService.getPipelineStageOverrides(req.user.tenantId);
  return sendSuccess(res, data.stages, 'Pipeline stages fetched successfully');
});

/**
 * updatePipelineStages — PATCH /api/settings/pipeline-stages
 * SOURCE: FRONTEND_SPEC §19 Pipeline Stages tab — rename/recolor + Save
 */
export const updatePipelineStages = asyncHandler(async (req, res) => {
  const data = await settingsService.updatePipelineStages(req.user.tenantId, req.body, req.user);
  return sendSuccess(res, data.stages, 'Pipeline stages saved successfully');
});

/**
 * updateQualification — PATCH /api/settings/qualification
 * SOURCE: FRONTEND_SPEC §19 Qualification Questions tab — add/remove + Save
 */
export const updateQualification = asyncHandler(async (req, res) => {
  const data = await settingsService.updateQualification(req.user.tenantId, req.body, req.user);
  return sendSuccess(res, data, 'Qualification questions saved successfully');
});

/**
 * updateScoringRules — PATCH /api/settings/scoring-rules
 * SOURCE: FRONTEND_SPEC §19 Scoring Rules tab — weight inputs + Save
 */
export const updateScoringRules = asyncHandler(async (req, res) => {
  const data = await settingsService.updateScoringRules(req.user.tenantId, req.body, req.user);
  return sendSuccess(res, data, 'Scoring rules saved successfully');
});

/**
 * updateNotifications — PATCH /api/settings/notifications
 * SOURCE: MASTER_SPEC §B19 "notification toggles"
 */
export const updateNotifications = asyncHandler(async (req, res) => {
  const data = await settingsService.updateNotifications(req.user.tenantId, req.body, req.user);
  return sendSuccess(res, data, 'Notification preferences saved successfully');
});

/**
 * updateConsent — PATCH /api/settings/consent
 * SOURCE: MASTER_SPEC §B19 "consent + retention"
 */
export const updateConsent = asyncHandler(async (req, res) => {
  const data = await settingsService.updateConsent(req.user.tenantId, req.body, req.user);
  return sendSuccess(res, data, 'Consent & data settings saved successfully');
});

/**
 * getBilling — GET /api/settings/billing
 * SOURCE: FRONTEND_SPEC §19 Billing tab — billing summary (read-only)
 */
export const getBilling = asyncHandler(async (req, res) => {
  const all  = await settingsService.getAllSettings(req.user.tenantId);
  return sendSuccess(res, all.billing, 'Billing information fetched successfully');
});

/**
 * updateSecurity — PATCH /api/settings/security
 * SOURCE: FRONTEND_SPEC §19 Security tab — 4 toggles
 */
export const updateSecurity = asyncHandler(async (req, res) => {
  const data = await settingsService.updateSecurity(req.user.tenantId, req.body, req.user);
  return sendSuccess(res, data, 'Security settings saved successfully');
});