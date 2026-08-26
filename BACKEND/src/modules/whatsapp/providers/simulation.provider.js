import { randomUUID } from 'node:crypto';
import { WhatsAppProvider } from './provider.interface.js';
import { MESSAGE_STATUS } from '../messages/message.model.js';

/**
 * Simulation provider — pretends to talk to a WhatsApp Business API.
 * Deterministic, no network. Returns transport responses that the message
 * service persists.
 */
export class SimulationProvider extends WhatsAppProvider {
  get name() {
    return 'simulation';
  }

  async sendMessage({ to, content, type = 'text' }) {
    const now = new Date();
    return {
      provider: this.name,
      provider_message_id: `sim_out_${randomUUID()}`,
      status: MESSAGE_STATUS.SENT,
      to,
      type,
      content,
      sent_at: now,
      // Simulated near-instant delivery.
      delivered_at: now,
    };
  }

  async sendTemplate({ to, templateName, languageCode, bodyParams = [] }) {
    const now = new Date();
    return {
      provider: this.name,
      provider_message_id: `sim_tpl_${randomUUID()}`,
      status: MESSAGE_STATUS.SENT,
      to,
      type: 'template',
      content: `[template:${templateName}/${languageCode}] ${bodyParams.map((p) => p?.value ?? p).join(', ')}`,
      sent_at: now,
      delivered_at: now,
    };
  }

  async sendMedia({ to, mediaType, mediaUrl, caption }) {
    const now = new Date();
    return {
      provider: this.name,
      provider_message_id: `sim_media_${randomUUID()}`,
      status: MESSAGE_STATUS.SENT,
      to,
      type: mediaType,
      content: caption || `[${mediaType}] ${mediaUrl}`,
      sent_at: now,
      delivered_at: now,
    };
  }

  async simulateInbound({ from, content, type = 'text' }) {
    const now = new Date();
    return {
      provider: this.name,
      provider_message_id: `sim_in_${randomUUID()}`,
      status: MESSAGE_STATUS.DELIVERED,
      from,
      type,
      content,
      received_at: now,
    };
  }
}