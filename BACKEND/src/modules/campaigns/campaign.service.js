/**
 * Campaign Service — business logic for marketing campaigns.
 *
 * FILE: src/modules/campaigns/campaign.service.js
 *
 * SOURCE: MASTER_SPEC.md §B11:
 *   "Create campaign; UTM tracking-link generator (copyable, feeds /capture);
 *    budget/spend/leads/bookings/revenue/ROAS; CSV. Metrics seeded/simulated."
 *
 * SOURCE: DEVELOPER_HANDOFF.md Campaign entity:
 *   "campaign_name, source, medium, campaign_type, budget, spend,
 *    start_date, end_date, status, leads_generated, bookings, revenue"
 *
 * SOURCE: FRONTEND_SPEC §12:
 *   "Create campaign → auto-generates a UTM tracking link → copy link (one click).
 *    Features: budget/spend/leads/bookings/revenue/ROAS, status badges,
 *    tracking-link generator (/capture?source=&utm_source=&utm_medium=&utm_campaign=), CSV export.
 *    Links feed back into the Capture form."
 *
 * CONNECTED MODULES:
 *   - attribution.service.js → emits CAMPAIGN_SENT tracking event
 *   - lead.model.js          → leads with campaign field = campaign_name are counted
 *   - booking.model.js       → bookings with campaign field = campaign_name
 */

import * as campaignRepo from './campaign.repository.js';
import { CAMPAIGN_STATUS, UTM_CAPTURE_PATH } from './campaign.constants.js';
import { AppError, paginationMeta }           from '../../shared/helpers/lead.helpers.js';
import { createTrackingEvent }                from '../attribution/attribution.service.js';
import { TRACKING_EVENT_TYPE }                from '../attribution/attribution.constants.js';

// =============================================================================
// PRIVATE HELPERS
// =============================================================================

const buildCtx = (reqUser) => ({
  tenantId: reqUser.tenantId,
  userId:   reqUser.sub,
  role:     reqUser.role,
});

/**
 * generateUtmLink — builds the real, tenant-scoped UTM tracking capture URL.
 * SOURCE: MASTER_SPEC §B11 "UTM tracking-link generator (/capture?...)"
 * SOURCE: FRONTEND_SPEC §12 "tracking-link generator (/capture?source=&utm_source=&utm_medium=&utm_campaign=)"
 *
 * REAL FIX: previously had NO tenant identifier anywhere in the
 * generated URL -- confirmed by direct audit that the public capture
 * page this links to is a real, multi-tenant page (any tenant's ad can
 * point here), so without a tenantId in the URL there was no way for
 * that page (or the backend behind it) to know WHICH tenant's Lead to
 * create. Now embeds the real tenantId as a path segment, mirroring the
 * exact same already-established pattern this codebase uses for its
 * other real public, tenant-scoped page (/book/:tenantId).
 *
 * Also now generates real utm_content/utm_term params when provided --
 * previously silently dropped even if the caller had them, since this
 * function's own signature never accepted them.
 *
 * FORMAT:
 *   <CLIENT_URL>/capture/<tenantId>?source=<source>&utm_source=<source>&utm_medium=<medium>&utm_campaign=<name>[&utm_content=...&utm_term=...]
 */
const generateUtmLink = (tenantId, campaignName, source, medium, { utmContent, utmTerm } = {}) => {
  const base = process.env.CLIENT_URL || 'http://localhost:3000';
  const params = new URLSearchParams({
    source:       source || '',
    utm_source:   source || '',
    utm_medium:   medium || 'paid',
    utm_campaign: campaignName || '',
  });
  if (utmContent) params.set('utm_content', utmContent);
  if (utmTerm) params.set('utm_term', utmTerm);
  return `${base}${UTM_CAPTURE_PATH}/${tenantId}?${params.toString()}`;
};

