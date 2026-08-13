import { apiClient } from '@/lib/apiClient';
import type { Plan, CreatePlanInput, UpdatePlanInput } from '@/types/plan';

/**
 * Thin, typed functions -- one per backend route.
 * SOURCE: BACKEND/src/modules/plans/plan.controller.js
 */
export const plansApi = {
  /** Any authenticated user can list plans (e.g. Settings > Billing
   * browsing upgrade options) -- only mutations are super_admin-only. */
  list: (includeInactive = false) =>
    apiClient.get<Plan[]>('/plans', includeInactive ? { includeInactive: 'true' } : undefined),

  get: (id: string) => apiClient.get<Plan>(`/plans/${id}`),

  create: (data: CreatePlanInput) => apiClient.post<Plan>('/plans', data),

  update: (id: string, data: UpdatePlanInput) => apiClient.patch<Plan>(`/plans/${id}`, data),

  remove: (id: string) => apiClient.delete<null>(`/plans/${id}`),
};
