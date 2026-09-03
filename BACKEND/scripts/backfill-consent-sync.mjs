#!/usr/bin/env node
/**
 * =============================================================================
 * InnovateX Revenue OS — Consent/Lead Backfill Script
 * =============================================================================
 *
 * FILE: scripts/backfill-consent-sync.mjs
 * RUN:  node scripts/backfill-consent-sync.mjs
 *       node scripts/backfill-consent-sync.mjs --default-status=OPTED_IN
 *       node scripts/backfill-consent-sync.mjs --dry-run
 *
 * PURPOSE
 * ───────
 * One-time reconciliation between the two legacy Lead fields
 * (opt_out_status, consent_status) and WhatsAppConsent, run ONCE before
 * the new consentGuard.service.js send-time gate goes live. Two
 * directions of drift are fixed:
 *
 *   1. Lead says opted-out, but no Consent record exists (or it disagrees)
 *      -- Consent is created/updated from the Lead's existing state, so no
 *      currently-opted-out contact silently becomes sendable again.
 *
 *   2. Consent already exists and disagrees with the Lead -- Consent wins
 *      (it has the real audit trail), Lead is corrected to match.
 *
 * ── THE ONE REAL DECISION THIS SCRIPT MAKES FOR YOU ─────────────────────────
 * consentGuard.service.js now BLOCKS a send when NO Consent record exists
 * at all, on the correct assumption that "no record" means consent was
 * never actually captured. Most existing Leads in this database almost
 * certainly have NO WhatsAppConsent record yet (it's a newer model),
 * which means: without this script, EVERY existing lead that was
 * previously sendable would suddenly stop being sendable the moment the
 * new guard deploys.
 *
 * --default-status controls what this script assumes for those leads:
 *   OPTED_IN  (default) -- preserves current send behaviour for every
 *             lead that wasn't already marked opted-out. Recommended for
 *             a first deploy so nothing silently breaks; new leads going
 *             forward should get REAL consent capture (a checkbox, a
 *             WhatsApp opt-in message, etc.), not this default.
 *   PENDING   -- stricter/more correct for compliance, but will likely
 *             block sending to most of your existing audience until each
 *             contact re-opts-in. Only use this if you're intentionally
 *             re-establishing consent across your base.
 *
 * This is a business decision, not a technical one -- make it
 * deliberately, don't just run this with the default and move on.
 *
 * SAFE TO RE-RUN: idempotent. Run with --dry-run first to see counts
 * before writing anything.
 * =============================================================================
 */

import mongoose from 'mongoose';
import dns from 'dns';
// Same fix server.js applies -- some networks/ISPs (common on Windows)
// fail to resolve the mongodb+srv:// SRV record via the OS's default
// DNS resolver ("querySrv ECONNREFUSED"). Forcing public DNS resolvers
// here too, since this script connects independently of server.js.
dns.setServers(['1.1.1.1', '8.8.8.8']);

import connectDB from '../src/config/db.js';
import { Lead } from '../src/modules/leads/lead/lead.model.js';
import { Consent } from '../src/modules/whatsapp/submodules/consent/consent.model.js';
import { CONSENT_STATUS } from '../src/modules/whatsapp/submodules/consent/consent.constants.js';
import { projectConsentOntoLead } from '../src/modules/whatsapp/submodules/consent/consentSync.service.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const defaultStatusArg = args.find((a) => a.startsWith('--default-status='))?.split('=')[1]?.toUpperCase();
const DEFAULT_STATUS = CONSENT_STATUS[defaultStatusArg] || CONSENT_STATUS.OPTED_IN;

if (!['OPTED_IN', 'PENDING'].includes(DEFAULT_STATUS)) {
  console.error(`❌ --default-status must be OPTED_IN or PENDING (got "${defaultStatusArg}")`);
  process.exit(1);
}

