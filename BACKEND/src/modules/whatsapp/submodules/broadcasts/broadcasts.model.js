import mongoose from 'mongoose';
import {
  BROADCAST_STATUS,
  BROADCAST_STATUS_VALUES,
  BROADCAST_TYPE_VALUES,
} from './broadcasts.constants.js';

const { Schema } = mongoose;

// ── Sub-schemas (identical structure to campaigns, broadcast-specific metrics) ─

const audienceSchema = new Schema(
  {
    filters:          { type: Schema.Types.Mixed, default: {} },
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
    // Recipients skipped because they'd already opted out (never
    // actually attempted) -- see campaigns.model.js's skippedCount
    // comment for why the send worker needs this for completion
    // detection.
    skippedCount:     { type: Number, default: 0, min: 0 },
    bookingCount:     { type: Number, default: 0, min: 0 },
    paymentCount:     { type: Number, default: 0, min: 0 },
    revenueGenerated: { type: Number, default: 0, min: 0 },
    // Broadcast-specific: tracks opt-outs triggered by this broadcast.
    optOutCount:      { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const settingsSchema = new Schema(
  {
    allowDuplicateRecipients: { type: Boolean, default: false },
    trackReplies:             { type: Boolean, default: true },
    trackBookings:            { type: Boolean, default: true },
    trackPayments:            { type: Boolean, default: true },
    stopOnFailureThreshold:   { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const audienceSummarySchema = new Schema(
  {
    totalMatched:           { type: Number, default: 0 },
    recipientCount:         { type: Number, default: 0 },
    excludedRecipientCount: { type: Number, default: 0 },
    optedOutCount:          { type: Number, default: 0 },
    suppressedCount:        { type: Number, default: 0 },
  },
  { _id: false },
);

const auditEntrySchema = new Schema(
  {
    fromStatus:  { type: String, default: null },
    toStatus:    { type: String, required: true },
    action:      { type: String, required: true },
    performedBy: { type: String, default: null },
    performedAt: { type: Date,   default: Date.now },
    comment:     { type: String, default: '' },
  },
  { _id: false },
);

// ── Main schema ───────────────────────────────────────────────────────────────

const broadcastSchema = new Schema(
  {
    tenantId: { type: String, required: true },

    name:        { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    type:        { type: String, enum: BROADCAST_TYPE_VALUES, required: true },
    status:      { type: String, enum: BROADCAST_STATUS_VALUES, default: BROADCAST_STATUS.DRAFT },

    /** Always true — distinguishes broadcasts from general campaigns. */
    broadcastFlag: { type: Boolean, default: true, immutable: true },

    templateId:   { type: Schema.Types.ObjectId, ref: 'WhatsAppTemplate', default: null },
    templateName: { type: String, default: '' },
    provider:     { type: String, default: '' },

    audience:       { type: audienceSchema, default: () => ({}) },
    audienceSummary: { type: audienceSummarySchema, default: () => ({}) },
    recipientCount: { type: Number, default: 0, min: 0 },

    scheduledAt: { type: Date, default: null },
    startedAt:   { type: Date, default: null },
    completedAt: { type: Date, default: null },

    approvedBy: { type: String, default: null },
    approvedAt: { type: Date,   default: null },

    metrics:         { type: metricsSchema, default: () => ({}) },
    settings:        { type: settingsSchema, default: () => ({}) },
    auditLog:        { type: [auditEntrySchema], default: [] },

    failureReason: { type: String, default: null },
    isActive:      { type: Boolean, default: true },

    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

broadcastSchema.index({ tenantId: 1, status: 1 });
broadcastSchema.index({ tenantId: 1, type: 1 });
broadcastSchema.index({ tenantId: 1, templateId: 1 });
broadcastSchema.index({ tenantId: 1, createdBy: 1 });
broadcastSchema.index({ tenantId: 1, scheduledAt: 1 });
broadcastSchema.index({ tenantId: 1, broadcastFlag: 1, createdAt: -1 });

export const WhatsAppBroadcast = mongoose.model('WhatsAppBroadcast', broadcastSchema);