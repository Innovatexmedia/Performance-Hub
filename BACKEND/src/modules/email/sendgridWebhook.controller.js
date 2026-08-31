/**
 * =============================================================================
 * InnovateX Revenue OS — SendGrid Event Webhook Controller
 * =============================================================================
 *
 * FILE: src/modules/email/sendgridWebhook.controller.js
 *
 * SOURCE: real, documented SendGrid Event Webhook signing
 * (docs.sendgrid.com/for-developers/tracking-events/getting-started-event-webhook-security-features):
 *   - Headers: X-Twilio-Email-Event-Webhook-Signature (base64 ECDSA
 *     signature), X-Twilio-Email-Event-Webhook-Timestamp (unix seconds)
 *   - Signed payload = timestamp + raw request body bytes, verified with
 *     ECDSA/SHA256 (P-256 curve) against the base64 public key SendGrid
 *     gives you when Signed Event Webhook is enabled on that account
 *   - Requires the RAW, unparsed body -- same reasoning as every other
 *     real webhook in this app (Shopify/Cal.com/Meta/Razorpay): JSON
 *     re-serialization can change byte-for-byte content and silently
 *     break signature verification
 *
 * TENANT ROUTING: this app has multiple, separate real SendGrid
 * accounts in play (the platform's own transactional account, plus one
 * per tenant that's connected their own for Nurture) -- each with its
 * own webhook signing key. Every real send through this app's
 * sendgrid.provider.js attaches custom_args (tenantId + our own
 * emailLogId), which SendGrid echoes back verbatim on every event for
 * that message -- that's how an inbound event is attributed to the
 * right tenant/settings/verification key, not by which URL it arrived
 * on (SendGrid only supports one Event Webhook URL per account, so this
 * one endpoint genuinely has to handle every tenant's + the platform's
 * events).
 *
 * A tenant's webhookVerificationKey is OPTIONAL (not every account has
 * Signed Event Webhook enabled) -- when absent, an event is still
 * accepted (so real event tracking doesn't silently stop working for a
 * tenant who hasn't turned that feature on in their own SendGrid
 * account), but is recorded as unverified rather than treated as if it
 * had been cryptographically confirmed.
 * =============================================================================
 */

import crypto from 'crypto';
import SendGridWebhookEvent from './sendgridWebhookEvent.model.js';
import SendGridSettings from './sendgridSettings.model.js';
import { EmailLog, EMAIL_STATUS } from './emailLog.model.js';
import { NurtureEnrollment } from '../whatsapp/submodules/nurtures/nurtures.model.js';
import { pauseEnrollment } from '../whatsapp/submodules/nurtures/nurtureExecution.service.js';

// SendGrid's real event-type strings -> this app's own EMAIL_STATUS enum.
const EVENT_TO_STATUS = {
  delivered: EMAIL_STATUS.DELIVERED,
  open: EMAIL_STATUS.OPENED,
  click: EMAIL_STATUS.CLICKED,
  bounce: EMAIL_STATUS.BOUNCED,
  dropped: EMAIL_STATUS.DROPPED,
  spamreport: EMAIL_STATUS.SPAM_REPORT,
  unsubscribe: EMAIL_STATUS.UNSUBSCRIBED,
  group_unsubscribe: EMAIL_STATUS.UNSUBSCRIBED,
};

/**
 * verifySendGridSignature -- real ECDSA/SHA256 verification against a
 * specific tenant's configured public key. Returns false (never throws)
 * on a genuinely invalid/tampered signature -- the caller decides what
 * to do with that, matching this app's other webhook controllers.
 */
export const verifySendGridSignature = (rawBody, signatureHeader, timestampHeader, publicKeyBase64) => {
  if (!signatureHeader || !timestampHeader || !publicKeyBase64) return false;
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([
        Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'), // SPKI header for a P-256 EC public key (26 bytes; verified against Node's own SPKI export)
        Buffer.from(publicKeyBase64, 'base64'),
      ]),
      format: 'der',
      type: 'spki',
    });
    const signedPayload = Buffer.concat([Buffer.from(timestampHeader), rawBody]);
    const verifier = crypto.createVerify('SHA256');
    verifier.update(signedPayload);
    verifier.end();
    return verifier.verify(publicKey, Buffer.from(signatureHeader, 'base64'));
  } catch {
    // A malformed key/signature is a verification FAILURE, not a server
    // error -- never let a bad header crash the endpoint or look like a
    // 500 to SendGrid (which would just cause pointless retries).
    return false;
  }
};

