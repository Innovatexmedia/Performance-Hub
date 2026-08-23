import { create } from 'zustand';
import { settingsApi } from '@/lib/settingsApi';

interface CurrencyState {
  /** undefined while loading/unknown -- formatMoney() below treats that as
   * 'USD' so a KPI card never renders blank while this loads, same
   * fail-safe spirit as planStore's `track: undefined` handling. */
  currency: string | undefined;
  loaded: boolean;
  refresh: () => Promise<void>;
}

export const useCurrencyStore = create<CurrencyState>((set) => ({
  currency: undefined,
  loaded: false,
  refresh: async () => {
    try {
      const result = await settingsApi.getCurrencyPublic();
      set({ currency: result.currency, loaded: true });
    } catch {
      // Keep whatever was there before (or undefined) -- a failed
      // refresh shouldn't wipe out a previously-known-good currency.
    }
  },
}));