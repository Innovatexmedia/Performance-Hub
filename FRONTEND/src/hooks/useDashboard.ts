import { useEffect, useState } from 'react';
import { dashboardApi } from '@/lib/dashboardApi';
import { ApiError } from '@/lib/apiClient';
import type { DashboardData } from '@/types/dashboard';

export interface UseDashboardResult {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
}

/**
 * Real Dashboard data, fetched once per page load from GET /dashboard.
 * Deliberately returns the raw, real shape (not pre-flattened) -- the
 * page component does its own minimal, explicit mapping into the exact
 * {name, value} shape every chart component already expects, so the
 * transformation logic stays visible and auditable at the call site
 * rather than hidden inside this hook.
 */
export function useDashboard(): UseDashboardResult {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    dashboardApi.getAll()
      .then((result) => {
        if (cancelled) return;
        setData(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load dashboard');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  return { data, loading, error };
}