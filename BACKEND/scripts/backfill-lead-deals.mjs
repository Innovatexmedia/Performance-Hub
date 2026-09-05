#!/usr/bin/env node
/**
 * =============================================================================
 * InnovateX Revenue OS — Backfill Pipeline Deals for Existing Leads
 * =============================================================================
 *
 * FILE: scripts/backfill-lead-deals.mjs
 * RUN:  node scripts/backfill-lead-deals.mjs --dry-run
 *       node scripts/backfill-lead-deals.mjs
 *
 * PURPOSE
 * ───────
 * Every NEW lead now automatically gets a "New Lead" stage deal the
 * moment it's created (see pipeline/deals/deal.service.js's listener on
 * the LEAD_CREATED event). That only fires going forward -- it cannot
 * retroactively do anything for leads that already existed before that
 * fix was deployed, which is exactly why the Pipeline can still show
 * far fewer deals than actual leads even after the fix is live. This is
 * the one-time catch-up for those pre-existing leads.
 *
 * WHAT THIS DOES
 * ──────────────
 * For every non-archived lead that has NO open deal (same "open" test
 * booking.service.js already uses: not archived, stage not Won/Lost),
 * creates one via dealService.createDeal -- the exact same function and
 * field-mapping the LEAD_CREATED listener uses, so a backfilled lead's
 * deal looks identical to one that would have been auto-created at
 * signup time. Stage is always 'New Lead' -- this deliberately does NOT
 * try to guess a "should already be further along" stage from the
 * lead's current status (e.g. a lead marked Qualified doesn't
 * automatically get a Qualified-stage deal here); that inference is
 * exactly the kind of silent, unreviewable guess a migration script
 * should not make on live business data. Leads already reflecting real
 * progress (booked, qualified, etc.) got their own correctly-staged
 * deal already, from whichever action produced that progress -- SKIPPED
 * here because they already have an open deal by definition.
 *
 * WHAT THIS DOES NOT TOUCH
 * ────────────────────────
 * - Archived leads (skipped entirely -- an archived lead was
 *   deliberately taken out of active consideration; resurrecting it
 *   into the Pipeline would undo that).
 * - Leads that already have an open deal (skipped -- prevents ever
 *   creating a duplicate for a lead someone already progressed).
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
import { Deal } from '../src/modules/pipeline/deals/deal.model.js';
import { dealService } from '../src/modules/pipeline/deals/deal.service.js';
import { DEAL_STAGE, CLOSED_STAGES } from '../src/modules/pipeline/deals/deal.constants.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

async function run() {
  await connectDB();
  console.log(`\n🔧 Lead → Deal backfill starting${dryRun ? ' (DRY RUN -- no writes)' : ''}\n`);

  const summary = { leadsScanned: 0, dealsCreated: 0, alreadyHadDeal: 0, skippedArchived: 0, errors: 0 };

  const leads = await Lead.find({}).lean();

  for (const lead of leads) {
    summary.leadsScanned += 1;

    if (lead.archived) {
      summary.skippedArchived += 1;
      continue;
    }

    const openDeal = await Deal.findOne({
      tenant_id: String(lead.tenant_id),
      lead_id:   lead._id,
      archived:  false,
      stage:     { $nin: CLOSED_STAGES },
    });

    if (openDeal) {
      summary.alreadyHadDeal += 1;
      continue;
    }

    console.log(`  + creating "New Lead" deal for ${lead.name || lead.email || lead.phone || lead._id}`);
    if (!dryRun) {
      try {
        await dealService.createDeal(
          { tenantId: lead.tenant_id, userId: lead.assigned_user_id || 'system' },
          {
            lead_id:          lead._id,
            title:            lead.name || lead.email || lead.phone || 'New Lead',
            stage:            DEAL_STAGE.NEW_LEAD,
            value:            lead.value || 0,
            source:           lead.source || null,
            assigned_user_id: lead.assigned_user_id || null,
          },
        );
        summary.dealsCreated += 1;
      } catch (err) {
        summary.errors += 1;
        console.error(`  ❌ ${lead._id}: ${err.message}`);
      }
    } else {
      summary.dealsCreated += 1; // counted for the dry-run preview total
    }
  }

  console.log('\n✅ Backfill complete.');
  console.log(`   Leads scanned:       ${summary.leadsScanned}`);
  console.log(`   Deals created:       ${summary.dealsCreated}`);
  console.log(`   Already had a deal:  ${summary.alreadyHadDeal}`);
  console.log(`   Skipped (archived):  ${summary.skippedArchived}`);
  console.log(`   Errors:              ${summary.errors}`);
  if (dryRun) console.log('\n   (dry run -- nothing was actually written; re-run without --dry-run to apply)');

  await mongoose.connection.close();
  process.exit(summary.errors ? 1 : 0);
}

run().catch(async (err) => {
  console.error('❌ Backfill script crashed:', err);
  try { await mongoose.connection.close(); } catch { /* ignore */ }
  process.exit(1);
});
