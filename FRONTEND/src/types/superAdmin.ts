/**
 * Super Admin types -- match the real backend exactly.
 * SOURCE: src/modules/superAdmin/superAdmin.service.js + .controller.js
 */
import type { AuthRole } from './auth';

export interface PlatformDashboard {
  totalTenants: number;
  activeTenants: number;
  totalUsers: number;
  mrr: number;
  tenantsByPlan: Record<string, number>;
  tenantsByStatus: Record<string, number>;
}

/** No longer a fixed set -- plan keys are dynamic now (Super Admin can
 * add/remove plans). Kept as `string` rather than deleted so existing
 * call sites reading `.plan` for display don't all need a type change. */
export type TenantPlan = string;
export type TenantSubscriptionStatus = 'trial' | 'active' | 'inactive' | 'suspended' | 'cancelled';

export interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  ownerName: string;
  ownerEmail: string;
  plan: TenantPlan;
  planId: string | null;
  planTrack: 'full' | 'whatsapp_only';
  subscriptionStatus: TenantSubscriptionStatus;
  mrr: number;
  maxUsers: number;
  maxLeads: number;
  maxCampaigns: number;
  maxWorkspaces: number;
  currentUserCount: number;
  currentLeadCount: number;
  createdAt: string;
}

export interface TenantMember {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: AuthRole;
  joinedAt: string;
}

export interface TenantDetail {
  tenant: PlatformTenant;
  userCount: number;
  members: TenantMember[];
}

export interface CreateTenantInput {
  workspaceName: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerEmail: string;
  ownerPassword: string;
  planId?: string;
}

export interface PlatformUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: AuthRole;
  status: string;
  tenantName: string | null;
  tenantId: string | null;
  lastLogin: string | null;
  createdAt: string;
}

export interface IntegrationHealthRow {
  _id: string;
  name: string;
  category: string;
  connected: number;
  simulation: number;
  disconnected: number;
  total: number;
}

export interface ActivityLogEntry {
  id: string;
  userId: string;
  tenantId: string | null;
  email: string;
  event: string;
  success: boolean;
  failureReason: string | null;
  ip: string | null;
  createdAt: string;
}

export interface GlobalTemplate {
  id: string;
  name: string;
  type: string;
  scope: 'global';
  version: number;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}