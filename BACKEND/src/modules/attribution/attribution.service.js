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
import { TRACKING_EVENT_TYPE, DEFAULT_AD_SYNC_DATE_RANGE } from './attribution.constants.js';
import AdTrackingSettings from './adTrackingSettings.model.js';
import GoogleAdsCampaignMetric from './googleAdsCampaignMetric.model.js';
import MetaAdsCampaignMetric from './metaAdsCampaignMetric.model.js';
import { MetaConversionsProvider } from './providers/metaConversions.provider.js';
import { GoogleAnalyticsProvider } from './providers/googleAnalytics.provider.js';
import { safeDecrypt } from '../../utils/crypto.js';
import { getExchangeRates, convertAndSumByCurrency } from '../../shared/services/exchangeRate.service.js';

// ── Import Lead model to enrich events with UTM data ─────────────────────────
import { Lead } from '../leads/lead/lead.model.js';
import Tenant from '../auth/models/Tenant.js';

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

  // CONFIRMED BUG this fixes: sendToMeta below never passed a currency
  // to the Conversions API, so MetaConversionsProvider's own
  // `currency || 'INR'` fallback silently mislabeled every real INR
  // revenue value as USD -- a real ₹5,000 conversion was reaching Meta
  // as "$5,000", corrupting both Meta's own ad-bidding optimization
  // (which uses conversion value) and any ROAS figure Meta shows the
  // tenant, by the real INR/USD exchange-rate factor. Same real,
  // tenant-level currency field settings.service.js already uses for
  // billing -- not a new concept introduced here.
  const tenant = await Tenant.findById(event.tenant_id).select('currency').lean();
  const currency = tenant?.currency || 'INR';

  await Promise.all([
    sendToMeta(settings, event, lead, currency),
    sendToGoogle(settings, event, lead, currency),
  ]);
};

