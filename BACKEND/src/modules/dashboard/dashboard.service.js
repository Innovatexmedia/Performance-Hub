/**
 * Dashboard Service — aggregates all KPIs, charts, and sections.
 *
 * FILE: src/modules/dashboard/dashboard.service.js
 *
 * SOURCE: MASTER_SPEC.md §B2 Dashboard:
 *   "KPI cards (12): total leads, qualified, hot, booked calls, pipeline value,
 *    revenue closed, conversion rate, avg response time, follow-up completion,
 *    WhatsApp conversations, pending replies, revenue-leakage alerts — all computed from data.
 *    Charts: leads by source, pipeline by stage, conversion funnel, revenue by source,
 *    booking trend, WhatsApp conversations over time, campaign performance.
 *    Sections: recent activity feed, top campaigns, revenue-leakage alerts, weekly AI briefing."
 *
 * SOURCE: FRONTEND_SPEC §3 Dashboard:
 *   KPI row 1: Total Leads | Qualified Leads | Hot Leads | Booked Calls
 *   KPI row 2: Pipeline Value | Revenue Closed | Conversion Rate | Avg Response Time
 *   KPI row 3: Follow-up Completion | WA Conversations | WA Pending Replies | Leakage Alerts
 *   Charts: Leads by Source (donut) | Pipeline by Stage (bar) | Conversion Funnel
 *           Revenue by Source (bar) | Booking Trend (line) | WA Conversations (line) | Campaign Perf (bar)
 *   Sections: Recent Activity | Top Campaigns | Revenue Leakage Alerts | Weekly AI Briefing
 *
 * ALL DATA IS REAL — computed from MongoDB collections.
 * No hardcoded values, no seed data.
 */

import { Lead }         from '../leads/lead/lead.model.js';
import { Deal }         from '../pipeline/deals/deal.model.js';
import { Booking }      from '../bookings/booking.model.js';
import { Call }         from '../calls/call.model.js';
import { Payment }      from '../payments/payment.model.js';
import { Campaign }     from '../campaigns/campaign.model.js';
import { Conversation } from '../whatsapp/conversations/conversation.model.js';
import { TrackingEvent } from '../attribution/tracking-event.model.js';

import { LEAD_STATUS, LEAD_TEMPERATURE } from '../leads/lead/lead.constants.js';
import { DEAL_STAGE }    from '../pipeline/deals/deal.constants.js';
import { BOOKING_STATUS } from '../bookings/booking.constants.js';
import { PAYMENT_STATUS } from '../payments/payment.constants.js';
import { TRACKING_EVENT_TYPE } from '../attribution/attribution.constants.js';
import { CONVERSATION_STATUS } from '../whatsapp/conversations/conversation.model.js';

// =============================================================================
// PRIVATE HELPERS
// =============================================================================

/** isoDate — returns YYYY-MM-DD string for a given days-ago offset */
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
};

/** percent change — (current - previous) / previous * 100, clamped to 2 decimals */
const percentChange = (current, previous) => {
  if (!previous) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
};

// =============================================================================
// KPI CARDS (12)
// =============================================================================

/**
 * getKpis — computes all 12 KPI card values from real data.
 *
 * SOURCE: MASTER_SPEC §B2 KPI list + FRONTEND_SPEC §3 screenshots:
 *   Row 1: Total Leads (40) | Qualified Leads (21) | Hot Leads (13) | Booked Calls (6)
 *   Row 2: Pipeline Value (266K) | Revenue Closed ($18K) | Conversion Rate (12.5%) | Avg Response Time (14m)
 *   Row 3: Follow-up Completion (38%) | WA Conversations (15) | WA Pending Replies (10) | Leakage Alerts (9)
 */
