/**
 * =============================================================================
 * InnovateX Revenue OS — Zoho CRM Settings Service
 * =============================================================================
 * FILE: src/modules/integrations/zoho/zohoSettings.service.js
 * Real OAuth2 token lifecycle + one-way Leads pull. Mirrors
 * googleAdsSettings.service.js's object-of-async-methods pattern, and
 * reuses shopifySettings.service.js's real email-then-phone dedup logic.
 * =============================================================================
 */

import ZohoSettings from './zohoSettings.model.js';
import { Lead } from '../../leads/lead/lead.model.js';
import { encrypt, safeDecrypt, signState } from '../../../utils/crypto.js';
import config from '../../../config/config.js';
import { AppError } from '../../../shared/helpers/lead.helpers.js';

const REQUIRE_PLATFORM_CONFIG = () => {
  if (!config.ZOHO_CLIENT_ID || !config.ZOHO_CLIENT_SECRET) {
    throw AppError.badRequest(
      'Zoho CRM is not configured on this server yet. An administrator needs to set ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET.'
    );
  }
};

const ZOHO_SCOPES = 'ZohoCRM.modules.leads.READ,ZohoCRM.settings.fields.READ';

const getOrCreate = async (tenantId) => {
  let doc = await ZohoSettings.findOne({ tenantId });
  if (!doc) doc = await ZohoSettings.create({ tenantId });
  return doc;
};

const getValidAccessToken = async (doc) => {
  const now = Date.now();
  const bufferMs = 2 * 60 * 1000;

  if (doc.accessToken && doc.accessTokenExpiresAt && doc.accessTokenExpiresAt.getTime() - bufferMs > now) {
    return safeDecrypt(doc.accessToken);
  }
  if (!doc.refreshToken) {
    throw AppError.badRequest('No Zoho CRM account connected for this workspace.');
  }

  let response;
  try {
    response = await fetch(`${config.ZOHO_ACCOUNTS_DOMAIN}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: safeDecrypt(doc.refreshToken),
        client_id: config.ZOHO_CLIENT_ID,
        client_secret: config.ZOHO_CLIENT_SECRET,
        grant_type: 'refresh_token',
      }),
    });
  } catch (networkError) {
    throw new Error(`Could not reach Zoho's OAuth token endpoint — ${networkError.message}`);
  }

  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    throw new Error(`Zoho rejected the refresh request — ${json?.error || `HTTP ${response.status}`}`);
  }

  doc.accessToken = encrypt(json.access_token);
  doc.accessTokenExpiresAt = new Date(now + (json.expires_in || 3600) * 1000);
  await doc.save();

  return json.access_token;
};

const findOrCreateLeadFromZoho = async (tenantId, zohoLead) => {
  const email = zohoLead.Email?.toLowerCase().trim() || null;
  const phone = (zohoLead.Phone || zohoLead.Mobile || '').replace(/\D/g, '') || null;
  if (!email && !phone) return null;

  const name = [zohoLead.First_Name, zohoLead.Last_Name].filter(Boolean).join(' ').trim()
    || zohoLead.Full_Name || email || phone;

  let lead = email
    ? await Lead.findOne({ tenant_id: String(tenantId), email, archived: false })
    : null;
  if (!lead && phone) {
    lead = await Lead.findOne({ tenant_id: String(tenantId), phone, archived: false });
  }

  if (lead) {
    let changed = false;
    if (!lead.company && zohoLead.Company) { lead.company = zohoLead.Company; changed = true; }
    if (!lead.phone && phone) { lead.phone = phone; changed = true; }
    if (!lead.email && email) { lead.email = email; changed = true; }
    if (changed) await lead.save();
    return { lead, created: false };
  }

  const created = await Lead.create({
    tenant_id: String(tenantId),
    name,
    email,
    phone,
    company: zohoLead.Company || '',
    source: 'Zoho CRM',
    status: 'New',
  });
  return { lead: created, created: true };
};

