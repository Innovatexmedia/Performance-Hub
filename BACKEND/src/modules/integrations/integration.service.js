/**
 * =============================================================================
 * InnovateX Revenue OS — Integration Service
 * =============================================================================
 *
 * FILE: src/modules/integrations/integration.service.js
 *
 * Contains ALL business logic:
 *   - Auto-seeding the 22-item catalog for a tenant on first list/read
 *     (mirrors the WhatsAppSettings auto-provision pattern).
 *   - toggleIntegration — connect/disconnect. Per DEVELOPER_HANDOFF.md
 *     section 17: "toggle flips status + sets last_sync". Connecting an
 *     integration with no real config values lands it in 'simulation'
 *     status rather than 'connected' (see STATUS TRANSITION note below) -
 *     this is this implementation's interpretation of the 3-state badge
 *     system (connected/simulation/disconnected), since the spec names the
 *     three states but does not define exactly what separates "connected"
 *     from "simulation".
 *   - syncIntegration — updates last_sync only; refuses on a disconnected
 *     integration.
 *   - updateIntegrationConfig — merges config, independent of status.
 *   - getCategoryCounts — for the "category tabs" UI.
 *
 * AppError usage matches automation.service.js / template.service.js
 * exactly: static factories from lead.helpers.js.
 *
 * STATUS TRANSITION
 * ──────────────────
 *   disconnected --toggle--> connected   (if config has at least one real value)
 *   disconnected --toggle--> simulation  (if config is still empty/default)
 *   connected    --toggle--> disconnected
 *   simulation   --toggle--> disconnected
 */

import * as integrationRepo from './integration.repository.js';
import { AppError, paginationMeta, normalizePaging } from '../../shared/helpers/lead.helpers.js';
import { INTEGRATION_STATUS } from './integration.constants.js';
import { whatsappSettingsService } from '../whatsapp/submodules/whatsappSettings/whatsappSettings.service.js';
import { adTrackingSettingsService } from '../attribution/adTrackingSettings.service.js';
import { googleAdsSettingsService } from '../attribution/googleAdsSettings.service.js';
import { calcomSettingsService } from '../bookings/calcomSettings.service.js';
import config from '../../config/config.js';

// =============================================================================
// META CLOUD API BRIDGE
// =============================================================================
// The 'meta_cloud' catalog entry is the ONE card in this module connected to
// a genuinely real, already-working system (WhatsApp Settings' real Meta
// Graph API integration) rather than this module's own simulated config.
// Every other one of the 22 cards keeps the original simulated behavior
// untouched -- this bridge exists ONLY for meta_cloud.

const META_CLOUD_KEY = 'meta_cloud';
const DIALOG360_KEY = '360dialog';
const META_ADS_KEY = 'meta_ads';
const GOOGLE_ADS_KEY = 'google_ads';
const GOOGLE_ADS_CAMPAIGNS_KEY = 'google_ads_campaigns';
const CALCOM_KEY = 'calcom';
const SENDGRID_KEY = 'sendgrid';
const TWILIO_WA_KEY = 'twilio_wa';
const INTERAKT_KEY = 'interakt';

/** Builds a ctx shape matching what whatsappSettingsService expects, from this module's (tenantId, userId) pair. */
const toWaCtx = (tenantId, userId) => ({ tenantId, userId });

/**
 * overlayRealWhatsAppStatus -- given a raw Integration doc for meta_cloud,
 * 360dialog, twilio_wa, or interakt, replaces its status/last_sync/config
 * with REAL data derived from WhatsAppSettings, so these four cards
 * always reflect the tenant's actual, already-working WhatsApp connection
 * instead of their own separate (otherwise-unused) simulated fields.
 * Returns the doc unchanged for any of the other 18 cards.
 */
