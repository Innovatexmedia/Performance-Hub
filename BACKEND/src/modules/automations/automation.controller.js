/**
 * Automation controller — thin HTTP layer only.
 * No business logic. Pattern matches call.controller.js / booking.controller.js.
 *
 * FILE: src/modules/automations/automation.controller.js
 */

import * as automationService from './automation.service.js';
import { sendSuccess, sendCreated, sendPaginated } from '../../utils/apiResponse.js';
import asyncHandler from '../../utils/asyncHandler.js';

/**
 * getKpis — GET /api/automations/kpis
 * KPI row: Total | Active | Inactive | Total Runs.
 * SOURCE: FRONTEND_SPEC.md §15 "Design: KPI row + automation cards."
 */
export const getKpis = asyncHandler(async (req, res) => {
  const kpis = await automationService.getKpiSummary(req.user.tenantId);
  return sendSuccess(res, kpis, 'Automation KPIs fetched successfully');
});

/**
 * createAutomation — POST /api/automations
 */
export const createAutomation = asyncHandler(async (req, res) => {
  const automation = await automationService.createAutomation(req.user.tenantId, req.user.sub, req.body);
  return sendCreated(res, automation, 'Automation created successfully');
});

/**
 * getAutomations — GET /api/automations
 * Supports: status, trigger, search, page, limit.
 */
export const getAutomations = asyncHandler(async (req, res) => {
  const filter = {
    status:  req.query.status,
    trigger: req.query.trigger,
    search:  req.query.search,
  };
  const options = {
    page:  parseInt(req.query.page)  || 1,
    limit: parseInt(req.query.limit) || 20,
  };

  const result = await automationService.listAutomations(req.user.tenantId, filter, options);
  return sendPaginated(res, result.automations, result.pagination, 'Automations fetched successfully');
});

/**
 * getAutomation — GET /api/automations/:id
 */
export const getAutomation = asyncHandler(async (req, res) => {
  const automation = await automationService.getAutomation(req.user.tenantId, req.params.id);
  return sendSuccess(res, automation, 'Automation fetched successfully');
});

// NOTE: updateAutomation / deleteAutomation were removed -- not named in
// any of the 3 spec documents' action lists for this module (see
// automation.routes.js header comment for the full explanation).

/**
 * toggleAutomation — POST /api/automations/:id/toggle
 * Flips active <-> inactive. SOURCE: DEVELOPER_HANDOFF.md §17 "toggleAutomation".
 */
export const toggleAutomation = asyncHandler(async (req, res) => {
  const automation = await automationService.toggleAutomation(req.user.tenantId, req.params.id, req.user.sub);
  return sendSuccess(res, automation, 'Automation status toggled');
});

/**
 * simulateAutomation — POST /api/automations/:id/simulate
 * SOURCE: DEVELOPER_HANDOFF.md §17 "simulate adds a log + run_count++".
 */
export const simulateAutomation = asyncHandler(async (req, res) => {
  const result = await automationService.simulateAutomation(
    req.user.tenantId, req.params.id, req.user.sub, req.body
  );
  return sendSuccess(res, result, 'Automation simulated successfully');
});

/**
 * getLogs — GET /api/automations/:id/logs
 */
export const getLogs = asyncHandler(async (req, res) => {
  const options = {
    page:  parseInt(req.query.page)  || 1,
    limit: parseInt(req.query.limit) || 20,
  };
  const result = await automationService.getLogs(req.user.tenantId, req.params.id, options);
  return sendPaginated(res, result.logs, result.pagination, 'Automation logs fetched successfully');
});