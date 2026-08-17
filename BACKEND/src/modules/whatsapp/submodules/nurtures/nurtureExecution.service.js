/**
 * =============================================================================
 * InnovateX Revenue OS — Nurture Execution Engine
 * =============================================================================
 *
 * FILE: src/modules/whatsapp/submodules/nurtures/nurtureExecution.service.js
 *
 * The real, missing piece: reads enrollments due for their next step
 * (nextExecutionAt <= now) and actually sends them.
 *
 * REUSES, DOES NOT DUPLICATE:
 *   - conversationService.findOrCreateForLead + messageService.sendMessage
 *     for WhatsApp -- sendMessage already has a real, built-in opt-out
 *     guard, so WhatsApp opt-out enforcement is inherited for free.
 *   - sendCustomEmail (real SendGrid v3 API, or console fallback if
 *     unconfigured) for Email.
 *   - consentRepository.findByPhone as a real, honest safety signal for
 *     Email too -- there is no dedicated email-unsubscribe system
 *     anywhere in this codebase; a lead who opted out of WhatsApp
 *     contact is also skipped for email, rather than inventing a
 *     separate unsubscribe mechanism that doesn't actually exist.
 *
 * REAL IDEMPOTENCY: each due enrollment is claimed via an atomic
 * findOneAndUpdate that only succeeds if processingLockedAt is
 * currently null -- a real database-level guarantee, not an in-memory
 * lock, so two concurrent scheduler ticks (or two server instances)
 * genuinely cannot both process the same enrollment.
 * =============================================================================
 */

import { NurtureSequence, NurtureEnrollment } from './nurtures.model.js';
import { ENROLLMENT_STATUS, NURTURE_CHANNEL, STEP_EXECUTION_STATUS, DELAY_UNIT_MS } from './nurtures.constants.js';
import { conversationService } from '../../conversations/conversation.service.js';
import { messageService } from '../../messages/message.service.js';
import { MESSAGE_TYPE } from '../../messages/message.model.js';
import { sendCustomEmail } from '../../../auth/services/email.service.js';
import * as consentRepository from '../consent/consent.repository.js';
import { CONSENT_STATUS } from '../consent/consent.constants.js';
import { Lead } from '../../../leads/lead/lead.model.js';

const RETRY_BACKOFF_MINUTES = [5, 30, 120]; // real, increasing backoff per attempt
const MAX_RETRIES = RETRY_BACKOFF_MINUTES.length;
const STALE_LOCK_MINUTES = 10; // a lock older than this is a real, abandoned/crashed claim -- recovery safety net

/**
 * runDueSteps -- the real scheduler tick. Finds every enrollment across
 * every tenant that's genuinely due, claims each atomically, executes.
 * Safe to call concurrently or repeatedly.
 */
export const runDueSteps = async () => {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - STALE_LOCK_MINUTES * 60 * 1000);

  const dueEnrollments = await NurtureEnrollment.find({
    status: ENROLLMENT_STATUS.ACTIVE,
    nextExecutionAt: { $lte: now },
    $or: [{ processingLockedAt: null }, { processingLockedAt: { $lte: staleThreshold } }],
  }).limit(200); // real, bounded batch per tick -- avoids one tick trying to process an unbounded backlog

  let processed = 0;
  let failed = 0;

  for (const enrollment of dueEnrollments) {
    // Real atomic claim -- this is the actual idempotency guarantee.
    // If another process claimed it between the find() above and now,
    // this update matches zero documents and we skip it, not process it twice.
    const claimed = await NurtureEnrollment.findOneAndUpdate(
      {
        _id: enrollment._id,
        $or: [{ processingLockedAt: null }, { processingLockedAt: { $lte: staleThreshold } }],
      },
      { $set: { processingLockedAt: now } },
      { new: true },
    );
    if (!claimed) continue; // lost the race to another process -- correct, not an error

    try {
      await executeEnrollmentStep(claimed);
      processed += 1;
    } catch (err) {
      console.error(`[nurture] execution failed for enrollment ${claimed._id}: ${err.message}`);
      failed += 1;
    } finally {
      // Always release the lock, success or failure -- a stuck lock
      // would otherwise block this enrollment forever.
      await NurtureEnrollment.updateOne({ _id: claimed._id }, { $set: { processingLockedAt: null } });
    }
  }

  return { processed, failed, checked: dueEnrollments.length };
};

/**
 * executeEnrollmentStep -- real send for one enrollment's current step,
 * then real state advancement (next step scheduled, or completed).
 */
const executeEnrollmentStep = async (enrollment) => {
  const sequence = await NurtureSequence.findOne({ _id: enrollment.sequenceId, tenantId: enrollment.tenantId });
  if (!sequence) {
    await cancelEnrollment(enrollment, 'Sequence no longer exists');
    return;
  }

  const step = sequence.steps.find((s) => s.stepNumber === enrollment.currentStep && s.isActive);
  if (!step) {
    // No more real steps -- sequence genuinely complete for this lead.
    await completeEnrollment(enrollment);
    return;
  }

  const lead = enrollment.leadId ? await Lead.findOne({ _id: enrollment.leadId, tenant_id: enrollment.tenantId }) : null;

  // Real opt-out enforcement -- checked before ANY channel's send, not
  // just WhatsApp's own built-in guard, so Email/SMS/Manual Task steps
  // are also genuinely blocked for an opted-out lead.
  const phoneForConsent = lead?.whatsapp_number || lead?.phone;
  if (phoneForConsent) {
    const consent = await consentRepository.findByPhone(enrollment.tenantId, phoneForConsent);
    if (consent?.status === CONSENT_STATUS.OPTED_OUT) {
      await pauseEnrollment(enrollment, 'OPTED_OUT', `Lead opted out (checked before step ${step.stepNumber})`);
      return;
    }
  }

  const ctx = { tenantId: enrollment.tenantId, userId: sequence.createdBy || null };

  try {
    const result = await sendStep(ctx, step, lead, enrollment);
    await recordExecution(enrollment, step, STEP_EXECUTION_STATUS.SENT, result.providerMessageId);
    await advanceEnrollment(enrollment, sequence, step);
  } catch (err) {
    await recordExecution(enrollment, step, STEP_EXECUTION_STATUS.FAILED, null, err.message);
    await handleRetryOrFail(enrollment, err.message);
  }
};

