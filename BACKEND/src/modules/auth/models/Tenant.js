import mongoose from 'mongoose';
import config from '../../../config/config.js';
import {
  SUBSCRIPTION_STATUS,
} from '../constants/auth.constants.js';
import Account from '../../plans/account.model.js';
import { PAYMENT_CURRENCY_VALUES } from '../../payments/payment.constants.js';

const { Schema } = mongoose;

// =============================================================================
// PLAN CONSTANTS
// =============================================================================

export const SUBSCRIPTION_PLANS = Object.freeze({
  FREE:       'free',
  STARTER:    'starter',
  GROWTH:     'growth',
  SCALE:      'scale',
  ENTERPRISE: 'enterprise',
});

export const WORKSPACE_STATUS = Object.freeze({
  ACTIVE:    'active',
  INACTIVE:  'inactive',
  SUSPENDED: 'suspended',
});

export const PLAN_LIMITS = Object.freeze({
  free:       { maxUsers: config.PLAN_MAX_USERS_FREE,       maxLeads: 250,    maxCampaigns: 3,   maxWorkspaces: 1   },
  starter:    { maxUsers: config.PLAN_MAX_USERS_STARTER,    maxLeads: 1000,   maxCampaigns: 10,  maxWorkspaces: 3   },
  growth:     { maxUsers: config.PLAN_MAX_USERS_GROWTH,     maxLeads: 10000,  maxCampaigns: 50,  maxWorkspaces: 10  },
  scale:      { maxUsers: config.PLAN_MAX_USERS_SCALE,      maxLeads: 50000,  maxCampaigns: 200, maxWorkspaces: 25  },
  enterprise: { maxUsers: config.PLAN_MAX_USERS_ENTERPRISE, maxLeads: 999999, maxCampaigns: 999, maxWorkspaces: 999 },
});

// =============================================================================
// SUB-SCHEMAS
// =============================================================================

const brandingSchema = new Schema({
  primaryColor:   { type: String, default: '#6366f1' },
  secondaryColor: { type: String, default: '#0d9488' },
  accentColor:    { type: String, default: '#7c3aed' },
  logoUrl:        { type: String, default: null },
  customDomain:   { type: String, default: null, lowercase: true },
}, { _id: false });

/**
 * ⚠️ SECURITY — credential fields use select: false
 * These must be encrypted before storage using utils/crypto.js encrypt().
 * They must NEVER appear in API responses or logs.
 */
const whatsAppSettingsSchema = new Schema({
  mode: {
    type:    String,
    enum:    ['native', 'third_party', 'simulation'],
    default: 'simulation',
  },
  provider:           { type: String, default: 'simulation' },
  phoneNumberId:      { type: String, default: null, select: false }, // ⚠️ encrypted
  wabaId:             { type: String, default: null },
  accessToken:        { type: String, default: null, select: false }, // ⚠️ encrypted
  webhookVerifyToken: { type: String, default: null, select: false }, // ⚠️ encrypted
  apiKey:             { type: String, default: null, select: false }, // ⚠️ encrypted
  apiEndpoint:        { type: String, default: null },
  syncContacts:       { type: Boolean, default: false },
  syncTemplates:      { type: Boolean, default: false },
  autoOptOut:         { type: Boolean, default: true },
  lastSyncedAt:       { type: Date,    default: null },
}, { _id: false });

/**
 * ⚠️ SECURITY — aiApiKey must be encrypted before storage.
 */
const aiConfigSchema = new Schema({
  aiEnabled: { type: Boolean, default: false },
  aiModel:   { type: String, enum: ['gpt-4o', 'claude'], default: 'gpt-4o' },
  aiApiKey:  { type: String, default: null, select: false }, // ⚠️ encrypted
}, { _id: false });

const securitySettingsSchema = new Schema({
  enforce2FA:            { type: Boolean,  default: false },
  sessionTimeoutMinutes: { type: Number,   default: 480 },
  ipAllowlist:           { type: [String], default: [] },
  enforceIpAllowlist:    { type: Boolean,  default: false },
}, { _id: false });

const notificationPreferencesSchema = new Schema({
  hotLeadAlert:     { type: Boolean, default: true  },
  bookingCreated:   { type: Boolean, default: true  },
  paymentReceived:  { type: Boolean, default: true  },
  templateApproved: { type: Boolean, default: true  },
  campaignSent:     { type: Boolean, default: true  },
  dealWon:          { type: Boolean, default: true  },
  dealLost:         { type: Boolean, default: false },
}, { _id: false });

