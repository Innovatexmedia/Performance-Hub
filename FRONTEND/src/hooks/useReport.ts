import { useEffect, useState } from 'react';
import { reportsApi } from '@/lib/reportsApi';
import { ApiError } from '@/lib/apiClient';
import type { ReportTab, ReportFilter } from '@/types/report';

export interface UseReportResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * useReport -- fetches whichever tab is currently active. Each tab's real
 * shape is different (see types/report.ts), so this returns `unknown` and
 * the page casts to the specific type for the active tab -- same approach
 * the original mock used (a per-tab render function), just backed by a
 * single real fetch instead of 9 different client-side computations.
 */
export function useReport<T = unknown>(tab: ReportTab, filter: ReportFilter): UseReportResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    const fetcher = (): Promise<unknown> => {
      switch (tab) {
        case 'lead': return reportsApi.getLead(filter);
        case 'pipeline': return reportsApi.getPipeline(filter);
        case 'attribution': return reportsApi.getAttribution(filter);
        case 'whatsapp': return reportsApi.getWhatsApp(filter);
        case 'campaign': return reportsApi.getCampaign(filter);
        case 'revenue': return reportsApi.getRevenue(filter);
        case 'sales-activity': return reportsApi.getSalesActivity(filter);
        case 'nurture': return reportsApi.getNurture();
        case 'ai-qualification': return reportsApi.getAiQualification(filter);
        default: return Promise.resolve(null);
      }
    };

    fetcher()
      .then((result) => { if (!cancelled) setData(result as T); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : `Failed to load ${tab} report`);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, JSON.stringify(filter), reloadToken]);

  return { data, loading, error, refetch: () => setReloadToken((n) => n + 1) };
}