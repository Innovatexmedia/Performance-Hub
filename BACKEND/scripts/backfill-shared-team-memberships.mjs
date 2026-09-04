#!/usr/bin/env node
/**
 * =============================================================================
 * InnovateX Revenue OS — Shared-Team Membership Backfill Script
 * =============================================================================
 *
 * FILE: scripts/backfill-shared-team-memberships.mjs
 * RUN:  node scripts/backfill-shared-team-memberships.mjs --dry-run
 *       node scripts/backfill-shared-team-memberships.mjs
 *
 * PURPOSE
 * ───────
 * Team membership is now shared across every workspace on an account,
 * not siloed to the single workspace someone was originally invited
 * into (see team.service.js's getAccountTenantIds comment for the full
 * reasoning, and invitation.service.js's acceptInvitation for where
 * NEW invitations already get this automatically going forward).
 *
 * This is the ONE-TIME catch-up for everyone who was already active
 * BEFORE that change existed. Without this, an existing team member
 * would correctly show up in every workspace's Team list (that part is
 * just a query, no data migration needed), but wouldn't actually be
 * ABLE to switch into a sibling workspace -- switchWorkspace() checks
 * for a real ACTIVE Membership row, and this script is what creates
 * the ones that are missing.
 *
 * WHAT THIS DOES NOT TOUCH
 * ────────────────────────
 * - Doesn't change anyone's PRIMARY tenantId (their "home" workspace
 *   stays whatever it already was).
 * - Doesn't touch pending/inactive/deleted users -- only users with
 *   status ACTIVE get backfilled, matching who's actually a real,
 *   already-onboarded team member today.
 * - Doesn't duplicate or overwrite an existing Membership row for a
 *   tenant they already have one for (upsert, keyed on userId+tenantId).
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
import User from '../src/modules/auth/models/User.js';
import Tenant from '../src/modules/auth/models/Tenant.js';
import Membership, { MEMBERSHIP_STATUS } from '../src/modules/auth/models/Membership.js';
import { USER_STATUS } from '../src/modules/auth/constants/auth.constants.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

async function run() {
  await connectDB();
  console.log(`\n🔧 Shared-team Membership backfill starting${dryRun ? ' (DRY RUN -- no writes)' : ''}\n`);

  const summary = { usersScanned: 0, membershipsCreated: 0, membershipsAlreadyOk: 0, errors: 0 };

  // Every currently-active user with a home tenant -- pending invites,
  // deactivated, and already-deleted users are deliberately excluded
  // (see file header).
  const users = await User.find({ status: USER_STATUS.ACTIVE, tenantId: { $ne: null } });

  for (const user of users) {
    summary.usersScanned += 1;
    try {
      const homeTenant = await Tenant.findById(user.tenantId);
      if (!homeTenant?.accountId) continue; // not on a shared-billing account -- nothing to backfill

      const siblingTenants = await Tenant.find({ accountId: homeTenant.accountId });
      const otherTenantIds = siblingTenants
        .map((t) => t._id)
        .filter((id) => String(id) !== String(user.tenantId));

      for (const siblingTenantId of otherTenantIds) {
        const existing = await Membership.findOne({ userId: user._id, tenantId: siblingTenantId });
        if (existing?.status === MEMBERSHIP_STATUS.ACTIVE) {
          summary.membershipsAlreadyOk += 1;
          continue;
        }

        console.log(`  + granting ${user.email} access to workspace ${siblingTenantId}`);
        if (!dryRun) {
          await Membership.updateOne(
            { userId: user._id, tenantId: siblingTenantId },
            {
              $set: { status: MEMBERSHIP_STATUS.ACTIVE, joinedAt: new Date() },
              $setOnInsert: { userId: user._id, tenantId: siblingTenantId, role: user.role },
            },
            { upsert: true }
          );
        }
        summary.membershipsCreated += 1;
      }
    } catch (err) {
      summary.errors += 1;
      console.error(`  ❌ ${user.email}: ${err.message}`);
    }
  }

  console.log('\n✅ Backfill complete.');
  console.log(`   Users scanned:            ${summary.usersScanned}`);
  console.log(`   Memberships created:      ${summary.membershipsCreated}`);
  console.log(`   Memberships already OK:   ${summary.membershipsAlreadyOk}`);
  console.log(`   Errors:                   ${summary.errors}`);
  if (dryRun) console.log('\n   (dry run -- nothing was actually written; re-run without --dry-run to apply)');

  await mongoose.connection.close();
  process.exit(summary.errors ? 1 : 0);
}

run().catch(async (err) => {
  console.error('❌ Backfill script crashed:', err);
  try { await mongoose.connection.close(); } catch { /* ignore */ }
  process.exit(1);
});