// =============================================================================
// AUTOMATIC AD-PLATFORM TRACKING SETUP — set once per platform, applies
// to every real ad/campaign going forward automatically. NOT the
// per-campaign generateUtmLink above, which a tenant would otherwise
// have to regenerate and re-paste for every single ad -- exactly what
// this exists to eliminate.
//
// REAL PLATFORM MECHANICS (confirmed via each platform's own live
// documentation before writing this, not assumed):
//
// GOOGLE ADS: a "Final URL Suffix", set ONCE at the account level
// (Google Ads UI: Settings > Account Settings > Tracking), is appended
// as query params to whatever a given ad's real Final URL already is --
// it does not change the destination. So this ALSO requires the
// tenant's ad(s) to have their real Final URL set to our capture link
// itself (this app's Capture Form IS the intended landing page, per
// this product's own design -- see campaigns/campaign.constants.js's
// own UTM_CAPTURE_PATH comment). Google's ValueTrack parameters
// ({campaignid}, {adgroupid}, {creative}, {gclid}) only ever substitute
// numeric IDs, never a human-readable campaign name -- resolved to the
// REAL campaign name automatically at lead-capture time instead (see
// publicCapture.service.js's resolveRealCampaignName), using this app's
// own already-synced GoogleAdsCampaignMetric data.
//
// META ADS: no true account-wide equivalent to Google's Final URL
// Suffix exists -- Meta's "URL Parameters" field is set per ad (or
// inherited when an ad is duplicated from a template within Ads
// Manager), confirmed via Meta's own developer docs. Still a single
// one-time paste per ad template rather than hand-crafting a unique
// link with a typed-out campaign name for every ad. Meta's own dynamic
// macros ({{campaign.name}}, {{adset.name}}, {{ad.name}}) uniquely give
// REAL, human-readable names directly -- no ID resolution needed on our
// side for Meta, unlike Google.
// =============================================================================

/**
 * getAdPlatformTrackingSetup -- returns the real, tenant-scoped values
 * for both platforms' one-time tracking setup.
 */
export const getAdPlatformTrackingSetup = (tenantId) => {
  const base = process.env.CLIENT_URL || 'http://localhost:3000';
  const captureUrl = `${base}${UTM_CAPTURE_PATH}/${tenantId}`;

  return {
    google: {
      // Set as this ad's (or the account/campaign-level default) real
      // Final URL in Google Ads -- static, no dynamic parameters here.
      finalUrl: captureUrl,
      // Set ONCE under Google Ads > Settings > Account Settings >
      // Tracking > "Final URL suffix" -- applies automatically to every
      // real campaign/ad in the account from then on. No leading `?`.
      finalUrlSuffix: 'utm_source=Google+Ads&utm_medium=cpc&utm_campaign={campaignid}&ad_group_id={adgroupid}&ad_id={creative}&click_id={gclid}',
    },
    meta: {
      // Set as this ad's real Website URL in Meta Ads Manager --
      // static, no dynamic parameters here.
      websiteUrl: captureUrl,
      // Set under the ad's "Tracking" section > "URL Parameters" (or on
      // an ad template you duplicate for future ads) -- Meta fills
      // these in automatically at click time using its own real
      // dynamic macros.
      urlParameters: 'utm_source=Meta+Ads&utm_medium=paid_social&utm_campaign={{campaign.name}}&ad_group_id={{adset.id}}&ad_id={{ad.id}}',
    },
  };
};

// =============================================================================
// GET CAMPAIGNS — paginated list
// =============================================================================

export const getCampaigns = async (tenantId, filter = {}, options = {}) => {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  const [campaigns, total] = await Promise.all([
    campaignRepo.findByTenantId(tenantId, filter, { skip, limit }),
    campaignRepo.countByTenantId(tenantId, filter),
  ]);

  return {
    campaigns,
    pagination: paginationMeta({ page, limit, total }),
  };
};

// =============================================================================
// GET SINGLE
// =============================================================================

export const getCampaignById = async (tenantId, id) => {
  const campaign = await campaignRepo.findById(tenantId, id);
  if (!campaign) throw AppError.notFound('Campaign not found');
  return campaign;
};

// =============================================================================
// GET KPI SUMMARY — 4 KPI cards
// =============================================================================

/**
 * getKpiSummary — 4 KPI cards on the campaigns page.
 * SOURCE: FRONTEND_SPEC §12 — Campaigns | Total Spend | Total Revenue | Blended ROAS
 */
export const getKpiSummary = (tenantId) =>
  campaignRepo.getKpiCounts(tenantId);

