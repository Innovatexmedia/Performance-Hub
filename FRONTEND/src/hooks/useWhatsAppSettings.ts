import { useCallback, useEffect, useState } from 'react';
import { whatsappSettingsApi } from '@/lib/whatsappSettingsApi';
import { ApiError } from '@/lib/apiClient';
import type {
  WhatsAppSettings, UpdateProviderInput, UpdateSyncInput, TestConnectionResult,
} from '@/types/whatsappSettings';

export interface UseWhatsAppSettingsResult {
  settings: WhatsAppSettings | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  updateProvider: (input: UpdateProviderInput) => Promise<WhatsAppSettings>;
  updateSync: (input: UpdateSyncInput) => Promise<WhatsAppSettings>;
  testConnection: () => Promise<TestConnectionResult>;
  disconnect: () => Promise<WhatsAppSettings>;
}

export function useWhatsAppSettings(): UseWhatsAppSettingsResult {
  const [settings, setSettings] = useState<WhatsAppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    whatsappSettingsApi.get()
      .then((data) => { if (!cancelled) setSettings(data); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load WhatsApp settings');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [reloadToken]);

  const updateProvider = useCallback(async (input: UpdateProviderInput) => {
    const updated = await whatsappSettingsApi.updateProvider(input);
    setSettings(updated);
    return updated;
  }, []);

  const updateSync = useCallback(async (input: UpdateSyncInput) => {
    const updated = await whatsappSettingsApi.updateSync(input);
    setSettings(updated);
    return updated;
  }, []);

  const testConnection = useCallback(async () => {
    const result = await whatsappSettingsApi.testConnection();
    refetch();
    return result;
  }, [refetch]);

  /**
   * Disconnect only clears the connection state -- it does NOT touch
   * `provider` or `panelMode`, and it never sends `providerMode` (that
   * field isn't even accepted by the backend). Whatever provider/mode the
   * tenant had configured stays configured; they just need to Test
   * Connection again to go back to 'LIVE'. Credentials are kept
   * server-side, so reconnecting doesn't require re-entering them.
   */
  const disconnect = useCallback(async () => {
    const updated = await whatsappSettingsApi.updateProvider({
      meta: { connected: false },
    });
    setSettings(updated);
    return updated;
  }, []);

  return { settings, loading, error, refetch, updateProvider, updateSync, testConnection, disconnect };
}