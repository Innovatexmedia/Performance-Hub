/**
 * =============================================================================
 * InnovateX Revenue OS — Reports Repository
 * =============================================================================
 *
 * FILE: src/modules/reports/report.repository.js
 *
 * PURPOSE
 * ───────
 * AGGREGATION ONLY. No business logic, no formatting, no percentage math.
 * Every query is tenant-scoped via { tenant_id: tenantId } — same field name
 * used across Lead, Deal, Call, Booking, Payment, Campaign, Qualification.
 *
 * Pattern matches attribution.repository.js exactly:
 *   - tenantId always first argument
 *   - Returns raw aggregation results; the service shapes them
 *   - buildQuery() applies tenant scope + optional date_from/date_to
 *
 * Two tabs (Attribution, WhatsApp) are NOT covered here — they reuse
 * attribution.service.js and whatsappAnalyticsService directly (see
 * report.service.js) instead of duplicating existing aggregation logic.
 * =============================================================================
 */

import mongoose from 'mongoose';
import { Lead } from '../leads/lead/lead.model.js';
import { Deal } from '../pipeline/deals/deal.model.js';
import { Call } from '../calls/call.model.js';
import { Booking } from '../bookings/booking.model.js';
import { Payment } from '../payments/payment.model.js';
import { Campaign } from '../campaigns/campaign.model.js';
import { Qualification } from '../qualification/qualification.model.js';
import User from '../auth/models/User.js';

import { WON_DEAL_STAGE, LOST_DEAL_STAGE, REVENUE_PAYMENT_STATUS, REFUNDED_PAYMENT_STATUS } from './report.constants.js';

// =============================================================================
// PRIVATE: BUILD QUERY WITH DATE FILTER — mirrors attribution.repository.js
// =============================================================================

const buildDateRange = (filter = {}) => {
  if (!filter.date_from && !filter.date_to) return null;
  const range = {};
  if (filter.date_from) range.$gte = new Date(filter.date_from);
  if (filter.date_to) {
    const end = new Date(filter.date_to);
    end.setHours(23, 59, 59, 999);
    range.$lte = end;
  }
  return range;
};

const baseQuery = (tenantId, filter = {}, dateField = 'created_at') => {
  const query = { tenant_id: tenantId };
  const range = buildDateRange(filter);
  if (range) query[dateField] = range;
  return query;
};

// =============================================================================
// LEAD REPORT
// =============================================================================

export const getLeadKpis = async (tenantId, filter = {}) => {
  const query = { ...baseQuery(tenantId, filter), archived: { $ne: true } };
  if (filter.source) query.source = filter.source;

  // 'Qualified or further along' -- matches the same status set the
  // frontend's Lead report tab uses to define "Qualified" (a lead that has
  // progressed past raw qualification, not just leads currently sitting in
  // the literal 'Qualified' status).
  const QUALIFIED_OR_LATER = ['Qualified', 'Booked', 'Call Completed', 'Proposal Sent', 'Won'];

  const [total, wonCount, hotCount, qualifiedCount, scoreAgg] = await Promise.all([
    Lead.countDocuments(query),
    Lead.countDocuments({ ...query, status: 'Won' }),
    Lead.countDocuments({ ...query, lead_temperature: 'Hot' }),
    Lead.countDocuments({ ...query, status: { $in: QUALIFIED_OR_LATER } }),
    Lead.aggregate([
      { $match: query },
      { $group: { _id: null, avgScore: { $avg: '$qualification_score' } } },
    ]),
  ]);

  return {
    total,
    won: wonCount,
    hot: hotCount,
    qualified: qualifiedCount,
    avgScore: scoreAgg[0]?.avgScore || 0,
  };
};

export const getLeadsByStatus = (tenantId, filter = {}) => {
  const query = { ...baseQuery(tenantId, filter), archived: { $ne: true } };
  if (filter.source) query.source = filter.source;
  return Lead.aggregate([
    { $match: query },
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $project: { _id: 0, status: '$_id', count: 1 } },
  ]);
};