// =============================================================================
// MAIN SCHEMA
// =============================================================================

const tenantSchema = new Schema(
  {
    // ── Basic Info ────────────────────────────────────────────────────────────
    name: {
      type:      String,
      required:  [true, 'Tenant name is required'],
      trim:      true,
      maxlength: 100,
    },
    slug: {
      type:      String,
      required:  true,
      unique:    true,
      lowercase: true,
      trim:      true,
    },
    logo:        { type: String, default: null },
    website:     { type: String, default: null },
    description: { type: String, default: null, maxlength: 500 },
    businessType: {
      type:    String,
      enum:    ['agency', 'edtech', 'coaching', 'healthcare', 'ecommerce',
                'real_estate', 'fitness', 'finance', 'saas', 'other'],
      default: 'other',
    },
    industry: { type: String, default: null },

    /**
     * Workspace-wide display/accounting currency (e.g. campaign revenue,
     * payment amounts). Single currency per tenant -- the same "workspace
     * currency" model Stripe/HubSpot/Salesforce use, NOT per-transaction
     * FX conversion. Reuses PAYMENT_CURRENCY_VALUES (payments/payment.constants.js)
     * as the single source of truth so this can never drift out of sync
     * with what Payment.currency itself accepts.
     */
    currency: {
      type:    String,
      enum:    PAYMENT_CURRENCY_VALUES,
      default: 'USD',
    },

    // ── Owner (denormalised — see architecture notes in docs) ─────────────────
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    ownerName:   { type: String, default: null },
    ownerEmail:  { type: String, default: null, lowercase: true },
    ownerPhone:  { type: String, default: null },

    // ── Subscription ──────────────────────────────────────────────────────────
    // `plan` is now a denormalized display string (the assigned Plan's
    // `key`), kept for backward-compat with existing display code -- the
    // real source of truth is `planId`. No more fixed enum: plan keys are
    // dynamic now (Super Admin can add/remove them), so this just accepts
    // whatever key the resolved Plan document has.
    plan: {
      type:    String,
      default: SUBSCRIPTION_PLANS.FREE,
    },
    /** The Account this workspace's billing/subscription actually lives
     * on -- see plans/account.model.js. planId/planTrack/maxUsers/etc.
     * below are DENORMALIZED COPIES of that Account's real state, synced
     * whenever the account is created/changes (see plan.service.js's
     * syncTenantsFromAccount) -- NOT independently managed per-tenant
     * anymore. Kept nullable for backward-compat with tenants that
     * existed before this field did; backfillAccounts() fixes those up
     * on boot, same pattern as backfillTenantPlans did for planId itself. */
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    planId: { type: Schema.Types.ObjectId, ref: 'Plan', default: null },
    /** Denormalized from planId's track, purely so requireModule()
     * middleware can check it with zero extra DB query per request (same
     * "copy the number onto the tenant" pattern maxUsers/maxLeads/
     * maxCampaigns already used, extended to the new full/whatsapp_only
     * concept -- see plan.model.js's TRACK_MODULES). */
    planTrack: { type: String, enum: ['full', 'whatsapp_only'], default: 'full' },
    subscriptionStatus: {
      type:    String,
      enum:    Object.values(SUBSCRIPTION_STATUS),
      default: SUBSCRIPTION_STATUS.TRIAL,
    },
    subscriptionStartDate: { type: Date,   default: null },
    subscriptionEndDate:   { type: Date,   default: null },
    trialEndsAt:           { type: Date,   default: null },
    cashfreeCustomerId:    { type: String, default: null },
    mrr:                   { type: Number, default: 0, min: 0 },

    // ── Cashfree Subscription -- LEGACY/UNUSED on Tenant ───────────────────────
    // Real subscription state lives on Account now (see plans/account.model.js's
    // cashfreeSubscriptionId/cashfreeSubscriptionStatus) -- these fields are
    // never read or written anywhere else in this codebase; kept only for
    // backward-compat with any pre-migration documents that still have them set.
    cashfreeSubscriptionId: { type: String, default: null },
    cashfreeSubscriptionStatus: {
      type: String,
      enum: ['none', 'INITIALIZED', 'BANK_APPROVAL_PENDING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CUSTOMER_CANCELLED', 'CUSTOMER_PAUSED', 'EXPIRED', 'LINK_EXPIRED', 'CANCELLED', 'CARD_EXPIRED'],
      default: 'none',
    },
    /** The plan a tenant is CHECKING OUT for, before payment is confirmed
     * -- separate from planId (which only changes once payment actually
     * succeeds). Lets createSubscriptionCheckout know what to apply once
     * verifySubscriptionPayment / the webhook confirms it. */
    pendingPlanId:      { type: Schema.Types.ObjectId, ref: 'Plan', default: null },
    currentPeriodEnd:   { type: Date, default: null },

    // ── Workspace Access ──────────────────────────────────────────────────────
    isActive: { type: Boolean, default: true },
    workspaceStatus: {
      type:    String,
      enum:    Object.values(WORKSPACE_STATUS),
      default: WORKSPACE_STATUS.ACTIVE,
    },
    suspensionReason: { type: String, default: null },
    suspendedAt:      { type: Date,   default: null },
    suspendedBy:      { type: Schema.Types.ObjectId, ref: 'User', default: null },

    // ── Resource Limits ───────────────────────────────────────────────────────
    maxUsers:             { type: Number, default: PLAN_LIMITS.free.maxUsers,     min: 1 },
    maxLeads:             { type: Number, default: PLAN_LIMITS.free.maxLeads,     min: 1 },
    maxCampaigns:         { type: Number, default: PLAN_LIMITS.free.maxCampaigns, min: 1 },
    maxWorkspaces:        { type: Number, default: 1, min: 1 },
    currentUserCount:     { type: Number, default: 0, min: 0 },
    currentLeadCount:     { type: Number, default: 0, min: 0 },
    currentCampaignCount: { type: Number, default: 0, min: 0 },

    // ── Integration Flags ─────────────────────────────────────────────────────
    metaConnected:           { type: Boolean, default: false },
    whatsappConnected:       { type: Boolean, default: false },
    cashfreeConnected:       { type: Boolean, default: false },
    openAIConnected:         { type: Boolean, default: false },
    googleCalendarConnected: { type: Boolean, default: false },

    // ── Custom Settings (for Settings page)
    qualificationQuestions: { type: [String], default: [] },
    scoringRules:           { type: [{ factor: String, weight: Number, _id: false }], default: [] },
    consentRequired:        { type: Boolean, default: true },
    dataRetentionDays:      { type: Number, default: 365, min: 30 },
    optOutKeywords:         { type: [String], default: ["STOP", "UNSUBSCRIBE", "OPTOUT"] },

    // ── Embedded Settings ─────────────────────────────────────────────────────
    branding:                { type: brandingSchema,                default: () => ({}) },
    whatsAppSettings:        { type: whatsAppSettingsSchema,        default: () => ({}) },
    aiConfig:                { type: aiConfigSchema,                default: () => ({}) },
    securitySettings:        { type: securitySettingsSchema,        default: () => ({}) },
    notificationPreferences: { type: notificationPreferencesSchema, default: () => ({}) },

    // ── Soft Delete ───────────────────────────────────────────────────────────
    deletedAt: { type: Date,   default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    // ── Audit ─────────────────────────────────────────────────────────────────
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        // Strip all credential fields from every JSON response
        if (ret.whatsAppSettings) {
          delete ret.whatsAppSettings.accessToken;
          delete ret.whatsAppSettings.apiKey;
          delete ret.whatsAppSettings.webhookVerifyToken;
          delete ret.whatsAppSettings.phoneNumberId;
        }
        if (ret.aiConfig) {
          delete ret.aiConfig.aiApiKey;
        }
        delete ret.cashfreeCustomerId;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

// =============================================================================
// VIRTUALS
// =============================================================================

tenantSchema.virtual('isSubscriptionActive').get(function () {
  return [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.TRIAL]
    .includes(this.subscriptionStatus);
});

tenantSchema.virtual('trialDaysRemaining').get(function () {
  if (!this.trialEndsAt || this.subscriptionStatus !== SUBSCRIPTION_STATUS.TRIAL) {
    return 0;
  }
  const diff = this.trialEndsAt.getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86_400_000));
});

tenantSchema.virtual('isDeleted').get(function () {
  return !!this.deletedAt;
});

// =============================================================================
// PRE-HOOKS — Mongoose v8+ safe pattern
// =============================================================================
//
// ALL hooks use:   async function ()  — NO next parameter, NO next() call
//
// Why this works in Mongoose v8:
//   - Mongoose v8 automatically detects async functions
//   - It waits for the returned Promise to resolve/reject
//   - A thrown error = hook failed → save aborted
//   - No throw = hook passed → Mongoose moves to next hook
//
// Why the old pattern broke:
//   - Mongoose v8 does NOT pass next() to hooks in transaction/session context
//   - Calling next() when it wasn't passed → TypeError: next is not a function
//   - This happened at Tenant.create([data], { session }) in auth.service.js
//
// =============================================================================

/**
 * HOOK 1 — Auto-generate slug from name (runs before validation)
 *
 * Converts "InnovateX Demo" → "innovatex-demo"
 * Only generates if slug is not already set.
 * Slug collision (duplicate) is handled by the unique index — the service
 * layer catches the 11000 duplicate key error and returns a friendly message.
 */
tenantSchema.pre('validate', async function () {
  if (!this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')   // remove special characters
      .replace(/\s+/g, '-')            // spaces → hyphens
      .replace(/-+/g, '-')             // collapse consecutive hyphens
      .replace(/^-|-$/g, '');          // trim leading/trailing hyphens

    // Safety: if name produced an empty slug, use a timestamp fallback
    if (!this.slug) {
      this.slug = `workspace-${Date.now()}`;
    }
  }
});

/**
 * HOOK 2 — Resolve the tenant's Plan and sync denormalized limits/track
 *
 * Runs whenever a tenant is first created (isNew, no planId picked yet ->
 * falls back to the platform default plan), whenever planId is
 * explicitly changed (e.g. upgradePlan() below), OR whenever planId is
 * simply still null on ANY save -- this last case covers tenants that
 * existed before the Plan system did (see plan.service.js's
 * backfillTenantPlans, which relies on exactly this). Denormalizes
 * maxUsers/maxLeads/maxCampaigns/maxWorkspaces/planTrack/plan (display
 * key) onto the tenant document itself -- same reasoning as the pre-
 * existing maxUsers/maxLeads/maxCampaigns fields already had: every
 * capacity check (canCreateUser/canCreateLead/canCreateCampaign) and the
 * module-access gate (requireModule) need to read this synchronously,
 * with zero extra DB query per request, not re-resolve the Plan on every
 * single check.
 *
 * Only runs on isNew/planId-change to avoid overwriting custom enterprise
 * limits a super_admin may have hand-set on maxUsers etc. directly after
 * creation, same guarantee the original comment here promised.
 */
/**
 * HOOK 2 — Sync denormalized limits/track from this tenant's Account
 *
 * Billing lives on Account now (see plans/account.model.js), not
 * independently per-Tenant -- one subscription covers every workspace an
 * owner has. This hook just copies the account's current numbers onto
 * the tenant whenever the tenant is first created or its accountId
 * changes, so every capacity check (canCreateUser/canCreateLead/
 * canCreateCampaign) and the module-access gate (requireModule) can keep
 * reading tenant.maxUsers etc. synchronously, with zero extra DB query
 * per request -- unchanged from before, just sourced one level up now.
 *
 * When an Account's plan itself changes (checkout verify, webhook),
 * plan.service.js's syncTenantsFromAccount re-saves EVERY tenant under
 * that account so this hook re-fires for each of them too -- a single
 * subscription change propagates to every workspace it covers.
 */
tenantSchema.pre('save', async function () {
  const session = this.$session();
  if (this.isNew || this.isModified('accountId')) {
    if (this.accountId) {
      const account = await Account.findById(this.accountId).session(session);
      if (account) {
        this.plan          = account.plan;
        this.planId        = account.planId;
        this.planTrack     = account.planTrack;
        this.maxUsers      = account.maxUsers;
        this.maxLeads      = account.maxLeads;
        this.maxCampaigns  = account.maxCampaigns;
        this.maxWorkspaces = account.maxWorkspaces;
      }
    }
  }
});

/**
 * HOOK 3 — Set 14-day trial expiry on new tenant
 *
 * Every new workspace gets a 14-day free trial automatically.
 * After trialEndsAt, a cron job moves subscriptionStatus to 'inactive'.
 */
tenantSchema.pre('save', async function () {
  if (this.isNew && !this.trialEndsAt) {
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14);
    this.trialEndsAt = trialEnd;
  }
});

