import { apiClient } from '@/lib/apiClient';
import type {
  AllSettings, CompanySettings, BrandingSettings, QualificationSettings, ScoringRulesSettings,
  NotificationSettings, ConsentSettings, BillingSettings, SecuritySettings,
} from '@/types/settings';

/**
 * SOURCE: src/modules/settings/settings.controller.js
 * Standard envelope.
 */
export const settingsApi = {
  /**
   * getQualificationQuestions -- calls the narrow, deliberately ungated
   * /settings/qualification-questions endpoint, NOT the full /settings
   * bundle. Full /settings is now gated to tenant_admin+ (RBAC lockdown
   * fix), but AI Qualification legitimately needs this for sales_user+ --
   * this narrow endpoint exists specifically so that RBAC fix didn't
   * silently break a real, legitimate cross-module read.
   */
  getQualificationQuestions: () =>
    apiClient.get<{ questions: string[] }>('/settings/qualification-questions').then((r) => r.questions),

  /** Full version for the Settings page -- all 10 tabs in one call. tenant_admin+ only. */
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