import { useEffect, useState } from 'react';
import { attributionApi } from '@/lib/attributionApi';
import { ApiError } from '@/lib/apiClient';
import type { AttributionDashboard } from '@/types/attribution';

export interface UseAttributionResult {
  dashboard: AttributionDashboard | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * useAttribution -- fetches the Attribution dashboard (source breakdowns,
 * revenue, bookings, recent tracking events). No filters accepted yet --
 * Attribution.tsx calls this with zero arguments; attributionApi.getDashboard
 * already supports an optional AttributionFilter for whenever filtering is
 * added to the page.
 */
export function useAttribution(): UseAttributionResult {
  const [dashboard, setDashboard] = useState<AttributionDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = () => setReloadToken((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    attributionApi.getDashboard()
      .then((result) => { if (!cancelled) setDashboard(result); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load attribution dashboard');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadToken]);

  return { dashboard, loading, error, refetch };
}
