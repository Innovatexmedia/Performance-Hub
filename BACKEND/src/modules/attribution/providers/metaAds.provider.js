/**
 * =============================================================================
 * InnovateX Revenue OS — Meta Ads API Provider
 * =============================================================================
 *
 * FILE: src/modules/attribution/providers/metaAds.provider.js
 *
 * Real Meta Marketing API access via its genuine REST/Graph interface,
 * mirroring googleAds.provider.js's structure and error-handling
 * approach throughout. Genuinely separate from
 * providers/metaConversions.provider.js (Conversions API -- a
 * server-to-server event PUSH, different Meta product, different OAuth
 * scopes, no ad-account-level reporting at all).
 *
 * SOURCE: real Meta Marketing API docs (developers.facebook.com), confirmed
 * current as of this integration:
 *   - OAuth2 dialog: GET https://www.facebook.com/v{version}/dialog/oauth
 *   - Token exchange: GET https://graph.facebook.com/v{version}/oauth/access_token
 *   - Long-lived token exchange: same token endpoint,
 *     grant_type=fb_exchange_token -- Meta's real model has NO refresh_token
 *     grant the way Google does; a short-lived user token (from the OAuth
 *     callback) is exchanged ONCE for a long-lived token (~60 days), and
 *     that long-lived token is itself re-exchanged for a fresh one before
 *     its own expiry -- there is no separate refresh credential to store.
 *   - Ad account discovery: GET /me/adaccounts
 *   - Campaign insights: GET /act_{ad_account_id}/insights?level=campaign
 *     -- real, documented fields: campaign_id, campaign_name, impressions,
 *     clicks, spend, ctr, cpc, actions, action_values. Meta returns
 *     numeric fields AS STRINGS (confirmed in Meta's own example
 *     responses), converted here, not assumed.
 *   - Conversions have NO single flat field the way Google's
 *     metrics.conversions does -- Meta returns an `actions` array of
 *     { action_type, value } pairs (one entry per distinct action type
 *     Meta tracked), summed here across all entries to get a total
 *     conversion count, matching action_values the same way for revenue.
 *   - Required scopes: ads_management, ads_read, read_insights,
 *     business_management (per Meta's own Marketing API getting-started
 *     docs).
 * =============================================================================
 */

const API_VERSION = 'v25.0';
const GRAPH_BASE = `https://graph.facebook.com/${API_VERSION}`;

/**
 * DATE_RANGE_MAP -- this app's own normalized dateRange values (shared
 * with GoogleAdsCampaignMetric's dateRange field, e.g. "LAST_30_DAYS")
 * mapped to Meta's real `date_preset` values. Kept as the single place
 * this translation happens, so MetaAdsCampaignMetric documents store
 * the SAME normalized string GoogleAdsCampaignMetric does -- letting the
 * Attribution dashboard merge both collections on dateRange without a
 * provider-specific branch.
 */
const DATE_RANGE_MAP = {
  LAST_7_DAYS:  'last_7d',
  LAST_30_DAYS: 'last_30d',
  LAST_90_DAYS: 'last_90d',
  THIS_MONTH:   'this_month',
  LAST_MONTH:   'last_month',
};

export class MetaAdsProvider {
  /**
   * @param {{ appId: string, appSecret: string, adAccountId?: string }} config
   */
  constructor({ appId, appSecret, adAccountId }) {
    if (!appId) throw new Error('MetaAdsProvider requires appId');
    if (!appSecret) throw new Error('MetaAdsProvider requires appSecret');
    this.appId = appId;
    this.appSecret = appSecret;
    this.adAccountId = (adAccountId || '').replace(/^act_/, ''); // stored without the "act_" prefix, same no-decoration convention as clientCustomerId
  }

