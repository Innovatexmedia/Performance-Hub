import { apiClient, apiClientRaw } from './apiClient';
import type { NurtureSequence, NurtureEnrollment } from '@/types/nurture';

interface Paginated<T> { data: T; pagination: { page: number; limit: number; total: number; pages: number } }

export const nurtureApi = {
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
};