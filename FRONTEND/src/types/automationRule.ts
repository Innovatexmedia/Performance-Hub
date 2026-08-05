/**
 * SOURCE: BACKEND/src/modules/whatsapp/submodules/automationRules/
 *         {automationRules.model.js, automationRules.constants.js}
 */

export const RULE_STATUS_VALUES = ['DRAFT', 'ACTIVE', 'PAUSED', 'DISABLED', 'ARCHIVED'] as const;
export type RuleStatus = (typeof RULE_STATUS_VALUES)[number];

export const TRIGGER_TYPE_VALUES = [
  'LEAD_CREATED', 'LEAD_UPDATED', 'LEAD_QUALIFIED', 'PIPELINE_STAGE_CHANGED',
  'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'BOOKING_CREATED', 'BOOKING_CONFIRMED',
  'PAYMENT_PENDING', 'PAYMENT_RECEIVED', 'CAMPAIGN_COMPLETED', 'CAMPAIGN_FAILED',
  'NO_REPLY', 'TAG_ADDED', 'TAG_REMOVED', 'CONTACT_CREATED', 'CONTACT_UPDATED',
  'CUSTOM_EVENT',
] as const;
export type TriggerType = (typeof TRIGGER_TYPE_VALUES)[number];

export const CONDITION_OPERATOR_VALUES = [
  'EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'LESS_THAN', 'CONTAINS', 'NOT_CONTAINS',
  'EXISTS', 'NOT_EXISTS', 'IN', 'NOT_IN', 'STARTS_WITH', 'ENDS_WITH',
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATOR_VALUES)[number];

export const CONDITION_LOGIC_VALUES = ['AND', 'OR'] as const;
export type ConditionLogic = (typeof CONDITION_LOGIC_VALUES)[number];

export const ACTION_TYPE_VALUES = [
  'SEND_TEMPLATE', 'START_NURTURE', 'STOP_NURTURE', 'SEND_BROADCAST',
  'GENERATE_AI_REPLY', 'ASSIGN_USER', 'CHANGE_PIPELINE_STAGE', 'ADD_TAG',
  'REMOVE_TAG', 'CREATE_TASK', 'CREATE_NOTE', 'NOTIFY_USER', 'SEND_EMAIL',
  'CALL_WEBHOOK', 'WAIT', 'END_WORKFLOW',
] as const;
export type ActionType = (typeof ACTION_TYPE_VALUES)[number];

export const EXECUTION_MODE_VALUES = ['IMMEDIATELY', 'DELAYED', 'SCHEDULED'] as const;
export type ExecutionMode = (typeof EXECUTION_MODE_VALUES)[number];

export const DELAY_UNIT_VALUES = ['minutes', 'hours', 'days'] as const;
export type DelayUnit = (typeof DELAY_UNIT_VALUES)[number];

export const EXECUTION_STATUS_VALUES = ['SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED'] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUS_VALUES)[number];

export const PRIORITY_MIN = 1;
export const PRIORITY_MAX = 100;

export interface RuleCondition {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
  label?: string;
}

export interface RuleAction {
  order: number;
  type: ActionType;
  params?: Record<string, unknown>;
  delayValue?: number;
  delayUnit?: DelayUnit;
  description?: string;
}

export interface RuleTrigger {
  type: TriggerType;
  params?: Record<string, unknown>;
}

export interface RuleDelay {
  value: number;
  unit: DelayUnit;
}

export interface AutomationRule {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  trigger: RuleTrigger;
  conditions: RuleCondition[];
  conditionLogic: ConditionLogic;
  actions: RuleAction[];
  status: RuleStatus;
  priority: number;
  executionMode: ExecutionMode;
  delay: RuleDelay;
  isActive: boolean;
  executionCount: number;
  lastExecutedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Payload shape for create/update -- omits server-computed fields. */
export interface AutomationRuleInput {
  name: string;
  description?: string;
  trigger: RuleTrigger;
  conditions?: RuleCondition[];
  conditionLogic?: ConditionLogic;
  actions?: RuleAction[];
  status?: RuleStatus;
  priority?: number;
  executionMode?: ExecutionMode;
  delay?: RuleDelay;
}

export interface AutomationRuleListQuery {
  page?: number;
  limit?: number;
  status?: RuleStatus;
  trigger?: TriggerType;
  active?: boolean;
}

export interface AutomationRuleHistoryEntry {
  id: string;
  automationId: string;
  trigger: string;
  status: ExecutionStatus;
  actionsExecuted: number;
  actionLogs: { order: number; type: string; status: ExecutionStatus; message: string; durationMs: number }[];
  startedAt: string;
  completedAt: string | null;
  duration: number;
  error: string | null;
  logs: string[];
}