export const getLeadsBySource = (tenantId, filter = {}) => {
  const query = { ...baseQuery(tenantId, filter), archived: { $ne: true } };
  return Lead.aggregate([
    { $match: query },
    { $group: { _id: { $ifNull: ['$source', 'Direct'] }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $project: { _id: 0, source: '$_id', count: 1 } },
  ]);
};

export const getLeadsByTemperature = (tenantId, filter = {}) => {
  const query = { ...baseQuery(tenantId, filter), archived: { $ne: true } };
  if (filter.source) query.source = filter.source;
  return Lead.aggregate([
    { $match: query },
    { $group: { _id: { $ifNull: ['$lead_temperature', 'Unscored'] }, count: { $sum: 1 } } },
    { $project: { _id: 0, temperature: '$_id', count: 1 } },
  ]);
};

export const getLeadTrend = (tenantId, filter = {}) => {
  const query = { ...baseQuery(tenantId, filter), archived: { $ne: true } };
  if (filter.source) query.source = filter.source;
  return Lead.aggregate([
    { $match: query },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, date: '$_id', count: 1 } },
  ]);
};

export const getLeadTable = (tenantId, filter = {}, { skip = 0, limit = 20 } = {}) => {
  const query = { ...baseQuery(tenantId, filter), archived: { $ne: true } };
  if (filter.source) query.source = filter.source;
  return Lead.find(query)
    .select('name email phone company source status lead_temperature qualification_score value created_at')
    .sort({ created_at: -1 })
    .skip(skip)
    .limit(limit);
};

export const countLeadTable = (tenantId, filter = {}) => {
  const query = { ...baseQuery(tenantId, filter), archived: { $ne: true } };
  if (filter.source) query.source = filter.source;
  return Lead.countDocuments(query);
};

// =============================================================================
// PIPELINE REPORT
// =============================================================================

export const getPipelineKpis = async (tenantId, filter = {}) => {
  const query = { ...baseQuery(tenantId, filter), archived: { $ne: true } };
  if (filter.source) query.source = filter.source;

  const [totals, closedAgg] = await Promise.all([
    Deal.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: 1 }, pipelineValue: { $sum: '$value' } } },
    ]),
    Deal.aggregate([
      { $match: { ...query, stage: { $in: [WON_DEAL_STAGE, LOST_DEAL_STAGE] } } },
      { $group: { _id: '$stage', count: { $sum: 1 }, value: { $sum: '$value' } } },
    ]),
  ]);

  const won  = closedAgg.find((r) => r._id === WON_DEAL_STAGE)?.count || 0;
  const lost = closedAgg.find((r) => r._id === LOST_DEAL_STAGE)?.count || 0;
  const wonValue = closedAgg.find((r) => r._id === WON_DEAL_STAGE)?.value || 0;

  return {
    total:         totals[0]?.total || 0,
    pipelineValue: totals[0]?.pipelineValue || 0,
    won,
    lost,
    wonValue,
    avgDealSize: totals[0]?.total ? (totals[0].pipelineValue / totals[0].total) : 0,
  };
};

export const getDealsByStage = (tenantId, filter = {}) => {
  const query = { ...baseQuery(tenantId, filter), archived: { $ne: true } };
  if (filter.source) query.source = filter.source;
  return Deal.aggregate([
    { $match: query },
    { $group: { _id: '$stage', count: { $sum: 1 }, value: { $sum: '$value' } } },
    { $project: { _id: 0, stage: '$_id', count: 1, value: 1 } },
  ]);
};

export const getPipelineTable = (tenantId, filter = {}, { skip = 0, limit = 20 } = {}) => {
  const query = { ...baseQuery(tenantId, filter), archived: { $ne: true } };
  if (filter.source) query.source = filter.source;
  return Deal.find(query)
    .select('title stage value probability source assigned_user_id expected_close_date created_at')
    .sort({ value: -1 })
    .skip(skip)
    .limit(limit);
};

export const countPipelineTable = (tenantId, filter = {}) => {
  const query = { ...baseQuery(tenantId, filter), archived: { $ne: true } };
  if (filter.source) query.source = filter.source;
  return Deal.countDocuments(query);
};

// =============================================================================
// CAMPAIGN REPORT (marketing campaigns — top-level Campaign model)
// =============================================================================

export const getCampaignKpis = async (tenantId, filter = {}) => {
  const query = baseQuery(tenantId, filter);
  if (filter.source) query.source = filter.source;

  const agg = await Campaign.aggregate([
    { $match: query },
    {
      $group: {
        _id: null,
        total:    { $sum: 1 },
        budget:   { $sum: '$budget' },
        spend:    { $sum: '$spend' },
        revenue:  { $sum: '$revenue' },
        leads:    { $sum: '$leads_generated' },
        bookings: { $sum: '$bookings' },
      },
    },
  ]);

  const row = agg[0] || { total: 0, budget: 0, spend: 0, revenue: 0, leads: 0, bookings: 0 };
  return {
    ...row,
    roas: row.spend > 0 ? Number((row.revenue / row.spend).toFixed(2)) : 0,
  };
};

