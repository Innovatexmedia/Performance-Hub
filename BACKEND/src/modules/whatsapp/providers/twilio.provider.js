/**
 * Twilio WhatsApp provider -- the REAL adapter, using native fetch against
 * Twilio's real Programmable Messaging API.
 *
 * SOURCE: real Twilio API docs (twilio.com/docs/whatsapp). Twilio is
 * architecturally different from both MetaProvider and Dialog360Provider
 * in two real ways, not stylistic choices:
 *   - Auth: HTTP Basic Auth (base64 of accountSid:authToken), not a
 *     bearer token or a single custom header.
 *   - Body: application/x-www-form-urlencoded, NOT JSON -- Twilio's
 *     classic REST API predates their JSON-body endpoints.
 * Phone numbers also need a literal 'whatsapp:' prefix on both To and
 * From, confirmed directly from Twilio's own code samples.
 *
 * Implements the same WhatsAppProvider interface as MetaProvider/
 * Dialog360Provider/SimulationProvider (see provider.interface.js) --
 * message.service.js doesn't know or care which concrete provider it's
 * talking to.
 *
 * SCOPE: text messages only, same limitation and same reason as the
 * other two real adapters -- media/template messages need a different
 * request shape not built yet.
 */

import { WhatsAppProvider } from './provider.interface.js';

export class TwilioProvider extends WhatsAppProvider {
  /**
   * @param {{ accountSid: string, authToken: string, whatsappNumber: string }} credentials
   */
  constructor({ accountSid, authToken, whatsappNumber }) {
    super();
    if (!accountSid) throw new Error('TwilioProvider requires accountSid');
    if (!authToken) throw new Error('TwilioProvider requires authToken');
    if (!whatsappNumber) throw new Error('TwilioProvider requires whatsappNumber');
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.whatsappNumber = whatsappNumber;
    this.baseUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  }

  get name() {
    return 'twilio';
  }

  /** Twilio's documented WhatsApp format: 'whatsapp:' prefix + E.164 (leading '+', digits only after that). */
  static toWhatsAppAddress(phone) {
    const digits = String(phone || '').replace(/[^\d]/g, '');
    return `whatsapp:+${digits}`;
  }

  async sendMessage({ to, content, type = 'text' }) {
    if (type !== 'text') {
      throw new Error(
        `TwilioProvider: message type "${type}" is not implemented yet -- only 'text' has a real transport path. ` +
        `Sending would either fail against Twilio's API or require a different request shape (MediaUrl, template ContentSid) not yet built.`
      );
    }

    const basicAuth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
    const params = new URLSearchParams({
      To: TwilioProvider.toWhatsAppAddress(to),
      From: TwilioProvider.toWhatsAppAddress(this.whatsappNumber),
      Body: content,
    });

    let response;
    try {
      response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
    } catch (networkError) {
      throw new Error(`TwilioProvider: network error calling Twilio's API -- ${networkError.message}`);
    }

    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = json?.message || `HTTP ${response.status}`;
      const code = json?.code;
      throw new Error(`TwilioProvider: send failed -- ${message}${code ? ` (code ${code})` : ''}`);
    }

    return {
      provider: 'twilio',
      provider_message_id: json.sid || null,
      status: 'Sent',
      sent_at: new Date(),
      delivered_at: null,
    };
  }

  async simulateInbound() {
    throw new Error('TwilioProvider does not support simulateInbound() -- inbound messages arrive via a real webhook, not simulation. This method should only ever be called on SimulationProvider.');
  }
}