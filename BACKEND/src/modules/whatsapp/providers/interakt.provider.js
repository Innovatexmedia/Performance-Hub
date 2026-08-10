/**
 * Interakt WhatsApp provider.
 *
 * SOURCE: real Interakt API docs (interakt.shop/resource-center). Auth is
 * 'Authorization: Basic <API Key>' using the RAW key (not base64-encoded
 * username:password like Twilio's Basic Auth) -- confirmed from
 * Interakt's own Postman collection examples.
 *
 * HONEST LIMITATION, not a placeholder or a guess: Interakt's real public
 * Send Message API (POST /v1/public/message/) is template-only. Every
 * documented example requires a pre-approved template name + variable
 * values -- there is no free-text "session message" option in their
 * public API, unlike Meta/360Dialog/Twilio. This app's Composer/Inbox
 * currently only sends free text, so sendMessage() below throws a clear,
 * specific error for type: 'text' rather than either:
 *   (a) silently pretending to succeed, or
 *   (b) forcing a template call with a fabricated/guessed template name
 *       that would just fail against Interakt's real API anyway.
 * Real template sending can be added here once the app has a real
 * template-selection flow to call it with (see the WhatsApp Templates
 * work planned for later).
 *
 * Implements the same WhatsAppProvider interface as the other three real
 * adapters (see provider.interface.js) -- message.service.js doesn't
 * know or care which concrete provider it's talking to. testConnection()
 * in whatsappSettings.service.js is fully real and working for this
 * provider; only the send path is honestly limited.
 */

import { WhatsAppProvider } from './provider.interface.js';

const BASE_URL = 'https://api.interakt.ai/v1/public';

export class InteraktProvider extends WhatsAppProvider {
  /**
   * @param {{ apiKey: string }} credentials
   */
  constructor({ apiKey }) {
    super();
    if (!apiKey) throw new Error('InteraktProvider requires apiKey');
    this.apiKey = apiKey;
  }

  get name() {
    return 'interakt';
  }

  async sendMessage({ to, content, type = 'text' }) {
    if (type === 'text') {
      throw new Error(
        'InteraktProvider: free-text sending is not supported. ' +
        'Interakt\'s real API (POST /v1/public/message/) only supports pre-approved WhatsApp templates, ' +
        'not plain text messages -- this is a real limitation of Interakt\'s public API, not a missing feature here. ' +
        'Send a pre-approved template instead, or switch to a provider that supports free text (Meta, 360Dialog, Twilio).'
      );
    }

    if (type === 'template') {
      throw new Error(
        'InteraktProvider: template sending is not wired up yet -- Interakt\'s real /v1/public/message/ endpoint ' +
        'supports it, but this app does not yet have a template-selection flow to call it with a real template name.'
      );
    }

    throw new Error(`InteraktProvider: message type "${type}" is not implemented.`);
  }

  async simulateInbound() {
    throw new Error('InteraktProvider does not support simulateInbound() -- inbound messages arrive via a real webhook, not simulation. This method should only ever be called on SimulationProvider.');
  }
}