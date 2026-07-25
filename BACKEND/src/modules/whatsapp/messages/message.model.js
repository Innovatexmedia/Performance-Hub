import mongoose from 'mongoose';

const { Schema } = mongoose;

export const MESSAGE_DIRECTION = Object.freeze({
  INBOUND: 'inbound',
  OUTBOUND: 'outbound',
});
export const MESSAGE_DIRECTION_VALUES = Object.freeze(
  Object.values(MESSAGE_DIRECTION),
);

/**
 * MessageStatus (12) -- SOURCE: DEVELOPER_HANDOFF.md entity list, exact
 * values and Title Case. Previously only had 5 lowercase values
 * (queued/sent/delivered/read/failed) -- missing Draft, Pending Approval,
 * Scheduled, Replied, Cancelled, and critically Blocked by Opt-Out /
 * Blocked by Template Not Approved, both required for the opt-out guard
 * DEVELOPER_HANDOFF.md's action table explicitly names for sendMessage.
 * Every reference to these values goes through this constant object
 * (MESSAGE_STATUS.SENT etc.), never a hardcoded string literal -- confirmed
 * by grepping every consumer -- so realigning the values here is safe.
 */
export const MESSAGE_STATUS = Object.freeze({
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  SCHEDULED: 'Scheduled',
  QUEUED: 'Queued',
  SENT: 'Sent',
  DELIVERED: 'Delivered',
  READ: 'Read',
  REPLIED: 'Replied',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  BLOCKED_BY_OPT_OUT: 'Blocked by Opt-Out',
  BLOCKED_BY_TEMPLATE_NOT_APPROVED: 'Blocked by Template Not Approved',
});
export const MESSAGE_STATUS_VALUES = Object.freeze(Object.values(MESSAGE_STATUS));

export const MESSAGE_TYPE = Object.freeze({
  TEXT: 'text',
  IMAGE: 'image',
  DOCUMENT: 'document',
  TEMPLATE: 'template',
});
export const MESSAGE_TYPE_VALUES = Object.freeze(Object.values(MESSAGE_TYPE));

const messageSchema = new Schema(
  {
    tenant_id: { type: String, required: true, index: true },
    conversation_id: {
      type: Schema.Types.ObjectId,
      ref: 'WhatsAppConversation',
      required: true,
      index: true,
    },
    lead_id: { type: Schema.Types.ObjectId, ref: 'Lead', default: null },

    direction: { type: String, enum: MESSAGE_DIRECTION_VALUES, required: true },
    type: { type: String, enum: MESSAGE_TYPE_VALUES, default: MESSAGE_TYPE.TEXT },
    content: { type: String, default: '' },

    sender: { type: String, default: null },
    recipient: { type: String, default: null },

    provider: { type: String, default: 'simulation' },
    status: {
      type: String,
      enum: MESSAGE_STATUS_VALUES,
      default: MESSAGE_STATUS.QUEUED,
    },
    provider_message_id: { type: String, default: null },

    sent_at: { type: Date, default: null },
    delivered_at: { type: Date, default: null },
    read_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    versionKey: false,
  },
);

messageSchema.index({ tenant_id: 1, conversation_id: 1, created_at: 1 });

export const Message = mongoose.model('WhatsAppMessage', messageSchema);