/**
 * =============================================================================
 * InnovateX Revenue OS — Reports Service
 * =============================================================================
 *
 * FILE: src/modules/reports/report.service.js
 *
 * PURPOSE
 * ───────
 * All business logic for the 9 report tabs: percentage calculations, chart
 * shaping, agent-name resolution, and pagination. Runs independent
 * aggregations in parallel with Promise.all().
 *
 * Two tabs reuse EXISTING services instead of duplicating aggregation logic
 * (DRY, and consistent with the precedent in call.service.js which already
 * imports from attribution.service.js):
 *   - Attribution tab → attribution.service.getAttributionDashboard()
 *   - WhatsApp tab    → whatsappAnalyticsService.getDashboard() + getTrends()
 * =============================================================================
 */

import * as reportRepo from './report.repository.js';
import { getAttributionDashboard } from '../attribution/attribution.service.js';
import { whatsappAnalyticsService } from '../whatsapp/submodules/whatsappAnalytics/whatsappAnalytics.service.js';
import { WhatsAppCampaign } from '../whatsapp/submodules/campaigns/campaigns.model.js';
import { paginationMeta, normalizePaging } from '../../shared/helpers/lead.helpers.js';

// =============================================================================
// PRIVATE HELPERS
// =============================================================================

/** Safe percentage, fixed to 2 decimals, returned as a Number. */
const pct = (part, whole, digits = 2) => {
  if (!whole || whole <= 0) return 0;
  return Number(((part / whole) * 100).toFixed(digits));
};

const round2 = (n) => Number((n || 0).toFixed(2));

/** Build the ctx object expected by whatsappAnalyticsService (WhatsApp submodule pattern). */
const buildWaCtx = (reqUser) => ({
  tenantId: reqUser.tenantId,
  userId:   reqUser.sub,
  role:     reqUser.role,
});

/** Extract the shared filter set: date_from, date_to, source. */
const buildFilter = (query = {}) => {
  const filter = {};
  if (query.date_from) filter.date_from = query.date_from;
  if (query.date_to)   filter.date_to   = query.date_to;
  if (query.source)    filter.source    = query.source;
  return filter;
};

/** Merge agent aggregation rows (calls/bookings/deals/leads) into one row-per-agent map. */
const mergeAgentRows = (rowsList) => {
  const map = {};
  for (const { rows, field } of rowsList) {
    for (const r of rows) {
      const id = r._id;
      if (!map[id]) {
        map[id] = {
          agentId: id, calls: 0, avgCallScore: 0, bookings: 0,
          dealsWon: 0, revenue: 0, leadsAssigned: 0,
        };
      }
      Object.assign(map[id], field(r));
    }
  }
  return map;
};

// =============================================================================
// 1. LEAD REPORT
// =============================================================================

export const getLeadReport = async (tenantId, query = {}) => {
  const filter = buildFilter(query);
  const { page, limit, skip } = normalizePaging(query);

  const [kpis, byStatus, bySource, byTemperature, trend, rows, total] = await Promise.all([
    reportRepo.getLeadKpis(tenantId, filter),
    reportRepo.getLeadsByStatus(tenantId, filter),
    reportRepo.getLeadsBySource(tenantId, filter),
    reportRepo.getLeadsByTemperature(tenantId, filter),
    reportRepo.getLeadTrend(tenantId, filter),
    reportRepo.getLeadTable(tenantId, filter, { skip, limit }),
    reportRepo.countLeadTable(tenantId, filter),
  ]);

  return {
    kpis: {
      totalLeads:      kpis.total,
      wonLeads:        kpis.won,
      hotLeads:        kpis.hot,
      qualifiedLeads:  kpis.qualified,
      conversionRate:  pct(kpis.won, kpis.total),
      avgQualificationScore: round2(kpis.avgScore),
    },
    charts: {
      byStatus,
      bySource,
      byTemperature,
      trend,
    },
    table: {
      rows,
      pagination: paginationMeta({ page, limit, total }),
    },
  };
};

// =============================================================================
// 2. PIPELINE REPORT
// =============================================================================

