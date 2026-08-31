/**
 * =============================================================================
 * InnovateX Revenue OS — SendGrid Settings (per-tenant)
 * =============================================================================
 *
 * FILE: src/modules/email/sendgridSettings.model.js
 *
 * One document per tenant -- this is the TENANT'S OWN SendGrid account,
 * used only for Nurture/marketing email sends, deliberately separate from
 * the PLATFORM-level transactional sender in
 * auth/services/email.service.js (which uses InnovateX's own SendGrid
 * account for signup/reset/welcome/invite/booking/payment emails and is
 * unmodified by this file). Mirrors CalcomSettings/AdTrackingSettings'
 * exact real schema shape: encrypted credential, verified-connection
 * bookkeeping, real sync error tracking.
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

const sendgridSettingsSchema = new Schema(
  {
    tenantId: {
      type:     Schema.Types.ObjectId,
      ref:      'Tenant',
      required: true,
      unique:   true,
    },

    // Encrypted via src/utils/crypto.js's encrypt()/decrypt() before this
    // ever touches the database -- same real AES-256-GCM already used for
    // WhatsApp/Google Ads/Razorpay credentials, never a new scheme.
    apiKey: { type: String, default: null },

    // A SendGrid API key alone doesn't tell you WHICH address it's allowed
    // to send from -- SendGrid requires the sender identity itself to be
    // verified separately. Both configured here explicitly, not inferred.
    verifiedSenderEmail: { type: String, default: null },
    fromName:            { type: String, default: null },
    replyTo:             { type: String, default: null },

    connected:      { type: Boolean, default: false },
    connectedAt:    { type: Date, default: null },
    lastVerifiedAt: { type: Date, default: null },
    lastSyncError:  { type: String, default: null },

    // Real signed-webhook verification key, base64 -- SendGrid's Event
    // Webhook Signing public key (ECDSA), configured per-tenant since each
    // tenant's own SendGrid account issues its own signing key. Optional:
    // if unset, this tenant's webhook events are still accepted (so
    // webhook processing doesn't hard-require a feature not every
    // SendGrid plan/tenant has enabled) but flagged as unverified rather
    // than silently treated as if they were verified.
    webhookVerificationKey: { type: String, default: null },

    eventsReceived: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        // Never return the encrypted key or the raw webhook verification
        // key in an API response -- same rule as every other credential
        // field on every other *Settings model in this codebase.
        ret.hasApiKey = !!ret.apiKey;
        delete ret.apiKey;
        ret.hasWebhookVerificationKey = !!ret.webhookVerificationKey;
        delete ret.webhookVerificationKey;
        return ret;
      },
    },
  },
);

sendgridSettingsSchema.index({ tenantId: 1 }, { unique: true });

export default mongoose.model('SendGridSettings', sendgridSettingsSchema, 'sendgrid_settings');
