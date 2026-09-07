/**
 * =============================================================================
 * InnovateX Revenue OS — Google Ads Settings Service
 * =============================================================================
 *
 * FILE: src/modules/attribution/googleAdsSettings.service.js
 *
 * Real OAuth token lifecycle management + sync orchestration. Mirrors
 * the object-of-async-methods pattern used by every other settings
 * service in this codebase (ctx = {tenantId, userId} first argument).
 * =============================================================================
 */

import GoogleAdsSettings from './googleAdsSettings.model.js';
import GoogleAdsCampaignMetric from './googleAdsCampaignMetric.model.js';
import { GoogleAdsProvider } from './providers/googleAds.provider.js';
import { encrypt, safeDecrypt } from '../../utils/crypto.js';
import { signState } from '../../utils/crypto.js';
import config from '../../config/config.js';
import { AppError } from '../../shared/helpers/lead.helpers.js';

const REQUIRE_PLATFORM_CONFIG = () => {
  if (!config.GOOGLE_ADS_DEVELOPER_TOKEN || !config.GOOGLE_ADS_OAUTH_CLIENT_ID || !config.GOOGLE_ADS_OAUTH_CLIENT_SECRET) {
    throw AppError.badRequest(
      'Google Ads is not configured on this server yet. An administrator needs to set GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_OAUTH_CLIENT_ID, and GOOGLE_ADS_OAUTH_CLIENT_SECRET.'
    );
  }
};

const buildProvider = (clientCustomerId = '') => new GoogleAdsProvider({
  developerToken:     config.GOOGLE_ADS_DEVELOPER_TOKEN,
  managerCustomerId:  config.GOOGLE_ADS_MANAGER_CUSTOMER_ID,
  oauthClientId:      config.GOOGLE_ADS_OAUTH_CLIENT_ID,
  oauthClientSecret:  config.GOOGLE_ADS_OAUTH_CLIENT_SECRET,
  clientCustomerId:   clientCustomerId || '0000000000', // placeholder, only real calls that need it will fail without a genuine ID
});

const getOrCreate = async (tenantId) => {
  let doc = await GoogleAdsSettings.findOne({ tenantId });
  if (!doc) doc = await GoogleAdsSettings.create({ tenantId });
  return doc;
};

/**
 * getValidAccessToken -- returns a real, currently-valid access token,
 * refreshing it first if the cached one has expired or is close to
 * expiring. This is the one function every real API call goes through,
 * so token refresh logic lives in exactly one place.
 */
const getValidAccessToken = async (doc) => {
  const now = Date.now();
  const bufferMs = 2 * 60 * 1000; // refresh 2 minutes before real expiry, not exactly at the edge

  if (doc.accessToken && doc.accessTokenExpiresAt && doc.accessTokenExpiresAt.getTime() - bufferMs > now) {
    return safeDecrypt(doc.accessToken);
  }

  if (!doc.refreshToken) {
    throw AppError.badRequest('No Google Ads account connected for this workspace.');
  }

  const provider = buildProvider(doc.clientCustomerId);
  const { accessToken, expiresInSeconds } = await provider.refreshAccessToken(safeDecrypt(doc.refreshToken));

  doc.accessToken = encrypt(accessToken);
  doc.accessTokenExpiresAt = new Date(now + expiresInSeconds * 1000);
  await doc.save();

  return accessToken;
};

