/**
 * Real Automation types -- match the backend exactly.
 *
 * Standard envelope. SOURCE: src/modules/automations/automation.model.js +
 * .constants.js. Confirmed spec-aligned: entity fields, all 3 named
 * actions (createAutomation/toggleAutomation/simulateAutomation), and the
 * status enum all match DEVELOPER_HANDOFF.md / MASTER_SPEC.md /
 * FRONTEND_SPEC.md exactly. update/delete endpoints were trimmed from the
 * backend to match -- none of the 3 spec docs ever name them (same fix
 * already applied to Campaigns).
 *
 * trigger/condition/action are structured objects, not the old mock's
 * free-text strings -- a faithful, more complete realization of spec's
 * terse "WHEN trigger / IF condition / THEN action" framing, not a
 * deviation from it.
 */

export type TriggerType =
  | 'Page View' | 'Form Submitted' | 'WhatsApp Click' | 'WhatsApp Inbound Message' | 'WhatsApp Outbound Message'
  | 'Lead Created' | 'AI Qualified' | 'Booking Created' | 'Call Completed' | 'Proposal Sent'
  | 'Payment Created' | 'Payment Completed' | 'Deal Won' | 'Deal Lost' | 'Nurture Step Sent'
  | 'Pipeline Stage Changed' | 'Campaign Sent' | 'Broadcast Sent';

export const TRIGGER_TYPE_VALUES: TriggerType[] = [
  'Page View', 'Form Submitted', 'WhatsApp Click', 'WhatsApp Inbound Message', 'WhatsApp Outbound Message',
  'Lead Created', 'AI Qualified', 'Booking Created', 'Call Completed', 'Proposal Sent',
  'Payment Created', 'Payment Completed', 'Deal Won', 'Deal Lost', 'Nurture Step Sent',
  'Pipeline Stage Changed', 'Campaign Sent', 'Broadcast Sent',
];

export type ConditionOperator = 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'exists';
export const CONDITION_OPERATOR_VALUES: ConditionOperator[] = ['equals', 'not_equals', 'greater_than', 'less_than', 'contains', 'exists'];

export type ActionType =
  | 'send_whatsapp_message' | 'send_email' | 'assign_user' | 'add_tag' | 'change_pipeline_stage'
  | 'create_task' | 'create_note' | 'notify_user' | 'enroll_nurture' | 'call_webhook';

export const ACTION_TYPE_VALUES: ActionType[] = [
  'send_whatsapp_message', 'send_email', 'assign_user', 'add_tag', 'change_pipeline_stage',
  'create_task', 'create_note', 'notify_user', 'enroll_nurture', 'call_webhook',
];

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  send_whatsapp_message: 'Send WhatsApp message',
  send_email: 'Send email',
  assign_user: 'Assign user',
  add_tag: 'Add tag',
  change_pipeline_stage: 'Change pipeline stage',
  create_task: 'Create task',
  create_note: 'Create note',
  notify_user: 'Notify user',
  enroll_nurture: 'Enroll in nurture',
  call_webhook: 'Call webhook',
};

export type AutomationStatus = 'active' | 'inactive';

export interface AutomationTrigger {
  type: TriggerType;
  params?: Record<string, unknown>;
}

export interface AutomationCondition {
  field?: string | null;
  operator?: ConditionOperator | null;
  value?: unknown;
}

export interface AutomationAction {
  type: ActionType;
  params?: Record<string, unknown>;
}

export interface AutomationLogEntry {
  at: string;
  result: string;
  success: boolean;
  triggeredBy: 'manual' | 'event';
  leadId: string | null;
}

export interface Automation {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  condition: AutomationCondition;
  action: AutomationAction;
  status: AutomationStatus;
  last_run: string | null;
  run_count: number;
  logs: AutomationLogEntry[];
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAutomationInput {
  name: string;
  description?: string;
  trigger: AutomationTrigger;
  condition?: AutomationCondition;
  action: AutomationAction;
}

export interface AutomationKpis {
  total: number;
  active: number;
  inactive: number;
  totalRuns: number;
}

export interface SimulateResult {
  automation: Automation;
  conditionPassed: boolean;
  result: { success: boolean; message: string };
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}