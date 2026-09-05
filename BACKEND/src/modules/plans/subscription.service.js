/**
 * =============================================================================
 * InnovateX Revenue OS — Subscription Service (Cashfree)
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
 * WHICH CASHFREE API THIS IS WRITTEN AGAINST
 * ───────────────────────────────────────────
 * Cashfree has two live Subscriptions API families (see cashfree.js's
 * comment for the full explanation). This account was confirmed via
 * real request/response testing to be on the v2 family
 * (`/api/v2/subscriptions/...`), NOT the newer hosted-checkout-widget
 * one. Within that family there are also two create-subscription
 * endpoints: `seamless` (for merchants building their OWN payment UI --
 * its authLink only appears after you've already submitted specific
 * payment details yourself) and `nonSeamless` (Cashfree hosts the whole
 * payment-method picker + auth flow, and hands back a ready-to-use
 * authLink directly in the create response). This uses `nonSeamless` --
 * create returns `authLink` immediately, the customer's browser
 * navigates there directly (a real page redirect, not a JS modal), and
 * there's no client-side JS SDK involved at all on this path -- see
 * cashfreeCheckout.ts on the frontend.
 *
 * verifySubscriptionPayment doesn't get a client-side payment signature
 * to check either (this API doesn't hand one back). Instead it
 * re-fetches the subscription's real status directly from Cashfree
 * using our own credentials -- strictly more trustworthy than verifying
 * a client-supplied signature, since there's nothing client-supplied to
 * trust at all.
 *
 * THE CORE IDEA — locking/unlocking reuses existing enforcement, not new code
 * ─────────────────────────────────────────────────────────────────────────
 * "Lock" doesn't mean a new flag threaded through every permission check.
 * It means: when a subscription lapses (on-hold/cancelled/expired),
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
import { cashfreeV2Request, isCashfreeConfigured, CashfreeApiError } from '../../config/cashfree.js';
import { AppError } from '../../shared/helpers/lead.helpers.js';
import { SUBSCRIPTION_STATUS } from '../auth/constants/auth.constants.js';
import config from '../../config/config.js';

const asCashfreeError = (err, fallback = 'Payment provider error') => {
  if (err instanceof CashfreeApiError) return AppError.badRequest(err.message || fallback);
  return AppError.badRequest(fallback);
};

/** Statuses that mean "this mandate is genuinely up and running" -- see
 * handleWebhookEvent's wasActive check for why this distinction matters. */
const ACTIVE_STATUSES = new Set(['ACTIVE']);
/** Terminal/lapsed statuses that should lock the account back to the
 * default plan IF the subscription was previously active. */
const LAPSED_STATUSES = new Set([
  'ON_HOLD', 'COMPLETED', 'CUSTOMER_CANCELLED', 'CUSTOMER_PAUSED',
  'EXPIRED', 'LINK_EXPIRED', 'CANCELLED', 'CARD_EXPIRED',
]);

/** Resolves a tenantId to its owning Account -- every function below needs this first. */
const resolveAccountForTenant = async (tenantId) => {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw AppError.notFound('Tenant not found');
  if (!tenant.accountId) throw AppError.badRequest('This workspace is not linked to a billing account yet -- contact support.');
  const account = await Account.findById(tenant.accountId);
  if (!account) throw AppError.notFound('Billing account not found');
  return { tenant, account };
};

/** Cashfree needs a name/email/phone for the mandate -- pulled from the
 * account's owning user, same person every checkout on this account
 * ultimately bills to. */
const getCustomerDetailsForAccount = async (account) => {
  const User = (await import('../auth/models/User.js')).default;
  const owner = await User.findById(account.ownerUserId);
  if (!owner) throw AppError.notFound('Billing account owner not found');

  return {
    customerName: `${owner.firstName || ''} ${owner.lastName || ''}`.trim() || 'Customer',
    customerEmail: owner.email,
    // Cashfree expects a bare 10-digit Indian mobile number; strip any
    // country code / formatting the user profile might have stored.
    customerPhone: (owner.phoneNumber || '').replace(/\D/g, '').slice(-10) || '9999999999',
  };
};