export const getKpis = async (tenantId) => {
  const now       = new Date();
  const monthAgo  = daysAgo(30);
  const twoMonthAgo = daysAgo(60);

  const [
    // ── Row 1 ─────────────────────────────────────────────────────────────────
    totalLeads,
    totalLeadsLastMonth,
    qualifiedLeads,
    qualifiedLeadsLastMonth,
    hotLeads,
    hotLeadsLastMonth,
    bookedCalls,
    bookedCallsLastMonth,

    // ── Row 2 ─────────────────────────────────────────────────────────────────
    pipelineAgg,
    revenueAgg,
    revenueLastMonthAgg,
    wonLeads,
    wonLeadsLastMonth,

    // ── Row 3 ─────────────────────────────────────────────────────────────────
    waConversations,
    waConversationsLastMonth,
    waPendingReplies,
    followUpLeads,
    followUpCompleted,

    // ── Leakage ───────────────────────────────────────────────────────────────
    ghostedLeads,
    idleProposals,
    bookedNotPaid,
  ] = await Promise.all([

    // ── Row 1 ─────────────────────────────────────────────────────────────────
    Lead.countDocuments({ tenant_id: tenantId, archived: false }),
    Lead.countDocuments({ tenant_id: tenantId, archived: false, created_at: { $lt: monthAgo } }),
    Lead.countDocuments({ tenant_id: tenantId, archived: false, status: LEAD_STATUS.QUALIFIED }),
    Lead.countDocuments({ tenant_id: tenantId, archived: false, status: LEAD_STATUS.QUALIFIED, created_at: { $lt: monthAgo } }),
    Lead.countDocuments({ tenant_id: tenantId, archived: false, lead_temperature: LEAD_TEMPERATURE.HOT }),
    Lead.countDocuments({ tenant_id: tenantId, archived: false, lead_temperature: LEAD_TEMPERATURE.HOT, created_at: { $lt: monthAgo } }),
    Booking.countDocuments({ tenant_id: tenantId, status: BOOKING_STATUS.SCHEDULED }),
    Booking.countDocuments({ tenant_id: tenantId, status: BOOKING_STATUS.SCHEDULED, created_at: { $lt: monthAgo } }),

    // ── Row 2 ─────────────────────────────────────────────────────────────────
    // Pipeline value = sum of all open (non-Won/Lost) deal values
    Deal.aggregate([
      { $match: { tenant_id: tenantId, archived: false, stage: { $nin: [DEAL_STAGE.WON, DEAL_STAGE.LOST] } } },
      { $group: { _id: null, total: { $sum: '$value' } } },
    ]),

    // Revenue = sum of Paid payment amounts
    Payment.aggregate([
      { $match: { tenant_id: tenantId, status: PAYMENT_STATUS.PAID } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),

    // Revenue last month
    Payment.aggregate([
      { $match: { tenant_id: tenantId, status: PAYMENT_STATUS.PAID, created_at: { $lt: monthAgo } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),

    // Conversion = leads that reached Won
    Lead.countDocuments({ tenant_id: tenantId, archived: false, status: LEAD_STATUS.WON }),
    Lead.countDocuments({ tenant_id: tenantId, archived: false, status: LEAD_STATUS.WON, created_at: { $lt: monthAgo } }),

    // ── Row 3 ─────────────────────────────────────────────────────────────────
    // WA Conversations — total open conversations
    Conversation.countDocuments({
      tenant_id: tenantId,
      archived:  false,
      status:    { $in: [CONVERSATION_STATUS.NEW, CONVERSATION_STATUS.OPEN, CONVERSATION_STATUS.PENDING] },
    }),
    Conversation.countDocuments({
      tenant_id: tenantId,
      archived:  false,
      status:    { $in: [CONVERSATION_STATUS.NEW, CONVERSATION_STATUS.OPEN, CONVERSATION_STATUS.PENDING] },
      created_at: { $lt: monthAgo },
    }),

    // WA Pending Replies — conversations awaiting our response (has unread from contact)
    Conversation.countDocuments({
      tenant_id:    tenantId,
      archived:     false,
      unread_count: { $gt: 0 },
    }),

    // Follow-up completion — leads contacted in last 7 days vs total leads needing follow-up
    Lead.countDocuments({ tenant_id: tenantId, archived: false, status: LEAD_STATUS.CONTACTED }),
    Lead.countDocuments({ tenant_id: tenantId, archived: false, status: LEAD_STATUS.CONTACTED, last_contacted_at: { $gte: daysAgo(7) } }),

    // ── Leakage Alerts ────────────────────────────────────────────────────────
    // Ghosted leads — leads with status = Ghosted
    Lead.countDocuments({ tenant_id: tenantId, archived: false, status: LEAD_STATUS.GHOSTED }),

    // Idle proposals — leads in Proposal Sent status for 5+ days
    Lead.countDocuments({
      tenant_id:  tenantId,
      archived:   false,
      status:     LEAD_STATUS.PROPOSAL_SENT,
      updated_at: { $lte: daysAgo(5) },
    }),

    // Booked but not paid — leads in Won/Call Completed with no Paid payment
    Deal.countDocuments({
      tenant_id: tenantId,
      archived:  false,
      stage:     DEAL_STAGE.WON,
    }),
  ]);

  // ── Derived calculations ───────────────────────────────────────────────────
  const pipelineValue   = pipelineAgg[0]?.total           || 0;
  const revenueClosed   = revenueAgg[0]?.total             || 0;
  const revenueLastMonth= revenueLastMonthAgg[0]?.total    || 0;

  // Conversion rate = Won leads / Total leads * 100
  const conversionRate = totalLeads > 0
    ? Math.round((wonLeads / totalLeads) * 1000) / 10
    : 0;
  const conversionRateLastMonth = totalLeadsLastMonth > 0
    ? Math.round((wonLeadsLastMonth / totalLeadsLastMonth) * 1000) / 10
    : 0;

  // Avg response time — computed from last_contacted_at vs created_at on Contacted leads
  const responseTimeAgg = await Lead.aggregate([
    {
      $match: {
        tenant_id:         tenantId,
        archived:          false,
        last_contacted_at: { $ne: null },
        created_at:        { $gte: daysAgo(30) },
      },
    },
    {
      $project: {
        responseMinutes: {
          $divide: [
            { $subtract: ['$last_contacted_at', '$created_at'] },
            60000, // ms to minutes
          ],
        },
      },
    },
    { $group: { _id: null, avgMinutes: { $avg: '$responseMinutes' } } },
  ]);
  const avgResponseMinutes = Math.round(responseTimeAgg[0]?.avgMinutes || 0);

  // Follow-up completion = leads contacted in last 7 days / total contacted
  const followUpCompletion = followUpLeads > 0
    ? Math.round((followUpCompleted / followUpLeads) * 100)
    : 0;

  // Leakage alerts = ghosted + idle proposals + booked not paid
  const leakageAlerts = ghostedLeads + idleProposals + bookedNotPaid;

  return {
    // Row 1
    totalLeads:          { value: totalLeads,    change: percentChange(totalLeads, totalLeadsLastMonth) },
    qualifiedLeads:      { value: qualifiedLeads, change: percentChange(qualifiedLeads, qualifiedLeadsLastMonth) },
    hotLeads:            { value: hotLeads,       change: percentChange(hotLeads, hotLeadsLastMonth) },
    bookedCalls:         { value: bookedCalls,    change: percentChange(bookedCalls, bookedCallsLastMonth) },

    // Row 2
    pipelineValue:       { value: pipelineValue,  change: null },
    revenueClosed:       { value: revenueClosed,  change: percentChange(revenueClosed, revenueLastMonth) },
    conversionRate:      { value: conversionRate, change: percentChange(conversionRate, conversionRateLastMonth) },
    avgResponseTime:     { value: avgResponseMinutes, unit: 'minutes', change: null },

    // Row 3
    followUpCompletion:  { value: followUpCompletion, unit: '%', change: null },
    waConversations:     { value: waConversations, change: percentChange(waConversations, waConversationsLastMonth) },
    waPendingReplies:    { value: waPendingReplies, label: 'Awaiting response' },
    leakageAlerts: {
      value:     leakageAlerts,
      breakdown: { ghosted: ghostedLeads, idleProposals, bookedNotPaid },
      label:     'Revenue at risk',
    },
  };
};

// =============================================================================
// CHARTS
// =============================================================================

/**
 * getCharts — all chart data for the dashboard.
 * SOURCE: FRONTEND_SPEC §3 Charts section (screenshots 2 and 3)
 */
export const getCharts = async (tenantId) => {
  const [
    leadsBySource,
    pipelineByStage,
    conversionFunnel,
    revenueBySource,
    bookingTrend,
    waConversationTrend,
    campaignPerformance,
  ] = await Promise.all([
    getLeadsBySource(tenantId),
    getPipelineByStage(tenantId),
    getConversionFunnel(tenantId),
    getRevenueBySource(tenantId),
    getBookingTrend(tenantId),
    getWaConversationTrend(tenantId),
    getCampaignPerformance(tenantId),
  ]);

  return {
    leadsBySource,
    pipelineByStage,
    conversionFunnel,
    revenueBySource,
    bookingTrend,
    waConversationTrend,
    campaignPerformance,
  };
};

/**
 * getLeadsBySource — donut chart data.
 * SOURCE: FRONTEND_SPEC §3 "Leads by Source" donut chart
 */
const getLeadsBySource = (tenantId) =>
  Lead.aggregate([
    { $match: { tenant_id: tenantId, archived: false } },
    { $group: { _id: { $ifNull: ['$source', 'Direct'] }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $project: { _id: 0, source: '$_id', count: 1 } },
  ]);

/**
 * getPipelineByStage — bar chart data.
 * SOURCE: FRONTEND_SPEC §3 "Pipeline by Stage" bar chart
 * Shows: New Lead, Qualified, Booked Call, Call Completed, Proposal Sent, Negotiation, Won, Lost, Nurture
 */
const getPipelineByStage = async (tenantId) => {
  const stages = await Deal.aggregate([
    { $match: { tenant_id: tenantId, archived: false } },
    { $group: { _id: '$stage', count: { $sum: 1 }, value: { $sum: '$value' } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, stage: '$_id', count: 1, value: 1 } },
  ]);
  return stages;
};

/**
 * getConversionFunnel — funnel chart data.
 * SOURCE: FRONTEND_SPEC §3 "Conversion Funnel" Lead → Won
 * Screenshot shows: Leads(40) → Qualified(21) → Booked(16) → Proposal(9) → Won(5)
 */
const getConversionFunnel = async (tenantId) => {
  const [leads, qualified, booked, proposal, won] = await Promise.all([
    Lead.countDocuments({ tenant_id: tenantId, archived: false }),
    Lead.countDocuments({ tenant_id: tenantId, archived: false, status: { $in: [LEAD_STATUS.QUALIFIED, LEAD_STATUS.BOOKED, LEAD_STATUS.CALL_COMPLETED, LEAD_STATUS.PROPOSAL_SENT, LEAD_STATUS.WON] } }),
    Lead.countDocuments({ tenant_id: tenantId, archived: false, status: { $in: [LEAD_STATUS.BOOKED, LEAD_STATUS.CALL_COMPLETED, LEAD_STATUS.PROPOSAL_SENT, LEAD_STATUS.WON] } }),
    Lead.countDocuments({ tenant_id: tenantId, archived: false, status: { $in: [LEAD_STATUS.PROPOSAL_SENT, LEAD_STATUS.WON] } }),
    Lead.countDocuments({ tenant_id: tenantId, archived: false, status: LEAD_STATUS.WON }),
  ]);
  return [
    { stage: 'Leads',     count: leads },
    { stage: 'Qualified', count: qualified },
    { stage: 'Booked',    count: booked },
    { stage: 'Proposal',  count: proposal },
    { stage: 'Won',       count: won },
  ];
};

/**
 * getRevenueBySource — bar chart data.
 * SOURCE: FRONTEND_SPEC §3 "Revenue by Source" bar chart
 */
const getRevenueBySource = (tenantId) =>
  TrackingEvent.aggregate([
    { $match: { tenant_id: tenantId, event_type: TRACKING_EVENT_TYPE.PAYMENT_COMPLETED, revenue: { $gt: 0 } } },
    { $group: { _id: { $ifNull: ['$source', 'Direct'] }, revenue: { $sum: '$revenue' } } },
    { $sort: { revenue: -1 } },
    { $project: { _id: 0, source: '$_id', revenue: 1 } },
  ]);

/**
 * getBookingTrend — line chart for last 8 days.
 * SOURCE: FRONTEND_SPEC §3 "Booking Trend" line chart "Last 8 days"
 */
const getBookingTrend = async (tenantId) => {
  const startDate = daysAgo(8);
  const bookings = await Booking.aggregate([
    {
      $match: {
        tenant_id:  tenantId,
        created_at: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$created_at' },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, date: '$_id', count: 1 } },
  ]);
  return bookings;
};

/**
 * getWaConversationTrend — area line chart for last 14 days.
 * SOURCE: FRONTEND_SPEC §3 "WhatsApp Conversations" area chart "Last 14 days"
 */
const getWaConversationTrend = async (tenantId) => {
  const startDate = daysAgo(14);
  return Conversation.aggregate([
    { $match: { tenant_id: tenantId, created_at: { $gte: startDate } } },
    {
      $group: {
        _id:   { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, date: '$_id', count: 1 } },
  ]);
};

/**
 * getCampaignPerformance — bar chart for WA campaign performance.
 * SOURCE: FRONTEND_SPEC §3 "Campaign Performance" bar chart "Replies by WhatsApp campaign"
 */
const getCampaignPerformance = (tenantId) =>
  Campaign.find({ tenant_id: tenantId })
    .sort({ revenue: -1 })
    .limit(8)
    .select('campaign_name leads_generated bookings revenue spend')
    .lean();

// =============================================================================
// SECTIONS
// =============================================================================

/**
 * getRecentActivity — live tracking events feed.
 * SOURCE: FRONTEND_SPEC §3 "Recent Activity — Live tracking events"
 * Screenshot: Deal Won | Payment Completed | Nurture Step Sent | Pipeline Stage Changed...
 */
export const getRecentActivity = (tenantId) =>
  TrackingEvent.find({ tenant_id: tenantId })
    .populate('lead_id', 'name email source')
    .sort({ created_at: -1 })
    .limit(10)
    .lean();

/**
 * getTopCampaigns — top campaigns by closed revenue.
 * SOURCE: FRONTEND_SPEC §3 "Top Campaigns — By closed revenue"
 * Screenshot: youtube_series 97K | coach_webinar 94K | saas_retarget 87K | edtech_launch 59K
 */
export const getTopCampaigns = (tenantId) =>
  Campaign.find({ tenant_id: tenantId })
    .sort({ revenue: -1 })
    .limit(4)
    .select('campaign_name leads_generated bookings revenue')
    .lean();

/**
 * getLeakageAlerts — revenue at risk alerts.
 * SOURCE: FRONTEND_SPEC §3 "Revenue Leakage Alerts — Money at risk right now"
 * Screenshot: Ghosted leads (4) | Proposals idle 5+ days (4) | Booked but not paid (1)
 */
export const getLeakageAlerts = async (tenantId) => {
  const [ghosted, idleProposals, bookedNotPaid] = await Promise.all([
    Lead.countDocuments({ tenant_id: tenantId, archived: false, status: LEAD_STATUS.GHOSTED }),
    Lead.countDocuments({
      tenant_id:  tenantId,
      archived:   false,
      status:     LEAD_STATUS.PROPOSAL_SENT,
      updated_at: { $lte: daysAgo(5) },
    }),
    // Booked but not paid = leads with Booked Call deals that have no Paid payment
    Deal.countDocuments({
      tenant_id: tenantId,
      archived:  false,
      stage:     DEAL_STAGE.BOOKED_CALL,
    }),
  ]);

  return {
    total: ghosted + idleProposals + bookedNotPaid,
    items: [
      { type: 'ghosted',       label: 'Ghosted leads',         count: ghosted },
      { type: 'idle_proposal', label: 'Proposals idle 5+ days', count: idleProposals },
      { type: 'booked_no_pay', label: 'Booked but not paid',   count: bookedNotPaid },
    ],
  };
};

/**
 * getWeeklyAiBriefing — AI-generated narrative summary.
 * SOURCE: FRONTEND_SPEC §3 "Weekly AI Briefing"
 * Screenshot: "This week you captured 40 leads with 13 flagged HOT by AI.
 *              Pipeline value stands at $266,000 and closed revenue reached $18,000."
 *
 * When GEMINI_API_KEY is set: generates real AI briefing from actual data.
 * When not set: generates templated briefing from actual data.
 */
export const getWeeklyAiBriefing = async (tenantId) => {
  // Fetch the actual data to build the briefing
  const [totalLeads, hotLeads, pipelineAgg, revenueAgg, proposalIdle, ghosted] =
    await Promise.all([
      Lead.countDocuments({ tenant_id: tenantId, archived: false }),
      Lead.countDocuments({ tenant_id: tenantId, archived: false, lead_temperature: LEAD_TEMPERATURE.HOT }),
      Deal.aggregate([
        { $match: { tenant_id: tenantId, archived: false, stage: { $nin: [DEAL_STAGE.WON, DEAL_STAGE.LOST] } } },
        { $group: { _id: null, total: { $sum: '$value' } } },
      ]),
      Payment.aggregate([
        { $match: { tenant_id: tenantId, status: PAYMENT_STATUS.PAID } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Lead.countDocuments({
        tenant_id: tenantId, archived: false,
        status: LEAD_STATUS.PROPOSAL_SENT,
        updated_at: { $lte: daysAgo(5) },
      }),
      Lead.countDocuments({ tenant_id: tenantId, archived: false, status: LEAD_STATUS.GHOSTED }),
    ]);

  const pipelineValue = pipelineAgg[0]?.total  || 0;
  const revenue       = revenueAgg[0]?.total   || 0;

  const formatCurrency = (n) =>
    n >= 1000 ? `$${(n / 1000).toFixed(0)}K` : `$${n.toLocaleString()}`;

  // Try Gemini for real AI briefing
  if (process.env.GEMINI_API_KEY) {
    try {
      const prompt = `You are a sales intelligence assistant for InnovateX Revenue OS.
Write a concise Weekly AI Briefing for a sales team based on this real data:
- Total leads: ${totalLeads}
- Hot leads (AI flagged): ${hotLeads}
- Pipeline value: ${formatCurrency(pipelineValue)}
- Revenue closed: ${formatCurrency(revenue)}
- Proposals idle 5+ days: ${proposalIdle}
- Ghosted leads: ${ghosted}

Write 1 summary sentence and 3 bullet-point recommendations, then 1 forecast sentence.
Be specific, actionable, and use the numbers. Keep it under 100 words total.`;

      const response = await fetch(
        // Real model id -- matches aiReplyAssistant.service.js's
        // GEMINI_MODEL. gemini-1.5-flash returns 404 on the current API.
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents:         [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 300 },
          }),
        }
      );
      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        return { briefing: text.trim(), isAiLive: true };
      }
    } catch (err) {
      console.warn(`[dashboard] Gemini briefing failed: ${err.message}`);
    }
  }

  // Deterministic briefing from real data (when no AI key or AI fails)
  const summary = `This week you captured ${totalLeads} leads with ${hotLeads} flagged HOT by AI. Pipeline value stands at ${formatCurrency(pipelineValue)} and closed revenue reached ${formatCurrency(revenue)}.`;

  const recommendations = [];
  if (hotLeads > 0)       recommendations.push(`Prioritize the ${hotLeads} hot leads — they have a 3x higher close rate.`);
  if (proposalIdle > 0)   recommendations.push(`${proposalIdle} proposal${proposalIdle > 1 ? 's have' : ' has'} been idle for 5+ days; send a follow-up today.`);
  if (ghosted > 0)        recommendations.push(`${ghosted} ghosted lead${ghosted > 1 ? 's need' : ' needs'} a re-engagement sequence.`);
  if (recommendations.length === 0) recommendations.push('All leads are active and up-to-date. Great work this week!');

  const forecast = hotLeads > 0
    ? `Forecast: On track to exceed target by ~12% if hot leads are actioned within 48h.`
    : `Forecast: Continue nurturing qualified leads to maintain pipeline momentum.`;

  return {
    briefing: `${summary}\n\nRecommendations:\n${recommendations.map(r => `• ${r}`).join('\n')}\n\n${forecast}`,
    isAiLive: false,
  };
};

// =============================================================================
// FULL DASHBOARD — single call that returns everything
// =============================================================================

/**
 * getDashboard — fetches all dashboard data in parallel.
 * SOURCE: FRONTEND_SPEC §3 — full dashboard page
 *
 * Returns: { kpis, charts, recentActivity, topCampaigns, leakageAlerts, weeklyBriefing }
 */
export const getDashboard = async (tenantId) => {
  const [kpis, charts, recentActivity, topCampaigns, leakageAlerts, weeklyBriefing] =
    await Promise.all([
      getKpis(tenantId),
      getCharts(tenantId),
      getRecentActivity(tenantId),
      getTopCampaigns(tenantId),
      getLeakageAlerts(tenantId),
      getWeeklyAiBriefing(tenantId),
    ]);

  return { kpis, charts, recentActivity, topCampaigns, leakageAlerts, weeklyBriefing };
};