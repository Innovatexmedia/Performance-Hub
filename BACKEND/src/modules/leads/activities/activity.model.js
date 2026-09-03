import mongoose from 'mongoose';

const { Schema } = mongoose;

/** Activity / timeline event types. */
export const ACTIVITY_TYPE = Object.freeze({
  LEAD_CREATED: 'Lead Created',
  LEAD_UPDATED: 'Lead Updated',
  LEAD_ASSIGNED: 'Lead Assigned',
  LEAD_QUALIFIED: 'Lead Qualified',
  AI_QUALIFIED:  'AI Qualified',
  NOTE_ADDED: 'Note Added',
  LEAD_ARCHIVED: 'Lead Archived',
  LEAD_RESTORED: 'Lead Restored',
  LEAD_CAPTURED: 'Lead Captured',
  // Bookings module (booking.service.js) -- these 5 keys were referenced
  // there (ACTIVITY_TYPE.BOOKING_CREATED etc.) but never actually defined
  // on this enum. Since this schema's `type` field is required with no
  // default, every one of those calls was throwing a Mongoose validation
  // error that logActivity() silently swallows -- meaning no booking has
  // ever produced a real lead-timeline entry. Adding the real keys here
  // is the actual fix; booking.service.js itself needed no changes.
  BOOKING_CREATED: 'Booking Created',
  BOOKING_UPDATED: 'Booking Updated',
  BOOKING_COMPLETED: 'Booking Completed',
  BOOKING_CANCELLED: 'Booking Cancelled',
  BOOKING_NO_SHOW: 'Booking No Show',
  BOOKING_RESCHEDULED: 'Booking Rescheduled',
  // Call Intelligence module (call.service.js) -- same bug class as
  // Bookings above: call.service.js calls ACTIVITY_TYPE.CALL_COMPLETED
  // but this key was never defined here, so every logged call has
  // silently failed to write a lead-timeline entry (required `type`
  // field -> Mongoose validation error -> swallowed by logActivity's
  // try/catch). Adding the real key is the actual fix.
  CALL_COMPLETED: 'Call Completed',
  // WhatsApp Inbox module
  WHATSAPP_ASSIGNED: 'WhatsApp Conversation Assigned',
  WHATSAPP_STATUS_CHANGED: 'WhatsApp Status Changed',
  WHATSAPP_MESSAGE_SENT: 'WhatsApp Message Sent',
  WHATSAPP_REPLY_RECEIVED: 'WhatsApp Reply Received',
  // WhatsApp Contacts module
  WHATSAPP_CONTACT_CREATED: 'WhatsApp Contact Created',
  WHATSAPP_CONTACT_UPDATED: 'WhatsApp Contact Updated',
  WHATSAPP_CONTACT_ASSIGNED: 'WhatsApp Contact Assigned',
  WHATSAPP_CONTACT_OPTED_OUT: 'WhatsApp Contact Opted Out',
  WHATSAPP_CONTACT_CONSENT_UPDATED: 'WhatsApp Contact Consent Updated',
  WHATSAPP_CONTACT_TAG_ADDED: 'WhatsApp Contact Tag Added',
  WHATSAPP_CONTACT_TAG_REMOVED: 'WhatsApp Contact Tag Removed',
  // WhatsApp Templates module
  WHATSAPP_TEMPLATE_CREATED: 'WhatsApp Template Created',
  WHATSAPP_TEMPLATE_UPDATED: 'WhatsApp Template Updated',
  WHATSAPP_TEMPLATE_DUPLICATED: 'WhatsApp Template Duplicated',
  WHATSAPP_TEMPLATE_ACTIVATED: 'WhatsApp Template Activated',
  WHATSAPP_TEMPLATE_PAUSED: 'WhatsApp Template Paused',
  WHATSAPP_TEMPLATE_ARCHIVED: 'WhatsApp Template Archived',
  WHATSAPP_TEMPLATE_APPROVED: 'WhatsApp Template Approved',
  WHATSAPP_TEMPLATE_REJECTED: 'WhatsApp Template Rejected',
  WHATSAPP_TEMPLATE_SYNCED: 'WhatsApp Template Synced',
  // WhatsApp Template Approval module
  WHATSAPP_TEMPLATE_SUBMITTED: 'WhatsApp Template Submitted',
  WHATSAPP_TEMPLATE_RESUBMITTED: 'WhatsApp Template Resubmitted',
  WHATSAPP_TEMPLATE_CHANGES_REQUESTED: 'WhatsApp Template Changes Requested',
  WHATSAPP_TEMPLATE_INTERNALLY_APPROVED: 'WhatsApp Template Internally Approved',
  WHATSAPP_TEMPLATE_SUBMITTED_TO_PROVIDER: 'WhatsApp Template Submitted to Provider',
  WHATSAPP_TEMPLATE_PROVIDER_APPROVED: 'WhatsApp Template Provider Approved',
  WHATSAPP_TEMPLATE_PROVIDER_REJECTED: 'WhatsApp Template Provider Rejected',
  WHATSAPP_TEMPLATE_DISABLED: 'WhatsApp Template Disabled',
  // WhatsApp Campaigns module
  WHATSAPP_CAMPAIGN_CREATED:   'WhatsApp Campaign Created',
  WHATSAPP_CAMPAIGN_UPDATED:   'WhatsApp Campaign Updated',
  WHATSAPP_CAMPAIGN_APPROVED:  'WhatsApp Campaign Approved',
  WHATSAPP_CAMPAIGN_SCHEDULED: 'WhatsApp Campaign Scheduled',
  WHATSAPP_CAMPAIGN_STARTED:   'WhatsApp Campaign Started',
  WHATSAPP_CAMPAIGN_COMPLETED: 'WhatsApp Campaign Completed',
  WHATSAPP_CAMPAIGN_FAILED:    'WhatsApp Campaign Failed',
  WHATSAPP_CAMPAIGN_CANCELLED: 'WhatsApp Campaign Cancelled',
  WHATSAPP_CAMPAIGN_DELETED:   'WhatsApp Campaign Deleted',
  // WhatsApp Broadcasts module
  WHATSAPP_BROADCAST_CREATED:   'WhatsApp Broadcast Created',
  WHATSAPP_BROADCAST_UPDATED:   'WhatsApp Broadcast Updated',
  WHATSAPP_BROADCAST_APPROVED:  'WhatsApp Broadcast Approved',
  WHATSAPP_BROADCAST_SCHEDULED: 'WhatsApp Broadcast Scheduled',
  WHATSAPP_BROADCAST_STARTED:   'WhatsApp Broadcast Started',
  WHATSAPP_BROADCAST_COMPLETED: 'WhatsApp Broadcast Completed',
  WHATSAPP_BROADCAST_FAILED:    'WhatsApp Broadcast Failed',
  WHATSAPP_BROADCAST_CANCELLED: 'WhatsApp Broadcast Cancelled',
  WHATSAPP_BROADCAST_DELETED:   'WhatsApp Broadcast Deleted',
  // Exclusion events
  WHATSAPP_CONTACT_EXCLUDED_OPT_OUT:    'WhatsApp Contact Excluded: Opted Out',
  WHATSAPP_CONTACT_EXCLUDED_SUPPRESSED: 'WhatsApp Contact Excluded: No Consent',
  // WhatsApp Nurtures module
  WHATSAPP_NURTURE_CREATED:              'WhatsApp Nurture Created',
  WHATSAPP_NURTURE_UPDATED:              'WhatsApp Nurture Updated',
  WHATSAPP_NURTURE_ACTIVATED:            'WhatsApp Nurture Activated',
  WHATSAPP_NURTURE_PAUSED:               'WhatsApp Nurture Paused',
  WHATSAPP_NURTURE_ARCHIVED:             'WhatsApp Nurture Archived',
  WHATSAPP_NURTURE_ENROLLMENT_CREATED:   'WhatsApp Nurture Enrollment Created',
  WHATSAPP_NURTURE_ENROLLMENT_PAUSED:    'WhatsApp Nurture Enrollment Paused',
  WHATSAPP_NURTURE_ENROLLMENT_RESUMED:   'WhatsApp Nurture Enrollment Resumed',
  WHATSAPP_NURTURE_ENROLLMENT_COMPLETED: 'WhatsApp Nurture Enrollment Completed',
  WHATSAPP_NURTURE_ENROLLMENT_CANCELLED: 'WhatsApp Nurture Enrollment Cancelled',
});

const activitySchema = new Schema(
  {
    tenant_id: { type: String, required: true, index: true },
    lead_id: {
      type: Schema.Types.ObjectId,
      ref: 'Lead',
      default: null,
      index: true,
    },
    // Optional generic entity link, for activities not tied to a lead
    // (e.g. WhatsApp templates). entity_type is a label; entity_id is a string id.
    entity_type: { type: String, default: null },
    entity_id: { type: String, default: null },
    type: { type: String, required: true },
    message: { type: String, default: '' },
    actor: { type: String, default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
  },
);

activitySchema.index({ tenant_id: 1, entity_type: 1, entity_id: 1 });

export const LeadActivity = mongoose.model('LeadActivity', activitySchema);