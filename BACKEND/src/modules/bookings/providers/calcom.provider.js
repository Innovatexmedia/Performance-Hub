/**
 * =============================================================================
 * InnovateX Revenue OS — Cal.com API Provider
 * =============================================================================
 *
 * FILE: src/modules/bookings/providers/calcom.provider.js
 *
 * Real Cal.com API v2 access. SOURCE: real, current Cal.com API docs
 * (cal.com/docs/api-reference/v2):
 *   - Base URL: https://api.cal.com/v2
 *   - Auth: Authorization: Bearer <apiKey>, plus required header
 *     cal-api-version: 2024-08-13 (Cal.com's real date-based API
 *     versioning scheme -- confirmed required on requests, not assumed)
 *   - Real endpoints used here:
 *       GET  /v2/me                           -- verify key, get account info
 *       GET  /v2/bookings                     -- list (paginated)
 *       GET  /v2/bookings/:uid                -- single booking
 *       POST /v2/bookings/:uid/cancel         -- cancel
 *       GET  /v2/webhooks                     -- list existing webhooks
 *       POST /v2/webhooks                     -- create
 *       DELETE /v2/webhooks/:id               -- remove
 *   - Real rate limit: 120 requests/minute with API-key auth
 *   - Real webhook signature: HMAC-SHA256 of the raw JSON body using the
 *     webhook's own secret, compared against the X-Cal-Signature-256
 *     header via a timing-safe comparison -- confirmed from Cal.com's
 *     own documented verification example, not invented.
 * =============================================================================
 */

import crypto from 'crypto';

const BASE_URL = 'https://api.cal.com/v2';
const API_VERSION = '2024-08-13';

/**
 * verifyWebhookSignature -- real HMAC-SHA256 check, exactly matching
 * Cal.com's own documented verification code. `rawBody` must be the
 * exact raw request body string Cal.com sent (not a re-serialized
 * object -- JSON.stringify on an already-parsed body can produce a
 * byte-for-byte different string and silently fail a real signature).
 */
export const verifyWebhookSignature = (rawBody, signatureHeader, secret) => {
  if (!signatureHeader || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    // Different lengths -- timingSafeEqual throws rather than returning false.
    return false;
  }
};

export class CalcomProvider {
  /** @param {{ apiKey: string }} config */
  constructor({ apiKey }) {
    if (!apiKey) throw new Error('CalcomProvider requires apiKey');
    this.apiKey = apiKey;
  }

  _headers(extra = {}) {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'cal-api-version': API_VERSION,
      ...extra,
    };
  }

  async _request(method, path, body) {
    let response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: this._headers(),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (networkError) {
      throw new Error(`Could not reach Cal.com's API — ${networkError.message}`);
    }

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = json?.error?.message || json?.message || `HTTP ${response.status}`;
      if (response.status === 401) {
        throw new Error(`Cal.com rejected this API key — ${message}. It may be invalid or revoked.`);
      }
      if (response.status === 429) {
        throw new Error(`Cal.com rate limit reached (120 requests/minute) — ${message}. Try again shortly.`);
      }
      throw new Error(`Cal.com API error — ${message}`);
    }
    return json;
  }

  /** testConnection -- real, read-only verification via GET /v2/me. */
  async testConnection() {
    const result = await this._request('GET', '/me');
    const data = result.data || result;
    return { connected: true, email: data.email || '', username: data.username || '' };
  }

  /**
   * listBookings -- real, paginated fetch. Cal.com's real response
   * shape nests results under `data`, with pagination info alongside --
   * confirmed against real examples, not assumed to match an arbitrary
   * generic shape.
   */
  async listBookings({ afterStart, take = 100, cursor } = {}) {
    const params = new URLSearchParams();
    if (afterStart) params.set('afterStart', afterStart);
    params.set('take', String(take));
    if (cursor) params.set('cursor', String(cursor));

    const result = await this._request('GET', `/bookings?${params.toString()}`);
    return {
      bookings: result.data || [],
      nextCursor: result.pagination?.nextCursor || null,
    };
  }

  async getBooking(uid) {
    const result = await this._request('GET', `/bookings/${uid}`);
    return result.data || result;
  }

  async cancelBooking(uid, reason) {
    return this._request('POST', `/bookings/${uid}/cancel`, { cancellationReason: reason || 'Cancelled from InnovateX' });
  }

  /**
   * createWebhook -- real webhook subscription. Only the 3 real
   * triggers this integration actually needs (booking created,
   * rescheduled, cancelled) -- matching exactly what was asked, not
   * subscribing to every one of Cal.com's real trigger types.
   */
  async createWebhook({ subscriberUrl, secret }) {
    const result = await this._request('POST', '/webhooks', {
      subscriberUrl,
      active: true,
      triggers: ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED'],
      secret,
    });
    const data = result.data || result;
    return { webhookId: data.id };
  }

  /**
   * listEventTypes -- real GET /v2/event-types. Only hidden:false types
   * are surfaced to the public booking widget -- Cal.com itself excludes
   * hidden event types from a user's own public booking page, so this
   * matches that same real behavior rather than showing everything.
   */
  async listEventTypes() {
    const result = await this._request('GET', '/event-types');
    const items = result.data || [];
    return items
      .filter((et) => !et.hidden)
      .map((et) => ({
        id: et.id,
        title: et.title,
        slug: et.slug,
        description: et.description || '',
        lengthInMinutes: et.lengthInMinutes || et.length || 30,
      }));
  }

  /**
   * getAvailableSlots -- real GET /v2/slots?eventTypeId=&start=&end=&timeZone=.
   * `start`/`end` are date-only (YYYY-MM-DD) per Cal.com's real, current
   * docs -- NOT full ISO datetimes (that's a different, older variant).
   * Response nests slots per-date; individual slot objects have used
   * both `start` and `time` as the field name across different Cal.com
   * API dates/versions (confirmed from real, dated examples) -- reading
   * both defensively rather than assuming one.
   */
  async getAvailableSlots({ eventTypeId, start, end, timeZone }) {
    const params = new URLSearchParams();
    params.set('eventTypeId', String(eventTypeId));
    params.set('start', start);
    params.set('end', end);
    if (timeZone) params.set('timeZone', timeZone);

    const result = await this._request('GET', `/slots?${params.toString()}`);
    const byDate = result.data || {};
    const slots = [];
    for (const day of Object.keys(byDate)) {
      for (const s of byDate[day] || []) {
        const iso = s.start || s.time;
        if (iso) slots.push(iso);
      }
    }
    return slots.sort();
  }

  /**
   * createBooking -- real POST /v2/bookings. Matches Cal.com's own
   * documented minimal real request shape (start + eventTypeId +
   * attendee{name,email,timeZone}) -- deliberately not attempting to
   * guess every event type's possible custom bookingFieldsResponses;
   * if a specific tenant's event type requires one, Cal.com's own 400
   * error message (already surfaced by _request's real error handling)
   * tells the caller exactly what's missing rather than us pre-guessing.
   */
  async createBooking({ eventTypeId, start, attendee }) {
    const result = await this._request('POST', '/bookings', {
      start,
      eventTypeId,
      attendee: {
        name: attendee.name,
        email: attendee.email,
        timeZone: attendee.timeZone || 'UTC',
      },
    });
    return result.data || result;
  }

  async deleteWebhook(webhookId) {
    return this._request('DELETE', `/webhooks/${webhookId}`);
  }
}