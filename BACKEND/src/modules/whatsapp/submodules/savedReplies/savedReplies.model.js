import mongoose from 'mongoose';

const { Schema } = mongoose;

const savedReplySchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    content: { type: String, required: true, trim: true, maxlength: 4000 },
    /** True only for the 3 auto-seeded defaults (see savedReplies.constants.js)
     * -- purely informational (e.g. could drive a "Default" badge in the UI);
     * does NOT block editing or deleting, a tenant owns its own defaults. */
    isDefault: { type: Boolean, default: false },
    createdBy: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

savedReplySchema.index({ tenantId: 1, isDefault: -1, createdAt: 1 });

export const WhatsAppSavedReply = mongoose.model('WhatsAppSavedReply', savedReplySchema);