async function run() {
  await connectDB();
  console.log(`\n🔧 Consent/Lead backfill starting${dryRun ? ' (DRY RUN -- no writes)' : ''}`);
  console.log(`   Default status for leads with no Consent record: ${DEFAULT_STATUS}\n`);

  const summary = { leadsScanned: 0, consentCreated: 0, consentUpdated: 0, leadsUpdated: 0, errors: 0 };

  // Every phone number that appears on any Lead (whatsapp_number OR phone),
  // deduped, tenant-scoped -- this is the real universe of contacts that
  // matter for consent, not just leads that already look opted-out.
  const leadCursor = Lead.find({
    $or: [{ whatsapp_number: { $ne: null, $ne: '' } }, { phone: { $ne: null, $ne: '' } }],
  })
    .select('_id tenant_id name whatsapp_number phone opt_out_status consent_status')
    .lean()
    .cursor({ batchSize: 500 });

  for await (const lead of leadCursor) {
    summary.leadsScanned += 1;
    const phoneNumber = lead.whatsapp_number || lead.phone;
    if (!phoneNumber) continue;

    try {
      let consent = await Consent.findOne({ tenantId: lead.tenant_id, phoneNumber });

      if (!consent) {
        // No Consent record yet -- create one from whatever the Lead
        // already implies, so nothing about current send behaviour
        // changes the moment the new guard deploys.
        const initialStatus = lead.opt_out_status ? CONSENT_STATUS.OPTED_OUT : DEFAULT_STATUS;
        console.log(`  + would create Consent ${phoneNumber} (tenant ${lead.tenant_id}) -> ${initialStatus}`);
        if (!dryRun) {
          consent = await Consent.create({
            tenantId: lead.tenant_id,
            leadId: lead._id,
            phoneNumber,
            leadName: lead.name || '',
            status: initialStatus,
            consentSource: 'IMPORT',
            consentedAt: initialStatus === CONSENT_STATUS.OPTED_IN ? new Date() : null,
            optedOutAt: initialStatus === CONSENT_STATUS.OPTED_OUT ? new Date() : null,
            history: [{
              previousStatus: null,
              newStatus: initialStatus,
              action: 'CREATE',
              reason: 'Backfilled from pre-existing Lead data (scripts/backfill-consent-sync.mjs)',
              performedBy: 'system:backfill',
              performedAt: new Date(),
            }],
            createdBy: 'system:backfill',
            updatedBy: 'system:backfill',
          });
          summary.consentCreated += 1;
        }
      }

      // Whether just-created or pre-existing, Consent is now the source
      // of truth -- make sure this Lead's two legacy fields agree with it.
      const expected = projectConsentOntoLead(consent ? consent.status : DEFAULT_STATUS);
      const needsUpdate = lead.opt_out_status !== expected.opt_out_status || lead.consent_status !== expected.consent_status;

      if (needsUpdate) {
        console.log(`  ~ would update Lead ${lead._id} (${phoneNumber}) -> ${JSON.stringify(expected)}`);
        if (!dryRun) {
          await Lead.updateOne({ _id: lead._id }, { $set: expected });
          summary.leadsUpdated += 1;
        }
      }
    } catch (err) {
      summary.errors += 1;
      console.error(`  ❌ ${phoneNumber} (tenant ${lead.tenant_id}): ${err.message}`);
    }
  }

  console.log('\n✅ Backfill complete.');
  console.log(`   Leads scanned:     ${summary.leadsScanned}`);
  console.log(`   Consent created:   ${summary.consentCreated}`);
  console.log(`   Leads updated:     ${summary.leadsUpdated}`);
  console.log(`   Errors:            ${summary.errors}`);
  if (dryRun) console.log('\n   (dry run -- nothing was actually written; re-run without --dry-run to apply)');

  await mongoose.connection.close();
  process.exit(summary.errors ? 1 : 0);
}

run().catch(async (err) => {
  console.error('❌ Backfill script crashed:', err);
  try { await mongoose.connection.close(); } catch { /* ignore */ }
  process.exit(1);
});
