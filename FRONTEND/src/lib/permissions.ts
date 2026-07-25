import type { AuthRole } from '@/types/auth';

/**
 * Frontend permission layer -- a single source of truth for "can this role
 * do X", mirroring the backend's REAL enforcement exactly (not guessed).
 * When the backend changes a role floor, this file should change with it.
 *
 * Why this exists: before this file, the only role-based UI logic anywhere
 * in the app was one boolean hiding the Super Admin nav link. Every button
 * (Add Lead, Import CSV, Archive...) rendered identically for every role,
 * and the backend's 403 was the only real guardrail -- meaning a
 * read_only_user could see and click "Delete" and only find out it was
 * blocked after the request failed.
 */

const RANK: Record<AuthRole, number> = {
  super_admin: 5,
  tenant_owner: 4,
  tenant_admin: 3,
  sales_user: 2,
  read_only_user: 1,
};

/** True if `role` is at or above `floor` in the hierarchy -- mirrors hasRole() in roles.js. */
export function atLeast(role: AuthRole | null | undefined, floor: AuthRole): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[floor];
}

/**
 * Leads permissions -- mirrors src/shared/permissions/lead.permissions.js
 * EXACTLY (the backend's own action-based matrix, not a route-floor guess):
 *
 *   super_admin / tenant_owner / tenant_admin -> everything
 *   sales_user                                -> read, create, update, assign, export (NOT delete, NOT import)
 *   read_only_user                            -> read, export ONLY
 */
export const leadPermissions = {
  canCreate: (role: AuthRole | null | undefined) => atLeast(role, 'sales_user'),
  canUpdate: (role: AuthRole | null | undefined) => atLeast(role, 'sales_user'),
  canAssign: (role: AuthRole | null | undefined) => atLeast(role, 'sales_user'),
  /** Every role including read_only_user can export -- this one is deliberately NOT gated. */
  canExport: (_role: AuthRole | null | undefined) => true,
  canDelete: (role: AuthRole | null | undefined) => atLeast(role, 'tenant_admin'),
  canImport: (role: AuthRole | null | undefined) => atLeast(role, 'tenant_admin'),
};

/**
 * Pipeline/Deal permissions -- mirrors src/shared/permissions/pipeline.permissions.js
 * EXACTLY:
 *
 *   super_admin / tenant_owner / tenant_admin -> everything
 *   sales_user                                -> read, create, update, move (NOT delete)
 *   read_only_user                             -> read ONLY
 */
export const dealPermissions = {
  canCreate: (role: AuthRole | null | undefined) => atLeast(role, 'sales_user'),
  canUpdate: (role: AuthRole | null | undefined) => atLeast(role, 'sales_user'),
  canMove: (role: AuthRole | null | undefined) => atLeast(role, 'sales_user'),
  canDelete: (role: AuthRole | null | undefined) => atLeast(role, 'tenant_admin'),
};

/**
 * Booking permissions -- mirrors booking.routes.js exactly:
 *
 *   GET routes have no requireRole() at all -- any authenticated role can read.
 *   POST /, PATCH /:id/status, POST /:id/reschedule all require sales_user+.
 *   There is NO delete/cancel endpoint on this backend at all.
 */
export const bookingPermissions = {
  canCreate: (role: AuthRole | null | undefined) => atLeast(role, 'sales_user'),
  canUpdateStatus: (role: AuthRole | null | undefined) => atLeast(role, 'sales_user'),
  canReschedule: (role: AuthRole | null | undefined) => atLeast(role, 'sales_user'),
};

/**
 * Call permissions -- mirrors call.routes.js exactly:
 *   GET routes: no requireRole -- any authenticated role can read.
 *   POST /, PATCH /:id, POST /:id/ai-summary all require sales_user+.
 *   No delete endpoint exists.
 */
export const callPermissions = {
  canCreate: (role: AuthRole | null | undefined) => atLeast(role, 'sales_user'),
  canUpdate: (role: AuthRole | null | undefined) => atLeast(role, 'sales_user'),
  canRegenerateAiSummary: (role: AuthRole | null | undefined) => atLeast(role, 'sales_user'),
};

/**
 * Qualification permissions -- mirrors qualification.routes.js exactly:
 *   GET routes: no requireRole -- any authenticated role can read.
 *   POST /run, POST /:id/apply, PATCH /:id/override all require sales_user+.
 */
export const qualificationPermissions = {
  canRun: (role: AuthRole | null | undefined) => atLeast(role, 'sales_user'),
  canApply: (role: AuthRole | null | undefined) => atLeast(role, 'sales_user'),
  canOverride: (role: AuthRole | null | undefined) => atLeast(role, 'sales_user'),
};

/**
 * Consent permissions -- mirrors consent.constants.js's ROLE_MIN exactly
 * (see consent.routes.js, which applies each floor per-endpoint):
 *
 *   CREATE, READ, VERIFY, OPT_IN, OPT_OUT, HISTORY -> sales_user+
 *   BLOCK, UNBLOCK                                  -> tenant_admin+
 */
export const consentPermissions = {
  canCreate: (role: AuthRole | null | undefined) => atLeast(role, 'sales_user'),
  canOptIn: (role: AuthRole | null | undefined) => atLeast(role, 'sales_user'),
  canOptOut: (role: AuthRole | null | undefined) => atLeast(role, 'sales_user'),
  canBlock: (role: AuthRole | null | undefined) => atLeast(role, 'tenant_admin'),
  canUnblock: (role: AuthRole | null | undefined) => atLeast(role, 'tenant_admin'),
};

/**
 * super_admin-only gate -- used for nav visibility. This is the ONE case
 * where hiding an entire section (not just an action) is correct, because
 * Super Admin routes operate in a fundamentally different, tenant-less
 * context -- not merely "restricted", but inapplicable to any other role.
 */
export const isSuperAdmin = (role: AuthRole | null | undefined): boolean => role === 'super_admin';