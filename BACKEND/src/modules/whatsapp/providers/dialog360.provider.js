/**
 * 360Dialog WhatsApp provider -- the REAL adapter, using native fetch
 * against 360Dialog's real Messaging API.
 *
 * SOURCE: docs.360dialog.com (Messaging API reference). 360Dialog is a
 * WhatsApp Business Solution Provider (BSP) reselling the same underlying
 * Meta Cloud API infrastructure, which is why the request/response body
 * shape below matches MetaProvider's almost exactly. The real difference
 * is authentication and the base URL:
 *   - Meta:      Authorization: Bearer <token>, URL includes /{phoneNumberId}/messages
 *   - 360Dialog: D360-API-KEY: <key> header only, URL is just /messages --
 *     360Dialog already knows which phone number the key belongs to, so
 *     including a phone number ID in the request is unnecessary (and,
 *     per their own docs, can cause errors if you try).
 *
 * Implements the same WhatsAppProvider interface as MetaProvider/
 * SimulationProvider (see provider.interface.js) -- message.service.js
 * doesn't know or care which concrete provider it's talking to.
 *
 * SCOPE: text messages only, same limitation as MetaProvider and for the
 * same reason -- image/document/template require a different request
 * shape (media handles, template components) not built yet.
 */

import { WhatsAppProvider } from './provider.interface.js';

const BASE_URL = 'https://waba-v2.360dialog.io';

export class Dialog360Provider extends WhatsAppProvider {
  /**
   * @param {{ apiKey: string }} credentials
   */
  constructor({ apiKey }) {
    super();
    if (!apiKey) throw new Error('Dialog360Provider requires apiKey');
    this.apiKey = apiKey;
  }

  get name() {
    return 'dialog360';
  }

  /** Same normalization Meta's Cloud API expects -- digits only, no leading '+'. */
  static normalizePhone(phone) {
    return String(phone || '').replace(/[^\d]/g, '');
  }

  async sendMessage({ to, content, type = 'text' }) {
    if (type !== 'text') {
      throw new Error(
        `Dialog360Provider: message type "${type}" is not implemented yet -- only 'text' has a real transport path. ` +
        `Sending would either fail against 360Dialog's API or require a different request shape (media upload/link, template components) not yet built.`
      );
    }

    const body = {
      messaging_product: 'whatsapp',
      to: Dialog360Provider.normalizePhone(to),
      type: 'text',
      text: { body: content },
    };

    let response;
    try {
      response = await fetch(`${BASE_URL}/messages`, {
        method: 'POST',
        headers: {
          'D360-API-KEY': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (networkError) {
      throw new Error(`Dialog360Provider: network error calling 360Dialog's API -- ${networkError.message}`);
    }

    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = json?.error?.message || json?.errors?.[0]?.details || `HTTP ${response.status}`;
      throw new Error(`Dialog360Provider: send failed -- ${message}`);
    }

    const providerMessageId = json?.messages?.[0]?.id || null;

    return {
      provider: 'dialog360',
      provider_message_id: providerMessageId,
      status: 'Sent',
      sent_at: new Date(),
      delivered_at: null,
    };
  }

  async simulateInbound() {
    throw new Error('Dialog360Provider does not support simulateInbound() -- inbound messages arrive via a real webhook, not simulation. This method should only ever be called on SimulationProvider.');
  }
}