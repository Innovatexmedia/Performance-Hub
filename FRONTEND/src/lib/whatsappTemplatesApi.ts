import { apiClient, doRequest, throwIfError, ApiError } from '@/lib/apiClient';
import type {
  WhatsAppTemplate, CreateTemplateInput, UpdateTemplateInput, TemplateListQuery, Pagination,
} from '@/types/whatsappTemplate';

/**
 * SOURCE: src/modules/whatsapp/submodules/templates/templates.controller.js
 * Standard envelope, EXCEPT list() -- sendPaginated() here puts `pagination`
 * as a top-level sibling of `data` ({success, message, data, pagination}),
 * NOT nested under meta.pagination like requestPaginated() expects (that's
 * the Leads/Pipeline convention). Confirmed via real Postman testing.
 */
export const whatsappTemplatesApi = {
  list: async (query?: TemplateListQuery): Promise<{ data: WhatsAppTemplate[]; pagination: Pagination }> => {
    const res = await doRequest('/whatsapp/templates', { query: query as Record<string, string | number | undefined> });
    await throwIfError(res);
    const envelope = await res.json() as { success: boolean; message?: string; data: WhatsAppTemplate[]; pagination: Pagination };
    if (!envelope.success) throw new ApiError(envelope.message || 'Request failed', res.status);
    return { data: envelope.data, pagination: envelope.pagination };
  },

  get: (id: string) => apiClient.get<WhatsAppTemplate>(`/whatsapp/templates/${id}`),

  create: (input: CreateTemplateInput) =>
    apiClient.post<WhatsAppTemplate>('/whatsapp/templates', input),

  update: (id: string, patch: UpdateTemplateInput) =>
    apiClient.patch<WhatsAppTemplate>(`/whatsapp/templates/${id}`, patch),

  delete: (id: string) => apiClient.delete<{ id: string; deleted: boolean }>(`/whatsapp/templates/${id}`),

  duplicate: (id: string) => apiClient.post<WhatsAppTemplate>(`/whatsapp/templates/${id}/duplicate`),

  activate: (id: string) => apiClient.post<WhatsAppTemplate>(`/whatsapp/templates/${id}/activate`),

  pause: (id: string) => apiClient.post<WhatsAppTemplate>(`/whatsapp/templates/${id}/pause`),

  archive: (id: string) => apiClient.post<WhatsAppTemplate>(`/whatsapp/templates/${id}/archive`),

  preview: (id: string, variables: Record<string, string>) =>
    apiClient.post<{ body: string; header?: string; footer?: string }>(`/whatsapp/templates/${id}/preview`, { variables }),
};