export const getPipelineReport = async (tenantId, query = {}) => {
  const filter = buildFilter(query);
  const { page, limit, skip } = normalizePaging(query);

  const [kpis, byStage, rows, total] = await Promise.all([
    reportRepo.getPipelineKpis(tenantId, filter),
    reportRepo.getDealsByStage(tenantId, filter),
    reportRepo.getPipelineTable(tenantId, filter, { skip, limit }),
    reportRepo.countPipelineTable(tenantId, filter),
  ]);

  const closedTotal = kpis.won + kpis.lost;

  return {
    kpis: {
      totalDeals:    kpis.total,
      pipelineValue: round2(kpis.pipelineValue),
      wonDeals:      kpis.won,
      lostDeals:     kpis.lost,
      wonValue:      round2(kpis.wonValue),
      winRate:       pct(kpis.won, closedTotal),
      avgDealSize:   round2(kpis.avgDealSize),
    },
    charts: { byStage },
    table: {
      rows,
      pagination: paginationMeta({ page, limit, total }),
    },
  };
};

// =============================================================================
// 3. ATTRIBUTION REPORT — reuses attribution.service.js directly
// =============================================================================

export const getAttributionReport = async (tenantId, query = {}) => {
  const filter = buildFilter(query);
  // attribution.service already returns dashboard data shaped for the
  // Attribution page — reuse verbatim rather than reimplementing.
  const dashboard = await getAttributionDashboard(tenantId, filter);
  return dashboard;
};

// =============================================================================
// 4. WHATSAPP REPORT — reuses whatsappAnalyticsService directly
// =============================================================================

export const getWhatsAppReport = async (reqUser, query = {}) => {
  const ctx = buildWaCtx(reqUser);
  const waQuery = {
    dateFrom: query.date_from,
    dateTo:   query.date_to,
    provider: query.provider,
  };

  const [dashboard, trends, revenueAgg] = await Promise.all([
    whatsappAnalyticsService.getDashboard(ctx, waQuery),
    whatsappAnalyticsService.getTrends(ctx, { ...waQuery, period: 'DAILY' }),
    // whatsappAnalyticsService.getDashboard() has no revenue field at all --
    // the frontend's WhatsApp report tab needs "WA Revenue", so this sums
    // WhatsAppCampaign.revenueGenerated directly (same real field the
    // WhatsApp Campaigns page itself reports on).
    WhatsAppCampaign.aggregate([
      { $match: { tenant_id: ctx.tenantId } },
      { $group: { _id: null, revenue: { $sum: '$revenueGenerated' } } },
    ]),
  ]);

  return {
    kpis: { ...dashboard, revenue: revenueAgg[0]?.revenue || 0 },
    charts: {
      messagesTrend:      trends.messages,
      conversationsTrend: trends.conversations,
      deliveriesTrend:    trends.deliveries,
    },
  };
};

// =============================================================================
// 5. CAMPAIGN REPORT (marketing)
// =============================================================================

export const getCampaignReport = async (tenantId, query = {}) => {
  const filter = buildFilter(query);
  const { page, limit, skip } = normalizePaging(query);

  const [kpis, byStatus, byType, rows, total] = await Promise.all([
    reportRepo.getCampaignKpis(tenantId, filter),
    reportRepo.getCampaignsByStatus(tenantId, filter),
    reportRepo.getCampaignsByType(tenantId, filter),
    reportRepo.getCampaignTable(tenantId, filter, { skip, limit }),
    reportRepo.countCampaignTable(tenantId, filter),
  ]);

  return {
    kpis: {
      totalCampaigns: kpis.total,
      totalBudget:    round2(kpis.budget),
      totalSpend:     round2(kpis.spend),
      totalRevenue:   round2(kpis.revenue),
      totalLeads:     kpis.leads,
      totalBookings:  kpis.bookings,
      roas:           kpis.roas,
    },
    charts: { byStatus, byType },
    table: {
      rows: rows.map((c) => ({
        id:              c._id,
        campaignName:    c.campaign_name,
        source:          c.source,
        medium:          c.medium,
        campaignType:    c.campaign_type,
        status:          c.status,
        budget:          c.budget,
        spend:           c.spend,
        revenue:         c.revenue,
        leadsGenerated:  c.leads_generated,
        bookings:        c.bookings,
        roas: c.spend > 0 ? round2(c.revenue / c.spend) : 0,
        createdAt:       c.created_at,
      })),
      pagination: paginationMeta({ page, limit, total }),
    },
  };
};

// =============================================================================
// 6. REVENUE REPORT (Payment model)
// =============================================================================

