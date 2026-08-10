/**
 * Team controller — thin HTTP layer only.
 *
 * FILE: src/modules/team/team.controller.js
 * Pattern matches booking.controller.js exactly.
 *
 * ENDPOINTS:
 *   GET   /api/team          — list all team members + KPI cards
 *   POST  /api/team          — add new team member
 *   GET   /api/team/:id      — single member with assigned leads count
 *   PATCH /api/team/:id/role — inline role change
 *   PATCH /api/team/:id/status — activate or deactivate
 */

import * as teamService from './team.service.js';
import { sendSuccess, sendCreated } from '../../utils/apiResponse.js';
import asyncHandler from '../../utils/asyncHandler.js';

/**
 * getTeamMembers — GET /api/team
 * Returns { members, kpis } for the Team page.
 * SOURCE: FRONTEND_SPEC §17:
 *   KPI cards: Team Members | Active | Sales Users | Admins
 *   Table: User | Role | Status | Assigned Leads | Last Active | Actions
 */
export const getTeamMembers = asyncHandler(async (req, res) => {
  const result = await teamService.getTeamMembers(req.user.tenantId);
  return sendSuccess(res, result, 'Team members fetched successfully');
});

/**
 * getTeamMember — GET /api/team/:id
 * Single member with assigned lead count.
 */
export const getTeamMember = asyncHandler(async (req, res) => {
  const member = await teamService.getTeamMember(
    req.params.id,
    req.user.tenantId
  );
  return sendSuccess(res, { member }, 'Team member fetched successfully');
});

/**
 * addTeamMember — POST /api/team
 * Add User modal: First Name | Last Name | Email | Role
 * SOURCE: FRONTEND_SPEC §17 "+ Add User" button → modal
 */
export const addTeamMember = asyncHandler(async (req, res) => {
  const member = await teamService.addTeamMember(req.body, req.user);
  return sendCreated(res, { member }, 'Team member added successfully');
});

/**
 * updateRole — PATCH /api/team/:id/role
 * Inline role change from the Role dropdown in the table.
 * SOURCE: FRONTEND_SPEC §17 "inline role change"
 */
export const updateRole = asyncHandler(async (req, res) => {
  const member = await teamService.updateMemberRole(
    req.params.id,
    req.body.role,
    req.user
  );
  return sendSuccess(res, { member }, 'Role updated successfully');
});

/**
 * setStatus — PATCH /api/team/:id/status
 * Activate or deactivate a team member.
 * SOURCE: FRONTEND_SPEC §17 "Deactivate" button in Actions column
 */
export const setStatus = asyncHandler(async (req, res) => {
  const member = await teamService.setMemberStatus(
    req.params.id,
    req.body.status,
    req.user
  );
  return sendSuccess(
    res,
    { member },
    `Member ${req.body.status === 'active' ? 'activated' : 'deactivated'} successfully`
  );
});

/**
 * updatePermissions — PATCH /api/team/:id/permissions
 * Full replace of a member's granular permission set (beyond their role
 * default). Powers the Team page's permissions modal.
 */
export const updatePermissions = asyncHandler(async (req, res) => {
  const member = await teamService.updateMemberPermissions(
    req.params.id,
    req.body.permissions,
    req.user
  );
  return sendSuccess(res, { member }, 'Permissions updated successfully');
});

/**
 * getPermissionCatalog — GET /api/team/permissions/catalog
 * Every grantable permission, grouped + labeled, for the permissions
 * modal's checklist. Static/no DB lookup.
 */
export const getPermissionCatalog = asyncHandler(async (req, res) => {
  const catalog = teamService.getPermissionCatalog();
  return sendSuccess(res, { catalog }, 'Permission catalog fetched successfully');
});

/**
 * getRoleDefaultPermissions — GET /api/team/permissions/role-default/:role
 * Lets the modal offer "reset to role default".
 */
export const getRoleDefaultPermissions = asyncHandler(async (req, res) => {
  const permissions = teamService.getRoleDefaultPermissions(req.params.role);
  return sendSuccess(res, { permissions }, 'Role default permissions fetched successfully');
});