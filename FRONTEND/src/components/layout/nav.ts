import type { AuthRole } from '@/types/auth';
import { atLeast } from '@/lib/permissions';

export interface NavItem {
  label: string;
  path: string;
  icon: string; // lucide icon name
  superAdminOnly?: boolean;
  /** Minimum role rank required to see this item at all -- reuses the same rank comparison every backend route guard is mirrored against in permissions.ts. */
  minRole?: AuthRole;
  group?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: 'LayoutDashboard', group: 'Revenue' },
  { label: 'Leads', path: '/leads', icon: 'Users', group: 'Revenue' },
  { label: 'WhatsApp Panel', path: '/whatsapp', icon: 'MessageCircle', group: 'Revenue' },
  { label: 'AI Qualification', path: '/qualification', icon: 'Sparkles', group: 'Revenue' },
  { label: 'Pipeline', path: '/pipeline', icon: 'KanbanSquare', group: 'Revenue' },
  { label: 'Nurture', path: '/nurture', icon: 'Workflow', group: 'Revenue' },
  { label: 'Calendar / Bookings', path: '/bookings', icon: 'CalendarDays', group: 'Revenue' },
  { label: 'Call Intelligence', path: '/calls', icon: 'PhoneCall', group: 'Revenue' },
  { label: 'Attribution', path: '/attribution', icon: 'Network', group: 'Growth' },
  { label: 'Campaigns', path: '/campaigns', icon: 'Megaphone', group: 'Growth' },
  { label: 'Payments', path: '/payments', icon: 'CreditCard', group: 'Growth' },
  { label: 'Reports', path: '/reports', icon: 'BarChart3', group: 'Growth' },
  { label: 'Automations', path: '/automations', icon: 'Zap', group: 'Growth' },
  { label: 'Templates', path: '/templates', icon: 'FileText', group: 'Growth' },
  // Team/Settings/Integrations require tenant_admin+ for EVERY write action
  // (confirmed against the real backend route guards) -- sales_user and
  // read_only_user have zero functionality on any of these three beyond
  // viewing, so they're hidden for those two roles rather than shown as
  // a purely read-only, all-disabled surface with nothing to do.
  { label: 'Team', path: '/team', icon: 'UserCog', minRole: 'tenant_admin', group: 'Admin' },
  { label: 'Integrations', path: '/integrations', icon: 'Plug', minRole: 'tenant_admin', group: 'Admin' },
  { label: 'Settings', path: '/settings', icon: 'Settings', minRole: 'tenant_admin', group: 'Admin' },
  { label: 'Super Admin Panel', path: '/super-admin', icon: 'ShieldCheck', superAdminOnly: true, group: 'Admin' },
];

export function visibleNav(role: AuthRole): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    // super_admin operates in a separate, tenant-less context (confirmed
    // against FRONTEND_SPEC §1/§20 and MASTER_SPEC B19 -- the Super Admin
    // Panel is described as a wholly separate destination, not an
    // addition to the tenant sidebar; and confirmed against the real
    // backend -- resolveTenant sets req.tenant = null for this role, so
    // every tenant module would silently render empty/broken data if
    // reached). This role only ever sees items explicitly marked
    // superAdminOnly -- checked first, so a high rank can't accidentally
    // clear a minRole check the way it used to.
    if (role === 'super_admin') return !!item.superAdminOnly;
    if (item.superAdminOnly) return false;
    if (item.minRole && !atLeast(role, item.minRole)) return false;
    return true;
  });
}