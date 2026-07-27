import { apiClient } from '@/lib/apiClient';
import type { DashboardData } from '@/types/dashboard';

/**
 * SOURCE: src/modules/dashboard/dashboard.controller.js
 * Standard envelope. Only the combined GET / is used -- the individual
 * per-section endpoints (kpis/charts/activity/etc.) exist on the backend
 * for polling/refresh use cases the current page doesn't need.
 */
export const dashboardApi = {
  getAll: () => apiClient.get<DashboardData>('/dashboard'),
};