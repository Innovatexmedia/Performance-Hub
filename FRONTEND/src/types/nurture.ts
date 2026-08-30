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