// =============================================================================
// GET REVENUE BY CAMPAIGN — bar chart
// =============================================================================

/**
 * getRevenueByCampaign — bar chart data.
 * SOURCE: FRONTEND_SPEC §12 "Revenue by Campaign" bar chart
 */
export const getRevenueByCampaign = (tenantId) =>
  campaignRepo.getRevenueByCampaign(tenantId);

// =============================================================================
// CREATE CAMPAIGN
// =============================================================================

/**
 * createCampaign — creates a marketing campaign with auto-generated UTM link.
 *
 * STEPS:
 *   1. Generate UTM tracking link from campaign_name + source + medium
 *   2. Create campaign document
 *   3. Emit CAMPAIGN_SENT tracking event
 *
 * SOURCE: MASTER_SPEC §B11 "Create campaign; UTM tracking-link generator"
 * SOURCE: FRONTEND_SPEC §12 "New Campaign" modal fields:
 *   Campaign Name | Source | Type | Medium | Budget
 *
 * @param {Object} data    — validated request body
 * @param {Object} reqUser — req.user from authenticate middleware
 */
export const createCampaign = async (data, reqUser) => {
  const ctx = buildCtx(reqUser);

  // Generate UTM tracking link automatically on creation -- real,
  // tenant-scoped so the public capture page (and the backend behind
  // it) know whose lead a submission belongs to.
  const utm_tracking_link = generateUtmLink(
    ctx.tenantId,
    data.campaign_name,
    data.source,
    data.medium
  );

  const campaign = await campaignRepo.create({
    tenant_id:     ctx.tenantId,
    campaign_name: data.campaign_name,
    source:        data.source,
    medium:        data.medium        || 'paid',
    campaign_type: data.campaign_type,
    status:        data.status        || CAMPAIGN_STATUS.DRAFT,
    budget:        data.budget        || 0,
    spend:         data.spend         || 0,
    revenue:       data.revenue       || 0,
    leads_generated: data.leads_generated || 0,
    bookings:      data.bookings      || 0,
    start_date:    data.start_date    || null,
    end_date:      data.end_date      || null,
    utm_tracking_link,
    created_by:    ctx.userId,
  });

  // Emit Campaign Sent tracking event when status is not Draft
  if (campaign.status !== CAMPAIGN_STATUS.DRAFT) {
    await createTrackingEvent({
      tenant_id:  ctx.tenantId,
      event_type: TRACKING_EVENT_TYPE.CAMPAIGN_SENT,
      source:     campaign.source,
      medium:     campaign.medium,
      campaign:   campaign.campaign_name,
      metadata:   { campaign_id: String(campaign._id), campaign_type: campaign.campaign_type },
      created_by: ctx.userId,
    });
  }

  return campaign;
};

// NOTE: updateCampaign / deleteCampaign / regenerateUtmLink were removed --
// not named anywhere in MASTER_SPEC.md, DEVELOPER_HANDOFF.md, or
// FRONTEND_SPEC.md for this module. DEVELOPER_HANDOFF.md's action table
// names exactly one write action here: createMarketingCampaign. The UTM
// link is generated once, at creation, by generateUtmLink() below.

// =============================================================================
// EXPORT DATA — CSV download
// =============================================================================

/**
 * getExportData — all campaigns formatted for CSV export.
 * SOURCE: MASTER_SPEC §B11 "CSV"
 * SOURCE: FRONTEND_SPEC §12 "CSV export" Export button
 */
export const getExportData = async (tenantId) => {
  const campaigns = await campaignRepo.findByTenantId(
    tenantId, {}, { skip: 0, limit: 10000 }
  );

  return campaigns.map((c) => ({
    campaign_name:    c.campaign_name,
    source:           c.source,
    medium:           c.medium,
    campaign_type:    c.campaign_type,
    status:           c.status,
    budget:           c.budget,
    spend:            c.spend,
    revenue:          c.revenue,
    leads_generated:  c.leads_generated,
    bookings:         c.bookings,
    roas:             c.spend > 0 ? (c.revenue / c.spend).toFixed(2) : '0',
    utm_tracking_link: c.utm_tracking_link || '',
    start_date:       c.start_date || '',
    end_date:         c.end_date   || '',
    created_at:       c.created_at,
  }));
};