/**
 * Payment Service — business logic + all connected effects.
 *
 * FILE: src/modules/payments/payment.service.js
 *
 * SOURCE: MASTER_SPEC.md §B12:
 *   "Create payment link; statuses Pending/Sent/Paid/Failed/Refunded; copy link; refund.
 *    Mark Paid → deal Won + lead Won + revenue + attribution event + notify."
 *
 * SOURCE: DEVELOPER_HANDOFF.md markPaymentPaid action:
 *   "payment→Paid, lead→Won, deal→Won, track('Payment Completed'+'Deal Won'), notify, toast"
 *
 * SOURCE: FRONTEND_SPEC §13:
 *   "Mark Paid → deal closes Won, lead → Won, revenue + attribution update + notification"
 *   "Refund action"
 *
 * CONNECTED MODULES:
 *   Lead model    → status → 'Won' on markPaid
 *   Deal model    → stage  → 'Won' on markPaid, value updated
 *   Attribution   → PAYMENT_COMPLETED + DEAL_WON tracking events
 *   Notifications → created for assigned user on markPaid
 *   Activity      → LEAD_UPDATED logged to timeline
 */

import * as paymentRepo          from './payment.repository.js';
import {
  PAYMENT_STATUS,
  DEAL_STAGE_ON_PAID,
  LEAD_STATUS_ON_PAID,
} from './payment.constants.js';
import { AppError, paginationMeta }   from '../../shared/helpers/lead.helpers.js';

// Named imports — matching all other services
import { Lead }              from '../leads/lead/lead.model.js';
import { Deal }              from '../pipeline/deals/deal.model.js';
import { ACTIVITY_TYPE }     from '../leads/activities/activity.model.js';
import { activityService }   from '../leads/activities/activity.service.js';
import Notification          from '../leads/notifications/notification.model.js';
import { createTrackingEvent }    from '../attribution/attribution.service.js';
import { TRACKING_EVENT_TYPE }    from '../attribution/attribution.constants.js';
import { NurtureEnrollment } from '../whatsapp/submodules/nurtures/nurtures.model.js';
import { ENROLLMENT_STATUS } from '../whatsapp/submodules/nurtures/nurtures.constants.js';
import { sendPaymentConfirmation, sendPaymentFailure } from '../auth/services/email.service.js';
import { automationRulesService } from '../whatsapp/submodules/automationRules/automationRules.service.js';
import { TRIGGER_TYPE as AUTOMATION_TRIGGER_TYPE } from '../whatsapp/submodules/automationRules/automationRules.constants.js';

// =============================================================================
// PRIVATE HELPERS — identical pattern to booking.service.js / call.service.js
// =============================================================================

const buildCtx = (reqUser) => ({
  tenantId: reqUser.tenantId,
  userId:   reqUser.sub,
  role:     reqUser.role,
});

const logActivity = async (ctx, leadId, type, message, meta = {}) => {
  try {
    await activityService.log(ctx, leadId, type, { message, meta });
  } catch (err) {
    console.warn(`[payments] activity log failed: ${err.message}`);
  }
};

const createNotification = async (tenantId, userId, title, body, metadata = {}) => {
  try {
    if (!userId) return;
    await Notification.create({ tenantId, userId, title, body, isRead: false, metadata });
  } catch (err) {
    console.warn(`[payments] notification failed: ${err.message}`);
  }
};

/**
 * generatePaymentLink — builds a shareable payment link.
 * SOURCE: MASTER_SPEC §B12 "Create payment link; copy link"
 * Format: <CLIENT_URL>/pay/<paymentId>
 */
const generatePaymentLink = (paymentId) => {
  const base = process.env.CLIENT_URL || 'http://localhost:3000';
  return `${base}/pay/${paymentId}`;
};

// =============================================================================
// GET PAYMENTS — paginated list
// =============================================================================

export const getPayments = async (tenantId, filter = {}, options = {}) => {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  const [payments, total] = await Promise.all([
    paymentRepo.findByTenantId(tenantId, filter, { skip, limit }),
    paymentRepo.countByTenantId(tenantId, filter),
  ]);

  return {
    payments,
    pagination: paginationMeta({ page, limit, total }),
  };
};

// =============================================================================
// GET SINGLE PAYMENT
// =============================================================================

export const getPaymentById = async (tenantId, id) => {
  const payment = await paymentRepo.findById(tenantId, id);
  if (!payment) throw AppError.notFound('Payment not found');
  return payment;
};

// =============================================================================
// GET KPI SUMMARY — 4 KPI cards + donut chart
// =============================================================================

/**
 * getKpiSummary — data for KPI cards and donut chart.
 * SOURCE: FRONTEND_SPEC §13:
 *   Revenue Collected | Outstanding | Paid (count) | Pending (count)
 */
