import { useCallback, useEffect, useState } from 'react';
import { savedRepliesApi } from '@/lib/savedRepliesApi';
import { ApiError } from '@/lib/apiClient';
import type { SavedReply, SavedReplyInput } from '@/types/savedReply';

export interface UseSavedRepliesResult {
  savedReplies: SavedReply[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  createSavedReply: (input: SavedReplyInput) => Promise<SavedReply>;
  updateSavedReply: (id: string, patch: SavedReplyInput) => Promise<SavedReply>;
  deleteSavedReply: (id: string) => Promise<void>;
}

export function useSavedReplies(): UseSavedRepliesResult {
  const [savedReplies, setSavedReplies] = useState<SavedReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    savedRepliesApi.list()
      .then((data) => { if (!cancelled) setSavedReplies(data); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load saved replies');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [reloadToken]);

  const createSavedReply = useCallback(async (input: SavedReplyInput) => {
    const reply = await savedRepliesApi.create(input);
    refetch();
    return reply;
  }, [refetch]);

  const updateSavedReply = useCallback(async (id: string, patch: SavedReplyInput) => {
    const reply = await savedRepliesApi.update(id, patch);
    refetch();
    return reply;
  }, [refetch]);

  const deleteSavedReply = useCallback(async (id: string) => {
    await savedRepliesApi.delete(id);
    refetch();
  }, [refetch]);

  return { savedReplies, loading, error, refetch, createSavedReply, updateSavedReply, deleteSavedReply };
}