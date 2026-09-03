/**
 * WhatsApp Consent — Lead sync service.
 *
 * WhatsAppConsent (this module) is the SINGLE SOURCE OF TRUTH for whether
 * a phone number may be messaged. Two legacy, denormalised fields on Lead
 * still exist and are read by other modules that pre-date this Consent
 * model:
 *
 *   - Lead.opt_out_status (boolean)         -- messageSender.js, Campaigns
 *                                               and Broadcasts audience
 *                                               queries, AI signal services
 *   - Lead.consent_status ('granted'|'pending'|'revoked') -- AI recommendation
 *                                               service
 *
 * Rather than rewrite every consumer to query WhatsAppConsent directly
 * (some of them, like the Campaigns/Broadcasts audience query, need a
 * fast indexed boolean across thousands of Leads -- a per-lead Consent
 * lookup there would be a real N+1), this service keeps those two Lead
 * fields as a derived, auto-synced projection of WhatsAppConsent.
 *
 * Every call site that actually SENDS a message must still re-verify
 * against WhatsAppConsent directly at send time (see consentGuard.service.js)
 * -- the Lead fields are a fast pre-filter for building an audience, never
 * the final compliance gate.
 */
import { Lead } from '../../../leads/lead/lead.model.js';
import { Consent } from './consent.model.js';
import { CONSENT_STATUS } from './consent.constants.js';
import { normalizePhoneNumber, phoneVariants } from '../../../../shared/helpers/phone.helpers.js';

// Lead.consent_status's own enum (lead.constants.js) -- intentionally
// smaller/older than WhatsAppConsent's 5-state enum, so this is a
// many-to-one mapping.
const LEAD_CONSENT_STATUS = Object.freeze({
  GRANTED: 'granted',
  PENDING: 'pending',
  REVOKED: 'revoked',
});

/** Maps a WhatsAppConsent.status onto the two legacy Lead fields. */
export function projectConsentOntoLead(consentStatus) {
  switch (consentStatus) {
    case CONSENT_STATUS.OPTED_IN:
      return { opt_out_status: false, consent_status: LEAD_CONSENT_STATUS.GRANTED };
    case CONSENT_STATUS.OPTED_OUT:
    case CONSENT_STATUS.BLOCKED:
      return { opt_out_status: true, consent_status: LEAD_CONSENT_STATUS.REVOKED };
    case CONSENT_STATUS.EXPIRED:
      // Expired consent can't be relied on to send, but it isn't a
      // revocation either -- the contact needs a fresh opt-in, same as
      // PENDING. The real "can I send right now" answer never comes from
      // this boolean anyway (see consentGuard.service.js), so this only
      // affects how Campaigns/Broadcasts build their initial audience list.
      return { opt_out_status: true, consent_status: LEAD_CONSENT_STATUS.PENDING };
    case CONSENT_STATUS.PENDING:
    default:
      return { opt_out_status: false, consent_status: LEAD_CONSENT_STATUS.PENDING };
  }
}

/**
 * Retries an async operation with exponential backoff. Generic on
 * purpose -- consentGuard.service.js's read-side check reuses this same
 * helper so both directions of the sync (write Lead <- Consent, read
 * Consent at send time) share one retry policy instead of two
 * independently-tuned copies.
 */
