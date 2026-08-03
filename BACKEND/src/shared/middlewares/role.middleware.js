/**
 * =============================================================================
 * InnovateX Revenue OS — Role Middleware
 * =============================================================================
 *
 * FILE: src/shared/middlewares/role.middleware.js
 *
 * PURPOSE
 * ───────
 * Guards routes by minimum role rank.
 * Must be used AFTER authenticate middleware (requires req.user).
 *
 * USAGE
 * ─────
 * router.delete('/tenants/:id',
 *   authenticate,
 *   requireRole('super_admin'),
 *   tenantController.delete
 * );
 *
 * router.post('/leads',
 *   authenticate,
 *   requireRole('sales_user'),  // sales_user and above
 *   leadController.create
 * );
 * =============================================================================
 */

import { hasRole } from '../../modules/auth/constants/roles.js';
import AppError    from '../../utils/AppError.js';

/**
 * requireRole — allows access if req.user.role meets or exceeds the minimum role.
 * Uses ROLE_HIERARCHY for comparison (higher rank = more access).
 *
 * @param {...string} roles — one or more role strings (OR logic — any one is sufficient)
 */
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401));
  }

  const userRole = req.user.role;

  // Check if user's role meets ANY of the specified minimum roles
  const hasAccess = roles.some((requiredRole) => hasRole(userRole, requiredRole));

  if (!hasAccess) {
    return next(
      new AppError(
        `Access denied. Required role: ${roles.join(' or ')}. Your role: ${userRole}`,
        403
      )
    );
  }

  next();
};

/**
 * requireRoleOrPermission — passes if EITHER the normal role-rank gate
 * (requireRole's hasRole check) OR the user's own permissions array
 * contains the given permission string.
 *
 * Why this exists: requireRole alone means an owner's custom permission
 * grant to a lower-ranked user (e.g. giving one specific sales_user
 * APPROVE_CAMPAIGNS) would be silently useless -- the route would still
 * reject them by rank before the request ever reaches code that checks
 * permissions. This is the piece that makes that grant actually work.
 *
 * @param {string} minRole - minimum role rank that passes regardless of permissions
 * @param {string} permission - a PERMISSIONS.* value that also passes, at any rank
 */
export const requireRoleOrPermission = (minRole, permission) => (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401));
  }

  const roleOk = hasRole(req.user.role, minRole);
  const permissionOk = (req.user.permissions || []).includes(permission);

  if (!roleOk && !permissionOk) {
    return next(
      new AppError(
        `Access denied. Required role: ${minRole} or permission: ${permission}. Your role: ${req.user.role}`,
        403
      )
    );
  }

  next();
};
export const requireExactRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401));
  }

  if (!roles.includes(req.user.role)) {
    return next(
      new AppError(`Access denied. This action is restricted to: ${roles.join(', ')}`, 403)
    );
  }

  next();
};