export const getRevenueReport = async (tenantId, query = {}) => {
  const filter = buildFilter(query);
  const { page, limit, skip } = normalizePaging(query);

  const [kpis, byStatus, byMethod, trend, rows, total] = await Promise.all([
    reportRepo.getRevenueKpis(tenantId, filter),
    reportRepo.getRevenueByStatus(tenantId, filter),
    reportRepo.getRevenueByMethod(tenantId, filter),
    reportRepo.getRevenueTrend(tenantId, filter),
    reportRepo.getRevenueTable(tenantId, filter, { skip, limit }),
    reportRepo.countRevenueTable(tenantId, filter),
  ]);

  return {
    kpis: {
      totalRevenue:   round2(kpis.totalRevenue),
      paidCount:      kpis.paidCount,
      pendingAmount:  round2(kpis.pendingAmount),
      pendingCount:   kpis.pendingCount,
      refundedAmount: round2(kpis.refundedAmount),
      refundedCount:  kpis.refundedCount,
      avgPaymentSize: round2(kpis.avgPaymentSize),
    },
    charts: { byStatus, byMethod, trend },
    table: {
      rows: rows.map((p) => ({
        id:            String(p._id),
        leadName:      p.lead_id?.name || '',
        leadEmail:     p.lead_id?.email || '',
        amount:        p.amount,
        currency:      p.currency,
        paymentMethod: p.payment_method,
        status:        p.status,
        paymentDate:   p.payment_date,
        createdAt:     p.created_at,
      })),
      pagination: paginationMeta({ page, limit, total }),
    },
  };
};

// =============================================================================
// 7. SALES ACTIVITY REPORT (per-agent, across Call/Booking/Deal/Lead)
// =============================================================================