export const getCampaignsByStatus = (tenantId, filter = {}) => {
  const query = baseQuery(tenantId, filter);
  return Campaign.aggregate([
    { $match: query },
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $project: { _id: 0, status: '$_id', count: 1 } },
  ]);
};

export const getCampaignsByType = (tenantId, filter = {}) => {
  const query = baseQuery(tenantId, filter);
  return Campaign.aggregate([
    { $match: query },
    { $group: { _id: '$campaign_type', count: { $sum: 1 }, revenue: { $sum: '$revenue' } } },
    { $project: { _id: 0, type: '$_id', count: 1, revenue: 1 } },
  ]);
};

export const getCampaignTable = (tenantId, filter = {}, { skip = 0, limit = 20 } = {}) => {
  const query = baseQuery(tenantId, filter);
  if (filter.source) query.source = filter.source;
  return Campaign.find(query)
    .select('campaign_name source medium campaign_type status budget spend revenue leads_generated bookings created_at')
    .sort({ revenue: -1 })
    .skip(skip)
    .limit(limit);
};

export const countCampaignTable = (tenantId, filter = {}) => {
  const query = baseQuery(tenantId, filter);
  if (filter.source) query.source = filter.source;
  return Campaign.countDocuments(query);
};

// =============================================================================
// REVENUE REPORT (Payment model)
// =============================================================================

