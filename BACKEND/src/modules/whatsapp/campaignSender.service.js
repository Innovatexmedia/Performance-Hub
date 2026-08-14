/**
 * campaignSender.service.js
 * ------------------------------------------------------------------
 * The piece that was missing: campaigns/broadcasts could be created,
 * approved, scheduled, and "started" -- but "started" only ever flipped a
 * status field. Nothing anywhere looped through the audience and actually
 * called WhatsApp's API. This file is that loop.
 *
 * Called (fire-and-forget, never awaited) from campaigns.service.js's
 * startCampaign() and broadcasts.service.js's startBroadcast(), right after
 * the real DB transition to RUNNING. Runs in the background so the HTTP
 * response returns immediately; progress is reflected via the same
 * campaign/broadcast document (metrics increment live) and a socket event
 * per recipient send, so the UI can update without polling.
 *
 * SCOPE / HONEST LIMITATIONS (flagged, not hidden):
 *   - Sends the template's own stored `variables` (its default/sample
 *     values) as the body parameters for EVERY recipient. There is no
 *     per-lead personalization (e.g. substituting each lead's real name)
 *     yet -- that would need a variable->lead-field mapping feature that
 *     doesn't exist. Every recipient gets the identical rendered message.
 *   - Sequential sends with a small delay between them, not a real queue/
 *     worker with retry-on-rate-limit backoff. Fine at current scale;
 *     would need a real job queue (e.g. BullMQ) before high-volume use.
 *   - Only the template's BODY component is filled in. Header/button
 *     dynamic parameters aren't supported (matches MetaProvider.sendTemplate's
 *     own documented scope).
 */

import { Lead } from '../leads/lead/lead.model.js';
import { leadRepository } from '../leads/lead/lead.repository.js';
import { activityService } from '../leads/activities/activity.service.js';
import { ACTIVITY_TYPE } from '../leads/activities/activity.model.js';
import { createTrackingEvent } from '../attribution/attribution.service.js';
import { TRACKING_EVENT_TYPE } from '../attribution/attribution.constants.js';
import { emitToTenant } from '../../realtime/socket.js';

import { conversationRepository } from './conversations/conversation.repository.js';
import { CONVERSATION_STATUS } from './conversations/conversation.model.js';
import { messageRepository } from './messages/message.repository.js';
import { MESSAGE_DIRECTION, MESSAGE_STATUS, MESSAGE_TYPE } from './messages/message.model.js';
import { resolveProvider } from './providers/provider.factory.js';
import { buildBodyParams, renderBody, validateTemplateParams } from './templateParams.js';

import { templatesRepository } from './submodules/templates/templates.repository.js';
import { APPROVAL_STATUS } from './submodules/templates/templates.constants.js';
import { deliveryLogsService } from './submodules/deliveryLogs/deliveryLogs.service.js';
import { SOURCE as LOG_SOURCE, DIRECTION as LOG_DIRECTION, MESSAGE_TYPE as LOG_MESSAGE_TYPE, DELIVERY_STATUS } from './submodules/deliveryLogs/deliveryLogs.constants.js';

import { campaignsRepository } from './submodules/campaigns/campaigns.repository.js';
import { buildAudienceQuery as buildCampaignAudienceQuery } from './submodules/campaigns/campaigns.service.js';
import { CAMPAIGN_STATUS, CAMPAIGN_ACTION } from './submodules/campaigns/campaigns.constants.js';

import { broadcastsRepository } from './submodules/broadcasts/broadcasts.repository.js';
import { buildBaseContactQuery } from './submodules/broadcasts/broadcasts.service.js';
import { BROADCAST_STATUS, BROADCAST_ACTION } from './submodules/broadcasts/broadcasts.constants.js';

// Gentle pacing between sends -- not a real rate-limit-aware backoff, just
// enough to avoid bursting Meta's API in an obvious way at current scale.
const SEND_DELAY_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function toDTO(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const { _id, ...rest } = o;
  return { id: String(_id ?? o.id), ...rest };
}

/** 'campaign' -> 'CAMPAIGN', 'broadcast' -> 'BROADCAST' -- matches Message.source_type's enum exactly. */
function kindToSourceType(cfg) {
  return cfg.payloadKey.toUpperCase();
}

/** Per-kind config -- the two resources are structurally parallel (same
 * lifecycle shape), so one sender implementation drives both. */
