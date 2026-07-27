import { apiClient } from '@/lib/apiClient';
import type {
  AllSettings, CompanySettings, BrandingSettings, QualificationSettings, ScoringRulesSettings,
  NotificationSettings, ConsentSettings, BillingSettings, SecuritySettings,
} from '@/types/settings';

/**
 * SOURCE: src/modules/settings/settings.controller.js
 * Standard envelope. getQualificationQuestions below is the ORIGINAL
 * lightweight version -- kept exactly as-is since AI Qualification
 * already depends on it. The full Settings page uses the richer
 * functions added alongside it.
 */
interface SettingsBundle {
  qualification: {
    questions: string[];
  };
}

export const settingsApi = {
  /** Original lightweight version -- unchanged, still used by AI Qualification's discovery form. */
  getQualificationQuestions: () =>
    apiClient.get<SettingsBundle>('/settings').then((r) => r.qualification.questions),

  /** Full version for the Settings page -- all 10 tabs in one call. */
  getAll: () => apiClient.get<AllSettings>('/settings'),

  updateCompany: (data: Partial<CompanySettings>) =>
    apiClient.patch<CompanySettings>('/settings/company', data),

  updateBranding: (data: Partial<BrandingSettings>) =>
    apiClient.patch<BrandingSettings>('/settings/branding', data),

  updateQualification: (questions: string[]) =>
    apiClient.patch<QualificationSettings>('/settings/qualification', { questions }),

  updateScoringRules: (rules: { factor: string; weight: number }[]) =>
    apiClient.patch<ScoringRulesSettings>('/settings/scoring-rules', { rules }),

  updateNotifications: (data: Partial<NotificationSettings>) =>
    apiClient.patch<NotificationSettings>('/settings/notifications', data),

  updateConsent: (data: Partial<ConsentSettings>) =>
    apiClient.patch<ConsentSettings>('/settings/consent', data),

  getBilling: () => apiClient.get<BillingSettings>('/settings/billing'),

  updateSecurity: (data: Partial<SecuritySettings>) =>
    apiClient.patch<SecuritySettings>('/settings/security', data),
};