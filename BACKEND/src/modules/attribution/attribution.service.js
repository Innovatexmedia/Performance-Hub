/**
 * Attribution Service — business logic for attribution page + event emission.
 *
 * FILE: src/modules/attribution/attribution.service.js
 *
 * TWO RESPONSIBILITIES:
 *
 * 1. EMIT TRACKING EVENTS — called by all other modules
 *    booking.service.js → emitTrackingEvent() was console.log placeholder
 *    call.service.js    → same
 *    qualification.service.js → same
 *    NOW they all call: createTrackingEvent(data) from this service
 *
 * 2. ATTRIBUTION PAGE DATA — powers all charts, KPIs, tables on /attribution
 *    SOURCE: FRONTEND_SPEC §11 Attribution page
 *
 * Connected modules (all read from TrackingEvent collection):
 *   Lead        → LEAD_CREATED event on createLead()
 *   Booking     → BOOKING_CREATED event on createBooking()
 *   Call        → CALL_COMPLETED event on createCall()
 *   Qualification → AI_QUALIFIED event on applyResult()
 *   Pipeline    → PIPELINE_STAGE_CHANGED, DEAL_WON, DEAL_LOST events
 *   WhatsApp    → WHATSAPP_INBOUND, WHATSAPP_OUTBOUND, WHATSAPP_CLICK events
 *   Payments    → PAYMENT_CREATED, PAYMENT_COMPLETED events (future module)
 */

import * as attrRepo from './attribution.repository.js';
import { AppError, paginationMeta } from '../../shared/helpers/lead.helpers.js';
import { TRACKING_EVENT_TYPE } from './attribution.constants.js';
import AdTrackingSettings from './adTrackingSettings.model.js';
import GoogleAdsCampaignMetric from './googleAdsCampaignMetric.model.js';
import { MetaConversionsProvider } from './providers/metaConversions.provider.js';
import { GoogleAnalyticsProvider } from './providers/googleAnalytics.provider.js';
import { safeDecrypt } from '../../utils/crypto.js';

// ── Import Lead model to enrich events with UTM data ─────────────────────────
import { Lead } from '../leads/lead/lead.model.js';

// =============================================================================
// CREATE TRACKING EVENT — called by all modules
// =============================================================================

/**
 * createTrackingEvent — writes a tracking event to the database.
 *
 * REPLACES the console.log placeholder in:
 *   - booking.service.js  → emitTrackingEvent()
 *   - call.service.js     → emitTrackingEvent()
 *   - qualification.service.js → emitTrackingEvent()
 *
 * Auto-enriches source/utm from the Lead document if not provided.
 * Non-blocking wrapper — never throws into the caller's flow.
 *
 * @param {Object} data
 *   { tenant_id, event_type, lead_id?, source?, medium?, campaign?,
 *     utm_*, provider_name?, lifecycle_stage?, revenue?, metadata?, created_by? }
 */
export const createTrackingEvent = async (data) => {
  try {
    let enriched = { ...data };
    let leadForMeta = null;

    // Auto-enrich source/utm from lead if not provided and lead_id exists
    if (data.lead_id && !data.source) {
      const lead = await Lead.findOne({
        _id:       data.lead_id,
        tenant_id: data.tenant_id,
      }).select('source medium campaign utm_source utm_medium utm_campaign utm_content utm_term email phone');

      if (lead) {
        enriched.source       = lead.source       || null;
        enriched.medium       = lead.medium       || null;
        enriched.campaign     = lead.campaign     || null;
        enriched.utm_source   = lead.utm_source   || null;
        enriched.utm_medium   = lead.utm_medium   || null;
        enriched.utm_campaign = lead.utm_campaign || null;
        enriched.utm_content  = lead.utm_content  || null;
        enriched.utm_term     = lead.utm_term     || null;
        leadForMeta = lead;
      }
    }

    const savedEvent = await attrRepo.create(enriched);

    // Real Meta Conversions API send -- fire-and-forget, same
    // non-blocking principle as the rest of this function. A tenant
    // without ad tracking configured (the default) skips this
    // immediately with zero extra DB calls beyond the one lookup.
    sendToAdPlatformsIfConfigured(savedEvent, leadForMeta).catch(() => {});

    return savedEvent;
  } catch (err) {
    // Non-blocking — tracking failure never crashes the parent operation
    console.warn(`[attribution] tracking event failed: ${err.message}`, {
      event_type: data.event_type,
      lead_id:    data.lead_id,
    });
    return null;
  }
};

/**
 * sendToAdPlatformsIfConfigured -- real Meta Conversions API + real GA4
 * Measurement Protocol delivery, fanned out independently to whichever
 * platform(s) a tenant has genuinely connected (see
 * adTrackingSettings.model.js and the Integrations page bridge). Both
 * run in parallel and are fully independent -- Meta failing never blocks
 * or affects Google, and vice versa. Silently does nothing for the
 * (default) unconfigured case on either -- this is a real, optional
 * integration, not a requirement for tracking events to work at all.
 */
