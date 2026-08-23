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
 * SCOPE: sendMessage() is text-only -- passing type='image'/'document' to
 * it still throws, since Meta's text-send endpoint shape is genuinely
 * different from its media-send shape. Real media (image/document/audio)
 * goes through the separate sendMedia() method below instead, sent "by
 * link" against a durable Cloudinary URL -- see provider.interface.js's
 * sendMedia() doc comment for why no separate Meta-side upload step is
 * needed.
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

  /**
   * Browsers' MediaRecorder can only produce webm-container audio (see
   * FRONTEND Composer.tsx's voice-note recorder) -- Meta's Cloud API
   * flatly rejects that container for audio messages (confirmed live,
   * error code 131053: "Unsupported Audio mime type video/webm"; Meta
   * only accepts audio/ogg;codecs=opus, audio/mpeg, audio/amr, audio/mp4,
   * audio/aac). No browser reliably supports recording directly into any
   * of those formats via MediaRecorder, so client-side format selection
   * can't fix this alone.
   *
   * Fix: Cloudinary stores audio under its 'video' resource type (see
   * shared/services/cloudinary.service.js), which supports on-the-fly
   * format transcoding via the delivery URL -- swapping the file
   * extension to .m4a (audio-only MPEG-4, Meta-accepted as audio/mp4)
   * makes Cloudinary transcode and serve that format instead of the raw
   * upload, generated on first request and cached afterward. No ffmpeg
   * or extra infrastructure needed on our side.
   *
   * NOTE: .mp4 (not .m4a) was tried first and confirmed live NOT to
   * work -- Cloudinary's .mp4 delivery for a video-resource asset is a
   * generic video container even with no video track, so Meta correctly
   * reports it back as "video/mp4" and rejects it (error 131053, same
   * as the original .webm rejection, just a different container). .m4a
   * is the audio-only MPEG-4 variant and is what actually reports as
   * audio/mp4.
   *
   * Only rewrites .webm URLs -- anything else passes through unchanged
   * (voice notes only ever originate from our own recorder today, but
   * this stays a no-op rather than a blind rewrite if that ever changes).
   */
  static toMetaCompatibleAudioUrl(url) {
    return /\.webm(\?|$)/i.test(url) ? url.replace(/\.webm(\?|$)/i, '.m4a$1') : url;
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

    return this._post(body);
  }

  /**
   * Send a real approved WHATSAPP TEMPLATE message via the Graph API.
   * Required for every campaign/broadcast send -- Meta rejects free-text
   * business-initiated messages to a user outside an active 24h
   * customer-service session, so campaigns can never use sendMessage().
   *
   * `bodyParams` is a flat list of string values filled into the template
   * body's {{1}}, {{2}}, ... placeholders IN ORDER. Only the body component
   * is populated -- header/button dynamic params aren't supported yet, same
   * "implemented only where the shape is fully correct" scoping as
   * sendMessage()'s text-only limitation above.
   */
  async sendTemplate({ to, templateName, languageCode, bodyParams = [] }) {
    if (!templateName) throw new Error('MetaProvider.sendTemplate: templateName is required');
    if (!languageCode) throw new Error('MetaProvider.sendTemplate: languageCode is required');

    const body = {
      messaging_product: 'whatsapp',
      to: MetaProvider.normalizePhone(to),
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        // Meta rejects a `components` array with zero-length parameters for
        // a template that has no placeholders -- so this is only included
        // when there's actually something to fill in.
        ...(bodyParams.length
          ? { components: [{ type: 'body', parameters: bodyParams.map((v) => ({ type: 'text', text: String(v) })) }] }
          : {}),
      },
    };

    return this._post(body);
  }

  /**
   * Real media send via the Graph API, sent "by link" -- mediaUrl must
   * already be a durable, publicly-fetchable HTTPS URL (Cloudinary), NOT
   * something requiring auth to fetch, since Meta's own servers fetch it
   * directly. See provider.interface.js's sendMedia() doc comment.
   */
  async sendMedia({ to, mediaType, mediaUrl, caption, filename }) {
    if (!['image', 'document', 'audio'].includes(mediaType)) {
      throw new Error(`MetaProvider.sendMedia: unsupported mediaType "${mediaType}" -- only image, document, audio are implemented.`);
    }
    if (!mediaUrl) throw new Error('MetaProvider.sendMedia: mediaUrl is required');

    const effectiveUrl = mediaType === 'audio' ? MetaProvider.toMetaCompatibleAudioUrl(mediaUrl) : mediaUrl;

    const mediaObject = { link: effectiveUrl };
    // caption is valid for image/document, NOT for audio -- Meta rejects
    // the whole request if an audio object includes a caption field.
    if (caption && mediaType !== 'audio') mediaObject.caption = caption;
    // filename is only meaningful (and only accepted by Meta) for document type.
    if (filename && mediaType === 'document') mediaObject.filename = filename;
    // `voice: true` is what actually makes WhatsApp render this as the
    // native round voice-note bubble (waveform, mic icon, auto-download,
    // "played" receipts) instead of a generic playable media file --
    // confirmed via Meta's own docs, which show `voice` as a real,
    // separate field on the audio object alongside `link`. Delivery
    // format alone (the .m4a rewrite above) was NOT what controlled this
    // -- confirmed live: a working .m4a send without this flag still
    // rendered as a plain audio attachment, not a voice note.
    if (mediaType === 'audio') mediaObject.voice = true;

    const body = {
      messaging_product: 'whatsapp',
      to: MetaProvider.normalizePhone(to),
      type: mediaType,
      [mediaType]: mediaObject,
    };

    return this._post(body);
  }

  /** Shared POST + response-normalization for sendMessage/sendTemplate. */
  async _post(body) {
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