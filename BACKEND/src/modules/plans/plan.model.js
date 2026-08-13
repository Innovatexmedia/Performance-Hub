/**
 * =============================================================================
 * InnovateX Revenue OS — Plan Model
 * =============================================================================
 *
 * FILE: src/modules/plans/plan.model.js
 *
 * PURPOSE
 * ───────
 * Real, database-backed billing plans -- replaces the old hardcoded
 * PLAN_LIMITS object in Tenant.js. Super Admin can create/edit/deactivate
 * plans without a code deploy; Tenant.planId references whichever plan a
 * workspace is actually on.
 *
 * TWO PRODUCT TRACKS (per-request decision, 2026):
 *   full          — every module.
 *   whatsapp_only — Leads + WhatsApp Panel + Pipeline only (see
 *                   TRACK_MODULES below). Dashboard/Settings/Team/
 *                   Integrations/Profile are NEVER gated by track --
 *                   they're account management, not a "feature".
 * Which modules a track unlocks is a fixed platform rule (TRACK_MODULES),
 * not a per-plan-instance setting -- Super Admin picks a plan's `track`,
 * not an arbitrary module list. This keeps "what does whatsapp_only
 * include" a single, auditable answer instead of N slightly-different
 * configurations drifting apart tenant by tenant.
 *
 * TIERS: starter / mid / premium (per-request naming) -- purely a display
 * grouping + a natural sort order; limits/price are what actually differ,
 * tier is just a label for humans browsing the plan list.
 *
 * INTERIM BILLING NOTE: `price` is display-only -- there is no real
 * payment processor wired up yet (see Settings > Billing's own
 * placeholder note). This is intentionally the interim step before a
 * later token-based system, per the person's own stated roadmap --
 * built so that swapping the enforcement mechanism later (limits ->
 * tokens) doesn't require touching the Plan shape's core identity
 * (key/track/tier), only the `limits` sub-document.
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

export const PLAN_TRACK = Object.freeze({
  FULL: 'full',
  WHATSAPP_ONLY: 'whatsapp_only',
});
export const PLAN_TRACK_VALUES = Object.freeze(Object.values(PLAN_TRACK));

export const PLAN_TIER = Object.freeze({
  STARTER: 'starter',
  MID: 'mid',
  PREMIUM: 'premium',
});
export const PLAN_TIER_VALUES = Object.freeze(Object.values(PLAN_TIER));

/**
 * TRACK_MODULES — the fixed rule for what `whatsapp_only` includes beyond
 * the always-available account-management pages. `full` is `null`,
 * meaning "no restriction, everything". Module keys here match exactly
 * the backend mount paths in app.js (e.g. 'campaigns' -> /api/campaigns)
 * so requireModule() (shared/middlewares/module.middleware.js) can key
 * off the same strings without a separate mapping table to keep in sync.
 */
export const TRACK_MODULES = Object.freeze({
  [PLAN_TRACK.FULL]: null,
  [PLAN_TRACK.WHATSAPP_ONLY]: Object.freeze(['leads', 'whatsapp', 'pipeline']),
});

const planLimitsSchema = new Schema({
  maxUsers:      { type: Number, required: true, min: 1 },
  maxLeads:      { type: Number, required: true, min: 1 },
  maxCampaigns:  { type: Number, required: true, min: 0 },
  maxWorkspaces: { type: Number, required: true, min: 1 },
}, { _id: false });

const planSchema = new Schema({
  key:  { type: String, required: true, unique: true, trim: true, lowercase: true },
  name: { type: String, required: true, trim: true },

  track: { type: String, enum: PLAN_TRACK_VALUES, required: true },
  tier:  { type: String, enum: PLAN_TIER_VALUES,  required: true },

  /** Monthly price in `currency`, display-only until a real payment
   * processor exists. `null` means "contact sales" (no listed price). */
  price:    { type: Number, default: 0, min: 0 },
  currency: { type: String, default: 'USD' },

  limits: { type: planLimitsSchema, required: true },

  /** Disabling a plan stops it being offered to NEW tenants/upgrades; it
   * does NOT retroactively change any tenant already on it -- same "no
   * surprise downgrade" principle as everywhere else limits are touched
   * in this codebase (see Tenant.js's own comments on this). */
  isActive: { type: Boolean, default: true },

  /** The plan new tenants/workspaces get when none is explicitly chosen.
   * Exactly one plan should have this true at a time -- enforced in
   * plan.service.js, not at the schema level (Mongoose has no easy
   * "at most one document with this flag" constraint). */
  isDefault: { type: Boolean, default: false },

  sortOrder: { type: Number, default: 0 },
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform(doc, ret) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
});

planSchema.index({ track: 1, tier: 1 });

const Plan = mongoose.model('Plan', planSchema);
export default Plan;
