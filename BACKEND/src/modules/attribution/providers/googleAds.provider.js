/**
 * =============================================================================
 * InnovateX Revenue OS — Google Ads API Provider
 * =============================================================================
 *
 * FILE: src/modules/attribution/providers/googleAds.provider.js
 *
 * Real Google Ads API access via its genuine REST interface (confirmed
 * this exists and works via curl/fetch -- not gRPC-only, matching this
 * codebase's established no-heavy-SDK pattern for every other provider).
 *
 * SOURCE: real Google Ads API docs (developers.google.com/google-ads/api):
 *   - OAuth2 token refresh: POST https://oauth2.googleapis.com/token
 *     (grant_type=refresh_token)
 *   - Reporting: POST https://googleads.googleapis.com/v{version}/customers/
 *     {customerId}/googleAds:search, body { query: "<GAQL>" }
 *   - Required headers: developer-token, login-customer-id (manager
 *     account), Authorization: Bearer {access_token}
 *   - cost_micros is real spend in millionths of the account's currency
 *     unit -- divided by 1,000,000 here to get a normal amount, not
 *     assumed casually; this is Google's own documented unit.
 * =============================================================================
 */

const API_VERSION = 'v19';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MICROS_PER_UNIT = 1_000_000;

export class GoogleAdsProvider {
  /**
   * @param {{
   *   developerToken: string, managerCustomerId: string,
   *   oauthClientId: string, oauthClientSecret: string,
   *   clientCustomerId: string,
   * }} config
   */
  constructor({ developerToken, managerCustomerId, oauthClientId, oauthClientSecret, clientCustomerId }) {
    if (!developerToken) throw new Error('GoogleAdsProvider requires developerToken');
    if (!clientCustomerId) throw new Error('GoogleAdsProvider requires clientCustomerId');
    this.developerToken = developerToken;
    this.managerCustomerId = managerCustomerId?.replace(/-/g, '');
    this.oauthClientId = oauthClientId;
    this.oauthClientSecret = oauthClientSecret;
    this.clientCustomerId = clientCustomerId.replace(/-/g, '');
  }

  /**
   * refreshAccessToken -- real OAuth2 token refresh. Returns a fresh
   * access token + its real expiry, so the caller can cache it and skip
   * refreshing on every single API call (access tokens last ~1 hour).
   */
  async refreshAccessToken(refreshToken) {
    let response;
    try {
      response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: this.oauthClientId,
          client_secret: this.oauthClientSecret,
          refresh_token: refreshToken,
        }),
      });
    } catch (networkError) {
      throw new Error(`Could not reach Google's OAuth token endpoint — ${networkError.message}`);
    }

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = json?.error_description || json?.error || `HTTP ${response.status}`;
      // A real, common cause worth surfacing plainly: the refresh token
      // was revoked (user removed access in their Google account) or
      // expired from long disuse.
      throw new Error(`Google rejected this refresh token — ${message}. The tenant may need to reconnect their Google Ads account.`);
    }

    return {
      accessToken: json.access_token,
      expiresInSeconds: json.expires_in,
    };
  }

  /**
   * listAccessibleCustomers -- real account discovery, used right after
   * OAuth connect so the UI can show which real Google Ads accounts this
   * login has access to, rather than asking the tenant to already know
   * their raw customer ID.
   */
  async listAccessibleCustomers(accessToken) {
    const url = `https://googleads.googleapis.com/${API_VERSION}/customers:listAccessibleCustomers`;
    const response = await fetch(url, {
      headers: {
        'developer-token': this.developerToken,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(this._describeError(json, response.status));
    }
    // Real response shape: { resourceNames: ["customers/1234567890", ...] }
    return (json.resourceNames || []).map((rn) => rn.split('/')[1]);
  }

  /**
   * getCampaignPerformance -- real GAQL reporting query. Returns
   * campaign-level spend/clicks/impressions/conversions for a real date
   * range. This is the core data this whole integration exists to pull.
   *
   * @param {{ accessToken: string, dateRange?: string }} params
   *   dateRange uses GAQL's own real DURING syntax (e.g. LAST_30_DAYS,
   *   LAST_7_DAYS) -- not a custom format invented here.
   */
  async getCampaignPerformance({ accessToken, dateRange = 'LAST_30_DAYS' }) {
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.average_cpc
      FROM campaign
      WHERE segments.date DURING ${dateRange}
        AND campaign.status != 'REMOVED'
    `.trim();

    const rows = await this._search({ accessToken, query });

    return rows.map((row) => ({
      campaignId: row.campaign?.id,
      campaignName: row.campaign?.name,
      status: row.campaign?.status,
      channelType: row.campaign?.advertisingChannelType,
      impressions: Number(row.metrics?.impressions || 0),
      clicks: Number(row.metrics?.clicks || 0),
      // Real Google Ads unit: cost_micros is millionths of the account's
      // currency -- converted to a normal amount here, not assumed.
      spend: Number(row.metrics?.costMicros || 0) / MICROS_PER_UNIT,
      conversions: Number(row.metrics?.conversions || 0),
      conversionsValue: Number(row.metrics?.conversionsValue || 0),
      ctr: Number(row.metrics?.ctr || 0),
      averageCpc: Number(row.metrics?.averageCpc || 0) / MICROS_PER_UNIT,
    }));
  }

  /** _search -- shared real GAQL search call, paginated via real page_token handling. */
  async _search({ accessToken, query }) {
    const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${this.clientCustomerId}/googleAds:search`;
    const allRows = [];
    let pageToken;

    do {
      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'developer-token': this.developerToken,
            ...(this.managerCustomerId ? { 'login-customer-id': this.managerCustomerId } : {}),
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ query, pageToken }),
        });
      } catch (networkError) {
        throw new Error(`Could not reach the Google Ads API — ${networkError.message}`);
      }

      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(this._describeError(json, response.status));
      }

      allRows.push(...(json.results || []));
      pageToken = json.nextPageToken;
    } while (pageToken);

    return allRows;
  }

  /** _describeError -- surfaces Google's real error detail, not a generic HTTP status. */
  _describeError(json, status) {
    const detail = json?.error?.message || json?.error?.details?.[0]?.errors?.[0]?.message;
    return detail ? `Google Ads API error — ${detail}` : `Google Ads API error — HTTP ${status}`;
  }
}