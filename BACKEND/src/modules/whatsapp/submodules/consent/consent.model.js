/**
 * WhatsApp Consent & Opt-Out — model.
 *
 * One Consent document per (tenantId, phoneNumber).
 * history[] is append-only — consent changes are NEVER overwritten or deleted.
 */
import mongoose from 'mongoose';
import {
  CONSENT_STATUS,
  CONSENT_STATUS_VALUES,
  OPT_IN_METHOD_VALUES,
  OPT_OUT_METHOD_VALUES,
  CONSENT_SOURCE_VALUES,
} from './consent.constants.js';
import { normalizePhoneNumber } from '../../../../shared/helpers/phone.helpers.js';

const { Schema } = mongoose;

// ── History entry (append-only audit trail) ───────────────────────────────────
const historyEntrySchema = new Schema(
  {
    previousStatus: { type: String, default: null },
    newStatus:      { type: String, required: true },
    action:         { type: String, default: '' },
    reason:         { type: String, default: '' },
    performedBy:    { type: String, default: null },
    performedAt:    { type: Date,   default: Date.now },
    ipAddress:      { type: String, default: null },
    userAgent:      { type: String, default: null },
  },
  { _id: false },
);

const consentSchema = new Schema(
  {
    tenantId:    { type: String, required: true },
    contactId:   { type: Schema.Types.ObjectId, ref: 'WhatsAppContact', default: null },
    leadId:      { type: Schema.Types.ObjectId, ref: 'Lead', default: null },
    phoneNumber: { type: String, required: true, trim: true, set: normalizePhoneNumber },

    // Denormalised for search (contact/lead name).
    contactName: { type: String, default: '' },
    leadName:    { type: String, default: '' },

    status: {
      type:    String,
      enum:    CONSENT_STATUS_VALUES,
      default: CONSENT_STATUS.PENDING,
    },

    optInMethod:   { type: String, enum: OPT_IN_METHOD_VALUES, default: null },
    optOutMethod:  { type: String, enum: OPT_OUT_METHOD_VALUES, default: null },
    consentSource: { type: String, enum: CONSENT_SOURCE_VALUES, default: null },
    consentText:   { type: String, default: '' },

    consentedAt:    { type: Date, default: null },
    optedOutAt:     { type: Date, default: null },
    expiresAt:      { type: Date, default: null },
    lastVerifiedAt: { type: Date, default: null },

    blockedReason: { type: String, default: null },
    // Remembers the status before BLOCK so unblock can restore it.
    preBlockStatus: { type: String, default: null },

    notes: { type: String, default: '' },

    history: { type: [historyEntrySchema], default: [] },

    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

// One active consent record per phone number per tenant.
consentSchema.index({ tenantId: 1, phoneNumber: 1 }, { unique: true });
consentSchema.index({ tenantId: 1, status: 1 });
consentSchema.index({ tenantId: 1, consentSource: 1 });
consentSchema.index({ tenantId: 1, contactId: 1 });
consentSchema.index({ tenantId: 1, leadId: 1 });
consentSchema.index({ tenantId: 1, expiresAt: 1 });
consentSchema.index({ tenantId: 1, createdAt: -1 });

export const Consent = mongoose.model('WhatsAppConsent', consentSchema);