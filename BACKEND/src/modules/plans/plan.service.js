import Plan, { PLAN_TRACK, PLAN_TIER } from './plan.model.js';
import { AppError } from '../../shared/helpers/lead.helpers.js';

/**
 * DEFAULT_PLANS — seeded once, on first boot only (see ensureSeeded).
 * 3 tiers x 2 tracks = 6 starting plans, editable from Super Admin from
 * then on. Numbers here are a reasonable starting point, not a locked-in
 * decision -- the whole point of this module existing is that Super
 * Admin can change every one of these without a code deploy.
 */
const DEFAULT_PLANS = [
  { key: 'starter_full', name: 'Starter', track: PLAN_TRACK.FULL, tier: PLAN_TIER.STARTER,
    price: 29, isDefault: true, sortOrder: 1,
    limits: { maxUsers: 5, maxLeads: 1000, maxCampaigns: 10, maxWorkspaces: 1 } },
  { key: 'mid_full', name: 'Growth', track: PLAN_TRACK.FULL, tier: PLAN_TIER.MID,
    price: 79, sortOrder: 2,
    limits: { maxUsers: 15, maxLeads: 10000, maxCampaigns: 50, maxWorkspaces: 3 } },
  { key: 'premium_full', name: 'Scale', track: PLAN_TRACK.FULL, tier: PLAN_TIER.PREMIUM,
    price: 199, sortOrder: 3,
    limits: { maxUsers: 50, maxLeads: 50000, maxCampaigns: 200, maxWorkspaces: 10 } },

  { key: 'starter_whatsapp', name: 'Starter — WhatsApp Panel', track: PLAN_TRACK.WHATSAPP_ONLY, tier: PLAN_TIER.STARTER,
    price: 15, sortOrder: 4,
    limits: { maxUsers: 3, maxLeads: 500, maxCampaigns: 5, maxWorkspaces: 1 } },
  { key: 'mid_whatsapp', name: 'Growth — WhatsApp Panel', track: PLAN_TRACK.WHATSAPP_ONLY, tier: PLAN_TIER.MID,
    price: 45, sortOrder: 5,
    limits: { maxUsers: 10, maxLeads: 5000, maxCampaigns: 25, maxWorkspaces: 2 } },
  { key: 'premium_whatsapp', name: 'Scale — WhatsApp Panel', track: PLAN_TRACK.WHATSAPP_ONLY, tier: PLAN_TIER.PREMIUM,
    price: 99, sortOrder: 6,
    limits: { maxUsers: 25, maxLeads: 25000, maxCampaigns: 100, maxWorkspaces: 5 } },
];

/** Idempotent -- only inserts plans whose `key` doesn't already exist.
 * Safe to call on every server boot (see app.js). */
export const ensureSeeded = async () => {
  const existingKeys = new Set((await Plan.find({}).select('key').lean()).map((p) => p.key));
  const missing = DEFAULT_PLANS.filter((p) => !existingKeys.has(p.key));
  if (missing.length) await Plan.insertMany(missing);
};

/**
 * backfillTenantPlans — one-time-per-tenant migration for workspaces that
 * existed BEFORE the Plan system did. Tenant.js's pre-save hook only
 * resolves planId when a tenant is brand new (isNew) or planId itself
 * changes -- neither is ever true for a tenant that was already sitting
 * in the DB and simply gets read/updated on some OTHER field. Without
 * this, every pre-existing tenant's planId stays null forever, and
 * anything reading plan_details (e.g. Settings > Billing) breaks.
 *
 * Idempotent and safe to run on every boot (same pattern as ensureSeeded)
 * -- only touches tenants where planId is still null; does nothing once
 * a tenant has one. Loads + .save()s each one individually (not a bulk
 * $set) specifically so Tenant.js's pre-save hook actually runs and
 * denormalizes maxUsers/maxLeads/maxCampaigns/maxWorkspaces/planTrack
 * correctly, exactly like it would for a newly-created tenant.
 */
export const backfillTenantPlans = async () => {
  const Tenant = (await import('../auth/models/Tenant.js')).default;
  const orphaned = await Tenant.find({ planId: null }).select('_id');
  if (!orphaned.length) return;

  for (const { _id } of orphaned) {
    const tenant = await Tenant.findById(_id);
    if (!tenant || tenant.planId) continue; // re-check -- another process may have already fixed it
    await tenant.save(); // isNew is false, but the hook's planId-still-null branch still fires
  }
};

/** The plan new tenants/workspaces get when none is explicitly assigned.
 * Accepts an optional Mongoose session so callers running inside a
 * transaction (tenant creation always is -- see Tenant.js's pre-save
 * hook) get a consistent read instead of querying outside the transaction. */
export const getDefaultPlan = async (session = null) => {
  const plan = await Plan.findOne({ isDefault: true, isActive: true }).session(session);
  if (plan) return plan;
  // Fallback if isDefault was somehow never set / got unset -- cheapest
  // active plan on the full track, so a new tenant never silently ends
  // up on a plan that hides modules they didn't ask to be limited to.
  return Plan.findOne({ track: PLAN_TRACK.FULL, isActive: true }).sort({ price: 1 }).session(session);
};

export const planService = {
  async list({ includeInactive = false } = {}) {
    const filter = includeInactive ? {} : { isActive: true };
    return Plan.find(filter).sort({ sortOrder: 1, price: 1 });
  },

  async getById(id) {
    const plan = await Plan.findById(id);
    if (!plan) throw AppError.notFound('Plan not found');
    return plan;
  },

  async getByKey(key) {
    const plan = await Plan.findOne({ key });
    if (!plan) throw AppError.notFound(`Plan "${key}" not found`);
    return plan;
  },

  async create(data) {
    const existing = await Plan.findOne({ key: data.key });
    if (existing) throw AppError.conflict(`Plan key "${data.key}" already exists`);

    if (data.isDefault) await Plan.updateMany({ isDefault: true }, { isDefault: false });

    return Plan.create(data);
  },

  async update(id, patch) {
    const plan = await Plan.findById(id);
    if (!plan) throw AppError.notFound('Plan not found');

    if (patch.isDefault === true) await Plan.updateMany({ _id: { $ne: id }, isDefault: true }, { isDefault: false });

    const editable = ['name', 'price', 'currency', 'limits', 'isActive', 'isDefault', 'sortOrder'];
    // track/tier/key are deliberately NOT editable after creation -- a plan
    // switching track (full <-> whatsapp_only) out from under tenants
    // already assigned to it would silently change what modules they can
    // access with zero warning. Create a new plan and migrate instead.
    for (const field of editable) {
      if (patch[field] !== undefined) plan[field] = patch[field];
    }
    await plan.save();
    return plan;
  },

  async remove(id) {
    const plan = await Plan.findById(id);
    if (!plan) throw AppError.notFound('Plan not found');

    const Tenant = (await import('../auth/models/Tenant.js')).default;
    const inUse = await Tenant.countDocuments({ planId: id });
    if (inUse > 0) {
      throw AppError.badRequest(`${inUse} workspace(s) are on this plan -- deactivate it instead of deleting, or reassign them first.`);
    }
    await plan.deleteOne();
  },
};