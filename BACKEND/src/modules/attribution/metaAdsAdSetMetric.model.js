/**
 * =============================================================================
 * InnovateX Revenue OS — Meta Ads Ad Set Metric Model
 * =============================================================================
 * FILE: src/modules/attribution/metaAdsAdSetMetric.model.js
 *
 * Real ad-set-level Meta Ads performance -- one level of granularity
 * below MetaAdsCampaignMetric, added per explicit product requirement
 * for ad-set identifiers/metrics (not just campaign-level). Same real
 * "sync now, read from our own DB" pattern as the campaign-level model.
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const metaAdsAdSetMetricSchema = new Schema(
  {
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: true,
      index:    true,
    },
    campaignId:   { type: String, required: true },   // real parent campaign linkage
    campaignName: { type: String, required: true },
    adSetId:      { type: String, required: true },
    adSetName:    { type: String, required: true },
    status:       { type: String, default: null },

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

metaAdsAdSetMetricSchema.index({ tenantId: 1, adSetId: 1, dateRange: 1 }, { unique: true });
metaAdsAdSetMetricSchema.index({ tenantId: 1, campaignId: 1 });

export default mongoose.model('MetaAdsAdSetMetric', metaAdsAdSetMetricSchema, 'meta_ads_adset_metrics');
