import { apiClient } from '@/lib/apiClient';
import type {
  AllSettings, CompanySettings, BrandingSettings, LeadFieldsSettings, PipelineStageDisplay,
  QualificationSettings, ScoringRulesSettings,
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

  updateLeadFields: (required: string[]) =>
    apiClient.patch<LeadFieldsSettings>('/settings/lead-fields', { required }),

  /**
   * getPipelineStagesForBoard -- calls the narrow, deliberately ungated
   * /settings/pipeline-stages/board endpoint (same reasoning as
   * getQualificationQuestions above), so the real Pipeline board
   * (sales_user+) can render each stage's current label/color even though
   * the full /settings bundle is tenant_admin-gated.
   */
  getPipelineStagesForBoard: () =>
    apiClient.get<PipelineStageDisplay[]>('/settings/pipeline-stages/board'),

  updatePipelineStages: (stages: PipelineStageDisplay[]) =>
    apiClient.patch<PipelineStageDisplay[]>('/settings/pipeline-stages', { stages }),

  /**
   * getBrandingPublic -- same narrow/ungated pattern, so every logged-in
   * role (not just tenant_admin+) can retint the app to the tenant's
   * saved accent color. See utils/theme.ts for what applies this.
   */
  getBrandingPublic: () =>
    apiClient.get<{ accent_color: string }>('/settings/branding/public'),

  /**
   * getCurrencyPublic -- same narrow/ungated pattern, so every logged-in
   * role can format money correctly (KPIs, campaign revenue, payment
   * amounts) using the tenant's actual configured currency instead of a
   * hardcoded default. See store/currencyStore.ts for what consumes this.
   */
  getCurrencyPublic: () =>
    apiClient.get<{ currency: string }>('/settings/currency/public'),

  /**
   * getPlanPublic -- same narrow/ungated pattern, so every logged-in
   * role can know their plan's track to render the sidebar correctly
   * (hide full-only modules for whatsapp_only tenants). See
   * hooks/usePlanTrack.ts for what consumes this.
   */
  getPlanPublic: () =>
    apiClient.get<{ track: string; planName: string; limits: { maxUsers: number; maxLeads: number; maxCampaigns: number; maxWorkspaces: number } }>('/settings/plan/public'),

  /**
   * updateBillingPlan -- self-service plan switch, tenant_admin+. Replaces
   * the old Super-Admin-only path (superAdminApi.updateTenant with
   * planId) for the common case; Super Admin keeps override ability for
   * support/edge cases via that same endpoint.
   */
  updateBillingPlan: (planId: string) =>
    apiClient.patch<BillingSettings>('/settings/billing/plan', { planId }),

  /** Starts a real Razorpay subscription for a paid plan. Does NOT
   * change the tenant's plan yet -- returns what's needed to open
   * Razorpay Checkout; the plan only actually switches once
   * verifySubscriptionPayment confirms real payment. */
  createSubscriptionCheckout: (planId: string) =>
    apiClient.post<{ subscriptionId: string; keyId: string; planName: string; amount: number; currency: string }>('/settings/billing/subscribe', { planId }),

  /** Called right after Razorpay Checkout's client-side success handler
   * fires -- verifies the payment server-side, then applies the switch. */
  verifySubscriptionPayment: (payload: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) =>
    apiClient.post<{ success: boolean; plan: string }>('/settings/billing/subscribe/verify', payload),

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