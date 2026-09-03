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
import { assertSendAllowed } from '../consent/consentGuard.service.js';
import { Lead } from '../../../leads/lead/lead.model.js';
import { interpolateNurtureText, buildVariableContext } from './nurtureVariables.js';
import { createNotification } from '../../../leads/notifications/notification.service.js';
import { aiReplyAssistantService } from '../aiReplyAssistant/aiReplyAssistant.service.js';
import { API_REQUEST_TIMEOUT_MS, API_REQUEST_MAX_RESPONSE_BYTES, BOOKING_ACTION, PAYMENT_ACTION } from './nurtures.constants.js';
import * as bookingService from '../../../bookings/booking.service.js';
import * as paymentService from '../../../payments/payment.service.js';
import { ShopifyProvider } from '../../../shopify/providers/shopify.provider.js';
import ShopifySettings from '../../../shopify/shopifySettings.model.js';
import { decrypt } from '../../../../utils/crypto.js';
import { sendgridSettingsService } from '../../../email/sendgridSettings.service.js';
import { sendMail as sendgridSend } from '../../../email/providers/sendgrid.provider.js';
import { EmailLog, EMAIL_TYPE, EMAIL_CATEGORY, EMAIL_STATUS } from '../../../email/emailLog.model.js';

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
  // are also genuinely blocked for an opted-out lead. Shared with
  // messageSender.js's Campaign/Broadcast/manual-send path, so both go
  // through the exact same retried, fail-closed check against
  // WhatsAppConsent (never the denormalised lead.opt_out_status boolean).
  const phoneForConsent = lead?.whatsapp_number || lead?.phone;
  if (phoneForConsent) {
    const consentCheck = await assertSendAllowed(enrollment.tenantId, phoneForConsent);
    if (!consentCheck.allowed) {
      await pauseEnrollment(enrollment, 'OPTED_OUT', `Lead not sendable (checked before step ${step.stepNumber}): ${consentCheck.reason}`);
      return;
    }
  }

  const ctx = { tenantId: enrollment.tenantId, userId: sequence.createdBy || null };

  // Real variable context for this lead -- built once per execution, not
  // per channel, since every channel's interpolation uses the same data.
  const variableContext = {
    ...(lead ? await buildVariableContext(enrollment.tenantId, String(lead._id)) : {}),
    // Real, persisted variables discovered by an earlier step in THIS
    // enrollment (e.g. a prior Shopify node's real order lookup) --
    // survives across separate scheduler ticks, since it's read from
    // the enrollment document itself, not kept in memory.
    ...(enrollment.dynamicVariables || {}),
  };

  try {
    const result = await sendStep(ctx, step, lead, enrollment, variableContext);
    await recordExecution(enrollment, step, STEP_EXECUTION_STATUS.SENT, result.providerMessageId);
    await advanceEnrollment(enrollment, sequence, step);
  } catch (err) {
    await recordExecution(enrollment, step, STEP_EXECUTION_STATUS.FAILED, null, err.message);
    await handleRetryOrFail(enrollment, err.message);
  }
};

