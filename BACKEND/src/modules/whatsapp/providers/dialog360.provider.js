

import { WhatsAppProvider } from './provider.interface.js';
import { normalizePhoneNumber } from '../../../shared/helpers/phone.helpers.js';

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

  /** Delegates to the shared normalizer -- see phone.helpers.js. Same fix as MetaProvider: this used to strip non-digits but never add a missing country code. */
  static normalizePhone(phone) {
    return normalizePhoneNumber(phone);
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