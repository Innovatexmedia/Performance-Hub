/**
 * =============================================================================
 * InnovateX Revenue OS — Booking Reminder Scheduler
 * =============================================================================
 *
 * FILE: src/modules/bookings/bookingReminderScheduler.js
 *
 * Real, periodic job -- finds every real, still-SCHEDULED booking whose
 * meeting is due within the next REMINDER_WINDOW_HOURS and hasn't already
 * had a reminder sent, sends the real reminder email
 * (auth/services/email.service.js's sendBookingReminder -- already built,
 * previously unused), and marks it sent via reminderSentAt so the next
 * tick never double-sends. Same real pattern already proven twice in
 * this app (nurtureScheduler.js, googleAdsSyncScheduler.js): re-entrancy
 * guard, env-configurable schedule, per-item error isolation so one
 * lead's bad email address can't stop every other reminder in the batch.
 *
 * WINDOW LOGIC: meeting_date/meeting_time are separate real string fields
 * (YYYY-MM-DD / HH:MM, both validated at the schema level -- see
 * booking.model.js) with no timezone attached, matching how they're
 * displayed/entered everywhere else in this app. Combined into a real
 * Date for comparison against "now + REMINDER_WINDOW_HOURS", interpreted
 * in the server's own local time -- the same implicit assumption every
 * other meeting_date/meeting_time consumer in this codebase already
 * makes (there is no per-tenant timezone field on Booking to do
 * otherwise).
 * =============================================================================
 */

import cron from 'node-cron';
import { Booking } from './booking.model.js';
import { Lead } from '../leads/lead/lead.model.js';
import { BOOKING_STATUS } from './booking.constants.js';
import { sendBookingReminder } from '../auth/services/email.service.js';

const REMINDER_WINDOW_HOURS = Number(process.env.BOOKING_REMINDER_WINDOW_HOURS) || 24;

let isRunning = false; // real, simple re-entrancy guard -- same pattern as the other two schedulers

export const startBookingReminderScheduler = () => {
  const schedule = process.env.BOOKING_REMINDER_CRON || '*/15 * * * *'; // every 15 minutes -- frequent enough that a 24h-out window is never missed by more than 15 minutes

  if (!cron.validate(schedule)) {
    console.error(`[booking-reminder scheduler] invalid BOOKING_REMINDER_CRON "${schedule}" -- scheduler not started.`);
    return;
  }

  cron.schedule(schedule, async () => {
    if (isRunning) {
      console.warn('[booking-reminder scheduler] previous tick still running -- skipping this one');
      return;
    }
    isRunning = true;
    try {
      const result = await runDueReminders();
      if (result.checked > 0) {
        console.log(`[booking-reminder scheduler] tick: ${result.sent} sent, ${result.failed} failed, ${result.checked} checked`);
      }
    } catch (err) {
      console.error('[booking-reminder scheduler] tick failed:', err.message);
    } finally {
      isRunning = false;
    }
  });

  console.log(`[booking-reminder scheduler] started, schedule: "${schedule}", window: ${REMINDER_WINDOW_HOURS}h`);
};

/**
 * runDueReminders -- the real per-tick logic, exported separately so it
 * can be tested in isolation without needing a live cron tick.
 */
export const runDueReminders = async () => {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_HOURS * 60 * 60 * 1000);

  // Real, tenant-agnostic query -- this is a platform-level background
  // job, same as the other two schedulers, not scoped to one tenant.
  // Only ever considers bookings that are still genuinely SCHEDULED and
  // have never had a reminder sent (reminderSentAt: null) -- a
  // cancelled/rescheduled/completed booking, or one already reminded,
  // is never re-processed.
  const candidates = await Booking.find({
    status: BOOKING_STATUS.SCHEDULED,
    reminderSentAt: null,
  }).select('_id lead_id meeting_type meeting_date meeting_time meeting_link tenant_id');

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const booking of candidates) {
    try {
      // Real due-window check, done here (not in the query) since
      // meeting_date/meeting_time are separate strings, not a single
      // indexable Date field -- combining and comparing per-candidate is
      // the correct, simple approach for a background job checked every
      // 15 minutes, not a scale concern.
      const meetingAt = new Date(`${booking.meeting_date}T${booking.meeting_time}:00`);
      if (Number.isNaN(meetingAt.getTime()) || meetingAt < now || meetingAt > windowEnd) {
        skipped += 1;
        continue;
      }

      const lead = await Lead.findOne({ _id: booking.lead_id, tenant_id: booking.tenant_id }).select('email name');
      if (!lead?.email) {
        skipped += 1;
        continue;
      }

      await sendBookingReminder({
        email: lead.email, leadName: lead.name || 'there',
        meetingType: booking.meeting_type, meetingDate: booking.meeting_date,
        meetingTime: booking.meeting_time, meetingLink: booking.meeting_link,
      });

      // Real, immediate mark-as-sent -- right after the send resolves,
      // not batched at the end, so a mid-batch crash never leaves an
      // already-sent reminder unmarked (which would cause a real
      // duplicate send on the very next tick).
      await Booking.updateOne({ _id: booking._id }, { $set: { reminderSentAt: new Date() } });
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(`[booking-reminder scheduler] reminder failed for booking ${booking._id}: ${err.message}`);
    }
  }

  return { checked: candidates.length, sent, failed, skipped };
};