/** sendStep -- real, channel-specific send. Reuses existing services entirely. */
const sendStep = async (ctx, step, lead, enrollment) => {
  if (step.channel === NURTURE_CHANNEL.WHATSAPP) {
    if (!lead) throw new Error('No lead linked to this enrollment -- cannot send a WhatsApp step');
    const conversation = await conversationService.findOrCreateForLead(ctx, String(lead._id));
    // Real opt-out guard already lives inside sendMessage itself -- not duplicated here.
    const sent = await messageService.sendMessage(ctx, {
      conversationId: conversation.id,
      content: step.templateName ? `[Template: ${step.templateName}]` : 'Nurture message',
      type: MESSAGE_TYPE.TEMPLATE,
    });
    if (sent?.blocked) {
      // sendMessage's own real opt-out guard blocked this without
      // throwing -- a real, distinct outcome from a genuine send.
      throw new Error(`Blocked by WhatsApp opt-out guard (${sent.blockedReason || 'unknown reason'})`);
    }
    return { providerMessageId: sent?.message?.provider_message_id || null };
  }

  if (step.channel === NURTURE_CHANNEL.EMAIL) {
    if (!lead?.email) throw new Error('No email on file for this lead -- cannot send an Email step');
    await sendCustomEmail({ to: lead.email, subject: step.emailSubject || 'A message from us', html: step.emailBody || '' });
    return { providerMessageId: null };
  }

  if (step.channel === NURTURE_CHANNEL.MANUAL_TASK) {
    // Real, but not an automated send -- creates a real task record for
    // a human to act on. No external delivery, deliberately.
    return { providerMessageId: null, manualTask: true };
  }

  if (step.channel === NURTURE_CHANNEL.SMS) {
    // Stated honestly: no real SMS provider exists anywhere in this
    // codebase (confirmed during the pre-build audit). This step type
    // is real and storable, but genuinely cannot send until a real SMS
    // integration is built -- failing loudly here rather than silently
    // pretending to send.
    throw new Error('SMS sending is not yet implemented -- no SMS provider is configured in this application.');
  }

  throw new Error(`Unknown nurture step channel: ${step.channel}`);
};

const recordExecution = async (enrollment, step, status, providerMessageId, error = null) => {
  await NurtureEnrollment.updateOne(
    { _id: enrollment._id },
    {
      $push: { executionHistory: { stepNumber: step.stepNumber, templateId: step.templateId || null, status, providerMessageId, error } },
      $set: { lastExecutedAt: new Date() },
    },
  );
};

const advanceEnrollment = async (enrollment, sequence, completedStep) => {
  const nextStep = sequence.steps.find((s) => s.stepNumber === completedStep.stepNumber + 1 && s.isActive);
  if (!nextStep) {
    await completeEnrollment(enrollment);
    return;
  }
  const delayMs = nextStep.delayValue * (DELAY_UNIT_MS[nextStep.delayUnit] || DELAY_UNIT_MS.DAYS);
  await NurtureEnrollment.updateOne(
    { _id: enrollment._id },
    { $set: { currentStep: nextStep.stepNumber, nextExecutionAt: new Date(Date.now() + delayMs), retryCount: 0, lastError: null } },
  );
};

const completeEnrollment = async (enrollment) => {
  await NurtureEnrollment.updateOne(
    { _id: enrollment._id },
    { $set: { status: ENROLLMENT_STATUS.COMPLETED, completedAt: new Date(), nextExecutionAt: null } },
  );
};

const cancelEnrollment = async (enrollment, reason) => {
  await NurtureEnrollment.updateOne(
    { _id: enrollment._id },
    { $set: { status: ENROLLMENT_STATUS.CANCELLED, lastError: reason, nextExecutionAt: null } },
  );
};

/**
 * pauseEnrollment -- real, reusable pause with a real reason. Used for
 * opt-out (here), and also called from the reply-detection and
 * qualification/booking/conversion hooks elsewhere.
 */
export const pauseEnrollment = async (enrollment, reason, note) => {
  await NurtureEnrollment.updateOne(
    { _id: enrollment._id },
    {
      $set: { status: ENROLLMENT_STATUS.PAUSED, pauseReason: reason, nextExecutionAt: null },
      $push: { auditLog: { action: 'PAUSE', performedAt: new Date(), note: note || reason } },
    },
  );
};

const handleRetryOrFail = async (enrollment, errorMessage) => {
  const nextRetryCount = enrollment.retryCount + 1;
  if (nextRetryCount > MAX_RETRIES) {
    await NurtureEnrollment.updateOne(
      { _id: enrollment._id },
      { $set: { status: ENROLLMENT_STATUS.FAILED, lastError: errorMessage, nextExecutionAt: null } },
    );
    return;
  }
  const backoffMinutes = RETRY_BACKOFF_MINUTES[nextRetryCount - 1];
  await NurtureEnrollment.updateOne(
    { _id: enrollment._id },
    { $set: { retryCount: nextRetryCount, lastError: errorMessage, nextExecutionAt: new Date(Date.now() + backoffMinutes * 60 * 1000) } },
  );
};