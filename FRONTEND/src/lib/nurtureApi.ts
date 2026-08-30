import { apiClient, apiClientRaw } from './apiClient';
import type { NurtureSequence, NurtureEnrollment, VariableGroup } from '@/types/nurture';

interface Paginated<T> { data: T; pagination: { page: number; limit: number; total: number; pages: number } }

export const nurtureApi = {
  getVariables: () => apiClient.get<VariableGroup[]>('/whatsapp/nurtures/variables'),

  list: (query?: Record<string, string>) =>
    apiClientRaw.get<Paginated<NurtureSequence[]>>('/whatsapp/nurtures', query),

  get: (id: string) => apiClient.get<NurtureSequence>(`/whatsapp/nurtures/${id}`),

  create: (data: Partial<NurtureSequence>) =>
    apiClient.post<NurtureSequence>('/whatsapp/nurtures', data),

  update: (id: string, data: Partial<NurtureSequence>) =>
    apiClient.patch<NurtureSequence>(`/whatsapp/nurtures/${id}`, data),

  remove: (id: string) => apiClient.delete<void>(`/whatsapp/nurtures/${id}`),

  activate: (id: string, comment?: string) =>
    apiClient.post<NurtureSequence>(`/whatsapp/nurtures/${id}/activate`, { comment }),

  pause: (id: string, comment?: string) =>
    apiClient.post<NurtureSequence>(`/whatsapp/nurtures/${id}/pause`, { comment }),

  archive: (id: string, comment?: string) =>
    apiClient.post<NurtureSequence>(`/whatsapp/nurtures/${id}/archive`, { comment }),

  enroll: (id: string, leadId: string) =>
    apiClient.post<NurtureEnrollment>(`/whatsapp/nurtures/${id}/enroll`, { leadId }),

  listEnrollments: (query?: Record<string, string>) =>
    apiClientRaw.get<Paginated<NurtureEnrollment[]>>('/whatsapp/nurtures/enrollments', query),

  getEnrollment: (id: string) => apiClient.get<NurtureEnrollment>(`/whatsapp/nurtures/enrollments/${id}`),

  pauseEnrollment: (id: string, comment?: string) =>
    apiClient.post<NurtureEnrollment>(`/whatsapp/nurtures/enrollments/${id}/pause`, { comment }),

  resumeEnrollment: (id: string, comment?: string) =>
    apiClient.post<NurtureEnrollment>(`/whatsapp/nurtures/enrollments/${id}/resume`, { comment }),

  cancelEnrollment: (id: string, comment?: string) =>
    apiClient.post<NurtureEnrollment>(`/whatsapp/nurtures/enrollments/${id}/cancel`, { comment }),

  /** Real, admin-gated -- returns the complete, ready-to-use webhook trigger URL (generates a real token on first request if the sequence doesn't have one yet). */
  getWebhookUrl: (id: string) =>
    apiClient.get<{ url: string; token: string }>(`/whatsapp/nurtures/${id}/webhook-url`),

  /** Real, destructive -- invalidates the previous URL immediately, issues a new one. */
  regenerateWebhookUrl: (id: string) =>
    apiClient.post<{ url: string; token: string }>(`/whatsapp/nurtures/${id}/webhook-url/regenerate`),
};