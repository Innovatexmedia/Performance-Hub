import { useCurrencyStore } from '@/store/currencyStore';

export function formatCurrency(amount: number, currency?: string): string {
  // Falls back to the tenant's real configured currency (Settings >
  // Company > Currency) when the caller doesn't pass one explicitly --
  // previously this silently defaulted to hardcoded 'USD', so a tenant
  // with INR configured saw $ signs on every KPI/value that didn't
  // happen to pass currency through by hand (Dashboard, Leads, Pipeline,
  // Campaigns, Reports, Attribution all called it this way).
  const resolvedCurrency = currency || useCurrencyStore.getState().currency || 'USD';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: resolvedCurrency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatCompact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/**
 * Compact currency formatting, e.g. "₹18K" -- for money KPI cards that
 * previously called plain formatCompact() and showed a bare number with
 * no currency symbol at all (Pipeline Value, Total spend, Won Value,
 * etc.). Same tenant-currency default as formatCurrency() above.
 */
export function formatCurrencyCompact(amount: number, currency?: string): string {
  const resolvedCurrency = currency || useCurrencyStore.getState().currency || 'USD';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: resolvedCurrency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

export function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function percent(n: number, digits = 0): string {
  return `${n.toFixed(digits)}%`;
}