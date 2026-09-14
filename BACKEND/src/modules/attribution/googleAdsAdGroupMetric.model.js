/**
 * =============================================================================
 * InnovateX Revenue OS — Google Ads Ad Group Metric Model
 * =============================================================================
 * FILE: src/modules/attribution/googleAdsAdGroupMetric.model.js
 *
 * Real ad-group-level Google Ads performance -- one level of granularity
 * below GoogleAdsCampaignMetric, added per explicit product requirement
 * for ad-group identifiers/metrics (not just campaign-level). Same real
 * "sync now, read from our own DB" pattern, same per-tenant/per-entity/
 * per-date-range upsert shape as the campaign-level model.
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const googleAdsAdGroupMetricSchema = new Schema(
  {
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: true,
      index:    true,
    },
    campaignId:   { type: String, required: true },   // real parent campaign linkage
    campaignName: { type: String, required: true },
    adGroupId:    { type: String, required: true },
    adGroupName:  { type: String, required: true },
    status:       { type: String, default: null },    // real: ENABLED, PAUSED, REMOVED

    impressions:      { type: Number, default: 0 },
    clicks:            { type: Number, default: 0 },
    spend:             { type: Number, default: 0 },
    conversions:       { type: Number, default: 0 },
    conversionsValue:  { type: Number, default: 0 },
    ctr:               { type: Number, default: 0 },
    averageCpc:        { type: Number, default: 0 },
    currency:          { type: String, default: null },

    dateRange:    { type: String, required: true },
    syncedAt:     { type: Date, default: Date.now },
  },
  { timestamps: true }
);

googleAdsAdGroupMetricSchema.index({ tenantId: 1, adGroupId: 1, dateRange: 1 }, { unique: true });
googleAdsAdGroupMetricSchema.index({ tenantId: 1, campaignId: 1 });

export default mongoose.model('GoogleAdsAdGroupMetric', googleAdsAdGroupMetricSchema, 'google_ads_adgroup_metrics');