const overlayRealWhatsAppStatus = async (tenantId, userId, doc) => {
  if (!doc || (doc.key !== META_CLOUD_KEY && doc.key !== DIALOG360_KEY && doc.key !== TWILIO_WA_KEY && doc.key !== INTERAKT_KEY)) return doc;

  const settings = await whatsappSettingsService.getSettings(toWaCtx(tenantId, userId));
  const overlaid = doc.toObject ? doc.toObject() : { ...doc };

  if (doc.key === META_CLOUD_KEY) {
    const isLive = settings.provider === 'META_CLOUD' && settings.providerMode === 'LIVE';
    overlaid.status = isLive ? INTEGRATION_STATUS.CONNECTED : INTEGRATION_STATUS.DISCONNECTED;
    overlaid.last_sync = settings.meta?.lastVerifiedAt || null;
    overlaid.config = {
      phoneNumberId: settings.meta?.phoneNumberId || '',
      businessAccountId: settings.meta?.businessAccountId || '',
      hasAccessToken: settings.meta?.hasAccessToken || false,
      hasAppSecret: settings.meta?.hasAppSecret || false,
      displayPhoneNumber: settings.meta?.displayPhoneNumber || '',
      verifiedName: settings.meta?.verifiedName || '',
    };
  } else if (doc.key === DIALOG360_KEY) {
    const isLive = settings.provider === '360DIALOG' && settings.providerMode === 'LIVE';
    overlaid.status = isLive ? INTEGRATION_STATUS.CONNECTED : INTEGRATION_STATUS.DISCONNECTED;
    overlaid.last_sync = settings.dialog360?.lastVerifiedAt || null;
    overlaid.config = {
      hasApiKey: settings.dialog360?.hasApiKey || false,
      about: settings.dialog360?.about || '',
    };
  } else if (doc.key === TWILIO_WA_KEY) {
    const isLive = settings.provider === 'TWILIO' && settings.providerMode === 'LIVE';
    overlaid.status = isLive ? INTEGRATION_STATUS.CONNECTED : INTEGRATION_STATUS.DISCONNECTED;
    overlaid.last_sync = settings.twilio?.lastVerifiedAt || null;
    overlaid.config = {
      whatsappNumber: settings.twilio?.whatsappNumber || '',
      hasAuthToken: settings.twilio?.hasAuthToken || false,
      friendlyName: settings.twilio?.friendlyName || '',
    };
  } else {
    const isLive = settings.provider === 'INTERAKT' && settings.providerMode === 'LIVE';
    overlaid.status = isLive ? INTEGRATION_STATUS.CONNECTED : INTEGRATION_STATUS.DISCONNECTED;
    overlaid.last_sync = settings.interakt?.lastVerifiedAt || null;
    overlaid.config = {
      hasApiKey: settings.interakt?.hasApiKey || false,
    };
  }
  return overlaid;
};

/**
 * overlayRealAdTrackingStatus -- same real-status-overlay pattern as
 * overlayRealWhatsAppStatus above, for the meta_ads and google_ads cards.
 * Returns the doc unchanged for any of the other 20 cards.
 */
/**
 * overlayRealPlatformStatus -- for integrations that are genuinely
 * platform-level, not per-tenant (currently: SendGrid, used for every
 * workspace's password resets/invites/verification emails from one
 * shared account -- see src/config/config.js). No database lookup
 * needed here, unlike every per-tenant integration below -- this is
 * real, live server configuration, the same thing config.js's own
 * startup warning already checks.
 */
const overlayRealPlatformStatus = (doc) => {
  if (!doc || doc.key !== SENDGRID_KEY) return doc;

  const overlaid = doc.toObject ? doc.toObject() : { ...doc };
  overlaid.status = config.SENDGRID_API_KEY ? INTEGRATION_STATUS.CONNECTED : INTEGRATION_STATUS.DISCONNECTED;
  overlaid.config = {
    platformLevel: true,
    fromAddress: config.EMAIL_FROM_ADDRESS || '',
    fromName: config.EMAIL_FROM_NAME || '',
    hasApiKey: !!config.SENDGRID_API_KEY,
  };
  return overlaid;
};

