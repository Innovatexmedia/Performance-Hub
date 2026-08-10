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
import { hasRole, ROLES } from '../../auth/constants/roles.js';

import { conversationRepository } from './conversation.repository.js';
import { messageRepository } from '../messages/message.repository.js';
import { CONVERSATION_STATUS, CONVERSATION_STATUS_VALUES } from './conversation.model.js';

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

  /**
   * findOrCreateForLead -- the real "open WhatsApp for this lead" entry
   * point, called from the Lead Detail drawer's WhatsApp quick action.
   * Reuses conversationRepository.findByPhone's normalized last-10-digit
   * matching (same reasoning as metaWebhook.service.js's find-or-create --
   * a lead's stored phone format may differ from however it was typed
   * originally). Prefers whatsapp_number over phone if both are set.
   */
  async findOrCreateForLead(ctx, leadId) {
    const lead = await leadRepository.findById(ctx.tenantId, leadId);
    if (!lead) throw AppError.notFound('Lead not found');

    const rawPhone = lead.whatsapp_number || lead.phone;
    if (!rawPhone) {
      throw AppError.badRequest('This lead has no phone number on file -- add one before starting a WhatsApp conversation.');
    }

    let conversation = await conversationRepository.findByPhone(ctx.tenantId, rawPhone);
    if (!conversation) {
      conversation = await conversationRepository.create({
        tenant_id: ctx.tenantId,
        lead_id: leadId,
        phone: rawPhone,
        contact_name: lead.name || '',
        status: CONVERSATION_STATUS.NEW,
        tags: [],
        unread_count: 0,
        last_message_preview: '',
        archived: false,
      });
    }

    return toConversationDTO(conversation);
  },

  async getConversations(ctx, query) {
    const filter = buildConversationFilter(query);

    // REAL access control, not just an optional filter: below Admin rank,
    // a user can only ever see conversations assigned to THEM (or not yet
    // assigned to anyone) -- overriding whatever assigned_user_id they
    // requested, or didn't. Without this, any Sales User could see every
    // other Sales User's assigned conversations just by omitting the
    // filter (or worse, by explicitly requesting someone else's), even
    // though the Inbox UI's assignee dropdown implies assignment is
    // actually private. Owner/Admin keep full visibility -- they're the
    // ones doing the assigning and need oversight across the team.
    //
    // Unassigned conversations (assigned_user_id: null) are intentionally
    // still visible to everyone -- that's a new/unclaimed lead, not
    // something assigned away from this user, so hiding it too would
    // block Sales Users from ever picking up new inbound conversations.
    if (!hasRole(ctx.role, ROLES.TENANT_ADMIN)) {
      filter.assigned_user_id = { $in: [ctx.userId, null] };
    }

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

    // Same real enforcement as getConversations(), but for DIRECT access
    // by ID -- without this, hiding another Sales User's conversations
    // from the Inbox LIST would be purely cosmetic; anyone who guessed or
    // was sent the URL/ID directly could still open it, reply in it, or
    // reassign it. Returns the same "not found" (not a distinguishing
    // 403) so a conversation's existence isn't revealed to someone who
    // isn't authorized to see it either way.
    if (!hasRole(ctx.role, ROLES.TENANT_ADMIN)
      && conversation.assigned_user_id
      && String(conversation.assigned_user_id) !== String(ctx.userId)) {
      throw AppError.notFound('Conversation not found');
    }

    return conversation;
  },

  /** 3-pane detail: conversation + messages + lead context. Marks as read. */
  async getConversationDetails(ctx, id) {
    const conversation = await this.getConversationOrThrow(ctx, id);

    // FIX: this used to be sort:ascending + skip:0 + limit:200 -- for any
    // conversation with MORE than 200 messages, that returned the OLDEST
    // 200, silently dropping every actually-recent message from the
    // initial view. Fetch the newest N instead (descending), then reverse
    // for correct oldest-to-newest display order.
    const MESSAGE_PAGE_SIZE = 50;
    const [recentDesc, totalCount] = await Promise.all([
      messageRepository.findMostRecent(ctx.tenantId, id, MESSAGE_PAGE_SIZE),
      messageRepository.countByConversation(ctx.tenantId, id),
    ]);
    await messageRepository.markConversationRead(ctx.tenantId, id);
    const messages = recentDesc.slice().reverse();

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
      // Lets the frontend know whether "load older messages" (scrolling
      // up) has anything left to fetch, without a separate round-trip.
      hasMoreOlder: totalCount > messages.length,
    };
  },

  /**
   * loadOlderMessages -- the real backing for infinite-scroll-up in the
   * Inbox. Cursor-based on the oldest currently-loaded message's
   * created_at, so it stays correct regardless of how many new messages
   * have arrived at the bottom since the conversation was opened.
   */
  async loadOlderMessages(ctx, id, beforeCreatedAt, limit = 50) {
    await this.getConversationOrThrow(ctx, id);
    if (!beforeCreatedAt) throw AppError.badRequest('beforeCreatedAt is required');

    const olderDesc = await messageRepository.findOlderThan(ctx.tenantId, id, new Date(beforeCreatedAt), limit);
    const messages = olderDesc.slice().reverse();

    return {
      messages: messages.map((m) => {
        const o = m.toObject();
        const { _id, ...rest } = o;
        return { id: String(_id), ...rest };
      }),
      hasMoreOlder: messages.length === limit,
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