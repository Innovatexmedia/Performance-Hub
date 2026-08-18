/**
 * =============================================================================
 * InnovateX Revenue OS — Subscription Service (Razorpay)
 * =============================================================================
 *
 * FILE: src/modules/plans/subscription.service.js
 *
 * ACCOUNT-LEVEL BILLING
 * ─────────────────────
 * Subscriptions live on Account now (see plans/account.model.js), NOT on
 * the individual Tenant that happened to initiate checkout -- one
 * payment covers every workspace the owner has. Every function here
 * resolves tenantId -> tenant.accountId -> the real Account, does its
 * work there, then calls syncTenantsFromAccount() to propagate the
 * result to EVERY tenant that account covers, not just the one that
 * started the flow.
 *
 * THE CORE IDEA — locking/unlocking reuses existing enforcement, not new code
 * ─────────────────────────────────────────────────────────────────────────
 * "Lock" doesn't mean a new flag threaded through every permission check.
 * It means: when a subscription lapses (halted/cancelled/expired),
 * reassign the ACCOUNT back to the platform default plan via the SAME
 * upgradePlan() every other plan change already goes through, then sync
 * every tenant under it. That re-syncs maxUsers/maxLeads/maxCampaigns/
 * planTrack to the default plan's (lower) limits on EVERY workspace at
 * once, which requireModule() and canCreateLead()/canCreateUser()/
 * canCreateCampaign() already enforce everywhere, per-tenant, unchanged.
 * =============================================================================
 */

import Tenant from '../auth/models/Tenant.js';
import Account from './account.model.js';
import Plan from './plan.model.js';
import { getDefaultPlan, syncTenantsFromAccount } from './plan.service.js';
import { getRazorpayClient, isRazorpayConfigured, verifyPaymentSignature } from '../../config/razorpay.js';
import { AppError } from '../../shared/helpers/lead.helpers.js';
import { SUBSCRIPTION_STATUS } from '../auth/constants/auth.constants.js';

const asRazorpayError = (err, fallback = 'Payment provider error') => {
  const description = err?.error?.description || err?.description;
  return AppError.badRequest(description || fallback);
};

/** Resolves a tenantId to its owning Account -- every function below needs this first. */
const resolveAccountForTenant = async (tenantId) => {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant not found');
  if (!tenant.accountId) throw AppError.badRequest('This workspace is not linked to a billing account yet -- contact support.');
  const account = await Account.findById(tenant.accountId);
  if (!account) throw AppError.notFound('Billing account not found');
  return { tenant, account };
};

/**
 * ensureRazorpayPlan — creates the Razorpay Plan for our Plan document if
 * it doesn't have one yet. Razorpay Plans are immutable once created, so
 * this only ever creates, never updates.
 */
const ensureRazorpayPlan = async (plan) => {
  if (plan.razorpayPlanId) return plan.razorpayPlanId;

  const razorpay = getRazorpayClient();
  let created;
  try {
    created = await razorpay.plans.create({
      period: 'monthly',
      interval: 1,
      item: {
        name: plan.name,
        amount: Math.round(plan.price * 100),
        currency: plan.currency || 'INR',
      },
      notes: { innovatex_plan_id: String(plan._id), innovatex_plan_key: plan.key },
    });
  } catch (err) {
    throw asRazorpayError(err, 'Could not create the Razorpay plan');
  }

  plan.razorpayPlanId = created.id;
  await plan.save();
  return created.id;
};

/**
 * createSubscriptionCheckout — starts a Razorpay subscription for the
 * account this tenant belongs to. Does NOT change any plan/limits yet --
 * that only happens once verifySubscriptionPayment (or the webhook)
 * confirms real payment.
 */