/** A fresh, unique subscriptionId per checkout attempt -- Cashfree
 * requires the merchant to supply this id (it's not autogenerated), and
 * it must not collide with a previous attempt. */
const generateSubscriptionId = (account) => `sub_${String(account._id)}_${Date.now()}`;

/**
 * sanitizePlanName — Cashfree's planInfo.planName field rejects anything
 * outside alphanumerics/spaces/a few special characters (confirmed in
 * practice: an em dash in a plan name like "Growth — WhatsApp Panel"
 * gets rejected with "planInfo.planName: allows only alpha numerics &
 * few special characters"). Plan names in this app are display strings a
 * Super Admin can freely edit (see plan.service.js), so this can't
 * assume they're always clean -- normalize before ever sending to
 * Cashfree, without touching what's actually stored/displayed anywhere
 * else.
 */
const sanitizePlanName = (name) =>
  name
    .replace(/[\u2012-\u2015\u2212]/g, '-') // em/en dashes, minus sign -> plain hyphen
    .replace(/[^a-zA-Z0-9 _-]/g, '')        // drop anything else Cashfree might reject
    .replace(/\s+/g, ' ')
    .trim();

/** Cashfree's v2 API wants "YYYY-MM-DD HH:mm:ss", not ISO 8601. */
const toCashfreeDateTime = (date) => date.toISOString().slice(0, 19).replace('T', ' ');

/**
 * createSubscriptionCheckout — starts a Cashfree subscription mandate for
 * the account this tenant belongs to. Does NOT change any plan/limits
 * yet -- that only happens once verifySubscriptionPayment (or the
 * webhook) confirms the mandate is actually ACTIVE.
 *
 * Returns an `authLink` -- the frontend does a plain browser redirect to
 * it (see cashfreeCheckout.ts), not a JS widget call.
 */
