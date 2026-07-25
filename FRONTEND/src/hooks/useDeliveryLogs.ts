import { useCallback, useEffect, useState } from 'react';
import { whatsappDeliveryLogsApi } from '@/lib/whatsappDeliveryLogsApi';
import { ApiError } from '@/lib/apiClient';
import type { DeliveryLog, DeliveryLogListQuery, Pagination, DeliveryLogStats } from '@/types/whatsappDeliveryLog';

export interface UseDeliveryLogsResult {
  logs: DeliveryLog[];
  pagination: Pagination | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  retry: (id: string) => Promise<DeliveryLog>;
}

export function useDeliveryLogs(query: DeliveryLogListQuery = {}): UseDeliveryLogsResult {
  const [logs, setLogs] = useState<DeliveryLog[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    whatsappDeliveryLogsApi.list(query)
      .then((result) => {
        if (cancelled) return;
        setLogs(result.data);
        setPagination(result.pagination);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load delivery logs');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query), reloadToken]);

  const retry = useCallback(async (id: string) => {
    const updated = await whatsappDeliveryLogsApi.retry(id);
    refetch();
    return updated;
  }, [refetch]);

  return { logs, pagination, loading, error, refetch, retry };
}

export interface UseDeliveryLogsStatsResult {
  stats: DeliveryLogStats | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDeliveryLogsStats(query: Partial<DeliveryLogListQuery> = {}): UseDeliveryLogsStatsResult {
  const [stats, setStats] = useState<DeliveryLogStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    whatsappDeliveryLogsApi.stats(query)
      .then((result) => { if (!cancelled) setStats(result); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load stats');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query), reloadToken]);

  return { stats, loading, error, refetch };
}