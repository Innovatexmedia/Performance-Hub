/**
 * WhatsApp Consent — send-time guard + inbound keyword detection.
 *
 * This is the ONE function every code path that actually sends a WhatsApp
 * message must call immediately before sending: messageSender.js
 * (Campaigns/Broadcasts/manual), nurtureExecution.service.js (Nurture
 * steps), and any future sender (Automation Rules' SEND_TEMPLATE action,
 * once wired). It re-checks WhatsAppConsent directly -- never the
 * denormalised Lead.opt_out_status boolean, which is only a fast
 * pre-filter for building an audience list, not a compliance decision.
 *
 * Fail-closed: if the consent record can't be read after retries (a
 * transient DB error), the send is BLOCKED, not allowed. Sending to an
 * unverifiable contact is the actual compliance risk here -- a missed
 * send can be retried later, a message sent to someone who opted out
 * cannot be unsent.
 */
import { consentRepository } from './consent.repository.js';
import { consentService } from './consent.service.js';
import { CONSENT_STATUS, SENDABLE_STATUSES } from './consent.constants.js';
import { withRetry } from './consentSync.service.js';
import { normalizePhoneNumber } from '../../../../shared/helpers/phone.helpers.js';

/**
 * Verifies a phone number may receive a WhatsApp message right now.
 * Returns { allowed, status, reason }. Never throws -- callers can use
 * the return value directly without a try/catch of their own.
 */
export async function assertSendAllowed(tenantId, phoneNumber) {
  if (!phoneNumber) {
    return { allowed: false, status: null, reason: 'No phone number to check consent for' };
  }

  try {
    const consent = await withRetry(
      () => consentRepository.findByPhone(tenantId, phoneNumber),
      { attempts: 3, baseDelayMs: 100, label: `consent lookup ${phoneNumber}` },
    );

    if (!consent) {
      // No consent record at all means consent was never captured -- the
      // safe default is to block, not to assume implicit opt-in.
      return { allowed: false, status: null, reason: 'No consent record found' };
    }

    const allowed = SENDABLE_STATUSES.includes(consent.status);
    return {
      allowed,
      status: consent.status,
      reason: allowed ? 'Contact has active consent' : `Contact status is ${consent.status}`,
    };
  } catch (err) {
    // Exhausted retries -- fail closed and log loudly. This should be
    // rare (only a sustained DB outage triggers it) and needs a human
    // to notice, not just a silently skipped send.
    console.error(`[CONSENT_GUARD_FAILOPEN_PREVENTED] tenant=${tenantId} phone=${phoneNumber} -- consent check failed after retries, blocking send: ${err.message}`);
    return { allowed: false, status: null, reason: 'Consent could not be verified -- blocked for safety' };
  }
}

// ── Inbound keyword auto-detection ──────────────────────────────────────────

const OPT_OUT_KEYWORDS = new Set(['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'OPT-OUT', 'REMOVE']);
const OPT_IN_KEYWORDS  = new Set(['START', 'SUBSCRIBE', 'UNSTOP', 'YES', 'OPTIN', 'OPT-IN']);

function normalizeKeyword(text = '') {
  return String(text).trim().toUpperCase();
}

/**
 * Called from the inbound-message webhook handler for every text message.
 * If the message body is (exactly) a recognised opt-out/opt-in keyword,
 * transitions the contact's WhatsAppConsent record accordingly --
 * automatically, with no agent action required. This is the piece that
 * was previously entirely missing: Consent only ever changed via a
 * manual click in the Consent tab, never from a real inbound "STOP".
 *
 * Idempotent by design: if the contact is already in the target state,
 * this is a no-op (not an error) -- a customer texting "STOP" twice in a
 * row must never throw or spam their history with a duplicate entry.
 * Never throws -- a keyword-detection failure must not take down inbound
 * message processing for a real customer message.
 */
export async function handleInboundKeyword(ctx, rawPhoneNumber, messageText) {
  const keyword = normalizeKeyword(messageText);
  const isOptOut = OPT_OUT_KEYWORDS.has(keyword);
  const isOptIn = OPT_IN_KEYWORDS.has(keyword);
  if (!isOptOut && !isOptIn) return;

  const phoneNumber = normalizePhoneNumber(rawPhoneNumber);

  try {
    let consent = await consentRepository.findByPhone(ctx.tenantId, phoneNumber);

    if (!consent) {
      // First contact ever from this number and their first message is a
      // keyword -- still needs a record so the transition (and its
      // audit-trail entry) has somewhere to live.
      consent = await consentService.createConsent(
        { tenantId: ctx.tenantId, userId: 'system:keyword_detection' },
        { phoneNumber, status: CONSENT_STATUS.PENDING, consentSource: 'WHATSAPP' },
      );
    }

    const targetStatus = isOptOut ? CONSENT_STATUS.OPTED_OUT : CONSENT_STATUS.OPTED_IN;
    if (consent.status === targetStatus || consent.status === CONSENT_STATUS.BLOCKED) {
      // Already there, or blocked (which only a tenant admin can lift) --
      // nothing to do, and calling optOut/optIn again would throw on an
      // invalid transition.
      return;
    }

    const systemCtx = { tenantId: ctx.tenantId, userId: 'system:keyword_detection' };
    const consentId = consent.id || String(consent._id);
    const reqMeta = { reason: `Detected inbound keyword: "${keyword}"` };

    if (isOptOut) {
      await consentService.optOut(systemCtx, consentId, { optOutMethod: 'STOP', reason: reqMeta.reason });
    } else {
      await consentService.optIn(systemCtx, consentId, { optInMethod: 'WHATSAPP', consentSource: 'WHATSAPP', reason: reqMeta.reason });
    }
  } catch (err) {
    console.error(`[CONSENT_KEYWORD_DETECTION_FAILED] tenant=${ctx.tenantId} phone=${phoneNumber} keyword="${keyword}" error=${err.message}`);
  }
}