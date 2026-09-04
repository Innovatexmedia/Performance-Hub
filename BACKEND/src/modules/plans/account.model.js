/**
 * =============================================================================
 * InnovateX Revenue OS — Account Model
 * =============================================================================
 *
 * FILE: src/modules/plans/account.model.js
 *
 * WHY THIS EXISTS
 * ────────────────
 * Billing moved from being per-Tenant (each workspace paying separately)
 * to per-Account (one subscription covers every workspace an owner has,
 * up to the plan's maxWorkspaces limit) -- a deliberate product decision,
 * not the original design. This is the new real source of truth for
 * plan/subscription state; Tenant keeps DENORMALIZED COPIES of the
 * numbers that matter for fast, synchronous per-request checks
 * (maxUsers/maxLeads/maxCampaigns/maxWorkspaces/planTrack/plan) -- same
 * "copy the number onto the thing that gets checked on every request"
 * pattern the rest of this codebase already uses, just one level up now.
 * See tenant.service-style syncTenantsFromAccount in plan.service.js for
 * how those copies stay in sync.
 *
 * One Account per owning user (ownerUserId) -- every Tenant that user
 * creates (their first, via registration, or additional ones via
 * createWorkspace) links to the SAME Account via Tenant.accountId.
 * =============================================================================
 */

import mongoose from 'mongoose';
import { SUBSCRIPTION_STATUS } from '../auth/constants/auth.constants.js';

const { Schema } = mongoose;

const accountSchema = new Schema({
  ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

  // ── Subscription (mirrors Tenant.js's old fields exactly -- moved here) ──
  plan:      { type: String, default: 'starter_full' }, // denormalized display key
  planId:    { type: Schema.Types.ObjectId, ref: 'Plan', default: null },
  planTrack: { type: String, enum: ['full', 'whatsapp_only'], default: 'full' },

  subscriptionStatus: {
    type: String,
    enum: Object.values(SUBSCRIPTION_STATUS),
    default: SUBSCRIPTION_STATUS.TRIAL,
  },
  subscriptionStartDate: { type: Date, default: null },
  trialEndsAt:           { type: Date, default: null },
  mrr:                    { type: Number, default: 0, min: 0 },

  // ── Cashfree subscription (real recurring mandate billing) ──────────────
  // subscription_id is OURS -- we generate it when calling Create
  // Subscription. cashfreeSubReferenceId is CASHFREE'S id for the same
  // subscription -- the v2 Subscriptions API (confirmed to be what this
  // account is actually provisioned on) requires THIS id, not our
  // subscriptionId, for Fetch/Cancel calls (path param subReferenceId).
  // Stored as a STRING, not Number -- Cashfree's subReferenceId can
  // exceed Number.MAX_SAFE_INTEGER, and Mongoose's Number type is a JS
  // double under the hood with the exact same precision ceiling, so a
  // Number field would silently round it (see cashfree.js's
  // parseCashfreeJson for the matching fix on the parsing side). It's
  // never used arithmetically, only as an opaque id, so String loses
  // nothing.
  //
  // cashfreeSubscriptionStatus values are Cashfree's own Subscription
  // Status Change lifecycle values, kept uppercase exactly as Cashfree
  // sends them so webhook handling never needs a translation table that
  // could drift out of sync.
  cashfreeSubscriptionId: { type: String, default: null },
  cashfreeSubReferenceId: { type: String, default: null },
  cashfreeSubscriptionStatus: {
    type: String,
    enum: [
      'none', 'INITIALIZED', 'BANK_APPROVAL_PENDING', 'ACTIVE', 'ON_HOLD',
      'COMPLETED', 'CUSTOMER_CANCELLED', 'CUSTOMER_PAUSED', 'EXPIRED',
      'LINK_EXPIRED', 'CANCELLED', 'CARD_EXPIRED',
    ],
    default: 'none',
  },
  pendingPlanId:    { type: Schema.Types.ObjectId, ref: 'Plan', default: null },
  currentPeriodEnd: { type: Date, default: null },

  // ── Resource limits (denormalized from planId, source of truth for
  // every Tenant under this account) ───────────────────────────────────────
  maxUsers:      { type: Number, default: 3, min: 1 },
  maxLeads:      { type: Number, default: 250, min: 1 },
  maxCampaigns:  { type: Number, default: 3, min: 0 },
  maxWorkspaces: { type: Number, default: 1, min: 1 },
}, { timestamps: true });