export const googleAdsSettingsService = {
  async getSettings(ctx) {
    const doc = await getOrCreate(ctx.tenantId);
    return doc.toJSON();
  },

  /**
   * buildAuthorizationUrl -- real Google OAuth2 consent screen URL.
   * access_type=offline + prompt=consent are both required to reliably
   * get a real refresh token back -- Google only issues one on first
   * consent otherwise, a real, documented gotcha (see the OAuth setup
   * notes delivered with this integration).
   */
  buildAuthorizationUrl(ctx) {
    REQUIRE_PLATFORM_CONFIG();
    const params = new URLSearchParams({
      client_id: config.GOOGLE_ADS_OAUTH_CLIENT_ID,
      redirect_uri: config.GOOGLE_ADS_OAUTH_REDIRECT_URI,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/adwords',
      access_type: 'offline',
      prompt: 'consent',
      // Carries tenantId through the redirect round-trip so the
      // callback knows which tenant to save tokens for -- signed/opaque
      // would be more robust against tampering, but this endpoint only
      // ever writes to the tenant encoded here after the person has
      // already authenticated with their OWN Google account and
      // explicitly granted consent, so a forged state can't grant
      // access to anything the attacker doesn't already control.
      // Real, signed, time-limited state -- see crypto.js's signState/
      // verifySignedState for the confirmed CSRF vulnerability this
      // closes (the raw tenantId was previously used directly, and this
      // callback is necessarily fully public with no session of its
      // own to verify against).
      state: signState(String(ctx.tenantId)),
    });
    return `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;
  },

  /**
   * completeAuthorization -- real OAuth callback handler. Exchanges the
   * authorization code for real tokens, encrypts and stores them, then
   * fetches the real list of Google Ads accounts this login can access
   * so the UI can show a genuine picker rather than asking for a raw
   * customer ID blind.
   */
  async completeAuthorization({ tenantId, userId, code }) {
    REQUIRE_PLATFORM_CONFIG();

    let response;
    try {
      response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.GOOGLE_ADS_OAUTH_CLIENT_ID,
          client_secret: config.GOOGLE_ADS_OAUTH_CLIENT_SECRET,
          redirect_uri: config.GOOGLE_ADS_OAUTH_REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
      });
    } catch (networkError) {
      throw new Error(`Could not reach Google's OAuth token endpoint — ${networkError.message}`);
    }

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Google rejected this authorization code — ${json?.error_description || json?.error || `HTTP ${response.status}`}`);
    }
    if (!json.refresh_token) {
      // Real, common cause: this tenant already authorized once before
      // and Google is silently reusing consent without issuing a new
      // refresh token. prompt=consent above should prevent this, but
      // surfaced explicitly in case it happens anyway.
      throw new Error('Google did not return a refresh token. Revoke this app\u2019s access at https://myaccount.google.com/permissions and try connecting again.');
    }

    const doc = await getOrCreate(tenantId);
    doc.refreshToken = encrypt(json.refresh_token);
    doc.accessToken = encrypt(json.access_token);
    doc.accessTokenExpiresAt = new Date(Date.now() + json.expires_in * 1000);
    doc.updatedBy = userId;
    await doc.save();

    // Real account discovery -- lets the UI show genuine account names,
    // not ask the tenant to already know a raw 10-digit customer ID.
    const provider = buildProvider();
    const customerIds = await provider.listAccessibleCustomers(json.access_token);

    return { customerIds };
  },

  /**
   * selectAccount -- tenant picks which real Google Ads account (from
   * the real list returned by completeAuthorization) their data should
   * sync from.
   */
  async selectAccount(ctx, clientCustomerId) {
    const doc = await getOrCreate(ctx.tenantId);
    if (!doc.refreshToken) {
      throw AppError.badRequest('Complete Google authorization before selecting an account.');
    }
    doc.clientCustomerId = clientCustomerId.replace(/-/g, '');
    doc.connected = true;
    doc.connectedAt = doc.connectedAt || new Date();
    doc.updatedBy = ctx.userId;
    await doc.save();
    return doc.toJSON();
  },

  async disconnect(ctx) {
    const doc = await getOrCreate(ctx.tenantId);
    doc.connected = false;
    doc.refreshToken = null;
    doc.accessToken = null;
    doc.accessTokenExpiresAt = null;
    await doc.save();
    return doc.toJSON();
  },

  /**
   * syncCampaigns -- real GAQL pull, written into GoogleAdsCampaignMetric.
   * This is what "Sync" on the Integrations card actually triggers, and
   * what feeds the Attribution dashboard's real ad-spend numbers.
   */
  async syncCampaigns(ctx, { dateRange = 'LAST_30_DAYS' } = {}) {
    const doc = await getOrCreate(ctx.tenantId);
    if (!doc.connected || !doc.clientCustomerId) {
      throw AppError.badRequest('Connect a Google Ads account before syncing.');
    }

    try {
      const accessToken = await getValidAccessToken(doc);
      const provider = buildProvider(doc.clientCustomerId);
      const campaigns = await provider.getCampaignPerformance({ accessToken, dateRange });

      await Promise.all(campaigns.map((c) =>
        GoogleAdsCampaignMetric.findOneAndUpdate(
          { tenantId: ctx.tenantId, campaignId: c.campaignId, dateRange },
          {
            $set: {
              campaignName: c.campaignName,
              status: c.status,
              channelType: c.channelType,
              impressions: c.impressions,
              clicks: c.clicks,
              spend: c.spend,
              conversions: c.conversions,
              conversionsValue: c.conversionsValue,
              ctr: c.ctr,
              averageCpc: c.averageCpc,
              syncedAt: new Date(),
            },
          },
          { upsert: true }
        )
      ));

      doc.lastSyncedAt = new Date();
      doc.lastSyncError = null;
      await doc.save();

      return { synced: true, campaignCount: campaigns.length };
    } catch (err) {
      doc.lastSyncError = err.message;
      await doc.save().catch(() => {});
      throw err;
    }
  },

  /** getCampaignMetrics -- real, already-synced data for the Attribution dashboard. */
  async getCampaignMetrics(tenantId, { dateRange = 'LAST_30_DAYS' } = {}) {
    return GoogleAdsCampaignMetric.find({ tenantId, dateRange }).sort({ spend: -1 });
  },
};