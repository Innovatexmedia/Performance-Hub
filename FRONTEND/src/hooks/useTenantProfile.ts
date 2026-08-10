import { useCallback, useEffect, useState } from 'react';
import { tenantProfileApi } from '@/lib/tenantProfileApi';
import { ApiError } from '@/lib/apiClient';
import type { BusinessProfile, UpdateBusinessProfileInput } from '@/lib/tenantProfileApi';

export interface UseTenantProfileResult {
  profile: BusinessProfile | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  updateProfile: (input: UpdateBusinessProfileInput) => Promise<BusinessProfile>;
}

export function useTenantProfile(): UseTenantProfileResult {
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    tenantProfileApi.get()
      .then((result) => { if (!cancelled) setProfile(result); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load business profile');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadToken]);

  const updateProfile = useCallback(async (input: UpdateBusinessProfileInput) => {
    const updated = await tenantProfileApi.update(input);
    setProfile(updated);
    return updated;
  }, []);

  return { profile, loading, error, refetch, updateProfile };
}