export const createSubscriptionCheckout = async (tenantId, planId, reqUser) => {
  if (!isCashfreeConfigured()) {
    throw AppError.badRequest('Payments are not configured on this server yet -- set CASHFREE_APP_ID and CASHFREE_SECRET_KEY.');
  }

  const { account } = await resolveAccountForTenant(tenantId);
  const plan = await Plan.findById(planId);
  if (!plan) throw AppError.notFound('Plan not found');
  if (!plan.isActive) throw AppError.badRequest(`"${plan.name}" is no longer available -- choose a different plan`);

  if (plan.price <= 0) {
    throw AppError.badRequest('This plan is free -- use the direct plan switch, not checkout.');
  }

  // Cancel any existing ACTIVE subscription before starting a new one --
  // without this, switching plans while already subscribed leaves the
  // OLD Cashfree mandate running (still billing) at the same time as the
  // new one.
  if (account.cashfreeSubReferenceId && account.cashfreeSubscriptionStatus === 'ACTIVE') {
    try {
      await cashfreeV2Request(`/api/v2/subscriptions/${account.cashfreeSubReferenceId}/cancel`, { method: 'POST' });
    } catch (err) {
      // Already cancelled/expired on Cashfree's side (e.g. via a webhook
      // we haven't processed yet) is fine to ignore -- anything else
      // should stop the new checkout rather than risk two concurrent
      // mandates both billing this account.
      const alreadyGone = err instanceof CashfreeApiError && /already|not.*found|invalid/i.test(err.message || '');
      if (!alreadyGone) throw asCashfreeError(err, 'Could not cancel the existing subscription before switching plans');
    }
  }

  const customerDetails = await getCustomerDetailsForAccount(account);
  const subscriptionId = generateSubscriptionId(account);

  const tenYearsOut = new Date();
  tenYearsOut.setFullYear(tenYearsOut.getFullYear() + 10);

  const payload = {
    subscriptionId,
    ...customerDetails,
    // Points at the BACKEND, not the frontend -- Cashfree redirects the
    // browser here via an HTML form POST (confirmed in practice), not a
    // normal GET link. A frontend dev server (Vite, or most static
    // hosts) has no route/middleware for an arbitrary POST and will
    // 404 it. The backend has a real Express route for this
    // (billingReturn.routes.js) that accepts the POST, verifies the
    // subscription server-to-server, then 302-redirects the browser to
    // a plain GET on the frontend, which any dev/static server handles
    // fine. subscriptionId is duplicated as a query param (not relying
    // solely on the POST body) so it survives regardless of exactly how
    // Cashfree's redirect ends up shaped.
    returnUrl: `${config.API_BASE_URL}/api/billing/cashfree-return?subscriptionId=${subscriptionId}`,
    // A nominal ₹1 authorization charge -- standard practice for
    // e-mandate/UPI Autopay setup: this confirms the mandate works
    // before real recurring billing starts on it. Refunded automatically
    // by Cashfree per their mandate-authorization flow, not something
    // this app needs to handle.
    authAmount: 1,
    expiresOn: toCashfreeDateTime(tenYearsOut),
    planInfo: {
      type: 'PERIODIC',
      planName: sanitizePlanName(plan.name),
      recurringAmount: plan.price,
      maxAmount: plan.price,
      intervals: 1,
      intervalType: 'month',
    },
    notificationChannels: ['EMAIL'],
  };

  let created;
  try {
    created = await cashfreeV2Request('/api/v2/subscriptions/nonSeamless/subscription', { method: 'POST', body: payload });
  } catch (err) {
    throw asCashfreeError(err, 'Could not start the subscription');
  }

  const subReferenceId = created?.data?.subReferenceId;
  const authLink = created?.data?.authLink;
  if (!subReferenceId || !authLink) {
    throw AppError.badRequest('Cashfree did not return a usable subscription -- please try again.');
  }

  account.cashfreeSubscriptionId = subscriptionId;
  account.cashfreeSubReferenceId = subReferenceId;
  account.cashfreeSubscriptionStatus = created?.data?.status || 'INITIALIZED';
  account.pendingPlanId = plan._id;
  await account.save();

  return {
    subscriptionId,
    authLink,
    planName: plan.name,
    amount: plan.price,
    currency: plan.currency || 'INR',
  };
};

/**
 * finalizeVerification — the actual "check with Cashfree and apply the
 * plan switch" logic, keyed only by OUR subscriptionId (via the
 * Account it's stored on) -- no tenantId/reqUser needed. Shared by two
 * callers with different trust levels:
 *  - verifySubscriptionPayment (below): an authenticated frontend call,
 *    additionally checks the subscription belongs to THIS caller's
 *    account before delegating here.
 *  - billingReturn.controller.js: Cashfree's own unauthenticated
 *    redirect after the mandate flow -- there's no logged-in user in
 *    that request at all, so account is resolved purely from the
 *    subscriptionId Cashfree hands back, which is safe because the
 *    actual authorization decision is never taken from anything the
 *    browser/Cashfree redirect claims -- it's always a fresh re-fetch
 *    from Cashfree's API using our own server-side credentials.
 */