export async function withRetry(fn, { attempts = 3, baseDelayMs = 150, label = 'operation' } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        console.warn(`[consentSync] ${label} failed (attempt ${attempt}/${attempts}), retrying in ${delay}ms: ${err.message}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastErr;
}

/**
 * Ensures a newly-created Lead has a WhatsAppConsent record, so it is
 * never blocked from receiving a message purely because "no record
 * exists yet". This mirrors how AiSensy/WATI/Interakt-style platforms
 * actually behave: importing or adding a contact makes them immediately
 * sendable (the business is trusted to have already obtained real
 * consent, e.g. at signup/checkout/an ad click) -- the PLATFORM's real
 * compliance job is honouring an explicit opt-out afterwards
 * (handleInboundKeyword / the manual Consent tab), not gatekeeping
 * opt-in before every send.
 *
 * Idempotent: safe to call even if a record already exists (e.g. this
 * lead's phone number was already opted out from a previous
 * relationship) -- an existing record is never overwritten, so a
 * genuine prior opt-out is never silently reset to OPTED_IN just
 * because a new Lead document referencing the same number was created.
 *
 * Best-effort by design (same reasoning as syncLeadFromConsent): a
 * transient DB error here must never fail Lead creation itself. The
 * reconciliation job's Consent-driven scan won't create a MISSING
 * record on its own (it only fixes drift on existing ones), so a
 * failure here really would leave a gap -- retried before giving up,
 * and logged loudly (not just swallowed) so it's actually noticed.
 */
export async function ensureConsentForLead(tenantId, lead, { source = 'IMPORT' } = {}) {
  const rawPhone = lead?.whatsapp_number || lead?.phone;
  if (!rawPhone) return;
  const phoneNumber = normalizePhoneNumber(rawPhone);

  try {
    await withRetry(async () => {
      let consent = await Consent.findOne({ tenantId, phoneNumber });
      if (consent) return; // never clobber a real, pre-existing consent state

      try {
        consent = await Consent.create({
          tenantId,
          leadId: lead._id,
          phoneNumber,
          leadName: lead.name || '',
          status: CONSENT_STATUS.OPTED_IN,
          consentSource: source,
          consentedAt: new Date(),
          history: [{
            previousStatus: null,
            newStatus: CONSENT_STATUS.OPTED_IN,
            action: 'CREATE',
            reason: 'Auto-created on lead creation (platform trusts the business already captured real consent)',
            performedBy: 'system:lead_creation',
            performedAt: new Date(),
          }],
          createdBy: 'system:lead_creation',
          updatedBy: 'system:lead_creation',
        });
      } catch (err) {
        // Duplicate key (E11000) means a concurrent request/race already
        // created it a moment ago -- fetch what won the race instead of
        // treating this as a real failure.
        if (err.code !== 11000) throw err;
        consent = await Consent.findOne({ tenantId, phoneNumber });
      }

      // Without this, the Lead document sits at its schema defaults
      // (consent_status: 'pending', opt_out_status: false is actually
      // fine, but consent_status being stuck on 'pending' while Consent
      // already says OPTED_IN is a real, if temporary, inconsistency)
      // until the next reconciliation tick fixes it -- up to 15 minutes
      // later. Immediate here since we already have the document.
      if (consent) await syncLeadFromConsent(tenantId, consent);
    }, { label: `ensure Consent for new lead ${phoneNumber}` });
  } catch (err) {
    console.error(`[CONSENT_AUTO_CREATE_FAILED] tenant=${tenantId} phone=${phoneNumber} -- new lead has NO consent record and will be blocked from sending until this is fixed manually or by the next reconciliation pass: ${err.message}`);
  }
}

/**
 * Pushes one Consent record's status onto every Lead sharing its phone
 * number (matched against BOTH whatsapp_number and phone -- a lead may
 * have been created before whatsapp_number was captured separately).
 *
 * Best-effort: retried with backoff, but a final failure is swallowed
 * and logged rather than thrown -- the Consent transition itself (the
 * legally significant part: an opt-out was recorded, with an audit
 * trail entry) must never be rolled back just because this denormalised
 * projection couldn't be written this one time. The reconciliation job
 * (consentReconciliation.job.js) is the safety net that catches any
 * lead this leaves out of sync.
 */
export async function syncLeadFromConsent(tenantId, consent) {
  if (!consent?.phoneNumber) return;
  const fields = projectConsentOntoLead(consent.status);
  // consent.phoneNumber is already canonical (schema setter normalizes
  // it on save) -- Lead.phone/whatsapp_number may still be in whatever
  // raw shape they were originally entered/imported in, so match every
  // plausible variant rather than an exact string.
  const variants = phoneVariants(consent.phoneNumber);

  try {
    await withRetry(
      () => Lead.updateMany(
        {
          tenant_id: tenantId,
          $or: [{ whatsapp_number: { $in: variants } }, { phone: { $in: variants } }],
        },
        { $set: fields },
      ),
      { label: `sync Lead <- Consent ${consent.phoneNumber}` },
    );
  } catch (err) {
    // Logged with a distinct, greppable tag -- an ops dashboard or log
    // alert can watch for this specifically, and the reconciliation job
    // will fix the actual data on its next tick regardless.
    console.error(`[CONSENT_SYNC_FAILED] tenant=${tenantId} phone=${consent.phoneNumber} target=${JSON.stringify(fields)} error=${err.message}`);
  }
}

/**
 * Reconciliation pass -- finds every Lead whose opt_out_status/consent_status
 * doesn't match what its WhatsAppConsent record says, and fixes it.
 * Safety net for: a syncLeadFromConsent() write that exhausted retries,
 * a Lead created/imported after its Consent record already existed,
 * or any future code path that changes Consent without going through
 * consent.service.js's transition helpers.
 *
 * Runs across ALL tenants in one pass, driven off Consent (not off a
 * tenant list) -- Consent is the source of truth, so scanning outward
 * from it is the natural direction. Processes in batches via a cursor
 * so this stays safe to run on a large collection without loading it
 * all into memory.
 *
 * Returns { scanned, fixed, failed } for the caller (cron job / manual
 * invocation) to log.
 */
export async function reconcileAll({ batchSize = 500 } = {}) {
  let scanned = 0;
  let fixed = 0;
  let failed = 0;

  const cursor = Consent.find({}).lean().cursor({ batchSize });

  for await (const consent of cursor) {
    scanned += 1;
    const expected = projectConsentOntoLead(consent.status);
    const variants = phoneVariants(consent.phoneNumber);

    try {
      const result = await withRetry(
        () => Lead.updateMany(
          {
            tenant_id: consent.tenantId,
            // Two separate $or clauses (which phone field matches; which
            // field is stale) combined with $and -- a single object can't
            // hold two '$or' keys, the second would silently clobber the
            // first if written naively.
            $and: [
              { $or: [{ whatsapp_number: { $in: variants } }, { phone: { $in: variants } }] },
              { $or: [
                { opt_out_status: { $ne: expected.opt_out_status } },
                { consent_status: { $ne: expected.consent_status } },
              ] },
            ],
          },
          { $set: expected },
        ),
        { attempts: 2, label: `reconcile ${consent.tenantId}/${consent.phoneNumber}` },
      );
      if (result.modifiedCount > 0) fixed += result.modifiedCount;
    } catch (err) {
      failed += 1;
      console.error(`[CONSENT_RECONCILE_FAILED] tenant=${consent.tenantId} phone=${consent.phoneNumber} error=${err.message}`);
    }
  }

  return { scanned, fixed, failed };
}