// =============================================================================
// PRE-HOOKS -- same Mongoose v8 safe pattern as Tenant.js (async, no
// next(), throw to signal errors). See Tenant.js's own comment block for
// the full rationale; not repeated here.
// =============================================================================

/**
 * HOOK 1 — Resolve the account's Plan and sync denormalized limits/track
 * Mirrors Tenant.js's old HOOK 2 exactly, just living here now since
 * Account is the real plan/subscription owner. Runs on creation (no
 * planId picked -> falls back to the platform default) or whenever
 * planId is explicitly changed (upgradePlan() below).
 */
accountSchema.pre('save', async function () {
  const session = this.$session();
  const planIdWasMissing = !this.planId;
  if (planIdWasMissing) {
    const { getDefaultPlan } = await import('./plan.service.js');
    const defaultPlan = await getDefaultPlan(session);
    if (defaultPlan) this.planId = defaultPlan._id;
  }
  if (this.isNew || this.isModified('planId') || planIdWasMissing) {
    if (this.planId) {
      const Plan = (await import('./plan.model.js')).default;
      const plan = await Plan.findById(this.planId).session(session);
      if (plan) {
        this.plan          = plan.key;
        this.planTrack     = plan.track;
        this.maxUsers      = plan.limits.maxUsers;
        this.maxLeads      = plan.limits.maxLeads;
        this.maxCampaigns  = plan.limits.maxCampaigns;
        this.maxWorkspaces = plan.limits.maxWorkspaces;
      }
    }
  }
});

/** HOOK 2 — 14-day trial on new accounts. Mirrors Tenant.js's old HOOK 3. */
accountSchema.pre('save', function () {
  if (this.isNew && !this.trialEndsAt) {
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14);
    this.trialEndsAt = trialEnd;
  }
});

// =============================================================================
// INSTANCE METHODS
// =============================================================================

/**
 * upgradePlan — changes this account's plan and denormalized limits.
 * Call .save() after this, THEN plan.service.js's syncTenantsFromAccount
 * to propagate the new numbers to every Tenant this account covers --
 * this method only updates the Account document itself.
 *
 * @param {string} planKeyOrId — a Plan's `key` (e.g. "mid_full") or its Mongo _id.
 */
accountSchema.methods.upgradePlan = async function (planKeyOrId) {
  const session = this.$session();
  const Plan = (await import('./plan.model.js')).default;
  const isObjectId = mongoose.isValidObjectId(planKeyOrId);
  const plan = isObjectId
    ? await Plan.findById(planKeyOrId).session(session)
    : await Plan.findOne({ key: planKeyOrId }).session(session);
  if (!plan) throw new Error(`Invalid plan: ${planKeyOrId}`);
  if (!plan.isActive) throw new Error(`Plan "${plan.name}" is no longer available -- choose a different plan`);

  this.planId                = plan._id;
  this.plan                  = plan.key;
  this.planTrack              = plan.track;
  this.maxUsers               = plan.limits.maxUsers;
  this.maxLeads               = plan.limits.maxLeads;
  this.maxCampaigns           = plan.limits.maxCampaigns;
  this.maxWorkspaces          = plan.limits.maxWorkspaces;
  this.subscriptionStatus    = SUBSCRIPTION_STATUS.ACTIVE;
  this.subscriptionStartDate = new Date();
  return this;
};

// Compiled AFTER every .pre() hook and .methods.* assignment above --
// mongoose.model() compiles the model's prototype/hooks from the
// schema's state AT THAT EXACT MOMENT. Calling it any earlier (as this
// file originally did) silently produces a model missing whatever was
// registered on the schema afterward -- exactly what caused
// "account.upgradePlan is not a function" in production despite the
// method clearly being defined a few lines above it in this same file.
const Account = mongoose.model('Account', accountSchema);

export default Account;