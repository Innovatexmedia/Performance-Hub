import { useEffect, useState } from 'react';
import { settingsApi } from '@/lib/settingsApi';

/**
 * Reads the real, ungated /settings/plan/public endpoint (every role can
 * call it, not just tenant_admin+ -- see settingsApi's comment) so the
 * sidebar can hide full-only modules for a tenant on a whatsapp_only
 * plan. Returns undefined while loading -- Sidebar treats that as "show
 * everything" rather than flashing items and then hiding them, since a
 * brief loading flicker of extra items is far less jarring than the
 * whole nav appearing to reflow a second after first paint.
 */
export function usePlanTrack(): string | undefined {
  const [track, setTrack] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    settingsApi.getPlanPublic()
      .then((result) => { if (!cancelled) setTrack(result.track); })
      .catch(() => { /* keep undefined -- Sidebar falls back to showing everything */ });
    return () => { cancelled = true; };
  }, []);

  return track;
}
