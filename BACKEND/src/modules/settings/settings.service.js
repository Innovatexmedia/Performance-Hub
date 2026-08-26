import Tenant from '../auth/models/Tenant.js';
import Plan from '../plans/plan.model.js';
import Account from '../plans/account.model.js';
import { syncTenantsFromAccount } from '../plans/plan.service.js';
import { AppError } from '../../shared/helpers/lead.helpers.js';
import { PAYMENT_CURRENCY_VALUES } from '../payments/payment.constants.js';
import {
  DEFAULT_QUALIFICATION_QUESTIONS,
  DEFAULT_SCORING_RULES,
  PIPELINE_STAGES,
  LEAD_FIELDS,
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
 * getAccountForTenant — billing state (subscriptionStatus, trialEndsAt,
 * mrr, razorpaySubscriptionStatus) now lives on Account, not Tenant --
 * see plans/account.model.js. Tenant keeps denormalized COPIES of
 * plan/planTrack/maxUsers etc. (still safe to read directly off tenant
 * for those), but the subscription-lifecycle fields specifically only
 * exist on the real Account now, so the Billing tab and updateBillingPlan
 * both need this lookup.
 */
const getAccountForTenant = async (tenant) => {
  if (!tenant.accountId) return null;
  return Account.findById(tenant.accountId);
};

/** trialDaysRemaining -- Account doesn't have Tenant's old virtual for
 * this, computed inline instead since only these two spots need it. */
const trialDaysRemaining = (account) => {
  if (!account?.trialEndsAt || account.subscriptionStatus !== 'trial') return 0;
  const diff = account.trialEndsAt.getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86_400_000));
};

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
 * getCurrencyPublic — narrow, ungated cross-module read, same reasoning as
 * getBrandingPublic above: EVERY logged-in user needs the tenant's
 * configured currency to correctly format money anywhere in the app (KPI
 * cards, campaign revenue, payment amounts) -- not just tenant_admin+, who
 * are the only ones who can change it via the full settings bundle.
 * Single workspace-wide currency (not per-transaction FX conversion) --
 * see Tenant.js's `currency` field comment for why.
 */
export const getCurrencyPublic = async (tenantId) => {
  const tenant = await getTenant(tenantId);
  return { currency: tenant.currency || 'USD' };
};

/**
 * getPlanPublic — narrow, ungated cross-module read, same pattern as
 * getBrandingPublic/getPipelineStageOverrides/getQualificationQuestions
 * above: EVERY logged-in role needs to know their plan's track to render
 * the sidebar correctly (hide full-only modules for whatsapp_only
 * tenants), not just tenant_admin+, who are the only ones who can see
 * the full billing bundle.
 */
export const getPlanPublic = async (tenantId) => {
  const tenant = await getTenant(tenantId);
  const plan = tenant.planId ? await Plan.findById(tenant.planId) : null;
  return {
    track: tenant.planTrack,
    planName: plan?.name || tenant.plan,
    limits: {
      maxUsers: tenant.maxUsers,
      maxLeads: tenant.maxLeads,
      maxCampaigns: tenant.maxCampaigns,
      maxWorkspaces: tenant.maxWorkspaces,
    },
  };
};

/**
 * updateBillingPlan — self-service plan switch.
 *
 * Previously this was Super Admin-only (via superAdmin.service.js's
 * updateTenant). That made sense as a stopgap while there was no real
 * payment gate to protect, but it's backwards from how billing should
 * work: a tenant owner should be able to see and pick their own plan
 * directly, the same way every real SaaS billing page works -- not have
 * it manually assigned by a platform admin every time.
 *
 * No payment collected here yet (see Razorpay integration, still
 * pending) -- this just switches which Plan a tenant is on and re-syncs
 * denormalized limits/track via Tenant.js's upgradePlan()/pre-save hook,
 * same mechanism Super Admin's path already used. Once Razorpay is wired
 * in, this is the natural place to gate on "payment succeeded" before
 * calling upgradePlan() -- the plan-switching logic itself doesn't change.
 */
