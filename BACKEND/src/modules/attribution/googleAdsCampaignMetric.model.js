/**
 * =============================================================================
 * InnovateX Revenue OS — Google Ads Campaign Metric Model
 * =============================================================================
 *
 * FILE: src/modules/attribution/googleAdsCampaignMetric.model.js
 *
 * Stores real, synced Google Ads campaign performance data per tenant,
 * per campaign, per sync run. This is what the Attribution dashboard
 * actually queries -- not a live call to Google on every page load,
 * matching the same "sync now, read from our own DB" pattern already
 * established for every other integration in this codebase (e.g.
 * WhatsApp's DeliveryLog).
 *
 * One document per (tenant, campaign, sync date range) -- re-syncing
 * the same range updates the existing document rather than duplicating,
 * so this collection reflects Google's current numbers, not a growing
 * pile of stale snapshots.
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const googleAdsCampaignMetricSchema = new Schema(
  {
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: true,
      index:    true,
    },
    campaignId:   { type: String, required: true },
    campaignName: { type: String, required: true },
    status:       { type: String, default: null },      // real Google Ads status: ENABLED, PAUSED, REMOVED
    channelType:  { type: String, default: null },       // real: SEARCH, DISPLAY, VIDEO, SHOPPING, etc.

    // Real metrics from Google Ads, as synced -- see
    // providers/googleAds.provider.js for the exact GAQL fields these
    // come from and the real cost_micros → currency conversion.
    impressions:      { type: Number, default: 0 },
    clicks:            { type: Number, default: 0 },
    spend:             { type: Number, default: 0 },      // real currency amount, already converted from micros
    conversions:       { type: Number, default: 0 },
    conversionsValue:  { type: Number, default: 0 },
    ctr:               { type: Number, default: 0 },
    averageCpc:        { type: Number, default: 0 },

    dateRange:    { type: String, required: true },       // the real GAQL DURING value used for this sync, e.g. "LAST_30_DAYS"
    syncedAt:     { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// One row per tenant+campaign+dateRange -- re-syncing updates in place.
googleAdsCampaignMetricSchema.index({ tenantId: 1, campaignId: 1, dateRange: 1 }, { unique: true });
googleAdsCampaignMetricSchema.index({ tenantId: 1, syncedAt: -1 });

export default mongoose.model('GoogleAdsCampaignMetric', googleAdsCampaignMetricSchema, 'google_ads_campaign_metrics');