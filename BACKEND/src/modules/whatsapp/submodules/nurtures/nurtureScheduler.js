/**
 * =============================================================================
 * InnovateX Revenue OS — Nurture Scheduler
 * =============================================================================
 *
 * FILE: src/modules/whatsapp/submodules/nurtures/nurtureScheduler.js
 *
 * Real, periodic job -- runs nurtureExecution.service.js's runDueSteps()
 * on a genuine interval via node-cron. Started once from app.js at
 * server boot.
 *
 * Interval is configurable via NURTURE_SCHEDULER_CRON (default: every
 * minute -- "* * * * *"). A minute-level granularity is a real,
 * reasonable default for multi-day nurture delays; it does not need to
 * be more frequent than that.
 * =============================================================================
 */

import cron from 'node-cron';
import { runDueSteps } from './nurtureExecution.service.js';

let isRunning = false; // real, simple re-entrancy guard -- prevents a slow tick overlapping the next one

export const startNurtureScheduler = () => {
  const schedule = process.env.NURTURE_SCHEDULER_CRON || '* * * * *';

  if (!cron.validate(schedule)) {
    console.error(`[nurture scheduler] invalid NURTURE_SCHEDULER_CRON "${schedule}" -- scheduler not started.`);
    return;
  }

  cron.schedule(schedule, async () => {
    if (isRunning) {
      console.warn('[nurture scheduler] previous tick still running -- skipping this one');
      return;
    }
    isRunning = true;
    try {
      const result = await runDueSteps();
      if (result.processed > 0 || result.failed > 0) {
        console.log(`[nurture scheduler] tick: ${result.processed} sent, ${result.failed} failed, ${result.checked} checked`);
      }
    } catch (err) {
      console.error('[nurture scheduler] tick failed:', err.message);
    } finally {
      isRunning = false;
    }
  });

  console.log(`[nurture scheduler] started, schedule: "${schedule}"`);
};