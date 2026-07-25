/**
 * Real WhatsApp Template types -- match the backend exactly, field-for-field.
 *
 * SOURCE: src/modules/whatsapp/submodules/templates/templates.model.js +
 * .constants.js. Confirmed against real Postman responses (create, activate,
 * duplicate) before writing this file -- every field name below is verified,
 * not inferred from the .md spec docs.
 *
 * IMPORTANT: the backend's actual field names (name, slug, languageCode,
 * approvalStatus, providerMetadata, etc.) are DIFFERENT from what
 * DEVELOPER_HANDOFF.md describes (template_name, language, status_history,
 * etc.) -- confirmed and deliberately NOT reconciled, per explicit
 * instruction: keep the backend exactly as it is, match the frontend to it.
 *
 * Standard envelope (like WhatsApp Settings) -- {success, message, data},
 * with sendPaginated putting `pagination` as a TOP-LEVEL sibling of `data`,
 * NOT nested under meta.pagination like Leads/Pipeline's convention.
 *
 * ApprovalStatus FIX: this used to list values from BOTH of two
 * independent backend enums that both wrote the same `approvalStatus`
 * field -- templates.constants.js's old local APPROVAL_STATUS (which had
 * ACTIVE, ARCHIVED, CHANGES_REQUESTED, REJECTED_INTERNALLY) and
 * templateApproval.constants.js's APPROVAL_STATUS (which has REJECTED and
 * DISABLED instead). The backend now has ONE APPROVAL_STATUS
 * (templates.constants.js re-exports templateApproval.constants.js's
 * version) -- this type mirrors that single canonical enum exactly. In
 * particular: no ACTIVE (that's a TemplateStatus, never an approval
 * status), no ARCHIVED, no CHANGES_REQUESTED, no REJECTED_INTERNALLY.
 * "Changes requested" is represented as approvalStatus going back to
 * DRAFT (see ALLOWED_TRANSITIONS / the request-changes action), not as
 * its own status value.
 */

export type TemplateCategory =
  | 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | 'BOOKING' | 'PAYMENT'
  | 'FOLLOW_UP' | 'REMINDER' | 'SUPPORT' | 'SALES' | 'CUSTOM';

export const TEMPLATE_CATEGORY_VALUES: TemplateCategory[] = [
  'MARKETING', 'UTILITY', 'AUTHENTICATION', 'BOOKING', 'PAYMENT',
  'FOLLOW_UP', 'REMINDER', 'SUPPORT', 'SALES', 'CUSTOM',
];

export type TemplateStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export const TEMPLATE_STATUS_VALUES: TemplateStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ACTIVE', 'PAUSED', 'ARCHIVED'];

/**
 * The single, canonical approval-status enum -- mirrors
 * templateApproval.constants.js's APPROVAL_STATUS exactly. This is the
 * ONLY approval enum on the backend now (templates.constants.js
 * re-exports it rather than defining its own).
 */
export type ApprovalStatus =
  | 'DRAFT'
  | 'SUBMITTED_FOR_INTERNAL_REVIEW'
  | 'INTERNALLY_APPROVED'
  | 'SUBMITTED_TO_PROVIDER'
  | 'PROVIDER_APPROVED'
  | 'PROVIDER_REJECTED'
  | 'REJECTED'
  | 'PAUSED'
  | 'DISABLED';

export const APPROVAL_STATUS_VALUES: ApprovalStatus[] = [
  'DRAFT',
  'SUBMITTED_FOR_INTERNAL_REVIEW',
  'INTERNALLY_APPROVED',
  'SUBMITTED_TO_PROVIDER',
  'PROVIDER_APPROVED',
  'PROVIDER_REJECTED',
  'REJECTED',
  'PAUSED',
  'DISABLED',
];

/** The single status that makes a template usable for sending. */
export const USABLE_APPROVAL_STATUS: ApprovalStatus = 'PROVIDER_APPROVED';

export type TemplateProvider =
  | 'META_CLOUD' | 'WATI' | 'INTERAKT' | 'AISENSY' | 'GALLABOX' | 'TWILIO' | '360DIALOG' | 'CUSTOM_WEBHOOK' | 'SIMULATION';

export type HeaderType = 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
export const HEADER_TYPE_VALUES: HeaderType[] = ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'];

export type ButtonType = 'QUICK_REPLY' | 'PHONE_NUMBER' | 'URL' | 'COPY_CODE' | 'FLOW' | 'CUSTOM';
export const BUTTON_TYPE_VALUES: ButtonType[] = ['QUICK_REPLY', 'PHONE_NUMBER', 'URL', 'COPY_CODE', 'FLOW', 'CUSTOM'];

export interface TemplateButton {
  type: ButtonType;
  text: string;
  value: string;
}

export interface TemplateHeader {
  type: HeaderType;
  text: string;
  mediaUrl: string;
}

export interface ProviderMetadata {
  providerTemplateId: string | null;
  providerStatus: 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SYNCED' | 'ERROR';
  providerError: string | null;
  syncedAt: string | null;
  rawResponse: unknown;
}

export interface ApprovalHistoryEntry {
  status: string;
  comment: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface TransitionHistoryEntry {
  fromStatus: ApprovalStatus | null;
  toStatus: ApprovalStatus;
  action: string;
  comment: string;
  performedBy: string | null;
  performedAt: string;
}

export interface WhatsAppTemplate {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description: string;
  category: TemplateCategory;
  languageCode: string;
  status: TemplateStatus;
  approvalStatus: ApprovalStatus;
  provider: TemplateProvider;
  providerMetadata: ProviderMetadata;
  header: TemplateHeader;
  body: string;
  footer: string;
  buttons: TemplateButton[];
  variables: string[];
  version: number;
  usageCount: number;
  isActive: boolean;
  lastUsedAt: string | null;
  lastApprovedAt: string | null;
  lastSyncedAt: string | null;
  submittedForApprovalAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  approvalComments: string;
  approvalHistory: ApprovalHistoryEntry[];
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  rejectedBy: string | null;
  providerRejectionReason: string | null;
  providerRejectionMessage: string | null;
  transitionHistory: TransitionHistoryEntry[];
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * NOTE: no `approvalStatus` field here. It was never legitimately settable
 * on create (the backend now always forces DRAFT regardless of what's
 * sent), so it isn't offered on this type either.
 */
export interface CreateTemplateInput {
  name: string;
  category: TemplateCategory;
  languageCode: string;
  body: string;
  footer?: string;
  header?: Partial<TemplateHeader>;
  buttons?: TemplateButton[];
}

/**
 * NOTE: no `approvalStatus` / `approvalComment` fields here either. The
 * backend 400s if either appears in a generic PATCH body -- approval
 * transitions go through the dedicated Template Approval workflow calls
 * instead (see whatsappTemplateApprovalApi / useTemplateApproval, not this
 * hook).
 */
export interface UpdateTemplateInput {
  name?: string;
  category?: TemplateCategory;
  languageCode?: string;
  body?: string;
  footer?: string;
  header?: Partial<TemplateHeader>;
  buttons?: TemplateButton[];
}

export interface TemplateListQuery {
  page?: number;
  limit?: number;
  category?: TemplateCategory;
  status?: TemplateStatus;
  approvalStatus?: ApprovalStatus;
  search?: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}