import mongoose from 'mongoose';
const { Schema } = mongoose;

const notificationSchema = new Schema({
  tenantId: { type: String, required: true, index: true },
  userId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title:    { type: String, required: true },
  body:     { type: String, default: '' },
  isRead:   { type: Boolean, default: false },
  metadata: { type: Schema.Types.Mixed, default: {} },
  // Which event this notification describes, matching a key in
  // Settings > Notification Preferences (see NOTIFICATION_TYPE in
  // notification.service.js). Nullable: notifications the user configured
  // directly -- a nurture task, an automation rule's NOTIFY_USER action --
  // have no preference toggle and carry no type.
  type:     { type: String, default: null, index: true },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
});

notificationSchema.index({ tenantId: 1, userId: 1, isRead: 1 });

export default mongoose.model('Notification', notificationSchema);