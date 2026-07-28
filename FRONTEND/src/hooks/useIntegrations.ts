import { useCallback, useEffect, useState } from 'react';
import { integrationsApi } from '@/lib/integrationsApi';
import { ApiError, type PaginationMeta } from '@/lib/apiClient';
import type { Integration, IntegrationListQuery, IntegrationCounts } from '@/types/integration';

export interface UseIntegrationsResult {
  integrations: Integration[];
  pagination: PaginationMeta | null;
  counts: IntegrationCounts | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  toggle: (id: string) => Promise<Integration>;
  sync: (id: string) => Promise<Integration>;
  updateConfig: (id: string, config: Record<string, unknown>) => Promise<Integration>;
}

export function useIntegrations(query: IntegrationListQuery = {}): UseIntegrationsResult {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [counts, setCounts] = useState<IntegrationCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      integrationsApi.list(query),
      integrationsApi.getCounts({ status: query.status, search: query.search }),
    ])
      .then(([listResult, countsResult]) => {
        if (cancelled) return;
        setIntegrations(listResult.data);
        setPagination(listResult.pagination);
        setCounts(countsResult);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load integrations');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query), reloadToken]);

  const toggle = useCallback(async (id: string) => {
    const integration = await integrationsApi.toggle(id);
    refetch();
    return integration;
  }, [refetch]);

  const sync = useCallback(async (id: string) => {
    const integration = await integrationsApi.sync(id);
    refetch();
    return integration;
  }, [refetch]);

  const updateConfig = useCallback(async (id: string, config: Record<string, unknown>) => {
    const integration = await integrationsApi.updateConfig(id, config);
    refetch();
    return integration;
  }, [refetch]);

  return { integrations, pagination, counts, loading, error, refetch, toggle, sync, updateConfig };
}