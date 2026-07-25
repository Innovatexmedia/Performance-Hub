import { useCallback, useEffect, useState } from 'react';
import { whatsappConsentApi } from '@/lib/whatsappConsentApi';
import { ApiError } from '@/lib/apiClient';
import type {
  Consent, ConsentListQuery, Pagination, CreateConsentInput, ConsentStats,
} from '@/types/whatsappConsent';

export interface UseConsentResult {
  records: Consent[];
  pagination: Pagination | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  /**
   * Insert/replace a record the caller already has the real, server-
   * returned data for (own action's response, or a realtime socket
   * payload) -- no extra HTTP call. If a `statusFilter` is currently
   * active and the record's new status no longer matches it, the record
   * is removed from the list instead of shown with a stale/wrong status.
   */
  upsert: (record: Consent) => void;
  create: (input: CreateConsentInput) => Promise<Consent>;
  optIn: (id: string, input?: Parameters<typeof whatsappConsentApi.optIn>[1]) => Promise<Consent>;
  optOut: (id: string, input?: Parameters<typeof whatsappConsentApi.optOut>[1]) => Promise<Consent>;
  block: (id: string, reason?: string) => Promise<Consent>;
  unblock: (id: string, reason?: string) => Promise<Consent>;
}

/**
 * useConsent -- list + mutations.
 *
 * Every mutation (create/optIn/optOut/block/unblock) already gets back
 * the full, real, updated record in its HTTP response. Instead of
 * discarding that and firing a whole extra list() refetch (the old
 * behaviour), each mutation now calls `upsert()` directly with that same
 * response -- one HTTP call total per action instead of two, and always
 * exactly correct because it's real server data, never client-computed.
 */
export function useConsent(query: ConsentListQuery = {}): UseConsentResult {
  const [records, setRecords] = useState<Consent[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    whatsappConsentApi.list(query)
      .then((result) => {
        if (cancelled) return;
        setRecords(result.data);
        setPagination(result.pagination);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load consent records');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query), reloadToken]);

  const upsert = useCallback((record: Consent) => {
    const activeStatusFilter = query.status;

    setRecords((prev) => {
      const idx = prev.findIndex((r) => r.id === record.id);
      const stillMatchesFilter = !activeStatusFilter || record.status === activeStatusFilter;

      if (!stillMatchesFilter) {
        // Transitioned out of the currently-filtered status -- remove
        // rather than show a row whose status contradicts the active
        // filter.
        if (idx === -1) return prev;
        return prev.filter((r) => r.id !== record.id);
      }

      if (idx === -1) return [record, ...prev]; // genuinely new record
      const next = [...prev];
      next[idx] = record;
      return next;
    });

    setPagination((prev) => {
      if (!prev) return prev;
      const activeStatusFilterNow = query.status;
      const existedBefore = records.some((r) => r.id === record.id);
      const stillMatches = !activeStatusFilterNow || record.status === activeStatusFilterNow;
      if (!existedBefore && stillMatches) {
        return { ...prev, total: prev.total + 1 }; // new record entering the (possibly filtered) view
      }
      if (existedBefore && !stillMatches) {
        return { ...prev, total: Math.max(0, prev.total - 1) }; // record left the filtered view
      }
      return prev;
    });
  }, [query.status, records]);

  const create = useCallback(async (input: CreateConsentInput) => {
    const record = await whatsappConsentApi.create(input);
    upsert(record);
    return record;
  }, [upsert]);

  const optIn = useCallback(async (id: string, input?: Parameters<typeof whatsappConsentApi.optIn>[1]) => {
    const record = await whatsappConsentApi.optIn(id, input);
    upsert(record);
    return record;
  }, [upsert]);

  const optOut = useCallback(async (id: string, input?: Parameters<typeof whatsappConsentApi.optOut>[1]) => {
    const record = await whatsappConsentApi.optOut(id, input);
    upsert(record);
    return record;
  }, [upsert]);

  const block = useCallback(async (id: string, reason?: string) => {
    const record = await whatsappConsentApi.block(id, reason);
    upsert(record);
    return record;
  }, [upsert]);

  const unblock = useCallback(async (id: string, reason?: string) => {
    const record = await whatsappConsentApi.unblock(id, reason);
    upsert(record);
    return record;
  }, [upsert]);

  return { records, pagination, loading, error, refetch, upsert, create, optIn, optOut, block, unblock };
}

export interface UseConsentStatsResult {
  stats: ConsentStats | null;
  loading: boolean;
  refetch: () => void;
}

/**
 * Real, single-call stats via GET /consent/stats (server-side aggregation
 * -- see consentService.getStats()). Replaces the old 5-call-per-load,
 * client-side-math approach entirely. No `bump()`, no local counters, no
 * self-echo tracking needed anywhere -- every call here returns the true
 * current value, so calling it redundantly (e.g. once from your own
 * action AND once from that action's own socket echo) is merely a little
 * wasteful, never wrong.
 */
export function useConsentStats(): UseConsentStatsResult {
  const [stats, setStats] = useState<ConsentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    whatsappConsentApi.stats()
      .then((result) => { if (!cancelled) setStats(result); })
      .catch(() => { if (!cancelled) setStats(null); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [reloadToken]);

  return { stats, loading, refetch };
}