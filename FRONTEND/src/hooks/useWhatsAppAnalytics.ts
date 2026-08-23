import { useEffect, useState } from 'react';
import { whatsappAnalyticsApi } from '@/lib/whatsappAnalyticsApi';
import { ApiError } from '@/lib/apiClient';
import type {
  DashboardAnalytics, MessageAnalytics, ConversationAnalytics, TemplateAnalytics, Trends,
} from '@/lib/whatsappAnalyticsApi';

export interface WhatsAppAnalyticsData {
  dashboard: DashboardAnalytics;
  messages: MessageAnalytics;
  conversations: ConversationAnalytics;
  templates: TemplateAnalytics;
  trends: Trends;
}

export interface UseWhatsAppAnalyticsResult {
  data: WhatsAppAnalyticsData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetches every real WhatsApp analytics endpoint in parallel. Replaces the
 * old AnalyticsTab, which computed everything from the in-memory mock
 * store (useDb()) and generated one chart's data with Math.random() on
 * every render -- see whatsappAnalyticsApi.ts's header comment.
 */
export function useWhatsAppAnalytics(): UseWhatsAppAnalyticsResult {
  const [data, setData] = useState<WhatsAppAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = () => setReloadToken((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      whatsappAnalyticsApi.dashboard(),
      whatsappAnalyticsApi.messages(),
      whatsappAnalyticsApi.conversations(),
      whatsappAnalyticsApi.templates(),
      whatsappAnalyticsApi.trends('DAILY'),
    ])
      .then(([dashboard, messages, conversations, templates, trends]) => {
        if (cancelled) return;
        setData({ dashboard, messages, conversations, templates, trends });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load analytics');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [reloadToken]);

  return { data, loading, error, refetch };
}