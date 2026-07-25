import { Conversation } from './conversation.model.js';

/**
 * Conversation repository — the only layer touching the conversation
 * collection. All queries are tenant-scoped.
 */
export const conversationRepository = {
  create(data) {
    return Conversation.create(data);
  },

  findById(tenantId, id) {
    return Conversation.findOne({ _id: id, tenant_id: tenantId });
  },

  /**
   * findByPhone -- used by the inbound Meta webhook to find an existing
   * conversation for a raw, digits-only sender number. Same last-10-digit
   * matching approach as leadRepository.findByWhatsAppNumber, for the same
   * reason (Meta's raw format vs however `phone` was stored).
   */
  findByPhone(tenantId, rawPhone) {
    const digits = String(rawPhone || '').replace(/\D/g, '');
    if (digits.length < 6) return null;
    const last10 = digits.slice(-10);
    const pattern = new RegExp(`${last10}$`);
    return Conversation.findOne({ tenant_id: tenantId, phone: pattern, archived: false });
  },

  find(tenantId, filter = {}, { sort = { last_message_at: -1 }, skip = 0, limit = 20 } = {}) {
    return Conversation.find({ tenant_id: tenantId, ...filter })
      .sort(sort)
      .skip(skip)
      .limit(limit);
  },

  count(tenantId, filter = {}) {
    return Conversation.countDocuments({ tenant_id: tenantId, ...filter });
  },

  updateById(tenantId, id, patch) {
    return Conversation.findOneAndUpdate(
      { _id: id, tenant_id: tenantId },
      { $set: patch },
      { new: true, runValidators: true },
    );
  },

  archiveById(tenantId, id) {
    return Conversation.findOneAndUpdate(
      { _id: id, tenant_id: tenantId },
      { $set: { archived: true } },
      { new: true },
    );
  },

  addTag(tenantId, id, tag) {
    return Conversation.findOneAndUpdate(
      { _id: id, tenant_id: tenantId },
      { $addToSet: { tags: tag } },
      { new: true },
    );
  },

  removeTag(tenantId, id, tag) {
    return Conversation.findOneAndUpdate(
      { _id: id, tenant_id: tenantId },
      { $pull: { tags: tag } },
      { new: true },
    );
  },

  incrementUnread(tenantId, id, by = 1) {
    return Conversation.findOneAndUpdate(
      { _id: id, tenant_id: tenantId },
      { $inc: { unread_count: by } },
      { new: true },
    );
  },

  resetUnread(tenantId, id) {
    return Conversation.findOneAndUpdate(
      { _id: id, tenant_id: tenantId },
      { $set: { unread_count: 0 } },
      { new: true },
    );
  },
};