export const getSalesActivityReport = async (tenantId, query = {}) => {
  const filter = buildFilter(query);

  const [calls, bookings, dealsWon, leadsAssigned] = await Promise.all([
    reportRepo.getCallsByAgent(tenantId, filter),
    reportRepo.getBookingsByAgent(tenantId, filter),
    reportRepo.getDealsWonByAgent(tenantId, filter),
    reportRepo.getLeadsAssignedByAgent(tenantId, filter),
  ]);

  const map = mergeAgentRows([
    { rows: calls,         field: (r) => ({ calls: r.calls, avgCallScore: round2(r.avgScore) }) },
    { rows: bookings,      field: (r) => ({ bookings: r.bookings }) },
    { rows: dealsWon,      field: (r) => ({ dealsWon: r.dealsWon, revenue: round2(r.revenue) }) },
    { rows: leadsAssigned, field: (r) => ({ leadsAssigned: r.leadsAssigned }) },
  ]);

  const agentIds = Object.keys(map);
  const users = await reportRepo.findUsersByIds(agentIds);
  const nameMap = {};
  for (const u of users) {
    nameMap[String(u._id)] = {
      name:  [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email,
      email: u.email,
    };
  }

  const rows = agentIds.map((id) => ({
    agentId:      id,
    agentName:    nameMap[id]?.name  || 'Unknown',
    agentEmail:   nameMap[id]?.email || '',
    ...map[id],
    totalActivities: map[id].calls + map[id].bookings + map[id].dealsWon + map[id].leadsAssigned,
  })).sort((a, b) => b.totalActivities - a.totalActivities);

  const kpis = {
    totalAgents:      rows.length,
    totalCalls:       rows.reduce((s, r) => s + r.calls, 0),
    totalBookings:    rows.reduce((s, r) => s + r.bookings, 0),
    totalDealsWon:    rows.reduce((s, r) => s + r.dealsWon, 0),
    mostActiveAgent:  rows[0]?.agentName || null,
  };

  return {
    kpis,
    charts: {
      callsByAgent:    rows.map((r) => ({ agent: r.agentName, count: r.calls })),
      bookingsByAgent: rows.map((r) => ({ agent: r.agentName, count: r.bookings })),
      dealsWonByAgent: rows.map((r) => ({ agent: r.agentName, count: r.dealsWon })),
    },
    table: { rows },
  };
};

// =============================================================================
// 8. NURTURE REPORT — reuses whatsappAnalyticsService.getNurtureAnalytics()
// =============================================================================

export const getNurtureReport = async (reqUser) => {
  const ctx = buildWaCtx(reqUser);
  const data = await whatsappAnalyticsService.getNurtureAnalytics(ctx);
  return {
    kpis: {
      activeFlows:      data.activeFlows,
      completedFlows:   data.completedFlows,
      contactsEnrolled: data.contactsEnrolled,
      messagesSent:     data.messagesSent,
      failures:         data.failures,
    },
    charts: {
      enrollmentBreakdown: data.enrollmentBreakdown,
    },
  };
};

// =============================================================================
// 9. AI QUALIFICATION REPORT
// =============================================================================

export const getAiQualificationReport = async (tenantId, query = {}) => {
  const filter = buildFilter(query);
  const { page, limit, skip } = normalizePaging(query);

  const [kpis, byTemperature, byQuality, trend, rows, total] = await Promise.all([
    reportRepo.getQualificationKpis(tenantId, filter),
    reportRepo.getQualificationByTemperature(tenantId, filter),
    reportRepo.getQualificationByQuality(tenantId, filter),
    reportRepo.getQualificationTrend(tenantId, filter),
    reportRepo.getQualificationTable(tenantId, filter, { skip, limit }),
    reportRepo.countQualificationTable(tenantId, filter),
  ]);

  return {
    kpis: {
      totalQualifications: kpis.total,
      avgFitScore:         round2(kpis.avgFitScore),
      applied:             kpis.applied,
      appliedRate:         round2(kpis.appliedRate),
      hotLeads:            kpis.hotLeads,
      hotConversionRate:   round2(kpis.hotConversionRate),
    },
    charts: { byTemperature, byQuality, trend },
    table: {
      rows: rows.map((q) => ({
        id:          String(q._id),
        leadName:    q.lead_id?.name || '',
        leadEmail:   q.lead_id?.email || '',
        fitScore:    q.fit_score,
        temperature: q.temperature,
        quality:     q.quality,
        buyingIntent:q.buying_intent,
        applied:     q.applied,
        createdAt:   q.created_at,
      })),
      pagination: paginationMeta({ page, limit, total }),
    },
  };
};

// =============================================================================
// CSV EXPORT — tab-aware, returns flat rows as JSON (frontend builds the CSV)
// Mirrors attribution.controller.exportCsv's convention exactly.
// =============================================================================

export const getExportData = async (tenantId, reqUser, tab, query = {}) => {
  const filter = buildFilter(query);

  switch (tab) {
    case 'lead': {
      const rows = await reportRepo.getLeadTable(tenantId, filter, { skip: 0, limit: 1000 });
      return rows.map((l) => ({
        name: l.name, email: l.email, phone: l.phone, company: l.company,
        source: l.source, status: l.status, temperature: l.lead_temperature,
        score: l.qualification_score, value: l.value, created_at: l.created_at,
      }));
    }
    case 'pipeline': {
      const rows = await reportRepo.getPipelineTable(tenantId, filter, { skip: 0, limit: 1000 });
      return rows.map((d) => ({
        title: d.title, stage: d.stage, value: d.value, probability: d.probability,
        source: d.source, assigned_user_id: d.assigned_user_id,
        expected_close_date: d.expected_close_date, created_at: d.created_at,
      }));
    }
    case 'campaign': {
      const rows = await reportRepo.getCampaignTable(tenantId, filter, { skip: 0, limit: 1000 });
      return rows.map((c) => ({
        campaign_name: c.campaign_name, source: c.source, medium: c.medium,
        campaign_type: c.campaign_type, status: c.status, budget: c.budget,
        spend: c.spend, revenue: c.revenue, leads_generated: c.leads_generated,
        bookings: c.bookings, created_at: c.created_at,
      }));
    }
    case 'revenue': {
      const rows = await reportRepo.getRevenueTable(tenantId, filter, { skip: 0, limit: 1000 });
      return rows.map((p) => ({
        lead_name: p.lead_id?.name || '', amount: p.amount, currency: p.currency,
        payment_method: p.payment_method, status: p.status,
        payment_date: p.payment_date, created_at: p.created_at,
      }));
    }
    case 'ai-qualification': {
      const rows = await reportRepo.getQualificationTable(tenantId, filter, { skip: 0, limit: 1000 });
      return rows.map((q) => ({
        lead_name: q.lead_id?.name || '', fit_score: q.fit_score,
        temperature: q.temperature, quality: q.quality,
        buying_intent: q.buying_intent, applied: q.applied, created_at: q.created_at,
      }));
    }
    case 'sales-activity': {
      const report = await getSalesActivityReport(tenantId, query);
      return report.table.rows;
    }
    case 'attribution': {
      const data = await getAttributionDashboard(tenantId, filter);
      return data.recentEvents?.events || data.recentEvents || [];
    }
    case 'whatsapp':
    case 'nurture': {
      // Aggregated dashboards without a natural row-per-record export;
      // return the KPI object as a single-row export.
      if (!reqUser) return [];
      const kpis = tab === 'whatsapp'
        ? (await getWhatsAppReport(reqUser, query)).kpis
        : (await getNurtureReport(reqUser)).kpis;
      return [kpis];
    }
    default:
      return [];
  }
};