const overlayRealAdTrackingStatus = async (tenantId, userId, doc) => {
  if (!doc || (doc.key !== META_ADS_KEY && doc.key !== GOOGLE_ADS_KEY && doc.key !== GOOGLE_ADS_CAMPAIGNS_KEY && doc.key !== CALCOM_KEY)) return doc;

  if (doc.key === CALCOM_KEY) {
    const settings = await calcomSettingsService.getSettings({ tenantId, userId });
    const overlaid = doc.toObject ? doc.toObject() : { ...doc };
    overlaid.status = settings.connected ? INTEGRATION_STATUS.CONNECTED : INTEGRATION_STATUS.DISCONNECTED;
    overlaid.last_sync = settings.lastSyncedAt || null;
    overlaid.config = {
      accountEmail: settings.accountEmail || '',
      accountUsername: settings.accountUsername || '',
      hasApiKey: settings.hasApiKey || false,
      hasWebhook: !!settings.webhookId,
      lastSyncError: settings.lastSyncError || null,
    };
    return overlaid;
  }

  if (doc.key === GOOGLE_ADS_CAMPAIGNS_KEY) {
    const settings = await googleAdsSettingsService.getSettings({ tenantId, userId });
    const overlaid = doc.toObject ? doc.toObject() : { ...doc };
    overlaid.status = settings.connected ? INTEGRATION_STATUS.CONNECTED : INTEGRATION_STATUS.DISCONNECTED;
    overlaid.last_sync = settings.lastSyncedAt || null;
    overlaid.config = {
      accountName: settings.accountName || '',
      clientCustomerId: settings.clientCustomerId || '',
      hasRefreshToken: settings.hasRefreshToken || false,
      lastSyncError: settings.lastSyncError || null,
    };
    return overlaid;
  }

  const settings = await adTrackingSettingsService.getSettings({ tenantId, userId });
  const overlaid = doc.toObject ? doc.toObject() : { ...doc };

  if (doc.key === META_ADS_KEY) {
    overlaid.status = settings.meta?.connected ? INTEGRATION_STATUS.CONNECTED : INTEGRATION_STATUS.DISCONNECTED;
    overlaid.last_sync = settings.meta?.lastEventSentAt || settings.meta?.lastVerifiedAt || null;
    overlaid.config = {
      pixelId: settings.meta?.pixelId || '',
      hasAccessToken: settings.meta?.hasAccessToken || false,
      testEventCode: settings.meta?.testEventCode || '',
      eventsSent: settings.meta?.eventsSent || 0,
      eventsFailed: settings.meta?.eventsFailed || 0,
    };
  } else if (doc.key === GOOGLE_ADS_KEY) {
    overlaid.status = settings.google?.connected ? INTEGRATION_STATUS.CONNECTED : INTEGRATION_STATUS.DISCONNECTED;
    overlaid.last_sync = settings.google?.lastEventSentAt || settings.google?.lastVerifiedAt || null;
    overlaid.config = {
      measurementId: settings.google?.measurementId || '',
      hasApiSecret: settings.google?.hasApiSecret || false,
      eventsSent: settings.google?.eventsSent || 0,
      eventsFailed: settings.google?.eventsFailed || 0,
    };
  }
  return overlaid;
};

// =============================================================================
// PRIVATE HELPERS
// =============================================================================

/** True if the config object has at least one non-empty value. */
const hasRealConfig = (config) => {
  if (!config || typeof config !== 'object') return false;
  return Object.values(config).some((v) => v !== undefined && v !== null && v !== '');
};

// =============================================================================
// READ (auto-seeds the catalog first)
// =============================================================================

export const listIntegrations = async (tenantId, filter, options, userId) => {
  await integrationRepo.ensureCatalogSeeded(tenantId);

  const { page, limit, skip } = normalizePaging(options || {});
  const [integrations, total] = await Promise.all([
    integrationRepo.list(tenantId, filter, { skip, limit }),
    integrationRepo.count(tenantId, filter),
  ]);

  const overlaid = await Promise.all(
    integrations.map(async (doc) => {
      const withWhatsApp = await overlayRealWhatsAppStatus(tenantId, userId, doc);
      const withAdTracking = await overlayRealAdTrackingStatus(tenantId, userId, withWhatsApp);
      return overlayRealPlatformStatus(withAdTracking);
    }),
  );

  return { integrations: overlaid, pagination: paginationMeta({ page, limit, total }) };
};

