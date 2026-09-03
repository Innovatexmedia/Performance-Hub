
import cron from 'node-cron';
import { reconcileAll } from './consentSync.service.js';

let isRunning = false; // re-entrancy guard -- prevents a slow tick overlapping the next one, same pattern as nurtureScheduler.js

export const startConsentReconciliationJob = () => {
  const schedule = process.env.CONSENT_RECONCILE_CRON || '*/15 * * * *';

  if (!cron.validate(schedule)) {
    console.error(`[consent reconciliation] invalid CONSENT_RECONCILE_CRON "${schedule}" -- job not started.`);
    return;
  }

  cron.schedule(schedule, async () => {
    if (isRunning) {
      console.warn('[consent reconciliation] previous tick still running -- skipping this one');
      return;
    }
    isRunning = true;
    try {
      const result = await reconcileAll();
      if (result.fixed > 0 || result.failed > 0) {
        console.log(`[consent reconciliation] tick: ${result.scanned} consent records scanned, ${result.fixed} leads fixed, ${result.failed} failed`);
      }
    } catch (err) {
      console.error('[consent reconciliation] tick failed:', err.message);
    } finally {
      isRunning = false;
    }
  });

  console.log(`[consent reconciliation] started, schedule: "${schedule}"`);
};