/**
 * HOOK 4 — Sync isActive boolean with workspaceStatus
 *
 * isActive is a denormalised boolean for fast indexed queries.
 * It always mirrors: workspaceStatus === 'active'
 */
tenantSchema.pre('save', async function () {
  if (this.isModified('workspaceStatus') || this.isNew) {
    this.isActive = this.workspaceStatus === WORKSPACE_STATUS.ACTIVE;
  }
});

// =============================================================================
// INSTANCE METHODS
// =============================================================================

/** canCreateUser — checks user capacity before inviting a new team member. */
tenantSchema.methods.canCreateUser = function () {
  return this.currentUserCount < this.maxUsers;
};

/** canCreateLead — checks lead capacity before creating a new lead. */
tenantSchema.methods.canCreateLead = function () {
  return this.currentLeadCount < this.maxLeads;
};

/** canCreateCampaign — checks campaign capacity. */
tenantSchema.methods.canCreateCampaign = function () {
  return this.currentCampaignCount < this.maxCampaigns;
};

/** isSuspended — true if workspace is suspended. */
tenantSchema.methods.isSuspended = function () {
  return this.workspaceStatus === WORKSPACE_STATUS.SUSPENDED;
};

/**
 * isAccessible — single gate for auth middleware.
 * Returns { allowed: boolean, reason: string | null }
 * reason is a machine-readable code the API translates into a user message.
 */
