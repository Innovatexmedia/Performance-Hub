/**
 * Settings Service — reads and writes all 10 tabs of tenant settings.
 *
 * FILE: src/modules/settings/settings.service.js
 *
 * SOURCE: FRONTEND_SPEC §19 Settings (10 tabs):
 *   Company · Branding · Lead Fields · Pipeline Stages · Qualification Questions
 *   · Scoring Rules · Notifications · Consent & Data · Billing · Security
 *
 * SOURCE: DEVELOPER_HANDOFF.md TenantSettings entity:
 *   "company_name, company_website, accent_color, qualification_questions[],
 *    pipeline_stages(PipelineStage[]), scoring_rules[{factor,weight}],
 *    consent_required, data_retention_days, notification_prefs, whatsapp(WhatsAppSettings)"
 *
 * ARCHITECTURE:
 *   Settings are stored DIRECTLY on the Tenant document (embedded sub-schemas).
 *   No separate settings collection.
 *   The Tenant model already has all the required fields:
 *     name, website → Company tab
 *     branding.accentColor → Branding tab
 *     notificationPreferences → Notifications tab
 *     securitySettings → Security tab
 *     plan, subscriptionStatus, mrr → Billing tab
 *
 *   Fields NOT on Tenant (stored in TenantSettings sub-doc added here):
 *     qualification_questions[] → Qualification tab
 *     scoring_rules[]           → Scoring Rules tab
 *     consent_required          → Consent & Data tab
 *     data_retention_days       → Consent & Data tab
 *
 * CONNECTED MODULES:
 *   AI Qualification module reads qualification_questions from settings
 *   Scoring service reads scoring_rules from settings
 *   Auth module reads securitySettings for 2FA enforcement
 */

import Tenant from '../auth/models/Tenant.js';
import { AppError } from '../../shared/helpers/lead.helpers.js';
import {
  DEFAULT_QUALIFICATION_QUESTIONS,
  DEFAULT_SCORING_RULES,
  PIPELINE_STAGES,
  LEAD_FIELDS,
  SUBSCRIPTION_PLAN_DETAILS,
  ACCENT_COLORS,
} from './settings.constants.js';

// =============================================================================
// PRIVATE HELPERS
// =============================================================================

const buildCtx = (reqUser) => ({
  tenantId: reqUser.tenantId,
  userId:   reqUser.sub,
  role:     reqUser.role,
});

/**
 * getTenant — loads the tenant by ID, throws if not found.
 */
const getTenant = async (tenantId) => {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw AppError.notFound('Workspace not found');
  return tenant;
};

// =============================================================================
// GET ALL SETTINGS — single call to load the full settings page
// =============================================================================

/**
 * getQualificationQuestions — returns ONLY the discovery questions array,
 * not the full settings bundle. Added when GET /settings was locked down
 * to tenant_admin+ (Team/Settings/Integrations RBAC fix) -- AI
 * Qualification legitimately needs these for sales_user+ (per the real
 * RBAC matrix, running qualification requires only sales_user), so it
 * needed its own narrow, ungated endpoint rather than either leaving the
 * whole settings bundle open or breaking a legitimate cross-module read.
 * Same real fallback logic as the Qualification tab inside
 * getAllSettings below -- not duplicated logic, just not the full bundle.
 */
/**
 * mergeStageOverrides — the fixed stage list with any tenant label/color
 * overrides applied. Shared by getPipelineStageOverrides (uses its own
 * tenant fetch) and getAllSettings (reuses the tenant it already loaded).
 */
const mergeStageOverrides = (tenant) => {
  const overrides = tenant.pipelineStageOverrides || new Map();
  return PIPELINE_STAGES.map((stage) => {
    const override = overrides.get ? overrides.get(stage.key) : overrides[stage.key];
    return {
      id:    stage.id,
      key:   stage.key,
      name:  override?.label || stage.name,
      color: override?.color || stage.color,
    };
  });
};

export const getQualificationQuestions = async (tenantId) => {
  const tenant = await getTenant(tenantId);
  return {
    questions: tenant.qualificationQuestions?.length
      ? tenant.qualificationQuestions
      : [...DEFAULT_QUALIFICATION_QUESTIONS],
  };
};

