/**
 * =============================================================================
 * InnovateX Revenue OS — Super Admin Service
 * =============================================================================
 *
 * FILE: src/modules/superAdmin/superAdmin.service.js
 *
 * SOURCE: MASTER_SPEC.md B19, FRONTEND_SPEC.md §20. Exactly 5 tabs' worth
 * of real functionality -- nothing beyond what spec calls for (no delete
 * tenant, no platform settings tab, neither exists in spec).
 *
 * Every function here operates WITHOUT a tenantId filter deliberately --
 * this is the one real, legitimate place in the codebase that queries
 * across every tenant. All routes calling into this service are gated
 * `requireExactRole('super_admin')` (see superAdmin.routes.js), and
 * resolveTenant already skips tenant loading entirely for this role
 * (see tenant.middleware.js) -- there is no tenant context to scope by
 * here, by design.
 * =============================================================================
 */

import mongoose from 'mongoose';
import Tenant from '../auth/models/Tenant.js';
import User from '../auth/models/User.js';
import Membership, { MEMBERSHIP_STATUS } from '../auth/models/Membership.js';
import LoginAudit from '../auth/models/LoginAudit.js';
import { Integration } from '../integrations/integration.model.js';
import { GenericTemplate } from '../templates/template.model.js';
import PlanModel from '../plans/plan.model.js';
import AccountModel from '../plans/account.model.js';
import { syncTenantsFromAccount } from '../plans/plan.service.js';
import * as userRepo from '../auth/repositories/user.repository.js';
import { ROLES } from '../auth/constants/roles.js';
import { USER_STATUS, SUBSCRIPTION_STATUS } from '../auth/constants/auth.constants.js';
import { AppError, paginationMeta, normalizePaging } from '../../shared/helpers/lead.helpers.js';

export const getPlatformDashboard = async () => {
  const [totalTenants, activeTenants, totalUsers, mrrAgg] = await Promise.all([
    Tenant.countDocuments({ deletedAt: null }),
    Tenant.countDocuments({ deletedAt: null, subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE }),
    User.countDocuments({ status: { $ne: USER_STATUS.DELETED } }),
    // MRR moved to Account (see plans/account.model.js) -- aggregating
    // Tenant.mrr here would always return ~0 now, since nothing writes
    // to that field anymore. cashfreeSubscriptionStatus is Account's
    // real "is this actually being paid for" signal, not the
    // trial/active/inactive subscriptionStatus (a brand-new trial
    // account is 'active' in that sense but pays nothing).
    AccountModel.aggregate([
      { $match: { cashfreeSubscriptionStatus: 'ACTIVE' } },
      { $group: { _id: null, total: { $sum: '$mrr' } } },
    ]),
  ]);

  const byPlan = await Tenant.aggregate([
    { $match: { deletedAt: null } },
    { $group: { _id: '$plan', count: { $sum: 1 } } },
  ]);

  const byStatus = await Tenant.aggregate([
    { $match: { deletedAt: null } },
    { $group: { _id: '$subscriptionStatus', count: { $sum: 1 } } },
  ]);

  return {
    totalTenants,
    activeTenants,
    totalUsers,
    mrr: mrrAgg[0]?.total || 0,
    tenantsByPlan: Object.fromEntries(byPlan.map((p) => [p._id, p.count])),
    tenantsByStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
  };
};

