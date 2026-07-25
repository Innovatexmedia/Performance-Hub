import { apiClient } from '@/lib/apiClient';
import type {
  Automation, CreateAutomationInput, AutomationKpis, SimulateResult, AutomationLogEntry,
} from '@/types/automation';

/**
 * SOURCE: src/modules/automations/automation.controller.js
 * Standard envelope. Trimmed to exactly the 3 spec-named actions
 * (create/toggle/simulate) plus reads -- no update, no delete.
 */
export const automationsApi = {
  list: (query?: { status?: string; trigger?: string; search?: string; page?: number; limit?: number }) =>
    apiClient.getPaginated<Automation>('/automations', query as Record<string, string | number | undefined>),

  getKpis: () => apiClient.get<AutomationKpis>('/automations/kpis'),

  get: (id: string) => apiClient.get<Automation>(`/automations/${id}`),

  create: (input: CreateAutomationInput) =>
    apiClient.post<Automation>('/automations', input),

  toggle: (id: string) => apiClient.post<Automation>(`/automations/${id}/toggle`),

  simulate: (id: string, context?: Record<string, unknown>, leadId?: string) =>
    apiClient.post<SimulateResult>(`/automations/${id}/simulate`, { context, leadId }),

  getLogs: (id: string, query?: { page?: number; limit?: number }) =>
    apiClient.getPaginated<AutomationLogEntry>(`/automations/${id}/logs`, query as Record<string, number | undefined>),
};