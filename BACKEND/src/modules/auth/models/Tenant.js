/**
 * =============================================================================
 * InnovateX Revenue OS — Tenant Model
 * =============================================================================
 *
 * FILE: src/modules/auth/models/Tenant.js
 *
 * FIX APPLIED — "next is not a function" in Mongoose v8
 * ──────────────────────────────────────────────────────
 * All four pre-hooks have been converted to async functions WITHOUT next().
 *
 * Root cause:
 * Mongoose v8 (via Kareem hook runner) does NOT pass `next` as a parameter
 * to hooks when they are called inside a transaction session context, OR
 * when the hook runner detects async behaviour. Calling next() in that
 * context throws: "TypeError: next is not a function".
 *
 * The universal safe pattern for ALL Mongoose v8 hooks:
 *
 *   ✅ CORRECT — async, no next(), throw to signal errors
 *   tenantSchema.pre('validate', async function () { ... })
 *   tenantSchema.pre('save',     async function () { ... })
 *
 *   ❌ BROKEN in v8 transaction context
 *   tenantSchema.pre('validate', function (next) { ...; next(); })
 *   tenantSchema.pre('save',     function (next) { ...; next(); })
 *
 * None of the four hooks here do async work (no DB calls, no awaits).
 * But declaring them async and throwing on error is still the safest
 * pattern because Mongoose v8 handles both cases correctly:
 *   - Thrown error → Mongoose catches it, rejects the save promise
 *   - No error → Mongoose continues to next hook automatically
 *
 * =============================================================================
 */

import mongoose from 'mongoose';
import {
  SUBSCRIPTION_STATUS,
} from '../constants/auth.constants.js';

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
  free:       { maxUsers: 3,   maxLeads: 250,    maxCampaigns: 3   },
  starter:    { maxUsers: 5,   maxLeads: 1000,   maxCampaigns: 10  },
  growth:     { maxUsers: 15,  maxLeads: 10000,  maxCampaigns: 50  },
  scale:      { maxUsers: 50,  maxLeads: 50000,  maxCampaigns: 200 },
  enterprise: { maxUsers: 999, maxLeads: 999999, maxCampaigns: 999 },
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

    // ── Owner (denormalised — see architecture notes in docs) ─────────────────
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    ownerName:   { type: String, default: null },
    ownerEmail:  { type: String, default: null, lowercase: true },
    ownerPhone:  { type: String, default: null },

    // ── Subscription ──────────────────────────────────────────────────────────
    plan: {
      type:    String,
      enum:    Object.values(SUBSCRIPTION_PLANS),
      default: SUBSCRIPTION_PLANS.FREE,
    },
    subscriptionStatus: {
      type:    String,
      enum:    Object.values(SUBSCRIPTION_STATUS),
      default: SUBSCRIPTION_STATUS.TRIAL,
    },
    subscriptionStartDate: { type: Date,   default: null },
    subscriptionEndDate:   { type: Date,   default: null },
    trialEndsAt:           { type: Date,   default: null },
    razorpayCustomerId:    { type: String, default: null },
    mrr:                   { type: Number, default: 0, min: 0 },

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
    currentUserCount:     { type: Number, default: 0, min: 0 },
    currentLeadCount:     { type: Number, default: 0, min: 0 },
    currentCampaignCount: { type: Number, default: 0, min: 0 },

    // ── Integration Flags ─────────────────────────────────────────────────────
    metaConnected:           { type: Boolean, default: false },
    whatsappConnected:       { type: Boolean, default: false },
    razorpayConnected:       { type: Boolean, default: false },
    openAIConnected:         { type: Boolean, default: false },
    googleCalendarConnected: { type: Boolean, default: false },

    // ── Custom Settings (for Settings page)
    qualificationQuestions: { type: [String], default: [] },
    scoringRules:           { type: [{ factor: String, weight: Number, _id: false }], default: [] },
    consentRequired:        { type: Boolean, default: true },
    dataRetentionDays:      { type: Number, default: 365, min: 30 },
    optOutKeywords:         { type: [String], default: ["STOP", "UNSUBSCRIBE", "OPTOUT"] },

    // Per-stage label/color overrides, keyed by the fixed DEAL_STAGE board
    // key (e.g. "new_lead", "qualified", ...). Stage KEYS/order/count are
    // NOT tenant-configurable -- see types/deal.ts's note on why (deal
    // validation, lead-status mapping, Won/Lost side effects, and tracking
    // events all key off the fixed set). Only display label + color can be
    // customized. Missing keys fall back to PIPELINE_STAGES' defaults.
    pipelineStageOverrides: { type: Map, of: { label: String, color: String }, default: () => ({}) },

    // Which of the fixed LEAD_FIELDS are required when creating a lead.
    // Defaults to name+phone (validateCreateLead's original hardcoded
    // rule) so existing behavior is unchanged until a tenant customizes it.
    requiredLeadFields: { type: [String], default: ['name', 'phone'] },

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
        delete ret.razorpayCustomerId;
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
 * HOOK 2 — Set plan limits on new tenant creation
 *
 * Only runs on isNew to avoid overwriting custom enterprise limits that
 * a super_admin may have set manually after creation.
 * Plan upgrades go through the upgradePlan() method instead.
 */
tenantSchema.pre('save', async function () {
  if (this.isNew) {
    const limits = PLAN_LIMITS[this.plan];
    if (limits) {
      this.maxUsers     = limits.maxUsers;
      this.maxLeads     = limits.maxLeads;
      this.maxCampaigns = limits.maxCampaigns;
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
 * upgradePlan — changes plan and updates resource limits.
 * Call .save() after this to persist.
 * Usage counts are preserved — upgrading doesn't reset currentUserCount etc.
 */
tenantSchema.methods.upgradePlan = function (newPlan) {
  const limits = PLAN_LIMITS[newPlan];
  if (!limits) throw new Error(`Invalid plan: ${newPlan}`);
  this.plan                  = newPlan;
  this.maxUsers              = limits.maxUsers;
  this.maxLeads              = limits.maxLeads;
  this.maxCampaigns          = limits.maxCampaigns;
  this.subscriptionStatus    = SUBSCRIPTION_STATUS.ACTIVE;
  this.subscriptionStartDate = new Date();
  return this;
};

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