export const listTenants = async (query, options) => {
  const filter = { deletedAt: null };
  if (query.search) {
    filter.$or = [
      { name: { $regex: query.search, $options: 'i' } },
      { slug: { $regex: query.search, $options: 'i' } },
      { ownerEmail: { $regex: query.search, $options: 'i' } },
    ];
  }
  if (query.plan) filter.plan = query.plan;
  if (query.status) filter.subscriptionStatus = query.status;

  const { page, limit, skip } = normalizePaging(options || {});
  const [tenantDocs, total] = await Promise.all([
    Tenant.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Tenant.countDocuments(filter),
  ]);

  // MRR moved to Account (see plans/account.model.js) -- Tenant.mrr is a
  // stale leftover field nothing writes to anymore. One query for every
  // distinct account these tenants reference, instead of N+1 lookups.
  const accountIds = [...new Set(tenantDocs.filter((t) => t.accountId).map((t) => String(t.accountId)))];
  const accounts = accountIds.length ? await AccountModel.find({ _id: { $in: accountIds } }).select('mrr') : [];
  const mrrByAccountId = new Map(accounts.map((a) => [String(a._id), a.mrr]));

  const tenants = tenantDocs.map((t) => {
    const json = t.toJSON();
    if (t.accountId) json.mrr = mrrByAccountId.get(String(t.accountId)) ?? 0;
    return json;
  });

  return { tenants, pagination: paginationMeta({ page, limit, total }) };
};

export const getTenantDetail = async (tenantId) => {
  const tenant = await Tenant.findOne({ _id: tenantId, deletedAt: null });
  if (!tenant) throw AppError.notFound('Tenant not found');

  const [userCount, memberships, account] = await Promise.all([
    User.countDocuments({ tenantId, status: { $ne: USER_STATUS.DELETED } }),
    Membership.find({ tenantId, status: MEMBERSHIP_STATUS.ACTIVE }).populate('userId', 'firstName lastName email role'),
    tenant.accountId ? AccountModel.findById(tenant.accountId).select('mrr') : null,
  ]);

  const tenantJson = tenant.toJSON();
  if (account) tenantJson.mrr = account.mrr;

  return {
    tenant: tenantJson,
    userCount,
    members: memberships.map((m) => ({
      id: m.userId?._id,
      firstName: m.userId?.firstName,
      lastName: m.userId?.lastName,
      email: m.userId?.email,
      role: m.role,
      joinedAt: m.joinedAt,
    })),
  };
};

/**
 * createTenant — real Tenant + owner User + Membership, atomically.
 * Mirrors auth.service.js's _registerTenantOwner exactly (same real
 * transaction pattern), adapted for this context: no login tokens are
 * issued (the super admin is creating this on someone else's behalf,
 * not logging in as them), and a real password is required up front
 * rather than left to an invitation flow, since there's no invitation
 * system wired to this specific screen.
 */
export const createTenant = async (data, actorUserId) => {
  const { workspaceName, ownerFirstName, ownerLastName, ownerEmail, ownerPassword, planId, plan } = data;

  const existing = await userRepo.existsByEmail(ownerEmail);
  if (existing) throw AppError.conflict(`Email ${ownerEmail} is already registered`);

  // Accept either a real planId, or (backward-compat / convenience) a
  // plan `key` string like the old hardcoded 'free'/'starter'/etc. --
  // resolved to a real Plan document before creation, since the tenant's
  // own pre-save hook only reads `planId`, not a raw `plan` string, now
  // that plans are dynamic (see Tenant.js's HOOK 2).
  let resolvedPlanId = planId || null;
  if (!resolvedPlanId && plan) {
    const planDoc = await PlanModel.findOne({ key: plan });
    if (planDoc) resolvedPlanId = planDoc._id;
    // else: unknown key -- silently fall through to the tenant's own
    // default-plan resolution rather than hard-erroring on a typo'd key.
  }

  const session = await mongoose.startSession();
  let tenant, user;
  try {
    await session.withTransaction(async () => {
      tenant = (await Tenant.create([{
        name: workspaceName,
        ownerName: `${ownerFirstName} ${ownerLastName}`.trim(),
        ownerEmail: ownerEmail.toLowerCase().trim(),
        // accountId set below, once we have the new owner's user._id --
        // deliberately NOT setting planId here anymore (see Tenant.js's
        // HOOK 2): the account is the real source of truth now, tenant
        // just syncs from it once accountId is set a few lines down.
      }], { session }))[0];

      user = (await User.create([{
        firstName: ownerFirstName,
        lastName: ownerLastName,
        email: ownerEmail,
        password: ownerPassword,
        role: ROLES.TENANT_OWNER,
        tenantId: tenant._id,
        status: USER_STATUS.ACTIVE,
      }], { session }))[0];

      // A Super-Admin-created tenant always gets a fresh Account --
      // there's a brand-new owner user being created right alongside it,
      // so there's no existing account to reuse (unlike self-serve
      // createWorkspace, which deliberately reuses the requester's
      // existing one). Seeded with whatever plan Super Admin picked.
      const account = (await AccountModel.create([{
        ownerUserId: user._id,
        planId: resolvedPlanId,
      }], { session }))[0];

      tenant.ownerUserId = user._id;
      tenant.accountId = account._id;
      tenant.currentUserCount = 1;
      await tenant.save({ session });

      await Membership.create([{
        userId: user._id,
        tenantId: tenant._id,
        role: ROLES.TENANT_OWNER,
        status: MEMBERSHIP_STATUS.ACTIVE,
        invitedBy: actorUserId,
        joinedAt: new Date(),
      }], { session });
    });
  } finally {
    session.endSession();
  }

  return tenant;
};

