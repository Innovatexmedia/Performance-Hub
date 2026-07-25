import { useCallback, useEffect, useState } from 'react';
import { paymentsApi } from '@/lib/paymentsApi';
import { ApiError, type PaginationMeta } from '@/lib/apiClient';
import type {
  Payment, PaymentInput, PaymentUpdateInput, PaymentKpis, PaymentStatusBreakdown, PaymentListQuery,
} from '@/types/payment';

export interface UsePaymentsResult {
  payments: Payment[];
  pagination: PaginationMeta | null;
  kpis: PaymentKpis | null;
  statusBreakdown: PaymentStatusBreakdown[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  createPayment: (input: PaymentInput) => Promise<Payment>;
  updatePayment: (id: string, patch: PaymentUpdateInput) => Promise<Payment>;
  markPaid: (id: string) => Promise<Payment>;
  refund: (id: string, refundReason?: string) => Promise<Payment>;
}

export function usePayments(query: PaymentListQuery): UsePaymentsResult {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [kpis, setKpis] = useState<PaymentKpis | null>(null);
  const [statusBreakdown, setStatusBreakdown] = useState<PaymentStatusBreakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([paymentsApi.list(query), paymentsApi.getKpis()])
      .then(([listResult, kpisResult]) => {
        if (cancelled) return;
        setPayments(listResult.data);
        setPagination(listResult.pagination);
        setKpis(kpisResult.kpis);
        setStatusBreakdown(kpisResult.statusBreakdown);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load payments');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query), reloadToken]);

  const createPayment = useCallback(async (input: PaymentInput) => {
    const payment = await paymentsApi.create(input);
    refetch();
    return payment;
  }, [refetch]);

  const updatePayment = useCallback(async (id: string, patch: PaymentUpdateInput) => {
    const payment = await paymentsApi.update(id, patch);
    refetch();
    return payment;
  }, [refetch]);

  const markPaid = useCallback(async (id: string) => {
    const payment = await paymentsApi.markPaid(id);
    refetch();
    return payment;
  }, [refetch]);

  const refund = useCallback(async (id: string, refundReason?: string) => {
    const payment = await paymentsApi.refund(id, refundReason);
    refetch();
    return payment;
  }, [refetch]);

  return { payments, pagination, kpis, statusBreakdown, loading, error, refetch, createPayment, updatePayment, markPaid, refund };
}