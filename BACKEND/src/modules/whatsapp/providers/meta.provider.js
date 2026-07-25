/**
 * Meta WhatsApp Cloud API provider -- the REAL adapter, using native fetch
 * (Node 18+, no new HTTP client dependency) against Meta's Graph API.
 *
 * Implements the same WhatsAppProvider interface as SimulationProvider
 * (see provider.interface.js) -- message.service.js doesn't know or care
 * which concrete provider it's talking to.
 *
 * IMPORTANT -- unlike SimulationProvider, this is NOT a stateless singleton.
 * Credentials (accessToken, phoneNumberId, graphApiVersion) are per-tenant,
 * stored in WhatsAppSettings, so a new instance is constructed per call with
 * that tenant's real config -- see resolveProvider() in provider.factory.js.
 *
 * SCOPE: text messages only, fully implemented and correct against Meta's
 * documented Cloud API request/response shape. image/document/template
 * message types are NOT implemented yet -- sendMessage() throws a clear
 * error for those rather than silently sending something malformed. This
 * matches Message.type's 4 values (text/image/document/template) existing
 * in the model already, but only 'text' has a real transport path today.
 */

import { WhatsAppProvider } from './provider.interface.js';

export class MetaProvider extends WhatsAppProvider {
  /**
   * @param {{ accessToken: string, phoneNumberId: string, graphApiVersion?: string }} credentials
   */
  constructor({ accessToken, phoneNumberId, graphApiVersion = 'v21.0' }) {
    super();
    if (!accessToken) throw new Error('MetaProvider requires accessToken');
    if (!phoneNumberId) throw new Error('MetaProvider requires phoneNumberId');
    this.accessToken = accessToken;
    this.phoneNumberId = phoneNumberId;
    this.graphApiVersion = graphApiVersion;
    this.baseUrl = `https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/messages`;
  }

  get name() {
    return 'meta';
  }

  /**
   * Normalizes a phone number for the Cloud API: digits only, no leading
   * '+' (Meta's documented format for the `to` field).
   */
  static normalizePhone(phone) {
    return String(phone || '').replace(/[^\d]/g, '');
  }

  async sendMessage({ to, content, type = 'text' }) {
    if (type !== 'text') {
      throw new Error(
        `MetaProvider: message type "${type}" is not implemented yet -- only 'text' has a real transport path. ` +
        `Sending would either fail against the Graph API or require a different request shape (media upload/link, template components) not yet built.`
      );
    }

    const body = {
      messaging_product: 'whatsapp',
      to: MetaProvider.normalizePhone(to),
      type: 'text',
      text: { body: content },
    };

    let response;
    try {
      response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (networkError) {
      throw new Error(`MetaProvider: network error calling Graph API -- ${networkError.message}`);
    }

    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      const metaMessage = json?.error?.message || `HTTP ${response.status}`;
      const metaCode = json?.error?.code;
      throw new Error(`MetaProvider: send failed -- ${metaMessage}${metaCode ? ` (code ${metaCode})` : ''}`);
    }

    const providerMessageId = json?.messages?.[0]?.id || null;

    return {
      provider: 'meta',
      provider_message_id: providerMessageId,
      status: 'Sent',
      sent_at: new Date(),
      delivered_at: null,
    };
  }

  async simulateInbound() {
    throw new Error('MetaProvider does not support simulateInbound() -- inbound messages arrive via the real webhook, not simulation. This method should only ever be called on SimulationProvider.');
  }
}