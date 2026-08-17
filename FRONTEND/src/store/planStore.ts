import { create } from 'zustand';
import { settingsApi } from '@/lib/settingsApi';

interface PlanState {
  /** undefined while loading/unknown -- Sidebar treats that as "show
   * everything" rather than flashing items and then hiding them. */
  track: string | undefined;
  loaded: boolean;
  /** Re-fetches the tenant's current plan track. Call this after ANY
   * successful plan change (Billing's free switch, paid checkout verify,
   * or the webhook-driven auto-lock landing) so every mounted component
   * reading `track` -- the Sidebar in particular -- updates immediately
   * instead of only catching up on the next full page reload. This was
   * the actual gap: Sidebar and Settings each fetched their own copy of
   * the plan track independently, with no way for one to tell the other
   * something changed. */
  refresh: () => Promise<void>;
}

export const usePlanStore = create<PlanState>((set) => ({
  track: undefined,
  loaded: false,
  refresh: async () => {
    try {
      const result = await settingsApi.getPlanPublic();
      set({ track: result.track, loaded: true });
    } catch {
      // Keep whatever was there before (or undefined) -- a failed
      // refresh shouldn't wipe out a previously-known-good track.
    }
  },
}));