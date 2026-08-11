import { useCallback, useEffect, useState } from 'react';
import { whatsappCampaignsApi, whatsappBroadcastsApi } from '@/lib/whatsappCampaignsApi';
import { ApiError } from '@/lib/apiClient';
import type {
  WhatsAppCampaign, CreateCampaignInput, UpdateCampaignInput, CampaignListQuery,
  Pagination, CampaignResource, Audience, AudiencePreview,
} from '@/types/whatsappCampaign';

export interface UseWhatsAppCampaignsResult {
  campaigns: WhatsAppCampaign[];
  pagination: Pagination | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  createCampaign: (input: CreateCampaignInput) => Promise<WhatsAppCampaign>;
  updateCampaign: (id: string, patch: UpdateCampaignInput) => Promise<WhatsAppCampaign>;
  deleteCampaign: (id: string) => Promise<void>;
  approveCampaign: (id: string, comment?: string) => Promise<WhatsAppCampaign>;
  scheduleCampaign: (id: string, scheduledAt: string, comment?: string) => Promise<WhatsAppCampaign>;
  startCampaign: (id: string, comment?: string) => Promise<WhatsAppCampaign>;
  completeCampaign: (id: string, comment?: string) => Promise<WhatsAppCampaign>;
  cancelCampaign: (id: string, comment?: string) => Promise<WhatsAppCampaign>;
  failCampaign: (id: string, failureReason?: string, comment?: string) => Promise<WhatsAppCampaign>;
  previewAudience: (audience: Audience) => Promise<AudiencePreview>;
  /**
   * Merges a single campaign/broadcast into local state in place -- no
   * network call, no loading flag touched. Use this for real-time socket
   * pushes (see campaignSender.service.js's per-send progress events) so
   * the card's numbers update silently instead of the whole list
   * re-fetching and flashing a loading state on every tick.
   */
  applyRealtimeUpdate: (campaign: WhatsAppCampaign) => void;
}

/**
 * `resource` picks whether this hook talks to /whatsapp/campaigns or
 * /whatsapp/broadcasts -- two separate real backend resources with an
 * identical shape (see whatsappCampaign.ts for the source-verified detail).
 */
export function useWhatsAppCampaigns(
  resource: CampaignResource,
  query: CampaignListQuery = {},
): UseWhatsAppCampaignsResult {
  const api = resource === 'broadcasts' ? whatsappBroadcastsApi : whatsappCampaignsApi;

  const [campaigns, setCampaigns] = useState<WhatsAppCampaign[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api.list(query)
      .then((result) => {
        if (cancelled) return;
        setCampaigns(result.data);
        setPagination(result.pagination);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : `Failed to load ${resource}`);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource, JSON.stringify(query), reloadToken]);

  const createCampaign = useCallback(async (input: CreateCampaignInput) => {
    const campaign = await api.create(input);
    refetch();
    return campaign;
  }, [api, refetch]);

  const updateCampaign = useCallback(async (id: string, patch: UpdateCampaignInput) => {
    const campaign = await api.update(id, patch);
    refetch();
    return campaign;
  }, [api, refetch]);

  const deleteCampaign = useCallback(async (id: string) => {
    await api.delete(id);
    refetch();
  }, [api, refetch]);

  const approveCampaign = useCallback(async (id: string, comment?: string) => {
    const campaign = await api.approve(id, comment);
    refetch();
    return campaign;
  }, [api, refetch]);

  const scheduleCampaign = useCallback(async (id: string, scheduledAt: string, comment?: string) => {
    const campaign = await api.schedule(id, scheduledAt, comment);
    refetch();
    return campaign;
  }, [api, refetch]);

  const startCampaign = useCallback(async (id: string, comment?: string) => {
    const campaign = await api.start(id, comment);
    refetch();
    return campaign;
  }, [api, refetch]);

  const completeCampaign = useCallback(async (id: string, comment?: string) => {
    const campaign = await api.complete(id, comment);
    refetch();
    return campaign;
  }, [api, refetch]);

  const cancelCampaign = useCallback(async (id: string, comment?: string) => {
    const campaign = await api.cancel(id, comment);
    refetch();
    return campaign;
  }, [api, refetch]);

  const failCampaign = useCallback(async (id: string, failureReason?: string, comment?: string) => {
    const campaign = await api.fail(id, failureReason, comment);
    refetch();
    return campaign;
  }, [api, refetch]);

  const previewAudience = useCallback(async (audience: Audience) => {
    return api.previewAudience(audience);
  }, [api]);

  const applyRealtimeUpdate = useCallback((campaign: WhatsAppCampaign) => {
    setCampaigns((prev) => prev.map((c) => (c.id === campaign.id ? campaign : c)));
  }, []);

  return {
    campaigns, pagination, loading, error, refetch,
    createCampaign, updateCampaign, deleteCampaign,
    approveCampaign, scheduleCampaign, startCampaign, completeCampaign,
    cancelCampaign, failCampaign, previewAudience, applyRealtimeUpdate,
  };
}