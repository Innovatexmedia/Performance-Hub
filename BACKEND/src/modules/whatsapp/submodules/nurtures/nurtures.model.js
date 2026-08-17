import mongoose from 'mongoose';
import {
  SEQUENCE_STATUS,
  SEQUENCE_STATUS_VALUES,
  SEQUENCE_TYPE_VALUES,
  TRIGGER_TYPE,
  TRIGGER_TYPE_VALUES,
  DELAY_UNIT_VALUES,
  ENROLLMENT_STATUS,
  ENROLLMENT_STATUS_VALUES,
  STEP_EXECUTION_STATUS,
  NURTURE_CHANNEL,
  NURTURE_CHANNEL_VALUES,
  NURTURE_TRIGGER_TEMPERATURE_VALUES,
} from './nurtures.constants.js';

const { Schema } = mongoose;

// ── Step sub-schema (embedded in Sequence) ────────────────────────────────────
// channel defaults to WHATSAPP -- every step document already in the
// database has no `channel` field, and Mongoose applies this default on
// read, so every existing sequence keeps working exactly as before.
// templateId stays exactly as it was for WhatsApp steps (still validated
// against real, approved WhatsApp templates in the service layer);
// emailSubject/emailBody are the real, separate fields for EMAIL steps;
// taskDescription is the real field for MANUAL_TASK steps (assigns a
// real to-do, not an automated send).

const stepSchema = new Schema(
  {
    stepNumber:     { type: Number, required: true, min: 1 },
    delayValue:     { type: Number, required: true, min: 0 },
    delayUnit:      { type: String, enum: DELAY_UNIT_VALUES, required: true },
    channel:        { type: String, enum: NURTURE_CHANNEL_VALUES, default: NURTURE_CHANNEL.WHATSAPP },

    // WhatsApp channel (unchanged from before this extension)
    templateId:     { type: Schema.Types.ObjectId, ref: 'WhatsAppTemplate', default: null },
    templateName:   { type: String, default: '' },
    approvalStatus: { type: String, default: '' },   // snapshot at validation time

    // Email channel (real -- sent via the existing, real SendGrid service)
    emailSubject:   { type: String, default: '' },
    emailBody:       { type: String, default: '' },

    // Manual task channel (real -- creates a real task for a human, not an automated send)
    taskDescription: { type: String, default: '' },
    assignToUserId:  { type: Schema.Types.ObjectId, ref: 'User', default: null },

    conditions:     { type: Schema.Types.Mixed, default: {} },
    isActive:       { type: Boolean, default: true },
  },
  { _id: false },
);

// ── Sequence audit entry ───────────────────────────────────────────────────────
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

// ── Sequence (the nurture blueprint) ──────────────────────────────────────────

