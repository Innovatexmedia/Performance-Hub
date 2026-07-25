import { useAuthStore } from '@/store/authStore';
import { leadPermissions, dealPermissions, bookingPermissions, callPermissions, qualificationPermissions, campaignPermissions, paymentPermissions, automationPermissions, consentPermissions, isSuperAdmin } from '@/lib/permissions';

/**
 * usePermissions -- reads the CURRENT user's real role from authStore and
 * evaluates every permission against it, so components don't need to pass
 * `role` around manually. Extend this with a new namespaced section
 * (e.g. `pipeline: {...}`) as each module gets migrated to the real API --
 * same pattern, mirroring that module's actual backend role floors.
 */
export function usePermissions() {
  const role = useAuthStore((s) => s.user?.role);

  return {
    role,
    isSuperAdmin: isSuperAdmin(role),
    leads: {
      canCreate: leadPermissions.canCreate(role),
      canUpdate: leadPermissions.canUpdate(role),
      canAssign: leadPermissions.canAssign(role),
      canExport: leadPermissions.canExport(role),
      canDelete: leadPermissions.canDelete(role),
      canImport: leadPermissions.canImport(role),
    },
    pipeline: {
      canCreate: dealPermissions.canCreate(role),
      canUpdate: dealPermissions.canUpdate(role),
      canMove: dealPermissions.canMove(role),
      canDelete: dealPermissions.canDelete(role),
    },
    bookings: {
      canCreate: bookingPermissions.canCreate(role),
      canUpdateStatus: bookingPermissions.canUpdateStatus(role),
      canReschedule: bookingPermissions.canReschedule(role),
    },
    calls: {
      canCreate: callPermissions.canCreate(role),
      canUpdate: callPermissions.canUpdate(role),
      canRegenerateAiSummary: callPermissions.canRegenerateAiSummary(role),
    },
    qualification: {
      canRun: qualificationPermissions.canRun(role),
      canApply: qualificationPermissions.canApply(role),
      canOverride: qualificationPermissions.canOverride(role),
    },
    campaigns: {
      canCreate: campaignPermissions.canCreate(role),
    },
    payments: {
      canCreate: paymentPermissions.canCreate(role),
      canUpdate: paymentPermissions.canUpdate(role),
      canMarkPaid: paymentPermissions.canMarkPaid(role),
      canRefund: paymentPermissions.canRefund(role),
    },
    automations: {
      canCreate: automationPermissions.canCreate(role),
      canToggle: automationPermissions.canToggle(role),
      canSimulate: automationPermissions.canSimulate(role),
    },
    consent: {
      canCreate: consentPermissions.canCreate(role),
      canOptIn: consentPermissions.canOptIn(role),
      canOptOut: consentPermissions.canOptOut(role),
      canBlock: consentPermissions.canBlock(role),
      canUnblock: consentPermissions.canUnblock(role),
    },
    },
  };
}