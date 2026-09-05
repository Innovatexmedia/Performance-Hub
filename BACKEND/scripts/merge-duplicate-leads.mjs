#!/usr/bin/env node
/**
 * =============================================================================
 * InnovateX Revenue OS — Duplicate Lead Merge Script
 * =============================================================================
 *
 * FILE: scripts/merge-duplicate-leads.mjs
 * RUN:  node scripts/merge-duplicate-leads.mjs --dry-run
 *       node scripts/merge-duplicate-leads.mjs
 *
 * WHY THIS EXISTS
 * ────────────────
 * A real bug (now fixed in metaWebhook.service.js / lead.repository.js's
 * findByWhatsAppNumber) created a duplicate Lead whenever an already-known
 * contact was archived and then texted again -- the lookup excluded
 * archived leads, so the webhook couldn't find the existing one and
 * created a brand-new duplicate for a number that already existed. That
 * code fix stops new duplicates; this script cleans up the ones already
 * sitting in the database.
 *
 * GROUPING: leads are grouped by (tenant, last 10 digits of phone/
 * whatsapp_number) -- the exact same matching rule lead.repository.js's
 * findByWhatsAppNumber uses, so this script's idea of "the same contact"
 * matches the app's own.
 *
 * SURVIVOR SELECTION (in order):
 *   1. Prefer a non-archived lead over an archived one (an active
 *      duplicate is more likely the one everything should already point
 *      to going forward).
 *   2. Among ties, prefer the one with a real last_contacted_at (more
 *      engagement history).
 *   3. Among remaining ties, the oldest (earliest created) -- likely the
 *      original record, before the duplicate appeared.
 *
 * WHAT GETS MERGED into the survivor:
 *   - tags (union, de-duplicated)
 *   - group_ids (union, de-duplicated)
 *   - Every collection below that references a Lead by id gets its
 *     reference REPOINTED to the survivor's id BEFORE the duplicate
 *     Lead documents are deleted, so nothing is orphaned:
 *     Conversation, Message, LeadActivity, LeadNote, Deal, Booking,
 *     Call, Payment, Qualification, NurtureEnrollment, WhatsAppConsent,
 *     WhatsAppDeliveryLogV2, EmailLog, WhatsAppContact.
 *
 * The duplicate Lead documents are deleted only after every reference to
 * them has been repointed -- never before.
 *
 * SAFE TO RE-RUN: idempotent -- a second run finds no remaining
 * duplicate groups and does nothing. Run with --dry-run first.
 * =============================================================================
 */

import mongoose from 'mongoose';
import dns from 'node:dns/promises';
dns.setServers(['1.1.1.1', '8.8.8.8']);

import connectDB from '../src/config/db.js';
import { Lead } from '../src/modules/leads/lead/lead.model.js';
import { Conversation } from '../src/modules/whatsapp/conversations/conversation.model.js';
import { Message } from '../src/modules/whatsapp/messages/message.model.js';
import { LeadActivity } from '../src/modules/leads/activities/activity.model.js';
import { LeadNote } from '../src/modules/leads/notes/note.model.js';
import { Deal } from '../src/modules/pipeline/deals/deal.model.js';
import { Booking } from '../src/modules/bookings/booking.model.js';
import { Call } from '../src/modules/calls/call.model.js';
import { Payment } from '../src/modules/payments/payment.model.js';
import { Qualification } from '../src/modules/qualification/qualification.model.js';
import { NurtureEnrollment } from '../src/modules/whatsapp/submodules/nurtures/nurtures.model.js';
import { Consent } from '../src/modules/whatsapp/submodules/consent/consent.model.js';
import { DeliveryLog } from '../src/modules/whatsapp/submodules/deliveryLogs/deliveryLogs.model.js';
import { EmailLog } from '../src/modules/email/emailLog.model.js';
import { WhatsAppContact } from '../src/modules/whatsapp/submodules/contacts/contacts.model.js';

const dryRun = process.argv.includes('--dry-run');

