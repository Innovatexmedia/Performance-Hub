import mongoose from 'mongoose';

const { Schema } = mongoose;

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