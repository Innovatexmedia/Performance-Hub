import { useCallback, useEffect, useState } from 'react';
import { leadsApi } from '@/lib/leadsApi';
import { ApiError } from '@/lib/apiClient';
import type { Lead, LeadInput, LeadListItem, LeadListQuery, Pagination } from '@/types/lead';

export interface UseLeadsResult {
  leads: LeadListItem[];
  pagination: Pagination | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  createLead: (input: LeadInput) => Promise<Lead>;
  updateLead: (id: string, patch: LeadInput) => Promise<Lead>;
  archiveLead: (id: string) => Promise<void>;
  restoreLead: (id: string) => Promise<void>;
}

/**
 * useLeads -- fetches GET /api/leads with the given filters, refetching
 * whenever `query` changes (by value -- compared via JSON.stringify so
 * callers don't need to memoize the query object themselves).
 *
 * create/update/archive call the API then trigger a refetch so the list
 * stays in sync -- simplest-correct approach; no optimistic cache patching.
 */
export function useLeads(query: LeadListQuery): UseLeadsResult {
  const [leads, setLeads] = useState<LeadListItem[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    leadsApi
      .list(query)
      .then((result) => {
        if (cancelled) return;
        setLeads(result.data);
        setPagination(result.pagination);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load leads');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query), reloadToken]);

  const createLead = useCallback(async (input: LeadInput) => {
    const lead = await leadsApi.create(input);
    refetch();
    return lead;
  }, [refetch]);

  const updateLead = useCallback(async (id: string, patch: LeadInput) => {
    const lead = await leadsApi.update(id, patch);
    refetch();
    return lead;
  }, [refetch]);

  const archiveLead = useCallback(async (id: string) => {
    await leadsApi.archive(id);
    refetch();
  }, [refetch]);

  const restoreLead = useCallback(async (id: string) => {
    await leadsApi.restore(id);
    refetch();
  }, [refetch]);

  return { leads, pagination, loading, error, refetch, createLead, updateLead, archiveLead, restoreLead };
}