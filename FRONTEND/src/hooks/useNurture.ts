import { useCallback, useEffect, useState } from 'react';
import { nurtureApi } from '@/lib/nurtureApi';
import { ApiError } from '@/lib/apiClient';
import type { NurtureSequence, NurtureEnrollment } from '@/types/nurture';

export function useNurtureSequences() {
  const [sequences, setSequences] = useState<NurtureSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    nurtureApi
      .list()
      .then((res) => {
        if (cancelled) return;
        setSequences(res.data);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load nurture sequences');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const create = useCallback(async (data: Partial<NurtureSequence>) => {
    const created = await nurtureApi.create(data);
    refetch();
    return created;
  }, [refetch]);

  const activate = useCallback(async (id: string) => {
    const updated = await nurtureApi.activate(id);
    refetch();
    return updated;
  }, [refetch]);

  const pause = useCallback(async (id: string) => {
    const updated = await nurtureApi.pause(id);
    refetch();
    return updated;
  }, [refetch]);

  const archive = useCallback(async (id: string) => {
    const updated = await nurtureApi.archive(id);
    refetch();
    return updated;
  }, [refetch]);

  // BUG FIX: a real DELETE /api/whatsapp/nurtures/:id endpoint already
  // existed backend-side (nurtureApi.remove already wraps it) but had no
  // frontend control anywhere -- there was genuinely no way for a tenant
  // to delete a sequence, only archive it. Same refetch pattern as every
  // other mutation above.
  const remove = useCallback(async (id: string) => {
    await nurtureApi.remove(id);
    refetch();
  }, [refetch]);

  const enroll = useCallback(async (sequenceId: string, leadId: string) => {
    return nurtureApi.enroll(sequenceId, leadId);
  }, []);

  return { sequences, loading, error, refetch, create, activate, pause, archive, remove, enroll };
}

export function useNurtureEnrollments(query?: Record<string, string>) {
  const [enrollments, setEnrollments] = useState<NurtureEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    nurtureApi
      .listEnrollments(query)
      .then((res) => {
        if (cancelled) return;
        setEnrollments(res.data);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load enrollments');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken, JSON.stringify(query)]);

  return { enrollments, loading, error, refetch };
}