const KIND_CONFIG = {
  campaign: {
    repository: campaignsRepository,
    buildQuery: (tenantId, audience) => buildCampaignAudienceQuery(tenantId, audience?.filters || {}, audience?.includedContacts, audience?.excludedContacts),
    STATUS: CAMPAIGN_STATUS,
    ACTION: CAMPAIGN_ACTION,
    socketEvent: 'whatsapp:campaign',
    payloadKey: 'campaign',
    logSource: LOG_SOURCE.CAMPAIGN,
  },
  broadcast: {
    repository: broadcastsRepository,
    buildQuery: (tenantId, audience) => buildBaseContactQuery(tenantId, audience?.filters || {}),
    STATUS: BROADCAST_STATUS,
    ACTION: BROADCAST_ACTION,
    socketEvent: 'whatsapp:broadcast',
    payloadKey: 'broadcast',
    logSource: LOG_SOURCE.BROADCAST,
  },
};

async function getOrCreateConversation(ctx, lead, phone) {
  let conversation = await conversationRepository.findByPhone(ctx.tenantId, phone);
  if (!conversation) {
    conversation = await conversationRepository.create({
      tenant_id: ctx.tenantId,
      lead_id: String(lead._id),
      phone,
      contact_name: lead.name || '',
      status: CONVERSATION_STATUS.NEW,
      tags: [],
      unread_count: 0,
      last_message_preview: '',
      archived: false,
    });
  }
  return conversation;
}

async function sendToOneRecipient(ctx, { cfg, entity, template, lead }) {
  const phone = lead.whatsapp_number || lead.phone;

  // Parameters are derived from THIS lead against the approved body text --
  // see templateParams.js. Previously this was `template.variables`, a
  // static array that was both the wrong length (it included header/button
  // placeholders) and the wrong content (variable names, or Meta's example
  // values, sent verbatim to every recipient).
  const bodyParams = buildBodyParams(template, lead);

  if (lead.opt_out_status) {
    return { outcome: 'skipped_opt_out' };
  }
  if (!phone) {
    return { outcome: 'failed', reason: 'Lead has no WhatsApp number' };
  }

  const conversation = await getOrCreateConversation(ctx, lead, phone);
  const previewText = renderBody(template, lead);
  const provider = await resolveProvider(ctx);

  let transport;
  try {
    transport = await provider.sendTemplate({
      to: phone,
      templateName: template.name,
      languageCode: template.languageCode,
      bodyParams,
    });
  } catch (sendError) {
    const failedMessage = await messageRepository.create({
      tenant_id: ctx.tenantId,
      conversation_id: conversation._id,
      lead_id: lead._id,
      source_type: kindToSourceType(cfg),
      source_id: entity._id,
      direction: MESSAGE_DIRECTION.OUTBOUND,
      type: MESSAGE_TYPE.TEMPLATE,
      content: previewText,
      sender: ctx.userId || 'system',
      recipient: phone,
      provider: provider.name,
      status: MESSAGE_STATUS.FAILED,
    });
    await deliveryLogsService.createLog(ctx, {
      messageId: failedMessage._id,
      conversationId: conversation._id,
      leadId: lead._id,
      source: cfg.logSource,
      provider: provider.name === 'meta' ? 'META_CLOUD' : 'SIMULATION',
      phoneNumber: phone,
      direction: LOG_DIRECTION.OUTBOUND,
      messageType: LOG_MESSAGE_TYPE.TEMPLATE,
      status: DELIVERY_STATUS.FAILED,
    }).catch(() => {});
    emitToTenant(ctx.tenantId, 'whatsapp:message', { conversationId: String(conversation._id), message: toDTO(failedMessage) });
    return { outcome: 'failed', reason: sendError.message };
  }

  const message = await messageRepository.create({
    tenant_id: ctx.tenantId,
    conversation_id: conversation._id,
    lead_id: lead._id,
    source_type: kindToSourceType(cfg),
    source_id: entity._id,
    direction: MESSAGE_DIRECTION.OUTBOUND,
    type: MESSAGE_TYPE.TEMPLATE,
    content: previewText,
    sender: ctx.userId || 'system',
    recipient: phone,
    provider: transport.provider,
    status: transport.status || MESSAGE_STATUS.SENT,
    provider_message_id: transport.provider_message_id,
    sent_at: transport.sent_at || new Date(),
    delivered_at: transport.delivered_at || null,
  });

  await deliveryLogsService.createLog(ctx, {
    messageId: message._id,
    conversationId: conversation._id,
    leadId: lead._id,
    source: cfg.logSource,
    provider: transport.provider === 'meta' ? 'META_CLOUD' : 'SIMULATION',
    providerMessageId: transport.provider_message_id,
    phoneNumber: phone,
    direction: LOG_DIRECTION.OUTBOUND,
    messageType: LOG_MESSAGE_TYPE.TEMPLATE,
    status: DELIVERY_STATUS.SENT,
    sentAt: message.sent_at,
  }).catch(() => {});

  const updatedConversation = await conversationRepository.updateById(ctx.tenantId, conversation._id, {
    last_message_preview: previewText.slice(0, 120),
    last_message_at: message.sent_at,
  });

  await leadRepository.updateById(ctx.tenantId, lead._id, { last_contacted_at: message.sent_at });
  await activityService.log(ctx, lead._id, ACTIVITY_TYPE.WHATSAPP_MESSAGE_SENT, {
    message: `${entity.name}: template message sent`,
    meta: { conversation_id: String(conversation._id), message_id: String(message._id), source: cfg.payloadKey },
  });
  await createTrackingEvent({
    tenant_id: ctx.tenantId,
    event_type: TRACKING_EVENT_TYPE.WHATSAPP_OUTBOUND,
    lead_id: lead._id,
    metadata: { conversation_id: String(conversation._id), message_id: String(message._id), source: cfg.payloadKey },
  }).catch(() => {});

  emitToTenant(ctx.tenantId, 'whatsapp:message', { conversationId: String(conversation._id), message: toDTO(message) });
  emitToTenant(ctx.tenantId, 'whatsapp:conversation', {
    conversation: { id: String(updatedConversation._id), status: updatedConversation.status, unread_count: updatedConversation.unread_count, last_message_preview: updatedConversation.last_message_preview, last_message_at: updatedConversation.last_message_at },
  });

  return { outcome: 'sent' };
}