export const createSubscriptionCheckout = async (tenantId, planId, reqUser) => {
  if (!isRazorpayConfigured()) {
    throw AppError.badRequest('Payments are not configured on this server yet -- set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
  }

  const { account } = await resolveAccountForTenant(tenantId);
  const plan = await Plan.findById(planId);
  if (!plan) throw AppError.notFound('Plan not found');
  if (!plan.isActive) throw AppError.badRequest(`"${plan.name}" is no longer available -- choose a different plan`);

  if (plan.price <= 0) {
    throw AppError.badRequest('This plan is free -- use the direct plan switch, not checkout.');
  }

  const razorpay = getRazorpayClient();

  // Cancel any existing ACTIVE subscription before starting a new one --
  // without this, switching plans while already subscribed leaves the
  // OLD Razorpay subscription running (still billing) at the same time
  // as the new one, since account.razorpaySubscriptionId was previously
  // just overwritten with no cleanup. cancel_at_cycle_end: false stops
  // it immediately rather than letting one more cycle bill on the plan
  // the customer is actively leaving.
  if (account.razorpaySubscriptionId && account.razorpaySubscriptionStatus === 'active') {
    try {
      await razorpay.subscriptions.cancel(account.razorpaySubscriptionId, false);
    } catch (err) {
      // Already cancelled/expired on Razorpay's side (e.g. via a webhook
      // we haven't processed yet) is fine to ignore -- anything else
      // should stop the new checkout rather than risk two concurrent
      // subscriptions both charging this account.
      const alreadyGone = err?.error?.description && /already|cancel/i.test(err.error.description);
      if (!alreadyGone) throw asRazorpayError(err, 'Could not cancel the existing subscription before switching plans');
    }
  }

  // TEMP DIAGNOSTIC -- remove once the account-level billing migration is
  // fully confirmed stable.
  const cachedIdBefore = plan.razorpayPlanId;
  console.log('[checkout] plan from DB:', {
    name: plan.name, price: plan.price, currency: plan.currency,
    cachedRazorpayPlanId: cachedIdBefore, accountId: String(account._id),
  });

  let razorpayPlanId = await ensureRazorpayPlan(plan);
  console.log('[checkout] razorpayPlanId actually used:', razorpayPlanId, cachedIdBefore === razorpayPlanId ? '(REUSED cached)' : '(newly created just now)');

  const buildSubscriptionPayload = (rzpPlanId) => ({
    plan_id: rzpPlanId,
    customer_notify: 1,
    total_count: 120,
    notes: {
      innovatex_account_id: String(account._id),
      innovatex_plan_id: String(plan._id),
      created_by_user_id: String(reqUser?.sub || ''),
    },
  });

  let subscription;
  try {
    subscription = await razorpay.subscriptions.create(buildSubscriptionPayload(razorpayPlanId));
  } catch (err) {
    const looksLikeStalePlanId = err?.statusCode === 400 && /not.*found|invalid/i.test(err?.error?.description || '');
    if (!looksLikeStalePlanId) throw asRazorpayError(err, 'Could not start the subscription');

    plan.razorpayPlanId = null;
    razorpayPlanId = await ensureRazorpayPlan(plan);
    try {
      subscription = await razorpay.subscriptions.create(buildSubscriptionPayload(razorpayPlanId));
    } catch (retryErr) {
      throw asRazorpayError(retryErr, 'Could not start the subscription');
    }
  }

  account.razorpaySubscriptionId = subscription.id;
  account.razorpaySubscriptionStatus = subscription.status;
  account.pendingPlanId = plan._id;
  await account.save();

  return {
    subscriptionId: subscription.id,
    keyId: process.env.RAZORPAY_KEY_ID,
    planName: plan.name,
    amount: plan.price,
    currency: plan.currency || 'INR',
  };
};

/**
 * verifySubscriptionPayment — applies the plan switch to the ACCOUNT and
 * propagates it to every tenant that account covers, not just the one
 * that initiated checkout.
 */
export const verifySubscriptionPayment = async (tenantId, payload, reqUser) => {
  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = payload;
  if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
    throw AppError.badRequest('Missing payment confirmation fields');
  }

  const { account } = await resolveAccountForTenant(tenantId);

  if (account.razorpaySubscriptionId !== razorpay_subscription_id) {
    throw AppError.badRequest('This subscription does not belong to this billing account');
  }

  const valid = verifyPaymentSignature({ razorpay_payment_id, razorpay_subscription_id, razorpay_signature });
  if (!valid) {
    throw AppError.badRequest('Payment could not be verified -- please try again or contact support');
  }

  if (!account.pendingPlanId) {
    // Webhook may have already completed this exact upgrade before this
    // call landed -- Razorpay fires both, either can win the race.
    if (account.razorpaySubscriptionStatus === 'active') {
      return { success: true, plan: account.plan };
    }
    throw AppError.badRequest('No pending plan found for this subscription');
  }

  await account.upgradePlan(account.pendingPlanId);
  account.razorpaySubscriptionStatus = 'active';
  account.pendingPlanId = null;
  await account.save();
  await syncTenantsFromAccount(account._id);

  return { success: true, plan: account.plan };
};

