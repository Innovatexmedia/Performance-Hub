/**
 * WhatsApp Template Approval — constants.
 *
 * Authoritative source for the approval lifecycle: statuses, actions, the
 * allowed transition graph, provider-controlled statuses, rejection reasons,
 * and role permissions.
 *
 * NOTE: "ACTIVE" is NOT an approval status. A template is considered ACTIVE
 * (usable for sending) when approvalStatus === PROVIDER_APPROVED.
 */
import { ROLES } from '../../../auth/constants/roles.js';

export const APPROVAL_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  SUBMITTED_FOR_INTERNAL_REVIEW: 'SUBMITTED_FOR_INTERNAL_REVIEW',
  INTERNALLY_APPROVED: 'INTERNALLY_APPROVED',
  SUBMITTED_TO_PROVIDER: 'SUBMITTED_TO_PROVIDER',
  PROVIDER_APPROVED: 'PROVIDER_APPROVED',
  PROVIDER_REJECTED: 'PROVIDER_REJECTED',
  REJECTED: 'REJECTED',
  PAUSED: 'PAUSED',
  DISABLED: 'DISABLED',
});
export const APPROVAL_STATUS_VALUES = Object.freeze(Object.values(APPROVAL_STATUS));

/** The single status that makes a template usable for sending. */
export const USABLE_APPROVAL_STATUS = APPROVAL_STATUS.PROVIDER_APPROVED;

/** Workflow actions — recorded as transitionHistory.action. */
export const APPROVAL_ACTION = Object.freeze({
  SUBMIT_FOR_REVIEW: 'SUBMIT_FOR_REVIEW',
  REQUEST_CHANGES: 'REQUEST_CHANGES',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  SUBMIT_TO_PROVIDER: 'SUBMIT_TO_PROVIDER',
  PROVIDER_APPROVED: 'PROVIDER_APPROVED',
  PROVIDER_REJECTED: 'PROVIDER_REJECTED',
  PROVIDER_PAUSED: 'PROVIDER_PAUSED',
  PROVIDER_DISABLED: 'PROVIDER_DISABLED',
});

/** Allowed transitions: fromStatus → [allowed toStatus]. Everything else is blocked. */
export const ALLOWED_TRANSITIONS = Object.freeze({
  [APPROVAL_STATUS.DRAFT]: [APPROVAL_STATUS.SUBMITTED_FOR_INTERNAL_REVIEW],
  [APPROVAL_STATUS.SUBMITTED_FOR_INTERNAL_REVIEW]: [
    APPROVAL_STATUS.INTERNALLY_APPROVED,
    APPROVAL_STATUS.DRAFT,
    APPROVAL_STATUS.REJECTED,
  ],
  [APPROVAL_STATUS.INTERNALLY_APPROVED]: [APPROVAL_STATUS.SUBMITTED_TO_PROVIDER],
  [APPROVAL_STATUS.SUBMITTED_TO_PROVIDER]: [
    APPROVAL_STATUS.PROVIDER_APPROVED,
    APPROVAL_STATUS.PROVIDER_REJECTED,
  ],
  [APPROVAL_STATUS.PROVIDER_APPROVED]: [APPROVAL_STATUS.PAUSED],
  [APPROVAL_STATUS.PAUSED]: [APPROVAL_STATUS.PROVIDER_APPROVED, APPROVAL_STATUS.DISABLED],
  [APPROVAL_STATUS.PROVIDER_REJECTED]: [APPROVAL_STATUS.DRAFT],
  [APPROVAL_STATUS.REJECTED]: [],
  [APPROVAL_STATUS.DISABLED]: [],
});

/** Statuses that may ONLY be set by the provider webhook/adapter — never by a user. */
export const PROVIDER_CONTROLLED_STATUSES = Object.freeze([
  APPROVAL_STATUS.PROVIDER_APPROVED,
  APPROVAL_STATUS.PROVIDER_REJECTED,
  APPROVAL_STATUS.PAUSED,
  APPROVAL_STATUS.DISABLED,
]);

export const PROVIDER_REJECTION_REASON = Object.freeze({
  SPAM: 'SPAM',
  POLICY_VIOLATION: 'POLICY_VIOLATION',
  MISLEADING_CLAIMS: 'MISLEADING_CLAIMS',
  VARIABLE_USAGE: 'VARIABLE_USAGE',
  FORMATTING: 'FORMATTING',
  OTHER: 'OTHER',
});
export const PROVIDER_REJECTION_REASON_VALUES = Object.freeze(
  Object.values(PROVIDER_REJECTION_REASON),
);

/**
 * Role permissions, mapped onto the platform's real role hierarchy
 * (super_admin > tenant_owner > tenant_admin > sales_user > read_only_user).
 *
 * The spec's "sales_manager / marketing_manager" map to the manager tier
 * (tenant_admin and above). requireRole is hierarchy-based, so listing the
 * minimum role grants it to everyone above.
 *
 * Per the InnovateX role table: sales_manager/marketing_manager (=
 * tenant_admin) are explicitly allowed to internally approve/reject and
 * submit to provider, same as tenant_owner. This used to be tightened to
 * TENANT_OWNER-only ("only the tenant owner can grant that approval") --
 * that contradicted the role table, so it's reverted to TENANT_ADMIN here.
 */
export const ROLE_MIN = Object.freeze({
  // Creators submit their own; managers may submit any (enforced in service).
  SUBMIT_FOR_REVIEW: ROLES.SALES_USER,
  // Reviewer-authority actions -- manager tier (tenant_admin) and above,
  // matching the role table (sales_manager/marketing_manager/tenant_owner
  // can all approve/reject/request-changes/submit-to-provider).
  REQUEST_CHANGES: ROLES.TENANT_ADMIN,
  APPROVE: ROLES.TENANT_ADMIN,
  REJECT: ROLES.TENANT_ADMIN,
  SUBMIT_TO_PROVIDER: ROLES.TENANT_ADMIN,
  VIEW_TIMELINE: ROLES.READ_ONLY_USER,
});

/** Provider-actor label stored on webhook-driven transitions. */
export const PROVIDER_ACTOR = 'provider:meta';