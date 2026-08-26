
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
import { buildBodyParams, renderBody } from './templateParams.js';

import { deliveryLogsService } from './submodules/deliveryLogs/deliveryLogs.service.js';
import { SOURCE as LOG_SOURCE, DIRECTION as LOG_DIRECTION, MESSAGE_TYPE as LOG_MESSAGE_TYPE, DELIVERY_STATUS } from './submodules/deliveryLogs/deliveryLogs.constants.js';

import { campaignsRepository } from './submodules/campaigns/campaigns.repository.js';
import { CAMPAIGN_STATUS, CAMPAIGN_ACTION } from './submodules/campaigns/campaigns.constants.js';

import { broadcastsRepository } from './submodules/broadcasts/broadcasts.repository.js';
import { BROADCAST_STATUS, BROADCAST_ACTION } from './submodules/broadcasts/broadcasts.constants.js';

export function toDTO(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const { _id, ...rest } = o;
  return { id: String(_id ?? o.id), ...rest };
}

/** 'campaign' -> 'CAMPAIGN', 'broadcast' -> 'BROADCAST' -- matches Message.source_type's enum exactly. */
export function kindToSourceType(cfg) {
  return cfg.payloadKey.toUpperCase();
}

/** Per-kind config -- the two resources are structurally parallel (same
 * lifecycle shape), so one sender implementation drives both. Exported
 * so the worker and the enqueue path both key off the exact same config,
 * never two independently-maintained copies. NOTE: `buildQuery` is set
 * by campaignSender.service.js at import time (see bottom of this file)
 * to avoid a circular import (campaigns.service.js / broadcasts.service.js
 * both import FROM the campaigns/broadcasts repository layer, and
 * campaignSender.service.js already imports those buildAudienceQuery
 * helpers directly -- wiring it there keeps this file dependency-light). */
export const KIND_CONFIG = {
  campaign: {
    repository: campaignsRepository,
    STATUS: CAMPAIGN_STATUS,
    ACTION: CAMPAIGN_ACTION,
    socketEvent: 'whatsapp:campaign',
    payloadKey: 'campaign',
    logSource: LOG_SOURCE.CAMPAIGN,
  },
  broadcast: {
    repository: broadcastsRepository,
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

/**
 * Sends one template message to one lead and records everything that
 * needs recording. Returns { outcome: 'sent' | 'failed' | 'skipped_opt_out', reason? }.
 * Never throws -- send failures are captured in the return value so the
 * caller (worker or old loop) can tally sent/failed counts without a
 * try/catch of its own.
 */
export async function sendToOneRecipient(ctx, { cfg, entity, template, lead }) {
  const phone = lead.whatsapp_number || lead.phone;

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
      header: template.header,
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