tenantSchema.methods.isAccessible = function () {
  if (this.deletedAt) {
    return { allowed: false, reason: 'WORKSPACE_DELETED' };
  }
  if (this.workspaceStatus === WORKSPACE_STATUS.SUSPENDED) {
    return { allowed: false, reason: 'WORKSPACE_SUSPENDED' };
  }
  if (this.workspaceStatus === WORKSPACE_STATUS.INACTIVE) {
    return { allowed: false, reason: 'WORKSPACE_INACTIVE' };
  }
  if ([SUBSCRIPTION_STATUS.INACTIVE, SUBSCRIPTION_STATUS.CANCELLED]
      .includes(this.subscriptionStatus)) {
    return { allowed: false, reason: 'SUBSCRIPTION_LAPSED' };
  }
  return { allowed: true, reason: null };
};

/**
 * softDelete — marks tenant as deleted without removing from DB.
 * Call .save() after this to persist.
 * Reports, payments, and audit logs retain their tenantId references.
 */
tenantSchema.methods.softDelete = function (deletedByUserId) {
  this.deletedAt          = new Date();
  this.deletedBy          = deletedByUserId;
  this.workspaceStatus    = WORKSPACE_STATUS.INACTIVE;
  this.subscriptionStatus = SUBSCRIPTION_STATUS.CANCELLED;
  return this;
};

