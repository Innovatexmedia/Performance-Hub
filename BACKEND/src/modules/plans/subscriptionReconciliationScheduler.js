import cron from 'node-cron';
import Account from './account.model.js';
import { reconcileOneAccount } from './subscription.service.js';

let isRunning = false; // real, simple re-entrancy guard -- same pattern as the other schedulers

export const startSubscriptionReconciliationScheduler = () => {
  const schedule = process.env.SUBSCRIPTION_RECONCILE_CRON || '0 3 * * *'; // once daily at 3am -- this is a safety net for a rare failure mode, not a hot path; no need to poll Cashfree more often than that

  if (!cron.validate(schedule)) {
    console.error(`[subscription-reconciliation scheduler] invalid SUBSCRIPTION_RECONCILE_CRON "${schedule}" -- scheduler not started.`);
    return;
  }

  cron.schedule(schedule, async () => {
    if (isRunning) {
      console.warn('[subscription-reconciliation scheduler] previous tick still running -- skipping this one');
      return;
    }
    isRunning = true;
    try {
      const result = await runReconciliation();
      if (result.checked > 0) {
        console.log(`[subscription-reconciliation scheduler] tick: ${result.checked} checked, ${result.corrected} corrected, ${result.failed} failed`);
      }
    } catch (err) {
      console.error('[subscription-reconciliation scheduler] tick failed:', err.message);
    } finally {
      isRunning = false;
    }
  });

  console.log(`[subscription-reconciliation scheduler] started, schedule: "${schedule}"`);
};

/**
 * runReconciliation -- the real per-tick logic, exported separately so
 * it can be run manually or tested in isolation without needing a live
 * cron tick.
 *
 * Only checks accounts that currently THINK they're ACTIVE -- an
 * account already known lapsed/none has nothing to reconcile (it's
 * already locked to the default plan); re-checking it daily forever
 * would just be wasted Cashfree API calls for no behavioral difference.
 */
export const runReconciliation = async () => {
  const candidates = await Account.find({
    cashfreeSubscriptionStatus: 'ACTIVE',
    cashfreeSubReferenceId: { $ne: null },
  }).select('_id cashfreeSubReferenceId cashfreeSubscriptionStatus pendingPlanId planId subscriptionStatus');

  let corrected = 0;
  let failed = 0;

  for (const account of candidates) {
    try {
      const statusBefore = account.cashfreeSubscriptionStatus;
      await reconcileOneAccount(account);
      if (account.cashfreeSubscriptionStatus !== statusBefore) {
        corrected += 1;
        console.warn(`[subscription-reconciliation scheduler] account ${account._id}: webhook was missed -- status corrected from "${statusBefore}" to "${account.cashfreeSubscriptionStatus}"`);
      }
    } catch (err) {
      failed += 1;
      console.error(`[subscription-reconciliation scheduler] reconciliation failed for account ${account._id}: ${err.message}`);
    }
  }

  return { checked: candidates.length, corrected, failed };
};