// { model, field, tenantField } for every collection that references a
// Lead by id. Both the reference field name AND the tenant-scoping field
// name vary by module (snake_case vs camelCase) -- confirmed against
// each .model.js individually rather than guessed.
const REFERENCING_COLLECTIONS = [
  { model: Conversation,      field: 'lead_id', tenantField: 'tenant_id' },
  { model: Message,           field: 'lead_id', tenantField: 'tenant_id' },
  { model: LeadActivity,      field: 'lead_id', tenantField: 'tenant_id' },
  { model: LeadNote,          field: 'lead_id', tenantField: 'tenant_id' },
  { model: Deal,              field: 'lead_id', tenantField: 'tenant_id' },
  { model: Booking,           field: 'lead_id', tenantField: 'tenant_id' },
  { model: Call,              field: 'lead_id', tenantField: 'tenant_id' },
  { model: Payment,           field: 'lead_id', tenantField: 'tenant_id' },
  { model: Qualification,     field: 'lead_id', tenantField: 'tenant_id' },
  { model: NurtureEnrollment, field: 'leadId',  tenantField: 'tenantId' },
  { model: Consent,           field: 'leadId',  tenantField: 'tenantId' },
  { model: DeliveryLog,       field: 'leadId',  tenantField: 'tenantId' },
  { model: EmailLog,          field: 'leadId',  tenantField: 'tenantId' },
  { model: WhatsAppContact,   field: 'leadId',  tenantField: 'tenantId' },
];

function last10Digits(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 6 ? digits.slice(-10) : null;
}

function pickSurvivor(leads) {
  const active = leads.filter((l) => !l.archived);
  const pool = active.length ? active : leads;

  const withContact = pool.filter((l) => l.last_contacted_at);
  const candidates = withContact.length ? withContact : pool;

  return [...candidates].sort((a, b) => new Date(a.createdAt || a.created_at || 0) - new Date(b.createdAt || b.created_at || 0))[0];
}

async function run() {
  await connectDB();
  console.log(`\n🔧 Duplicate lead merge starting${dryRun ? ' (DRY RUN -- no writes)' : ''}\n`);

  const allLeads = await Lead.find({}).select('_id tenant_id phone whatsapp_number tags group_ids archived last_contacted_at createdAt created_at').lean();
  console.log(`   ${allLeads.length} total leads loaded`);

  const groups = new Map(); // `${tenantId}::${last10}` -> [lead, lead, ...]
  for (const lead of allLeads) {
    const key10 = last10Digits(lead.whatsapp_number) || last10Digits(lead.phone);
    if (!key10) continue;
    const key = `${lead.tenant_id}::${key10}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(lead);
  }

  const duplicateGroups = [...groups.entries()].filter(([, leads]) => leads.length > 1);
  console.log(`   ${duplicateGroups.length} duplicate group(s) found\n`);

  const summary = { groupsMerged: 0, leadsDeleted: 0, referencesRepointed: 0, errors: 0 };

  for (const [key, leads] of duplicateGroups) {
    const [tenantId] = key.split('::');
    const survivor = pickSurvivor(leads);
    const duplicates = leads.filter((l) => String(l._id) !== String(survivor._id));

    const mergedTags = [...new Set(leads.flatMap((l) => l.tags || []))];
    const mergedGroupIds = [...new Set(leads.flatMap((l) => l.group_ids || []))];

    console.log(`  Group ${key}: survivor=${survivor._id} (archived=${!!survivor.archived}), merging ${duplicates.length} duplicate(s) [${duplicates.map((d) => d._id).join(', ')}]`);

    if (dryRun) continue;

    try {
      await Lead.updateOne({ _id: survivor._id }, { $set: { tags: mergedTags, group_ids: mergedGroupIds, archived: false } });

      for (const dup of duplicates) {
        for (const { model, field, tenantField } of REFERENCING_COLLECTIONS) {
          const result = await model.updateMany({ [tenantField]: tenantId, [field]: dup._id }, { $set: { [field]: survivor._id } });
          summary.referencesRepointed += result?.modifiedCount || 0;
        }
        await Lead.deleteOne({ _id: dup._id });
        summary.leadsDeleted += 1;
      }
      summary.groupsMerged += 1;
    } catch (err) {
      summary.errors += 1;
      console.error(`  ❌ Failed to merge group ${key}: ${err.message}`);
    }
  }

  console.log('\n✅ Merge complete.');
  console.log(`   Duplicate groups found:   ${duplicateGroups.length}`);
  console.log(`   Groups merged:            ${summary.groupsMerged}`);
  console.log(`   Duplicate leads deleted:  ${summary.leadsDeleted}`);
  console.log(`   References repointed:     ${summary.referencesRepointed}`);
  console.log(`   Errors:                   ${summary.errors}`);
  if (dryRun) console.log('\n   (dry run -- nothing was actually written; re-run without --dry-run to apply)');

  await mongoose.connection.close();
  process.exit(summary.errors ? 1 : 0);
}

run().catch(async (err) => {
  console.error('❌ Merge script crashed:', err);
  try { await mongoose.connection.close(); } catch { /* ignore */ }
  process.exit(1);
});