export const updateBillingPlan = async (tenantId, planId, reqUser) => {
  const ctx    = buildCtx(reqUser);
  const tenant = await getTenant(tenantId);

  if (!planId) throw AppError.badRequest('planId is required');
  if (!tenant.accountId) throw AppError.badRequest('This workspace is not linked to a billing account yet -- contact support.');

  const targetPlan = await Plan.findById(planId);
  if (!targetPlan) throw AppError.notFound('Plan not found');
  if (!targetPlan.isActive) throw AppError.badRequest(`"${targetPlan.name}" is no longer available -- choose a different plan`);
  if (targetPlan.price > 0) {
    // Paid plans go through the real Razorpay checkout/verify flow (see
    // subscription.service.js) so a switch can never happen without an
    // actual payment. This direct path stays open ONLY for $0 plans --
    // e.g. downgrading back to a free tier needs no payment at all.
    throw AppError.badRequest(`"${targetPlan.name}" requires payment -- use the checkout flow, not a direct switch.`);
  }

  const account = await getAccountForTenant(tenant);
  if (!account) throw AppError.notFound('Billing account not found');

  await account.upgradePlan(targetPlan._id);
  await account.save();
  // Propagates to EVERY tenant this account covers, not just the one
  // this request happened to come from -- the whole point of
  // account-level billing.
  await syncTenantsFromAccount(account._id);

  const refreshedTenant = await getTenant(tenantId); // re-read post-sync so the response reflects the new denormalized numbers
  const [currentPlan, availablePlans, accountWorkspaceCount] = await Promise.all([
    Plan.findById(account.planId),
    Plan.find({ isActive: true }).sort({ sortOrder: 1, price: 1 }),
    Tenant.countDocuments({ accountId: account._id }),
  ]);

  return {
    plan:                  refreshedTenant.plan,
    plan_track:            refreshedTenant.planTrack,
    subscription_status:   account.subscriptionStatus,
    razorpay_subscription_status: account.razorpaySubscriptionStatus,
    trial_ends_at:         account.trialEndsAt || null,
    trial_days_remaining:  trialDaysRemaining(account),
    mrr:                   account.mrr || 0,
    max_users:             refreshedTenant.maxUsers,
    max_leads:             refreshedTenant.maxLeads,
    max_campaigns:         refreshedTenant.maxCampaigns,
    max_workspaces:        refreshedTenant.maxWorkspaces,
    current_workspace_count: accountWorkspaceCount,
    current_user_count:    refreshedTenant.currentUserCount, 
    current_lead_count:    refreshedTenant.currentLeadCount,
    current_campaign_count:refreshedTenant.currentCampaignCount,
    plan_details:          currentPlan,
    available_plans:       availablePlans, 
  };
};

export const getAllSettings = async (tenantId) => {
  const tenant = await getTenant(tenantId);
  const [currentPlan, availablePlans, account, accountWorkspaceCount] = await Promise.all([
    tenant.planId ? Plan.findById(tenant.planId) : null,
    Plan.find({ isActive: true }).sort({ sortOrder: 1, price: 1 }),
    getAccountForTenant(tenant),
    tenant.accountId ? Tenant.countDocuments({ accountId: tenant.accountId }) : 1,
  ]);

  return {
    // Tab 1: Company
    company: {
      company_name:    tenant.name,
      company_website: tenant.website || '',
      description:     tenant.description || '',
      business_type:   tenant.businessType || 'other',
      industry:        tenant.industry || '',
      currency:        tenant.currency || 'USD',
      available_currencies: PAYMENT_CURRENCY_VALUES,
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

    // Tab 9: Billing -- real Plan document (not the old hardcoded
    // SUBSCRIPTION_PLAN_DETAILS object), plus the full list of currently
    // purchasable plans so the tab can show upgrade options.
    billing: {
      plan:                  tenant.plan,
      plan_track:            tenant.planTrack,
      subscription_status:   account?.subscriptionStatus || 'trial',
      razorpay_subscription_status: account?.razorpaySubscriptionStatus || 'none',
      trial_ends_at:         account?.trialEndsAt || null,
      trial_days_remaining:  trialDaysRemaining(account),
      mrr:                   account?.mrr || 0,
      max_users:             tenant.maxUsers,
      max_leads:             tenant.maxLeads,
      max_campaigns:         tenant.maxCampaigns,
      max_workspaces:        tenant.maxWorkspaces,
      current_workspace_count: accountWorkspaceCount,
      current_user_count:    tenant.currentUserCount,
      current_lead_count:    tenant.currentLeadCount,
      current_campaign_count:tenant.currentCampaignCount,
      plan_details:          currentPlan,
      available_plans:       availablePlans,
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
  if (data.currency !== undefined) tenant.currency        = data.currency;

  tenant.updatedBy = ctx.userId;
  await tenant.save();

  return {
    company_name:    tenant.name,
    company_website: tenant.website || '',
    description:     tenant.description || '',
    business_type:   tenant.businessType,
    industry:        tenant.industry || '',
    currency:        tenant.currency || 'USD',
    available_currencies: PAYMENT_CURRENCY_VALUES,
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