  /**
   * exchangeCodeForToken -- real OAuth2 code exchange, the direct
   * analog of googleAds.provider's refresh step but only ever called
   * ONCE, right after the OAuth callback (see metaAdsSettings.service.js's
   * completeAuthorization) -- there is no repeatable "refresh" call using
   * this method; renewLongLivedToken below is what runs on every
   * subsequent app boot/sync.
   */
  async exchangeCodeForToken({ code, redirectUri }) {
    const params = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      redirect_uri: redirectUri,
      code,
    });

    let response;
    try {
      response = await fetch(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
    } catch (networkError) {
      throw new Error(`Could not reach Meta's OAuth token endpoint — ${networkError.message}`);
    }

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Meta rejected this authorization code — ${json?.error?.message || `HTTP ${response.status}`}`);
    }

    // Real short-lived token here -- exchangeForLongLivedToken below is
    // what actually gets stored; this one alone is only good for ~1-2 hours.
    return { shortLivedToken: json.access_token };
  }

  /**
   * exchangeForLongLivedToken -- real Meta long-lived token exchange.
   * Called both right after exchangeCodeForToken (to get the token that
   * actually gets stored) AND on every later renewal before the stored
   * token's own ~60-day expiry -- the exact real mechanism Meta
   * documents in place of a refresh_token grant.
   */
  async exchangeForLongLivedToken(shortLivedToken) {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.appId,
      client_secret: this.appSecret,
      fb_exchange_token: shortLivedToken,
    });

    let response;
    try {
      response = await fetch(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
    } catch (networkError) {
      throw new Error(`Could not reach Meta's OAuth token endpoint — ${networkError.message}`);
    }

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = json?.error?.message || `HTTP ${response.status}`;
      throw new Error(`Meta rejected this token exchange — ${message}. The tenant may need to reconnect their Meta Ads account.`);
    }

    return {
      accessToken: json.access_token,
      // Meta's real default: 60 days if not otherwise specified --
      // expires_in IS present in the real response, used directly
      // rather than assuming the 60-day default ourselves.
      expiresInSeconds: json.expires_in || 60 * 24 * 60 * 60,
    };
  }

  /**
   * listAdAccounts -- real account discovery, direct analog of
   * listAccessibleCustomers, used right after OAuth connect so the UI
   * can show which real Meta ad accounts this login has access to.
   */
  async listAdAccounts(accessToken) {
    const url = `${GRAPH_BASE}/me/adaccounts?fields=account_id,name,account_status&access_token=${accessToken}`;
    let response;
    try {
      response = await fetch(url);
    } catch (networkError) {
      throw new Error(`Could not reach Meta's Graph API — ${networkError.message}`);
    }
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(this._describeError(json, response.status));
    }
    // Real response shape: { data: [{ id: "act_123", account_id: "123", name, account_status }] }
    return (json.data || []).map((a) => ({
      adAccountId: a.account_id,
      accountName: a.name || a.account_id,
    }));
  }

  /**
   * getCampaignPerformance -- real Ads Insights API pull at the campaign
   * level for the whole ad account in one call (level=campaign), the
   * direct analog of getCampaignPerformance's GAQL query. Returns the
   * SAME shape googleAds.provider.js's getCampaignPerformance does, so
   * metaAdsSettings.service.js's syncCampaigns can write to
   * MetaAdsCampaignMetric with identical field names to
   * GoogleAdsCampaignMetric.
   *
   * @param {{ accessToken: string, dateRange?: string }} params
   */
  async getCampaignPerformance({ accessToken, dateRange = 'LAST_30_DAYS' }) {
    if (!this.adAccountId) throw new Error('MetaAdsProvider requires an ad account to be selected before syncing.');

    const datePreset = DATE_RANGE_MAP[dateRange] || 'last_30d';
    const fields = [
      'campaign_id', 'campaign_name', 'impressions', 'clicks', 'spend',
      'ctr', 'cpc', 'actions', 'action_values',
    ].join(',');

    const rows = await this._getInsightsPaginated({ accessToken, datePreset, fields });

    return rows.map((row) => ({
      campaignId:   row.campaign_id,
      campaignName: row.campaign_name,
      // Real Insights API responses don't include campaign.status at
      // this edge -- Meta's own docs route status through the separate
      // /act_{id}/campaigns object read, not Insights. Left null rather
      // than invented; the dashboard already renders '—' for a null
      // status (same real fallback GoogleAdsCampaignMetric's own
      // ENABLED/PAUSED/REMOVED values get when absent).
      status:       null,
      channelType:  'META',
      // Real Meta convention: every numeric field in an Insights row is
      // returned as a STRING (confirmed in Meta's own documented
      // example response) -- Number() here, not assumed as already numeric.
      impressions:  Number(row.impressions || 0),
      clicks:        Number(row.clicks || 0),
      // Real Meta convention: spend is already in the account's own
      // currency unit -- no micros-style conversion needed here, unlike
      // Google's cost_micros.
      spend:         Number(row.spend || 0),
      // Real structural difference from Google: Meta has no single flat
      // "conversions" field -- `actions` is an array of
      // { action_type, value } pairs, one per distinct tracked action
      // type (purchases, leads, add-to-cart, etc.). Summed across ALL
      // entries here for a total conversion count, matching
      // action_values the same way for total conversion value -- a
      // deliberate, documented choice (not guessing at one specific
      // action_type to filter to, since which action types matter is
      // genuinely tenant/business-specific and Meta doesn't provide a
      // single canonical "conversions" rollup the way Google Ads does).
      conversions:      this._sumActions(row.actions),
      conversionsValue: this._sumActions(row.action_values),
      ctr:           Number(row.ctr || 0),
      averageCpc:    Number(row.cpc || 0),
    }));
  }

  /** _sumActions -- real helper for Meta's actions/action_values array shape. */
  _sumActions(actions) {
    if (!Array.isArray(actions)) return 0;
    return actions.reduce((sum, a) => sum + Number(a?.value || 0), 0);
  }

  /** _getInsightsPaginated -- shared real Insights call, paginated via Meta's real cursor-based paging. */
  async _getInsightsPaginated({ accessToken, datePreset, fields }) {
    const allRows = [];
    let url = `${GRAPH_BASE}/act_${this.adAccountId}/insights?level=campaign&date_preset=${datePreset}&fields=${fields}&access_token=${accessToken}&limit=200`;

    while (url) {
      let response;
      try {
        response = await fetch(url);
      } catch (networkError) {
        throw new Error(`Could not reach Meta's Ads Insights API — ${networkError.message}`);
      }

      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(this._describeError(json, response.status));
      }

      allRows.push(...(json.data || []));
      // Real Meta cursor-based paging -- paging.next is the full next-page
      // URL already, not a token to re-assemble ourselves.
      url = json.paging?.next || null;
    }

    return allRows;
  }

  /** _describeError -- surfaces Meta's real error detail, not a generic HTTP status. */
  _describeError(json, status) {
    const detail = json?.error?.message;
    return detail ? `Meta Ads API error — ${detail}` : `Meta Ads API error — HTTP ${status}`;
  }
}