import { useCallback, useEffect, useState } from 'react';
import { whatsappInboxApi } from '@/lib/whatsappInboxApi';
import { ApiError } from '@/lib/apiClient';
import { toast } from '@/store/toastStore';
import type { ConversationDetails, ConversationNote, MessageType } from '@/types/whatsapp';

export interface UseConversationDetailsResult {
  details: ConversationDetails | null;
  notes: ConversationNote[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  sendMessage: (content: string, type?: MessageType) => Promise<{ blocked: boolean }>;
  simulateInbound: (content: string) => Promise<void>;
  assign: (userId: string) => Promise<void>;
  changeStatus: (status: string) => Promise<void>;
  addNote: (body: string) => Promise<void>;
  addTag: (tag: string) => Promise<void>;
  removeTag: (tag: string) => Promise<void>;
  /** Fetches and prepends the next batch of older messages (infinite-scroll-up). No-op if already loading or nothing left. */
  loadOlder: () => Promise<void>;
  loadingOlder: boolean;
}

/**
 * useConversationDetails -- fetches the 3-pane bundle for one conversation
 * (conversation + messages + leadContext, one real backend call), plus
 * notes separately (not included in the details bundle). Every mutating
 * action refetches both afterward -- simplest-correct, same pattern as
 * every other hook in this app.
 */
export function useConversationDetails(conversationId: string | null): UseConversationDetailsResult {
  const [details, setDetails] = useState<ConversationDetails | null>(null);
  const [notes, setNotes] = useState<ConversationNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    if (!conversationId) {
      setDetails(null);
      setNotes([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      whatsappInboxApi.getConversationDetails(conversationId),
      whatsappInboxApi.listNotes(conversationId),
    ])
      .then(([detailsResult, notesResult]) => {
        if (cancelled) return;
        setDetails(detailsResult);
        setNotes(notesResult);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load conversation');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, reloadToken]);

  const sendMessage = useCallback(async (content: string, type: MessageType = 'text') => {
    if (!conversationId) return { blocked: false };
    const result = await whatsappInboxApi.send(conversationId, content, type);
    refetch();
    return { blocked: Boolean(result.blocked) };
  }, [conversationId, refetch]);

  const simulateInbound = useCallback(async (content: string) => {
    if (!conversationId) return;
    await whatsappInboxApi.simulateInbound(conversationId, content);
    refetch();
  }, [conversationId, refetch]);

  const assign = useCallback(async (userId: string) => {
    if (!conversationId) return;
    await whatsappInboxApi.assignConversation(conversationId, userId);
    refetch();
  }, [conversationId, refetch]);

  const changeStatus = useCallback(async (status: string) => {
    if (!conversationId) return;
    await whatsappInboxApi.changeStatus(conversationId, status);
    refetch();
  }, [conversationId, refetch]);

  const addNote = useCallback(async (body: string) => {
    if (!conversationId) return;
    await whatsappInboxApi.addNote(conversationId, body);
    refetch();
  }, [conversationId, refetch]);

  const addTag = useCallback(async (tag: string) => {
    if (!conversationId) return;
    await whatsappInboxApi.addTag(conversationId, tag);
    refetch();
  }, [conversationId, refetch]);

  const removeTag = useCallback(async (tag: string) => {
    if (!conversationId) return;
    await whatsappInboxApi.removeTag(conversationId, tag);
    refetch();
  }, [conversationId, refetch]);

  const loadOlder = useCallback(async () => {
    if (!conversationId || loadingOlder) return;
    if (!details || !details.hasMoreOlder || details.messages.length === 0) return;

    const cursor = details.messages[0].created_at;
    setLoadingOlder(true);
    try {
      const result = await whatsappInboxApi.loadOlderMessages(conversationId, cursor);
      setDetails((current) => {
        if (!current) return current;
        return {
          ...current,
          messages: [...result.messages, ...current.messages],
          hasMoreOlder: result.hasMoreOlder,
        };
      });
    } catch (err) {
      toast.error('Could not load older messages', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, loadingOlder, details]);

  return {
    details, notes, loading, error, refetch, sendMessage, simulateInbound, assign, changeStatus, addNote, addTag, removeTag,
    loadOlder, loadingOlder,
  };
}