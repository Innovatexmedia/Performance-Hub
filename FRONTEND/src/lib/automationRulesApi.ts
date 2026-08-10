import { apiClient, type PaginationMeta } from '@/lib/apiClient';
import type {
  AutomationRule,
  AutomationRuleInput,
  AutomationRuleListQuery,
  AutomationRuleHistoryEntry,
} from '@/types/automationRule';

/**
 * SOURCE: BACKEND/src/modules/whatsapp/submodules/automationRules/
 *         {automationRules.routes.js, .controller.js}
 * Mounted at /api/whatsapp/automation-rules. Standard envelope (apiClient unwraps .data).
 */

export interface RunRuleInput {
  leadId?: string;
  contactId?: string;
  campaignId?: string;
  lead?: Record<string, unknown>;
  contact?: Record<string, unknown>;
}

export interface RunRuleResult {
  success: boolean;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
  conditionsPassed: boolean;
  actionsExecuted: number;
  executionTime: number;
  logs: string[];
  actionLogs: { order: number; type: string; status: string; message: string; durationMs: number }[];
  failureReason: string | null;
  historyId: string;
}

export const automationRulesApi = {
  list: (query?: AutomationRuleListQuery) =>
    apiClient.getPaginated<AutomationRule>('/whatsapp/automation-rules', query as Record<string, string | number | boolean | undefined>),

  get: (id: string) =>
    apiClient.get<AutomationRule>(`/whatsapp/automation-rules/${id}`),

  create: (input: AutomationRuleInput) =>
    apiClient.post<AutomationRule>('/whatsapp/automation-rules', input),

  update: (id: string, input: Partial<AutomationRuleInput>) =>
    apiClient.patch<AutomationRule>(`/whatsapp/automation-rules/${id}`, input),

  remove: (id: string) =>
    apiClient.delete<{ id: string; deleted: boolean }>(`/whatsapp/automation-rules/${id}`),

  duplicate: (id: string) =>
    apiClient.post<AutomationRule>(`/whatsapp/automation-rules/${id}/duplicate`),

  toggle: (id: string) =>
    apiClient.post<AutomationRule>(`/whatsapp/automation-rules/${id}/toggle`),

  run: (id: string, input?: RunRuleInput) =>
    apiClient.post<RunRuleResult>(`/whatsapp/automation-rules/${id}/run`, input ?? {}),

  history: (id: string, query?: { page?: number; limit?: number }) =>
    apiClient.getPaginated<AutomationRuleHistoryEntry>(`/whatsapp/automation-rules/${id}/history`, query as Record<string, string | number | boolean | undefined>),
};

export type { PaginationMeta };