export const getIntegration = async (tenantId, id, userId) => {
  await integrationRepo.ensureCatalogSeeded(tenantId);
  const integration = await integrationRepo.findById(tenantId, id);
  if (!integration) throw AppError.notFound('Integration not found');
  const withWhatsApp = await overlayRealWhatsAppStatus(tenantId, userId, integration);
  const withAdTracking = await overlayRealAdTrackingStatus(tenantId, userId, withWhatsApp);
  return overlayRealPlatformStatus(withAdTracking);
};

export const getCategoryCounts = async (tenantId, filter) => {
  await integrationRepo.ensureCatalogSeeded(tenantId);
  const rows = await integrationRepo.countByCategory(tenantId, filter);

  const byCategory = {};
  let total = 0;
  let totalConnected = 0;
  for (const row of rows) {
    byCategory[row.category] = { count: row.count, connected: row.connected };
    total += row.count;
    totalConnected += row.connected;
  }
  return { total, totalConnected, byCategory };
};

export const getErrorLogs = async (tenantId, id) => {
  const integration = await integrationRepo.findById(tenantId, id);
  if (!integration) throw AppError.notFound('Integration not found');
  return { error_logs: integration.error_logs };
};

// =============================================================================
// TOGGLE — connect/disconnect
// =============================================================================