export const zohoSettingsService = {
  async getSettings(ctx) {
    const doc = await getOrCreate(ctx.tenantId);
    return doc.toJSON();
  },

  buildAuthorizationUrl(ctx) {
    REQUIRE_PLATFORM_CONFIG();
    const params = new URLSearchParams({
      client_id: config.ZOHO_CLIENT_ID,
      redirect_uri: config.ZOHO_OAUTH_REDIRECT_URI,
      response_type: 'code',
      scope: ZOHO_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state: signState(String(ctx.tenantId)),
    });
    return `${config.ZOHO_ACCOUNTS_DOMAIN}/oauth/v2/auth?${params.toString()}`;
  },

  async completeAuthorization({ tenantId, userId, code }) {
    REQUIRE_PLATFORM_CONFIG();

    let response;
    try {
      response = await fetch(`${config.ZOHO_ACCOUNTS_DOMAIN}/oauth/v2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.ZOHO_CLIENT_ID,
          client_secret: config.ZOHO_CLIENT_SECRET,
          redirect_uri: config.ZOHO_OAUTH_REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
      });
    } catch (networkError) {
      throw new Error(`Could not reach Zoho's OAuth token endpoint — ${networkError.message}`);
    }

    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.error) {
      throw new Error(`Zoho rejected this authorization code — ${json?.error || `HTTP ${response.status}`}`);
    }
    if (!json.refresh_token) {
      throw new Error('Zoho did not return a refresh token. Revoke this app\u2019s access from your Zoho account\u2019s connected-apps settings and try connecting again.');
    }
    if (!json.api_domain) {
      throw new Error('Zoho did not return an API domain for this account.');
    }

    const doc = await getOrCreate(tenantId);
    doc.refreshToken = encrypt(json.refresh_token);
    doc.accessToken = encrypt(json.access_token);
    doc.accessTokenExpiresAt = new Date(Date.now() + (json.expires_in || 3600) * 1000);
    doc.apiDomain = json.api_domain;
    doc.connected = true;
    doc.connectedAt = doc.connectedAt || new Date();
    doc.updatedBy = userId;

    try {
      const orgResponse = await fetch(`${json.api_domain}/crm/v2/org`, {
        headers: { Authorization: `Zoho-oauthtoken ${json.access_token}` },
      });
      const orgJson = await orgResponse.json().catch(() => ({}));
      doc.orgName = orgJson?.org?.[0]?.company_name || '';
    } catch {
      // Non-fatal.
    }

    await doc.save();
    return doc.toJSON();
  },

  async disconnect(ctx) {
    const doc = await getOrCreate(ctx.tenantId);
    doc.connected = false;
    doc.refreshToken = null;
    doc.accessToken = null;
    doc.accessTokenExpiresAt = null;
    doc.updatedBy = ctx.userId;
    await doc.save();
    return doc.toJSON();
  },

  async syncLeads(ctx) {
    const doc = await getOrCreate(ctx.tenantId);
    if (!doc.connected || !doc.apiDomain) {
      throw AppError.badRequest('Connect a Zoho CRM account before syncing.');
    }

    try {
      const accessToken = await getValidAccessToken(doc);
      let page = 1;
      let imported = 0;
      let matched = 0;
      let hasMore = true;

      while (hasMore) {
        const response = await fetch(
          `${doc.apiDomain}/crm/v2/Leads?fields=First_Name,Last_Name,Full_Name,Email,Phone,Mobile,Company&page=${page}&per_page=200`,
          { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } },
        );

        if (response.status === 204) break;

        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(`Zoho rejected the Leads request — ${json?.message || `HTTP ${response.status}`}`);
        }

        const records = Array.isArray(json.data) ? json.data : [];
        for (const zohoLead of records) {
          const result = await findOrCreateLeadFromZoho(ctx.tenantId, zohoLead);
          if (result?.created) imported += 1;
          else if (result) matched += 1;
        }

        hasMore = Boolean(json.info?.more_records);
        page += 1;
        if (page > 100) break;
      }

      doc.lastSyncedAt = new Date();
      doc.lastSyncError = null;
      doc.lastSyncLeadCount = imported;
      await doc.save();

      return { synced: true, imported, matched };
    } catch (err) {
      doc.lastSyncError = err.message;
      await doc.save().catch(() => {});
      throw err;
    }
  },
};
