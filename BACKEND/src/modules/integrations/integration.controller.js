/**
 * Integration controller - thin HTTP layer only.
 * No business logic. Pattern matches automation.controller.js.
 *
 * FILE: src/modules/integrations/integration.controller.js
 */

import * as integrationService from './integration.service.js';
import { sendSuccess, sendPaginated } from '../../utils/apiResponse.js';
import asyncHandler from '../../utils/asyncHandler.js';

export const getCounts = asyncHandler(async (req, res) => {
  const filter = { status: req.query.status, search: req.query.search };
  const counts = await integrationService.getCategoryCounts(req.user.tenantId, filter);
  return sendSuccess(res, counts, 'Integration counts fetched successfully');
});

export const getIntegrations = asyncHandler(async (req, res) => {
  const filter = {
    category: req.query.category,
    status: req.query.status,
    search: req.query.search,
  };
  const options = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 50,
  };

  const result = await integrationService.listIntegrations(req.user.tenantId, filter, options, req.user.sub);
  return sendPaginated(res, result.integrations, result.pagination, 'Integrations fetched successfully');
});

export const getIntegration = asyncHandler(async (req, res) => {
  const integration = await integrationService.getIntegration(req.user.tenantId, req.params.id, req.user.sub);
  return sendSuccess(res, integration, 'Integration fetched successfully');
});

export const getErrorLogs = asyncHandler(async (req, res) => {
  const result = await integrationService.getErrorLogs(req.user.tenantId, req.params.id);
  return sendSuccess(res, result, 'Error logs fetched successfully');
});

export const toggleIntegration = asyncHandler(async (req, res) => {
  const integration = await integrationService.toggleIntegration(req.user.tenantId, req.user.sub, req.params.id);
  return sendSuccess(res, integration, 'Integration status toggled');
});

export const syncIntegration = asyncHandler(async (req, res) => {
  const integration = await integrationService.syncIntegration(req.user.tenantId, req.user.sub, req.params.id);
  return sendSuccess(res, integration, 'Integration synced successfully');
});

export const updateConfig = asyncHandler(async (req, res) => {
  const integration = await integrationService.updateIntegrationConfig(
    req.user.tenantId, req.user.sub, req.params.id, req.body.config
  );
  return sendSuccess(res, integration, 'Integration settings updated');
});