const sendToMeta = async (settings, event, lead, currency) => {
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
      currency,
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

const sendToGoogle = async (settings, event, lead, currency) => {
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
      currency,
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
 *
 * REAL FIX: previously returned attrRepo's raw, currency-blind sum
 * directly. Now converts each source's real per-currency breakdown
 * into the tenant's actual workspace currency (see
 * exchangeRate.service.js's convertAndSumByCurrency) before returning,
 * and re-sorts by the real converted revenue (the repository can no
 * longer sort meaningfully by revenue itself, since conversion hasn't
 * happened yet at that layer).
 */
export const getRevenueBySource = async (tenantId, filter = {}) => {
  const [tenant, rows] = await Promise.all([
    Tenant.findById(tenantId).select('currency'),
    attrRepo.getRevenueBySource(tenantId, filter),
  ]);
  const workspaceCurrency = tenant?.currency || 'INR';

  const converted = await Promise.all(rows.map(async (r) => {
    const { total, hasUnconverted } = await convertAndSumByCurrency(r.byCurrency, workspaceCurrency);
    return { source: r.source, revenue: total, count: r.count, currency: workspaceCurrency, hasUnconverted };
  }));

  return converted.sort((a, b) => b.revenue - a.revenue);
};

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
    tenant,
    kpisRaw,
    leadsBySource,
    revenueBySource,
    bookingsBySource,
    eventsByType,
    sourceToRevenueRaw,
    recentEventsResult,
    adSpend,
  ] = await Promise.all([
    Tenant.findById(tenantId).select('currency'),
    attrRepo.getKpiCounts(tenantId, filter),
    attrRepo.getLeadsBySource(tenantId, filter),
    getRevenueBySource(tenantId, filter), // real per-currency conversion already applied -- see that function's own comment
    attrRepo.getBookingsBySource(tenantId, filter),
    attrRepo.getEventsByType(tenantId, filter),
    attrRepo.getSourceToRevenueBreakdown(tenantId, filter),
    attrRepo.getRecentEvents(tenantId, filter, { skip: 0, limit: 20 }),
    getAdSpendSummary(tenantId),
  ]);
  const workspaceCurrency = tenant?.currency || 'INR';

  // REAL FIX: the top "Attributed Revenue" KPI previously summed
  // TrackingEvent.revenue directly with no currency awareness -- the
  // exact figure most likely to be the "$15k that just became ₹15k"
  // symptom, since it's the single most prominent revenue number on
  // this page. Converted here using the same real, shared helper as
  // every other revenue aggregation on this page.
  const { total: attributedRevenue } = await convertAndSumByCurrency(kpisRaw.attributedRevenueByCurrency, workspaceCurrency);
  const kpis = {
    totalEvents: kpisRaw.totalEvents,
    attributedRevenue,
    topSource: kpisRaw.topSource,
    uniqueSources: kpisRaw.uniqueSources,
  };

  // REAL FIX: same real conversion applied to the Source-to-Revenue
  // breakdown table's `revenue` column -- previously always 0 direct
  // from the repository (see attribution.repository.js's own comment on
  // why conversion had to move to this layer), now the real converted
  // total, and re-sorted by it since the repository can no longer sort
  // meaningfully before conversion happens.
  const sourceToRevenue = (await Promise.all(sourceToRevenueRaw.map(async (row) => {
    const { total } = await convertAndSumByCurrency(row.revenueByCurrency, workspaceCurrency);
    const { revenueByCurrency, ...rest } = row;
    return { ...rest, revenue: total };
  }))).sort((a, b) => b.revenue - a.revenue || b.leads - a.leads);

  return {
    currency: workspaceCurrency,
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
 * with this app's own existing real revenue-by-CAMPAIGN data to compute a
 * genuine ROAS figure.
 *
 * REAL FIX: previously matched against getRevenueBySource's generic
 * `source` grouping (e.g. "Google Ads", "Direct") -- see
 * getRevenueByCampaign's own header comment in attribution.repository.js
 * for the full reasoning on why that essentially never matched in
 * practice. Now matches real ad-platform campaign names against real
 * internal revenue grouped by the SAME kind of field (Lead.campaign,
 * carried through to Payment and TrackingEvent) -- still string-equality
 * best-effort (there is no shared ID between this CRM and either ad
 * platform), but comparing like with like instead of a category
 * mismatch. Where no match is found, spend is still shown (real,
 * unattributed cost), just without a matched revenue figure -- not
 * hidden or guessed.
 */
const getAdSpendSummary = async (tenantId) => {
  // REAL DEFENSIVE FIX: neither GoogleAdsCampaignMetric nor
  // MetaAdsCampaignMetric queries here were previously filtered by
  // dateRange at all -- fine ONLY because the one real, reachable sync
  // path (integration.service.js's sync branches) always calls
  // syncCampaigns() with no explicit dateRange, so every real document
  // in production today has dateRange='LAST_30_DAYS' and this never
  // actually manifests. But nothing enforced that: if a dateRange
  // selector is ever added to the Sync UI later, a tenant syncing with
  // two different ranges would leave BOTH sets of rows in these
  // collections permanently (there's no cleanup of stale-dateRange
  // rows), and this unfiltered query would silently sum the SAME real
  // campaign's spend twice, once per dateRange value. Explicitly
  // filtering to one real, canonical dateRange closes this off
  // structurally rather than relying on "nothing calls it differently
  // today" as the only thing preventing double-counting.
  const [googleCampaigns, metaCampaigns] = await Promise.all([
    GoogleAdsCampaignMetric.find({ tenantId, dateRange: DEFAULT_AD_SYNC_DATE_RANGE }).sort({ spend: -1 }).limit(50),
    MetaAdsCampaignMetric.find({ tenantId, dateRange: DEFAULT_AD_SYNC_DATE_RANGE }).sort({ spend: -1 }).limit(50),
  ]);

  // REAL de-duplication guard: if the SAME real campaign was synced more
  // than once for the SAME dateRange (e.g. a retried sync before the
  // unique index caught up, or a genuinely re-run sync landing here
  // between two reads), keep only the most-recently-synced row per
  // (platform, campaignId, dateRange) so spend/impressions/clicks are
  // never double-counted in the totals below. The DB-level unique index
  // on (tenantId, campaignId, dateRange) already prevents true
  // duplicates at rest -- this is a defensive second layer for the read
  // path itself, since `campaigns` here is a plain in-memory merge of
  // two separate queries, not a single indexed lookup.
  const dedupe = (docs) => {
    const seen = new Map();
    for (const doc of docs) {
      const key = `${doc.campaignId}::${doc.dateRange}`;
      const existing = seen.get(key);
      if (!existing || doc.syncedAt > existing.syncedAt) seen.set(key, doc);
    }
    return [...seen.values()];
  };
  const campaigns = [...dedupe(googleCampaigns), ...dedupe(metaCampaigns)].sort((a, b) => b.spend - a.spend);

  if (campaigns.length === 0) {
    return { connected: false, totalSpend: 0, totalConversions: 0, campaigns: [] };
  }

  // Real workspace currency -- this is the ONE display/reporting
  // currency every figure below is converted INTO, matching Settings'
  // own currency selector (Tenant.currency). See
  // googleAdsCampaignMetric.model.js's / metaAdsCampaignMetric.model.js's
  // own comments on why ad-account currency is never assumed to already
  // match this.
  const tenant = await Tenant.findById(tenantId).select('currency');
  const workspaceCurrency = tenant?.currency || 'INR';

  // Real revenue-by-CAMPAIGN data this app already computes internally
  // (see getRevenueByCampaign's header comment for why this, not
  // getRevenueBySource, is the reliable match key). Each campaign's
  // real per-currency breakdown is converted to workspaceCurrency here
  // -- see exchangeRate.service.js's convertAndSumByCurrency -- so
  // matching a real ad campaign's spend against revenue that was
  // genuinely recorded in a DIFFERENT currency (e.g. before a tenant
  // switched their workspace currency setting) still produces a real,
  // correct number instead of silently comparing unlike amounts.
  const revenueByCampaign = await attrRepo.getRevenueByCampaign(tenantId, {});
  const revenueByNameEntries = await Promise.all(
    revenueByCampaign.map(async (r) => {
      const { total } = await convertAndSumByCurrency(r.byCurrency, workspaceCurrency);
      return [String(r.campaign || '').toLowerCase(), total];
    }),
  );
  const revenueByName = new Map(revenueByNameEntries);

  // REAL FIX: real conversion, not withholding. A campaign's spend is
  // denominated in whatever currency its Google/Meta ad ACCOUNT bills
  // in (c.currency) -- genuinely NOT guaranteed to match
  // workspaceCurrency (the currency matchedRevenue is already correctly
  // denominated in via Payments). Batched so N campaigns sharing the
  // SAME ad-account currency trigger only ONE real Frankfurter lookup
  // for that pair, not N -- see exchangeRate.service.js.
  const distinctAdCurrencies = campaigns.map((c) => c.currency).filter(Boolean);
  const rateByAdCurrency = await getExchangeRates(distinctAdCurrencies, workspaceCurrency);

  const enriched = campaigns.map((c) => {
    const matchedRevenue = revenueByName.get(String(c.campaignName).toLowerCase()) ?? null;

    const currencyKnown = Boolean(c.currency);
    const sameCurrency = currencyKnown && c.currency === workspaceCurrency;
    const rate = currencyKnown ? (sameCurrency ? 1 : rateByAdCurrency.get(c.currency.toUpperCase())) : null;
    // REAL BUG FIX: previously `currencyKnown && rate == null` -- when
    // currencyKnown was FALSE (a campaign synced before currency
    // capture was added, or a real API response that genuinely omitted
    // it), this evaluated to `false && ...` = false, meaning
    // conversionUnavailable was incorrectly FALSE for exactly the case
    // where we know NOTHING about the currency -- ROAS would have been
    // silently computed as if the unconverted spend were already in
    // workspace currency, the exact same class of wrong-ROAS bug this
    // whole currency system exists to prevent. Now correctly true
    // whenever the currency is unknown at all, OR known-and-different
    // with no resolvable rate -- the only two real "cannot safely
    // compute ROAS" states.
    const conversionUnavailable = !currencyKnown || (!sameCurrency && rate == null);

    // Real converted figures -- spend/conversionsValue are the only
    // money-shaped fields here (impressions/clicks/conversions are
    // plain counts, currency-independent). Rounded to 2dp, matching
    // every other real currency figure already displayed in this app.
    const spend = conversionUnavailable ? c.spend : Number((c.spend * (rate ?? 1)).toFixed(2));
    const conversionsValue = conversionUnavailable ? c.conversionsValue : Number((c.conversionsValue * (rate ?? 1)).toFixed(2));

    const roas = matchedRevenue && spend > 0 && !conversionUnavailable
      ? Number((matchedRevenue / spend).toFixed(2))
      : null;

    return {
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      // channelType is the real distinguisher between the two sources
      // here -- Google's are real values like SEARCH/DISPLAY/VIDEO,
      // Meta's is the fixed 'META' value set at sync time (see
      // metaAdsCampaignMetric.model.js), so the frontend can tell them
      // apart or group by platform without a separate field.
      status: c.status,
      channelType: c.channelType,
      // Real, single display currency for every figure below --
      // matches Settings' currency selector, NOT necessarily the ad
      // account's own billing currency (see spendOriginal below for that).
      currency: workspaceCurrency,
      // Real original figures preserved for transparency/audit -- what
      // the ad platform actually reported, before conversion, plus the
      // real currency and rate used to convert it.
      spendOriginal: c.spend,
      currencyOriginal: c.currency || null,
      exchangeRate: sameCurrency ? 1 : rate,
      // True only when a real conversion was needed but genuinely
      // couldn't be resolved right now (Frankfurter unreachable/no
      // cached fallback) -- spend/roas below reflect the UNCONVERTED
      // original in this case, and the frontend should flag it rather
      // than presenting it as a same-currency figure.
      currencyMismatch: conversionUnavailable,
      spend,
      clicks: c.clicks,
      impressions: c.impressions,
      conversions: c.conversions,
      conversionsValue,
      matchedRevenue,
      roas,
      syncedAt: c.syncedAt,
    };
  });

  // REAL BUG FIX: previously summed EVERY row's `spend` regardless of
  // `currencyMismatch` -- a row where conversion genuinely failed keeps
  // its RAW, UNCONVERTED figure (see the map above, `spend: c.spend`
  // in that branch) so the individual row still shows something real
  // rather than blank. But summing that raw, wrong-currency figure
  // together with properly-converted rows produces a meaningless
  // mixed-currency total -- e.g. $500 (unconverted, mismatch) + ₹40,000
  // (converted) = a number in no real currency at all. Excluded from
  // the totals here; `excludedFromTotal` tells the frontend exactly how
  // many rows (and how much real spend) aren't reflected in totalSpend,
  // so the total is never silently short without explanation.
  const convertible = enriched.filter((c) => !c.currencyMismatch);
  const excluded = enriched.filter((c) => c.currencyMismatch);
  const totalSpend = convertible.reduce((sum, c) => sum + c.spend, 0);
  const totalConversions = enriched.reduce((sum, c) => sum + c.conversions, 0); // conversions is a plain count, currency-independent -- safe to sum across every row regardless of currencyMismatch
  const lastSyncedAt = campaigns.reduce((latest, c) => (!latest || (c.syncedAt && c.syncedAt > latest) ? c.syncedAt : latest), null);

  return {
    connected: true,
    currency: workspaceCurrency,
    totalSpend,
    totalConversions,
    // Real, explicit accounting for what's NOT reflected in totalSpend
    // above (see comment) -- 0/empty when every campaign converted
    // successfully, which is the common case.
    excludedFromTotal: {
      count: excluded.length,
      campaignNames: excluded.map((c) => c.campaignName),
    },
    lastSyncedAt,
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