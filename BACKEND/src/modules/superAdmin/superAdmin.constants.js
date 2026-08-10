/**
 * =============================================================================
 * InnovateX Revenue OS — Super Admin Constants
 * =============================================================================
 * SOURCE: MASTER_SPEC.md B19, FRONTEND_SPEC.md §20 -- exactly 5 tabs:
 * Tenants (create/edit/suspend -- NOT delete, spec doesn't call for it),
 * All Users, Integration Health, Global Activity Log, Global Templates.
 * No "platform settings" tab exists in spec -- not built.
 * =============================================================================
 */

export const SUPER_ADMIN_AUDIT_EVENTS = Object.freeze({
  TENANT_CREATED:   'tenant_created',
  TENANT_UPDATED:   'tenant_updated',
  TENANT_SUSPENDED: 'tenant_suspended',
  TENANT_REACTIVATED: 'tenant_reactivated',
});