import crypto from 'crypto';
import { AppError } from '../../../shared/helpers/lead.helpers.js';
import { whatsappSettingsService } from '../submodules/whatsappSettings/whatsappSettings.service.js';
import { templateApprovalService } from '../submodules/templateApproval/templateApproval.service.js';
import { deliveryLogsService } from '../submodules/deliveryLogs/deliveryLogs.service.js';
import { conversationRepository } from '../conversations/conversation.repository.js';
import { messageRepository } from '../messages/message.repository.js';
import { messageService } from '../messages/message.service.js';
import { fetchAndUploadToCloudinary } from '../../../shared/services/cloudinary.service.js';
import { toDTO } from '../messageSender.js';
import { MESSAGE_STATUS } from '../messages/message.model.js';
import { CONVERSATION_STATUS } from '../conversations/conversation.model.js';
import { leadRepository } from '../../leads/lead/lead.repository.js';
import { leadService } from '../../leads/lead/lead.service.js';
import { campaignsRepository } from '../submodules/campaigns/campaigns.repository.js';
import { broadcastsRepository } from '../submodules/broadcasts/broadcasts.repository.js';
import { emitToTenant } from '../../../realtime/socket.js';
import { handleInboundKeyword } from '../submodules/consent/consentGuard.service.js';
import { automationRulesService } from '../submodules/automationRules/automationRules.service.js';
import { TRIGGER_TYPE } from '../submodules/automationRules/automationRules.constants.js';

const META_STATUS_MAP = {
  sent: MESSAGE_STATUS.SENT,
  delivered: MESSAGE_STATUS.DELIVERED,
  read: MESSAGE_STATUS.READ,
  failed: MESSAGE_STATUS.FAILED,
};

/** Same Meta status strings, mapped onto V2 deliveryLogs' UPPERCASE DELIVERY_STATUS values. */
const DELIVERY_STATUS_FROM_META_STATUS = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

/**
 * Meta's real template-rejection `reason` strings (INVALID_FORMAT,
 * ABUSIVE_CONTENT, SCAM, TAG_CONTENT_MISMATCH, INCORRECT_CATEGORY, ...)
 * don't line up with our own PROVIDER_REJECTION_REASON enum (SPAM,
 * POLICY_VIOLATION, MISLEADING_CLAIMS, VARIABLE_USAGE, FORMATTING, OTHER)
 * -- best-effort map; anything unmapped falls back to OTHER rather than
 * failing validation and losing the event.
 */
const META_REJECTION_REASON_MAP = {
  INVALID_FORMAT: 'FORMATTING',
  SCAM: 'SPAM',
  ABUSIVE_CONTENT: 'POLICY_VIOLATION',
  TAG_CONTENT_MISMATCH: 'MISLEADING_CLAIMS',
  INCORRECT_CATEGORY: 'POLICY_VIOLATION',
};

function verifySignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !appSecret) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function getTenantMetaConfig(tenantId) {
  const config = await whatsappSettingsService.getProviderConfig({ tenantId });
  if (!config?.meta) throw AppError.notFound('WhatsApp settings not configured for this tenant');
  return config;
}

