import { AppError } from '../../../../shared/helpers/lead.helpers.js';
import { savedRepliesRepository } from './savedReplies.repository.js';
import { DEFAULT_SAVED_REPLIES } from './savedReplies.constants.js';

function toDTO(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const { _id, __v, ...rest } = o;
  return { id: String(_id ?? o.id), ...rest };
}

export const savedRepliesService = {
  /**
   * Lists a tenant's saved replies, auto-seeding the 3 defaults
   * (Greeting / Lead / Thanks-Won) the first time this tenant has none --
   * so every tenant gets useful starter content with zero manual setup,
   * new or pre-existing, without a separate migration script.
   */
  async list(ctx) {
    let replies = await savedRepliesRepository.findByTenant(ctx.tenantId);
    if (replies.length === 0) {
      await savedRepliesRepository.seedDefaults(ctx.tenantId, DEFAULT_SAVED_REPLIES);
      replies = await savedRepliesRepository.findByTenant(ctx.tenantId);
    }
    return replies.map(toDTO);
  },

  async create(ctx, { title, content }) {
    const reply = await savedRepliesRepository.create({
      tenantId: ctx.tenantId,
      title: String(title).trim(),
      content: String(content).trim(),
      isDefault: false,
      createdBy: ctx.userId,
    });
    return toDTO(reply);
  },

  async update(ctx, id, { title, content }) {
    const patch = {};
    if (title !== undefined) patch.title = String(title).trim();
    if (content !== undefined) patch.content = String(content).trim();

    const reply = await savedRepliesRepository.updateOne(ctx.tenantId, id, patch);
    if (!reply) throw AppError.notFound('Saved reply not found');
    return toDTO(reply);
  },

  async remove(ctx, id) {
    const reply = await savedRepliesRepository.deleteOne(ctx.tenantId, id);
    if (!reply) throw AppError.notFound('Saved reply not found');
    return { id, deleted: true };
  },
};