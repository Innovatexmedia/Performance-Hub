import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * ContactGroup — a named, tenant-scoped list used to target campaigns at a
 * whole group instead of individual leads or ad-hoc filters.
 *
 * Membership is one-group-per-lead (per product decision): a lead's
 * membership lives on Lead.group_id, NOT on an array here. This collection
 * only holds the group's own metadata; member count/listing is always
 * computed live via Lead.countDocuments({ tenant_id, group_id }).
 */
const groupSchema = new Schema(
  {
    tenant_id:   { type: String, required: true, index: true },
    name:        { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    created_by:  { type: String, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
  },
);

groupSchema.index({ tenant_id: 1, name: 1 });

export const Group = mongoose.model('ContactGroup', groupSchema);