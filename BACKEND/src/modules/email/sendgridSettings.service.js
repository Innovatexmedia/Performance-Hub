/**
 * =============================================================================
 * InnovateX Revenue OS — SendGrid Settings Service
 * =============================================================================
 *
 * FILE: src/modules/email/sendgridSettings.service.js
 *
 * Every function here is tenant-scoped by a real query filter
 * ({ tenantId }), the same pattern already proven for
 * calcomSettings.service.js/adTrackingSettings.service.js/
 * googleAdsSettings.service.js -- there is no function anywhere in this
 * file that can read or write another tenant's SendGrid credentials, and
 * no caller-supplied tenantId is ever trusted without it coming from the
 * server-resolved ctx (see sendgridSettings.controller.js).
 * =============================================================================
 */

import SendGridSettings from './sendgridSettings.model.js';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { verifyApiKey } from './providers/sendgrid.provider.js';
import { AppError } from '../../shared/helpers/lead.helpers.js';

const getOrCreate = async (tenantId) => {
  let doc = await SendGridSettings.findOne({ tenantId });
  if (!doc) doc = await SendGridSettings.create({ tenantId });
  return doc;
};

export const sendgridSettingsService = {
  /** getSettings -- real, tenant-scoped, credential fields stripped by the schema's own toJSON. */
  async getSettings(tenantId) {
    const doc = await getOrCreate(tenantId);
    return doc.toJSON();
  },

  /**
   * getDecryptedCredentials -- INTERNAL ONLY. Returns the real, usable
   * plaintext API key for this tenant. Never exposed through a
   * controller/route -- only called by nurtureExecution.service.js at the
   * moment of actually sending a SendGrid email step, and only ever for
   * the SAME tenantId the enrollment itself belongs to (see
   * nurtureExecution.service.js's real ctx.tenantId usage) -- this is
   * what makes "never allow one tenant to use another tenant's SendGrid
   * credentials" true in practice, not just in a comment: there is no
   * code path anywhere that fetches these credentials using anything
   * other than the enrollment's own tenantId.
   */
  async getDecryptedCredentials(tenantId) {
    const doc = await SendGridSettings.findOne({ tenantId });
    if (!doc || !doc.connected || !doc.apiKey) return null;
    return {
      apiKey: decrypt(doc.apiKey),
      from: { email: doc.verifiedSenderEmail, name: doc.fromName || undefined },
      replyTo: doc.replyTo || undefined,
    };
  },

  /**
   * updateConfig -- saves the tenant's own SendGrid credentials, then
   * REQUIRES a real, successful verifyApiKey() call before ever setting
   * connected: true. Invalid credentials are saved (so the tenant can see
   * what they entered and retry) but connected stays/goes false, and the
   * real SendGrid error is surfaced, not swallowed -- matches this app's
   * already-established pattern for Meta Ads/Google Ads (see
   * adTrackingSettings.service.js's testMetaConnection/testGoogleConnection),
   * not a new one invented for SendGrid.
   */
  async updateConfig(tenantId, { apiKey, verifiedSenderEmail, fromName, replyTo }) {
    if (!verifiedSenderEmail) throw AppError.badRequest('A verified sender email is required');

    const doc = await getOrCreate(tenantId);
    if (apiKey) doc.apiKey = encrypt(apiKey);
    doc.verifiedSenderEmail = verifiedSenderEmail;
    if (fromName !== undefined) doc.fromName = fromName || null;
    if (replyTo !== undefined) doc.replyTo = replyTo || null;

    try {
      await verifyApiKey(decrypt(doc.apiKey));
      doc.connected = true;
      doc.connectedAt = doc.connectedAt || new Date();
      doc.lastVerifiedAt = new Date();
      doc.lastSyncError = null;
    } catch (err) {
      doc.connected = false;
      doc.lastSyncError = err.message;
      await doc.save();
      throw AppError.badRequest(`Could not verify this SendGrid API key — ${err.message}`);
    }

    await doc.save();
    return doc.toJSON();
  },

  /** disconnect -- real, tenant-scoped. Clears credentials, not just the connected flag. */
  async disconnect(tenantId) {
    const doc = await getOrCreate(tenantId);
    doc.apiKey = null;
    doc.connected = false;
    doc.connectedAt = null;
    doc.lastSyncError = null;
    await doc.save();
    return doc.toJSON();
  },

  /** testConnection -- re-runs the real verification against the already-saved key. */
  async testConnection(tenantId) {
    const doc = await SendGridSettings.findOne({ tenantId });
    if (!doc || !doc.apiKey) throw AppError.badRequest('No SendGrid API key configured for this workspace yet');
    try {
      const result = await verifyApiKey(decrypt(doc.apiKey));
      doc.connected = true;
      doc.lastVerifiedAt = new Date();
      doc.lastSyncError = null;
      await doc.save();
      return { connected: true, accountType: result.type };
    } catch (err) {
      doc.connected = false;
      doc.lastSyncError = err.message;
      await doc.save();
      throw AppError.badRequest(err.message);
    }
  },
};
