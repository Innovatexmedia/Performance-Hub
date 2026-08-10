import { Group } from './group.model.js';

export const groupRepository = {
  create(data) {
    return Group.create(data);
  },

  findById(tenantId, id) {
    return Group.findOne({ _id: id, tenant_id: tenantId });
  },

  find(tenantId) {
    return Group.find({ tenant_id: tenantId }).sort({ name: 1 });
  },

  updateById(tenantId, id, patch) {
    return Group.findOneAndUpdate(
      { _id: id, tenant_id: tenantId },
      { $set: patch },
      { new: true, runValidators: true },
    );
  },

  deleteById(tenantId, id) {
    return Group.findOneAndDelete({ _id: id, tenant_id: tenantId });
  },
};