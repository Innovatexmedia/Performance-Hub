import { apiClient } from '@/lib/apiClient';
import type {
  Payment, PaymentInput, PaymentUpdateInput, PaymentListQuery, PaymentKpis, PaymentStatusBreakdown,
} from '@/types/payment';

/**
 * SOURCE: src/modules/payments/payment.controller.js
 * Same wrapping convention as bookingsApi/callsApi -- single-resource
 * responses wrap the payment in a named key.
 */
export const paymentsApi = {
  list: (query?: PaymentListQuery) =>
    apiClient.getPaginated<Payment>('/payments', query as Record<string, string | number | boolean | undefined>),

  getKpis: () => apiClient.get<{ kpis: PaymentKpis; statusBreakdown: PaymentStatusBreakdown[] }>('/payments/kpis'),

  exportData: () => apiClient.get<Record<string, unknown>[]>('/payments/export'),

  get: (id: string) => apiClient.get<{ payment: Payment }>(`/payments/${id}`).then((r) => r.payment),

  listByLead: (leadId: string) =>
    apiClient.get<{ payments: Payment[] }>(`/payments/lead/${leadId}`).then((r) => r.payments),

  create: (input: PaymentInput) =>
    apiClient.post<{ payment: Payment }>('/payments', input).then((r) => r.payment),

  update: (id: string, patch: PaymentUpdateInput) =>
    apiClient.patch<{ payment: Payment }>(`/payments/${id}`, patch).then((r) => r.payment),

  markPaid: (id: string) =>
    apiClient.post<{ payment: Payment }>(`/payments/${id}/mark-paid`).then((r) => r.payment),

  refund: (id: string, refundReason?: string) =>
    apiClient.post<{ payment: Payment }>(`/payments/${id}/refund`, { refund_reason: refundReason }).then((r) => r.payment),
};