/**
 * leadFieldsConfig — the fixed field list + which are required. Shared by
 * getLeadFieldsConfig (own tenant fetch) and getAllSettings (reuses the
 * tenant it already loaded), same pattern as mergeStageOverrides.
 */
const leadFieldsConfig = (tenant) => ({
  fields:   LEAD_FIELDS,
  required: tenant.requiredLeadFields?.length ? tenant.requiredLeadFields : ['name', 'phone'],
});

/**
 * getLeadFieldsConfig — narrow read used by the GET /lead-fields endpoint.
 */
export const getLeadFieldsConfig = async (tenantId) => {
  const tenant = await getTenant(tenantId);
  return leadFieldsConfig(tenant);
};

/**
 * getPipelineStageOverrides — narrow, ungated cross-module read, same
 * reasoning as getQualificationQuestions above: the real Pipeline board
 * (sales_user+) needs each stage's current label/color, but the full
 * settings bundle is tenant_admin-gated. Returns the fixed stage list with
 * any tenant overrides merged in -- never fewer/more/reordered stages.
 */
export const getPipelineStageOverrides = async (tenantId) => {
  const tenant = await getTenant(tenantId);
  return { stages: mergeStageOverrides(tenant) };
};

/**
 * getBrandingPublic — narrow, ungated cross-module read, same reasoning as
 * getQualificationQuestions/getPipelineStageOverrides above: EVERY logged-in
 * user needs the tenant's accent color to actually retint the UI (not just
 * tenant_admin+, who are the only ones who can change it via the full,
 * admin-gated settings bundle).
 */
export const getBrandingPublic = async (tenantId) => {
  const tenant = await getTenant(tenantId);
  return { accent_color: tenant.branding?.accentColor || '#6366f1' };
};

/**
 * getAllSettings — returns all 10 tabs of settings data.
 * Called on Settings page load — one request, all tabs.
 */
export const getAllSettings = async (tenantId) => {
  const tenant = await getTenant(tenantId);

  return {
    // Tab 1: Company
    company: {
      company_name:    tenant.name,
      company_website: tenant.website || '',
      description:     tenant.description || '',
      business_type:   tenant.businessType || 'other',
      industry:        tenant.industry || '',
    },

    // Tab 2: Branding
    branding: {
      accent_color:    tenant.branding?.accentColor   || '#6366f1',
      primary_color:   tenant.branding?.primaryColor  || '#6366f1',
      logo_url:        tenant.branding?.logoUrl        || null,
      available_colors: ACCENT_COLORS,
    },

    // Tab 3: Lead Fields -- which of the fixed fields are required
    lead_fields: leadFieldsConfig(tenant),

    // Tab 4: Pipeline Stages -- fixed keys/order, editable label + color
    pipeline_stages: mergeStageOverrides(tenant),

    // Tab 5: Qualification Questions
    qualification: {
      questions: tenant.qualificationQuestions?.length
        ? tenant.qualificationQuestions
        : [...DEFAULT_QUALIFICATION_QUESTIONS],
    },

    // Tab 6: Scoring Rules
    scoring_rules: {
      rules: tenant.scoringRules?.length
        ? tenant.scoringRules
        : [...DEFAULT_SCORING_RULES],
    },

    // Tab 7: Notifications
    notifications: {
      hot_lead_alert:     tenant.notificationPreferences?.hotLeadAlert     ?? true,
      booking_created:    tenant.notificationPreferences?.bookingCreated    ?? true,
      payment_received:   tenant.notificationPreferences?.paymentReceived   ?? true,
      template_approved:  tenant.notificationPreferences?.templateApproved  ?? true,
      campaign_sent:      tenant.notificationPreferences?.campaignSent       ?? true,
      deal_won:           tenant.notificationPreferences?.dealWon            ?? true,
      deal_lost:          tenant.notificationPreferences?.dealLost           ?? false,
    },

    // Tab 8: Consent & Data
    consent: {
      consent_required:     tenant.consentRequired     ?? true,
      data_retention_days:  tenant.dataRetentionDays   ?? 365,
      opt_out_keywords:     tenant.optOutKeywords       || ['STOP', 'UNSUBSCRIBE', 'OPTOUT'],
    },

    // Tab 9: Billing
    billing: {
      plan:                  tenant.plan,
      subscription_status:   tenant.subscriptionStatus,
      trial_ends_at:         tenant.trialEndsAt || null,
      trial_days_remaining:  tenant.trialDaysRemaining || 0,
      mrr:                   tenant.mrr || 0,
      max_users:             tenant.maxUsers,
      max_leads:             tenant.maxLeads,
      max_campaigns:         tenant.maxCampaigns,
      current_user_count:    tenant.currentUserCount,
      current_lead_count:    tenant.currentLeadCount,
      current_campaign_count:tenant.currentCampaignCount,
      plan_details:          SUBSCRIPTION_PLAN_DETAILS[tenant.plan] || SUBSCRIPTION_PLAN_DETAILS.free,
    },

    // Tab 10: Security
    security: {
      two_factor_auth:         tenant.securitySettings?.enforce2FA            ?? false,
      sso_saml:                false, // future feature — 🔭 development-phase
      audit_logging:           true,  // always on in production
      ip_allowlist_enabled:    tenant.securitySettings?.enforceIpAllowlist     ?? false,
      ip_allowlist:            tenant.securitySettings?.ipAllowlist             || [],
      session_timeout_minutes: tenant.securitySettings?.sessionTimeoutMinutes   ?? 480,
    },
  };
};