/**
 * lockToDefaultPlan — the actual "lock" action. Reassigns the ACCOUNT
 * back to the platform default plan, then propagates that to every
 * tenant it covers. Called ONLY when a subscription that was genuinely
 * ACTIVE lapses (halted/cancelled/expired) -- see the caller's check
 * below. Explicitly overrides subscriptionStatus AFTER upgradePlan()
 * (which unconditionally sets it to 'active', correct for a genuine
 * paid activation, wrong here) -- otherwise a locked-back-to-default
 * account would misleadingly show "active" in the UI at the same time
 * razorpaySubscriptionStatus correctly says cancelled/halted/expired.
 */
const lockToDefaultPlan = async (account) => {
  const defaultPlan = await getDefaultPlan();
  if (defaultPlan) {
    await account.upgradePlan(defaultPlan._id);
    account.subscriptionStatus = SUBSCRIPTION_STATUS.INACTIVE;
  }
};

/**
 * handleWebhookEvent — looks up the ACCOUNT by razorpaySubscriptionId
 * (not a tenant -- a subscription belongs to an account now), and every
 * change here propagates to every tenant that account covers.
 */
export const handleWebhookEvent = async (event) => {
  const subscriptionEntity = event?.payload?.subscription?.entity;
  if (!subscriptionEntity) return;

  const account = await Account.findOne({ razorpaySubscriptionId: subscriptionEntity.id });
  if (!account) return;

  switch (event.event) {
    case 'subscription.activated':
    case 'subscription.charged': {
      account.razorpaySubscriptionStatus = 'active';
      if (subscriptionEntity.current_end) {
        account.currentPeriodEnd = new Date(subscriptionEntity.current_end * 1000);
      }
      if (account.pendingPlanId) {
        await account.upgradePlan(account.pendingPlanId);
        account.pendingPlanId = null;
      }
      await account.save();
      await syncTenantsFromAccount(account._id);
      break;
    }
    case 'subscription.halted':
    case 'subscription.cancelled':
    case 'subscription.expired': {
      // Only actually LOCK the account (reassign every tenant back to
      // the default plan) if a real, previously-ACTIVE subscription
      // just lapsed -- a subscription that never successfully activated
      // in the first place (e.g. the very first payment failed at the
      // bank) has nothing to "lock back" from: the account's plan was
      // never changed away from whatever it already was, so downgrading
      // it here would incorrectly punish every workspace under this
      // account for a checkout attempt that never actually unlocked
      // anything to begin with.
      const wasActive = account.razorpaySubscriptionStatus === 'active';
      account.razorpaySubscriptionStatus = event.event.split('.')[1];
      account.pendingPlanId = null;
      if (wasActive) {
        await lockToDefaultPlan(account);
      }
      await account.save();
      if (wasActive) {
        await syncTenantsFromAccount(account._id);
      }
      break;
    }
    default:
      break;
  }
};