export const toggleIntegration = async (tenantId, userId, id) => {
  const existing = await integrationRepo.findById(tenantId, id);
  if (!existing) throw AppError.notFound('Integration not found');

  if (existing.key === META_CLOUD_KEY) {
    const settings = await whatsappSettingsService.getSettings(toWaCtx(tenantId, userId));
    const isLive = settings.provider === 'META_CLOUD' && settings.providerMode === 'LIVE';

    if (isLive) {
      // Real disconnect -- same action as the Disconnect button in WhatsApp Settings itself.
      await whatsappSettingsService.updateSection(toWaCtx(tenantId, userId), 'provider', {
        provider: 'SIMULATION',
        providerMode: 'SIMULATION',
      });
    } else {
      throw AppError.badRequest(
        'Enter your real Meta Cloud API credentials in Settings first — this card cannot be connected with a single click, since it requires a genuine, verified connection.',
      );
    }
    return overlayRealWhatsAppStatus(tenantId, userId, existing);
  }

  if (existing.key === DIALOG360_KEY) {
    const settings = await whatsappSettingsService.getSettings(toWaCtx(tenantId, userId));
    const isLive = settings.provider === '360DIALOG' && settings.providerMode === 'LIVE';

    if (isLive) {
      await whatsappSettingsService.updateSection(toWaCtx(tenantId, userId), 'provider', {
        provider: 'SIMULATION',
        providerMode: 'SIMULATION',
      });
    } else {
      throw AppError.badRequest(
        'Enter your real 360Dialog API key in Settings first — this card cannot be connected with a single click, since it requires a genuine, verified connection.',
      );
    }
    return overlayRealWhatsAppStatus(tenantId, userId, existing);
  }

  if (existing.key === TWILIO_WA_KEY) {
    const settings = await whatsappSettingsService.getSettings(toWaCtx(tenantId, userId));
    const isLive = settings.provider === 'TWILIO' && settings.providerMode === 'LIVE';

    if (isLive) {
      await whatsappSettingsService.updateSection(toWaCtx(tenantId, userId), 'provider', {
        provider: 'SIMULATION',
        providerMode: 'SIMULATION',
      });
    } else {
      throw AppError.badRequest(
        'Enter your real Twilio credentials in Settings first — this card cannot be connected with a single click, since it requires a genuine, verified connection.',
      );
    }
    return overlayRealWhatsAppStatus(tenantId, userId, existing);
  }

  if (existing.key === INTERAKT_KEY) {
    const settings = await whatsappSettingsService.getSettings(toWaCtx(tenantId, userId));
    const isLive = settings.provider === 'INTERAKT' && settings.providerMode === 'LIVE';

    if (isLive) {
      await whatsappSettingsService.updateSection(toWaCtx(tenantId, userId), 'provider', {
        provider: 'SIMULATION',
        providerMode: 'SIMULATION',
      });
    } else {
      throw AppError.badRequest(
        'Enter your real Interakt API key in Settings first — this card cannot be connected with a single click, since it requires a genuine, verified connection.',
      );
    }
    return overlayRealWhatsAppStatus(tenantId, userId, existing);
  }

  if (existing.key === META_ADS_KEY) {
    const settings = await adTrackingSettingsService.getSettings({ tenantId, userId });
    if (settings.meta?.connected) {
      await adTrackingSettingsService.disconnectMeta({ tenantId, userId });
    } else {
      throw AppError.badRequest(
        'Enter your real Meta Pixel ID and Access Token first — this card cannot be connected with a single click, since it requires a genuine, verified connection.',
      );
    }
    return overlayRealAdTrackingStatus(tenantId, userId, existing);
  }

  if (existing.key === GOOGLE_ADS_KEY) {
    const settings = await adTrackingSettingsService.getSettings({ tenantId, userId });
    if (settings.google?.connected) {
      await adTrackingSettingsService.disconnectGoogle({ tenantId, userId });
    } else {
      throw AppError.badRequest(
        'Enter your real GA4 Measurement ID and API Secret first — this card cannot be connected with a single click, since it requires a genuine, verified connection.',
      );
    }
    return overlayRealAdTrackingStatus(tenantId, userId, existing);
  }

  if (existing.key === SENDGRID_KEY) {
    throw AppError.badRequest(
      'SendGrid is configured at the platform level by your system administrator (via a server environment variable), not per workspace — there\u2019s nothing to connect or disconnect here. This card just shows whether it\u2019s genuinely set up.',
    );
  }

  if (existing.key === CALCOM_KEY) {
    const settings = await calcomSettingsService.getSettings({ tenantId, userId });
    if (settings.connected) {
      await calcomSettingsService.disconnect({ tenantId, userId });
    } else {
      throw AppError.badRequest('Enter your real Cal.com API key first — this card cannot be connected with a single click.');
    }
    return overlayRealAdTrackingStatus(tenantId, userId, existing);
  }

  if (existing.key === GOOGLE_ADS_CAMPAIGNS_KEY) {
    const settings = await googleAdsSettingsService.getSettings({ tenantId, userId });
    if (settings.connected) {
      await googleAdsSettingsService.disconnect({ tenantId, userId });
    } else {
      throw AppError.badRequest(
        'Connect your real Google Ads account first — this uses Google\u2019s real OAuth consent flow, not a single click, since it requires you to explicitly authorize access with your own Google account.',
      );
    }
    return overlayRealAdTrackingStatus(tenantId, userId, existing);
  }

  let newStatus;
  if (existing.status === INTEGRATION_STATUS.DISCONNECTED) {
    if (!existing.available) {
      throw AppError.badRequest('This integration is coming soon and cannot be connected yet');
    }
    newStatus = hasRealConfig(existing.config)
      ? INTEGRATION_STATUS.CONNECTED
      : INTEGRATION_STATUS.SIMULATION;
  } else {
    newStatus = INTEGRATION_STATUS.DISCONNECTED;
  }

  return integrationRepo.update(tenantId, id, {
    status: newStatus,
    last_sync: new Date(),
    updated_by: userId,
  });
};

// =============================================================================
// SYNC — "updates last-sync"
// =============================================================================