// =============================================================================
// TAB 3 — LEAD FIELDS
// =============================================================================

/**
 * updateLeadFields — saves which of the fixed LEAD_FIELDS are required when
 * creating a lead. The field SET itself is not editable (it maps directly
 * to real columns on the Lead schema) -- only which ones are mandatory.
 * validateCreateLead reads this instead of its old hardcoded name+phone rule.
 */
export const updateLeadFields = async (tenantId, data, reqUser) => {
  const ctx    = buildCtx(reqUser);
  const tenant = await getTenant(tenantId);

  if (!Array.isArray(data.required)) {
    throw AppError.badRequest('required must be an array');
  }
  const invalid = data.required.filter((f) => !LEAD_FIELDS.includes(f));
  if (invalid.length) {
    throw AppError.badRequest(`Unknown field(s): ${invalid.join(', ')}`);
  }
  if (!data.required.includes('name')) {
    // name is the one field every list/board/detail view assumes exists --
    // never let it be toggled off, same spirit as phone being effectively
    // mandatory for a WhatsApp-first product.
    throw AppError.badRequest('"name" must always be required');
  }

  tenant.requiredLeadFields = [...new Set(data.required)];
  tenant.markModified('requiredLeadFields');
  tenant.updatedBy = ctx.userId;
  await tenant.save();

  return leadFieldsConfig(tenant);
};

// =============================================================================
// TAB 4 — PIPELINE STAGES
// =============================================================================

/**
 * updatePipelineStages — saves per-stage label/color overrides. Accepts the
 * full 9-stage array back (as returned by GET), validates it's exactly the
 * same fixed set of keys in the same order (nothing added/removed/
 * reordered), and stores only the label/color that differ from the default
 * as overrides -- see Tenant.pipelineStageOverrides' comment for why keys
 * themselves aren't editable.
 */
export const updatePipelineStages = async (tenantId, data, reqUser) => {
  const ctx    = buildCtx(reqUser);
  const tenant = await getTenant(tenantId);

  if (!Array.isArray(data.stages) || data.stages.length !== PIPELINE_STAGES.length) {
    throw AppError.badRequest(`stages must be an array of exactly ${PIPELINE_STAGES.length} items`);
  }

  const overrides = new Map();
  data.stages.forEach((incoming, i) => {
    const expected = PIPELINE_STAGES[i];
    if (!incoming || incoming.key !== expected.key) {
      throw AppError.badRequest(
        `Stage ${i + 1} must be "${expected.key}" (stages cannot be added, removed, or reordered)`,
      );
    }
    const label = String(incoming.name || '').trim();
    const color = String(incoming.color || '').trim();
    if (!label) throw AppError.badRequest(`Stage "${expected.key}" needs a label`);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw AppError.badRequest(`Stage "${expected.key}" needs a valid hex color`);
    }
    if (label !== expected.name || color !== expected.color) {
      overrides.set(expected.key, { label, color });
    }
    // else: matches the default exactly -> no override stored for it.
  });

  tenant.pipelineStageOverrides = overrides;
  tenant.markModified('pipelineStageOverrides');
  tenant.updatedBy = ctx.userId;
  await tenant.save();

  return { stages: mergeStageOverrides(tenant) };
};