export const getKpiSummary = async (tenantId) => {
  const [kpis, statusBreakdown] = await Promise.all([
    paymentRepo.getKpiCounts(tenantId),
    paymentRepo.getStatusBreakdown(tenantId),
  ]);
  return { kpis, statusBreakdown };
};

// =============================================================================
// COUNT / GET BY LEAD — for lead detail drawer
// =============================================================================

export const countPaymentsByLead = (tenantId, leadId) =>
  paymentRepo.countByLead(tenantId, leadId);

export const getPaymentsByLead = (tenantId, leadId) =>
  paymentRepo.findByLead(tenantId, leadId);

// =============================================================================
// CREATE PAYMENT — New Payment Link
// =============================================================================

/**
 * createPayment — creates a payment record and generates a shareable link.
 *
 * SOURCE: MASTER_SPEC §B12 "Create payment link"
 * SOURCE: FRONTEND_SPEC §13 modal: Lead | Amount (USD) | Method
 * Connected: automatically copies source/campaign from lead for attribution.
 *
 * STEPS:
 *   1. Verify lead exists in tenant
 *   2. Create payment document with status = 'Pending'
 *   3. Set payment_link = <CLIENT_URL>/pay/<id>
 *   4. Copy source/campaign from lead for attribution
 *   5. Emit PAYMENT_CREATED tracking event
 *
 * @param {Object} data    — { lead_id, amount, currency?, payment_method?, deal_id? }
 * @param {Object} reqUser — req.user from authenticate middleware
 */
export const createPayment = async (data, reqUser) => {
  const ctx = buildCtx(reqUser);

  // 1. Verify lead
  const lead = await Lead.findOne({
    _id:       data.lead_id,
    tenant_id: String(ctx.tenantId),
    archived:  false,
  });
  if (!lead) throw AppError.notFound('Lead not found in this workspace');

  // 2. Create payment with Pending status
  const payment = await paymentRepo.create({
    tenant_id:      String(ctx.tenantId),
    lead_id:        data.lead_id,
    deal_id:        data.deal_id || null,
    amount:         data.amount,
    currency:       data.currency       || 'USD',
    payment_method: data.payment_method || 'Card',
    status:         PAYMENT_STATUS.PENDING,
    source:         lead.source   || null,
    campaign:       lead.campaign || null,
    created_by:     ctx.userId,
  });

  // 3. Set payment link now that we have the _id
  const payment_link = generatePaymentLink(payment._id);
  await paymentRepo.updateById(String(ctx.tenantId), payment._id, { payment_link });
  payment.payment_link = payment_link;

  // 4. Emit PAYMENT_CREATED tracking event
  await createTrackingEvent({
    tenant_id:  String(ctx.tenantId),
    event_type: TRACKING_EVENT_TYPE.PAYMENT_CREATED,
    lead_id:    data.lead_id,
    source:     lead.source   || null,
    campaign:   lead.campaign || null,
    revenue:    0,
    metadata:   { payment_id: String(payment._id), amount: data.amount },
    created_by: ctx.userId,
  });

  return payment;
};

// =============================================================================
// MARK PAID — the most important operation
// =============================================================================

/**
 * markPaid — marks a payment as Paid and fires all connected side effects.
 *
 * SOURCE: MASTER_SPEC §B12:
 *   "Mark Paid → deal Won + lead Won + revenue + attribution event + notify"
 *
 * SOURCE: DEVELOPER_HANDOFF.md markPaymentPaid:
 *   "payment→Paid, lead→Won, deal→Won,
 *    track('Payment Completed'+'Deal Won'), notify, toast"
 *
 * SOURCE: FRONTEND_SPEC §13:
 *   "Mark Paid → deal closes Won, lead → Won, revenue + attribution update + notification"
 *
 * STEPS:
 *   1. Validate payment exists and is not already Paid/Refunded
 *   2. Set payment.status = 'Paid', payment_date = now
 *   3. Update lead.status → 'Won'
 *   4. Update deal.stage → 'Won', deal.value = payment.amount
 *   5. Log to lead activity timeline
 *   6. Create notification for lead's assigned user
 *   7. Emit PAYMENT_COMPLETED tracking event (with revenue)
 *   8. Emit DEAL_WON tracking event
 *
 * @param {string} id       — payment._id
 * @param {string} tenantId
 * @param {Object} reqUser
 */
