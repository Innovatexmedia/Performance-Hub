import { apiClientRaw, requestBlob, requestFormDataRaw } from '@/lib/apiClient';
import type {
  Lead,
  LeadInput,
  LeadListQuery,
  LeadListResult,
  LeadDetails,
  LeadNote,
  LeadConstants,
  ImportStartResult,
  ImportStatus,
} from '@/types/lead';

/**
 * SOURCE: src/modules/leads/lead/lead.routes.js + lead.controller.js
 * Every function here hits an endpoint that returns its payload RAW
 * (no { success, data } wrapper) -- see requestRaw's doc comment in
 * apiClient.ts for why.
 */
export const leadsApi = {
  list: (query?: LeadListQuery) =>
    apiClientRaw.get<LeadListResult>('/leads', query as Record<string, string | number | boolean | undefined>),

  get: (id: string) => apiClientRaw.get<Lead>(`/leads/${id}`),

  create: (input: LeadInput) => apiClientRaw.post<Lead>('/leads', input),

  update: (id: string, patch: LeadInput) => apiClientRaw.patch<Lead>(`/leads/${id}`, patch),

  archive: (id: string) => apiClientRaw.delete<{ message: string; lead: Lead }>(`/leads/${id}`),

  restore: (id: string) => apiClientRaw.post<{ message: string; lead: Lead }>(`/leads/${id}/restore`),

  getDetails: (id: string) => apiClientRaw.get<LeadDetails>(`/leads/${id}/details`),

  listNotes: (id: string) => apiClientRaw.get<LeadNote[]>(`/leads/${id}/notes`),

  addNote: (id: string, text: string) => apiClientRaw.post<LeadNote>(`/leads/${id}/notes`, { text }),

  getConstants: () => apiClientRaw.get<LeadConstants>('/leads/constants'),

  assign: (id: string, userId: string) => apiClientRaw.post<Lead>(`/leads/${id}/assign`, { userId }),

  unassign: (id: string) => apiClientRaw.post<Lead>(`/leads/${id}/unassign`),

  /**
   * importCsv -- starts a real, asynchronous bulk import from a CSV
   * file and returns immediately (202) with an importId to poll via
   * getImportStatus(). Previously this waited for every row to process
   * synchronously inside the request; now it's queue-based, matching
   * how Campaign/Broadcast sends already work.
   * SOURCE: src/modules/leads/imports/import.controller.js + csv-import.service.js
   * Recognized column headers (case-insensitive): name, email, phone,
   * whatsapp / whatsapp number, company, source, medium, campaign, status,
   * temperature, segment, value. Only name + phone are required per row.
   * skipDuplicates (default true) skips rows matching an existing lead's
   * email or phone rather than erroring.
   */
  importCsv(file: File, skipDuplicates = true): Promise<ImportStartResult> {
    const formData = new FormData();
    formData.append('file', file);
    return requestFormDataRaw<ImportStartResult>('/leads/import', formData, { skipDuplicates });
  },

  /** getImportStatus -- poll this while an import's status isn't COMPLETED yet. */
  getImportStatus(importId: string): Promise<ImportStatus> {
    return apiClientRaw.get<ImportStatus>(`/leads/import/${importId}`);
  },

  /**
   * exportCsv -- downloads the REAL server-side export (all leads matching
   * the filter, not just the currently-loaded page) and triggers a browser
   * file save. Needs the Authorization header, so this can't be a plain
   * <a href="..."> link -- see requestBlob in apiClient.ts.
   */
  async exportCsv(query?: LeadListQuery): Promise<void> {
    const blob = await requestBlob('/leads/export', {
      query: query as Record<string, string | number | boolean | undefined>,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leads.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};