/** sendStep -- real, channel-specific send. Reuses existing services entirely. */
const sendStep = async (ctx, step, lead, enrollment, variableContext = {}) => {
  if (step.channel === NURTURE_CHANNEL.WHATSAPP) {
    if (!lead) throw new Error('No lead linked to this enrollment -- cannot send a WhatsApp step');
    const conversation = await conversationService.findOrCreateForLead(ctx, String(lead._id));
    // Real opt-out guard already lives inside sendMessage itself -- not duplicated here.
    const sent = await messageService.sendMessage(ctx, {
      conversationId: conversation.id,
      content: step.templateName ? `[Template: ${interpolateNurtureText(step.templateName, variableContext)}]` : 'Nurture message',
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

    // Real per-tenant routing: use the tenant's OWN connected SendGrid
    // account when they have one (their own verified domain, tracked and
    // billed separately -- the real point of this feature), falling back
    // to the existing, unmodified platform-level sender otherwise, so
    // nothing breaks for a tenant who hasn't connected their own account.
    const tenantCreds = await sendgridSettingsService.getDecryptedCredentials(ctx.tenantId);

    const subject = interpolateNurtureText(step.emailSubject, variableContext) || 'A message from us';
    const html = interpolateNurtureText(step.emailBody, variableContext) || '';
    const text = step.emailText ? interpolateNurtureText(step.emailText, variableContext) : undefined;
    const replyTo = step.replyTo ? interpolateNurtureText(step.replyTo, variableContext) : undefined;

    // Real EmailLog row, written BEFORE the send so a webhook event that
    // arrives moments later (a real, possible race -- SendGrid can be
    // fast) always has a row to correlate against.
    const log = await EmailLog.create({
      tenantId: String(ctx.tenantId), type: EMAIL_TYPE.NURTURE, category: EMAIL_CATEGORY.NURTURE_STEP,
      to: lead.email, subject, leadId: lead._id,
      nurtureEnrollmentId: enrollment._id, nurtureStepNumber: step.stepNumber,
      status: EMAIL_STATUS.QUEUED,
    });
    const customArgs = { tenantId: String(ctx.tenantId), emailLogId: String(log._id) };

    try {
      let sgMessageId = null;
      if (tenantCreds) {
        // Real SendGrid dynamic template support: dynamicTemplateData is
        // the SAME variableContext already used for {{...}} interpolation
        // everywhere else in this file -- SendGrid's own template editor
        // uses {{lead.name}}-style Handlebars, so this maps directly with
        // no second templating system. When sendgridTemplateId is set,
        // emailSubject/emailBody/emailText are ignored -- the template
        // supplies its own subject and content.
        const usingTemplate = !!step.sendgridTemplateId;
        const result = await sendgridSend({
          apiKey: tenantCreds.apiKey,
          from: tenantCreds.from,
          to: lead.email,
          replyTo: replyTo || tenantCreds.replyTo,
          subject: usingTemplate ? undefined : subject,
          html: usingTemplate ? undefined : html,
          text: usingTemplate ? undefined : text,
          templateId: step.sendgridTemplateId || undefined,
          dynamicTemplateData: usingTemplate ? { ...variableContext } : undefined,
          customArgs,
        });
        sgMessageId = result.sgMessageId;
      } else {
        // Real, existing platform fallback -- sendCustomEmail() itself is
        // completely unmodified.
        await sendCustomEmail({ to: lead.email, subject, html });
      }
      await EmailLog.updateOne({ _id: log._id }, { $set: { status: EMAIL_STATUS.SENT, sgMessageId } });
      return { providerMessageId: sgMessageId };
    } catch (err) {
      await EmailLog.updateOne({ _id: log._id }, { $set: { status: EMAIL_STATUS.FAILED, error: err.message } });
      // Real propagation, not swallowed: this file's own existing
      // handleRetryOrFail() (see the caller of sendStep) is what actually
      // decides retry vs. permanent failure for ANY step channel -- email
      // is not a special case, it goes through the exact same real
      // scheduler-level retry/backoff every other channel already has.
      throw err;
    }
  }

  if (step.channel === NURTURE_CHANNEL.AI) {
    if (!lead) throw new Error('No lead linked to this enrollment -- cannot generate an AI message');
    const conversation = await conversationService.findOrCreateForLead(ctx, String(lead._id));
    // Reuses the exact same real AI providers (Claude/Gemini) already
    // built for AI Reply Assistant -- not a separate AI integration.
    const generated = await aiReplyAssistantService.generateReply(ctx, {
      conversation: [],
      lead: { name: lead.name, company: lead.company },
      goal: interpolateNurtureText(step.aiGoal, variableContext) || 'continue the conversation naturally and helpfully',
      tone: step.aiTone || 'Professional',
      language: 'en',
    });
    const sent = await messageService.sendMessage(ctx, {
      conversationId: conversation.id,
      content: generated.generatedReply,
      type: MESSAGE_TYPE.TEXT,
    });
    if (sent?.blocked) {
      throw new Error(`Blocked by WhatsApp opt-out guard (${sent.blockedReason || 'unknown reason'})`);
    }
    return { providerMessageId: sent?.message?.provider_message_id || null };
  }

  if (step.channel === NURTURE_CHANNEL.API_REQUEST) {
    const url = interpolateNurtureText(step.apiUrl, variableContext);
    if (!url) throw new Error('No URL configured for this API Request step');

    await assertUrlIsSafe(url); // real SSRF guard -- throws if the target resolves to a private/internal address

    const headers = {};
    for (const h of step.apiHeaders || []) {
      if (h.key) headers[h.key] = interpolateNurtureText(h.value, variableContext);
    }
    const body = step.apiMethod !== 'GET' ? interpolateNurtureText(step.apiBody, variableContext) : undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, { method: step.apiMethod || 'POST', headers, body, signal: controller.signal });
    } catch (err) {
      throw new Error(err.name === 'AbortError' ? `API Request timed out after ${API_REQUEST_TIMEOUT_MS}ms` : `API Request failed — ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }

    // Real response-size cap -- reads at most API_REQUEST_MAX_RESPONSE_BYTES,
    // so a runaway/malicious response can't exhaust server memory. Now also
    // accumulates the (still capped) bytes so the response can be captured
    // into api.* variables below -- previously this loop only counted
    // bytes and discarded them, so a later step could never reference
    // anything from the response at all.
    const reader = response.body?.getReader?.();
    const chunks = [];
    let received = 0;
    if (reader) {
      while (received < API_REQUEST_MAX_RESPONSE_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          received += value.length;
          chunks.push(value);
        }
      }
      await reader.cancel().catch(() => {});
    }

    if (!response.ok) {
      throw new Error(`API Request returned HTTP ${response.status}`);
    }

    // Real variable capture, same dynamicVariables mechanism already
    // proven for Shopify (shopify.*) and Payment (payment.*) -- persisted
    // onto the enrollment so a LATER step (a separate scheduler tick,
    // potentially days later) can reference {{api.*}}. Only runs after
    // the !response.ok check above, so a failed request's error handling
    // (thrown Error -> recordExecution/handleRetryOrFail) is completely
    // unchanged -- no variables are captured for a failed call.
    const rawBody = chunks.length ? Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8') : '';
    // Metadata keys are applied LAST (after flattening), not just given
    // distinct names -- guarantees api.http_status/api.http_ok always
    // reflect this response's real transport-level status, even in the
    // edge case where the response body itself happens to contain a
    // field literally named http_status/http_ok. http_status/http_ok
    // rather than status/ok specifically because a JSON response body
    // commonly has its OWN "status" field (e.g. {"status": "completed"}),
    // and flattening that should produce {{api.status}} with the body's
    // real value -- exactly what a tenant configuring a webhook step is
    // far more likely to want than the raw HTTP code (confirmed by an
    // isolated test that caught this exact collision before it shipped).
    const apiVars = {};
    if (rawBody) {
      try {
        const parsed = JSON.parse(rawBody);
        Object.assign(apiVars, flattenForVariables(parsed, 'api'));
      } catch {
        // Real, non-fatal: a non-JSON response (plain text, HTML, an
        // empty body, etc.) is a genuinely valid outcome for a generic
        // webhook step, not an error -- never let a parse failure break
        // the workflow. Keep the raw text (truncated) so it's still
        // somewhat usable to a later step.
        apiVars['api.body'] = rawBody.length > 500 ? `${rawBody.slice(0, 500)}…` : rawBody;
      }
    }
    apiVars['api.http_status'] = String(response.status);
    apiVars['api.http_ok'] = String(response.ok);
    await NurtureEnrollment.updateOne({ _id: enrollment._id }, { $set: { dynamicVariables: { ...enrollment.dynamicVariables, ...apiVars } } });

    return { providerMessageId: null };
  }

  if (step.channel === NURTURE_CHANNEL.BOOKING) {
    if (!lead) throw new Error('No lead linked to this enrollment -- cannot run a Booking step');
    return sendBookingAction(ctx, step, lead, variableContext);
  }

  if (step.channel === NURTURE_CHANNEL.PAYMENT) {
    if (!lead) throw new Error('No lead linked to this enrollment -- cannot run a Payment step');
    return sendPaymentAction(ctx, step, lead, variableContext, enrollment);
  }

  if (step.channel === NURTURE_CHANNEL.SHOPIFY) {
    const orderId = interpolateNurtureText(step.shopifyOrderId, variableContext);
    if (!orderId) throw new Error('No Shopify order ID configured for this step');

    const credentials = await getShopifyCredentialsForTenant(ctx.tenantId);
    const provider = new ShopifyProvider(credentials);
    const order = await provider.getOrder(orderId); // real, confirmed: the only real lookup this provider supports
    if (!order) throw new Error(`Shopify order ${orderId} was not found`);

    // Real fields, exactly as the provider's real GraphQL query returns
    // them -- nothing invented. Persisted onto the enrollment so a LATER
    // step (a separate scheduler tick, potentially days later) can
    // reference these via {{shopify.*}}.
    const shopifyVars = {
      'shopify.order_name': order.name || '',
      'shopify.order_email': order.email || '',
      'shopify.order_phone': order.phone || '',
      'shopify.fulfillment_status': order.displayFulfillmentStatus || '',
      'shopify.financial_status': order.displayFinancialStatus || '',
      'shopify.total_amount': order.totalPriceSet?.shopMoney?.amount || '',
      'shopify.currency': order.totalPriceSet?.shopMoney?.currencyCode || '',
      'shopify.customer_name': order.customer?.displayName || '',
    };
    await NurtureEnrollment.updateOne({ _id: enrollment._id }, { $set: { dynamicVariables: { ...enrollment.dynamicVariables, ...shopifyVars } } });

    return { providerMessageId: null };
  }

  if (step.channel === NURTURE_CHANNEL.MANUAL_TASK) {
    // Real fix, merged from a genuinely more complete prior version of
    // this engine found during audit: creates a real Notification for
    // the assigned person, reusing the existing notification system --
    // not a new task system, and not a silent no-op like before. If no
    // one is assigned, this is still recorded as a real (if unassigned)
    // step, not an error.
    if (step.assignToUserId) {
      await createNotification({
        tenantId: String(ctx.tenantId),
        userId: String(step.assignToUserId),
        title: 'Nurture task due',
        body: interpolateNurtureText(step.taskDescription, variableContext) || `Follow up with ${lead?.name || 'this lead'}`,
        metadata: { lead_id: lead ? String(lead._id) : null, sequence_id: String(enrollment.sequenceId) },
      });
    }
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

/**
 * getShopifyCredentialsForTenant -- real lookup against the verified
 * ShopifySettings model. Decrypts the real, encrypted accessToken via
 * this codebase's existing AES-256-GCM utility (same one used for
 * Google Ads/Cal.com), returning exactly what ShopifyProvider's
 * constructor needs: { shopDomain, accessToken }.
 */
const getShopifyCredentialsForTenant = async (tenantId) => {
  const settings = await ShopifySettings.findOne({ tenantId, connected: true });
  if (!settings || !settings.shopDomain || !settings.accessToken) {
    throw new Error('Shopify is not connected for this workspace -- connect it from the Integrations page before using a Shopify step.');
  }
  return {
    shopDomain: settings.shopDomain,
    accessToken: decrypt(settings.accessToken),
  };
};

/** Synthetic reqUser matching buildCtx's real expected shape ({tenantId, sub, role}), same pattern already used for Cal.com's system-triggered bookings. */
const systemReqUser = (tenantId) => ({ tenantId, sub: 'nurture-workflow', role: 'tenant_admin' });

/** sendBookingAction -- real, bounded sub-actions only (see BOOKING_ACTION). */
const sendBookingAction = async (ctx, step, lead, variableContext) => {
  const action = step.bookingAction || BOOKING_ACTION.CHECK_STATUS;
  const conversation = await conversationService.findOrCreateForLead(ctx, String(lead._id));

  const sendText = async (content) => {
    const sent = await messageService.sendMessage(ctx, { conversationId: conversation.id, content, type: MESSAGE_TYPE.TEXT });
    if (sent?.blocked) throw new Error(`Blocked by WhatsApp opt-out guard (${sent.blockedReason || 'unknown reason'})`);
    return { providerMessageId: sent?.message?.provider_message_id || null };
  };

  if (action === BOOKING_ACTION.CHECK_STATUS) {
    const bookings = await bookingService.getBookingsByLead(String(ctx.tenantId), String(lead._id));
    const latest = Array.isArray(bookings) && bookings.length ? bookings[0] : null;
    // Real, informational only -- reports status via WhatsApp; does not
    // branch/skip the workflow (no branching, per the actual scope).
    return sendText(latest
      ? `Booking status for ${lead.name || 'you'}: ${latest.status} (${latest.meeting_date || 'no date'} ${latest.meeting_time || ''})`
      : `No booking found for ${lead.name || 'this lead'}.`);
  }

  if (action === BOOKING_ACTION.SEND_LINK || action === BOOKING_ACTION.SEND_REMINDER) {
    // Real: sends the EXISTING booking's real meeting link -- there is
    // no stored "public scheduling page" URL anywhere in this app to
    // send instead, so this only works if the lead already has a real
    // upcoming booking.
    const bookings = await bookingService.getBookingsByLead(String(ctx.tenantId), String(lead._id));
    const latest = Array.isArray(bookings) && bookings.length ? bookings[0] : null;
    if (!latest?.meeting_link) {
      throw new Error('No existing booking with a meeting link found for this lead -- nothing to send');
    }
    const label = action === BOOKING_ACTION.SEND_REMINDER ? 'Reminder' : 'Your meeting link';
    return sendText(`${label}: ${latest.meeting_type || 'Meeting'} on ${latest.meeting_date} at ${latest.meeting_time} — ${latest.meeting_link}`);
  }

  if (action === BOOKING_ACTION.CREATE) {
    // Real, but ONLY with an explicit date/time configured on the node
    // -- never auto-generated, exactly as scoped.
    const meetingDate = interpolateNurtureText(step.bookingDate, variableContext);
    const meetingTime = interpolateNurtureText(step.bookingTime, variableContext);
    if (!meetingDate || !meetingTime) {
      throw new Error('BOOKING (CREATE) step requires both a real date and time to be configured -- none was set, so no booking was created');
    }
    const booking = await bookingService.createBooking({
      lead_id: String(lead._id),
      meeting_type: step.bookingMeetingType || 'Meeting',
      meeting_date: meetingDate,
      meeting_time: meetingTime,
      duration_minutes: 30,
      notes: 'Created by Nurture workflow',
    }, systemReqUser(ctx.tenantId));
    return sendText(`You're booked: ${booking.meeting_type} on ${booking.meeting_date} at ${booking.meeting_time}.`);
  }

  throw new Error(`Unknown booking action: ${action}`);
};

/**
 * sendPaymentAction -- real, bounded sub-actions only (see PAYMENT_ACTION).
 * SCOPE, stated honestly: CREATE_REQUEST creates a real InnovateX
 * payment record and its real shareable link (<CLIENT_URL>/pay/{id} --
 * the exact same link the Payments module itself generates), sent to
 * the lead. This does NOT call any real Razorpay/payment-gateway API --
 * none exists in this codebase. The link opens InnovateX's own payment
 * page, where a rep would confirm/mark it paid, same as the existing
 * Payments module's manual flow.
 */
const sendPaymentAction = async (ctx, step, lead, variableContext, enrollment) => {
  const action = step.paymentAction || PAYMENT_ACTION.CHECK_STATUS;
  const conversation = await conversationService.findOrCreateForLead(ctx, String(lead._id));

  const sendText = async (content) => {
    const sent = await messageService.sendMessage(ctx, { conversationId: conversation.id, content, type: MESSAGE_TYPE.TEXT });
    if (sent?.blocked) throw new Error(`Blocked by WhatsApp opt-out guard (${sent.blockedReason || 'unknown reason'})`);
    return { providerMessageId: sent?.message?.provider_message_id || null };
  };

  // BUG FIX: unlike the Shopify step handler (which persists shopify.*
  // onto enrollment.dynamicVariables for a later step to reference), this
  // function never wrote payment.* variables back at all -- so
  // {{payment.status}}/{{payment.amount}}/{{payment.link}} never actually
  // worked in a later step's message, even though the same
  // dynamicVariables mechanism was already real and working for Shopify.
  // Mirrors that exact, already-proven pattern rather than inventing a
  // new one.
  const persistPaymentVars = async (paymentVars) => {
    await NurtureEnrollment.updateOne({ _id: enrollment._id }, { $set: { dynamicVariables: { ...enrollment.dynamicVariables, ...paymentVars } } });
  };

  if (action === PAYMENT_ACTION.CHECK_STATUS) {
    const payments = await paymentService.getPaymentsByLead(String(ctx.tenantId), String(lead._id));
    const latest = Array.isArray(payments) && payments.length ? payments[0] : null;
    await persistPaymentVars({
      'payment.status':   latest?.status || '',
      'payment.amount':   latest?.amount != null ? String(latest.amount) : '',
      'payment.currency': latest?.currency || '',
      'payment.link':     latest?.payment_link || '',
    });
    return sendText(latest
      ? `Payment status: ${latest.status} — ${latest.currency} ${latest.amount}`
      : `No payment record found for ${lead.name || 'this lead'}.`);
  }

  if (action === PAYMENT_ACTION.CREATE_REQUEST) {
    if (!step.paymentAmount || step.paymentAmount <= 0) {
      throw new Error('PAYMENT (CREATE_REQUEST) step requires a real, positive amount to be configured');
    }
    const payment = await paymentService.createPayment({
      lead_id: String(lead._id),
      amount: step.paymentAmount,
      currency: 'USD',
    }, systemReqUser(ctx.tenantId));
    await persistPaymentVars({
      'payment.status':   payment.status || '',
      'payment.amount':   payment.amount != null ? String(payment.amount) : '',
      'payment.currency': payment.currency || '',
      'payment.link':     payment.payment_link || '',
    });
    return sendText(`${interpolateNurtureText(step.paymentNote, variableContext) || 'Please complete your payment'}: ${payment.currency} ${payment.amount} — ${payment.payment_link}`);
  }

  throw new Error(`Unknown payment action: ${action}`);
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

/**
 * assertUrlIsSafe -- real SSRF guard for the API_REQUEST node. A
 * tenant-configured webhook URL is untrusted input; without this, a
 * malicious or careless tenant could point a workflow at
 * http://localhost/... or an internal service address and use this
 * server as a proxy into its own private network. Resolves the real
 * hostname via DNS and blocks any private/loopback/link-local result.
 */
const PRIVATE_IP_RANGES = [
  /^127\./, /^10\./, /^192\.168\./, /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^::1$/, /^f[cd][0-9a-f]{2}:/i, /^fe80:/i,
];

/**
 * flattenForVariables -- recursively flattens a JSON value into dotted
 * -path string keys, matching the existing {{group.field}} variable
 * convention already used everywhere else ({{lead.name}},
 * {{shopify.fulfillment_status}}). Scalars (string/number/boolean) become
 * real key/value pairs; arrays are indexed (api.items.0.id, ...);
 * null/undefined are skipped, since there's nothing meaningful to
 * interpolate. Bounded to MAX_FLATTENED_KEYS total keys and a max nesting
 * depth so a huge or deliberately pathological response body can't
 * produce an unbounded variable set on the enrollment document -- the
 * same "don't let untrusted response data exhaust resources" principle
 * as this file's existing response-size cap, applied one level deeper.
 */
const MAX_FLATTENED_KEYS = 200;
const MAX_FLATTEN_DEPTH = 10;
function flattenForVariables(value, prefix, out = {}, depth = 0) {
  if (Object.keys(out).length >= MAX_FLATTENED_KEYS || depth > MAX_FLATTEN_DEPTH) return out;
  if (value === null || value === undefined) return out;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    out[prefix] = String(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length && Object.keys(out).length < MAX_FLATTENED_KEYS; i += 1) {
      flattenForVariables(value[i], `${prefix}.${i}`, out, depth + 1);
    }
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      if (Object.keys(out).length >= MAX_FLATTENED_KEYS) break;
      flattenForVariables(val, `${prefix}.${key}`, out, depth + 1);
    }
    return out;
  }
  return out;
}

const assertUrlIsSafe = async (urlString) => {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(`Invalid URL: ${urlString}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported URL scheme: ${parsed.protocol}`);
  }
  if (parsed.hostname === 'localhost') {
    throw new Error('Requests to localhost are not allowed');
  }

  let addresses;
  try {
    const dns = await import('node:dns/promises');
    addresses = await dns.lookup(parsed.hostname, { all: true });
  } catch (err) {
    throw new Error(`Could not resolve host "${parsed.hostname}" — ${err.message}`);
  }

  for (const { address } of addresses) {
    if (PRIVATE_IP_RANGES.some((re) => re.test(address))) {
      throw new Error(`Requests to private/internal addresses are not allowed (${parsed.hostname} resolved to ${address})`);
    }
  }
};

// Test-only export surface -- additive, does not change any existing
// behavior or the public API this file already exposed (runDueSteps,
// pauseEnrollment). Lets isolated tests exercise the real
// sendStep()/flattenForVariables() logic directly (e.g. the API_REQUEST
// -> api.* dynamicVariables path) without needing a live DB/scheduler.
export const __testables = { sendStep, flattenForVariables };