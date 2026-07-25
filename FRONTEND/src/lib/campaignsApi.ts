import { apiClient } from '@/lib/apiClient';
import type { Campaign, CampaignInput, CampaignListQuery, CampaignKpis, CampaignChartRow } from '@/types/campaign';

/**
 * SOURCE: src/modules/campaigns/campaign.controller.js
 *
 * SCOPE NOTE: intentionally has NO update/delete/regenerateLink functions.
 * MASTER_SPEC.md B11 and DEVELOPER_HANDOFF.md's action table both name
 * exactly one write action for this module: createMarketingCampaign. The
 * backend's PATCH/DELETE/:id/regenerate-link routes were removed to match
 * (see campaign.routes.js). This file mirrors that trim -- not because the
 * backend can't do more, but because it deliberately doesn't, on purpose,
 * to stay aligned with spec.
 */
export const campaignsApi = {
  list: (query?: CampaignListQuery) =>
    apiClient.getPaginated<Campaign>('/campaigns', query as Record<string, string | number | boolean | undefined>),

  getKpis: () => apiClient.get<CampaignKpis>('/campaigns/kpis'),

  getChartData: () => apiClient.get<CampaignChartRow[]>('/campaigns/chart'),

  exportData: () => apiClient.get<Record<string, unknown>[]>('/campaigns/export'),

  get: (id: string) => apiClient.get<{ campaign: Campaign }>(`/campaigns/${id}`).then((r) => r.campaign),

  create: (input: CampaignInput) =>
    apiClient.post<{ campaign: Campaign }>('/campaigns', input).then((r) => r.campaign),
};