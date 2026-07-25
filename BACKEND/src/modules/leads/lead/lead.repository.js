import { Lead } from './lead.model.js';

/**
 * Lead Repository — the only place that touches the Lead collection.
 * No business rules, no events. All reads are tenant-scoped.
 */
export const leadRepository = {
  create(data) {
    return Lead.create(data);
  },

  insertMany(docs) {
    return Lead.insertMany(docs);
  },

  findById(tenantId, id) {
    return Lead.findOne({ _id: id, tenant_id: tenantId });
  },

  findOne(tenantId, query = {}) {
    return Lead.findOne({ tenant_id: tenantId, ...query });
  },

  find(tenantId, filter = {}, { sort = { created_at: -1 }, skip = 0, limit = 20 } = {}) {
    return Lead.find({ tenant_id: tenantId, ...filter })
      .sort(sort)
      .skip(skip)
      .limit(limit);
  },

  count(tenantId, filter = {}) {
    return Lead.countDocuments({ tenant_id: tenantId, ...filter });
  },

  updateById(tenantId, id, patch) {
    return Lead.findOneAndUpdate(
      { _id: id, tenant_id: tenantId },
      { $set: patch },
      { new: true, runValidators: true },
    );
  },

  archiveById(tenantId, id) {
    return Lead.findOneAndUpdate(
      { _id: id, tenant_id: tenantId },
      { $set: { archived: true } },
      { new: true },
    );
  },

  findByEmail(tenantId, email) {
    if (!email) return null;
    return Lead.findOne({
      tenant_id: tenantId,
      email: String(email).toLowerCase(),
      archived: false,
    });
  },

  findByPhone(tenantId, phone) {
    if (!phone) return null;
    return Lead.findOne({ tenant_id: tenantId, phone, archived: false });
  },

  /**
   * findByWhatsAppNumber -- used by the inbound Meta webhook to find an
   * existing lead for a raw, digits-only WhatsApp number (e.g. Meta sends
   * "919876543210", no '+', no spaces). An exact match against `phone`
   * (like findByPhone above) would cause duplicate lead creation on every
   * message from an already-known contact whose stored format differs
   * (e.g. "+91 98765 43210"). Matches on the last 10 digits against BOTH
   * phone and whatsapp_number -- a pragmatic, well-established technique,
   * not full E.164 normalization, but handles the common real-world case
   * without a data migration.
   */
  findByWhatsAppNumber(tenantId, rawPhone) {
    const digits = String(rawPhone || '').replace(/\D/g, '');
    if (digits.length < 6) return null; // too short to safely match on
    const last10 = digits.slice(-10);
    const pattern = new RegExp(`${last10}$`);
    return Lead.findOne({
      tenant_id: tenantId,
      archived: false,
      $or: [{ phone: pattern }, { whatsapp_number: pattern }],
    });
  },

  /** Aggregate lead counts grouped by owner (for least-loaded assignment). */
  countByOwner(tenantId) {
    return Lead.aggregate([
      { $match: { tenant_id: tenantId, archived: false } },
      { $group: { _id: '$assigned_user_id', count: { $sum: 1 } } },
    ]);
  },
};