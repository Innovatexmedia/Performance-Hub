import mongoose from 'mongoose';
import {
  CAMPAIGN_STATUS,
  CAMPAIGN_STATUS_VALUES,
  CAMPAIGN_TYPE_VALUES,
} from './campaigns.constants.js';

const { Schema } = mongoose;

// ── Sub-schemas ────────────────────────────────────────────────────────────────

const audienceSchema = new Schema(
  {
    filters: { type: Schema.Types.Mixed, default: {} },
    includedContacts: { type: [String], default: [] },
    excludedContacts: { type: [String], default: [] },
  },
  { _id: false },
);

const metricsSchema = new Schema(
  {
    recipientCount:   { type: Number, default: 0, min: 0 },
    sentCount:        { type: Number, default: 0, min: 0 },
    deliveredCount:   { type: Number, default: 0, min: 0 },
    readCount:        { type: Number, default: 0, min: 0 },
    repliedCount:     { type: Number, default: 0, min: 0 },
    failedCount:      { type: Number, default: 0, min: 0 },
    // Recipients skipped because they'd opted out (never actually
    // attempted) -- distinct from failedCount (a real send attempt that
    // errored). Needed for the send worker's completion detection: a
    // campaign with any opted-out recipients would otherwise never see
    // sentCount + failedCount reach recipientCount, leaving it stuck in
    // RUNNING forever. See queues/campaignSend.worker.js.
    skippedCount:     { type: Number, default: 0, min: 0 },
    bookingCount:     { type: Number, default: 0, min: 0 },
    paymentCount:     { type: Number, default: 0, min: 0 },
    revenueGenerated: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const settingsSchema = new Schema(
  {
    allowDuplicateRecipients:   { type: Boolean, default: false },
    trackReplies:               { type: Boolean, default: true },
    trackBookings:              { type: Boolean, default: true },
    trackPayments:              { type: Boolean, default: true },
    stopOnFailureThreshold:     { type: Number, default: 0, min: 0 }, // 0 = disabled
  },
  { _id: false },
);

const auditEntrySchema = new Schema(
  {
    fromStatus:  { type: String, default: null },
    toStatus:    { type: String, required: true },
    action:      { type: String, required: true },
    performedBy: { type: String, default: null },
    performedAt: { type: Date, default: Date.now },
    comment:     { type: String, default: '' },
  },
  { _id: false },
);

// ── Main schema ───────────────────────────────────────────────────────────────

const campaignSchema = new Schema(
  {
    tenantId: { type: String, required: true },

    name:        { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    type:        { type: String, enum: CAMPAIGN_TYPE_VALUES, required: true },
    status:      { type: String, enum: CAMPAIGN_STATUS_VALUES, default: CAMPAIGN_STATUS.DRAFT },

    templateId:   { type: Schema.Types.ObjectId, ref: 'WhatsAppTemplate', default: null },
    templateName: { type: String, default: '' },

    provider: { type: String, default: '' },

    audience:       { type: audienceSchema, default: () => ({}) },
    recipientCount: { type: Number, default: 0, min: 0 },

    scheduledAt:  { type: Date, default: null },
    startedAt:    { type: Date, default: null },
    completedAt:  { type: Date, default: null },

    approvedBy: { type: String, default: null },
    approvedAt: { type: Date,   default: null },

    metrics:  { type: metricsSchema, default: () => ({}) },
    settings: { type: settingsSchema, default: () => ({}) },

    auditLog: { type: [auditEntrySchema], default: [] },

    failureReason: { type: String, default: null },
    isActive:      { type: Boolean, default: true },

    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
  },
  {
    timestamps: true,   // createdAt + updatedAt
    versionKey: false,
  },
);

campaignSchema.index({ tenantId: 1, status: 1 });
campaignSchema.index({ tenantId: 1, type: 1 });
campaignSchema.index({ tenantId: 1, templateId: 1 });
campaignSchema.index({ tenantId: 1, createdBy: 1 });
campaignSchema.index({ tenantId: 1, scheduledAt: 1 });
campaignSchema.index({ tenantId: 1, createdAt: -1 });

export const WhatsAppCampaign = mongoose.model('WhatsAppCampaign', campaignSchema);