/**
 * updateTenant — general tenant edit from Super Admin.
 *
 * `planId` is handled specially: it goes through the actual Tenant
 * document (findById + upgradePlan() + save()) so the pre-save hook
 * resolves and denormalizes maxUsers/maxLeads/maxCampaigns/
 * maxWorkspaces/planTrack/plan from the real Plan document. The OLD
 * version of this function set `plan` directly via findOneAndUpdate's
 * $set, which bypasses Mongoose document hooks entirely -- that would've
 * silently left planTrack/limits stale (still pointing at whatever plan
 * the tenant was on before), a real bug fixed here.
 *
 * name/mrr and DIRECT limit overrides (maxUsers etc., for one-off
 * enterprise-style exceptions outside the normal plan tiers -- same
 * intent the original allowedFields list already had) still go through
 * the plain $set path below, since those don't need any hook logic.
 */
/**
 * updateTenant — general tenant edit from Super Admin.
 *
 * `planId` and `mrr` are handled specially now: billing lives on the
 * tenant's ACCOUNT (see plans/account.model.js), not the tenant itself
 * anymore -- one subscription covers every workspace an owner has, so
 * changing plan/MRR here goes through the account and propagates to
 * every sibling tenant that account covers, not just this one.
 *
 * name and DIRECT limit overrides (maxUsers etc., for one-off
 * enterprise-style exceptions outside the normal plan tiers) still go
 * through the plain $set path below, applied to just this tenant -- same
 * intent the original allowedFields list already had. Note these are
 * NOT sticky: the next time this tenant's account plan changes,
 * syncTenantsFromAccount will overwrite them back to the plan's real
 * numbers, same as before.
 */
export const updateTenant = async (tenantId, data) => {
  let tenant = await Tenant.findOne({ _id: tenantId, deletedAt: null });
  if (!tenant) throw AppError.notFound('Tenant not found');

  if (data.planId !== undefined || data.mrr !== undefined) {
    if (!tenant.accountId) throw AppError.badRequest('This tenant is not linked to a billing account yet -- contact support.');
    const account = await AccountModel.findById(tenant.accountId);
    if (!account) throw AppError.notFound('Billing account not found');

    if (data.planId !== undefined) {
      await account.upgradePlan(data.planId);
    }
    if (data.mrr !== undefined) {
      account.mrr = data.mrr;
    }
    await account.save();
    await syncTenantsFromAccount(account._id); // every sibling tenant this account covers, not just this one
    tenant = await Tenant.findById(tenantId); // re-read post-sync
  }

  const allowedFields = ['name', 'maxUsers', 'maxLeads', 'maxCampaigns', 'maxWorkspaces'];
  const update = {};
  for (const field of allowedFields) {
    if (data[field] !== undefined) update[field] = data[field];
  }

  if (Object.keys(update).length > 0) {
    Object.assign(tenant, update);
    await tenant.save();
  }

  return tenant;
};

