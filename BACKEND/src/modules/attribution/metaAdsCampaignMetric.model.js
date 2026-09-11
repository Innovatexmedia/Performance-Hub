/**
 * =============================================================================
 * InnovateX Revenue OS — Meta Ads Campaign Metric Model
 * =============================================================================
 *
 * FILE: src/modules/attribution/metaAdsCampaignMetric.model.js
 *
 * Stores real, synced Meta Ads campaign performance data per tenant,
 * per campaign, per sync run -- exact same "sync now, read from our own
 * DB" pattern as GoogleAdsCampaignMetric, so the Attribution dashboard
 * reads both the same way rather than needing provider-specific logic
 * on the read side.
 *
 * One document per (tenant, campaign, sync date range) -- re-syncing
 * the same range updates the existing document rather than duplicating.
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const metaAdsCampaignMetricSchema = new Schema(
  {
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: true,
      index:    true,
    },
    campaignId:   { type: String, required: true },
    campaignName: { type: String, required: true },
    status:       { type: String, default: null },      // real Meta status: ACTIVE, PAUSED, ARCHIVED, DELETED
    channelType:  { type: String, default: 'META' },     // Meta doesn't expose a per-campaign channel-type field the way Google does (SEARCH/DISPLAY/etc.) -- fixed value, kept for schema/query symmetry with GoogleAdsCampaignMetric so the dashboard can merge both without a special case

    // Real metrics from Meta's Insights API, as synced -- see
    // providers/metaAds.provider.js for the exact fields these come
    // from. conversions/conversionsValue are summed from Meta's real
    // `actions`/`action_values` arrays (Meta has no single flat
    // "conversions" field the way Google does), not a single field.
    impressions:      { type: Number, default: 0 },
    clicks:            { type: Number, default: 0 },
    spend:             { type: Number, default: 0 },      // real currency amount, Meta returns this already in account currency (no micros conversion needed, unlike Google)
    conversions:       { type: Number, default: 0 },
    conversionsValue:  { type: Number, default: 0 },
    ctr:               { type: Number, default: 0 },
    averageCpc:        { type: Number, default: 0 },       // mapped from Meta's real `cpc` field

    dateRange:    { type: String, required: true },       // this app's own normalized value (see metaAds.provider.js's DATE_RANGE_MAP) -- stored as the SAME string Google's dateRange uses (e.g. "LAST_30_DAYS") so both collections merge cleanly on this field
    syncedAt:     { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// One row per tenant+campaign+dateRange -- re-syncing updates in place.
metaAdsCampaignMetricSchema.index({ tenantId: 1, campaignId: 1, dateRange: 1 }, { unique: true });
metaAdsCampaignMetricSchema.index({ tenantId: 1, syncedAt: -1 });

export default mongoose.model('MetaAdsCampaignMetric', metaAdsCampaignMetricSchema, 'meta_ads_campaign_metrics');