async function findOrCreateLeadAndConversation(ctx, waId, profileName) {
  let lead = await leadRepository.findByWhatsAppNumber(ctx.tenantId, waId);
  console.log(`[WA_INBOUND_DEV] Lead lookup for ${waId}: ${lead ? 'FOUND existing lead ' + (lead.id || lead._id) : 'not found -- will create new'}`);

  if (lead?.archived) {
    // Confirmed real bug this fixes: findByWhatsAppNumber used to exclude
    // archived leads, so a real customer texting again after being
    // archived got a brand-new duplicate lead instead of reviving the
    // one that already existed for their number.
    lead = await leadRepository.unarchiveById(ctx.tenantId, lead._id);
    console.log(`[WA_INBOUND_DEV] Lead ${lead.id || lead._id} was archived -- un-archived on real inbound message`);
  }

  if (!lead) {
    lead = await leadService.createLead(
      ctx,
      {
        name: profileName || waId,
        phone: waId,
        whatsapp_number: waId,
        source: 'WhatsApp',
        status: 'New',
        consent_status: 'granted',
      },
      { skipDuplicateCheck: true },
    );
    console.log(`[WA_INBOUND_DEV] Created new lead: ${lead.id || lead._id}`);
  }

  const leadId = lead.id || String(lead._id);
  let conversation = await conversationRepository.findByPhone(ctx.tenantId, waId);
  console.log(`[WA_INBOUND_DEV] Conversation lookup for ${waId}: ${conversation ? 'FOUND existing conversation ' + conversation._id : 'not found -- will create new'}`);

  if (!conversation) {
    conversation = await conversationRepository.create({
      tenant_id: ctx.tenantId,
      lead_id: leadId,
      phone: waId,
      contact_name: profileName || '',
      status: CONVERSATION_STATUS.NEW,
      tags: [],
      unread_count: 0,
      last_message_preview: '',
      archived: false,
    });
    console.log(`[WA_INBOUND_DEV] Created new conversation: ${conversation._id}`);
  }

  return conversation;
}

function toEntityDTO(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const { _id, ...rest } = o;
  return { id: String(_id ?? o.id), ...rest };
}

/**
 * Bumps one metric field (deliveredCount/readCount/repliedCount) on the
 * campaign/broadcast a message came from, and pushes the same live
 * 'whatsapp:campaign'/'whatsapp:broadcast' event the sender uses -- so a
 * campaign card's numbers keep moving after the initial send, as real
 * delivery/read/reply events arrive from Meta, not just at send time.
 * No-op (not an error) if the message has no source_type -- most
 * messages are manual Inbox sends or inbound, which don't have one.
 */
async function bumpCampaignMetric(tenantId, message, metricKey) {
  if (!message?.source_type || !message?.source_id) return;

  const isCampaign = message.source_type === 'CAMPAIGN';
  const repository = isCampaign ? campaignsRepository : broadcastsRepository;
  const socketEvent = isCampaign ? 'whatsapp:campaign' : 'whatsapp:broadcast';
  const payloadKey = isCampaign ? 'campaign' : 'broadcast';

  await repository.updateMetrics(tenantId, message.source_id, { [metricKey]: 1 });
  const updated = await repository.findById(tenantId, message.source_id);
  if (updated) {
    emitToTenant(tenantId, socketEvent, { [`${payloadKey}Id`]: String(message.source_id), [payloadKey]: toEntityDTO(updated) });
  }
}