export const syncIntegration = async (tenantId, userId, id) => {
  const existing = await integrationRepo.findById(tenantId, id);
  if (!existing) throw AppError.notFound('Integration not found');

  if (existing.key === META_CLOUD_KEY) {
    // Real verification -- an actual live call to Meta's Graph API.
    // Throws a real AppError with Meta's real rejection message if the
    // credentials are genuinely invalid; never silently "succeeds".
    await whatsappSettingsService.testConnection(toWaCtx(tenantId, userId));
    return overlayRealWhatsAppStatus(tenantId, userId, existing);
  }

  if (existing.key === DIALOG360_KEY) {
    // Real verification -- an actual live call to 360Dialog's API.
    await whatsappSettingsService.testConnection(toWaCtx(tenantId, userId));
    return overlayRealWhatsAppStatus(tenantId, userId, existing);
  }

  if (existing.key === TWILIO_WA_KEY) {
    // Real verification -- an actual live call to Twilio's Account API.
    await whatsappSettingsService.testConnection(toWaCtx(tenantId, userId));
    return overlayRealWhatsAppStatus(tenantId, userId, existing);
  }

  if (existing.key === INTERAKT_KEY) {
    // Real verification -- an actual live call to Interakt's Users API.
    await whatsappSettingsService.testConnection(toWaCtx(tenantId, userId));
    return overlayRealWhatsAppStatus(tenantId, userId, existing);
  }

  if (existing.key === CALCOM_KEY) {
    // Real Cal.com booking pull -- see calcomSettings.service.js's
    // syncBookings for the actual API calls and Booking upserts.
    const result = await calcomSettingsService.syncBookings({ tenantId, userId });
    const overlaid = await overlayRealAdTrackingStatus(tenantId, userId, existing);
    return { ...overlaid, _syncResult: result };
  }

  if (existing.key === GOOGLE_ADS_CAMPAIGNS_KEY) {
    // Real GAQL pull -- see googleAdsSettings.service.js's syncCampaigns
    // for the actual API call and campaign-metric storage.
    const result = await googleAdsSettingsService.syncCampaigns({ tenantId, userId });
    const overlaid = await overlayRealAdTrackingStatus(tenantId, userId, existing);
    return { ...overlaid, _syncResult: result };
  }

  if (existing.status === INTEGRATION_STATUS.DISCONNECTED) {
    throw AppError.badRequest('Cannot sync a disconnected integration');
  }

  return integrationRepo.update(tenantId, id, {
    last_sync: new Date(),
    updated_by: userId,
  });
};

// =============================================================================
// CONFIG — "settings modal"
// =============================================================================

