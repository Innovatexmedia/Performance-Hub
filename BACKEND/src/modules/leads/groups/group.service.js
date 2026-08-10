import { AppError } from '../../../shared/helpers/lead.helpers.js';
import { Lead } from '../lead/lead.model.js';
import { groupRepository } from './group.repository.js';

function toGroupDTO(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const { _id, ...rest } = o;
  return { id: String(_id ?? o.id), ...rest };
}

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
  // so it can't drift out of sync with actual group_id assignments.
  async listGroups(ctx) {
    const groups = await groupRepository.find(ctx.tenantId);
    const withCounts = await Promise.all(
      groups.map(async (g) => {
        const memberCount = await Lead.countDocuments({ tenant_id: ctx.tenantId, group_id: String(g._id) });
        return { ...toGroupDTO(g), memberCount };
      }),
    );
    return withCounts;
  },

  async getGroup(ctx, id) {
    const group = await groupRepository.findById(ctx.tenantId, id);
    if (!group) throw AppError.notFound('Group not found');
    const memberCount = await Lead.countDocuments({ tenant_id: ctx.tenantId, group_id: String(group._id) });
    return { ...toGroupDTO(group), memberCount };
  },

  async updateGroup(ctx, id, patch) {
    const group = await groupRepository.updateById(ctx.tenantId, id, patch);
    if (!group) throw AppError.notFound('Group not found');
    return toGroupDTO(group);
  },

  // Deleting a group never deletes or orphans leads silently in a confusing
  // way -- every lead that was in this group has its group_id cleared back
  // to null (visible in the UI as "No group") before the group itself goes.
  async deleteGroup(ctx, id) {
    const existing = await groupRepository.findById(ctx.tenantId, id);
    if (!existing) throw AppError.notFound('Group not found');

    await Lead.updateMany(
      { tenant_id: ctx.tenantId, group_id: String(existing._id) },
      { $set: { group_id: null } },
    );
    await groupRepository.deleteById(ctx.tenantId, id);

    return { id: String(existing._id), deleted: true };
  },

  // Bulk-assign: sets group_id on every listed lead in one call, so the
  // frontend doesn't need N individual PATCH /api/leads/:id requests.
  async assignMembers(ctx, id, leadIds) {
    const group = await groupRepository.findById(ctx.tenantId, id);
    if (!group) throw AppError.notFound('Group not found');

    const result = await Lead.updateMany(
      { _id: { $in: leadIds }, tenant_id: ctx.tenantId },
      { $set: { group_id: String(group._id) } },
    );

    return { id: String(group._id), matched: result.matchedCount ?? result.n ?? 0 };
  },

  // Full membership reconciliation for the "manage members" checklist UI:
  // leadIds is the COMPLETE desired member list, not a diff. Anything
  // currently in the group but missing from leadIds gets unassigned
  // (group_id -> null); everything in leadIds gets assigned to this group.
  // Two updateMany calls, not per-lead loops, so this stays a single
  // round-trip pair regardless of list size.
  async setMembers(ctx, id, leadIds) {
    const group = await groupRepository.findById(ctx.tenantId, id);
    if (!group) throw AppError.notFound('Group not found');

    const idSet = (leadIds || []).map(String);

    await Lead.updateMany(
      { tenant_id: ctx.tenantId, group_id: String(group._id), _id: { $nin: idSet } },
      { $set: { group_id: null } },
    );
    const result = await Lead.updateMany(
      { tenant_id: ctx.tenantId, _id: { $in: idSet } },
      { $set: { group_id: String(group._id) } },
    );

    return { id: String(group._id), matched: result.matchedCount ?? result.n ?? 0 };
  },
};