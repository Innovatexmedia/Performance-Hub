import { apiClient } from '@/lib/apiClient';
import type { Integration, IntegrationListQuery, IntegrationCounts, IntegrationErrorLog } from '@/types/integration';

/**
 * SOURCE: src/modules/integrations/integration.controller.js
 * Standard envelope. list() uses getPaginated() -- confirmed the controller
 * uses sendPaginated (the nested meta.pagination convention), matching
 * Leads/Pipeline/Automations, not the top-level-pagination shape Templates uses.
 *
 * NORMALIZATION -- REAL BUG FIX: unlike most other models in this codebase
 * (e.g. Membership.js), Integration.model.js has NO toJSON transform, so
 * the raw API response uses MongoDB's `_id` field, not `id`. Every other
 * module here consistently returns `id` (via a toJSON transform on the
 * model), and this frontend's types/components were written assuming the
 * same -- they weren't wrong, the assumption just wasn't verified against
 * THIS specific model. Confirmed via a real backend log:
 * "POST /api/integrations/undefined/toggle" -- i.id was genuinely
 * undefined on every card. normalize() below fixes this at the one place
 * raw responses enter the app, rather than changing every file that
 * already correctly expects `id` to match every other module's convention.
 */
function normalize(raw: Integration & { _id?: string }): Integration {
  const { _id, ...rest } = raw;
  return { ...rest, id: raw.id ?? _id ?? '' };
}

export const integrationsApi = {
  list: async (query?: IntegrationListQuery) => {
    const result = await apiClient.getPaginated<Integration>('/integrations', query as Record<string, string | number | undefined>);
    return { ...result, data: result.data.map(normalize) };
  },

  getCounts: (query?: { status?: string; search?: string }) =>
    apiClient.get<IntegrationCounts>('/integrations/counts', query as Record<string, string | undefined>),

  get: (id: string) => apiClient.get<Integration>(`/integrations/${id}`).then(normalize),

  getErrorLogs: (id: string) =>
    apiClient.get<{ error_logs: IntegrationErrorLog[] }>(`/integrations/${id}/error-logs`).then((r) => r.error_logs),

  toggle: (id: string) => apiClient.post<Integration>(`/integrations/${id}/toggle`).then(normalize),

  sync: (id: string) => apiClient.post<Integration>(`/integrations/${id}/sync`).then(normalize),

  updateConfig: (id: string, config: Record<string, unknown>) =>
    apiClient.patch<Integration>(`/integrations/${id}/config`, { config }).then(normalize),

  /**
   * startGoogleAdsCampaignsAuth -- real OAuth authorize call. Returns the
   * real Google consent URL as JSON (not a server redirect -- a plain
   * browser navigation can't carry the Authorization header this
   * endpoint requires), so the caller navigates the browser to it.
   */
  startGoogleAdsCampaignsAuth: () =>
    apiClient.get<{ authUrl: string }>('/integrations/google-ads/oauth/authorize').then((r) => r.authUrl),

  /**
   * startMetaAdsCampaignsAuth -- real OAuth authorize call, same exact
   * reasoning as startGoogleAdsCampaignsAuth above (returns JSON, not a
   * server redirect, since a plain browser navigation can't carry this
   * endpoint's required Authorization header).
   */
  startMetaAdsCampaignsAuth: () =>
    apiClient.get<{ authUrl: string }>('/integrations/meta-ads/oauth/authorize').then((r) => r.authUrl),

  /**
   * startShopifyAuth -- real OAuth authorize call, real shop-specific
   * consent URL. Unlike Google Ads, Shopify's authorization URL depends
   * on the actual store domain, so it's required here.
   */
  startShopifyAuth: (shopDomain: string) =>
    apiClient.get<{ authUrl: string }>(`/shopify/oauth/authorize?shop=${encodeURIComponent(shopDomain)}`).then((r) => r.authUrl),

  /**
   * startZohoAuth -- real OAuth authorize call, same exact reasoning as
   * startMetaAdsCampaignsAuth/startGoogleAdsCampaignsAuth above (returns
   * JSON, not a server redirect, since a plain browser navigation can't
   * carry this endpoint's required Authorization header).
   */
  startZohoAuth: () =>
    apiClient.get<{ authUrl: string }>('/integrations/zoho/oauth/authorize').then((r) => r.authUrl),
};