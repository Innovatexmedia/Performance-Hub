import { useEffect } from 'react';
import { usePlanStore } from '@/store/planStore';

/**
 * Reads the shared planStore (see store/planStore.ts) -- fetches once per
 * app session on first use, and re-fetches whenever ANY component calls
 * usePlanStore.getState().refresh() (Billing does this after a
 * successful plan switch), so the Sidebar updates immediately instead of
 * only catching up on a manual page reload.
 */
export function usePlanTrack(): string | undefined {
  const track = usePlanStore((s) => s.track);
  const loaded = usePlanStore((s) => s.loaded);
  const refresh = usePlanStore((s) => s.refresh);

  useEffect(() => {
    if (!loaded) void refresh();
  }, [loaded, refresh]);

  return track;
}