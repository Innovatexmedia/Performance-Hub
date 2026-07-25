// Shared utilities (adjust path to your repo — see README).
import {
  AppError,
  paginationMeta,
  normalizePaging,
} from '../../../shared/helpers/lead.helpers.js';

// Reused, read-only, from sibling modules (not modified).
import { leadRepository } from '../../leads/lead/lead.repository.js';
import { activityService } from '../../leads/activities/activity.service.js';
import { ACTIVITY_TYPE } from '../../leads/activities/activity.model.js';
import { dealRepository } from '../../pipeline/deals/deal.repository.js';
import { Payment } from '../../payments/payment.model.js';
import { emitToTenant } from '../../../realtime/socket.js';

import { conversationRepository } from './conversation.repository.js';
import { messageRepository } from '../messages/message.repository.js';
import { CONVERSATION_STATUS_VALUES } from './conversation.model.js';

function toConversationDTO(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const { _id, ...rest } = o;
  return { id: String(_id ?? o.id), ...rest };
}

function escapeRegex(str = '') {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a conversation list filter shared by the Inbox and Conversations
 * endpoints. Supports name/phone search, status, owner, tags, unreadOnly.
 */
export function buildConversationFilter(query = {}) {
  const filter = {};
  if (query.includeArchived !== 'true') filter.archived = false;

  if (query.status) {
    if (!CONVERSATION_STATUS_VALUES.includes(query.status)) {
      throw AppError.badRequest(`Invalid status filter: ${query.status}`);
    }
    filter.status = query.status;
  }
  if (query.assigned_user_id) filter.assigned_user_id = String(query.assigned_user_id).trim();

  if (query.tags) {
    const tags = Array.isArray(query.tags)
      ? query.tags
      : String(query.tags).split(',').map((t) => t.trim()).filter(Boolean);
    if (tags.length) filter.tags = { $all: tags };
  }

  if (query.unreadOnly === 'true') filter.unread_count = { $gt: 0 };

  const search = query.search || query.name || query.phone;
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ contact_name: rx }, { phone: rx }];
  }

  return filter;
}

async function buildLeadContext(ctx, leadId) {
  if (!leadId) return null;
  const lead = await leadRepository.findById(ctx.tenantId, leadId);
  if (!lead) return null;

  let pipelineStage = null;
  try {
    const deals = await dealRepository.findByLead(ctx.tenantId, leadId);
    const active = deals.find((d) => !d.archived) || deals[0];
    pipelineStage = active ? active.stage : null;
  } catch {
    pipelineStage = null; // pipeline module optional
  }

  // FRONTEND_SPEC.md section 5 requires "payment status" in the lead
  // context panel -- most recent payment for this lead, if any.
  let paymentStatus = null;
  try {
    const latestPayment = await Payment
      .findOne({ tenant_id: ctx.tenantId, lead_id: leadId })
      .sort({ created_at: -1 });
    paymentStatus = latestPayment ? latestPayment.status : null;
  } catch {
    paymentStatus = null; // payments module optional
  }

  return {
    lead_id: String(lead._id),
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    company: lead.company,
    qualification_score: lead.qualification_score,
    source: lead.source,
    lead_temperature: lead.lead_temperature,
    status: lead.status,
    pipeline_stage: pipelineStage,
    payment_status: paymentStatus,
    // UTM lineage -- FRONTEND_SPEC section 5: "score, source, UTM, pipeline
    // stage, payment status..." -- was missing entirely before this fix.
    utm_source: lead.utm_source,
    utm_medium: lead.utm_medium,
    utm_campaign: lead.utm_campaign,
    value: lead.value,
    last_contacted_at: lead.last_contacted_at,
  };
}

export const conversationService = {
  toConversationDTO,
  buildConversationFilter,

  async createConversation(ctx, data) {
    const conversation = await conversationRepository.create({
      tenant_id: ctx.tenantId,
      ...data,
    });
    return toConversationDTO(conversation);
  },

  async getConversations(ctx, query) {
    const filter = buildConversationFilter(query);
    const { page, limit, skip } = normalizePaging(query);

    const [items, total] = await Promise.all([
      conversationRepository.find(ctx.tenantId, filter, {
        sort: { last_message_at: -1 },
        skip,
        limit,
      }),
      conversationRepository.count(ctx.tenantId, filter),
    ]);

    return {
      data: items.map(toConversationDTO),
      pagination: paginationMeta({ page, limit, total }),
    };
  },

  async getConversationOrThrow(ctx, id) {
    const conversation = await conversationRepository.findById(ctx.tenantId, id);
    if (!conversation) throw AppError.notFound('Conversation not found');
    return conversation;
  },

  /** 3-pane detail: conversation + messages + lead context. Marks as read. */
  async getConversationDetails(ctx, id) {
    const conversation = await this.getConversationOrThrow(ctx, id);

    const [messages] = await Promise.all([
      messageRepository.findByConversation(ctx.tenantId, id, {
        sort: { created_at: 1 },
        skip: 0,
        limit: 200,
      }),
      messageRepository.markConversationRead(ctx.tenantId, id),
    ]);

    const fresh = await conversationRepository.resetUnread(ctx.tenantId, id);
    const leadContext = await buildLeadContext(ctx, conversation.lead_id);

    return {
      conversation: toConversationDTO(fresh || conversation),
      messages: messages.map((m) => {
        const o = m.toObject();
        const { _id, ...rest } = o;
        return { id: String(_id), ...rest };
      }),
      leadContext,
    };
  },

  //new added code for testing
  

  async assign(ctx, id, userId) {
    if (!userId) throw AppError.badRequest('userId is required');
    const conversation = await this.getConversationOrThrow(ctx, id);

    const updated = await conversationRepository.updateById(ctx.tenantId, id, {
      assigned_user_id: userId,
    });

    if (conversation.lead_id) {
      await activityService.log(ctx, conversation.lead_id, ACTIVITY_TYPE.WHATSAPP_ASSIGNED, {
        message: `WhatsApp conversation assigned to ${userId}`,
        meta: { conversation_id: id, to: userId },
      });
    }

    emitToTenant(ctx.tenantId, 'whatsapp:conversation', { conversation: toConversationDTO(updated) });
    return toConversationDTO(updated);
  },

  async changeStatus(ctx, id, status) {
    if (!CONVERSATION_STATUS_VALUES.includes(status)) {
      throw AppError.badRequest(`Invalid status: ${status}`);
    }
    const conversation = await this.getConversationOrThrow(ctx, id);

    const updated = await conversationRepository.updateById(ctx.tenantId, id, {
      status,
    });

    if (conversation.lead_id) {
      await activityService.log(ctx, conversation.lead_id, ACTIVITY_TYPE.WHATSAPP_STATUS_CHANGED, {
        message: `WhatsApp conversation status → ${status}`,
        meta: { conversation_id: id, from: conversation.status, to: status },
      });
    }

    emitToTenant(ctx.tenantId, 'whatsapp:conversation', { conversation: toConversationDTO(updated) });
    return toConversationDTO(updated);
  },
};