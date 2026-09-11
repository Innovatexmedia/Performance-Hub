/**
 * =============================================================================
 * InnovateX Revenue OS — Meta Ads Settings Service
 * =============================================================================
 *
 * FILE: src/modules/attribution/metaAdsSettings.service.js
 *
 * Real OAuth token lifecycle management + sync orchestration, mirroring
 * googleAdsSettings.service.js's structure throughout. The one genuine
 * structural difference: getValidAccessToken here RE-EXCHANGES the
 * current long-lived token for a fresh one before its own ~60-day
 * expiry, rather than using a separate stored refresh_token -- Meta's
 * real documented model, not an approximation of Google's.
 * =============================================================================
 */

import MetaAdsSettings from './metaAdsSettings.model.js';
import MetaAdsCampaignMetric from './metaAdsCampaignMetric.model.js';
import { MetaAdsProvider } from './providers/metaAds.provider.js';
import { encrypt, safeDecrypt, signState } from '../../utils/crypto.js';
import config from '../../config/config.js';
import { AppError } from '../../shared/helpers/lead.helpers.js';

const REQUIRE_PLATFORM_CONFIG = () => {
  if (!config.META_ADS_APP_ID || !config.META_ADS_APP_SECRET) {
    throw AppError.badRequest(
      'Meta Ads is not configured on this server yet. An administrator needs to set META_ADS_APP_ID and META_ADS_APP_SECRET.'
    );
  }
};

const buildProvider = (adAccountId = '') => new MetaAdsProvider({
  appId:       config.META_ADS_APP_ID,
  appSecret:   config.META_ADS_APP_SECRET,
  adAccountId: adAccountId || '0000000000', // placeholder, only real calls that need it will fail without a genuine ID -- same convention as googleAdsSettings.service.js's buildProvider
});

const getOrCreate = async (tenantId) => {
  let doc = await MetaAdsSettings.findOne({ tenantId });
  if (!doc) doc = await MetaAdsSettings.create({ tenantId });
  return doc;
};

/**
 * getValidAccessToken -- returns a real, currently-valid access token,
 * re-exchanging it first if the cached one is within 7 days of its own
 * real ~60-day expiry. Real, deliberately wide buffer compared to
 * Google's 2-minute one: Google's tokens last ~1 hour so a 2-minute
 * margin is proportionally similar, but re-exchanging a 60-day token
 * with only minutes to spare risks a sync failing outright if it
 * happens to run right at the edge -- 7 days gives real room for a
 * scheduled sync to catch and renew it well before expiry.
 */
const getValidAccessToken = async (doc) => {
  const now = Date.now();
  const bufferMs = 7 * 24 * 60 * 60 * 1000;

  if (doc.accessToken && doc.accessTokenExpiresAt && doc.accessTokenExpiresAt.getTime() - bufferMs > now) {
    return safeDecrypt(doc.accessToken);
  }

  if (!doc.accessToken) {
    throw AppError.badRequest('No Meta Ads account connected for this workspace.');
  }

  // Real re-exchange: Meta's documented mechanism for renewing a
  // long-lived token is exchanging the CURRENT one (even if not yet
  // expired) for a fresh one with a full new ~60-day window -- there is
  // no separate refresh_token to use instead.
  const provider = buildProvider(doc.adAccountId);
  const { accessToken, expiresInSeconds } = await provider.exchangeForLongLivedToken(safeDecrypt(doc.accessToken));

  doc.accessToken = encrypt(accessToken);
  doc.accessTokenExpiresAt = new Date(now + expiresInSeconds * 1000);
  await doc.save();

  return accessToken;
};