export const suspendTenant = async (tenantId) => {
  const tenant = await Tenant.findOneAndUpdate(
    { _id: tenantId, deletedAt: null },
    { $set: { subscriptionStatus: SUBSCRIPTION_STATUS.SUSPENDED } },
    { new: true }
  );
  if (!tenant) throw AppError.notFound('Tenant not found');
  return tenant;
};

export const reactivateTenant = async (tenantId) => {
  const tenant = await Tenant.findOneAndUpdate(
    { _id: tenantId, deletedAt: null },
    { $set: { subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE } },
    { new: true }
  );
  if (!tenant) throw AppError.notFound('Tenant not found');
  return tenant;
};

export const listAllUsers = async (query, options) => {
  const filter = { status: { $ne: USER_STATUS.DELETED } };
  if (query.role) filter.role = query.role;
  if (query.status) filter.status = query.status;
  if (query.search) {
    filter.$or = [
      { firstName: { $regex: query.search, $options: 'i' } },
      { lastName: { $regex: query.search, $options: 'i' } },
      { email: { $regex: query.search, $options: 'i' } },
    ];
  }

  const { page, limit, skip } = normalizePaging(options || {});
  const [users, total] = await Promise.all([
    User.find(filter).populate('tenantId', 'name slug').sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);

  return {
    users: users.map((u) => ({
      id: u._id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      role: u.role,
      status: u.status,
      tenantName: u.tenantId?.name || null,
      tenantId: u.tenantId?._id || null,
      lastLogin: u.lastLogin,
      createdAt: u.createdAt,
    })),
    pagination: paginationMeta({ page, limit, total }),
  };
};

/**
 * getIntegrationHealth — real aggregate of Integration.status across
 * every tenant, grouped by provider. "Uptime" per spec's own word choice
 * isn't literally trackable (no real uptime monitor exists anywhere in
 * this codebase) -- this reports genuine connection counts instead,
 * which is the real, honest signal actually available.
 */
export const getIntegrationHealth = async () => {
  const byProvider = await Integration.aggregate([
    {
      $group: {
        _id: '$key',
        name: { $first: '$name' },
        category: { $first: '$category' },
        connected: { $sum: { $cond: [{ $eq: ['$status', 'connected'] }, 1, 0] } },
        simulation: { $sum: { $cond: [{ $eq: ['$status', 'simulation'] }, 1, 0] } },
        disconnected: { $sum: { $cond: [{ $eq: ['$status', 'disconnected'] }, 1, 0] } },
        total: { $sum: 1 },
      },
    },
    { $sort: { connected: -1 } },
  ]);

  return { integrations: byProvider };
};

export const getGlobalActivityLog = async (query, options) => {
  const filter = {};
  if (query.event) filter.event = query.event;
  if (query.tenantId) filter.tenantId = query.tenantId;
  if (query.success !== undefined) filter.success = query.success === 'true';

  const { page, limit, skip } = normalizePaging(options || {});
  const [logs, total] = await Promise.all([
    LoginAudit.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    LoginAudit.countDocuments(filter),
  ]);

  return { logs, pagination: paginationMeta({ page, limit, total }) };
};

/**
 * listGlobalTemplates — real GenericTemplate documents with tenant_id:
 * null (the model's own real definition of "global scope", confirmed
 * directly from template.model.js). No new model or field introduced --
 * this is exactly what the templates module already means by "global".
 */
export const listGlobalTemplates = async () => {
  const templates = await GenericTemplate.find({ tenant_id: null }).sort({ created_at: -1 });
  return { templates };
};