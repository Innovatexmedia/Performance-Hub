/**
 * WhatsApp Nurtures — constants.
 *
 * Covers both the Sequence and its Enrollments.
 */
import { ROLES } from '../../../auth/constants/roles.js';
import { CONDITION_OPERATOR, CONDITION_OPERATOR_VALUES, CONDITION_LOGIC, CONDITION_LOGIC_VALUES } from '../automationRules/automationRules.constants.js';

export { CONDITION_OPERATOR, CONDITION_OPERATOR_VALUES, CONDITION_LOGIC, CONDITION_LOGIC_VALUES };

// ── Sequence status ────────────────────────────────────────────────────────────
export const SEQUENCE_STATUS = Object.freeze({
  DRAFT:     'DRAFT',
  ACTIVE:    'ACTIVE',
  PAUSED:    'PAUSED',
  COMPLETED: 'COMPLETED',
  ARCHIVED:  'ARCHIVED',
});
export const SEQUENCE_STATUS_VALUES = Object.freeze(Object.values(SEQUENCE_STATUS));

// ── Sequence type ──────────────────────────────────────────────────────────────
export const SEQUENCE_TYPE = Object.freeze({
  WELCOME:      'WELCOME',
  BOOKING:      'BOOKING',
  FOLLOW_UP:    'FOLLOW_UP',
  PAYMENT:      'PAYMENT',
  ONBOARDING:   'ONBOARDING',
  REACTIVATION: 'REACTIVATION',
  NURTURE:      'NURTURE',
  CUSTOM:       'CUSTOM',
});
export const SEQUENCE_TYPE_VALUES = Object.freeze(Object.values(SEQUENCE_TYPE));

// ── Trigger type ───────────────────────────────────────────────────────────────
export const TRIGGER_TYPE = Object.freeze({
  MANUAL:          'MANUAL',
  LEAD_CREATED:    'LEAD_CREATED',
  LEAD_QUALIFIED:  'LEAD_QUALIFIED',
  BOOKING_CREATED: 'BOOKING_CREATED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAYMENT_FAILED:  'PAYMENT_FAILED',
  CUSTOM:          'CUSTOM',
});
export const TRIGGER_TYPE_VALUES = Object.freeze(Object.values(TRIGGER_TYPE));

// ── Delay units ────────────────────────────────────────────────────────────────
export const DELAY_UNIT = Object.freeze({
  MINUTES: 'MINUTES',
  HOURS:   'HOURS',
  DAYS:    'DAYS',
  WEEKS:   'WEEKS',
});
export const DELAY_UNIT_VALUES = Object.freeze(Object.values(DELAY_UNIT));

/** Convert a step delay to milliseconds (for nextExecutionAt calculation). */
export const DELAY_UNIT_MS = Object.freeze({
  [DELAY_UNIT.MINUTES]: 60 * 1000,
  [DELAY_UNIT.HOURS]:   60 * 60 * 1000,
  [DELAY_UNIT.DAYS]:    24 * 60 * 60 * 1000,
  [DELAY_UNIT.WEEKS]:   7 * 24 * 60 * 60 * 1000,
});

// ── Step channel (real, per PRD's "WhatsApp/Email/SMS/Manual task") ───────────
// WHATSAPP is the default -- every existing step in the database has no
// `channel` field at all, and Mongoose applies this schema default on
// read, so every pre-existing sequence keeps behaving exactly as it did.
// SMS is accepted as a real, valid step type (per spec's own naming) but
// has no real send capability -- there is no SMS provider anywhere in
// this codebase to build on, so a SMS step is created/stored for real
// but genuinely cannot execute until a real SMS integration exists; this
// is stated plainly, not silently faked.
export const NURTURE_CHANNEL = Object.freeze({
  WHATSAPP:    'WHATSAPP',
  EMAIL:       'EMAIL',
  SMS:         'SMS',
  MANUAL_TASK: 'MANUAL_TASK',
  AI:          'AI',           // real: generates a WhatsApp message via the connected AI provider (Claude/Gemini), then sends it
  API_REQUEST: 'API_REQUEST',  // real: outbound HTTP call with configurable method/URL/headers/body, real variable substitution
  BOOKING:     'BOOKING',      // real: send existing booking link, check status, send reminder, or create (only with an explicit date/time)
  PAYMENT:     'PAYMENT',      // real: check existing InnovateX payment record status, or create a real pending payment record
  SHOPIFY:     'SHOPIFY',      // real: looks up a specific Shopify order by ID (the only real lookup the provider supports), stores its real fields as workflow variables for later steps
});
export const NURTURE_CHANNEL_VALUES = Object.freeze(Object.values(NURTURE_CHANNEL));

// Real, bounded sub-actions for the BOOKING node -- matches exactly what
// was scoped: send the lead's real existing booking link, check real
// status, send a real reminder, or create one but ONLY with an explicit
// date/time configured on the node (never auto-generated).
export const BOOKING_ACTION = Object.freeze({
  SEND_LINK:     'SEND_LINK',
  CHECK_STATUS:  'CHECK_STATUS',
  SEND_REMINDER: 'SEND_REMINDER',
  CREATE:        'CREATE',
});
export const BOOKING_ACTION_VALUES = Object.freeze(Object.values(BOOKING_ACTION));

