/**
 * =============================================================================
 * InnovateX Revenue OS — Email Log
 * =============================================================================
 *
 * FILE: src/modules/email/emailLog.model.js
 *
 * One document per real email send attempt, transactional or nurture.
 * Nothing in this codebase tracked transactional email delivery status
 * before this -- this is genuinely new, not a duplicate of anything.
 * For Nurture sends specifically, this is a lightweight index alongside
 * the real source of truth (NurtureEnrollment.executionHistory, which
 * already stores providerMessageId/status per step) -- it exists so a
 * SendGrid webhook event can find the right record by sgMessageId in
 * O(1) via a real index, and so Reports/analytics have one place to
 * query delivery status across both transactional and nurture sends
 * without scanning every enrollment's execution history.
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

export const EMAIL_TYPE = Object.freeze({
  TRANSACTIONAL: 'TRANSACTIONAL',
  NURTURE: 'NURTURE',
});

export const EMAIL_CATEGORY = Object.freeze({
  EMAIL_VERIFICATION_OTP: 'EMAIL_VERIFICATION_OTP',
  EMAIL_VERIFICATION_LINK: 'EMAIL_VERIFICATION_LINK',
  PASSWORD_RESET_OTP: 'PASSWORD_RESET_OTP',
  PASSWORD_RESET_LINK: 'PASSWORD_RESET_LINK',
  WELCOME: 'WELCOME',
  TEAM_INVITE: 'TEAM_INVITE',
  BOOKING_CONFIRMATION: 'BOOKING_CONFIRMATION',
  BOOKING_REMINDER: 'BOOKING_REMINDER',
  BOOKING_RESCHEDULED: 'BOOKING_RESCHEDULED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  PAYMENT_CONFIRMATION: 'PAYMENT_CONFIRMATION',
  PAYMENT_FAILURE: 'PAYMENT_FAILURE',
  NURTURE_STEP: 'NURTURE_STEP',
});
export const EMAIL_CATEGORY_VALUES = Object.freeze(Object.values(EMAIL_CATEGORY));

export const EMAIL_STATUS = Object.freeze({
  QUEUED: 'QUEUED',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  OPENED: 'OPENED',
  CLICKED: 'CLICKED',
  BOUNCED: 'BOUNCED',
  DROPPED: 'DROPPED',
  SPAM_REPORT: 'SPAM_REPORT',
  UNSUBSCRIBED: 'UNSUBSCRIBED',
  FAILED: 'FAILED',
});
export const EMAIL_STATUS_VALUES = Object.freeze(Object.values(EMAIL_STATUS));

const emailLogSchema = new Schema(
  {
    // null for pure-platform sends with no tenant context yet (e.g. a
    // signup verification email sent before any tenant/workspace exists
    // for that user). Real tenant scoping applies to every query that
    // filters by it -- see emailLog.repository.js.
    tenantId: { type: String, default: null, index: true },

    type:     { type: String, enum: Object.values(EMAIL_TYPE), required: true },
    category: { type: String, enum: EMAIL_CATEGORY_VALUES, required: true },

    to:      { type: String, required: true },
    subject: { type: String, default: '' },

    // Real SendGrid message id (from the X-Message-Id response header),
    // used to correlate an inbound webhook event back to this exact send.
    sgMessageId: { type: String, default: null, index: true },

    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', default: null },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    // Only set for NURTURE-type rows -- lets a webhook event (or a
    // report) trace an email straight back to the specific enrollment
    // and step that sent it.
    nurtureEnrollmentId: { type: Schema.Types.ObjectId, ref: 'NurtureEnrollment', default: null },
    nurtureStepNumber:   { type: Number, default: null },

    status:      { type: String, enum: EMAIL_STATUS_VALUES, default: EMAIL_STATUS.QUEUED },
    error:       { type: String, default: null },
    lastEventAt: { type: Date, default: null },
  },
  { timestamps: true },
);

emailLogSchema.index({ tenantId: 1, createdAt: -1 });
emailLogSchema.index({ sgMessageId: 1 }, { sparse: true });
emailLogSchema.index({ nurtureEnrollmentId: 1, nurtureStepNumber: 1 }, { sparse: true });

export const EmailLog = mongoose.model('EmailLog', emailLogSchema, 'email_logs');
