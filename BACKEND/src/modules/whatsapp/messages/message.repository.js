import { Message } from './message.model.js';
import { MESSAGE_DIRECTION, MESSAGE_STATUS } from './message.model.js';

export const messageRepository = {
  create(data) {
    return Message.create(data);
  },

  findById(tenantId, id) {
    return Message.findOne({ _id: id, tenant_id: tenantId });
  },

  /** Used by the inbound webhook's status handler to match a delivery/read update back to the original outbound message. */
  findByProviderMessageId(tenantId, providerMessageId) {
    if (!providerMessageId) return null;
    return Message.findOne({ tenant_id: tenantId, provider_message_id: providerMessageId });
  },

  /**
   * Finds the most recent OUTBOUND, campaign/broadcast-sourced message in
   * a conversation that hasn't been counted as replied-to yet. Used by
   * the inbound-message webhook handler to attribute a real reply back
   * to the specific campaign/broadcast send that prompted it, without
   * double-counting if the same person replies more than once.
   */
  findLatestUnrepliedCampaignMessage(tenantId, conversationId) {
    return Message.findOne({
      tenant_id: tenantId,
      conversation_id: conversationId,
      direction: MESSAGE_DIRECTION.OUTBOUND,
      source_type: { $ne: null },
      replied_at: null,
    }).sort({ created_at: -1 });
  },

  findByConversation(tenantId, conversationId, { sort = { created_at: 1 }, skip = 0, limit = 50 } = {}) {
    return Message.find({ tenant_id: tenantId, conversation_id: conversationId })
      .sort(sort)
      .skip(skip)
      .limit(limit);
  },

  /** Most recent N messages, newest-first (caller reverses for display order). */
  findMostRecent(tenantId, conversationId, limit = 50) {
    return Message.find({ tenant_id: tenantId, conversation_id: conversationId })
      .sort({ created_at: -1 })
      .limit(limit);
  },

  /**
   * Messages strictly older than a given cursor timestamp, newest-of-the-
   * older-batch first (caller reverses for display order) -- the real
   * "load older messages" query for infinite-scroll-up, cursor-based
   * rather than page/skip so it stays correct even if new messages arrive
   * concurrently (skip-based pagination would silently shift/duplicate
   * items in that case; a timestamp cursor can't).
   */
  findOlderThan(tenantId, conversationId, beforeCreatedAt, limit = 50) {
    return Message.find({
      tenant_id: tenantId,
      conversation_id: conversationId,
      created_at: { $lt: beforeCreatedAt },
    })
      .sort({ created_at: -1 })
      .limit(limit);
  },

  countByConversation(tenantId, conversationId) {
    return Message.countDocuments({
      tenant_id: tenantId,
      conversation_id: conversationId,
    });
  },

  updateById(tenantId, id, patch) {
    return Message.findOneAndUpdate(
      { _id: id, tenant_id: tenantId },
      { $set: patch },
      { new: true },
    );
  },

  /** Mark all delivered inbound messages in a conversation as read. */
  markConversationRead(tenantId, conversationId, readAt = new Date()) {
    return Message.updateMany(
      {
        tenant_id: tenantId,
        conversation_id: conversationId,
        direction: MESSAGE_DIRECTION.INBOUND,
        read_at: null,
      },
      { $set: { status: MESSAGE_STATUS.READ, read_at: readAt } },
    );
  },
};