const nurtureSequenceSchema = new Schema(
  {
    tenantId:    { type: String, required: true },
    name:        { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    type:        { type: String, enum: SEQUENCE_TYPE_VALUES, required: true },
    status:      { type: String, enum: SEQUENCE_STATUS_VALUES, default: SEQUENCE_STATUS.DRAFT },
    triggerType: { type: String, enum: TRIGGER_TYPE_VALUES, default: TRIGGER_TYPE.MANUAL },
    // Real, tenant-configured qualification auto-enroll -- only meaningful
    // when triggerType === LEAD_QUALIFIED. A tenant picks which real lead
    // temperature (Cold or Warm) should auto-enroll into THIS sequence;
    // AI Qualification's real scoring flow checks this field, it isn't a
    // hardcoded mapping invented here.
    qualificationTemperature: { type: String, enum: [...NURTURE_TRIGGER_TEMPERATURE_VALUES, null], default: null },
    totalSteps:  { type: Number, default: 0, min: 0 },
    steps:       { type: [stepSchema], default: [] },

    // Enrollment counters (denormalised for fast reads).
    enrollmentCount:          { type: Number, default: 0, min: 0 },
    activeEnrollmentCount:    { type: Number, default: 0, min: 0 },
    completedEnrollmentCount: { type: Number, default: 0, min: 0 },
    failedEnrollmentCount:    { type: Number, default: 0, min: 0 },
    cancelledEnrollmentCount: { type: Number, default: 0, min: 0 },

    auditLog:  { type: [auditEntrySchema], default: [] },
    isActive:  { type: Boolean, default: true },
    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

nurtureSequenceSchema.index({ tenantId: 1, status: 1 });
nurtureSequenceSchema.index({ tenantId: 1, type: 1 });
nurtureSequenceSchema.index({ tenantId: 1, triggerType: 1 });
nurtureSequenceSchema.index({ tenantId: 1, createdBy: 1 });
nurtureSequenceSchema.index({ tenantId: 1, createdAt: -1 });

export const NurtureSequence = mongoose.model('NurtureSequence', nurtureSequenceSchema);

// ── Execution history entry (embedded in Enrollment) ──────────────────────────

const executionHistorySchema = new Schema(
  {
    stepNumber:        { type: Number, required: true },
    templateId:        { type: Schema.Types.ObjectId, ref: 'WhatsAppTemplate', default: null },
    executedAt:        { type: Date, default: Date.now },
    status:            { type: String, enum: Object.values(STEP_EXECUTION_STATUS), required: true },
    providerMessageId: { type: String, default: null },
    error:             { type: String, default: null },
  },
  { _id: false },
);

// ── Enrollment audit entry ─────────────────────────────────────────────────────
const enrollmentAuditSchema = new Schema(
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

// ── Enrollment (one lead's progress through a sequence) ───────────────────────

const nurtureEnrollmentSchema = new Schema(
  {
    tenantId:   { type: String, required: true },
    sequenceId: { type: Schema.Types.ObjectId, ref: 'NurtureSequence', required: true },
    leadId:     { type: Schema.Types.ObjectId, ref: 'Lead', default: null },
    contactId:  { type: Schema.Types.ObjectId, ref: 'WhatsAppContact', default: null },

    currentStep:      { type: Number, default: 1, min: 1 },
    status:           { type: String, enum: ENROLLMENT_STATUS_VALUES, default: ENROLLMENT_STATUS.ACTIVE },

    enrolledAt:       { type: Date, default: Date.now },
    lastExecutedAt:   { type: Date, default: null },
    completedAt:      { type: Date, default: null },
    nextExecutionAt:  { type: Date, default: null },

    executionHistory: { type: [executionHistorySchema], default: [] },
    auditLog:         { type: [enrollmentAuditSchema], default: [] },

    // ── Real retry tracking ────────────────────────────────────────────────
    retryCount:   { type: Number, default: 0, min: 0 },
    lastError:    { type: String, default: null },

    // ── Real pause/stop reason -- distinguishes WHY an enrollment paused,
    // needed to correctly implement "if a lead replies, books a meeting,
    // becomes qualified, converts, or opts out, handle the configured
    // pause/stop behavior" -- each of those is a genuinely different real
    // reason, not just a generic "paused" flag.
    pauseReason: {
      type: String,
      enum: ['MANUAL', 'REPLY_DETECTED', 'OPTED_OUT', 'QUALIFIED', 'BOOKED', 'CONVERTED', null],
      default: null,
    },

    // ── Real atomic execution lock ─────────────────────────────────────────
    // The scheduler claims an enrollment by atomically setting this
    // before sending anything (see nurtureScheduler.service.js) -- a real
    // findOneAndUpdate with this field in the filter is what guarantees
    // two concurrent scheduler ticks (or two server instances) can never
    // both send the same step, not just "unlikely to happen".
    processingLockedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

nurtureEnrollmentSchema.index({ tenantId: 1, sequenceId: 1 });
nurtureEnrollmentSchema.index({ tenantId: 1, leadId: 1 });
nurtureEnrollmentSchema.index({ tenantId: 1, contactId: 1 });
nurtureEnrollmentSchema.index({ tenantId: 1, status: 1 });
nurtureEnrollmentSchema.index({ tenantId: 1, nextExecutionAt: 1, status: 1 });  // scheduler index
// Real, DB-level guarantee against a duplicate ACTIVE enrollment for the
// same lead in the same sequence -- enrollLead()'s own check-then-create
// logic is correct but has a narrow real race window (e.g. two
// auto-enroll triggers firing near-simultaneously for the same lead).
// Partial (only enforced while status=ACTIVE) so a lead can still
// legitimately re-enroll after a prior enrollment genuinely completes
// or is cancelled -- this isn't a "one enrollment ever" constraint.
nurtureEnrollmentSchema.index(
  { tenantId: 1, sequenceId: 1, leadId: 1 },
  { unique: true, partialFilterExpression: { status: 'ACTIVE' } },
);

export const NurtureEnrollment = mongoose.model('NurtureEnrollment', nurtureEnrollmentSchema);