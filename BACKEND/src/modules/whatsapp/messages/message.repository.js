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

  findByConversation(tenantId, conversationId, { sort = { created_at: 1 }, skip = 0, limit = 50 } = {}) {
    return Message.find({ tenant_id: tenantId, conversation_id: conversationId })
      .sort(sort)
      .skip(skip)
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