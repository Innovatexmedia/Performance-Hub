/**
 * WhatsApp Nurtures — constants.
 *
 * Covers both the Sequence and its Enrollments.
 */
import { ROLES } from '../../../auth/constants/roles.js';

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
});
export const NURTURE_CHANNEL_VALUES = Object.freeze(Object.values(NURTURE_CHANNEL));

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