export const updateIntegrationConfig = async (tenantId, userId, id, configPatch) => {
  const existing = await integrationRepo.findById(tenantId, id);
  if (!existing) throw AppError.notFound('Integration not found');

  if (existing.key === META_CLOUD_KEY) {
    const { phoneNumberId, businessAccountId, accessToken, appSecret } = configPatch || {};
    const meta = {};
    if (phoneNumberId !== undefined) meta.phoneNumberId = phoneNumberId;
    if (businessAccountId !== undefined) meta.businessAccountId = businessAccountId;
    if (accessToken) meta.accessToken = accessToken; // only overwrite if a new value was actually typed
    if (appSecret) meta.appSecret = appSecret;

    await whatsappSettingsService.updateSection(toWaCtx(tenantId, userId), 'provider', {
      provider: 'META_CLOUD',
      meta,
    });

    // Real verification, immediately -- this is what actually marks the
    // card "connected", not the save above. Throws a real Meta error if
    // the credentials are wrong; the card stays disconnected in that case.
    await whatsappSettingsService.testConnection(toWaCtx(tenantId, userId));

    return overlayRealWhatsAppStatus(tenantId, userId, existing);
  }

  if (existing.key === DIALOG360_KEY) {
    const { apiKey } = configPatch || {};
    const dialog360 = {};
    if (apiKey) dialog360.apiKey = apiKey; // only overwrite if a new value was actually typed

    await whatsappSettingsService.updateSection(toWaCtx(tenantId, userId), 'provider', {
      provider: '360DIALOG',
      dialog360,
    });

    // Real verification, immediately -- this is what actually marks the
    // card "connected", not the save above. Throws a real 360Dialog error
    // if the key is wrong; the card stays disconnected in that case.
    await whatsappSettingsService.testConnection(toWaCtx(tenantId, userId));

    return overlayRealWhatsAppStatus(tenantId, userId, existing);
  }

  if (existing.key === TWILIO_WA_KEY) {
    const { accountSid, authToken, whatsappNumber } = configPatch || {};
    const twilio = {};
    if (accountSid !== undefined) twilio.accountSid = accountSid;
    if (authToken) twilio.authToken = authToken; // only overwrite if a new value was actually typed
    if (whatsappNumber !== undefined) twilio.whatsappNumber = whatsappNumber;

    await whatsappSettingsService.updateSection(toWaCtx(tenantId, userId), 'provider', {
      provider: 'TWILIO',
      twilio,
    });

    // Real verification, immediately -- this is what actually marks the
    // card "connected", not the save above. Throws a real Twilio error if
    // the credentials are wrong; the card stays disconnected in that case.
    await whatsappSettingsService.testConnection(toWaCtx(tenantId, userId));

    return overlayRealWhatsAppStatus(tenantId, userId, existing);
  }

  if (existing.key === INTERAKT_KEY) {
    const { apiKey } = configPatch || {};
    const interakt = {};
    if (apiKey) interakt.apiKey = apiKey; // only overwrite if a new value was actually typed

    await whatsappSettingsService.updateSection(toWaCtx(tenantId, userId), 'provider', {
      provider: 'INTERAKT',
      interakt,
    });

    // Real verification, immediately -- this is what actually marks the
    // card "connected", not the save above. Throws a real Interakt error
    // if the key is wrong; the card stays disconnected in that case.
    await whatsappSettingsService.testConnection(toWaCtx(tenantId, userId));

    return overlayRealWhatsAppStatus(tenantId, userId, existing);
  }

  if (existing.key === META_ADS_KEY) {
    const { pixelId, accessToken, testEventCode } = configPatch || {};
    await adTrackingSettingsService.updateMetaConfig({ tenantId, userId }, { pixelId, accessToken, testEventCode });

    // Real verification, immediately -- this is what actually marks the
    // card "connected", not the save above. Throws a real Meta error if
    // the credentials are wrong; the card stays disconnected in that case.
    await adTrackingSettingsService.testMetaConnection({ tenantId, userId });

    return overlayRealAdTrackingStatus(tenantId, userId, existing);
  }

  if (existing.key === GOOGLE_ADS_KEY) {
    const { measurementId, apiSecret } = configPatch || {};
    await adTrackingSettingsService.updateGoogleConfig({ tenantId, userId }, { measurementId, apiSecret });

    // Real verification, immediately -- uses GA4's debug endpoint, the
    // only one that returns genuine validation feedback (see
    // googleAnalytics.provider.js). Throws a real error if invalid; the
    // card stays disconnected in that case.
    await adTrackingSettingsService.testGoogleConnection({ tenantId, userId });

    return overlayRealAdTrackingStatus(tenantId, userId, existing);
  }

  if (existing.key === CALCOM_KEY) {
    const { apiKey } = configPatch || {};
    // Real connect: saves + verifies live against Cal.com's own API,
    // then creates a real webhook subscription -- see
    // calcomSettings.service.js's connect().
    await calcomSettingsService.connect({ tenantId, userId }, { apiKey });
    return overlayRealAdTrackingStatus(tenantId, userId, existing);
  }

  if (existing.key === GOOGLE_ADS_CAMPAIGNS_KEY) {
    const { clientCustomerId } = configPatch || {};
    if (!clientCustomerId) {
      throw AppError.badRequest('clientCustomerId is required — complete Google authorization first to see your real account list.');
    }
    await googleAdsSettingsService.selectAccount({ tenantId, userId }, clientCustomerId);
    return overlayRealAdTrackingStatus(tenantId, userId, existing);
  }

  const mergedConfig = Object.assign({}, existing.config, configPatch || {});

  return integrationRepo.update(tenantId, id, {
    config: mergedConfig,
    updated_by: userId,
  });
};