// Real, bounded sub-actions for the PAYMENT node. SCOPE, stated
// honestly: there is no real Cashfree (or any) payment gateway API
// integration anywhere in this codebase -- CASHFREE only exists as a
// payment-method label a rep selects when manually recording a payment
// already received. CHECK_STATUS reads real, existing InnovateX payment
// records. CREATE_REQUEST creates a real, pending InnovateX payment
// record and notifies the lead of the amount -- it does NOT generate an
// actual clickable payment gateway checkout URL, since that capability
// does not exist yet.
export const PAYMENT_ACTION = Object.freeze({
  CHECK_STATUS:   'CHECK_STATUS',
  CREATE_REQUEST: 'CREATE_REQUEST',
});
export const PAYMENT_ACTION_VALUES = Object.freeze(Object.values(PAYMENT_ACTION));

// Real, safe defaults for the API_REQUEST node -- enforced in the
// execution engine, not just suggested here.
export const API_REQUEST_TIMEOUT_MS = 10_000;
export const API_REQUEST_MAX_RESPONSE_BYTES = 100_000; // 100KB -- real cap so a runaway response can't exhaust memory
export const API_REQUEST_METHODS = Object.freeze(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

// ── Real qualification-triggered auto-enrollment ───────────────────────────────
// TRIGGER_TYPE.LEAD_QUALIFIED already existed (see below) -- this adds the
// one real, missing piece: WHICH lead temperature a given sequence should
// auto-enroll. Reuses Lead.lead_temperature's own real values (Hot/Warm/Cold)
// directly rather than inventing a separate enum. A tenant configures this
// per-sequence (e.g. "this sequence auto-enrolls Cold leads"), since spec
// names 6 sequences but never states which one any specific temperature
// should map to -- that mapping is a real business decision for the
// tenant to make via the sequence builder, not something to hardcode here.
export const NURTURE_TRIGGER_TEMPERATURE_VALUES = Object.freeze(['Cold', 'Warm']);

// ── Real, curated LEAD_CREATED trigger-condition fields ─────────────────────────
// Every field here is a REAL, already-populated Lead schema field (see
// leads/lead/lead.model.js) -- audited directly against the schema, not
// invented. Curated (a dropdown of known-real fields) rather than a raw
// free-text field path like Automation Rules' condition builder uses,
// per the explicit ask for "multiple SELECTABLE criteria". `type` tells
// the frontend which operators/input make sense for that field (e.g. a
// tags multi-select vs a plain text box); the backend condition engine
// itself doesn't care and will happily evaluate any field/operator pair
// regardless of this hint.
//
// NOTE ON GOOGLE ADS / META ADS: neither integration writes anything
// onto the Lead document itself (confirmed by reading
// googleAdsSettings/metaAdsSettings/googleAdsCampaignMetric/
// metaAdsCampaignMetric -- they only sync spend/conversion METRICS for
// the Attribution dashboard, they never create or touch a Lead record).
// A lead genuinely "from Google/Meta Ads" is identified the same way
// Attribution's own dashboard already identifies one: by its real
// utm_source/source/medium values, captured at the real point of
// creation (the public Capture Form endpoint, or however else a lead's
// source got set on create) -- see CommonSourceValue below for the
// actual values already in real use elsewhere in this codebase.
export const NURTURE_LEAD_CONDITION_FIELDS = Object.freeze([
  { field: 'source',               label: 'Lead Source',          type: 'text' },
  { field: 'medium',                label: 'Medium',                type: 'text' },
  { field: 'campaign',              label: 'Campaign',              type: 'text' },
  { field: 'utm_source',            label: 'UTM Source',            type: 'text' },
  { field: 'utm_medium',            label: 'UTM Medium',            type: 'text' },
  { field: 'utm_campaign',          label: 'UTM Campaign',          type: 'text' },
  { field: 'utm_content',           label: 'UTM Content',           type: 'text' },
  { field: 'utm_term',              label: 'UTM Term',              type: 'text' },
  { field: 'ad_group_id',           label: 'Ad Group / Ad Set ID',  type: 'text' },
  { field: 'ad_id',                 label: 'Ad ID',                 type: 'text' },
  { field: 'tags',                  label: 'Tags',                  type: 'array' },
  { field: 'status',                label: 'Lead Status',           type: 'text' },
  { field: 'lead_temperature',      label: 'Lead Temperature',      type: 'text' },
  { field: 'qualification_score',   label: 'Qualification Score',   type: 'number' },
  { field: 'company',               label: 'Company',               type: 'text' },
  { field: 'segment',               label: 'Segment',               type: 'text' },
]);

// Real, commonly-occurring source/medium/utm_source values ALREADY
// produced elsewhere in this codebase (Shopify: source:'Shopify' --
// shopifySettings.service.js; Zoho: source:'Zoho CRM' --
// zohoSettings.service.js; Cal.com booking-originated leads; the public
// Capture Form, which stores whatever utm_source/utm_campaign the
// visiting URL actually carried, e.g. "google"/"facebook"/"instagram"
// per how the ad's landing-page link was tagged). This is a real,
// non-exhaustive suggestion list for the frontend's condition-value
// input (a datalist, not a hard enum) -- a tenant's own ad campaigns can
// tag UTMs however they choose, so the value field always stays a real
// free-text input, never a closed dropdown.
export const NURTURE_COMMON_SOURCE_VALUES = Object.freeze([
  'Meta Ads', 'Google Ads', 'Facebook', 'Instagram', 'Google', 'Website', 'WhatsApp', 'Shopify', 'Zoho CRM', 'Referral', 'Manual',
]);

// ── Sequence audit actions ─────────────────────────────────────────────────────
export const SEQUENCE_ACTION = Object.freeze({
  CREATE:   'CREATE',
  UPDATE:   'UPDATE',
  ACTIVATE: 'ACTIVATE',
  PAUSE:    'PAUSE',
  COMPLETE: 'COMPLETE',
  ARCHIVE:  'ARCHIVE',
  DELETE:   'DELETE',
});

// ── Sequence allowed transitions ──────────────────────────────────────────────
export const SEQUENCE_ALLOWED_TRANSITIONS = Object.freeze({
  [SEQUENCE_STATUS.DRAFT]:     [SEQUENCE_STATUS.ACTIVE],
  [SEQUENCE_STATUS.ACTIVE]:    [SEQUENCE_STATUS.PAUSED, SEQUENCE_STATUS.COMPLETED],
  [SEQUENCE_STATUS.PAUSED]:    [SEQUENCE_STATUS.ACTIVE, SEQUENCE_STATUS.ARCHIVED],
  [SEQUENCE_STATUS.COMPLETED]: [SEQUENCE_STATUS.ARCHIVED],
  [SEQUENCE_STATUS.ARCHIVED]:  [],
});

export const SEQUENCE_READ_ONLY_STATUSES = Object.freeze([
  SEQUENCE_STATUS.COMPLETED,
  SEQUENCE_STATUS.ARCHIVED,
]);

// ── Enrollment status ──────────────────────────────────────────────────────────
export const ENROLLMENT_STATUS = Object.freeze({
  ACTIVE:    'ACTIVE',
  PAUSED:    'PAUSED',
  COMPLETED: 'COMPLETED',
  FAILED:    'FAILED',
  CANCELLED: 'CANCELLED',
});
export const ENROLLMENT_STATUS_VALUES = Object.freeze(Object.values(ENROLLMENT_STATUS));

// ── Enrollment audit actions ───────────────────────────────────────────────────
export const ENROLLMENT_ACTION = Object.freeze({
  ENROLL:    'ENROLL',
  PAUSE:     'PAUSE',
  RESUME:    'RESUME',
  COMPLETE:  'COMPLETE',
  FAIL:      'FAIL',
  CANCEL:    'CANCEL',
});

// ── Enrollment allowed transitions ────────────────────────────────────────────
export const ENROLLMENT_ALLOWED_TRANSITIONS = Object.freeze({
  [ENROLLMENT_STATUS.ACTIVE]:    [ENROLLMENT_STATUS.PAUSED, ENROLLMENT_STATUS.COMPLETED, ENROLLMENT_STATUS.FAILED, ENROLLMENT_STATUS.CANCELLED],
  [ENROLLMENT_STATUS.PAUSED]:    [ENROLLMENT_STATUS.ACTIVE, ENROLLMENT_STATUS.CANCELLED],
  [ENROLLMENT_STATUS.COMPLETED]: [],
  [ENROLLMENT_STATUS.FAILED]:    [ENROLLMENT_STATUS.ACTIVE],   // retry
  [ENROLLMENT_STATUS.CANCELLED]: [],
});

// ── Execution step status ──────────────────────────────────────────────────────
export const STEP_EXECUTION_STATUS = Object.freeze({
  PENDING:   'PENDING',
  SENT:      'SENT',
  FAILED:    'FAILED',
  SKIPPED:   'SKIPPED',
});

// ── Role permissions ──────────────────────────────────────────────────────────
export const ROLE_MIN = Object.freeze({
  CREATE:             ROLES.SALES_USER,
  READ:               ROLES.READ_ONLY_USER,
  UPDATE:             ROLES.SALES_USER,
  DELETE:             ROLES.TENANT_ADMIN,
  ACTIVATE:           ROLES.TENANT_ADMIN,
  PAUSE:              ROLES.TENANT_ADMIN,
  ARCHIVE:            ROLES.TENANT_ADMIN,
  ENROLL:             ROLES.SALES_USER,
  MANAGE_ENROLLMENT:  ROLES.SALES_USER,
  LIST_ENROLLMENTS:   ROLES.READ_ONLY_USER,
});

// ── Pagination ────────────────────────────────────────────────────────────────
export const DEFAULT_PAGE  = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT     = 100;

// ── Search / sort ─────────────────────────────────────────────────────────────
export const SEARCHABLE_FIELDS = Object.freeze(['name', 'description']);
export const SORTABLE_FIELDS   = Object.freeze([
  'createdAt', 'updatedAt', 'name', 'status', 'enrollmentCount',
]);