/**
 * =============================================================================
 * InnovateX Revenue OS — Meta Conversions API Provider
 * =============================================================================
 *
 * FILE: src/modules/attribution/providers/metaConversions.provider.js
 *
 * Real server-to-server event delivery to Meta's Conversions API.
 * SOURCE: real Meta for Developers docs (developers.facebook.com/docs/
 * marketing-api/conversions-api) -- confirmed request shape, confirmed
 * hashing requirements, not guessed:
 *
 *   POST https://graph.facebook.com/v{version}/{pixelId}/events?access_token={token}
 *   { data: [{ event_name, event_time, event_id, action_source,
 *              user_data: { em, ph, external_id, client_ip_address,
 *                           client_user_agent },
 *              custom_data: { currency, value, ... } }] }
 *
 * HASHING RULES (confirmed from Meta's own documentation):
 *   - email (em): trim whitespace, lowercase, then SHA-256
 *   - phone (ph): strip everything except digits (keep country code, no
 *     leading '+'), then SHA-256
 *   - Events with NO valid hashed identifier are rejected by Meta outright
 *     ("Incoming conversions requests must have at least one valid user
 *     ID parameter") -- checked before sending, not left to fail remotely.
 *
 * This adapter implements ONLY what was asked: real Conversions API event
 * delivery using data already captured on the Lead (email, phone). It does
 * NOT implement fbc/fbp click-ID capture, a browser pixel, ad-spend
 * ingestion, or multi-touch attribution -- those are real, separate,
 * larger pieces of MASTER_SPEC's PART H roadmap, out of today's scope.
 * =============================================================================
 */

import crypto from 'crypto';

const GRAPH_API_VERSION = 'v21.0';

/** Meta's real normalization: trim + lowercase, then SHA-256. */
const hashEmail = (email) => {
  if (!email) return null;
  const normalized = String(email).trim().toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex');
};

/** Meta's real normalization: digits only (keep country code, no leading '+'), then SHA-256. */
const hashPhone = (phone) => {
  if (!phone) return null;
  const digits = String(phone).replace(/[^\d]/g, '');
  if (!digits) return null;
  return crypto.createHash('sha256').update(digits).digest('hex');
};

/**
 * MAP_EVENT_NAME -- translates this app's internal TrackingEventType
 * values to Meta's real standard event names, so events show up
 * correctly in Ads Manager instead of as unrecognized custom events.
 * Deliberately a narrow, explicit allowlist -- not every one of the 18
 * internal event types is genuinely ad-optimization-relevant (e.g.
 * WHATSAPP_INBOUND isn't a conversion signal Meta has a standard name
 * for), so only the ones that map cleanly to a real Meta standard event
 * are sent at all.
 */
export const MAP_EVENT_NAME = Object.freeze({
  'Lead Created':        'Lead',
  'AI Qualified':        'CompleteRegistration',
  'Booking Created':     'Schedule',
  'Payment Completed':   'Purchase',
  'Deal Won':             'Purchase',
});

export class MetaConversionsProvider {
  /**
   * @param {{ pixelId: string, accessToken: string, testEventCode?: string }} credentials
   */
  constructor({ pixelId, accessToken, testEventCode }) {
    if (!pixelId) throw new Error('MetaConversionsProvider requires pixelId');
    if (!accessToken) throw new Error('MetaConversionsProvider requires accessToken');
    this.pixelId = pixelId;
    this.accessToken = accessToken;
    this.testEventCode = testEventCode || null;
    this.baseUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${pixelId}/events`;
  }

  /**
   * testConnection -- real, lightweight, read-only verification. Fetches
   * the pixel/dataset's own name via Graph API rather than sending a
   * fake event just to check credentials -- same "don't waste a real
   * side effect just to verify a key" principle used for WhatsApp
   * providers that have a safe read endpoint.
   */
  async testConnection() {
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${this.pixelId}?fields=name&access_token=${this.accessToken}`;
    let response;
    try {
      response = await fetch(url);
    } catch (networkError) {
      throw new Error(`Could not reach Meta's Graph API — ${networkError.message}`);
    }
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = json?.error?.message || `HTTP ${response.status}`;
      throw new Error(`Meta rejected these credentials — ${message}`);
    }
    return { connected: true, name: json.name || null };
  }

  /**
   * sendEvent -- real server-to-server conversion event.
   *
   * @param {{
   *   internalEventType: string,   // this app's TrackingEventType value
   *   eventId: string,             // unique per event, for Meta's own dedup
   *   email?: string, phone?: string,
   *   value?: number, currency?: string,
   *   sourceUrl?: string,
   * }} params
   * @returns {{ sent: boolean, metaEventName: string|null, reason?: string }}
   *   `sent: false` with a reason is a real, expected outcome (e.g. no
   *   mapped event name, or no identifier to hash) -- not every internal
   *   event should or can reach Meta, and that's not a failure.
   */
  async sendEvent({ internalEventType, eventId, email, phone, value, currency, sourceUrl }) {
    const metaEventName = MAP_EVENT_NAME[internalEventType];
    if (!metaEventName) {
      return { sent: false, metaEventName: null, reason: `No Meta standard event mapped for "${internalEventType}"` };
    }

    const em = hashEmail(email);
    const ph = hashPhone(phone);
    if (!em && !ph) {
      // Meta's own real rejection rule -- checked here so we don't waste
      // a real HTTP call on a request Meta would reject anyway.
      return { sent: false, metaEventName, reason: 'No email or phone on this lead to hash — Meta requires at least one identifier' };
    }

    const user_data = {};
    if (em) user_data.em = [em];
    if (ph) user_data.ph = [ph];

    const eventPayload = {
      event_name:   metaEventName,
      event_time:   Math.floor(Date.now() / 1000),
      event_id:     eventId,
      action_source: 'system_generated', // real, documented value for server-originated events with no browser context
      user_data,
    };
    if (sourceUrl) eventPayload.event_source_url = sourceUrl;
    if (value !== undefined && value !== null) {
      eventPayload.custom_data = { value, currency: currency || 'USD' };
    }

    const body = { data: [eventPayload] };
    if (this.testEventCode) body.test_event_code = this.testEventCode;

    let response;
    try {
      response = await fetch(`${this.baseUrl}?access_token=${this.accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (networkError) {
      throw new Error(`Could not reach Meta's Conversions API — ${networkError.message}`);
    }

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = json?.error?.message || `HTTP ${response.status}`;
      throw new Error(`Meta rejected this event — ${message}`);
    }

    return { sent: true, metaEventName, eventsReceived: json.events_received ?? null };
  }
}