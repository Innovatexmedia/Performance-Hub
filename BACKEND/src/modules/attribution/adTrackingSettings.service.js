/**
 * =============================================================================
 * InnovateX Revenue OS — Ad Tracking Settings Service
 * =============================================================================
 *
 * FILE: src/modules/attribution/adTrackingSettings.service.js
 *
 * Mirrors whatsappSettingsService's exact pattern (object of async
 * methods, ctx = {tenantId, userId} first argument) -- same established
 * shape as every other settings service in this codebase.
 * =============================================================================
 */

import AdTrackingSettings from './adTrackingSettings.model.js';
import { MetaConversionsProvider } from './providers/metaConversions.provider.js';
import { GoogleAnalyticsProvider } from './providers/googleAnalytics.provider.js';
import { AppError } from '../../shared/helpers/lead.helpers.js';
import { encrypt, safeDecrypt } from '../../utils/crypto.js';

const getOrCreate = async (tenantId) => {
  let doc = await AdTrackingSettings.findOne({ tenantId });
  if (!doc) doc = await AdTrackingSettings.create({ tenantId });
  return doc;
};

export const adTrackingSettingsService = {
  async getSettings(ctx) {
    const doc = await getOrCreate(ctx.tenantId);
    return doc.toJSON();
  },

  /**
   * updateMetaConfig -- only overwrites accessToken if a new value was
   * actually typed, same "don't clobber a real secret with an empty
   * field" principle used throughout every other provider's config save.
   *
   * ENCRYPTION AT REST (see audit finding shared with WhatsAppSettings --
   * this model's own header comment already said it mirrors that exact
   * pattern, credential-storage gap included): accessToken is encrypted
   * here, at the one point a real plaintext value from the user actually
   * enters the system, rather than via a Mongoose pre('save') hook --
   * this document's OTHER save paths (testMetaConnection,
   * disconnectMeta, etc.) never touch this field at all, so there's
   * nothing for a hook to accidentally re-encrypt or need to skip.
   */
  async updateMetaConfig(ctx, { pixelId, accessToken, testEventCode }) {
    const doc = await getOrCreate(ctx.tenantId);
    if (pixelId !== undefined) doc.meta.pixelId = pixelId;
    if (accessToken) doc.meta.accessToken = encrypt(accessToken);
    if (testEventCode !== undefined) doc.meta.testEventCode = testEventCode;
    doc.updatedBy = ctx.userId;
    await doc.save();
    return doc.toJSON();
  },

  async updateGoogleConfig(ctx, { measurementId, apiSecret }) {
    const doc = await getOrCreate(ctx.tenantId);
    if (measurementId !== undefined) doc.google.measurementId = measurementId;
    if (apiSecret) doc.google.apiSecret = encrypt(apiSecret);
    doc.updatedBy = ctx.userId;
    await doc.save();
    return doc.toJSON();
  },

  /**
   * testMetaConnection -- real verification against Meta's Graph API.
   * Throws a real error (which the caller surfaces to the UI) if the
   * credentials are wrong; only marks `connected: true` on genuine success.
   * decrypt() here, NOT on doc.meta.accessToken itself -- the stored
   * field stays ciphertext; only the value actually handed to the real
   * API call is ever plaintext, and only in memory for this request.
   */
  async testMetaConnection(ctx) {
    const doc = await getOrCreate(ctx.tenantId);
    if (!doc.meta.pixelId || !doc.meta.accessToken) {
      throw AppError.badRequest('Enter a Pixel ID and Access Token before testing the connection.');
    }
    const provider = new MetaConversionsProvider({
      pixelId: doc.meta.pixelId,
      accessToken: safeDecrypt(doc.meta.accessToken),
    });
    const result = await provider.testConnection(); // throws with a real Meta error message on failure

    doc.meta.connected = true;
    doc.meta.connectedAt = doc.meta.connectedAt || new Date();
    doc.meta.lastVerifiedAt = new Date();
    await doc.save();
    return { connected: true, name: result.name };
  },

  /**
   * testGoogleConnection -- real verification against GA4's debug
   * endpoint (the only one that returns genuine validation feedback --
   * see googleAnalytics.provider.js's file comment for why).
   */
  async testGoogleConnection(ctx) {
    const doc = await getOrCreate(ctx.tenantId);
    if (!doc.google.measurementId || !doc.google.apiSecret) {
      throw AppError.badRequest('Enter a Measurement ID and API Secret before testing the connection.');
    }
    const provider = new GoogleAnalyticsProvider({
      measurementId: doc.google.measurementId,
      apiSecret: safeDecrypt(doc.google.apiSecret),
    });
    await provider.testConnection(); // throws with real Google validation messages on failure

    doc.google.connected = true;
    doc.google.connectedAt = doc.google.connectedAt || new Date();
    doc.google.lastVerifiedAt = new Date();
    await doc.save();
    return { connected: true };
  },

  async disconnectMeta(ctx) {
    const doc = await getOrCreate(ctx.tenantId);
    doc.meta.connected = false;
    await doc.save();
    return doc.toJSON();
  },

  async disconnectGoogle(ctx) {
    const doc = await getOrCreate(ctx.tenantId);
    doc.google.connected = false;
    await doc.save();
    return doc.toJSON();
  },
};