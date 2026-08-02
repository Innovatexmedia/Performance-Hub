/**
 * WhatsApp provider abstraction (transport layer only).
 *
 * Providers simulate / perform the *transport* and return a normalized
 * response. Persistence (creating messages, delivery logs, updating
 * conversations) is orchestrated by the message service — keeping
 * repositories as the sole MongoDB-access layer. Swap in a real provider
 * (Meta Cloud API, Twilio, etc.) by implementing this same interface.
 */
export class WhatsAppProvider {
  get name() {
    return 'base';
  }

  /**
   * Send an outbound message.
   * @param {{ to: string, content: string, type?: string }} _payload
   * @returns {Promise<{ provider, provider_message_id, status, sent_at, delivered_at }>}
   */
  async sendMessage(_payload) {
    throw new Error('sendMessage() not implemented');
  }

  /**
   * Send an outbound TEMPLATE message (the only message type Meta allows
   * for business-initiated sends outside an active 24h customer-service
   * window -- i.e. every campaign/broadcast send).
   * @param {{ to: string, templateName: string, languageCode: string, bodyParams?: string[] }} _payload
   * @returns {Promise<{ provider, provider_message_id, status, sent_at, delivered_at }>}
   */
  async sendTemplate(_payload) {
    throw new Error('sendTemplate() not implemented');
  }

  /**
   * Simulate an inbound message arriving from a contact.
   * @param {{ from: string, content: string, type?: string }} _payload
   * @returns {Promise<{ provider, provider_message_id, status, received_at }>}
   */
  async simulateInbound(_payload) {
    throw new Error('simulateInbound() not implemented');
  }
}