export const markPaid = async (id, tenantId, reqUser) => {
  const ctx = buildCtx(reqUser);

  const payment = await paymentRepo.findById(tenantId, id);
  if (!payment) throw AppError.notFound('Payment not found');

  if (payment.status === PAYMENT_STATUS.PAID) {
    throw AppError.badRequest('Payment is already marked as Paid');
  }
  if (payment.status === PAYMENT_STATUS.REFUNDED) {
    throw AppError.badRequest('Cannot mark a refunded payment as Paid');
  }

  // 2. Update payment status
  const updated = await paymentRepo.updateById(tenantId, id, {
    status:       PAYMENT_STATUS.PAID,
    payment_date: new Date(),
    updated_by:   ctx.userId,
  });

  const leadId = payment.lead_id?._id || payment.lead_id;
  const amount = payment.amount;

  // 3. Update lead → 'Won'
  const lead = await Lead.findOneAndUpdate(
    { _id: leadId, tenant_id: String(tenantId) },
    { $set: { status: LEAD_STATUS_ON_PAID } },
    { new: true }
  );

  // 4. Update deal → 'Won' + value = payment.amount
  let deal = null;
  if (payment.deal_id) {
    deal = await Deal.findOneAndUpdate(
      { _id: payment.deal_id, tenant_id: String(tenantId) },
      {
        $set:  { stage: DEAL_STAGE_ON_PAID, value: amount },
        $push: {
          stageHistory: {
            stage:   DEAL_STAGE_ON_PAID,
            movedAt: new Date(),
            movedBy: ctx.userId,
          },
        },
      },
      { new: true }
    );
  } else {
    // Find open deal for this lead if no deal_id on payment
    const openDeal = await Deal.findOne({
      tenant_id: String(tenantId),
      lead_id:   leadId,
      archived:  false,
      stage:     { $nin: ['Won', 'Lost'] },
    }).sort({ created_at: -1 });

    if (openDeal) {
      deal = await Deal.findOneAndUpdate(
        { _id: openDeal._id, tenant_id: String(tenantId) },
        {
          $set:  { stage: DEAL_STAGE_ON_PAID, value: amount },
          $push: {
            stageHistory: {
              stage:   DEAL_STAGE_ON_PAID,
              movedAt: new Date(),
              movedBy: ctx.userId,
            },
          },
        },
        { new: true }
      );

      // Real pause-on-conversion -- a lead who just genuinely converted
      // (paid) shouldn't keep receiving nurture/re-engagement messages
      // meant for prospects still being worked. Best-effort.
      await NurtureEnrollment.updateMany(
        { tenantId: String(tenantId), leadId, status: ENROLLMENT_STATUS.ACTIVE },
        {
          $set: { status: ENROLLMENT_STATUS.PAUSED, pauseReason: 'CONVERTED', nextExecutionAt: null },
          $push: { auditLog: { action: 'PAUSE', performedAt: new Date(), note: 'Lead converted (payment marked paid)' } },
        },
      ).catch((err) => {
        console.error('[nurture] failed to pause enrollments on conversion for lead', String(leadId), err);
      });
    }
  }

  // 5. Log to activity timeline
  await logActivity(
    ctx,
    leadId,
    ACTIVITY_TYPE.LEAD_UPDATED,
    `Payment of ${payment.currency} ${amount.toLocaleString()} marked as Paid. Lead status → Won.`,
    { payment_id: id, amount, currency: payment.currency }
  );

  // 6. Notification for lead's assigned user
  const assignedUserId = lead?.assigned_user_id || null;
  await createNotification(
    String(tenantId),
    assignedUserId,
    '💰 Payment Received!',
    `Payment of ${payment.currency} ${amount.toLocaleString()} received from ${lead?.name || 'Lead'}. Deal closed Won!`,
    { payment_id: id, lead_id: String(leadId), amount }
  );

  // Real Automation Rules dispatch for PAYMENT_RECEIVED -- same
  // previously-idle dispatch() as the other real trigger sites.
  automationRulesService
    .dispatch(ctx, AUTOMATION_TRIGGER_TYPE.PAYMENT_RECEIVED, {
      leadId: String(leadId),
      lead,
      dealId: deal ? String(deal._id) : null,
      payment: { id, amount, currency: payment.currency },
    })
    .catch((err) => {
      console.warn(`[automation] PAYMENT_RECEIVED dispatch failed for payment ${id}: ${err.message}`);
    });

  // 7. PAYMENT_COMPLETED tracking event (with revenue for attribution)
  await createTrackingEvent({
    tenant_id:  String(tenantId),
    event_type: TRACKING_EVENT_TYPE.PAYMENT_COMPLETED,
    lead_id:    leadId,
    source:     payment.source   || null,
    campaign:   payment.campaign || null,
    revenue:    amount, // ← this powers the "Revenue by Source" attribution chart
    metadata:   { payment_id: id, amount, currency: payment.currency },
    created_by: ctx.userId,
  });

  // 8. DEAL_WON tracking event
  if (deal) {
    await createTrackingEvent({
      tenant_id:  String(tenantId),
      event_type: TRACKING_EVENT_TYPE.DEAL_WON,
      lead_id:    leadId,
      source:     payment.source   || null,
      campaign:   payment.campaign || null,
      revenue:    0, // revenue already counted on PAYMENT_COMPLETED
      metadata:   { deal_id: String(deal._id), value: amount },
      created_by: ctx.userId,
    });
  }

  // 9. Real, best-effort payment confirmation email -- same non-blocking
  // principle as every other side effect in this flow.
  if (lead?.email) {
    sendPaymentConfirmation({
      email: lead.email, leadName: lead.name || 'there', amount, currency: payment.currency,
    }).catch((err) => console.error('[email] payment confirmation failed for payment', id, err.message));
  }

  return updated;
};