export const metaAdsSettingsService = {
  async getSettings(ctx) {
    const doc = await getOrCreate(ctx.tenantId);
    return doc.toJSON();
  },

  /**
   * buildAuthorizationUrl -- real Meta OAuth2 (Facebook Login for
   * Business) consent screen URL. Real, signed, time-limited state --
   * same exact CSRF protection as googleAdsSettings.service.js's
   * buildAuthorizationUrl and shopifySettings.service.js's, for the
   * identical reason: this callback is necessarily fully public with no
   * session of its own to verify against.
   */
  buildAuthorizationUrl(ctx) {
    REQUIRE_PLATFORM_CONFIG();
    const params = new URLSearchParams({
      client_id: config.META_ADS_APP_ID,
      redirect_uri: config.META_ADS_OAUTH_REDIRECT_URI,
      response_type: 'code',
      scope: 'ads_management,ads_read,read_insights,business_management',
      state: signState(String(ctx.tenantId)),
    });
    return `https://www.facebook.com/${'v25.0'}/dialog/oauth?${params.toString()}`;
  },

  /**
   * completeAuthorization -- real OAuth callback handler. Exchanges the
   * authorization code for a real short-lived token, immediately
   * upgrades it to a real long-lived token (the one actually stored --
   * storing the short-lived one would mean it expires in ~1-2 hours),
   * then fetches the real list of Meta ad accounts this login can
   * access so the UI can show a genuine picker, matching
   * googleAdsSettings.service.js's completeAuthorization exactly in
   * shape and purpose.
   */
  async completeAuthorization({ tenantId, userId, code }) {
    REQUIRE_PLATFORM_CONFIG();

    const provider = buildProvider();
    const { shortLivedToken } = await provider.exchangeCodeForToken({
      code,
      redirectUri: config.META_ADS_OAUTH_REDIRECT_URI,
    });
    const { accessToken, expiresInSeconds } = await provider.exchangeForLongLivedToken(shortLivedToken);

    const doc = await getOrCreate(tenantId);
    doc.accessToken = encrypt(accessToken);
    doc.accessTokenExpiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    doc.updatedBy = userId;
    await doc.save();

    // Real account discovery -- lets the UI show genuine account names,
    // not ask the tenant to already know a raw ad account ID.
    const accounts = await provider.listAdAccounts(accessToken);

    return { accounts };
  },

  /**
   * selectAccount -- tenant picks which real Meta ad account (from the
   * real list returned by completeAuthorization) their data should
   * sync from.
   */
  async selectAccount(ctx, adAccountId, accountName = '') {
    const doc = await getOrCreate(ctx.tenantId);
    if (!doc.accessToken) {
      throw AppError.badRequest('Complete Meta authorization before selecting an account.');
    }
    doc.adAccountId = adAccountId.replace(/^act_/, '');
    doc.accountName = accountName;
    doc.connected = true;
    doc.connectedAt = doc.connectedAt || new Date();
    doc.updatedBy = ctx.userId;
    await doc.save();
    return doc.toJSON();
  },

  async disconnect(ctx) {
    const doc = await getOrCreate(ctx.tenantId);
    doc.connected = false;
    doc.accessToken = null;
    doc.accessTokenExpiresAt = null;
    await doc.save();
    return doc.toJSON();
  },

  /**
   * syncCampaigns -- real Ads Insights API pull, written into
   * MetaAdsCampaignMetric. This is what "Sync" on the Meta Ads
   * Integrations card triggers, and what feeds the Attribution
   * dashboard's real Meta ad-spend numbers -- same exact shape and role
   * as googleAdsSettings.service.js's syncCampaigns.
   */
  async syncCampaigns(ctx, { dateRange = 'LAST_30_DAYS' } = {}) {
    const doc = await getOrCreate(ctx.tenantId);
    if (!doc.connected || !doc.adAccountId) {
      throw AppError.badRequest('Connect a Meta Ads account before syncing.');
    }

    try {
      const accessToken = await getValidAccessToken(doc);
      const provider = buildProvider(doc.adAccountId);
      const campaigns = await provider.getCampaignPerformance({ accessToken, dateRange });

      await Promise.all(campaigns.map((c) =>
        MetaAdsCampaignMetric.findOneAndUpdate(
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
};