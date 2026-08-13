import { apiClient } from '@/lib/apiClient';
import type {
  PlatformDashboard, PlatformTenant, TenantDetail, CreateTenantInput,
  PlatformUser, IntegrationHealthRow, ActivityLogEntry, GlobalTemplate, Pagination,
} from '@/types/superAdmin';

/**
 * SOURCE: src/modules/superAdmin/superAdmin.controller.js
 * Standard envelope, mounted at /super-admin.
 */
export const superAdminApi = {
  getDashboard: () => apiClient.get<PlatformDashboard>('/super-admin/dashboard'),

  listTenants: (query?: { search?: string; plan?: string; status?: string; page?: number; limit?: number }) =>
    apiClient.get<{ tenants: PlatformTenant[]; pagination: Pagination }>('/super-admin/tenants', query as Record<string, string | number | undefined>),

  getTenant: (id: string) => apiClient.get<TenantDetail>(`/super-admin/tenants/${id}`),

  createTenant: (data: CreateTenantInput) =>
    apiClient.post<{ tenant: PlatformTenant }>('/super-admin/tenants', data).then((r) => r.tenant),

  updateTenant: (id: string, data: Partial<Pick<PlatformTenant, 'name' | 'mrr' | 'maxUsers' | 'maxLeads' | 'maxCampaigns' | 'maxWorkspaces'>> & { planId?: string }) =>
    apiClient.patch<{ tenant: PlatformTenant }>(`/super-admin/tenants/${id}`, data).then((r) => r.tenant),

  suspendTenant: (id: string) => apiClient.post<{ tenant: PlatformTenant }>(`/super-admin/tenants/${id}/suspend`).then((r) => r.tenant),

  reactivateTenant: (id: string) => apiClient.post<{ tenant: PlatformTenant }>(`/super-admin/tenants/${id}/reactivate`).then((r) => r.tenant),

  listUsers: (query?: { search?: string; role?: string; status?: string; page?: number; limit?: number }) =>
    apiClient.get<{ users: PlatformUser[]; pagination: Pagination }>('/super-admin/users', query as Record<string, string | number | undefined>),

  getIntegrationHealth: () => apiClient.get<{ integrations: IntegrationHealthRow[] }>('/super-admin/integration-health').then((r) => r.integrations),

  getActivityLog: (query?: { event?: string; page?: number; limit?: number }) =>
    apiClient.get<{ logs: ActivityLogEntry[]; pagination: Pagination }>('/super-admin/activity-log', query as Record<string, string | number | undefined>),

  listGlobalTemplates: () => apiClient.get<{ templates: GlobalTemplate[] }>('/super-admin/templates').then((r) => r.templates),
};