export const metaWebhookService = {
  async handleVerification(tenantId, query) {
    const config = await getTenantMetaConfig(tenantId);
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    console.log(`[WA_INBOUND_DEV] handleVerification -- received token="${token}" vs saved token="${config.meta.verifyToken}" -- match=${token === config.meta.verifyToken}`);

    if (mode === 'subscribe' && token && token === config.meta.verifyToken) {
      return { verified: true, challenge };
    }
    throw AppError.forbidden('Webhook verification failed -- token mismatch');
  },

  async processPayload(tenantId, payload) {
    const ctx = { tenantId, userId: null, role: 'system' };
    const entries = payload?.entry || [];
    console.log(`[WA_INBOUND_DEV] processPayload -- ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} in payload`);

    for (const entry of entries) {
      for (const change of entry?.changes || []) {
        const field = change?.field;
        const value = change?.value;
        if (!value) continue;

        // Meta sends every subscribed field to this same URL -- `field`
        // is how they're told apart. Template approval/rejection events
        // have a completely different value shape (event, message_template_id,
        // message_template_name, reason) with no `messages`/`statuses`
        // arrays at all, so they MUST be branched out here rather than
        // falling through into the messages/statuses loops below, which
        // would just silently find nothing and do nothing.
        if (field === 'message_template_status_update') {
          await this._handleTemplateStatusUpdate(value);
          continue;
        }

        // Default path: 'messages' field (or unlabeled, for backward
        // compatibility with payloads that don't set `field` at all) --
        // inbound messages + delivery/read/failed status updates.
        const profileByWaId = {};
        for (const contact of value.contacts || []) {
          if (contact?.wa_id) profileByWaId[contact.wa_id] = contact.profile?.name || '';
        }

        console.log(`[WA_INBOUND_DEV] change.value has ${(value.messages || []).length} message(s) and ${(value.statuses || []).length} status update(s)`);

        for (const msg of value.messages || []) {
          console.log(`[WA_INBOUND_DEV] Processing inbound message from ${msg.from}, type=${msg.type}, id=${msg.id}`);
          await this._handleInboundMessage(ctx, msg, profileByWaId[msg.from]);
          console.log(`[WA_INBOUND_DEV] Inbound message from ${msg.from} recorded successfully`);
        }

        for (const status of value.statuses || []) {
          console.log(`[WA_INBOUND_DEV] Processing status update: id=${status.id} status=${status.status}`);
          await this._handleStatusUpdate(ctx, status);
        }
      }
    }

    return { processed: true };
  },

  /**
   * Maps a real Meta inbound message payload to our internal type +
   * media, downloading the actual file bytes from Meta and storing them
   * durably in Cloudinary. Meta's own media URL is short-lived AND
   * requires the tenant's access token to even fetch -- useless to store
   * directly, since it won't still work by the time someone opens the
   * conversation later.
   *
   * Returns { content, type, media } -- media is null for text (or for
   * any type we don't have real support for yet: video, sticker,
   * location, contacts, interactive replies -- same honest "not yet
   * supported" placeholder as before for those, not a silent failure).
   */
  async _resolveInboundContent(ctx, msg) {
    if (msg.type === 'text') {
      return { content: msg.text?.body || '', type: 'text', media: null };
    }

    // Button/interactive replies -- a customer tapping a Quick Reply
    // button on a template we sent, or a button/list reply on an actual
    // interactive message, arrives with NO text at msg.text at all, the
    // reply's label lives in a completely different shape per Meta's
    // webhook payload. Treated as a real text message (what the customer
    // effectively "said" is the button's label) rather than the generic
    // "not yet supported" placeholder -- an agent needs to see "Yes" or
    // "Book a call" in the thread, not an opaque type name.
    if (msg.type === 'button') {
      return { content: msg.button?.text || '[button reply]', type: 'text', media: null };
    }
    if (msg.type === 'interactive') {
      const reply = msg.interactive?.button_reply || msg.interactive?.list_reply;
      return { content: reply?.title || '[interactive reply]', type: 'text', media: null };
    }

    // WhatsApp stickers are static/animated WEBP images -- Meta's webhook
    // shape for them (msg.sticker.id, .mime_type) is structurally
    // identical to msg.image, so they're treated as regular images here
    // (WEBP renders natively in <img>, no separate sticker UI/schema
    // needed for a business inbox to genuinely "support" receiving them).
    const MEDIA_TYPES = { image: 'image', document: 'document', audio: 'audio', sticker: 'image' };
    const ourType = MEDIA_TYPES[msg.type];
    if (!ourType) {
      // video, location, contacts, order, system, unknown, etc. --
      // genuinely not implemented yet, same as before this fix.
      return { content: `[${msg.type} message -- content type not yet supported]`, type: 'text', media: null };
    }

    return { type: ourType }; // caller does the actual (slow) fetch separately -- see _fetchAndAttachInboundMedia
  },

  /**
   * The slow part of receiving media -- Meta media lookup + download +
   * Cloudinary re-upload (can genuinely take several seconds for a
   * larger file). Deliberately NOT called synchronously from
   * _handleInboundMessage anymore: it used to be awaited before the
   * message even got created, so the CRM showed NOTHING for however long
   * this took, then a fully-loaded bubble would suddenly appear -- felt
   * "late" compared to real WhatsApp, which shows a message bubble the
   * instant it arrives (with a downloading state) and fills in the media
   * once it's ready. Now: _handleInboundMessage creates a placeholder
   * message immediately (media_url: null) and returns right away; THIS
   * function runs in the background (fire-and-forget from the caller)
   * and updates that same message + pushes a second socket event once
   * the real file is ready.
   */
  async _fetchAndAttachInboundMedia(ctx, msg, ourType, messageId) {
    const metaMedia = msg[msg.type];
    const mediaId = metaMedia?.id;
    if (!mediaId) {
      await this._finishInboundMediaPlaceholder(ctx, messageId, { content: `[${msg.type} message -- no media id in payload]`, type: 'text' });
      return;
    }

    try {
      const config = await whatsappSettingsService.getProviderConfig(ctx);
      const { accessToken, graphApiVersion = 'v21.0' } = config.meta || {};
      if (!accessToken) throw new Error('No Meta access token configured for this tenant');

      // Step 1: resolve the media_id to Meta's own (short-lived,
      // auth-gated) URL.
      const metaResponse = await fetch(`https://graph.facebook.com/${graphApiVersion}/${mediaId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!metaResponse.ok) throw new Error(`Meta media lookup failed (status ${metaResponse.status})`);
      const metaMediaInfo = await metaResponse.json();

      // Step 2: download the actual bytes from that URL (same Bearer
      // token required) and re-upload to Cloudinary in one step.
      const uploaded = await fetchAndUploadToCloudinary(metaMediaInfo.url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        mimeType: metaMediaInfo.mime_type || metaMedia.mime_type,
        filename: metaMedia.filename || `${msg.type}-${mediaId}`,
      });

      await this._finishInboundMediaPlaceholder(ctx, messageId, {
        content: metaMedia.caption || '',
        type: ourType,
        media: {
          url: uploaded.url,
          filename: metaMedia.filename || null,
          mimeType: metaMediaInfo.mime_type || metaMedia.mime_type || null,
          sizeBytes: metaMediaInfo.file_size || null,
        },
      });
    } catch (err) {
      // A media download/upload failure must NEVER crash the whole
      // webhook handler -- fall back to the honest placeholder, log why,
      // and keep going. The customer's message still gets recorded, just
      // without the actual file attached.
      console.error(`[WA_INBOUND] Failed to fetch/store ${msg.type} media (id=${mediaId}) for tenant ${ctx.tenantId}:`, err.message);
      await this._finishInboundMediaPlaceholder(ctx, messageId, { content: `[${msg.type} message -- could not retrieve media: ${err.message}]`, type: 'text' });
    }
  },

  /** Updates the placeholder message created in _handleInboundMessage
   * with the real (or failed-fallback) content, and pushes the second
   * "media is ready" socket event the frontend swaps the placeholder
   * bubble for. */
  async _finishInboundMediaPlaceholder(ctx, messageId, { content, type, media }) {
    const patch = {
      content,
      type,
      media_url: media?.url ?? null,
      media_filename: media?.filename ?? null,
      media_mime_type: media?.mimeType ?? null,
      media_size_bytes: media?.sizeBytes ?? null,
    };
    const updated = await messageRepository.updateById(ctx.tenantId, messageId, patch);
    if (updated) {
      emitToTenant(ctx.tenantId, 'whatsapp:message', {
        conversationId: String(updated.conversation_id),
        message: toDTO(updated),
      });
    }
  },

  async _handleInboundMessage(ctx, msg, profileName) {
    const conversation = await findOrCreateLeadAndConversation(ctx, msg.from, profileName);
    const { content, type, media } = await this._resolveInboundContent(ctx, msg);
    const isPendingMedia = media === undefined; // media types return { type } only, no content/media yet -- see _resolveInboundContent

    const result = await messageService.recordInboundMessage(ctx, conversation, {
      content: isPendingMedia ? '' : content,
      type,
      media: isPendingMedia ? null : media,
      transport: {
        provider: 'meta',
        provider_message_id: msg.id,
        status: MESSAGE_STATUS.DELIVERED,
        received_at: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date(),
      },
    });

    // The slow part -- runs in the background, NOT awaited here, so this
    // function (and the webhook's HTTP response to Meta) returns quickly
    // regardless of how long the real media fetch takes. See
    // _fetchAndAttachInboundMedia's comment for why.
    if (isPendingMedia) {
      void this._fetchAndAttachInboundMedia(ctx, msg, type, result.message.id);
    }

    // Real, automatic opt-out/opt-in keyword detection -- previously
    // Consent only ever changed via an agent manually clicking a button
    // in the Consent tab, so a customer texting "STOP" here had zero
    // effect on whether Campaigns/Broadcasts/Nurture would keep
    // messaging them. Fire-and-forget-safe: handleInboundKeyword never
    // throws, and a no-op for any non-keyword message is nearly free
    // (one indexed findByPhone lookup only when the text matches).
    if (!isPendingMedia && type === 'text') {
      await handleInboundKeyword(ctx, msg.from, content);
    }

    // Real Automation Rules dispatch for MESSAGE_RECEIVED -- same
    // previously-completely-idle dispatch() as LEAD_CREATED (see
    // lead.service.js's createLead). Fire-and-forget: a slow or failing
    // rule must never delay the webhook's response to Meta or block
    // inbound message recording, which already happened above.
    if (conversation.lead_id) {
      automationRulesService
        .dispatch(ctx, TRIGGER_TYPE.MESSAGE_RECEIVED, {
          leadId: String(conversation.lead_id),
          contactId: String(conversation._id),
          message: { content: isPendingMedia ? '' : content, type },
        })
        .catch((err) => {
          console.warn(`[automation] MESSAGE_RECEIVED dispatch failed for conversation ${conversation._id}: ${err.message}`);
        });
    }

    // Real "Replied" tracking: if the most recent outbound message in this
    // conversation was a campaign/broadcast send that hasn't already been
    // counted as replied-to, this inbound message counts as that reply --
    // once per send, so a chatty back-and-forth doesn't inflate the count.
    try {
      const lastOutbound = await messageRepository.findLatestUnrepliedCampaignMessage(ctx.tenantId, conversation._id);
      if (lastOutbound) {
        await messageRepository.updateById(ctx.tenantId, lastOutbound._id, { replied_at: new Date() });
        await bumpCampaignMetric(ctx.tenantId, lastOutbound, 'repliedCount');
      }
    } catch (err) {
      console.log(`[WA_CAMPAIGN_METRICS] Failed to attribute reply in conversation ${conversation._id} -- ${err.message}`);
    }
  },

  async _handleStatusUpdate(ctx, status) {
    const mapped = META_STATUS_MAP[status.status];
    if (!mapped) {
      console.log(`[WA_INBOUND_DEV] Unknown status value "${status.status}" -- ignoring`);
      return;
    }

    const message = await messageRepository.findByProviderMessageId(ctx.tenantId, status.id);
    if (!message) {
      console.log(`[WA_INBOUND_DEV] Status update for provider_message_id=${status.id} but no matching message found in DB -- ignoring`);
    } else {
      const patch = { status: mapped };
      if (mapped === MESSAGE_STATUS.DELIVERED) patch.delivered_at = new Date(Number(status.timestamp) * 1000);
      if (mapped === MESSAGE_STATUS.READ) patch.read_at = new Date(Number(status.timestamp) * 1000);
      const updated = await messageRepository.updateById(ctx.tenantId, message._id, patch);
      console.log(`[WA_INBOUND_DEV] Updated message ${message._id} status -> ${mapped}`);

      // REAL-TIME PUSH -- was completely missing. The DB update above was
      // already correct, but nothing ever told a connected browser tab
      // this happened, so a message's tick only ever advanced (Sent ->
      // Delivered -> Read) after some UNRELATED action forced a refetch
      // (switching conversations, reloading, etc.) -- looked like a long,
      // inconsistent "delay" even though the underlying data was already
      // up to date within milliseconds of Meta's webhook arriving. Same
      // event shape as every other message push (see message.service.js /
      // messageSender.js) so the frontend's existing useWhatsAppRealtime
      // handling needs zero changes to pick this up.
      if (updated) {
        emitToTenant(ctx.tenantId, 'whatsapp:message', {
          conversationId: String(updated.conversation_id),
          message: toDTO(updated),
        });
      }

      // If this message was sent as part of a campaign/broadcast, its
      // real Delivered/Read counts move here -- this is the only place
      // that happens, since send-time only ever knows "Sent".
      if (mapped === MESSAGE_STATUS.DELIVERED) {
        await bumpCampaignMetric(ctx.tenantId, message, 'deliveredCount').catch((err) => {
          console.log(`[WA_CAMPAIGN_METRICS] Failed to bump deliveredCount for message ${message._id} -- ${err.message}`);
        });
      }
      if (mapped === MESSAGE_STATUS.READ) {
        await bumpCampaignMetric(ctx.tenantId, message, 'readCount').catch((err) => {
          console.log(`[WA_CAMPAIGN_METRICS] Failed to bump readCount for message ${message._id} -- ${err.message}`);
        });
      }
    }

    // Mirror the same status onto the V2 delivery-logs entry created at
    // send time (see message.service.js#sendMessage's deliveryLogsService
    // .createLog() call). This was missing entirely before -- only the
    // Message document above was ever updated, so deliveryLogs.status
    // stayed stuck at SENT forever and the Delivery Logs tab's
    // Delivered/Read counts and delivery rate never moved past 0, even
    // for messages that genuinely delivered.
    const deliveryStatus = DELIVERY_STATUS_FROM_META_STATUS[status.status];
    if (deliveryStatus) {
      await deliveryLogsService
        .processWebhook({
          tenantId: ctx.tenantId,
          providerMessageId: status.id,
          status: deliveryStatus,
          failureReason: status.status === 'failed' ? 'PROVIDER_ERROR' : undefined,
          failureCode: status.errors?.[0]?.code != null ? String(status.errors[0].code) : undefined,
          providerPayload: status,
        })
        .catch((err) => {
          console.log(`[WA_DELIVERY_SYNC] Could not update delivery log for provider_message_id=${status.id} -- ${err.message}`);
        });
    }
  },

  /**
   * Handles Meta's message_template_status_update webhook field --
   * template approved/rejected/paused/disabled by Meta's real review.
   * Resolves the template by providerTemplateId (Meta's message_template_id,
   * matches providerMetadata.providerTemplateId stored at submit time --
   * see templateApprovalRepository.findByProviderTemplateId).
   */
  async _handleTemplateStatusUpdate(value) {
    const { event, message_template_id: providerTemplateId, reason } = value || {};
    console.log(`[WA_TEMPLATE_WEBHOOK] event=${event} providerTemplateId=${providerTemplateId} reason=${reason || '(none)'}`);

    if (!providerTemplateId) {
      console.log('[WA_TEMPLATE_WEBHOOK] Missing message_template_id -- ignoring');
      return;
    }

    const payload = { providerTemplateId };

    try {
      switch (event) {
        case 'APPROVED':
          await templateApprovalService.providerApproved(payload);
          break;
        case 'REJECTED':
          await templateApprovalService.providerRejected({
            ...payload,
            providerRejectionReason: META_REJECTION_REASON_MAP[reason] || 'OTHER',
            providerRejectionMessage: reason || null,
          });
          break;
        case 'PAUSED':
          await templateApprovalService.providerPaused(payload);
          break;
        case 'DISABLED':
          await templateApprovalService.providerDisabled(payload);
          break;
        default:
          console.log(`[WA_TEMPLATE_WEBHOOK] Unhandled event "${event}" -- ignoring`);
          return;
      }
      console.log(`[WA_TEMPLATE_WEBHOOK] Processed "${event}" for providerTemplateId=${providerTemplateId}`);
    } catch (err) {
      // Best-effort: Meta redelivers webhooks, and a retry of an
      // already-processed event (or one that no longer matches the
      // template's current approvalStatus/ALLOWED_TRANSITIONS) should
      // not crash processing of the rest of this payload.
      console.log(`[WA_TEMPLATE_WEBHOOK] Failed to process "${event}" for providerTemplateId=${providerTemplateId} -- ${err.message}`);
    }
  },

  verifySignature,
};