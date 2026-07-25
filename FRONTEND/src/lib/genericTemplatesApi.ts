import { apiClient } from '@/lib/apiClient';
import type {
  GenericTemplate, CreateTemplateInput, UpdateTemplateInput, TemplateListQuery, TemplateCounts, TemplateVersionsResult,
} from '@/types/genericTemplate';

/**
 * SOURCE: src/modules/templates/template.controller.js
 * Standard envelope. Confirmed spec-aligned -- no trimming needed, unlike
 * Campaigns/Automations. Full CRUD + duplicate + versions, all real.
 */
export const genericTemplatesApi = {
  list: (query?: TemplateListQuery) =>
    apiClient.getPaginated<GenericTemplate>('/templates', query as Record<string, string | number | undefined>),

  getCounts: (query?: { scope?: string; search?: string }) =>
    apiClient.get<TemplateCounts>('/templates/counts', query as Record<string, string | undefined>),

  get: (id: string) => apiClient.get<GenericTemplate>(`/templates/${id}`),

  create: (input: CreateTemplateInput) =>
    apiClient.post<GenericTemplate>('/templates', input),

  update: (id: string, patch: UpdateTemplateInput) =>
    apiClient.patch<GenericTemplate>(`/templates/${id}`, patch),

  delete: (id: string) => apiClient.delete<{ id: string; deleted: boolean }>(`/templates/${id}`),

  duplicate: (id: string) => apiClient.post<GenericTemplate>(`/templates/${id}/duplicate`),

  getVersions: (id: string) => apiClient.get<TemplateVersionsResult>(`/templates/${id}/versions`),
};