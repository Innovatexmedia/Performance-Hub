
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
   * Send an outbound MEDIA message (image, document, or audio/voice note).
   * mediaUrl must already be a durable, publicly-fetchable HTTPS URL
   * (Cloudinary -- see shared/services/cloudinary.service.js). Meta's
   * Cloud API sends media "by link" directly from that URL, no separate
   * Meta-side upload step.
   * @param {{ to: string, mediaType: 'image'|'document'|'audio', mediaUrl: string, caption?: string, filename?: string }} _payload
   * @returns {Promise<{ provider, provider_message_id, status, sent_at, delivered_at }>}
   */
  async sendMedia(_payload) {
    throw new Error('sendMedia() not implemented');
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