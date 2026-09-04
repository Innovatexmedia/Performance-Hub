/**
 * Team routes.
 *
 * FILE: src/modules/team/team.routes.js
 *
 * SOURCE: FRONTEND_SPEC §17 Team page — Admin section
 *
 * ROUTE MAP:
 *   GET   /api/team              — list + KPI cards (tenant_admin+)
 *   POST  /api/team              — add member (tenant_admin+)
 *   GET   /api/team/:id          — single member (tenant_admin+)
 *   PATCH /api/team/:id/role     — change role (tenant_admin+)
 *   PATCH /api/team/:id/status   — activate/deactivate (tenant_admin+)
 *
 * PERMISSIONS: Team is an admin-only surface end to end -- sales_user and
 * read_only_user have no legitimate reason to view colleague role/status
 * data, so GET is now gated the same as every write action, not left open.
 *
 * Register in app.js:
 *   import teamRoutes from './modules/team/team.routes.js';
 *   app.use('/api/team', teamRoutes);
 */

import { Router } from 'express';
import * as controller from './team.controller.js';
import {
  validateAddMember,
  validateUpdateRole,
  validateSetStatus,
  validateUpdatePermissions,
} from './team.validator.js';

import { authenticate }  from '../../shared/middlewares/auth.middleware.js';
import { resolveTenant } from '../../shared/middlewares/tenant.middleware.js';
import { requireRole }   from '../../shared/middlewares/role.middleware.js';

const router = Router();

// Auth on ALL team routes
router.use(authenticate);
router.use(resolveTenant);

// ── Static routes before /:id ─────────────────────────────────────────────────

// Permission catalog + role-default lookups -- static paths, must be
// registered before '/:id' or Express would try to match "permissions"
// as a member ID.
router.get('/permissions/catalog', controller.getPermissionCatalog);
router.get('/permissions/role-default/:role', requireRole('tenant_admin'), controller.getRoleDefaultPermissions);

// Collection — GET all members + POST new member
router
  .route('/')
  .get(requireRole('tenant_admin'), controller.getTeamMembers)
  .post(requireRole('tenant_admin'), validateAddMember, controller.addTeamMember);

// ── Resource routes ───────────────────────────────────────────────────────────

// Single member
router.get('/:id', requireRole('tenant_admin'), controller.getTeamMember);

// Inline role change — tenant_admin and above
router.patch(
  '/:id/role',
  requireRole('tenant_admin'),
  validateUpdateRole,
  controller.updateRole
);

// Activate / Deactivate — tenant_admin and above
router.patch(
  '/:id/status',
  requireRole('tenant_admin'),
  validateSetStatus,
  controller.setStatus
);

// Delete — Tenant Owner only, and only if the member is already
// inactive with zero assigned leads (enforced in the service, not just
// here -- a role gate alone can't express "and only if..."). See
// team.service.js's deleteTeamMember.
router.delete('/:id', requireRole('tenant_owner'), controller.deleteMember);

// Granular permission overrides — tenant_admin and above
router.patch(
  '/:id/permissions',
  requireRole('tenant_admin'),
  validateUpdatePermissions,
  controller.updatePermissions
);

export default router;