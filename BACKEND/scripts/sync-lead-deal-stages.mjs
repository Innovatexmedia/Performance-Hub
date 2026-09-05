#!/usr/bin/env node
/**
 * =============================================================================
 * InnovateX Revenue OS — Sync Deal Stages to Match Lead Status
 * =============================================================================
 *
 * FILE: scripts/sync-lead-deal-stages.mjs
 * RUN:  node scripts/sync-lead-deal-stages.mjs --dry-run
 *       node scripts/sync-lead-deal-stages.mjs
 *
 * PURPOSE
 * ───────
 * Two real bugs (now fixed in code) meant a lead's status could advance
 * (Qualified, Won, ...) WITHOUT its pipeline deal moving with it,
 * whenever that lead didn't already have an open deal at the moment the
 * action ran:
 *   - qualification.service.js's applyResult() only ever ADVANCED an
 *     existing deal to 'Qualified' -- never created one if none existed.
 *   - payment.service.js's markPaid() had the identical gap for moving
 *     a deal to the paid/Won stage.
 * (booking.service.js and call.service.js already had the correct
 * create-or-advance pattern, so Booked Call / Call Completed were never
 * affected the same way.)
 *
 * Going forward, both are fixed at the source. This script is the
 * one-time catch-up for whatever's ALREADY out of sync because it went
 * through the buggy code path before today -- the exact symptom that
 * showed up as "24 Qualified on the Dashboard (real Lead.status), only
 * 1 Qualified on the Pipeline (Deal.stage)".
 *
 * WHAT THIS DOES
 * ──────────────
 * For every lead whose status maps to a pipeline stage (New, Qualified,
 * Booked, Call Completed, Proposal Sent, Won, Lost -- see
 * LEAD_STATUS_TO_STAGE below), finds that lead's most recent deal and
 * advances it to the matching stage -- but ONLY forward (by STAGE_ORDER
 * position), never backward, and NEVER touches a deal already at Won or
 * Lost (terminal -- a real outcome that already happened isn't
 * something a status-sync script should ever undo). If a lead has no
 * deal at all, creates one directly at the correct stage.
 *
 * WHAT THIS DELIBERATELY SKIPS
 * ─────────────────────────────
 * - Lead statuses with no pipeline-stage counterpart at all (Contacted,
 *   Ghosted) -- left alone, nothing to sync to.
 * - Nurture -- a deliberate side-track a rep chose to move a deal into
 *   by hand, not a forward-progression state; this script never assigns
 *   it and never treats a deal already there as "behind".
 * - Archived leads, and deals already at Won/Lost (see above).
 * =============================================================================
 */

import mongoose from 'mongoose';
import dns from 'dns';
dns.setServers(['1.1.1.1', '8.8.8.8']);

import connectDB from '../src/config/db.js';
import { Lead } from '../src/modules/leads/lead/lead.model.js';
import { Deal } from '../src/modules/pipeline/deals/deal.model.js';
import { STAGE_ORDER, STAGE_TO_LEAD_STATUS, STAGE_DEFAULT_PROBABILITY, CLOSED_STAGES } from '../src/modules/pipeline/deals/deal.constants.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

// Invert STAGE_TO_LEAD_STATUS (stage -> lead status) into the direction
// this script actually needs (lead status -> stage). Nurture is
// deliberately NOT included here even though it appears in the source
// map -- see file header.
const LEAD_STATUS_TO_STAGE = {};
for (const [stage, leadStatus] of Object.entries(STAGE_TO_LEAD_STATUS)) {
  if (stage === 'Nurture') continue;
  LEAD_STATUS_TO_STAGE[leadStatus] = stage;
}

async function run() {
  await connectDB();
  console.log(`\n🔧 Deal-stage sync starting${dryRun ? ' (DRY RUN -- no writes)' : ''}\n`);

  const summary = { leadsScanned: 0, dealsAdvanced: 0, dealsCreated: 0, alreadyInSync: 0, skippedTerminalOrUnmapped: 0, errors: 0 };

  const leads = await Lead.find({ archived: { $ne: true } }).lean();

  for (const lead of leads) {
    summary.leadsScanned += 1;

    const targetStage = LEAD_STATUS_TO_STAGE[lead.status];
    if (!targetStage) {
      summary.skippedTerminalOrUnmapped += 1;
      continue;
    }

    const deal = await Deal.findOne({
      tenant_id: String(lead.tenant_id),
      lead_id:   lead._id,
      archived:  false,
    }).sort({ created_at: -1 });

    if (!deal) {
      console.log(`  + creating "${targetStage}" deal for ${lead.name || lead.email || lead._id} (status: ${lead.status})`);
      if (!dryRun) {
        try {
          await Deal.create({
            tenant_id:        String(lead.tenant_id),
            lead_id:          lead._id,
            assigned_user_id: lead.assigned_user_id || null,
            title:            lead.name || lead.email || lead.phone || 'Lead',
            stage:            targetStage,
            probability:      STAGE_DEFAULT_PROBABILITY[targetStage] ?? 0,
            source:           lead.source || null,
            value:            lead.value || 0,
            stageHistory: [{ stage: targetStage, movedAt: new Date(), movedBy: 'system' }],
          });
        } catch (err) {
          summary.errors += 1;
          console.error(`  ❌ ${lead._id}: ${err.message}`);
          continue;
        }
      }
      summary.dealsCreated += 1;
      continue;
    }

    if (CLOSED_STAGES.includes(deal.stage)) {
      summary.skippedTerminalOrUnmapped += 1;
      continue;
    }

    const currentIndex = STAGE_ORDER.indexOf(deal.stage);
    const targetIndex  = STAGE_ORDER.indexOf(targetStage);

    if (targetIndex <= currentIndex) {
      summary.alreadyInSync += 1;
      continue;
    }

    console.log(`  → advancing ${lead.name || lead.email || lead._id}: "${deal.stage}" → "${targetStage}"`);
    if (!dryRun) {
      try {
        await Deal.updateOne(
          { _id: deal._id },
          {
            $set:  { stage: targetStage },
            $push: { stageHistory: { stage: targetStage, movedAt: new Date(), movedBy: 'system' } },
          },
        );
      } catch (err) {
        summary.errors += 1;
        console.error(`  ❌ ${lead._id}: ${err.message}`);
        continue;
      }
    }
    summary.dealsAdvanced += 1;
  }

  console.log('\n✅ Sync complete.');
  console.log(`   Leads scanned:                ${summary.leadsScanned}`);
  console.log(`   Deals advanced:                ${summary.dealsAdvanced}`);
  console.log(`   Deals created:                 ${summary.dealsCreated}`);
  console.log(`   Already in sync:               ${summary.alreadyInSync}`);
  console.log(`   Skipped (terminal/unmapped):   ${summary.skippedTerminalOrUnmapped}`);
  console.log(`   Errors:                        ${summary.errors}`);
  if (dryRun) console.log('\n   (dry run -- nothing was actually written; re-run without --dry-run to apply)');

  await mongoose.connection.close();
  process.exit(summary.errors ? 1 : 0);
}

run().catch(async (err) => {
  console.error('❌ Sync script crashed:', err);
  try { await mongoose.connection.close(); } catch { /* ignore */ }
  process.exit(1);
});
