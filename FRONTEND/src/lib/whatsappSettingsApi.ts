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
};