/**
 * Pipeline / Deal domain constants.
 *
 * Stages are SYSTEM-DEFINED — no custom stages, no custom pipelines.
 * KEYS are canonical identifiers; VALUES are the human-readable stage labels
 * stored in the DB and accepted by the API (e.g. { "stage": "Negotiation" }).
 */

export const DEAL_STAGE = Object.freeze({
  NEW_LEAD: 'New Lead',
  QUALIFIED: 'Qualified',
  BOOKED_CALL: 'Booked Call',
  CALL_COMPLETED: 'Call Completed',
  PROPOSAL_SENT: 'Proposal Sent',
  NEGOTIATION: 'Negotiation',
  WON: 'Won',
  LOST: 'Lost',
  NURTURE: 'Nurture',
});

export const DEAL_STAGE_VALUES = Object.freeze(Object.values(DEAL_STAGE));

/** Board column order (left → right in the Kanban UI). */
export const STAGE_ORDER = Object.freeze([
  DEAL_STAGE.NEW_LEAD,
  DEAL_STAGE.QUALIFIED,
  DEAL_STAGE.BOOKED_CALL,
  DEAL_STAGE.CALL_COMPLETED,
  DEAL_STAGE.PROPOSAL_SENT,
  DEAL_STAGE.NEGOTIATION,
  DEAL_STAGE.WON,
  DEAL_STAGE.LOST,
  DEAL_STAGE.NURTURE,
]);

/** Stage label → board grouping key (snake_case), used by GET /api/pipeline. */
export const STAGE_BOARD_KEY = Object.freeze({
  [DEAL_STAGE.NEW_LEAD]: 'new_lead',
  [DEAL_STAGE.QUALIFIED]: 'qualified',
  [DEAL_STAGE.BOOKED_CALL]: 'booked_call',
  [DEAL_STAGE.CALL_COMPLETED]: 'call_completed',
  [DEAL_STAGE.PROPOSAL_SENT]: 'proposal_sent',
  [DEAL_STAGE.NEGOTIATION]: 'negotiation',
  [DEAL_STAGE.WON]: 'won',
  [DEAL_STAGE.LOST]: 'lost',
  [DEAL_STAGE.NURTURE]: 'nurture',
});

/** Board keys in column order. */
export const BOARD_KEYS = Object.freeze(
  STAGE_ORDER.map((s) => STAGE_BOARD_KEY[s]),
);

/**
 * Stage → Lead status mapping applied on stage change "where appropriate".
 * VALUES must match the Lead module's LEAD_STATUS values.
 * Negotiation has no lead-status counterpart and is intentionally omitted.
 */
export const STAGE_TO_LEAD_STATUS = Object.freeze({
  [DEAL_STAGE.NEW_LEAD]: 'New',
  [DEAL_STAGE.QUALIFIED]: 'Qualified',
  [DEAL_STAGE.BOOKED_CALL]: 'Booked',
  [DEAL_STAGE.CALL_COMPLETED]: 'Call Completed',
  [DEAL_STAGE.PROPOSAL_SENT]: 'Proposal Sent',
  [DEAL_STAGE.WON]: 'Won',
  [DEAL_STAGE.LOST]: 'Lost',
  [DEAL_STAGE.NURTURE]: 'Nurture',
});

/** Stages that count as "closed" for win-rate math. */
export const CLOSED_STAGES = Object.freeze([DEAL_STAGE.WON, DEAL_STAGE.LOST]);

/** Sensible default probability per stage (used when none supplied). */
export const STAGE_DEFAULT_PROBABILITY = Object.freeze({
  [DEAL_STAGE.NEW_LEAD]: 10,
  [DEAL_STAGE.QUALIFIED]: 25,
  [DEAL_STAGE.BOOKED_CALL]: 40,
  [DEAL_STAGE.CALL_COMPLETED]: 55,
  [DEAL_STAGE.PROPOSAL_SENT]: 70,
  [DEAL_STAGE.NEGOTIATION]: 85,
  [DEAL_STAGE.WON]: 100,
  [DEAL_STAGE.LOST]: 0,
  [DEAL_STAGE.NURTURE]: 15,
});

/** Activity labels recorded on the (reused) Lead activity timeline. */
export const PIPELINE_ACTIVITY = Object.freeze({
  DEAL_CREATED: 'Deal Created',
  DEAL_UPDATED: 'Deal Updated',
  DEAL_ARCHIVED: 'Deal Archived',
  STAGE_CHANGED: 'Pipeline Stage Changed',
  DEAL_WON: 'Deal Won',
  DEAL_LOST: 'Deal Lost',
});

/** Fallback for a deal created without an explicit currency. INR to match
 *  the workspace default on Tenant.currency. */
export const DEFAULT_CURRENCY = 'INR';

/** Fields scanned by free-text search on GET /api/deals. */
export const SEARCHABLE_FIELDS = Object.freeze(['title', 'description']);

/** Whitelisted sort keys. */
export const SORTABLE_FIELDS = Object.freeze([
  'created_at',
  'updated_at',
  'value',
  'probability',
  'expected_close_date',
]);