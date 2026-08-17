import Plan, { PLAN_TRACK, PLAN_TIER } from './plan.model.js';
import { AppError } from '../../shared/helpers/lead.helpers.js';

/**
 * DEFAULT_PLANS — seeded once, on first boot only (see ensureSeeded).
 * 3 tiers x 2 tracks = 6 starting plans, editable from Super Admin from
 * then on. Numbers here are a reasonable starting point, not a locked-in
 * decision -- the whole point of this module existing is that Super
 * Admin can change every one of these without a code deploy.
 *
 * Priced in INR (see currency: 'INR' -- matches Plan.model.js's default
 * and what Razorpay actually charges; the whole product switched from
 * USD display to INR pricing so there's no display-vs-charge mismatch).
 */
const DEFAULT_PLANS = [
  { key: 'starter_full', name: 'Starter', track: PLAN_TRACK.FULL, tier: PLAN_TIER.STARTER,
    price: 999, currency: 'INR', isDefault: true, sortOrder: 1,
    limits: { maxUsers: 5, maxLeads: 1000, maxCampaigns: 10, maxWorkspaces: 1 } },
  { key: 'mid_full', name: 'Growth', track: PLAN_TRACK.FULL, tier: PLAN_TIER.MID,
    price: 2999, currency: 'INR', sortOrder: 2,
    limits: { maxUsers: 15, maxLeads: 10000, maxCampaigns: 50, maxWorkspaces: 3 } },
  { key: 'premium_full', name: 'Scale', track: PLAN_TRACK.FULL, tier: PLAN_TIER.PREMIUM,
    price: 7999, currency: 'INR', sortOrder: 3,
    limits: { maxUsers: 50, maxLeads: 50000, maxCampaigns: 200, maxWorkspaces: 10 } },

  { key: 'starter_whatsapp', name: 'Starter — WhatsApp Panel', track: PLAN_TRACK.WHATSAPP_ONLY, tier: PLAN_TIER.STARTER,
    price: 499, currency: 'INR', sortOrder: 4,
    limits: { maxUsers: 3, maxLeads: 500, maxCampaigns: 5, maxWorkspaces: 1 } },
  { key: 'mid_whatsapp', name: 'Growth — WhatsApp Panel', track: PLAN_TRACK.WHATSAPP_ONLY, tier: PLAN_TIER.MID,
    price: 1499, currency: 'INR', sortOrder: 5,
    limits: { maxUsers: 10, maxLeads: 5000, maxCampaigns: 25, maxWorkspaces: 2 } },
  { key: 'premium_whatsapp', name: 'Scale — WhatsApp Panel', track: PLAN_TRACK.WHATSAPP_ONLY, tier: PLAN_TIER.PREMIUM,
    price: 3999, currency: 'INR', sortOrder: 6,
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
 * migratePlansToInr — one-time fix for any of the 6 default plans that
 * were already seeded into a DB BEFORE this switch from USD display to
 * INR pricing (i.e. anyone who ran this app prior to this change).
 * ensureSeeded alone won't touch them -- it only inserts MISSING keys,
 * it never updates existing documents, so a plan seeded with the old
 * `price: 29, currency: 'USD'` would otherwise stay stuck like that
 * forever. Matched by `key` (stable identity) against DEFAULT_PLANS'
 * current INR numbers; only touches plans still on 'USD' so it never
 * clobbers a price a Super Admin has since deliberately edited via the
 * UI -- editing through Super Admin always sets currency along with it
 * going forward (see plan.validator.js), so 'USD' remaining is a
 * reliable signal this specific plan was never touched post-migration.
 */
export const migratePlansToInr = async () => {
  for (const seed of DEFAULT_PLANS) {
    await Plan.updateOne(
      { key: seed.key, currency: 'USD' },
      // razorpayPlanId is cleared too, defensively -- Razorpay Plans are
      // immutable, so if one somehow got created under the old (broken)
      // USD setup, it can't be reused; clearing it makes
      // ensureRazorpayPlan create a fresh, correctly-priced one instead
      // of silently reusing a wrong one.
      { $set: { price: seed.price, currency: 'INR', razorpayPlanId: null } },
    );
  }
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

/**
 * syncTenantsFromAccount — propagates an Account's current plan/limits
 * onto EVERY Tenant it covers. This is the piece that actually makes
 * account-level billing real: without it, upgrading/downgrading/locking
 * an Account would only be reflected on whichever single tenant happened
 * to trigger the change, not the sibling workspaces sharing the same
 * subscription. A direct bulk update (not looping tenant.save()) --
 * literal field copies, no extra per-document hook logic needed since
 * Account already resolved everything against the real Plan document.
 */
export const syncTenantsFromAccount = async (accountId, session = null) => {
  const Account = (await import('./account.model.js')).default;
  const Tenant = (await import('../auth/models/Tenant.js')).default;
  const account = await Account.findById(accountId).session(session);
  if (!account) return;

  await Tenant.updateMany(
    { accountId: account._id },
    { $set: {
      plan: account.plan,
      planId: account.planId,
      planTrack: account.planTrack,
      maxUsers: account.maxUsers,
      maxLeads: account.maxLeads,
      maxCampaigns: account.maxCampaigns,
      maxWorkspaces: account.maxWorkspaces,
    } },
    { session },
  );
};

/**
 * getOrCreateAccountForUser — the account-lookup every tenant-creation
 * path needs. If this user already owns an Account (they have at least
 * one existing tenant with accountId set), reuse it -- this is what
 * makes createWorkspace's additional companies share the SAME
 * subscription instead of each getting their own. Only creates a new
 * Account when this user genuinely has none yet (first-ever registration).
 */
export const getOrCreateAccountForUser = async (userId, session = null) => {
  const Account = (await import('./account.model.js')).default;
  const existing = await Account.findOne({ ownerUserId: userId }).session(session);
  if (existing) return existing;

  const created = new Account({ ownerUserId: userId });
  await created.save({ session });
  return created;
};

/**
 * backfillAccounts — one-time-per-tenant migration for workspaces that
 * existed BEFORE account-level billing did (i.e. every tenant created
 * prior to this change, which each independently had its own planId).
 * Groups orphaned tenants (accountId: null) by ownerUserId -- the same
 * key createWorkspace already uses to mean "the same person" -- and
 * links every tenant in a group to one shared Account per owner, seeded
 * from whichever of their tenants was created first (arbitrary but
 * deterministic; this only matters for pre-existing dev/test data, not
 * new signups, which always create their Account correctly from the
 * start). Idempotent and safe on every boot -- only touches tenants
 * where accountId is still null.
 */
export const backfillAccounts = async () => {
  const Account = (await import('./account.model.js')).default;
  const Tenant = (await import('../auth/models/Tenant.js')).default;

  const orphaned = await Tenant.find({ accountId: null }).sort({ createdAt: 1 });
  if (!orphaned.length) return;

  const byOwner = new Map();
  for (const tenant of orphaned) {
    const key = String(tenant.ownerUserId || tenant._id); // fall back to self if somehow ownerless
    if (!byOwner.has(key)) byOwner.set(key, []);
    byOwner.get(key).push(tenant);
  }

  for (const [ownerKey, tenants] of byOwner) {
    let account = tenants[0].ownerUserId
      ? await Account.findOne({ ownerUserId: tenants[0].ownerUserId })
      : null;

    if (!account) {
      // Seed the new Account from the oldest tenant in the group's
      // current (pre-migration) plan state, so an owner who was already
      // on a real paid plan doesn't get silently downgraded by this backfill.
      account = new Account({
        ownerUserId: tenants[0].ownerUserId || undefined,
        planId: tenants[0].planId || null,
      });
      await account.save();
    }

    for (const tenant of tenants) {
      tenant.accountId = account._id;
      await tenant.save(); // triggers Tenant's HOOK 2 -> syncs from this account
    }
  }
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

    // Razorpay Plans are IMMUTABLE once created -- editing price/currency
    // here only changes what WE store; the already-created Razorpay Plan
    // object still has the old price baked in forever. Without this, a
    // Super Admin changing ₹999 -> ₹1 would silently keep charging ₹999,
    // since createSubscriptionCheckout reuses razorpayPlanId if it's
    // already set (see subscription.service.js's ensureRazorpayPlan).
    // Clearing it here forces a fresh, correctly-priced Razorpay Plan to
    // be created on the NEXT checkout -- existing subscribers already
    // paying under the old Razorpay Plan are unaffected (correct: a
    // price change shouldn't silently re-bill someone already
    // subscribed), only future checkouts pick up the new price.
    //
    // Deliberately UNCONDITIONAL on price/currency being PRESENT in the
    // patch, not on whether the value actually differs from what's
    // stored -- the Super Admin edit form always submits the full
    // price/currency fields on every save, whether the number visibly
    // changed on screen or not, and there's no reliable way from here to
    // tell "admin retyped the same number" apart from "value never
    // changed". A stray extra Razorpay Plan created on a genuinely
    // no-op save is a harmless, invisible cost; a stale cached ID that
    // silently keeps charging the OLD price is not.
    if (patch.price !== undefined || patch.currency !== undefined) {
      plan.razorpayPlanId = null;
    }

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