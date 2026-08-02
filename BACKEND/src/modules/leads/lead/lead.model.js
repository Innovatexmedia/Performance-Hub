import mongoose from 'mongoose';
import {
  LEAD_STATUS,
  LEAD_STATUS_VALUES,
  LEAD_TEMPERATURE_VALUES,
  CONSENT_STATUS,
  CONSENT_STATUS_VALUES,
} from './lead.constants.js';

const { Schema } = mongoose;

/**
 * Lead schema — fields only (per spec B3).
 * No business logic, no duplicate detection here.
 */
const leadSchema = new Schema(
  {
    tenant_id: { type: String, required: true, index: true },

    // Identity / contact
    name: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    whatsapp_number: { type: String, trim: true },
    company: { type: String, trim: true },

    // Attribution
    source: { type: String, trim: true },
    medium: { type: String, trim: true },
    campaign: { type: String, trim: true },
    utm_source: { type: String, trim: true },
    utm_medium: { type: String, trim: true },
    utm_campaign: { type: String, trim: true },
    utm_content: { type: String, trim: true },
    utm_term: { type: String, trim: true },

    // Lifecycle
    status: { type: String, enum: LEAD_STATUS_VALUES, default: LEAD_STATUS.NEW },
    qualification_score: { type: Number, min: 0, max: 10, default: 0 },
    lead_temperature: { type: String, enum: LEAD_TEMPERATURE_VALUES },

    // Ownership / segmentation
    assigned_user_id: { type: String, default: null },
    group_id: { type: String, default: null, index: true },
    segment: { type: String, trim: true },
    value: { type: Number, default: 0 },
    notes: { type: String, default: '' },

    // Consent / compliance
    consent_status: {
      type: String,
      enum: CONSENT_STATUS_VALUES,
      default: CONSENT_STATUS.PENDING,
    },
    opt_out_status: { type: Boolean, default: false },

    // Engagement
    last_contacted_at: { type: Date, default: null },

    // Soft delete
    archived: { type: Boolean, default: false },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
  },
);

export const Lead = mongoose.model('Lead', leadSchema);