#!/usr/bin/env node
/**
 * =============================================================================
 * InnovateX Revenue OS — Consent Duplicate-Number Merge Script
 * =============================================================================
 *
 * FILE: scripts/dedupe-consent-numbers.mjs
 * RUN:  node scripts/dedupe-consent-numbers.mjs --dry-run
 *       node scripts/dedupe-consent-numbers.mjs
 *
 * PURPOSE
 * ───────
 * Before phone-number normalization existed (see shared/helpers/phone.helpers.js),
 * the SAME real phone number could get separate Consent records depending
 * on how it entered the system -- e.g. "8660898992" (manually typed, no
 * country code) and "918660898992" (WhatsApp-inbound, already has one).
 * These look like two different contacts in the Consent tab, and worse:
 * an opt-out recorded against one variant does NOT protect the other.
 *
 * This script finds every such group (same tenant, same number once
 * normalized) and merges them into ONE record:
 *
 *   - Merged status is the MOST RESTRICTIVE across the group (BLOCKED >
 *     OPTED_OUT > EXPIRED > PENDING > OPTED_IN). If ANY duplicate says
 *     this person opted out, the merged record opts out -- safety wins,
 *     never averaged or "most recent wins" (a stale OPTED_IN duplicate
 *     must never overrule a real opt-out recorded on the other one).
 *   - All history entries from every duplicate are combined into one
 *     chronological audit trail on the survivor -- nothing is discarded.
 *   - The survivor's phoneNumber is set to the canonical normalized form.
 *   - The other duplicate(s) are deleted.
 *   - Lead.opt_out_status/consent_status are re-synced immediately for
 *     the merged number (not left for the next reconciliation tick).
 *
 * SAFE TO RE-RUN: idempotent -- a second run finds no remaining
 * duplicates and does nothing. Run with --dry-run first.
 * =============================================================================
 */

import mongoose from 'mongoose';
import dns from 'dns';
dns.setServers(['1.1.1.1', '8.8.8.8']);

import connectDB from '../src/config/db.js';
import { Consent } from '../src/modules/whatsapp/submodules/consent/consent.model.js';
import { CONSENT_STATUS } from '../src/modules/whatsapp/submodules/consent/consent.constants.js';
import { normalizePhoneNumber } from '../src/shared/helpers/phone.helpers.js';
import { syncLeadFromConsent } from '../src/modules/whatsapp/submodules/consent/consentSync.service.js';

const dryRun = process.argv.includes('--dry-run');

// Highest number = most restrictive = wins when merging duplicates.
const STATUS_PRIORITY = {
  [CONSENT_STATUS.BLOCKED]:   4,
  [CONSENT_STATUS.OPTED_OUT]: 3,
  [CONSENT_STATUS.EXPIRED]:   2,
  [CONSENT_STATUS.PENDING]:   1,
  [CONSENT_STATUS.OPTED_IN]:  0,
};

function mostRestrictiveStatus(docs) {
  return docs.reduce((winner, doc) => (
    STATUS_PRIORITY[doc.status] > STATUS_PRIORITY[winner] ? doc.status : winner
  ), CONSENT_STATUS.OPTED_IN);
}

async function run() {
  await connectDB();
  console.log(`\n🔧 Consent duplicate-number merge starting${dryRun ? ' (DRY RUN -- no writes)' : ''}\n`);

  const all = await Consent.find({}).lean();
  console.log(`   ${all.length} total Consent records loaded`);

  // Group by (tenantId, canonical phone number).
  const groups = new Map();
  for (const doc of all) {
    const key = `${doc.tenantId}::${normalizePhoneNumber(doc.phoneNumber)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc);
  }

  const duplicateGroups = [...groups.entries()].filter(([, docs]) => docs.length > 1);
  console.log(`   ${duplicateGroups.length} duplicate group(s) found\n`);

  const summary = { groupsMerged: 0, recordsDeleted: 0, errors: 0 };

  for (const [key, docs] of duplicateGroups) {
    const [tenantId, canonicalPhone] = key.split('::');
    const mergedStatus = mostRestrictiveStatus(docs);

    // Survivor: prefer whichever duplicate already has the canonical
    // phone format stored (fewest changes), else the oldest record
    // (earliest createdAt) so its _id -- and anything else referencing
    // it -- stays stable.
    const survivor = docs.find((d) => d.phoneNumber === canonicalPhone)
      || [...docs].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
    const losers = docs.filter((d) => String(d._id) !== String(survivor._id));

    const mergedHistory = docs
      .flatMap((d) => d.history || [])
      .sort((a, b) => new Date(a.performedAt) - new Date(b.performedAt));

    mergedHistory.push({
      previousStatus: survivor.status,
      newStatus: mergedStatus,
      action: 'MERGE',
      reason: `Merged ${docs.length} duplicate records for the same number in different formats (${docs.map((d) => d.phoneNumber).join(', ')}) -- scripts/dedupe-consent-numbers.mjs`,
      performedBy: 'system:dedupe_migration',
      performedAt: new Date(),
    });

    console.log(`  Group ${canonicalPhone} (tenant ${tenantId}): ${docs.map((d) => `${d.phoneNumber}=${d.status}`).join(', ')} -> merged status ${mergedStatus}, survivor ${survivor._id}, deleting ${losers.length} duplicate(s)`);

    if (dryRun) continue;

    try {
      await Consent.updateOne(
        { _id: survivor._id },
        { $set: { phoneNumber: canonicalPhone, status: mergedStatus, history: mergedHistory, updatedBy: 'system:dedupe_migration' } },
      );
      if (losers.length) {
        await Consent.deleteMany({ _id: { $in: losers.map((d) => d._id) } });
        summary.recordsDeleted += losers.length;
      }

      const updatedSurvivor = await Consent.findById(survivor._id);
      await syncLeadFromConsent(tenantId, updatedSurvivor);

      summary.groupsMerged += 1;
    } catch (err) {
      summary.errors += 1;
      console.error(`  ❌ Failed to merge group ${canonicalPhone} (tenant ${tenantId}): ${err.message}`);
    }
  }

  console.log('\n✅ Dedupe complete.');
  console.log(`   Duplicate groups found:  ${duplicateGroups.length}`);
  console.log(`   Groups merged:           ${summary.groupsMerged}`);
  console.log(`   Duplicate records deleted: ${summary.recordsDeleted}`);
  console.log(`   Errors:                  ${summary.errors}`);
  if (dryRun) console.log('\n   (dry run -- nothing was actually written; re-run without --dry-run to apply)');

  await mongoose.connection.close();
  process.exit(summary.errors ? 1 : 0);
}

run().catch(async (err) => {
  console.error('❌ Dedupe script crashed:', err);
  try { await mongoose.connection.close(); } catch { /* ignore */ }
  process.exit(1);
});
