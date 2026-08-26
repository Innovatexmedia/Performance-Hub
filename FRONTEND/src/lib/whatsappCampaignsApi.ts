import { apiClient, doRequest, throwIfError, ApiError } from '@/lib/apiClient';
import type {
  WhatsAppCampaign, CreateCampaignInput, UpdateCampaignInput, CampaignListQuery,
  Pagination, CampaignResource, AudiencePreview,
} from '@/types/whatsappCampaign';

/**
 * SOURCE: src/modules/whatsapp/submodules/campaigns/campaigns.controller.js
 *         src/modules/whatsapp/submodules/broadcasts/broadcasts.controller.js
 * Both controllers use the identical sendSuccess/sendCreated/sendPaginated
 * envelope as templates.controller.js -- list() puts `pagination` as a
 * top-level sibling of `data`, same as whatsappTemplatesApi.
 *
 * Campaigns and Broadcasts are two separate backend resources with an
 * identical route shape, so this factory builds one API object per resource
 * rather than duplicating every method twice.
 */
function buildCampaignApi(resource: CampaignResource) {
  const base = `/whatsapp/${resource}`;

  return {
    list: async (query?: CampaignListQuery): Promise<{ data: WhatsAppCampaign[]; pagination: Pagination }> => {
      const res = await doRequest(base, { query: query as Record<string, string | number | undefined> });
      await throwIfError(res);
      const envelope = await res.json() as { success: boolean; message?: string; data: WhatsAppCampaign[]; pagination: Pagination };
      if (!envelope.success) throw new ApiError(envelope.message || 'Request failed', res.status);
      return { data: envelope.data, pagination: envelope.pagination };
    },

    get: (id: string) => apiClient.get<WhatsAppCampaign>(`${base}/${id}`),

    create: (input: CreateCampaignInput) => apiClient.post<WhatsAppCampaign>(base, input),

    update: (id: string, patch: UpdateCampaignInput) => apiClient.patch<WhatsAppCampaign>(`${base}/${id}`, patch),

    delete: (id: string) => apiClient.delete<{ id: string; deleted: boolean }>(`${base}/${id}`),

    approve: (id: string, comment?: string) =>
      apiClient.post<WhatsAppCampaign>(`${base}/${id}/approve`, { comment }),

    schedule: (id: string, scheduledAt: string, comment?: string) =>
      apiClient.post<WhatsAppCampaign>(`${base}/${id}/schedule`, { scheduledAt, comment }),

    start: (id: string, comment?: string) =>
      apiClient.post<WhatsAppCampaign>(`${base}/${id}/start`, { comment }),

    /** AiSensy's "Failed Retries" (manual mode): creates a NEW campaign
     * targeting only the leads whose message failed in this one, same
     * template. See BACKEND campaigns.service.js's resendFailed doc
     * comment for why it's a new campaign, not reopening this one. */
    resendFailed: (id: string) =>
      apiClient.post<WhatsAppCampaign>(`${base}/${id}/resend-failed`, {}),

    complete: (id: string, comment?: string) =>
      apiClient.post<WhatsAppCampaign>(`${base}/${id}/complete`, { comment }),

    fail: (id: string, failureReason?: string, comment?: string) =>
      apiClient.post<WhatsAppCampaign>(`${base}/${id}/fail`, { failureReason, comment }),

    cancel: (id: string, comment?: string) =>
      apiClient.post<WhatsAppCampaign>(`${base}/${id}/cancel`, { comment }),

    previewAudience: (audience: CreateCampaignInput['audience']) =>
      apiClient.post<AudiencePreview>(`${base}/preview-audience`, {
        filters: audience?.filters,
        includedContacts: audience?.includedContacts,
        excludedContacts: audience?.excludedContacts,
      }),
  };
}

export const whatsappCampaignsApi = buildCampaignApi('campaigns');
export const whatsappBroadcastsApi = buildCampaignApi('broadcasts');