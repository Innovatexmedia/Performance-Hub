/**
 * Real Integration types -- match the backend exactly.
 *
 * Standard envelope. SOURCE: src/modules/integrations/integration.model.js
 * + .constants.js. Confirmed spec-aligned: entity fields match
 * DEVELOPER_HANDOFF.md exactly, all 3 named actions
 * (toggleIntegration/syncIntegration/updateIntegrationConfig) are real,
 * 22-item catalog confirmed (7+3+3+2+3+2+2=22), WhatsApp provider names
 * cross-verified against the already-established PROVIDER enum in
 * whatsapp/submodules/templates/templates.constants.js.
 *
 * MASTER_SPEC.md B17 explicitly marks this module "🟡 simulated" -- the
 * connection state is genuinely real and persisted, but no live external
 * API calls to Stripe/Twilio/etc. are made. Status: 'connected' means
 * "has real-looking config values saved", not "verified against a live
 * external service".
 */

export type IntegrationCategory =
  | 'WhatsApp Providers' | 'Payments' | 'AI' | 'Calendars' | 'Email' | 'Calls' | 'CRM/Ads';

export const INTEGRATION_CATEGORY_VALUES: IntegrationCategory[] = [
  'WhatsApp Providers', 'Payments', 'AI', 'Calendars', 'Email', 'Calls', 'CRM/Ads',
];

export type IntegrationStatus = 'connected' | 'disconnected' | 'simulation';

export type ErrorLogSeverity = 'warning' | 'error';

export interface IntegrationErrorLog {
  message: string;
  severity: ErrorLogSeverity;
  occurred_at: string;
}

export interface Integration {
  id: string;
  tenant_id: string;
  key: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  logo_color: string;
  status: IntegrationStatus;
  available: boolean;
  last_sync: string | null;
  config: Record<string, unknown>;
  error_logs: IntegrationErrorLog[];
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationListQuery {
  category?: IntegrationCategory;
  status?: IntegrationStatus;
  search?: string;
  page?: number;
  limit?: number;
}

export interface IntegrationCounts {
  total: number;
  totalConnected: number;
  byCategory: Partial<Record<IntegrationCategory, { count: number; connected: number }>>;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}