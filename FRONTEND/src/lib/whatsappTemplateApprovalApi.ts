import { apiClient } from '@/lib/apiClient';
import type { WhatsAppTemplate, TransitionHistoryEntry } from '@/types/whatsappTemplate';

export const whatsappTemplateApprovalApi = {
  submitForReview: (id: string, comment?: string) =>
    apiClient.post<WhatsAppTemplate>(`/whatsapp/templates/${id}/submit-review`, { comment }),

  requestChanges: (id: string, comment: string) =>
    apiClient.post<WhatsAppTemplate>(`/whatsapp/templates/${id}/request-changes`, { comment }),

  approve: (id: string, comment?: string) =>
    apiClient.post<WhatsAppTemplate>(`/whatsapp/templates/${id}/approve`, { comment }),

  reject: (id: string, comment: string) =>
    apiClient.post<WhatsAppTemplate>(`/whatsapp/templates/${id}/reject`, { comment }),

  submitToProvider: (id: string) =>
    apiClient.post<WhatsAppTemplate>(`/whatsapp/templates/${id}/submit-provider`),

  getTimeline: (id: string) =>
    apiClient.get<TransitionHistoryEntry[]>(`/whatsapp/templates/${id}/timeline`),
};