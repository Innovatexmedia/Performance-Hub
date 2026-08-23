import { WhatsAppSavedReply } from './savedReplies.model.js';

export const savedRepliesRepository = {
  findByTenant(tenantId) {
    // Defaults first (isDefault: -1 sorts true before false), then oldest
    // custom replies first -- keeps the 3 seeded defaults anchored at the
    // top of the list regardless of how many the tenant later creates.
    return WhatsAppSavedReply.find({ tenantId }).sort({ isDefault: -1, createdAt: 1 });
  },

  seedDefaults(tenantId, defaults) {
    return WhatsAppSavedReply.insertMany(
      defaults.map((d) => ({ tenantId, title: d.title, content: d.content, isDefault: true, createdBy: null })),
    );
  },

  create(data) {
    return WhatsAppSavedReply.create(data);
  },

  findOne(tenantId, id) {
    return WhatsAppSavedReply.findOne({ _id: id, tenantId });
  },

  updateOne(tenantId, id, patch) {
    return WhatsAppSavedReply.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: patch },
      { new: true, runValidators: true },
    );
  },

  deleteOne(tenantId, id) {
    return WhatsAppSavedReply.findOneAndDelete({ _id: id, tenantId });
  },
};