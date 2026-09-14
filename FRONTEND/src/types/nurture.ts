/**
 * Real Nurture Engine types.
 * SOURCE: src/modules/whatsapp/submodules/nurtures/nurtures.{model,constants}.js
 *
 * Genuinely separate from the old mock types in types/index.ts
 * (NurtureChannel/NurtureSequence/NurtureEnrollment there use different
 * string literals -- 'WhatsApp' vs the real backend's 'WHATSAPP' -- and
 * were never connected to any real API). Not modifying those; this page
 * now uses these instead.
 */

export type NurtureChannel = 'WHATSAPP' | 'EMAIL' | 'SMS' | 'MANUAL_TASK' | 'AI' | 'API_REQUEST' | 'BOOKING' | 'PAYMENT' | 'SHOPIFY';
export type BookingAction = 'SEND_LINK' | 'CHECK_STATUS' | 'SEND_REMINDER' | 'CREATE';
export type PaymentAction = 'CHECK_STATUS' | 'CREATE_REQUEST';
export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type SequenceStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';
export type SequenceType = 'WELCOME' | 'BOOKING' | 'FOLLOW_UP' | 'PAYMENT' | 'ONBOARDING' | 'REACTIVATION' | 'NURTURE' | 'CUSTOM';
export type TriggerType = 'MANUAL' | 'LEAD_CREATED' | 'LEAD_QUALIFIED' | 'BOOKING_CREATED' | 'PAYMENT_PENDING' | 'PAYMENT_FAILED' | 'CUSTOM';
export type DelayUnit = 'MINUTES' | 'HOURS' | 'DAYS' | 'WEEKS';
export type EnrollmentStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type QualificationTemperature = 'Cold' | 'Warm';
export type PauseReason = 'MANUAL' | 'REPLY_DETECTED' | 'OPTED_OUT' | 'QUALIFIED' | 'BOOKED' | 'CONVERTED' | null;

/**
 * Real trigger-condition types for LEAD_CREATED. SOURCE:
 * nurtures.constants.js's CONDITION_OPERATOR / CONDITION_LOGIC (re-exported
 * from automationRules.constants.js -- both features share one real
 * engine, src/shared/services/conditionEngine.js).
 *
 * NOTE: deliberately NOT reusing ConditionOperator from
 * types/automation.ts -- that file's values are lowercase
 * ('equals','not_equals',...) which do not match the real backend enum
 * (EQUALS, NOT_EQUALS, ...) Automation Rules itself actually sends/
 * validates against. Defining the real, correct values here rather than
 * propagating that existing mismatch into a second feature.
 */
export type NurtureConditionOperator =
  | 'EQUALS' | 'NOT_EQUALS' | 'GREATER_THAN' | 'LESS_THAN'
  | 'CONTAINS' | 'NOT_CONTAINS' | 'EXISTS' | 'NOT_EXISTS'
  | 'IN' | 'NOT_IN' | 'STARTS_WITH' | 'ENDS_WITH';

export const NURTURE_CONDITION_OPERATOR_VALUES: NurtureConditionOperator[] = [
  'EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'LESS_THAN',
  'CONTAINS', 'NOT_CONTAINS', 'EXISTS', 'NOT_EXISTS',
  'IN', 'NOT_IN', 'STARTS_WITH', 'ENDS_WITH',
];

export const NURTURE_CONDITION_OPERATOR_LABELS: Record<NurtureConditionOperator, string> = {
  EQUALS: 'is',
  NOT_EQUALS: 'is not',
  GREATER_THAN: 'is greater than',
  LESS_THAN: 'is less than',
  CONTAINS: 'contains',
  NOT_CONTAINS: 'does not contain',
  EXISTS: 'is set',
  NOT_EXISTS: 'is not set',
  IN: 'is one of',
  NOT_IN: 'is not one of',
  STARTS_WITH: 'starts with',
  ENDS_WITH: 'ends with',
};

export type NurtureConditionLogic = 'AND' | 'OR';

export interface NurtureCondition {
  field: string;
  operator: NurtureConditionOperator;
  value: string | number | null;
  label?: string;
}

