import { AppError } from '../../../shared/helpers/lead.helpers.js';
import { Lead } from '../lead/lead.model.js';
import { groupRepository } from './group.repository.js';

function toGroupDTO(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const { _id, ...rest } = o;
  return { id: String(_id ?? o.id), ...rest };
}

/**
 * Membership model: AiSensy-style multi-membership -- a lead can belong to
 * several groups at once, backed by Lead.group_ids (an array, see
 * lead.model.js). Mongo resolves `{ group_ids: X }` as "array contains X",
 * so every read below (count/list) reads the same as it would against a
 * single-valued field -- only the mutations differ, using $addToSet / $pull
 * instead of a plain $set so adding/removing one group never touches a
 * lead's OTHER group memberships.
 */
export const groupService = {
  async createGroup(ctx, data) {
    const group = await groupRepository.create({
      tenant_id:   ctx.tenantId,
      name:        data.name,
      description: data.description || '',
      created_by:  ctx.userId,
    });
    return toGroupDTO(group);
  },

  // Member count is always computed live against Lead -- never stored,
  // so it can't drift out of sync with actual group_ids assignments.
  async listGroups(ctx) {
    const groups = await groupRepository.find(ctx.tenantId);
    const withCounts = await Promise.all(
      groups.map(async (g) => {
        const memberCount = await Lead.countDocuments({ tenant_id: ctx.tenantId, group_ids: String(g._id) });
        return { ...toGroupDTO(g), memberCount };
      }),
    );
    return withCounts;
  },

  async getGroup(ctx, id) {
    const group = await groupRepository.findById(ctx.tenantId, id);
    if (!group) throw AppError.notFound('Group not found');
    const memberCount = await Lead.countDocuments({ tenant_id: ctx.tenantId, group_ids: String(group._id) });
    return { ...toGroupDTO(group), memberCount };
  },

  async updateGroup(ctx, id, patch) {
    const group = await groupRepository.updateById(ctx.tenantId, id, patch);
    if (!group) throw AppError.notFound('Group not found');
    return toGroupDTO(group);
  },

  // Deleting a group never deletes or orphans leads silently in a confusing
  // way -- every lead that was in this group has just THIS group's id
  // pulled out of its group_ids array (any other group memberships that
  // lead has are left completely untouched) before the group itself goes.
  async deleteGroup(ctx, id) {
    const existing = await groupRepository.findById(ctx.tenantId, id);
    if (!existing) throw AppError.notFound('Group not found');

    await Lead.updateMany(
      { tenant_id: ctx.tenantId, group_ids: String(existing._id) },
      { $pull: { group_ids: String(existing._id) } },
    );
    await groupRepository.deleteById(ctx.tenantId, id);

    return { id: String(existing._id), deleted: true };
  },

  // Bulk-assign: ADDS this group to every listed lead's group_ids via
  // $addToSet (so re-adding someone already in the group is a no-op, not a
  // duplicate) -- does NOT clear any other group membership those leads
  // may already have, since membership is multi-valued now.
  async assignMembers(ctx, id, leadIds) {
    const group = await groupRepository.findById(ctx.tenantId, id);
    if (!group) throw AppError.notFound('Group not found');

    const result = await Lead.updateMany(
      { _id: { $in: leadIds }, tenant_id: ctx.tenantId },
      { $addToSet: { group_ids: String(group._id) } },
    );

    return { id: String(group._id), matched: result.matchedCount ?? result.n ?? 0 };
  },

  // Full membership reconciliation for the "manage members" checklist UI:
  // leadIds is the COMPLETE desired member list for THIS group specifically
  // -- anything currently in the group but missing from leadIds gets this
  // one group pulled from its group_ids (other groups that lead belongs to
  // are untouched); everything in leadIds gets this group added via
  // $addToSet. Two updateMany calls, not per-lead loops, so this stays a
  // single round-trip pair regardless of list size.
  async setMembers(ctx, id, leadIds) {
    const group = await groupRepository.findById(ctx.tenantId, id);
    if (!group) throw AppError.notFound('Group not found');

    const idSet = (leadIds || []).map(String);

    await Lead.updateMany(
      { tenant_id: ctx.tenantId, group_ids: String(group._id), _id: { $nin: idSet } },
      { $pull: { group_ids: String(group._id) } },
    );
    const result = await Lead.updateMany(
      { tenant_id: ctx.tenantId, _id: { $in: idSet } },
      { $addToSet: { group_ids: String(group._id) } },
    );

    return { id: String(group._id), matched: result.matchedCount ?? result.n ?? 0 };
  },
};