// =============================================================================
// REFUND PAYMENT
// =============================================================================

/**
 * refundPayment — marks a Paid payment as Refunded.
 * SOURCE: MASTER_SPEC §B12 "refund" action
 * SOURCE: FRONTEND_SPEC §13 "Refund" button on Paid payments
 *
 * @param {string} id
 * @param {string} tenantId
 * @param {Object} body     — { refund_reason? }
 * @param {Object} reqUser
 */
export const refundPayment = async (id, tenantId, body = {}, reqUser) => {
  const ctx = buildCtx(reqUser);

  const payment = await paymentRepo.findById(tenantId, id);
  if (!payment) throw AppError.notFound('Payment not found');

  if (payment.status !== PAYMENT_STATUS.PAID) {
    throw AppError.badRequest('Only Paid payments can be refunded');
  }

  const updated = await paymentRepo.updateById(tenantId, id, {
    status:        PAYMENT_STATUS.REFUNDED,
    refunded_at:   new Date(),
    refund_reason: body.refund_reason || null,
    updated_by:    ctx.userId,
  });

  const leadId = payment.lead_id?._id || payment.lead_id;

  await logActivity(
    ctx,
    leadId,
    ACTIVITY_TYPE.LEAD_UPDATED,
    `Payment of ${payment.currency} ${payment.amount.toLocaleString()} refunded.${body.refund_reason ? ` Reason: ${body.refund_reason}` : ''}`,
    { payment_id: id, amount: payment.amount }
  );

  return updated;
};

// =============================================================================
// UPDATE PAYMENT — status change (Pending → Sent etc.)
// =============================================================================

/**
 * updatePayment — updates payment fields other than marking paid/refunded.
 * Source: DEVELOPER_HANDOFF.md updatePayment action
 */
export const updatePayment = async (tenantId, id, patch, reqUser) => {
  const ctx = buildCtx(reqUser);

  const payment = await paymentRepo.findById(tenantId, id);
  if (!payment) throw AppError.notFound('Payment not found');

  // Prevent bypassing markPaid / refundPayment flows
  if (patch.status === PAYMENT_STATUS.PAID) {
    throw AppError.badRequest('Use the Mark Paid endpoint to mark a payment as paid');
  }
  if (patch.status === PAYMENT_STATUS.REFUNDED) {
    throw AppError.badRequest('Use the Refund endpoint to refund a payment');
  }

  const updated = await paymentRepo.updateById(tenantId, id, {
    ...patch,
    updated_by: ctx.userId,
  });

  // Real, best-effort payment failure email -- same non-blocking
  // principle as every other side effect in payment.service.js.
  if (patch.status === PAYMENT_STATUS.FAILED) {
    const leadId = payment.lead_id?._id || payment.lead_id;
    Lead.findOne({ _id: leadId, tenant_id: String(tenantId) }).select('email name').then((lead) => {
      if (lead?.email) {
        return sendPaymentFailure({
          email: lead.email, leadName: lead.name || 'there', amount: payment.amount, currency: payment.currency,
        });
      }
    }).catch((err) => console.error('[email] payment failure email failed for payment', id, err.message));
  }

  return updated;
};

// =============================================================================
// EXPORT DATA — CSV
// =============================================================================

/**
 * getExportData — all payments formatted for CSV.
 * SOURCE: MASTER_SPEC §B12 implied by "CSV" pattern + FRONTEND_SPEC §13 "Export"
 */
export const getExportData = async (tenantId) => {
  const payments = await paymentRepo.findByTenantId(
    tenantId, {}, { skip: 0, limit: 10000 }
  );

  return payments.map((p) => ({
    lead_name:      p.lead_id?.name  || '',
    lead_email:     p.lead_id?.email || '',
    amount:         p.amount,
    currency:       p.currency,
    payment_method: p.payment_method,
    status:         p.status,
    payment_date:   p.payment_date || '',
    source:         p.source       || '',
    campaign:       p.campaign     || '',
    payment_link:   p.payment_link || '',
    created_at:     p.created_at,
  }));
};