const finalizeVerification = async (subscriptionId) => {
  const account = await Account.findOne({ cashfreeSubscriptionId: subscriptionId });
  if (!account || !account.cashfreeSubReferenceId) {
    throw AppError.notFound('Subscription not found');
  }

  let subscription;
  try {
    const fetched = await cashfreeV2Request(`/api/v2/subscriptions/${account.cashfreeSubReferenceId}`);
    subscription = fetched?.subscription;
  } catch (err) {
    throw asCashfreeError(err, 'Could not verify the subscription with Cashfree');
  }

  const status = subscription?.status;
  account.cashfreeSubscriptionStatus = status || account.cashfreeSubscriptionStatus;

  if (!ACTIVE_STATUSES.has(status)) {
    await account.save();
    throw AppError.badRequest(
      status === 'BANK_APPROVAL_PENDING' || status === 'INITIALIZED'
        ? 'The mandate authorization is still pending -- please complete it, or try again.'
        : 'Payment could not be verified -- please try again or contact support'
    );
  }

  if (!account.pendingPlanId) {
    // Webhook may have already completed this exact upgrade before this
    // call landed -- Cashfree fires both, either can win the race.
    await account.save();
    return { success: true, plan: account.plan };
  }

  await account.upgradePlan(account.pendingPlanId);
  account.pendingPlanId = null;
  await account.save();
  await syncTenantsFromAccount(account._id);

  return { success: true, plan: account.plan };
};

/**
 * verifySubscriptionByCashfreeId — used by the public return-redirect
 * handler (billingReturn.controller.js), where there's no authenticated
 * user/tenant in the request at all.
 */
export const verifySubscriptionByCashfreeId = (subscriptionId) => finalizeVerification(subscriptionId);

/**
 * verifySubscriptionPayment — the authenticated, frontend-callable
 * version. Kept for any path that still lands with the subscriptionId
 * known client-side and a logged-in user (e.g. a manual retry); the
 * normal Cashfree-redirect flow now goes through billingReturn instead,
 * which already finished verification server-to-server before the
 * browser ever gets back to the frontend.
 */
export const verifySubscriptionPayment = async (tenantId, payload) => {
  const { subscriptionId } = payload;
  if (!subscriptionId) {
    throw AppError.badRequest('Missing subscriptionId');
  }

  const { account } = await resolveAccountForTenant(tenantId);

  if (account.cashfreeSubscriptionId !== subscriptionId || !account.cashfreeSubReferenceId) {
    throw AppError.badRequest('This subscription does not belong to this billing account');
  }

  return finalizeVerification(subscriptionId);
};

/**
 * lockToDefaultPlan — the actual "lock" action. Reassigns the ACCOUNT
 * back to the platform default plan, then propagates that to every
 * tenant it covers. Called ONLY when a subscription that was genuinely
 * ACTIVE lapses -- see the caller's check below. Explicitly overrides
 * subscriptionStatus AFTER upgradePlan() (which unconditionally sets it
 * to 'active', correct for a genuine paid activation, wrong here) --
 * otherwise a locked-back-to-default account would misleadingly show
 * "active" in the UI at the same time cashfreeSubscriptionStatus
 * correctly says a lapsed status.
 */
const lockToDefaultPlan = async (account) => {
  const defaultPlan = await getDefaultPlan();
  if (defaultPlan) {
    await account.upgradePlan(defaultPlan._id);
    account.subscriptionStatus = SUBSCRIPTION_STATUS.INACTIVE;
  }
};

/**
 * applyStatusToAccount — the actual reconciliation logic, shared by TWO
 * callers with different trust levels but the same real trigger: Cashfree
 * telling us (or us confirming for ourselves) what a subscription's true
 * current status is.
 *  - handleWebhookEvent (below): reactive, status comes from Cashfree's
 *    own webhook push.
 *  - subscriptionReconciliationScheduler.js: proactive, status comes from
 *    US polling Cashfree's API directly -- the safety net for exactly
 *    the case a webhook never arrives at all (a delivery failure, a
 *    brief outage on either side, anything). Without this second path,
 *    a tenant whose mandate silently lapsed on Cashfree's side could
 *    keep full paid access indefinitely with no further charge ever
 *    landing -- real revenue leakage with no error, no signal, nothing
 *    to notice until someone happens to check.
 * Extracted into one function specifically so both paths can never
 * silently drift into applying the lock/sync logic differently.
 */
