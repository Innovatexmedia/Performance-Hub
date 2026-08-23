import { useEffect } from 'react';
import { useCurrencyStore } from '@/store/currencyStore';
import { formatCurrency } from '@/utils/formatters';

export function useTenantCurrency(): { currency: string; format: (amount: number) => string } {
  const currency = useCurrencyStore((s) => s.currency);
  const loaded = useCurrencyStore((s) => s.loaded);
  const refresh = useCurrencyStore((s) => s.refresh);

  useEffect(() => {
    if (!loaded) void refresh();
  }, [loaded, refresh]);

  const resolved = currency || 'USD';
  return { currency: resolved, format: (amount: number) => formatCurrency(amount, resolved) };
}