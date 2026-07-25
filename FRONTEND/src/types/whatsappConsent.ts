/**
 * Real WhatsApp Consent & Opt-Out types -- match the backend exactly.
 *
 * SOURCE: src/modules/whatsapp/submodules/consent/consent.model.js + .constants.js
 *
 * IMPORTANT: this is a SEPARATE collection (WhatsAppConsent) from Lead's
 * own consent_status/opt_out_status fields -- decoupled, keyed by
 * phoneNumber, not the Lead itself. Two known gaps as of this build (not
 * fixed here, just documented so nobody assumes this is fully wired):
 *   1. message.service.js's opt-out send guard still checks
 *      Lead.opt_out_status directly -- it does NOT call
 *      consentService.verifyConsent(). This module's compliance data isn't
 *      actually enforced on the real send path yet.
 *   2. Nothing auto-creates a Consent record when a lead/conversation is
 *      created -- records only exist if made manually via this tab (or
 *      Postman). The list will be genuinely empty on a fresh tenant.
 *
 * Standard envelope, list uses sendPaginated (top-level `pagination`
 * sibling of `data`, same convention as templates/deliveryLogs).
 */

export type ConsentStatus = 'OPTED_IN' | 'OPTED_OUT' | 'PENDING' | 'EXPIRED' | 'BLOCKED';

export const CONSENT_STATUS_VALUES: ConsentStatus[] = ['OPTED_IN', 'OPTED_OUT', 'PENDING', 'EXPIRED', 'BLOCKED'];

export type OptInMethod = 'WEB_FORM' | 'CHECKBOX' | 'QR_CODE' | 'SMS' | 'WHATSAPP' | 'IMPORT' | 'API' | 'MANUAL' | 'OTHER';
export const OPT_IN_METHOD_VALUES: OptInMethod[] = ['WEB_FORM', 'CHECKBOX', 'QR_CODE', 'SMS', 'WHATSAPP', 'IMPORT', 'API', 'MANUAL', 'OTHER'];

export type OptOutMethod = 'STOP' | 'UNSUBSCRIBE' | 'MANUAL' | 'API' | 'WEB' | 'OTHER';
export const OPT_OUT_METHOD_VALUES: OptOutMethod[] = ['STOP', 'UNSUBSCRIBE', 'MANUAL', 'API', 'WEB', 'OTHER'];

export type ConsentSource = 'CRM' | 'CAMPAIGN' | 'LANDING_PAGE' | 'WEBSITE' | 'WHATSAPP' | 'API' | 'IMPORT' | 'OTHER';
export const CONSENT_SOURCE_VALUES: ConsentSource[] = ['CRM', 'CAMPAIGN', 'LANDING_PAGE', 'WEBSITE', 'WHATSAPP', 'API', 'IMPORT', 'OTHER'];

export interface ConsentHistoryEntry {
  previousStatus: ConsentStatus | null;
  newStatus: ConsentStatus;
  action: string;
  reason: string;
  performedBy: string | null;
  performedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface Consent {
  id: string;
  tenantId: string;
  contactId: string | null;
  leadId: string | null;
  phoneNumber: string;
  contactName: string;
  leadName: string;
  status: ConsentStatus;
  optInMethod: OptInMethod | null;
  optOutMethod: OptOutMethod | null;
  consentSource: ConsentSource | null;
  consentText: string;
  consentedAt: string | null;
  optedOutAt: string | null;
  expiresAt: string | null;
  lastVerifiedAt: string | null;
  blockedReason: string | null;
  preBlockStatus: ConsentStatus | null;
  notes: string;
  history: ConsentHistoryEntry[];
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConsentListQuery {
  page?: number;
  limit?: number;
  status?: ConsentStatus;
  source?: ConsentSource;
  optInMethod?: OptInMethod;
  optOutMethod?: OptOutMethod;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface CreateConsentInput {
  phoneNumber: string;
  status?: ConsentStatus;
  optInMethod?: OptInMethod;
  consentSource?: ConsentSource;
  contactId?: string;
  leadId?: string;
  expiresAt?: string;
  consentText?: string;
  notes?: string;
  reason?: string;
}

export interface VerifyConsentResult {
  allowed: boolean;
  status: ConsentStatus | null;
  reason: string;
}

/** Matches consentService.getStats()'s real, single-aggregation response. */
export interface ConsentStats {
  total: number;
  counts: Record<ConsentStatus, number>;
  optOutRate: number;
}