const applyStatusToAccount = async (account, status, expiryTime) => {
  const wasActive = account.cashfreeSubscriptionStatus === 'ACTIVE';

  if (ACTIVE_STATUSES.has(status)) {
    account.cashfreeSubscriptionStatus = status;
    if (expiryTime) {
      account.currentPeriodEnd = new Date(expiryTime);
    }
    if (account.pendingPlanId) {
      await account.upgradePlan(account.pendingPlanId);
      account.pendingPlanId = null;
    }
    await account.save();
    await syncTenantsFromAccount(account._id);
    return;
  }

  if (LAPSED_STATUSES.has(status)) {
    // Only actually LOCK the account (reassign every tenant back to the
    // default plan) if a real, previously-ACTIVE mandate just lapsed --
    // a subscription that never successfully activated in the first
    // place (e.g. the customer abandoned the authorization page) has
    // nothing to "lock back" from: the account's plan was never changed
    // away from whatever it already was, so downgrading it here would
    // incorrectly punish every workspace under this account for a
    // checkout attempt that never actually unlocked anything to begin
    // with.
    account.cashfreeSubscriptionStatus = status;
    account.pendingPlanId = null;
    if (wasActive) {
      await lockToDefaultPlan(account);
    }
    await account.save();
    if (wasActive) {
      await syncTenantsFromAccount(account._id);
    }
    return;
  }

  // Any other status (INITIALIZED, BANK_APPROVAL_PENDING, ...) is just an
  // in-progress step of the authorization flow -- record it, nothing else
  // to do until it resolves to ACTIVE or a lapsed status above.
  if (status) {
    account.cashfreeSubscriptionStatus = status;
    await account.save();
  }
};

/**
 * handleWebhookEvent — looks up the ACCOUNT by cashfreeSubscriptionId
 * (not a tenant -- a subscription belongs to an account now). Thin
 * wrapper: parses the webhook payload, then delegates the actual
 * reconciliation to applyStatusToAccount (shared with the reconciliation
 * scheduler -- see its own comment above).
 *
 * Only SUBSCRIPTION_STATUS_CHANGE actually drives plan changes --
 * SUBSCRIPTION_PAYMENT_SUCCESS/FAILED fire per individual recurring
 * charge and don't by themselves mean the mandate's overall status
 * changed (Cashfree retries failed charges before ever moving the
 * subscription to a lapsed status), so this deliberately ignores them
 * for plan-switching purposes.
 */
export const handleWebhookEvent = async (event) => {
  if (event?.type !== 'SUBSCRIPTION_STATUS_CHANGE') return;

  const subscriptionDetails = event?.data?.subscription_details;
  const subscriptionId = subscriptionDetails?.subscription_id || subscriptionDetails?.gateway_subscription_id;
  if (!subscriptionId) return;

  const account = await Account.findOne({ cashfreeSubscriptionId: subscriptionId });
  if (!account) return;

  await applyStatusToAccount(account, subscriptionDetails.subscription_status, subscriptionDetails.subscription_expiry_time);
};

/**
 * reconcileOneAccount — used by subscriptionReconciliationScheduler.js.
 * Fetches this account's subscription status DIRECTLY from Cashfree
 * (not trusting whatever's already cached in cashfreeSubscriptionStatus)
 * and applies it through the exact same logic a webhook would have
 * triggered. Safe to call repeatedly/on a schedule -- if Cashfree's
 * status matches what we already have, applyStatusToAccount's own
 * wasActive/pendingPlanId checks mean this is a no-op.
 */
export const reconcileOneAccount = async (account) => {
  if (!account.cashfreeSubReferenceId) return;
  const fetched = await cashfreeV2Request(`/api/v2/subscriptions/${account.cashfreeSubReferenceId}`);
  const subscription = fetched?.subscription;
  if (!subscription?.status) return;
  await applyStatusToAccount(account, subscription.status, null);
};