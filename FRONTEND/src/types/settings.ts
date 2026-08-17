/**
 * Real Settings types -- match the backend exactly, all 10 tabs.
 *
 * Standard envelope. SOURCE: src/modules/settings/settings.service.js +
 * .constants.js. GET /settings returns all 10 tabs in one call; 8 of the
 * 10 have a dedicated PATCH endpoint. Billing is read-only (updated by
 * payment webhooks, not user-editable). Pipeline Stages' 9 keys/order are
 * fixed (see settings.service.js's comment on why), but label/color ARE
 * editable via its PATCH endpoint. Lead Fields' field SET is fixed too,
 * but which ones are required is editable the same way.
 */

import type { Plan } from './plan';

export interface CompanySettings {
  company_name: string;
  company_website: string;
  description: string;
  business_type: string;
  industry: string;
}

export interface BrandingSettings {
  accent_color: string;
  primary_color: string;
  logo_url: string | null;
  available_colors: string[];
}

export interface LeadFieldsSettings {
  fields: string[];
  required: string[];
}

export interface PipelineStageDisplay {
  id: number;
  key: string;
  name: string;
  color: string;
}

export interface QualificationSettings {
  questions: string[];
}

export interface ScoringRule {
  factor: string;
  weight: number;
}

export interface ScoringRulesSettings {
  rules: ScoringRule[];
}

export interface NotificationSettings {
  hot_lead_alert: boolean;
  booking_created: boolean;
  payment_received: boolean;
  template_approved: boolean;
  campaign_sent: boolean;
  deal_won: boolean;
  deal_lost: boolean;
}

export interface ConsentSettings {
  consent_required: boolean;
  data_retention_days: number;
  opt_out_keywords: string[];
}

export interface BillingSettings {
  plan: string;
  plan_track: 'full' | 'whatsapp_only';
  subscription_status: string;
  /** Razorpay's own lifecycle status (see subscription.service.js) --
   * 'none' for a tenant that's never had a paid subscription (e.g. still
   * on trial), vs 'halted'/'cancelled'/'expired' for one that genuinely
   * lapsed. Distinct from `subscription_status` above (our own simpler
   * trial/active/inactive concept) specifically so the UI can tell
   * "brand new, never paid" apart from "payment actually failed" --
   * conflating the two was exactly what caused a normal trial workspace
   * to show a false "payment failed" warning. */
  razorpay_subscription_status?: string;
  trial_ends_at: string | null;
  trial_days_remaining: number;
  mrr: number;
  max_users: number;
  max_leads: number;
  max_campaigns: number;
  max_workspaces: number;
  /** How many workspaces currently share this account's subscription --
   * see BACKEND/src/modules/plans/account.model.js. Billing is
   * account-level now: one subscription can cover multiple companies up
   * to max_workspaces, this is how many actually exist right now. */
  current_workspace_count: number;
  current_user_count: number;
  current_lead_count: number;
  current_campaign_count: number;
  /** Null for a tenant whose planId hasn't resolved yet -- see
   * BACKEND/src/modules/plans/plan.service.js's backfillTenantPlans and
   * Tenant.js's pre-save hook. Should self-heal on the next server boot;
   * BillingTab falls back to the plain `plan` string if this is null. */
  plan_details: Plan | null;
  available_plans: Plan[];
}

export interface SecuritySettings {
  two_factor_auth: boolean;
  sso_saml: boolean;
  audit_logging: boolean;
  ip_allowlist_enabled: boolean;
  ip_allowlist: string[];
  session_timeout_minutes: number;
}

export interface AllSettings {
  company: CompanySettings;
  branding: BrandingSettings;
  lead_fields: LeadFieldsSettings;
  pipeline_stages: PipelineStageDisplay[];
  qualification: QualificationSettings;
  scoring_rules: ScoringRulesSettings;
  notifications: NotificationSettings;
  consent: ConsentSettings;
  billing: BillingSettings;
  security: SecuritySettings;
}