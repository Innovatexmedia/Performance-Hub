/**
 * Attribution Repository — all tracking_events collection queries.
 *
 * FILE: src/modules/attribution/attribution.repository.js
 *
 * Pattern matches booking.repository.js exactly:
 *   - tenantId always first argument
 *   - All queries include { tenant_id: tenantId }
 *   - Returns raw Mongoose documents
 */

import { TrackingEvent } from './tracking-event.model.js';
import { TRACKING_EVENT_TYPE } from './attribution.constants.js';

// =============================================================================
// CREATE EVENT — called from all modules
// =============================================================================

/**
 * create — creates a new tracking event.
 * Called by booking.service.js, call.service.js, qualification.service.js,
 * and any other module that needs to emit a tracking event.
 */
export const create = (data) => TrackingEvent.create(data);

// =============================================================================
// KPI COUNTS — for the 4 KPI cards
// =============================================================================

/**
 * getKpiCounts — aggregate KPIs for attribution page header.
 * SOURCE: FRONTEND_SPEC §11 — KPI cards:
 *   Total Events | Attributed Revenue | Top Source | Unique Sources
 */
export const getKpiCounts = async (tenantId, filter = {}) => {
  const query = buildQuery(tenantId, filter);

  const [
    totalEvents,
    revenueAgg,
    sourceCounts,
  ] = await Promise.all([
    TrackingEvent.countDocuments(query),

    TrackingEvent.aggregate([
      { $match: { ...query, revenue: { $gt: 0 } } },
      { $group: { _id: null, totalRevenue: { $sum: '$revenue' } } },
    ]),

    TrackingEvent.aggregate([
      { $match: { ...query, source: { $ne: null } } },
      { $group: { _id: '$source', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
  ]);

  const attributedRevenue = revenueAgg[0]?.totalRevenue || 0;
  const topSource         = sourceCounts[0]?._id || 'Direct';
  const uniqueSources     = sourceCounts.length;

  return { totalEvents, attributedRevenue, topSource, uniqueSources };
};

// =============================================================================
// LEADS BY SOURCE — pie chart
// =============================================================================

/**
 * getLeadsBySource — count of Lead Created events grouped by source.
 * SOURCE: FRONTEND_SPEC §11 "Leads by Source" pie chart
 */
export const getLeadsBySource = (tenantId, filter = {}) => {
  const query = buildQuery(tenantId, filter);
  query.event_type = TRACKING_EVENT_TYPE.LEAD_CREATED;

  return TrackingEvent.aggregate([
    { $match: query },
    { $group: { _id: { $ifNull: ['$source', 'Direct'] }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $project: { _id: 0, source: '$_id', count: 1 } },
  ]);
};

// =============================================================================
// REVENUE BY SOURCE — bar chart
// =============================================================================

/**
 * getRevenueBySource — total attributed revenue grouped by source.
 * SOURCE: FRONTEND_SPEC §11 "Revenue by Source" chart
 */
export const getRevenueBySource = (tenantId, filter = {}) => {
  const query = buildQuery(tenantId, filter);
  query.event_type = TRACKING_EVENT_TYPE.PAYMENT_COMPLETED;
  query.revenue    = { $gt: 0 };

  return TrackingEvent.aggregate([
    { $match: query },
    {
      $group: {
        _id:     { $ifNull: ['$source', 'Direct'] },
        revenue: { $sum: '$revenue' },
        count:   { $sum: 1 },
      },
    },
    { $sort: { revenue: -1 } },
    { $project: { _id: 0, source: '$_id', revenue: 1, count: 1 } },
  ]);
};

/**
 * getRevenueByCampaign — total attributed revenue grouped by real
 * campaign name, for matching against real ad-platform spend data
 * (see attribution.service.js's getAdSpendSummary).
 *
 * REAL FIX: getAdSpendSummary previously matched a real Google/Meta
 * Ads campaign name against getRevenueBySource's generic `source`
 * grouping (e.g. "Google Ads", "Direct") -- a real ad campaign is
 * essentially never literally NAMED "Google Ads" in Ads Manager (that
 * would defeat the point of having descriptive campaign names to
 * manage multiple campaigns), so that match would almost never
 * actually fire in production despite being syntactically correct
 * code. `campaign` is the field genuinely meant to hold a specific
 * campaign identifier -- confirmed by tracing the real, already-wired
 * chain: Lead.campaign -> Payment.campaign (copied verbatim at payment
 * creation, see payment.service.js) -> TrackingEvent.campaign (on
 * PAYMENT_COMPLETED). Grouping by THIS field, not `source`, is what
 * actually gives campaign-name matching a real chance of succeeding --
 * still string-equality (there is no shared ID between this CRM and
 * either ad platform), but now comparing like with like: a real
 * campaign name against a real campaign name, not a real campaign name
 * against a generic platform label.
 *
 * Rows with no real campaign attribution ($ifNull default) are
 * deliberately excluded (not defaulted to a placeholder) -- there is
 * nothing meaningful to match an empty campaign against.
 */
export const getRevenueByCampaign = (tenantId, filter = {}) => {
  const query = buildQuery(tenantId, filter);
  query.event_type = TRACKING_EVENT_TYPE.PAYMENT_COMPLETED;
  query.revenue    = { $gt: 0 };
  query.campaign   = { $nin: [null, ''] };

  return TrackingEvent.aggregate([
    { $match: query },
    {
      $group: {
        _id:     '$campaign',
        revenue: { $sum: '$revenue' },
        count:   { $sum: 1 },
      },
    },
    { $sort: { revenue: -1 } },
    { $project: { _id: 0, campaign: '$_id', revenue: 1, count: 1 } },
  ]);
};

// =============================================================================
// BOOKINGS BY SOURCE — bar chart
// =============================================================================

/**
 * getBookingsBySource — count of Booking Created events grouped by source.
 * SOURCE: FRONTEND_SPEC §11 "Bookings by Source" chart
 */
export const getBookingsBySource = (tenantId, filter = {}) => {
  const query = buildQuery(tenantId, filter);
  query.event_type = TRACKING_EVENT_TYPE.BOOKING_CREATED;

  return TrackingEvent.aggregate([
    { $match: query },
    { $group: { _id: { $ifNull: ['$source', 'Direct'] }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $project: { _id: 0, source: '$_id', count: 1 } },
  ]);
};

// =============================================================================
// EVENTS BY TYPE — bar/donut chart
// =============================================================================

/**
 * getEventsByType — count of each event type.
 * SOURCE: FRONTEND_SPEC §11 "Tracking Events by Type" chart
 */
export const getEventsByType = (tenantId, filter = {}) => {
  const query = buildQuery(tenantId, filter);

  return TrackingEvent.aggregate([
    { $match: query },
    { $group: { _id: '$event_type', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $project: { _id: 0, event_type: '$_id', count: 1 } },
  ]);
};

// =============================================================================
// SOURCE TO REVENUE BREAKDOWN TABLE
// =============================================================================

/**
 * getSourceToRevenueBreakdown — per-source funnel table.
 * SOURCE: FRONTEND_SPEC §11 "Source-to-Revenue breakdown":
 *   Source | Leads | Qualified | Booked | Calls | Revenue
 */
export const getSourceToRevenueBreakdown = async (tenantId, filter = {}) => {
  const query = buildQuery(tenantId, filter);

  const [leads, qualified, booked, calls, revenue] = await Promise.all([
    // Leads by source
    TrackingEvent.aggregate([
      { $match: { ...query, event_type: TRACKING_EVENT_TYPE.LEAD_CREATED } },
      { $group: { _id: { $ifNull: ['$source', 'Direct'] }, count: { $sum: 1 } } },
    ]),
    // Qualified by source
    TrackingEvent.aggregate([
      { $match: { ...query, event_type: TRACKING_EVENT_TYPE.AI_QUALIFIED } },
      { $group: { _id: { $ifNull: ['$source', 'Direct'] }, count: { $sum: 1 } } },
    ]),
    // Bookings by source
    TrackingEvent.aggregate([
      { $match: { ...query, event_type: TRACKING_EVENT_TYPE.BOOKING_CREATED } },
      { $group: { _id: { $ifNull: ['$source', 'Direct'] }, count: { $sum: 1 } } },
    ]),
    // Calls by source
    TrackingEvent.aggregate([
      { $match: { ...query, event_type: TRACKING_EVENT_TYPE.CALL_COMPLETED } },
      { $group: { _id: { $ifNull: ['$source', 'Direct'] }, count: { $sum: 1 } } },
    ]),
    // Revenue by source
    TrackingEvent.aggregate([
      { $match: { ...query, event_type: TRACKING_EVENT_TYPE.PAYMENT_COMPLETED, revenue: { $gt: 0 } } },
      { $group: { _id: { $ifNull: ['$source', 'Direct'] }, revenue: { $sum: '$revenue' } } },
    ]),
  ]);

  // Build unified map keyed by source
  const sourceMap = {};
  const setVal = (arr, field) => {
    arr.forEach(({ _id, count, revenue: rev }) => {
      if (!sourceMap[_id]) {
        sourceMap[_id] = { source: _id, leads: 0, qualified: 0, booked: 0, calls: 0, revenue: 0 };
      }
      sourceMap[_id][field] = count || rev || 0;
    });
  };

  setVal(leads,     'leads');
  setVal(qualified, 'qualified');
  setVal(booked,    'booked');
  setVal(calls,     'calls');
  revenue.forEach(({ _id, revenue: rev }) => {
    if (!sourceMap[_id]) {
      sourceMap[_id] = { source: _id, leads: 0, qualified: 0, booked: 0, calls: 0, revenue: 0 };
    }
    sourceMap[_id].revenue = rev || 0;
  });

  // Add booking_conversion percentage
  return Object.values(sourceMap)
    .map((row) => ({
      ...row,
      booking_conversion: row.leads > 0
        ? Math.round((row.booked / row.leads) * 100)
        : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.leads - a.leads);
};

// =============================================================================
// RECENT TRACKING EVENTS — table
// =============================================================================

/**
 * getRecentEvents — paginated recent tracking events.
 * SOURCE: FRONTEND_SPEC §11 "Recent Tracking Events" table:
 *   Event | Lead | Source | Campaign | Provider | Time
 */
export const getRecentEvents = (
  tenantId,
  filter = {},
  { skip = 0, limit = 20 } = {}
) => {
  const query = buildQuery(tenantId, filter);

  return TrackingEvent.find(query)
    .populate('lead_id', 'name email source')
    .sort({ created_at: -1 })
    .skip(skip)
    .limit(limit);
};

export const countRecentEvents = (tenantId, filter = {}) =>
  TrackingEvent.countDocuments(buildQuery(tenantId, filter));

// =============================================================================
// FIND SINGLE EVENT
// =============================================================================

export const findById = (tenantId, id) =>
  TrackingEvent.findOne({ _id: id, tenant_id: tenantId })
    .populate('lead_id', 'name email source');

// =============================================================================
// PRIVATE: BUILD QUERY WITH DATE FILTER
// =============================================================================

/**
 * buildQuery — builds base query with tenant scope and optional date range.
 * date_from / date_to filter on the created_at field.
 */
const buildQuery = (tenantId, filter = {}) => {
  const query = { tenant_id: tenantId };

  if (filter.event_type) query.event_type = filter.event_type;
  if (filter.source)     query.source     = filter.source;
  if (filter.campaign)   query.campaign   = filter.campaign;

  if (filter.date_from || filter.date_to) {
    query.created_at = {};
    if (filter.date_from) query.created_at.$gte = new Date(filter.date_from);
    if (filter.date_to) {
      const end = new Date(filter.date_to);
      end.setHours(23, 59, 59, 999);
      query.created_at.$lte = end;
    }
  }

  return query;
};