const sendToAdPlatformsIfConfigured = async (event, lead) => {
  const settings = await AdTrackingSettings.findOne({ tenantId: event.tenant_id });
  if (!settings) return;

  await Promise.all([
    sendToMeta(settings, event, lead),
    sendToGoogle(settings, event, lead),
  ]);
};

const sendToMeta = async (settings, event, lead) => {
  if (!settings.meta?.connected || !settings.meta?.pixelId || !settings.meta?.accessToken) return;

  const provider = new MetaConversionsProvider({
    pixelId:       settings.meta.pixelId,
    // Stored encrypted at rest (see adTrackingSettings.service.js) --
    // decrypted here, in memory, only for this one real API call.
    accessToken:   safeDecrypt(settings.meta.accessToken),
    testEventCode: settings.meta.testEventCode || undefined,
  });

  try {
    const result = await provider.sendEvent({
      internalEventType: event.event_type,
      eventId:            String(event._id),
      email:               lead?.email,
      phone:               lead?.phone,
      value:               event.revenue || undefined,
    });

    if (result.sent) {
      await AdTrackingSettings.updateOne(
        { _id: settings._id },
        { $inc: { 'meta.eventsSent': 1 }, $set: { 'meta.lastEventSentAt': new Date() } }
      );
    }
  } catch (err) {
    console.warn(`[attribution] Meta Conversions API send failed: ${err.message}`);
    await AdTrackingSettings.updateOne(
      { _id: settings._id },
      { $inc: { 'meta.eventsFailed': 1 } }
    ).catch(() => {});
  }
};

const sendToGoogle = async (settings, event, lead) => {
  if (!settings.google?.connected || !settings.google?.measurementId || !settings.google?.apiSecret) return;
  if (!lead?._id) return; // GA4 client_id is derived from the lead — nothing to send without one

  const provider = new GoogleAnalyticsProvider({
    measurementId: settings.google.measurementId,
    // Stored encrypted at rest (see adTrackingSettings.service.js) --
    // decrypted here, in memory, only for this one real API call.
    apiSecret:     safeDecrypt(settings.google.apiSecret),
  });

  try {
    const result = await provider.sendEvent({
      internalEventType: event.event_type,
      leadId:              lead._id,
      transactionId:       String(event._id),
      value:               event.revenue || undefined,
    });

    if (result.sent) {
      await AdTrackingSettings.updateOne(
        { _id: settings._id },
        { $inc: { 'google.eventsSent': 1 }, $set: { 'google.lastEventSentAt': new Date() } }
      );
    }
  } catch (err) {
    console.warn(`[attribution] GA4 Measurement Protocol send failed: ${err.message}`);
    await AdTrackingSettings.updateOne(
      { _id: settings._id },
      { $inc: { 'google.eventsFailed': 1 } }
    ).catch(() => {});
  }
};

// =============================================================================
// ATTRIBUTION PAGE — KPI SUMMARY
// =============================================================================

/**
 * getKpiSummary — 4 KPI cards on the attribution page.
 * SOURCE: FRONTEND_SPEC §11 KPI cards:
 *   Total Events | Attributed Revenue | Top Source | Unique Sources
 */
export const getKpiSummary = (tenantId, filter = {}) =>
  attrRepo.getKpiCounts(tenantId, filter);

// =============================================================================
// ATTRIBUTION PAGE — CHARTS
// =============================================================================

/**
 * getLeadsBySource — data for "Leads by Source" pie chart.
 * SOURCE: FRONTEND_SPEC §11
 */
export const getLeadsBySource = (tenantId, filter = {}) =>
  attrRepo.getLeadsBySource(tenantId, filter);

/**
 * getRevenueBySource — data for "Revenue by Source" bar chart.
 * SOURCE: FRONTEND_SPEC §11
 */
export const getRevenueBySource = (tenantId, filter = {}) =>
  attrRepo.getRevenueBySource(tenantId, filter);

/**
 * getBookingsBySource — data for "Bookings by Source" bar chart.
 * SOURCE: FRONTEND_SPEC §11
 */
export const getBookingsBySource = (tenantId, filter = {}) =>
  attrRepo.getBookingsBySource(tenantId, filter);

/**
 * getEventsByType — data for "Tracking Events by Type" chart.
 * SOURCE: FRONTEND_SPEC §11
 */
export const getEventsByType = (tenantId, filter = {}) =>
  attrRepo.getEventsByType(tenantId, filter);

// =============================================================================
// ATTRIBUTION PAGE — SOURCE TO REVENUE BREAKDOWN TABLE
// =============================================================================

/**
 * getSourceToRevenueBreakdown — per-source funnel table.
 * SOURCE: FRONTEND_SPEC §11 "Source-to-Revenue breakdown":
 *   Source | Leads | Qualified | Booked | Calls | Booking Conv% | Revenue
 */