/**
 * Real, curated LEAD_CREATED condition fields -- mirrors
 * NURTURE_LEAD_CONDITION_FIELDS in nurtures.constants.js exactly (every
 * field here is a real, already-populated Lead schema field). Kept as a
 * plain frontend constant (not fetched from an API) since this list only
 * changes when the Lead schema itself does, same as every other static
 * enum-driven dropdown already in this codebase (e.g. LEAD_STATUS).
 */
export const NURTURE_LEAD_CONDITION_FIELDS: { field: string; label: string; type: 'text' | 'number' | 'array' }[] = [
  { field: 'source',             label: 'Lead Source',        type: 'text' },
  { field: 'medium',             label: 'Medium',             type: 'text' },
  { field: 'campaign',           label: 'Campaign',           type: 'text' },
  { field: 'utm_source',         label: 'UTM Source',         type: 'text' },
  { field: 'utm_medium',         label: 'UTM Medium',         type: 'text' },
  { field: 'utm_campaign',       label: 'UTM Campaign',       type: 'text' },
  { field: 'utm_content',        label: 'UTM Content',        type: 'text' },
  { field: 'utm_term',           label: 'UTM Term',           type: 'text' },
  { field: 'ad_group_id',        label: 'Ad Group / Ad Set ID', type: 'text' },
  { field: 'ad_id',              label: 'Ad ID',               type: 'text' },
  { field: 'tags',               label: 'Tags',               type: 'array' },
  { field: 'status',             label: 'Lead Status',        type: 'text' },
  { field: 'lead_temperature',   label: 'Lead Temperature',   type: 'text' },
  { field: 'qualification_score',label: 'Qualification Score',type: 'number' },
  { field: 'company',            label: 'Company',            type: 'text' },
  { field: 'segment',            label: 'Segment',            type: 'text' },
];

/** Real, commonly-used source/UTM values already produced elsewhere in
 * this codebase (Shopify, Zoho CRM, the public Capture Form) -- a
 * suggestion list for the value input's <datalist>, never a closed
 * dropdown, since a tenant's own ad campaigns can tag UTMs however they
 * choose. */
export const NURTURE_COMMON_SOURCE_VALUES = [
  'Meta Ads', 'Google Ads', 'Facebook', 'Instagram', 'Google', 'Website', 'WhatsApp', 'Shopify', 'Zoho CRM', 'Referral', 'Manual',
];

export interface WorkflowVariable {
  path: string;
  label: string;
  example: string;
}
export interface VariableGroup {
  group: string;
  variables: WorkflowVariable[];
}

export interface NurtureStep {
  stepNumber: number;
  delayValue: number;
  delayUnit: DelayUnit;
  channel: NurtureChannel;
  templateId?: string | null;
  templateName?: string;
  emailSubject?: string;
  emailBody?: string;
  taskDescription?: string;
  assignToUserId?: string | null;
  // AI
  aiGoal?: string;
  aiTone?: string;
  // API_REQUEST
  apiMethod?: ApiMethod;
  apiUrl?: string;
  apiHeaders?: { key: string; value: string }[];
  apiBody?: string;
  // BOOKING
  bookingAction?: BookingAction;
  bookingMeetingType?: string;
  bookingDate?: string;
  bookingTime?: string;
  // PAYMENT
  paymentAction?: PaymentAction;
  paymentAmount?: number | null;
  paymentNote?: string;
  // SHOPIFY
  shopifyOrderId?: string;
  isActive: boolean;
}

export interface NurtureSequence {
  id: string;
  name: string;
  description?: string;
  type: SequenceType;
  status: SequenceStatus;
  triggerType: TriggerType;
  qualificationTemperature: QualificationTemperature | null;
  conditions?: NurtureCondition[];
  conditionLogic?: NurtureConditionLogic;
  steps: NurtureStep[];
  totalSteps: number;
  enrollmentCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionHistoryEntry {
  stepNumber: number;
  executedAt: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
  providerMessageId: string | null;
  error: string | null;
}

export interface NurtureEnrollment {
  id: string;
  tenantId: string;
  sequenceId: string;
  leadId: string | null;
  currentStep: number;
  status: EnrollmentStatus;
  enrolledAt: string;
  lastExecutedAt: string | null;
  completedAt: string | null;
  nextExecutionAt: string | null;
  retryCount: number;
  lastError: string | null;
  pauseReason: PauseReason;
  executionHistory: ExecutionHistoryEntry[];
}