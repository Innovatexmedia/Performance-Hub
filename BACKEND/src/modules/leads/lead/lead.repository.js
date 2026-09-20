import { Lead } from './lead.model.js';

/**
 * Lead Repository — the only place that touches the Lead collection.
 * No business rules, no events. All reads are tenant-scoped.
 */
export const leadRepository = {
  create(data) {
    return Lead.create(data);
  },

  /**
   * findOneAndUpsert -- real atomic "insert only if this filter doesn't
   * already match anything" (see lead.service.js's createLead() for the
   * full race-condition reasoning this exists to close). Uses
   * `$setOnInsert` so a losing/concurrent call that finds an
   * already-just-inserted document does NOT overwrite any of its real
   * fields -- it just reads back exactly what the winning call wrote.
   *
   * `rawResult: true` is used ONLY to reliably read
   * `lastErrorObject.upserted` (the one genuinely trustworthy signal
   * for "did THIS call insert it, or did it already exist") -- but that
   * mode returns a plain driver object, not a real Mongoose document,
   * which would silently break any caller expecting the same shape
   * leadRepository.create() normally returns (virtuals, instance
   * methods, toObject()/toJSON() with schema transforms). Lead.hydrate()
   * wraps that plain object into a genuine Mongoose document WITHOUT
   * re-querying or marking it as a new/unsaved document (which
   * `new Lead(result.value)` would incorrectly do, risking a second
   * insert on any later .save() call).
   */
  async findOneAndUpsert(filter, data) {
    // `includeResultMetadata`, not `rawResult`. rawResult was removed in
    // Mongoose 8 (this project is on 9.x), where it is silently IGNORED --
    // findOneAndUpdate then returns a plain hydrated document instead of the
    // { value, lastErrorObject } envelope this function was written against.
    // `result.value` was therefore always undefined, so every caller got
    // lead: null and isNew: false, with no error anywhere to say so.
    const result = await Lead.findOneAndUpdate(
      filter,
      { $setOnInsert: data },
      { upsert: true, new: true, includeResultMetadata: true, setDefaultsOnInsert: true },
    );

    // Tolerates both shapes on purpose: if a future Mongoose version returns
    // the document directly again, this keeps working rather than silently
    // going back to returning null.
    const hasMetadata = result && typeof result === 'object' && 'lastErrorObject' in result;
    const raw = hasMetadata ? result.value : result;

    return {
      // hydrate() only for the plain driver object from the metadata path --
      // the direct path is already a real document, and hydrating one again
      // would strip the state Mongoose keeps on it.
      lead: raw ? (hasMetadata ? Lead.hydrate(raw) : raw) : null,
      isNew: hasMetadata ? Boolean(result.lastErrorObject?.upserted) : false,
    };
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

  addTag(tenantId, id, tag) {
    return Lead.findOneAndUpdate(
      { _id: id, tenant_id: tenantId },
      { $addToSet: { tags: tag } },
      { new: true },
    );
  },

  removeTag(tenantId, id, tag) {
    return Lead.findOneAndUpdate(
      { _id: id, tenant_id: tenantId },
      { $pull: { tags: tag } },
      { new: true },
    );
  },

  archiveById(tenantId, id) {
    return Lead.findOneAndUpdate(
      { _id: id, tenant_id: tenantId },
      { $set: { archived: true } },
      { new: true },
    );
  },

  unarchiveById(tenantId, id) {
    return Lead.findOneAndUpdate(
      { _id: id, tenant_id: tenantId },
      { $set: { archived: false } },
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
   *
   * Deliberately does NOT filter archived:false (this function's one
   * caller, metaWebhook.service.js, was the confirmed source of a real
   * duplicate-lead bug: a lead gets archived, the same real customer
   * texts again, the old archived-excluding query genuinely doesn't find
   * them, and a brand-new duplicate lead gets created for a number that
   * already existed). A real inbound message is unambiguous evidence
   * this contact is engaging again -- the caller un-archives the match
   * it finds here rather than treating "archived" as "gone forever".
   */
  findByWhatsAppNumber(tenantId, rawPhone) {
    const digits = String(rawPhone || '').replace(/\D/g, '');
    if (digits.length < 6) return null; // too short to safely match on
    const last10 = digits.slice(-10);
    const pattern = new RegExp(`${last10}$`);
    return Lead.findOne({
      tenant_id: tenantId,
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