/**
 * upgradePlan — MOVED to Account (see plans/account.model.js). Billing
 * lives at the account level now, not per-tenant -- one subscription
 * covers every workspace an owner has. Call account.upgradePlan()
 * followed by plan.service.js's syncTenantsFromAccount() instead, which
 * propagates the change to every sibling tenant, not just one.
 */

// =============================================================================
// STATIC METHODS
// =============================================================================

/**
 * findActiveTenants — all non-deleted, active workspaces.
 * Used by Super Admin panel tenant list.
 */
tenantSchema.statics.findActiveTenants = function () {
  return this.find({
    deletedAt:       null,
    workspaceStatus: WORKSPACE_STATUS.ACTIVE,
  }).sort({ createdAt: -1 });
};

/**
 * findBySlug — find a non-deleted tenant by URL slug.
 * Used for workspace resolution and subdomain routing.
 */
tenantSchema.statics.findBySlug = function (slug) {
  return this.findOne({
    slug:      slug.toLowerCase().trim(),
    deletedAt: null,
  });
};

// =============================================================================
// INDEXES
// =============================================================================

// slug already has unique: true in the schema definition.
// Do not create a duplicate index.

tenantSchema.index({ ownerEmail: 1 });
tenantSchema.index({ plan: 1, subscriptionStatus: 1 });
tenantSchema.index({ workspaceStatus: 1, isActive: 1 });
tenantSchema.index({ subscriptionStatus: 1, trialEndsAt: 1 });
tenantSchema.index({ deletedAt: 1 }, { sparse: true });

// =============================================================================
// EXPORT
// =============================================================================

export default mongoose.model('Tenant', tenantSchema);