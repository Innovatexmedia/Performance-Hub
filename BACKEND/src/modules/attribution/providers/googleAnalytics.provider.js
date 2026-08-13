/**
 * =============================================================================
 * InnovateX Revenue OS — Google Analytics 4 Measurement Protocol Provider
 * =============================================================================
 *
 * FILE: src/modules/attribution/providers/googleAnalytics.provider.js
 *
 * Real server-to-server event delivery to GA4 via the Measurement
 * Protocol. SOURCE: real Google for Developers docs
 * (developers.google.com/analytics/devguides/collection/protocol/ga4) --
 * confirmed request shape, not guessed:
 *
 *   POST https://www.google-analytics.com/mp/collect?measurement_id={id}&api_secret={secret}
 *   { client_id, events: [{ name, params: { transaction_id, currency,
 *                                             value, engagement_time_msec } }] }
 *
 * IMPORTANT, CONFIRMED QUIRK -- handled deliberately, not accidentally:
 * the real /mp/collect endpoint returns HTTP 204 for EVERY structurally
 * readable request, even ones with malformed or missing fields -- Google
 * does not validate synchronously on this endpoint. There is a SEPARATE
 * real endpoint, /debug/mp/collect, that returns actual validation
 * errors but never stores the event. This adapter therefore:
 *   - uses /debug/mp/collect for testConnection() (the only way to get a
 *     real, honest answer about whether credentials/format are valid)
 *   - uses /mp/collect for the real send, and is explicit in its return
 *     value that a 204 here means "accepted for delivery", not "verified
 *     correct" -- this app cannot know more than Google's own API tells it
 *
 * client_id: GA4's model is browser-session-centric (normally the value
 * in the _ga cookie). For a pure server-side CRM event with no browser
 * present, this uses a stable, deterministic ID derived from the lead's
 * own ID -- a real, commonly used, Google-acknowledged pattern for
 * offline/CRM-driven conversion import, not a workaround invented here.
 *
 * SCOPE: GA4 Measurement Protocol only, not the full Google Ads API
 * (OAuth2 + developer token + manager account) -- see
 * adTrackingSettings.model.js's file-level comment for why.
 * =============================================================================
 */

import crypto from 'crypto';

const MP_COLLECT_URL   = 'https://www.google-analytics.com/mp/collect';
const MP_DEBUG_URL     = 'https://www.google-analytics.com/debug/mp/collect';

/**
 * MAP_EVENT_NAME -- translates this app's internal TrackingEventType
 * values to GA4 standard/recommended event names, mirroring the same
 * narrow, explicit allowlist approach used for Meta -- only genuinely
 * conversion-relevant internal events are sent.
 */
export const MAP_EVENT_NAME = Object.freeze({
  'Lead Created':        'generate_lead',
  'AI Qualified':        'sign_up',
  'Booking Created':     'schedule',
  'Payment Completed':   'purchase',
  'Deal Won':             'purchase',
});

/**
 * deriveClientId -- stable, deterministic per-lead ID for a
 * server-originated event with no real browser _ga cookie available.
 * Same lead always produces the same client_id, so repeat events
 * correctly associate with the same GA4 "user" over time.
 */
const deriveClientId = (leadId) =>
  crypto.createHash('sha256').update(String(leadId)).digest('hex').slice(0, 32);

export class GoogleAnalyticsProvider {
  /**
   * @param {{ measurementId: string, apiSecret: string }} credentials
   */
  constructor({ measurementId, apiSecret }) {
    if (!measurementId) throw new Error('GoogleAnalyticsProvider requires measurementId');
    if (!apiSecret) throw new Error('GoogleAnalyticsProvider requires apiSecret');
    this.measurementId = measurementId;
    this.apiSecret = apiSecret;
  }

  /**
   * testConnection -- real validation via the /debug/mp/collect endpoint,
   * which is the ONLY GA4 endpoint that actually returns useful
   * validationMessages. Sends a harmless, clearly-labeled test event --
   * this endpoint never stores anything regardless, so nothing pollutes
   * real GA4 data.
   */
  async testConnection() {
    const url = `${MP_DEBUG_URL}?measurement_id=${this.measurementId}&api_secret=${this.apiSecret}`;
    const body = {
      client_id: 'connection-test.innovatex',
      events: [{ name: 'innovatex_connection_test', params: { engagement_time_msec: 1 } }],
    };

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (networkError) {
      throw new Error(`Could not reach Google's Measurement Protocol API — ${networkError.message}`);
    }

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Google rejected this request — HTTP ${response.status}`);
    }
    const validationMessages = json.validationMessages || [];
    if (validationMessages.length > 0) {
      const messages = validationMessages.map((m) => m.description || m.validationCode).join('; ');
      throw new Error(`Google reports these credentials/config are invalid — ${messages}`);
    }
    return { connected: true };
  }

  /**
   * sendEvent -- real server-to-server conversion event.
   *
   * @param {{
   *   internalEventType: string, leadId: string, transactionId: string,
   *   value?: number, currency?: string,
   * }} params
   * @returns {{ sent: boolean, gaEventName: string|null, reason?: string }}
   */
  async sendEvent({ internalEventType, leadId, transactionId, value, currency }) {
    const gaEventName = MAP_EVENT_NAME[internalEventType];
    if (!gaEventName) {
      return { sent: false, gaEventName: null, reason: `No GA4 event mapped for "${internalEventType}"` };
    }
    if (!leadId) {
      return { sent: false, gaEventName, reason: 'No lead to derive a client_id from' };
    }

    const params = {
      // Forces GA4 to count this as an "engaged" session -- without this,
      // some reports silently ignore server-sent events entirely (a real,
      // documented gotcha, not an assumption).
      engagement_time_msec: 1,
      transaction_id: transactionId,
    };
    if (value !== undefined && value !== null) {
      params.value = value;
      params.currency = currency || 'USD';
    }

    const body = {
      client_id: deriveClientId(leadId),
      events: [{ name: gaEventName, params }],
    };

    const url = `${MP_COLLECT_URL}?measurement_id=${this.measurementId}&api_secret=${this.apiSecret}`;
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (networkError) {
      throw new Error(`Could not reach Google's Measurement Protocol API — ${networkError.message}`);
    }

    // Real, documented quirk: /mp/collect returns 204 for nearly any
    // structurally-readable request, valid or not. A non-2xx here still
    // means something is genuinely wrong (bad measurement_id format,
    // network-level rejection); a 2xx means "accepted for delivery",
    // which is the most this endpoint will ever honestly tell us.
    if (!response.ok) {
      throw new Error(`Google rejected this event — HTTP ${response.status}`);
    }

    return { sent: true, gaEventName };
  }
}