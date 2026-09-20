/**
 * WhatsApp Campaigns — constants.
 */
import { ROLES } from '../../../auth/constants/roles.js';

// ── Campaign Status ────────────────────────────────────────────────────────────
export const CAMPAIGN_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  APPROVED: 'APPROVED',
  SCHEDULED: 'SCHEDULED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',

  // ── API-campaign-only statuses ───────────────────────────────────────────
  // An API campaign is a standing endpoint, not a one-shot send, so the
  // dashboard lifecycle doesn't fit it: APPROVED/RUNNING/COMPLETED all
  // describe a single execution with a fixed audience, and CANCELLED is
  // terminal (see ALLOWED_TRANSITIONS below) so it could never be resumed.
  //
  // These two are used ONLY when type === 'API'. Adding them to the enum is
  // additive -- no existing campaign can reach them, because nothing in the
  // dashboard flow transitions to them.
  ACTIVE: 'ACTIVE',   // accepting API traffic
  PAUSED: 'PAUSED',   // temporarily refusing it; resumable
});
export const CAMPAIGN_STATUS_VALUES = Object.freeze(Object.values(CAMPAIGN_STATUS));

// ── Campaign Type ──────────────────────────────────────────────────────────────
export const CAMPAIGN_TYPE = Object.freeze({
  MARKETING: 'MARKETING',
  PROMOTIONAL: 'PROMOTIONAL',
  BOOKING: 'BOOKING',
  FOLLOW_UP: 'FOLLOW_UP',
  PAYMENT: 'PAYMENT',
  REMINDER: 'REMINDER',
  NURTURE: 'NURTURE',
  BROADCAST: 'BROADCAST',
  // Triggered over the public API rather than from the dashboard. It carries
  // no saved audience: every trigger supplies its own recipients, which is
  // why apiCampaign.service.js refuses to trigger any other type and the
  // dashboard's start/schedule flow refuses this one.
  API: 'API',
  CUSTOM: 'CUSTOM',
});
export const CAMPAIGN_TYPE_VALUES = Object.freeze(Object.values(CAMPAIGN_TYPE));

// ── Workflow actions (stored in auditLog.action) ───────────────────────────────
export const CAMPAIGN_ACTION = Object.freeze({
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  APPROVE: 'APPROVE',
  SCHEDULE: 'SCHEDULE',
  START: 'START',
  COMPLETE: 'COMPLETE',
  FAIL: 'FAIL',
  CANCEL: 'CANCEL',
  DELETE: 'DELETE',
});

// ── Allowed status transitions ─────────────────────────────────────────────────
/**
 * API_ALLOWED_TRANSITIONS — the lifecycle for type: 'API' campaigns.
 *
 * Kept as a separate map rather than merged into ALLOWED_TRANSITIONS so the
 * broadcast state machine is untouched: a dashboard campaign still cannot
 * reach ACTIVE or PAUSED, and an API campaign never goes through
 * APPROVED/SCHEDULED/RUNNING, which would each imply a fixed audience it
 * doesn't have.
 *
 * DRAFT → ACTIVE ⇄ PAUSED, plus CANCELLED as the one-way exit.
 */
export const API_ALLOWED_TRANSITIONS = Object.freeze({
  [CAMPAIGN_STATUS.DRAFT]:     [CAMPAIGN_STATUS.ACTIVE, CAMPAIGN_STATUS.CANCELLED],
  [CAMPAIGN_STATUS.ACTIVE]:    [CAMPAIGN_STATUS.PAUSED, CAMPAIGN_STATUS.CANCELLED],
  [CAMPAIGN_STATUS.PAUSED]:    [CAMPAIGN_STATUS.ACTIVE, CAMPAIGN_STATUS.CANCELLED],
  [CAMPAIGN_STATUS.CANCELLED]: [],
});

export const ALLOWED_TRANSITIONS = Object.freeze({
  [CAMPAIGN_STATUS.DRAFT]:      [CAMPAIGN_STATUS.APPROVED, CAMPAIGN_STATUS.CANCELLED],
  [CAMPAIGN_STATUS.APPROVED]:   [CAMPAIGN_STATUS.SCHEDULED, CAMPAIGN_STATUS.RUNNING, CAMPAIGN_STATUS.CANCELLED],
  [CAMPAIGN_STATUS.SCHEDULED]:  [CAMPAIGN_STATUS.RUNNING, CAMPAIGN_STATUS.CANCELLED],
  [CAMPAIGN_STATUS.RUNNING]:    [CAMPAIGN_STATUS.COMPLETED, CAMPAIGN_STATUS.FAILED, CAMPAIGN_STATUS.CANCELLED],
  [CAMPAIGN_STATUS.COMPLETED]:  [],
  [CAMPAIGN_STATUS.FAILED]:     [CAMPAIGN_STATUS.DRAFT],   // allow retry via reset
  [CAMPAIGN_STATUS.CANCELLED]:  [],
});

// ── Read-only statuses (no edits allowed) ─────────────────────────────────────
export const READ_ONLY_STATUSES = Object.freeze([
  CAMPAIGN_STATUS.COMPLETED,
  CAMPAIGN_STATUS.CANCELLED,
]);

// ── Statuses that block edits (but transitions are still possible) ─────────────
export const LOCKED_STATUSES = Object.freeze([
  CAMPAIGN_STATUS.SCHEDULED,
  CAMPAIGN_STATUS.RUNNING,
  ...READ_ONLY_STATUSES,
]);

// ── Role permissions ──────────────────────────────────────────────────────────
export const ROLE_MIN = Object.freeze({
  CREATE:   ROLES.SALES_USER,
  READ:     ROLES.READ_ONLY_USER,
  UPDATE:   ROLES.SALES_USER,
  DELETE:   ROLES.TENANT_ADMIN,
  APPROVE:  ROLES.TENANT_ADMIN,
  SCHEDULE: ROLES.SALES_USER,
  START:    ROLES.TENANT_ADMIN,
  COMPLETE: ROLES.TENANT_ADMIN,
  FAIL:     ROLES.TENANT_ADMIN,
  CANCEL:   ROLES.TENANT_ADMIN,
  PREVIEW_AUDIENCE: ROLES.SALES_USER,
});

// ── Pagination defaults ────────────────────────────────────────────────────────
export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

// ── Searchable / sortable ──────────────────────────────────────────────────────
export const SEARCHABLE_FIELDS = Object.freeze(['name', 'description', 'templateName']);
export const SORTABLE_FIELDS = Object.freeze([
  'createdAt', 'updatedAt', 'scheduledAt', 'startedAt', 'name',
  'recipientCount', 'status',
]);

// ── Audience filter field keys ─────────────────────────────────────────────────
export const AUDIENCE_FILTER_KEYS = Object.freeze([
  'tags', 'source', 'minimumScore', 'maximumScore',
  'consentStatus', 'optOutStatus', 'assignedUserId',
  'status', 'createdAfter', 'createdBefore',
  'lastContactedAfter', 'lastContactedBefore',
]);