export const getSourceToRevenueBreakdown = (tenantId, filter = {}) =>
  attrRepo.getSourceToRevenueBreakdown(tenantId, filter);

// =============================================================================
// ATTRIBUTION PAGE — RECENT TRACKING EVENTS TABLE
// =============================================================================

/**
 * getRecentEvents — paginated recent events table.
 * SOURCE: FRONTEND_SPEC §11 "Recent Tracking Events" table:
 *   Event | Lead | Source | Campaign | Provider | Time
 */
export const getRecentEvents = async (tenantId, filter = {}, options = {}) => {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  const [events, total] = await Promise.all([
    attrRepo.getRecentEvents(tenantId, filter, { skip, limit }),
    attrRepo.countRecentEvents(tenantId, filter),
  ]);

  return {
    events,
    pagination: paginationMeta({ page, limit, total }),
  };
};

// =============================================================================
// GET ALL ATTRIBUTION DATA — single call for full page load
// =============================================================================

/**
 * getAttributionDashboard — fetches all data for the attribution page in parallel.
 * SOURCE: FRONTEND_SPEC §11 — entire attribution page
 *
 * Returns: { kpis, leadsBySource, revenueBySource, bookingsBySource,
 *             eventsByType, sourceToRevenue, recentEvents }
 */
export const getAttributionDashboard = async (tenantId, filter = {}) => {
  const [
    kpis,
    leadsBySource,
    revenueBySource,
    bookingsBySource,
    eventsByType,
    sourceToRevenue,
    recentEventsResult,
    adSpend,
  ] = await Promise.all([
    attrRepo.getKpiCounts(tenantId, filter),
    attrRepo.getLeadsBySource(tenantId, filter),
    attrRepo.getRevenueBySource(tenantId, filter),
    attrRepo.getBookingsBySource(tenantId, filter),
    attrRepo.getEventsByType(tenantId, filter),
    attrRepo.getSourceToRevenueBreakdown(tenantId, filter),
    attrRepo.getRecentEvents(tenantId, filter, { skip: 0, limit: 20 }),
    getAdSpendSummary(tenantId),
  ]);

  return {
    kpis,
    leadsBySource,
    revenueBySource,
    bookingsBySource,
    eventsByType,
    sourceToRevenue,
    recentEvents: recentEventsResult,
    adSpend,
  };
};

/**
 * getAdSpendSummary -- real Google Ads spend (from GoogleAdsCampaignMetric,
 * already-synced data, not a live call on every dashboard load) combined
 * with this app's own existing real revenue-by-source data to compute a
 * genuine ROAS figure.
 *
 * Matching real ad spend to real internal revenue is inherently
 * best-effort here: it matches by campaign name string equality against
 * this app's own `source`/`campaign` lead fields, since there's no
 * shared campaign ID between Google Ads and this CRM's own lead
 * capture. Where no match is found, spend is still shown (real,
 * unattributed cost), just without a matched revenue figure -- not
 * hidden or guessed.
 */
const getAdSpendSummary = async (tenantId) => {
  const campaigns = await GoogleAdsCampaignMetric.find({ tenantId }).sort({ spend: -1 }).limit(50);
  if (campaigns.length === 0) {
    return { connected: false, totalSpend: 0, totalConversions: 0, campaigns: [] };
  }

  // Real revenue-by-source data this app already computes internally.
  const revenueBySource = await attrRepo.getRevenueBySource(tenantId, {});
  const revenueByName = new Map(revenueBySource.map((r) => [String(r.source || '').toLowerCase(), r.revenue || 0]));

  const enriched = campaigns.map((c) => {
    const matchedRevenue = revenueByName.get(String(c.campaignName).toLowerCase()) ?? null;
    return {
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      status: c.status,
      channelType: c.channelType,
      spend: c.spend,
      clicks: c.clicks,
      impressions: c.impressions,
      conversions: c.conversions,
      conversionsValue: c.conversionsValue,
      matchedRevenue,
      roas: matchedRevenue && c.spend > 0 ? Number((matchedRevenue / c.spend).toFixed(2)) : null,
      syncedAt: c.syncedAt,
    };
  });

  const totalSpend = campaigns.reduce((sum, c) => sum + c.spend, 0);
  const totalConversions = campaigns.reduce((sum, c) => sum + c.conversions, 0);

  return {
    connected: true,
    totalSpend,
    totalConversions,
    lastSyncedAt: campaigns[0]?.syncedAt || null,
    campaigns: enriched,
  };
};

// =============================================================================
// CSV EXPORT DATA
// =============================================================================

/**
 * getExportData — returns all tracking events for CSV export.
 * SOURCE: MASTER_SPEC §B10 "CSV" + FRONTEND_SPEC §11 export button
 */
export const getExportData = (tenantId, filter = {}) =>
  attrRepo.getRecentEvents(tenantId, filter, { skip: 0, limit: 10000 });