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

    // REAL FIX: previously a single $group summing every matching
    // TrackingEvent.revenue together regardless of currency -- grouping
    // by currency here too so the service layer can convert each
    // sub-total with a real exchange rate before combining, instead of
    // silently adding e.g. USD and INR payments into one meaningless
    // number (see exchangeRate.service.js's convertAndSumByCurrency for
    // where that real conversion now happens).
    TrackingEvent.aggregate([
      { $match: { ...query, revenue: { $gt: 0 } } },
      { $group: { _id: '$currency', revenue: { $sum: '$revenue' } } },
    ]),

    TrackingEvent.aggregate([
      { $match: { ...query, source: { $ne: null } } },
      { $group: { _id: '$source', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
  ]);

  const attributedRevenueByCurrency = revenueAgg.map((r) => ({ currency: r._id, revenue: r.revenue }));
  const topSource     = sourceCounts[0]?._id || 'Direct';
  const uniqueSources = sourceCounts.length;

  return { totalEvents, attributedRevenueByCurrency, topSource, uniqueSources };
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
 *
 * REAL FIX: previously summed `revenue` directly with a single $group,
 * silently adding together payments recorded in DIFFERENT currencies
 * (e.g. a USD payment from before a tenant switched their workspace
 * currency to INR, plus INR payments recorded after) into one
 * meaningless number. Now groups by (source, currency) first, returning
 * a real per-currency breakdown per source -- the service layer
 * (attribution.service.js) converts each currency's sub-total to the
 * tenant's current workspace currency using the real exchange-rate
 * service BEFORE combining into a final total, the same real-conversion
 * treatment already applied to ad spend.
 */
export const getRevenueBySource = (tenantId, filter = {}) => {
  const query = buildQuery(tenantId, filter);
  query.event_type = TRACKING_EVENT_TYPE.PAYMENT_COMPLETED;
  query.revenue    = { $gt: 0 };

  return TrackingEvent.aggregate([
    { $match: query },
    {
      $group: {
        _id: { source: { $ifNull: ['$source', 'Direct'] }, currency: '$currency' },
        revenue: { $sum: '$revenue' },
        count:   { $sum: 1 },
      },
    },
    {
      $group: {
        _id: '$_id.source',
        byCurrency: { $push: { currency: '$_id.currency', revenue: '$revenue', count: '$count' } },
        totalCount: { $sum: '$count' },
      },
    },
    { $sort: { totalCount: -1 } },
    { $project: { _id: 0, source: '$_id', byCurrency: 1, count: '$totalCount' } },
  ]);
};

/**
 * getRevenueByCampaign — total attributed revenue grouped by real
 * campaign name, for matching against real ad-platform spend data
 * (see attribution.service.js's getAdSpendSummary).
 *
 * REAL FIX: same real per-currency breakdown as getRevenueBySource
 * above, for the identical reason -- see that function's own comment.
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
        _id: { campaign: '$campaign', currency: '$currency' },
        revenue: { $sum: '$revenue' },
        count:   { $sum: 1 },
      },
    },
    {
      $group: {
        _id: '$_id.campaign',
        byCurrency: { $push: { currency: '$_id.currency', revenue: '$revenue', count: '$count' } },
        totalCount: { $sum: '$count' },
      },
    },
    { $sort: { totalCount: -1 } },
    { $project: { _id: 0, campaign: '$_id', byCurrency: 1, count: '$totalCount' } },
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
    // Revenue by source -- REAL FIX: grouped by (source, currency) now,
    // not just source -- see exchangeRate.service.js's
    // convertAndSumByCurrency for where the real per-currency
    // conversion happens, in the service layer that calls this.
    TrackingEvent.aggregate([
      { $match: { ...query, event_type: TRACKING_EVENT_TYPE.PAYMENT_COMPLETED, revenue: { $gt: 0 } } },
      { $group: { _id: { source: { $ifNull: ['$source', 'Direct'] }, currency: '$currency' }, revenue: { $sum: '$revenue' } } },
    ]),
  ]);

  // Build unified map keyed by source
  const sourceMap = {};
  const setVal = (arr, field) => {
    arr.forEach(({ _id, count, revenue: rev }) => {
      if (!sourceMap[_id]) {
        sourceMap[_id] = { source: _id, leads: 0, qualified: 0, booked: 0, calls: 0, revenue: 0, revenueByCurrency: [] };
      }
      sourceMap[_id][field] = count || rev || 0;
    });
  };

  setVal(leads,     'leads');
  setVal(qualified, 'qualified');
  setVal(booked,    'booked');
  setVal(calls,     'calls');
  // Revenue is real per-currency data now -- attached as a breakdown
  // array for the service layer to convert, `revenue` itself is left
  // at 0 here (filled in with the real converted total by the service
  // layer, same pattern as getAdSpendSummary already uses).
  revenue.forEach(({ _id, revenue: rev }) => {
    const source = _id.source;
    if (!sourceMap[source]) {
      sourceMap[source] = { source, leads: 0, qualified: 0, booked: 0, calls: 0, revenue: 0, revenueByCurrency: [] };
    }
    sourceMap[source].revenueByCurrency.push({ currency: _id.currency, revenue: rev || 0 });
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