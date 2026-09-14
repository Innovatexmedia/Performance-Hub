/**
 * Attribution domain constants.
 *
 * FILE: src/modules/attribution/attribution.constants.js
 *
 * SOURCE: MASTER_SPEC.md §B10 Attribution & Tracking
 *         DEVELOPER_HANDOFF.md §6 TrackingEvent entity
 *         FRONTEND_SPEC.md §11 Attribution page
 *
 * TrackingEventType (18) — exact values from DEVELOPER_HANDOFF.md
 */

export const TRACKING_EVENT_TYPE = Object.freeze({
  PAGE_VIEW:                'Page View',
  FORM_SUBMITTED:           'Form Submitted',
  WHATSAPP_CLICK:           'WhatsApp Click',
  WHATSAPP_INBOUND:         'WhatsApp Inbound Message',
  WHATSAPP_OUTBOUND:        'WhatsApp Outbound Message',
  LEAD_CREATED:             'Lead Created',
  AI_QUALIFIED:             'AI Qualified',
  BOOKING_CREATED:          'Booking Created',
  CALL_COMPLETED:           'Call Completed',
  PROPOSAL_SENT:            'Proposal Sent',
  PAYMENT_CREATED:          'Payment Created',
  PAYMENT_COMPLETED:        'Payment Completed',
  DEAL_WON:                 'Deal Won',
  DEAL_LOST:                'Deal Lost',
  NURTURE_STEP_SENT:        'Nurture Step Sent',
  PIPELINE_STAGE_CHANGED:   'Pipeline Stage Changed',
  CAMPAIGN_SENT:            'Campaign Sent',
  BROADCAST_SENT:           'Broadcast Sent',
});

export const TRACKING_EVENT_TYPE_VALUES = Object.freeze(
  Object.values(TRACKING_EVENT_TYPE)
);

/**
 * Revenue-generating lifecycle stages.
 * SOURCE: DEVELOPER_HANDOFF.md TrackingEvent.lifecycle_stage
 */
export const LIFECYCLE_STAGE = Object.freeze({
  AWARENESS:    'awareness',
  CONSIDERATION:'consideration',
  DECISION:     'decision',
  PURCHASE:     'purchase',
  RETENTION:    'retention',
});

export const LIFECYCLE_STAGE_VALUES = Object.freeze(
  Object.values(LIFECYCLE_STAGE)
);

/**
 * DEFAULT_AD_SYNC_DATE_RANGE -- the single, real dateRange value every
 * Google Ads / Meta Ads campaign sync actually uses today (the real,
 * only-ever-called sync entry points in integration.service.js never
 * pass an explicit dateRange). Shared here so googleAdsSettings.service.js,
 * metaAdsSettings.service.js, and attribution.service.js's
 * getAdSpendSummary all agree on ONE canonical value, instead of each
 * hardcoding their own copy of the string 'LAST_30_DAYS' -- see
 * getAdSpendSummary's own comment for why this matters for real
 * duplicate/double-counting prevention if a dateRange selector is ever
 * exposed in the UI later.
 */
export const DEFAULT_AD_SYNC_DATE_RANGE = 'LAST_30_DAYS';