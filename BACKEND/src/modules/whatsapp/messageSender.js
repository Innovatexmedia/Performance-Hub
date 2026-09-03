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

import { assertSendAllowed } from './submodules/consent/consentGuard.service.js';
import { TRIGGER_TYPE as AUTOMATION_TRIGGER_TYPE } from './submodules/automationRules/automationRules.constants.js';
// automationRulesService itself is imported dynamically at the dispatch
// call site below, NOT statically here -- automationRules.service.js
// already imports sendToOneRecipient FROM this file (for its
// SEND_TEMPLATE action), so a static import in both directions would be
// circular. automationRules.constants.js has no such cycle, so TRIGGER_TYPE
// above is fine as a normal static import.

export function toDTO(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const { _id, ...rest } = o;
  return { id: String(_id ?? o.id), ...rest };
}

/** 'campaign' -> 'CAMPAIGN', 'broadcast' -> 'BROADCAST' -- matches Message.source_type's enum exactly. null cfg (a standalone send, e.g. from an Automation Rule) means no source tracking, which the schema already allows (source_type is nullable). */
export function kindToSourceType(cfg) {
  return cfg ? cfg.payloadKey.toUpperCase() : null;
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
 *
 * cfg/entity are OPTIONAL -- omit both for a standalone send with no
 * parent Campaign/Broadcast (e.g. Automation Rules' SEND_TEMPLATE
 * action). When omitted, source_type/source_id are left null (the
 * schema already allows this) and activity-log/delivery-log source
 * fall back to a generic label instead of the campaign/broadcast name.
 */
export async function sendToOneRecipient(ctx, { cfg = null, entity = null, template, lead }) {
  const phone = lead.whatsapp_number || lead.phone;

  const bodyParams = buildBodyParams(template, lead);

  if (!phone) {
    return { outcome: 'failed', reason: 'Lead has no WhatsApp number' };
  }

  // The real, final compliance gate -- checks WhatsAppConsent directly
  // (the source of truth), not the denormalised lead.opt_out_status
  // boolean, which is only used upstream to build the audience list
  // cheaply. Fails closed: a consent record that can't be verified
  // blocks the send. See consentGuard.service.js.
  const consentCheck = await assertSendAllowed(ctx.tenantId, phone);
  if (!consentCheck.allowed) {
    return { outcome: 'skipped_opt_out', reason: consentCheck.reason };
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
      source_id: entity?._id ?? null,
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
      source: cfg?.logSource ?? LOG_SOURCE.AUTOMATION_RULE,
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
    source_id: entity?._id ?? null,
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
    source: cfg?.logSource ?? LOG_SOURCE.AUTOMATION_RULE,
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
    message: `${entity?.name ?? 'Automation rule'}: template message sent`,
    meta: { conversation_id: String(conversation._id), message_id: String(message._id), source: cfg?.payloadKey ?? 'automation' },
  });
  await createTrackingEvent({
    tenant_id: ctx.tenantId,
    event_type: TRACKING_EVENT_TYPE.WHATSAPP_OUTBOUND,
    lead_id: lead._id,
    metadata: { conversation_id: String(conversation._id), message_id: String(message._id), source: cfg?.payloadKey ?? 'automation' },
  }).catch(() => {});

  emitToTenant(ctx.tenantId, 'whatsapp:message', { conversationId: String(conversation._id), message: toDTO(message) });
  emitToTenant(ctx.tenantId, 'whatsapp:conversation', {
    conversation: { id: String(updatedConversation._id), status: updatedConversation.status, unread_count: updatedConversation.unread_count, last_message_preview: updatedConversation.last_message_preview, last_message_at: updatedConversation.last_message_at },
  });

  // Real Automation Rules dispatch for MESSAGE_SENT -- same
  // previously-idle dispatch() as the other real trigger sites. Dynamic
  // import: see the top-of-file note on the circular dependency this
  // avoids.
  import('./submodules/automationRules/automationRules.service.js').then(({ automationRulesService }) =>
    automationRulesService.dispatch(ctx, AUTOMATION_TRIGGER_TYPE.MESSAGE_SENT, {
      leadId: String(lead._id),
      contactId: String(conversation._id),
      message: { content: previewText },
    }),
  ).catch((err) => {
    console.warn(`[automation] MESSAGE_SENT dispatch failed for message ${message._id}: ${err.message}`);
  });

  return { outcome: 'sent' };
}