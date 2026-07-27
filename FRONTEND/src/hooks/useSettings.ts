import { useCallback, useEffect, useState } from 'react';
import { settingsApi } from '@/lib/settingsApi';
import { ApiError } from '@/lib/apiClient';
import type { AllSettings } from '@/types/settings';

export interface UseSettingsResult {
  settings: AllSettings | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Full Settings page hook -- loads all 10 tabs in one call, matching
 * GET /settings exactly. Each tab's Save button calls settingsApi's
 * matching update function directly and calls refetch() on success --
 * kept simple/explicit per-tab rather than routed through a single
 * generic update() here, since each tab's real payload shape differs.
 */
export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<AllSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    settingsApi.getAll()
      .then((result) => {
        if (cancelled) return;
        setSettings(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load settings');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [reloadToken]);

  return { settings, loading, error, refetch };
}