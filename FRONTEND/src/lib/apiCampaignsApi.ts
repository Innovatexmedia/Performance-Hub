/**
 * API Campaigns & API Keys — frontend API clients.
 *
 * SOURCE:
 *   BACKEND/src/modules/whatsapp/submodules/apiCampaigns/apiCampaign.routes.js
 *     → mounted at /api/whatsapp/campaign-runs   (JWT, read-only)
 *   BACKEND/src/modules/apiKeys/apiKey.routes.js
 *     → mounted at /api/api-keys                 (JWT, owner/admin)
 *
 * Note both are DASHBOARD routes. The public, API-key-authenticated endpoint
 * (/api/v1/campaigns/:id/trigger) is deliberately absent from this file: it is
 * meant to be called by the customer's own server, and calling it from the
 * browser would mean shipping a long-lived API key to the client — exactly
 * what the key format is designed to prevent.
 */

import { apiClient } from '@/lib/apiClient';
import type { CampaignRun, CampaignRunListResult, ApiKey, CreatedApiKey, ApiKeyScope } from '@/types/apiCampaign';
import type { WhatsAppCampaign } from '@/types/whatsappCampaign';

export const apiCampaignsApi = {
  listRuns: (query?: { campaignId?: string; page?: number; limit?: number }) =>
    apiClient.get<CampaignRunListResult>(
      '/whatsapp/campaign-runs',
      query as Record<string, string | number | undefined>
    ),

  getRun: (runId: string) => apiClient.get<CampaignRun>(`/whatsapp/campaign-runs/${runId}`),

  /**
   * Lifecycle. NOT the campaign approve/schedule endpoints: those require a
   * saved audience, which an API campaign has none of by design. DRAFT →
   * ACTIVE ⇄ PAUSED is the whole state machine.
   */
  activate: (campaignId: string) =>
    apiClient.post<WhatsAppCampaign>(`/whatsapp/campaign-runs/campaigns/${campaignId}/activate`, {}),

  pause: (campaignId: string) =>
    apiClient.post<WhatsAppCampaign>(`/whatsapp/campaign-runs/campaigns/${campaignId}/pause`, {}),
};

export const apiKeysApi = {
  list: () => apiClient.get<{ keys: ApiKey[] }>('/api-keys'),

  create: (input: { name: string; scopes?: ApiKeyScope[]; expiresAt?: string | null }) =>
    apiClient.post<CreatedApiKey>('/api-keys', input),

  revoke: (id: string) => apiClient.delete<{ apiKey: ApiKey }>(`/api-keys/${id}`),
};