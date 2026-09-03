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
  /**
   * Real actions (SEND_TEMPLATE, START_NURTURE, ASSIGN_USER, etc.) now
   * actually execute -- send a real WhatsApp message, enroll a real
   * lead, etc. Defaults to a safe dry-run (simulated) unless this is
   * explicitly set to true. There is currently no UI to set this --
   * the "Run now" button always runs a dry-run. A real single-lead
   * test run needs a lead picker + an explicit confirmation step
   * before this should ever be wired to true from the UI.
   */
  live?: boolean;
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