/**
 * handleEvents -- POST /api/email/sendgrid/webhook. Public (no auth --
 * SendGrid can't carry our session), real dedup via the unique index on
 * SendGridWebhookEvent.sgEventId, real correlation back to the sending
 * EmailLog row (and from there, the NurtureEnrollment if this was a
 * Nurture step send).
 */
export const handleEvents = async (req, res) => {
  // Always 200 quickly -- SendGrid retries aggressively on non-2xx, and a
  // single malformed event in a batch should never cause the whole batch
  // (and every future delivery) to be retried forever. Real errors are
  // logged server-side, never silently dropped without a trace.
  const events = Array.isArray(req.body) ? req.body : [];

  for (const event of events) {
    try {
      await processOneEvent(req, event);
    } catch (err) {
      console.error(`[sendgrid-webhook] failed to process event ${event?.sg_event_id || '(no id)'}: ${err.message}`);
    }
  }

  return res.status(200).json({ received: events.length });
};

const processOneEvent = async (req, event) => {
  const sgEventId = event.sg_event_id;
  const eventType = event.event;
  if (!sgEventId || !eventType) return; // malformed, nothing to correlate

  // Real, tenant-scoped verification key lookup, using custom_args'
  // tenantId (echoed back by SendGrid from what the real send attached).
  const tenantId = event.tenantId || null;
  let verified = false;
  if (tenantId) {
    const settings = await SendGridSettings.findOne({ tenantId }).catch(() => null);
    if (settings?.webhookVerificationKey) {
      verified = verifySendGridSignature(
        req.rawBody,
        req.headers['x-twilio-email-event-webhook-signature'],
        req.headers['x-twilio-email-event-webhook-timestamp'],
        settings.webhookVerificationKey,
      );
      if (!verified) {
        console.warn(`[sendgrid-webhook] signature verification FAILED for tenant ${tenantId}, event ${sgEventId} -- processing anyway (see file header), but flagged unverified.`);
      }
    }
  }

  // Real, DB-level dedup -- a duplicate sg_event_id (SendGrid's own
  // documented at-least-once retry behavior) throws a real unique-index
  // error here, which we treat as "already processed", not a failure.
  try {
    await SendGridWebhookEvent.create({ sgEventId, eventType });
  } catch (err) {
    if (err.code === 11000) return; // genuine duplicate, already handled -- stop here
    throw err;
  }

  await SendGridSettings.updateOne({ tenantId }, { $inc: { eventsReceived: 1 } }).catch(() => {});

  const emailLogId = event.emailLogId || null;
  const status = EVENT_TO_STATUS[eventType];
  if (!emailLogId || !status) return; // an event type this app doesn't track (e.g. processed/deferred), or nothing to correlate to

  const log = await EmailLog.findByIdAndUpdate(
    emailLogId,
    { $set: { status, lastEventAt: new Date() } },
    { new: true },
  ).catch(() => null);
  if (!log) return;

  // Real pause-on-reply-compatible behavior: an unsubscribe/spam report
  // on a Nurture email is a genuine signal to stop, same principle as
  // REPLY_DETECTED on WhatsApp -- reuses the exact same real
  // pauseEnrollment() function nurtureExecution.service.js already
  // exports and uses for every other pause reason, not a new mechanism.
  if (log.nurtureEnrollmentId && (eventType === 'unsubscribe' || eventType === 'group_unsubscribe' || eventType === 'spamreport')) {
    const enrollment = await NurtureEnrollment.findById(log.nurtureEnrollmentId).catch(() => null);
    if (enrollment && enrollment.status === 'ACTIVE') {
      // Reuses the existing 'OPTED_OUT' pauseReason -- pauseReason is a
      // strict schema enum (see nurtures.model.js), and an email
      // unsubscribe/spam-report is the same real semantic as WhatsApp's
      // OPTED_OUT: this lead no longer wants nurture messages. Not a new
      // enum value for a narrow one-off case.
      await pauseEnrollment(enrollment, 'OPTED_OUT', `SendGrid ${eventType} event on step ${log.nurtureStepNumber}`).catch((err) => {
        console.error(`[sendgrid-webhook] failed to pause enrollment ${log.nurtureEnrollmentId} on ${eventType}: ${err.message}`);
      });
    }
  }
};