export const getRevenueKpis = async (tenantId, filter = {}) => {
  const query = baseQuery(tenantId, filter);

  const [statusAgg] = await Promise.all([
    Payment.aggregate([
      { $match: query },
      { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
    ]),
  ]);

  const byStatus = {};
  for (const row of statusAgg) byStatus[row._id] = { count: row.count, amount: row.amount };

  const paid     = byStatus[REVENUE_PAYMENT_STATUS] || { count: 0, amount: 0 };
  const refunded = byStatus[REFUNDED_PAYMENT_STATUS] || { count: 0, amount: 0 };
  const pending  = byStatus['Pending'] || { count: 0, amount: 0 };

  return {
    totalRevenue:   paid.amount,
    paidCount:      paid.count,
    pendingAmount:  pending.amount,
    pendingCount:   pending.count,
    refundedAmount: refunded.amount,
    refundedCount:  refunded.count,
    avgPaymentSize: paid.count ? paid.amount / paid.count : 0,
  };
};

export const getRevenueByStatus = (tenantId, filter = {}) => {
  const query = baseQuery(tenantId, filter);
  return Payment.aggregate([
    { $match: query },
    { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
    { $project: { _id: 0, status: '$_id', count: 1, amount: 1 } },
  ]);
};

export const getRevenueByMethod = (tenantId, filter = {}) => {
  const query = { ...baseQuery(tenantId, filter), status: REVENUE_PAYMENT_STATUS };
  return Payment.aggregate([
    { $match: query },
    { $group: { _id: '$payment_method', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
    { $project: { _id: 0, method: '$_id', count: 1, amount: 1 } },
  ]);
};

export const getRevenueTrend = (tenantId, filter = {}) => {
  const query = { ...baseQuery(tenantId, filter), status: REVENUE_PAYMENT_STATUS };
  return Payment.aggregate([
    { $match: query },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
        amount: { $sum: '$amount' },
        count:  { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, date: '$_id', amount: 1, count: 1 } },
  ]);
};

export const getRevenueTable = (tenantId, filter = {}, { skip = 0, limit = 20 } = {}) => {
  const query = baseQuery(tenantId, filter);
  return Payment.find(query)
    .populate('lead_id', 'name email')
    .select('lead_id amount currency payment_method status payment_date created_at')
    .sort({ created_at: -1 })
    .skip(skip)
    .limit(limit);
};

export const countRevenueTable = (tenantId, filter = {}) => Payment.countDocuments(baseQuery(tenantId, filter));

// =============================================================================
// SALES ACTIVITY REPORT (per-agent breakdown across Call, Booking, Deal, Lead)
// =============================================================================

export const getCallsByAgent = (tenantId, filter = {}) => {
  const query = { ...baseQuery(tenantId, filter), assigned_user_id: { $ne: null } };
  return Call.aggregate([
    { $match: query },
    { $group: { _id: '$assigned_user_id', calls: { $sum: 1 }, avgScore: { $avg: '$score' } } },
  ]);
};

export const getBookingsByAgent = (tenantId, filter = {}) => {
  const query = { ...baseQuery(tenantId, filter), assigned_user_id: { $ne: null } };
  return Booking.aggregate([
    { $match: query },
    { $group: { _id: '$assigned_user_id', bookings: { $sum: 1 } } },
  ]);
};

export const getDealsWonByAgent = (tenantId, filter = {}) => {
  const query = {
    ...baseQuery(tenantId, filter),
    assigned_user_id: { $ne: null },
    stage: WON_DEAL_STAGE,
  };
  return Deal.aggregate([
    { $match: query },
    { $group: { _id: '$assigned_user_id', dealsWon: { $sum: 1 }, revenue: { $sum: '$value' } } },
  ]);
};

export const getLeadsAssignedByAgent = (tenantId, filter = {}) => {
  const query = {
    ...baseQuery(tenantId, filter),
    assigned_user_id: { $ne: null },
    archived: { $ne: true },
  };
  return Lead.aggregate([
    { $match: query },
    { $group: { _id: '$assigned_user_id', leadsAssigned: { $sum: 1 } } },
  ]);
};

/** Resolve a list of user-id strings to { id, name, email } — used to label agent rows. */
export const findUsersByIds = async (userIds = []) => {
  const objectIds = userIds
    .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (!objectIds.length) return [];
  return User.find({ _id: { $in: objectIds } }).select('firstName lastName email');
};

// =============================================================================
// AI QUALIFICATION REPORT
// =============================================================================

export const getQualificationKpis = async (tenantId, filter = {}) => {
  const query = baseQuery(tenantId, filter);

  const [totals, appliedCount, hotCount, hotAppliedCount] = await Promise.all([
    Qualification.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: 1 }, avgFitScore: { $avg: '$fit_score' } } },
    ]),
    Qualification.countDocuments({ ...query, applied: true }),
    Qualification.countDocuments({ ...query, temperature: 'Hot' }),
    Qualification.countDocuments({ ...query, temperature: 'Hot', applied: true }),
  ]);

  const total = totals[0]?.total || 0;
  return {
    total,
    avgFitScore: totals[0]?.avgFitScore || 0,
    applied: appliedCount,
    appliedRate: total ? (appliedCount / total) * 100 : 0,
    hotLeads: hotCount,
    // Real metric, NOT the old mock's hardcoded "34%" placeholder: the
    // applied-rate specifically among Hot-temperature qualifications.
    hotConversionRate: hotCount ? (hotAppliedCount / hotCount) * 100 : 0,
  };
};

export const getQualificationByTemperature = (tenantId, filter = {}) => {
  const query = baseQuery(tenantId, filter);
  return Qualification.aggregate([
    { $match: query },
    { $group: { _id: { $ifNull: ['$temperature', 'Unscored'] }, count: { $sum: 1 } } },
    { $project: { _id: 0, temperature: '$_id', count: 1 } },
  ]);
};

export const getQualificationByQuality = (tenantId, filter = {}) => {
  const query = baseQuery(tenantId, filter);
  return Qualification.aggregate([
    { $match: query },
    { $group: { _id: { $ifNull: ['$quality', 'Unscored'] }, count: { $sum: 1 } } },
    { $project: { _id: 0, quality: '$_id', count: 1 } },
  ]);
};

export const getQualificationTrend = (tenantId, filter = {}) => {
  const query = baseQuery(tenantId, filter);
  return Qualification.aggregate([
    { $match: query },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
        count: { $sum: 1 },
        avgFitScore: { $avg: '$fit_score' },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, date: '$_id', count: 1, avgFitScore: 1 } },
  ]);
};

export const getQualificationTable = (tenantId, filter = {}, { skip = 0, limit = 20 } = {}) => {
  const query = baseQuery(tenantId, filter);
  return Qualification.find(query)
    .populate('lead_id', 'name email')
    .select('lead_id fit_score temperature quality buying_intent applied created_at')
    .sort({ created_at: -1 })
    .skip(skip)
    .limit(limit);
};

export const countQualificationTable = (tenantId, filter = {}) => Qualification.countDocuments(baseQuery(tenantId, filter));