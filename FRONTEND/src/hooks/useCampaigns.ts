import { useCallback, useEffect, useState } from 'react';
import { campaignsApi } from '@/lib/campaignsApi';
import { ApiError, type PaginationMeta } from '@/lib/apiClient';
import type { Campaign, CampaignInput, CampaignKpis, CampaignChartRow, CampaignListQuery } from '@/types/campaign';

/**
 * SCOPE NOTE: only exposes create (+ read/list/kpis/chart), matching the
 * backend's trimmed API surface -- see campaignsApi.ts.
 */
export interface UseCampaignsResult {
  campaigns: Campaign[];
  pagination: PaginationMeta | null;
  kpis: CampaignKpis | null;
  chartData: CampaignChartRow[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  createCampaign: (input: CampaignInput) => Promise<Campaign>;
}

export function useCampaigns(query: CampaignListQuery): UseCampaignsResult {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [kpis, setKpis] = useState<CampaignKpis | null>(null);
  const [chartData, setChartData] = useState<CampaignChartRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([campaignsApi.list(query), campaignsApi.getKpis(), campaignsApi.getChartData()])
      .then(([listResult, kpisResult, chart]) => {
        if (cancelled) return;
        setCampaigns(listResult.data);
        setPagination(listResult.pagination);
        setKpis(kpisResult);
        setChartData(chart);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load campaigns');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query), reloadToken]);

  const createCampaign = useCallback(async (input: CampaignInput) => {
    const campaign = await campaignsApi.create(input);
    refetch();
    return campaign;
  }, [refetch]);

  return { campaigns, pagination, kpis, chartData, loading, error, refetch, createCampaign };
}