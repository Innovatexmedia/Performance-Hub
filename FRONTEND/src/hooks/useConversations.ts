import { useCallback, useEffect, useState } from 'react';
import { whatsappInboxApi } from '@/lib/whatsappInboxApi';
import { ApiError } from '@/lib/apiClient';
import type { Conversation, ConversationListQuery, Pagination } from '@/types/whatsapp';

export interface UseConversationsResult {
  conversations: Conversation[];
  pagination: Pagination | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useConversations(query: ConversationListQuery): UseConversationsResult {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    whatsappInboxApi.listConversations(query)
      .then((result) => {
        if (cancelled) return;
        setConversations(result.data);
        setPagination(result.pagination);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load conversations');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query), reloadToken]);

  return { conversations, pagination, loading, error, refetch };
}