// =============================================================================
// TAB 1 — COMPANY
// =============================================================================

/**
 * updateCompany — saves Company Profile tab.
 * SOURCE: FRONTEND_SPEC §19 Company tab — Company Name + Website
 */
export const updateCompany = async (tenantId, data, reqUser) => {
  const ctx    = buildCtx(reqUser);
  const tenant = await getTenant(tenantId);

  if (data.company_name !== undefined) tenant.name        = data.company_name.trim();
  if (data.company_website !== undefined) tenant.website  = data.company_website.trim();
  if (data.description !== undefined) tenant.description  = data.description.trim();
  if (data.business_type !== undefined) tenant.businessType = data.business_type;
  if (data.industry !== undefined) tenant.industry        = data.industry.trim();

  tenant.updatedBy = ctx.userId;
  await tenant.save();

  return {
    company_name:    tenant.name,
    company_website: tenant.website || '',
    description:     tenant.description || '',
    business_type:   tenant.businessType,
    industry:        tenant.industry || '',
  };
};

// =============================================================================
// TAB 2 — BRANDING
// =============================================================================

/**
 * updateBranding — saves Branding tab.
 * SOURCE: FRONTEND_SPEC §19 Branding — Accent Color picker
 */
export const updateBranding = async (tenantId, data, reqUser) => {
  const ctx    = buildCtx(reqUser);
  const tenant = await getTenant(tenantId);

  if (!tenant.branding) tenant.branding = {};
  if (data.accent_color  !== undefined) tenant.branding.accentColor  = data.accent_color;
  if (data.primary_color !== undefined) tenant.branding.primaryColor = data.primary_color;
  if (data.logo_url      !== undefined) tenant.branding.logoUrl      = data.logo_url;

  tenant.markModified('branding');
  tenant.updatedBy = ctx.userId;
  await tenant.save();

  return {
    accent_color:  tenant.branding.accentColor  || '#6366f1',
    primary_color: tenant.branding.primaryColor || '#6366f1',
    logo_url:      tenant.branding.logoUrl      || null,
  };
};

// =============================================================================
// TAB 5 — QUALIFICATION QUESTIONS
// =============================================================================

/**
 * updateQualification — saves Qualification Questions tab.
 * SOURCE: FRONTEND_SPEC §19 Qualification Questions — add/remove questions
 * SOURCE: MASTER_SPEC §B19 "qualification questions (add/remove)"
 * These questions are shown in the AI Qualification page discovery form.
 */
export const updateQualification = async (tenantId, data, reqUser) => {
  const ctx    = buildCtx(reqUser);
  const tenant = await getTenant(tenantId);

  if (!Array.isArray(data.questions)) {
    throw AppError.badRequest('questions must be an array');
  }
  if (data.questions.length === 0) {
    throw AppError.badRequest('At least one qualification question is required');
  }

  // Store on tenant document — add qualificationQuestions field
  tenant.qualificationQuestions = data.questions
    .map((q) => String(q).trim())
    .filter(Boolean);

  tenant.markModified('qualificationQuestions');
  tenant.updatedBy = ctx.userId;
  await tenant.save();

  return { questions: tenant.qualificationQuestions };
};

// =============================================================================
// TAB 6 — SCORING RULES
// =============================================================================

/**
 * updateScoringRules — saves Scoring Rules tab.
 * SOURCE: FRONTEND_SPEC §19 Scoring Rules — "Weighting factors for lead scoring (total should be 100)"
 * SOURCE: MASTER_SPEC §B19 "scoring weights"
 */
export const updateScoringRules = async (tenantId, data, reqUser) => {
  const ctx    = buildCtx(reqUser);
  const tenant = await getTenant(tenantId);

  if (!Array.isArray(data.rules)) {
    throw AppError.badRequest('rules must be an array');
  }

  const total = data.rules.reduce((sum, r) => sum + (Number(r.weight) || 0), 0);
  if (Math.round(total) !== 100) {
    throw AppError.badRequest(`Scoring weights must sum to 100 (current total: ${total})`);
  }

  tenant.scoringRules = data.rules.map((r) => ({
    factor: String(r.factor).trim(),
    weight: Number(r.weight),
  }));

  tenant.markModified('scoringRules');
  tenant.updatedBy = ctx.userId;
  await tenant.save();

  return { rules: tenant.scoringRules };
};

