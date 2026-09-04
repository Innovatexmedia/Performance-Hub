/**
 * Payment domain constants.
 *
 * FILE: src/modules/payments/payment.constants.js
 *
 * SOURCE: DEVELOPER_HANDOFF.md §6 Payment entity:
 *   "lead_id, deal_id, amount, currency,
 *    status('Pending'|'Sent'|'Paid'|'Failed'|'Refunded'),
 *    payment_method, payment_link, payment_date, source, campaign"
 *
 * SOURCE: MASTER_SPEC.md §B12:
 *   "Create payment link; statuses Pending/Sent/Paid/Failed/Refunded; copy link; refund.
 *    Mark Paid → deal Won + lead Won + revenue + attribution event + notify."
 *
 * SOURCE: MASTER_SPEC.md §I2 PaymentStatus(5)
 *
 * SOURCE: FRONTEND_SPEC §13:
 *   "KPI: Revenue Collected | Outstanding | Paid (count) | Pending (count)
 *    Donut chart: Payments by Status
 *    Table: Lead | Amount | Method | Status | Date | Actions (Mark Paid / Refund / Copy)"
 */

/**
 * PAYMENT_STATUS — 5 values from MASTER_SPEC.md §I2 PaymentStatus.
 * SOURCE: DEVELOPER_HANDOFF.md Payment.status
 * FRONTEND_SPEC §13 Status column badges + donut chart segments
 */
export const PAYMENT_STATUS = Object.freeze({
  PENDING:  'Pending',
  SENT:     'Sent',
  PAID:     'Paid',
  FAILED:   'Failed',
  REFUNDED: 'Refunded',
});
export const PAYMENT_STATUS_VALUES = Object.freeze(Object.values(PAYMENT_STATUS));

/**
 * PAYMENT_METHOD — from New Payment modal dropdown.
 * SOURCE: FRONTEND_SPEC §13 modal Method dropdown: Card, PayPal, Stripe, Bank Transfer
 */
export const PAYMENT_METHOD = Object.freeze({
  CARD:          'Card',
  PAYPAL:        'PayPal',
  STRIPE:        'Stripe',
  BANK_TRANSFER: 'Bank Transfer',
  UPI:           'UPI',
  CASHFREE:      'Cashfree',
  CASH:          'Cash',
});
export const PAYMENT_METHOD_VALUES = Object.freeze(Object.values(PAYMENT_METHOD));

/**
 * PAYMENT_CURRENCY — supported currencies.
 * Default: USD
 */
export const PAYMENT_CURRENCY = Object.freeze({
  USD: 'USD',
  INR: 'INR',
  EUR: 'EUR',
  GBP: 'GBP',
});
export const PAYMENT_CURRENCY_VALUES = Object.freeze(Object.values(PAYMENT_CURRENCY));

/**
 * Connected effects on Mark Paid (from MASTER_SPEC §B12 and DEVELOPER_HANDOFF.md):
 *   deal → 'Won'
 *   lead → 'Won'
 *   revenue → updated on deal + attribution
 *   tracking events: 'Payment Completed' + 'Deal Won'
 *   notification → created for assigned user
 */
export const DEAL_STAGE_ON_PAID  = 'Won';
export const LEAD_STATUS_ON_PAID = 'Won';