export const campaignSenderService = {
  /**
   * Entry point -- called fire-and-forget (never awaited) right after a
   * campaign/broadcast transitions to RUNNING. Errors here must NEVER
   * throw back into the caller's request/response cycle -- everything is
   * caught and turned into a failCampaign/failBroadcast transition instead.
   */
  async dispatch(ctx, { id, kind }) {
    const cfg = KIND_CONFIG[kind];
    if (!cfg) throw new Error(`campaignSenderService.dispatch: unknown kind "${kind}"`);

    console.log(`[CAMPAIGN_SEND] dispatch start -- kind=${kind} id=${id} tenant=${ctx.tenantId}`);

    try {
      const entity = await cfg.repository.findById(ctx.tenantId, id);
      if (!entity) {
        console.log(`[CAMPAIGN_SEND] ${kind} ${id} not found -- aborting (deleted mid-flight?)`);
        return;
      }

      const template = await templatesRepository.findById(ctx.tenantId, entity.templateId);
      if (!template || template.approvalStatus !== APPROVAL_STATUS.PROVIDER_APPROVED) {
        console.log(`[CAMPAIGN_SEND] ${kind} ${id} template not usable (found=${!!template}, approvalStatus=${template?.approvalStatus}) -- marking FAILED`);
        await this._markFailed(cfg, ctx, entity, 'Template is no longer provider-approved');
        return;
      }

      // Pre-flight: a parameter-count mismatch is fatal and identical for
      // every recipient (Meta error 132000). Catching it here costs one
      // check; catching it in the loop costs one failed send per contact,
      // plus a delivery-log row and a socket emit for each.
      const paramCheck = validateTemplateParams(template);
      if (!paramCheck.ok) {
        console.log(`[CAMPAIGN_SEND] ${kind} ${id} template parameter check failed -- ${paramCheck.reason}`);
        await this._markFailed(cfg, ctx, entity, `Template configuration error: ${paramCheck.reason}`);
        return;
      }

      const query = cfg.buildQuery(ctx.tenantId, entity.audience);
      const leads = await Lead.find(query);
      console.log(`[CAMPAIGN_SEND] ${kind} ${id} resolved ${leads.length} recipient(s) via query=${JSON.stringify(query)}`);

      if (leads.length === 0) {
        console.log(`[CAMPAIGN_SEND] ${kind} ${id} has zero recipients at send time -- marking FAILED`);
        await this._markFailed(cfg, ctx, entity, 'Zero recipients resolved at send time');
        return;
      }

      let sentCount = 0;
      let failedCount = 0;

      for (const lead of leads) {
        const phone = lead.whatsapp_number || lead.phone;
        console.log(`[CAMPAIGN_SEND] ${kind} ${id} -- sending to lead=${lead._id} phone=${phone}...`);

        const result = await sendToOneRecipient(ctx, { cfg, entity, template, lead });

        if (result.outcome === 'sent') {
          sentCount += 1;
          console.log(`[CAMPAIGN_SEND] ${kind} ${id} -- SENT to ${phone}`);
        } else if (result.outcome === 'failed') {
          failedCount += 1;
          console.log(`[CAMPAIGN_SEND] ${kind} ${id} -- FAILED to ${phone}: ${result.reason}`);
        } else {
          console.log(`[CAMPAIGN_SEND] ${kind} ${id} -- SKIPPED ${phone} (opted out)`);
        }

        await cfg.repository.updateMetrics(ctx.tenantId, id, {
          sentCount: result.outcome === 'sent' ? 1 : 0,
          failedCount: result.outcome === 'failed' ? 1 : 0,
        });

        // Live progress -- lets the UI refetch mid-run instead of only at
        // the very end, without needing to poll.
        const progress = await cfg.repository.findById(ctx.tenantId, id);
        emitToTenant(ctx.tenantId, cfg.socketEvent, { [`${cfg.payloadKey}Id`]: id, [cfg.payloadKey]: toDTO(progress) });

        if (leads.indexOf(lead) < leads.length - 1) await sleep(SEND_DELAY_MS);
      }

      console.log(`[CAMPAIGN_SEND] ${kind} ${id} loop finished -- sent=${sentCount} failed=${failedCount}`);

      if (sentCount > 0) {
        await this._markCompleted(cfg, ctx, entity, id);
        console.log(`[CAMPAIGN_SEND] ${kind} ${id} marked COMPLETED`);
      } else {
        await this._markFailed(cfg, ctx, entity, `All ${failedCount} send attempt(s) failed -- see delivery logs for details`);
        console.log(`[CAMPAIGN_SEND] ${kind} ${id} marked FAILED (zero successful sends)`);
      }
    } catch (err) {
      // Whatever unexpected thing happened, the entity must not sit stuck
      // in RUNNING forever with no explanation.
      console.error(`[CAMPAIGN_SEND] ${kind} ${id} threw unexpectedly:`, err);
      try {
        const entity = await cfg.repository.findById(ctx.tenantId, id);
        if (entity && entity.status === cfg.STATUS.RUNNING) {
          await this._markFailed(cfg, ctx, entity, err.message || 'Unexpected error during send');
        }
      } catch { /* best-effort -- do not throw out of a fire-and-forget task */ }
    }
  },

  async _markCompleted(cfg, ctx, entity, id) {
    const now = new Date();
    const auditEntry = { fromStatus: entity.status, toStatus: cfg.STATUS.COMPLETED, action: cfg.ACTION.COMPLETE, performedBy: null, performedAt: now, comment: 'Auto-completed after real send finished' };
    const updated = await (entity.status === cfg.STATUS.RUNNING
      ? cfg.repository.completeCampaign?.(ctx.tenantId, id, { performedBy: null, now, auditEntry })
        ?? cfg.repository.completeBroadcast?.(ctx.tenantId, id, { performedBy: null, now, auditEntry })
      : null);
    if (updated) emitToTenant(ctx.tenantId, cfg.socketEvent, { [`${cfg.payloadKey}Id`]: id, [cfg.payloadKey]: toDTO(updated) });
  },

  async _markFailed(cfg, ctx, entity, reason) {
    const auditEntry = { fromStatus: entity.status, toStatus: cfg.STATUS.FAILED, action: cfg.ACTION.FAIL, performedBy: null, performedAt: new Date(), comment: reason };
    const updated = await (cfg.repository.failCampaign?.(ctx.tenantId, entity._id, { failureReason: reason, performedBy: null, auditEntry })
      ?? cfg.repository.failBroadcast?.(ctx.tenantId, entity._id, { failureReason: reason, performedBy: null, auditEntry }));
    if (updated) emitToTenant(ctx.tenantId, cfg.socketEvent, { [`${cfg.payloadKey}Id`]: String(entity._id), [cfg.payloadKey]: toDTO(updated) });
  },
};