// =============================================================================
// TAB 7 — NOTIFICATIONS
// =============================================================================

/**
 * updateNotifications — saves Notifications tab toggles.
 * SOURCE: MASTER_SPEC §B19 "notification toggles"
 */
export const updateNotifications = async (tenantId, data, reqUser) => {
  const ctx    = buildCtx(reqUser);
  const tenant = await getTenant(tenantId);

  if (!tenant.notificationPreferences) tenant.notificationPreferences = {};

  const prefs = tenant.notificationPreferences;
  if (data.hot_lead_alert    !== undefined) prefs.hotLeadAlert    = Boolean(data.hot_lead_alert);
  if (data.booking_created   !== undefined) prefs.bookingCreated  = Boolean(data.booking_created);
  if (data.payment_received  !== undefined) prefs.paymentReceived = Boolean(data.payment_received);
  if (data.template_approved !== undefined) prefs.templateApproved= Boolean(data.template_approved);
  if (data.campaign_sent     !== undefined) prefs.campaignSent    = Boolean(data.campaign_sent);
  if (data.deal_won          !== undefined) prefs.dealWon         = Boolean(data.deal_won);
  if (data.deal_lost         !== undefined) prefs.dealLost        = Boolean(data.deal_lost);

  tenant.markModified('notificationPreferences');
  tenant.updatedBy = ctx.userId;
  await tenant.save();

  return {
    hot_lead_alert:    prefs.hotLeadAlert,
    booking_created:   prefs.bookingCreated,
    payment_received:  prefs.paymentReceived,
    template_approved: prefs.templateApproved,
    campaign_sent:     prefs.campaignSent,
    deal_won:          prefs.dealWon,
    deal_lost:         prefs.dealLost,
  };
};

// =============================================================================
// TAB 8 — CONSENT & DATA
// =============================================================================

/**
 * updateConsent — saves Consent & Data tab.
 * SOURCE: MASTER_SPEC §B19 "consent + retention"
 */
export const updateConsent = async (tenantId, data, reqUser) => {
  const ctx    = buildCtx(reqUser);
  const tenant = await getTenant(tenantId);

  if (data.consent_required    !== undefined) tenant.consentRequired    = Boolean(data.consent_required);
  if (data.data_retention_days !== undefined) tenant.dataRetentionDays  = Number(data.data_retention_days);
  if (data.opt_out_keywords    !== undefined) tenant.optOutKeywords     = data.opt_out_keywords;

  tenant.updatedBy = ctx.userId;
  await tenant.save();

  return {
    consent_required:    tenant.consentRequired,
    data_retention_days: tenant.dataRetentionDays,
    opt_out_keywords:    tenant.optOutKeywords,
  };
};

// =============================================================================
// TAB 10 — SECURITY
// =============================================================================

/**
 * updateSecurity — saves Security tab toggles.
 * SOURCE: FRONTEND_SPEC §19 Security tab:
 *   Two-factor authentication | SSO/SAML | Audit logging | IP allowlist
 */
export const updateSecurity = async (tenantId, data, reqUser) => {
  const ctx    = buildCtx(reqUser);
  const tenant = await getTenant(tenantId);

  if (!tenant.securitySettings) tenant.securitySettings = {};

  const sec = tenant.securitySettings;
  if (data.two_factor_auth         !== undefined) sec.enforce2FA             = Boolean(data.two_factor_auth);
  if (data.ip_allowlist_enabled    !== undefined) sec.enforceIpAllowlist     = Boolean(data.ip_allowlist_enabled);
  if (data.ip_allowlist            !== undefined) sec.ipAllowlist            = data.ip_allowlist;
  if (data.session_timeout_minutes !== undefined) sec.sessionTimeoutMinutes  = Number(data.session_timeout_minutes);

  tenant.markModified('securitySettings');
  tenant.updatedBy = ctx.userId;
  await tenant.save();

  return {
    two_factor_auth:         sec.enforce2FA,
    ip_allowlist_enabled:    sec.enforceIpAllowlist,
    ip_allowlist:            sec.ipAllowlist,
    session_timeout_minutes: sec.sessionTimeoutMinutes,
    audit_logging:           true,
    sso_saml:                false,
  };
};