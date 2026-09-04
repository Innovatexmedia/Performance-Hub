/**
 * Real Payment types -- match the backend exactly.
 *
 * Standard envelope. No toJSON transform -- raw `_id`.
 * SOURCE: src/modules/payments/payment.model.js + payment.constants.js
 *
 * VERIFIED SPEC-ALIGNED (no backend changes needed here, unlike Campaigns):
 * every service function has a SOURCE comment citing the exact spec line,
 * markPaid implements MASTER_SPEC B12's connected-effects chain precisely
 * (deal Won + lead Won + revenue + attribution event + notify), and refund
 * correctly enforces "only Paid payments can be refunded" per FRONTEND_SPEC
 * section 13. No unspec'd extra endpoints exist.
 */

export type PaymentStatus = 'Pending' | 'Sent' | 'Paid' | 'Failed' | 'Refunded';

export const PAYMENT_STATUS_VALUES: PaymentStatus[] = ['Pending', 'Sent', 'Paid', 'Failed', 'Refunded'];

export type PaymentMethod = 'Card' | 'PayPal' | 'Stripe' | 'Bank Transfer' | 'UPI' | 'Cashfree' | 'Cash';

export const PAYMENT_METHOD_VALUES: PaymentMethod[] = ['Card', 'PayPal', 'Stripe', 'Bank Transfer', 'UPI', 'Cashfree', 'Cash'];

export type PaymentCurrency = 'USD' | 'INR' | 'EUR' | 'GBP';

export const PAYMENT_CURRENCY_VALUES: PaymentCurrency[] = ['USD', 'INR', 'EUR', 'GBP'];

/** Populated subset of Lead embedded on single-payment reads. */
export interface PaymentLeadRef {
  _id: string;
  name: string;
  email: string;
  company: string;
  source: string;
  campaign?: string;
  assigned_user_id?: string | null;
}

/** Populated subset of Deal embedded on reads. */
export interface PaymentDealRef {
  _id: string;
  stage: string;
  value: number;
  title?: string;
}

export interface Payment {
  _id: string;
  tenant_id: string;
  lead_id: PaymentLeadRef;
  deal_id: PaymentDealRef | null;
  amount: number;
  currency: PaymentCurrency;
  payment_method: PaymentMethod;
  status: PaymentStatus;
  payment_link: string | null;
  payment_date: string | null;
  source: string | null;
  campaign: string | null;
  refunded_at: string | null;
  refund_reason: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/** POST body -- only lead_id + amount required. */
export interface PaymentInput {
  lead_id: string;
  amount: number;
  currency?: PaymentCurrency;
  payment_method?: PaymentMethod;
  deal_id?: string;
}

export interface PaymentUpdateInput {
  status?: PaymentStatus;
  payment_method?: PaymentMethod;
  amount?: number;
}

export interface PaymentListQuery {
  status?: PaymentStatus;
  payment_method?: PaymentMethod;
  lead_id?: string;
  page?: number;
  limit?: number;
}

/** GET /api/payments/kpis -- SOURCE: payment.repository.js getKpiCounts. */
export interface PaymentKpis {
  revenueCollected: number;
  outstanding: number;
  paidCount: number;
  pendingCount: number;
  sentCount: number;
  failedCount: number;
  refundedCount: number;
  totalAmount: number;
}

/** Part of GET /kpis response -- SOURCE: payment.repository.js getStatusBreakdown. */
export interface PaymentStatusBreakdown {
  status: PaymentStatus;
  count: number;
  amount: number;
}