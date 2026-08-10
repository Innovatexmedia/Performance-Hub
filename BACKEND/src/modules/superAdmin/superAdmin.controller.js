/**
 * =============================================================================
 * InnovateX Revenue OS — Super Admin Controller
 * =============================================================================
 * FILE: src/modules/superAdmin/superAdmin.controller.js
 * =============================================================================
 */

import * as superAdminService from './superAdmin.service.js';
import { sendSuccess, sendCreated } from '../../utils/apiResponse.js';
import asyncHandler from '../../utils/asyncHandler.js';

export const getDashboard = asyncHandler(async (req, res) => {
  const dashboard = await superAdminService.getPlatformDashboard();
  return sendSuccess(res, dashboard, 'Platform dashboard retrieved');
});

export const listTenants = asyncHandler(async (req, res) => {
  const { page, limit, ...query } = req.query;
  const result = await superAdminService.listTenants(query, { page, limit });
  return sendSuccess(res, result, 'Tenants retrieved');
});

export const getTenant = asyncHandler(async (req, res) => {
  const result = await superAdminService.getTenantDetail(req.params.id);
  return sendSuccess(res, result, 'Tenant retrieved');
});

export const createTenant = asyncHandler(async (req, res) => {
  const tenant = await superAdminService.createTenant(req.body, req.user.sub);
  return sendCreated(res, { tenant }, 'Tenant created');
});

export const updateTenant = asyncHandler(async (req, res) => {
  const tenant = await superAdminService.updateTenant(req.params.id, req.body);
  return sendSuccess(res, { tenant }, 'Tenant updated');
});

export const suspendTenant = asyncHandler(async (req, res) => {
  const tenant = await superAdminService.suspendTenant(req.params.id);
  return sendSuccess(res, { tenant }, 'Tenant suspended');
});

export const reactivateTenant = asyncHandler(async (req, res) => {
  const tenant = await superAdminService.reactivateTenant(req.params.id);
  return sendSuccess(res, { tenant }, 'Tenant reactivated');
});

export const listAllUsers = asyncHandler(async (req, res) => {
  const { page, limit, ...query } = req.query;
  const result = await superAdminService.listAllUsers(query, { page, limit });
  return sendSuccess(res, result, 'Users retrieved');
});

export const getIntegrationHealth = asyncHandler(async (req, res) => {
  const result = await superAdminService.getIntegrationHealth();
  return sendSuccess(res, result, 'Integration health retrieved');
});

export const getActivityLog = asyncHandler(async (req, res) => {
  const { page, limit, ...query } = req.query;
  const result = await superAdminService.getGlobalActivityLog(query, { page, limit });
  return sendSuccess(res, result, 'Activity log retrieved');
});

export const listGlobalTemplates = asyncHandler(async (req, res) => {
  const result = await superAdminService.listGlobalTemplates();
  return sendSuccess(res, result, 'Global templates retrieved');
});