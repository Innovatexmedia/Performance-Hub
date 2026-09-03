import { apiClient } from '@/lib/apiClient';
import type {
  WhatsAppSettings, UpdateProviderInput, UpdateSyncInput, TestConnectionResult,
} from '@/types/whatsappSettings';

/**
 * SOURCE: src/modules/whatsapp/submodules/whatsappSettings/whatsappSettings.controller.js
 * Standard envelope. Scoped to Phase 1's fields (provider + sync) --
 * doesn't cover the other 8 settings sections that exist on the backend
 * but aren't part of this screen yet.
 */
export const whatsappSettingsApi = {
  get: () => apiClient.get<WhatsAppSettings>('/whatsapp/settings'),

  updateProvider: (input: UpdateProviderInput) =>
    apiClient.patch<WhatsAppSettings>('/whatsapp/settings/provider', input),

  updateSync: (input: UpdateSyncInput) =>
    apiClient.patch<WhatsAppSettings>('/whatsapp/settings/sync', input),

  testConnection: () => apiClient.post<TestConnectionResult>('/whatsapp/settings/test-connection'),

  /** Completes Meta Embedded Signup after the JS SDK popup hands back a
   * code + WABA/phone number id -- see WhatsAppSettings tab's message
   * listener for where these come from. */
  exchangeEmbeddedSignup: (data: { code: string; wabaId: string; phoneNumberId: string }) =>
    apiClient.post<WhatsAppSettings>('/whatsapp/settings/embedded-signup/exchange', data),

  /**
   * The only one of these four with a REAL implementation -- calls Meta's
   * actual template list API and reconciles our DB (see
   * templatesService.syncFromMeta). Returns { created, updated, total,
   * errors, syncedAt } inside `result`.
   */
  syncTemplates: () => apiClient.post<SyncResult>('/whatsapp/settings/sync/templates'),

  /** NOT yet real -- backend still just stamps a timestamp. Exposed here
   * so the button exists and is honest about what it does today. */
  syncContacts: () => apiClient.post<SyncResult>('/whatsapp/settings/sync/contacts'),
  syncMessages: () => apiClient.post<SyncResult>('/whatsapp/settings/sync/messages'),
  syncProfile: () => apiClient.post<SyncResult>('/whatsapp/settings/sync/profile'),
};

export interface SyncResult {
  entity: string;
  syncedAt: string;
  implemented: boolean;
  result: { created: number; updated: number; total: number; errors: { name?: string; message: string }[] } | null;
}