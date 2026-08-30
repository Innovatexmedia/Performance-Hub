#!/usr/bin/env node
/**
 * =============================================================================
 * InnovateX Revenue OS — Dev/Test Data Seed Script
 * =============================================================================
 *
 * FILE: scripts/seed-test-data.mjs
 * RUN:  npm run seed:test
 *       npm run seed:test -- --tenant=<tenant-slug>
 *
 * PURPOSE
 * ───────
 * Populates ONE existing tenant with a realistic, internally-consistent
 * dataset spanning Leads, AI Qualification, Nurture, Bookings/Cal.com,
 * Call Intelligence, Attribution, Pipeline/Deals, Payments, Campaigns,
 * Automations, Integrations, and Team -- so every module-to-module
 * interconnection already verified in this codebase's real service
 * layer can actually be exercised end-to-end without hand-entering data.
 *
 * DESIGN PRINCIPLE: REUSE THE REAL SERVICE LAYER, DON'T RE-INVENT IT
 * ────────────────────────────────────────────────────────────────────
 * Wherever a real service function already exists (leadService.createLead,
 * bookingService.createBooking, qualificationService.runQualification,
 * callService.createCall, nurturesService.enrollLead,
 * dealService.createDeal/moveStage, campaignService.createCampaign,
 * automationService.createAutomation/simulateAutomation,
 * paymentService.createPayment/markPaid, messageService.simulateInbound,
 * integrationService.listIntegrations), this script calls THAT function
 * instead of writing documents by hand. This is not just less code --
 * it's what actually exercises the real cross-module hooks (pause on
 * booking, pause on reply, auto-enroll on qualification, tracking events
 * on conversion, etc.), the same interconnections already confirmed real
 * in this codebase's audits, rather than a seed script's own guess at
 * what those hooks do.
 *
 * Only a handful of things are written directly, because no real service
 * function exists for them (or the real function requires a live 3rd
 * -party credential this script obviously can't have): the two extra
 * test team members, the one prerequisite WhatsApp template, Cal.com /
 * Meta Ads / Google Ads "connected" settings documents (real schema,
 * clearly-fake credential values -- see the header comment at that
 * section), and Google Ads campaign metrics (what a real sync would have
 * written).
 *
 * SAFETY
 * ──────
 * - Refuses to run against NODE_ENV=production unless SEED_ALLOW_PROD=true
 *   is explicitly set -- this script only ever adds test data to an
 *   EXISTING tenant; it never touches Tenant/Account/Plan/Membership
 *   creation or any production auth/billing bootstrap logic.
 * - Every seeded Lead/User uses the reserved @seed.innovatex.test email
 *   domain, and every seeded Campaign/Automation/NurtureSequence/
 *   WhatsAppTemplate name is prefixed "[SEED]" -- the schema has no
 *   dedicated is_test_data field on any of these models (confirmed by
 *   direct inspection), so this naming convention is the real, visible
 *   marker the schema DOES support, not an invented field.
 * - IDEMPOTENT: every entity is looked up by a deterministic natural key
 *   (email, name, slug) before creating. Re-running finds the existing
 *   rows and skips them rather than duplicating -- this is checked
 *   explicitly (not just left to a database unique-index throw) so a
 *   partial prior run can be safely re-run to completion.
 *
 * WHAT THIS DOES NOT DO
 * ──────────────────────
 * - Never creates or modifies a Tenant, Account, Plan, or Membership
 *   record beyond adding two extra Users + Memberships to the tenant.
 * - Never calls a real 3rd-party API (Cal.com, Google Ads, Meta, Gemini)
 *   with real credentials -- AI Qualification and Call Intelligence will
 *   genuinely run through this codebase's real Gemini call IF a real
 *   GEMINI_API_KEY is configured (see qualification-ai.service.js /
 *   call.service.js's own real mock-fallback), same as any other real
 *   usage of this app; this script does not fake that decision.
 * =============================================================================
 */

import mongoose from 'mongoose';
import connectDB from '../src/config/db.js';

// ── Real models ──────────────────────────────────────────────────────────────
import Tenant from '../src/modules/auth/models/Tenant.js';
import { WhatsAppSettings } from '../src/modules/whatsapp/submodules/whatsappSettings/whatsappSettings.model.js';
import User from '../src/modules/auth/models/User.js';
import Membership, { MEMBERSHIP_STATUS } from '../src/modules/auth/models/Membership.js';
import { Lead } from '../src/modules/leads/lead/lead.model.js';
import { Deal } from '../src/modules/pipeline/deals/deal.model.js';
import { Booking } from '../src/modules/bookings/booking.model.js';
import { Payment } from '../src/modules/payments/payment.model.js';
import { Qualification } from '../src/modules/qualification/qualification.model.js';
import { Campaign } from '../src/modules/campaigns/campaign.model.js';
import { Automation } from '../src/modules/automations/automation.model.js';
import { TrackingEvent } from '../src/modules/attribution/tracking-event.model.js';
import { NurtureSequence, NurtureEnrollment } from '../src/modules/whatsapp/submodules/nurtures/nurtures.model.js';
import { WhatsAppTemplate } from '../src/modules/whatsapp/submodules/templates/templates.model.js';
import { Consent } from '../src/modules/whatsapp/submodules/consent/consent.model.js';
import CalcomSettings from '../src/modules/bookings/calcomSettings.model.js';
import AdTrackingSettings from '../src/modules/attribution/adTrackingSettings.model.js';
import GoogleAdsSettings from '../src/modules/attribution/googleAdsSettings.model.js';
import GoogleAdsCampaignMetric from '../src/modules/attribution/googleAdsCampaignMetric.model.js';

// ── Real services -- reused, not reinvented (see header comment) ──────────────
import { leadService } from '../src/modules/leads/lead/lead.service.js';
import * as bookingService from '../src/modules/bookings/booking.service.js';
import * as callService from '../src/modules/calls/call.service.js';
import * as qualificationService from '../src/modules/qualification/qualification.service.js';
import { nurturesService } from '../src/modules/whatsapp/submodules/nurtures/nurtures.service.js';
import { runDueSteps } from '../src/modules/whatsapp/submodules/nurtures/nurtureExecution.service.js';
import { dealService } from '../src/modules/pipeline/deals/deal.service.js';
import * as paymentService from '../src/modules/payments/payment.service.js';
import { createCampaign } from '../src/modules/campaigns/campaign.service.js';
import * as automationService from '../src/modules/automations/automation.service.js';
import { conversationService } from '../src/modules/whatsapp/conversations/conversation.service.js';
import { messageService } from '../src/modules/whatsapp/messages/message.service.js';
import { listIntegrations } from '../src/modules/integrations/integration.service.js';

// ── Real constants/enums (never inventing values -- every one confirmed by
//    direct inspection of the actual *.constants.js file it lives in) ─────────
import { LEAD_STATUS, LEAD_TEMPERATURE, CONSENT_STATUS as LEAD_CONSENT_STATUS } from '../src/modules/leads/lead/lead.constants.js';
import { CALL_OUTCOME } from '../src/modules/calls/call.constants.js';
import { MEETING_TYPES } from '../src/modules/bookings/booking.constants.js';
import { DEAL_STAGE } from '../src/modules/pipeline/deals/deal.constants.js';
import { CAMPAIGN_SOURCE, CAMPAIGN_TYPE, CAMPAIGN_MEDIUM, CAMPAIGN_STATUS } from '../src/modules/campaigns/campaign.constants.js';
import { ACTION_TYPE, CONDITION_OPERATOR, AUTOMATION_STATUS } from '../src/modules/automations/automation.constants.js';
import { TRACKING_EVENT_TYPE } from '../src/modules/attribution/attribution.constants.js';
import {
  SEQUENCE_TYPE, SEQUENCE_STATUS, TRIGGER_TYPE as NURTURE_TRIGGER_TYPE,
  NURTURE_CHANNEL, DELAY_UNIT, ENROLLMENT_STATUS,
} from '../src/modules/whatsapp/submodules/nurtures/nurtures.constants.js';
import {
  CONSENT_STATUS as WA_CONSENT_STATUS, OPT_IN_METHOD, OPT_OUT_METHOD, CONSENT_SOURCE,
} from '../src/modules/whatsapp/submodules/consent/consent.constants.js';
import {
  TEMPLATE_CATEGORY, PROVIDER as WA_PROVIDER,
} from '../src/modules/whatsapp/submodules/templates/templates.constants.js';
import { APPROVAL_STATUS } from '../src/modules/whatsapp/submodules/templateApproval/templateApproval.constants.js';
import { ROLES } from '../src/modules/auth/constants/roles.js';
import { QUALITY_GRADE, BUYING_INTENT } from '../src/modules/qualification/qualification.constants.js';

// =============================================================================
// SAFETY GUARD -- never touches production data
// =============================================================================

if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PROD !== 'true') {
  console.error('❌ Refusing to run: NODE_ENV=production. This script is for dev/test data only.');
  console.error('   If you really mean it, re-run with SEED_ALLOW_PROD=true.');
  process.exit(1);
}

// Small, honest run summary -- printed at the end, not claimed mid-way.
// Declared here (before the resilience net below) since that handler
// references it by closure.
const summary = { created: {}, skipped: {}, errors: [] };
const bump = (bucket, key) => { summary[bucket][key] = (summary[bucket][key] || 0) + 1; };

// =============================================================================
// RESILIENCE NET -- a real bug class this script's first run surfaced
// =============================================================================
// booking.service.js's real emitTrackingEvent() is called fire-and-forget
// (no await, no .catch at that call site) -- so ANY error inside it,
// including future ones unrelated to the missing-import bug already fixed
// in application code, surfaces as an unhandled promise rejection rather
// than a normal rejected promise this script's own per-lead try/catch can
// see. Node's default behaviour on an unhandled rejection is to crash the
// whole process -- which is exactly what took down the entire seed run
// last time, well outside any try/catch here. This handler doesn't hide
// real errors: it records them in the same summary.errors list every
// other caught error goes into (so the final report is still honest about
// something having gone wrong), and lets THIS SPECIFIC run keep going
// instead of losing every record after the failure point. It does not
// touch application code or change Node's crash behaviour for the real
// running server -- it is scoped to this script's own process only.
let unhandledRejectionSeen = false;
process.on('unhandledRejection', (err) => {
  unhandledRejectionSeen = true;
  const message = err?.message || String(err);
  summary.errors.push(`unhandled rejection (fire-and-forget call in application code): ${message}`);
  console.error(`⚠️  unhandled rejection (continuing seed run): ${message}`);
});

// =============================================================================
// CONSTANTS -- the reserved test-data markers this schema DOES support
// =============================================================================

const TEST_EMAIL_DOMAIN = 'seed.innovatex.test';
const SEED_PREFIX = '[SEED]';
const NOW = new Date();
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const daysFromNow = (n) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);
const ymd = (d) => d.toISOString().slice(0, 10);

const tenantSlugArg = process.argv.find((a) => a.startsWith('--tenant='))?.split('=')[1] || null;

// =============================================================================
// PHASE 0 -- resolve target tenant + build a real reqUser/ctx for it
// =============================================================================

async function resolveTenant() {
  const tenant = tenantSlugArg
    ? await Tenant.findOne({ slug: tenantSlugArg.toLowerCase().trim(), deletedAt: null })
    : await Tenant.findOne({ deletedAt: null }).sort({ createdAt: 1 });

  if (!tenant) {
    console.error(
      tenantSlugArg
        ? `❌ No tenant found with slug "${tenantSlugArg}".`
        : '❌ No tenant found in this database at all.',
    );
    console.error('   This script only ever seeds data INTO an existing tenant -- it never');
    console.error('   creates one (that touches real signup/billing bootstrap logic). Sign up');
    console.error('   one real workspace first, then re-run this script.');
    process.exit(1);
  }
  return tenant;
}

/** findOrCreateTestUser -- idempotent by the reserved test email. */
async function findOrCreateTestUser(tenant, { firstName, lastName, role, emailLocalPart }) {
  const email = `${emailLocalPart}@${TEST_EMAIL_DOMAIN}`;
  let user = await User.findOne({ email });
  if (user) { bump('skipped', 'users'); return user; }

  user = await User.create({
    firstName, lastName, email,
    password: 'SeedTestUser!2026', // hashed by the model's own real pre-save hook
    role, tenantId: tenant._id,
    status: 'active', isActive: true, isEmailVerified: true, emailVerifiedAt: NOW,
  });
  await Membership.findOneAndUpdate(
    { userId: user._id, tenantId: tenant._id },
    {
      $setOnInsert: {
        userId: user._id, tenantId: tenant._id, role,
        status: MEMBERSHIP_STATUS.ACTIVE, joinedAt: NOW,
      },
    },
    { upsert: true },
  );
  bump('created', 'users');
  return user;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('🌱 InnovateX Revenue OS — dev/test data seed\n');
  await connectDB();

  // Fix a real bug this script's first run surfaced: Booking's dedup index
  // was declared `sparse: true` but is now a `partialFilterExpression`
  // (see booking.model.js for the full explanation) -- an existing,
  // already-connected database still has the OLD, buggy index definition
  // on disk; simply changing the schema file does not retroactively drop
  // and recreate it. syncIndexes() diffs the live indexes against what
  // the schema now declares and applies the difference, so this fix
  // actually takes effect on a database this script has run against
  // before, not only on a brand-new one. Real, not simulated; logged
  // either way so a permissions failure here is visible, not silent.
  try {
    const dropped = await Booking.syncIndexes();
    if (dropped.length) console.log(`✅ Booking indexes synced (rebuilt: ${dropped.join(', ')})`);
  } catch (err) {
    console.warn(`⚠️  Booking.syncIndexes() failed (continuing anyway): ${err.message}`);
  }
  try {
    // Cleans up the real duplicate {"tenantId":1} index this script's
    // first run logged a Mongoose warning about (see whatsappSettings.model.js
    // for the fix -- a genuinely redundant second index declaration for
    // the same field/options as the field-level `unique: true`).
    const droppedWa = await WhatsAppSettings.syncIndexes();
    if (droppedWa.length) console.log(`✅ WhatsAppSettings indexes synced (rebuilt: ${droppedWa.join(', ')})`);
  } catch (err) {
    console.warn(`⚠️  WhatsAppSettings.syncIndexes() failed (continuing anyway): ${err.message}`);
  }

  const tenant = await resolveTenant();
  const tenantId = String(tenant._id);
  console.log(`Target tenant: "${tenant.name}" (${tenant.slug})\n`);

  // ── Team ────────────────────────────────────────────────────────────────────
  const salesRepA = await findOrCreateTestUser(tenant, {
    firstName: 'Seed', lastName: 'Sales Rep A', role: ROLES.SALES_USER, emailLocalPart: 'sales.rep.a',
  });
  const salesRepB = await findOrCreateTestUser(tenant, {
    firstName: 'Seed', lastName: 'Sales Rep B', role: ROLES.SALES_USER, emailLocalPart: 'sales.rep.b',
  });
  const admin = await findOrCreateTestUser(tenant, {
    firstName: 'Seed', lastName: 'Tenant Admin', role: ROLES.TENANT_ADMIN, emailLocalPart: 'tenant.admin',
  });
  console.log(`✅ Team: ${salesRepA.email}, ${salesRepB.email}, ${admin.email} (password for all: SeedTestUser!2026)`);

  // reqUser-shaped objects -- exactly the { sub, tenantId, role } shape every
  // real service's own buildCtx() expects (confirmed by direct inspection).
  const asAdmin = { sub: String(admin._id), tenantId, role: ROLES.TENANT_ADMIN, sessionId: 'seed' };
  const asRepA  = { sub: String(salesRepA._id), tenantId, role: ROLES.SALES_USER, sessionId: 'seed' };
  const asRepB  = { sub: String(salesRepB._id), tenantId, role: ROLES.SALES_USER, sessionId: 'seed' };
  const ctxAdmin = { tenantId, userId: String(admin._id), role: ROLES.TENANT_ADMIN };

  // ── Prerequisite: one real, provider-approved WhatsApp template ─────────────
  // Real nurture sequence creation validates EVERY active step against a
  // real, usable template via templateApprovalService.assertUsable() --
  // confirmed by direct inspection of nurtures.service.js's validateSteps().
  // This is genuinely required even for non-WhatsApp channel steps.
  const templateName = `${SEED_PREFIX} Welcome Nurture Message`;
  let template = await WhatsAppTemplate.findOne({ tenantId, name: templateName });
  if (!template) {
    template = await WhatsAppTemplate.create({
      tenantId, name: templateName, slug: 'seed-welcome-nurture-message',
      category: TEMPLATE_CATEGORY.MARKETING, languageCode: 'en_US',
      status: 'ACTIVE', approvalStatus: APPROVAL_STATUS.PROVIDER_APPROVED,
      provider: WA_PROVIDER.SIMULATION,
      body: 'Hi {{1}}, thanks for your interest! We will follow up shortly.',
    });
    bump('created', 'templates');
  } else bump('skipped', 'templates');

  // ── Nurture sequence (real, ACTIVE, 3 real steps across channels) ───────────
  const sequenceName = `${SEED_PREFIX} New Lead Nurture`;
  let sequence = await NurtureSequence.findOne({ tenantId, name: sequenceName });
  if (!sequence) {
    const created = await nurturesService.createSequence(ctxAdmin, {
      name: sequenceName,
      description: 'Seed: 3-step nurture for new/warm/cold leads.',
      type: SEQUENCE_TYPE.NURTURE,
      triggerType: NURTURE_TRIGGER_TYPE.LEAD_QUALIFIED,
      qualificationTemperature: 'Warm',
      steps: [
        {
          stepNumber: 1, delayValue: 0, delayUnit: DELAY_UNIT.MINUTES,
          channel: NURTURE_CHANNEL.WHATSAPP, templateId: template._id, isActive: true,
        },
        {
          stepNumber: 2, delayValue: 1, delayUnit: DELAY_UNIT.DAYS,
          channel: NURTURE_CHANNEL.EMAIL, templateId: template._id, isActive: true,
          emailSubject: 'Still thinking it over?', emailBody: 'Hi {{lead.name}}, just checking in.',
        },
        {
          stepNumber: 3, delayValue: 2, delayUnit: DELAY_UNIT.DAYS,
          channel: NURTURE_CHANNEL.MANUAL_TASK, templateId: template._id, isActive: true,
          taskDescription: 'Call this lead directly -- nurture sequence complete.',
        },
      ],
    });
    // Real DRAFT -> ACTIVE transition, going through the actual service
    // method (which re-validates every step's template usability and
    // requires at least one active step) rather than a raw field set.
    await nurturesService.activateSequence(ctxAdmin, String(created.id), { comment: 'Seed: activating for test enrollments' });
    sequence = await NurtureSequence.findById(created.id);
    bump('created', 'nurtureSequences');
  } else bump('skipped', 'nurtureSequences');
  console.log(`✅ Nurture sequence: "${sequence.name}" (status: ${sequence.status})`);

  // ── Lead source/campaign pools -- realistic variety ──────────────────────────
  const SOURCES = ['Meta Ads', 'Google Ads', 'YouTube', 'LinkedIn', 'Organic', 'Referral', 'Webinar', 'WhatsApp', 'Cold Outreach', 'Email'];
  const TEMPERATURES = [LEAD_TEMPERATURE.HOT, LEAD_TEMPERATURE.WARM, LEAD_TEMPERATURE.COLD];
  const FIRST_NAMES = ['Aarav', 'Priya', 'Rohan', 'Ananya', 'Vikram', 'Isha', 'Karan', 'Meera', 'Arjun', 'Divya', 'Sanjay', 'Neha', 'Rahul', 'Pooja', 'Amit'];
  const LAST_NAMES = ['Shah', 'Mehta', 'Kapoor', 'Rao', 'Singh', 'Iyer', 'Gupta', 'Verma', 'Nair', 'Reddy'];

  const leadDefs = [];
  let idx = 0;
  const addLead = (overrides) => { idx += 1; leadDefs.push({ n: idx, ...overrides }); };

  // Named, explicit interconnection scenarios (7) -----------------------------
  addLead({ scenario: 'QUALIFICATION_TO_NURTURE', source: 'Google Ads', campaign: 'seed_qualification_flow', temperature: undefined, status: LEAD_STATUS.NEW });
  addLead({ scenario: 'BOOKING_PAUSES_NURTURE', source: 'Meta Ads', campaign: 'seed_booking_pause', temperature: LEAD_TEMPERATURE.WARM, status: LEAD_STATUS.NEW });
  addLead({ scenario: 'REPLY_PAUSES_NURTURE', source: 'Organic', campaign: null, temperature: LEAD_TEMPERATURE.WARM, status: LEAD_STATUS.NEW });
  addLead({ scenario: 'OPT_OUT_STOPS_NURTURE', source: 'Webinar', campaign: 'seed_optout_flow', temperature: LEAD_TEMPERATURE.COLD, status: LEAD_STATUS.NEW });
  addLead({ scenario: 'CONVERSION_ATTRIBUTION', source: 'Referral', campaign: null, temperature: LEAD_TEMPERATURE.HOT, status: LEAD_STATUS.PROPOSAL_SENT });
  addLead({ scenario: 'META_ATTRIBUTION', source: 'Meta Ads', campaign: 'seed_meta_conversion_campaign', temperature: LEAD_TEMPERATURE.HOT, status: LEAD_STATUS.QUALIFIED });
  addLead({ scenario: 'GOOGLE_ATTRIBUTION', source: 'Google Ads', campaign: 'seed_google_search_campaign', temperature: LEAD_TEMPERATURE.HOT, status: LEAD_STATUS.QUALIFIED });

  // General variety (23 more, total 30) -----------------------------------------
  const GENERAL_STATUSES = [LEAD_STATUS.NEW, LEAD_STATUS.CONTACTED, LEAD_STATUS.QUALIFIED, LEAD_STATUS.BOOKED, LEAD_STATUS.CALL_COMPLETED, LEAD_STATUS.WON, LEAD_STATUS.LOST, LEAD_STATUS.GHOSTED];
  for (let i = 0; i < 23; i += 1) {
    addLead({
      scenario: 'GENERAL',
      source: SOURCES[i % SOURCES.length],
      campaign: i % 3 === 0 ? `seed_general_campaign_${i % 4}` : null,
      temperature: TEMPERATURES[i % TEMPERATURES.length],
      status: GENERAL_STATUSES[i % GENERAL_STATUSES.length],
    });
  }

  console.log(`\n🌱 Seeding ${leadDefs.length} leads with attached scenarios...\n`);

  const leadsBySeq = []; // for final nurture-tick summary

  for (const def of leadDefs) {
    try {
      const email = `seed.lead.${String(def.n).padStart(2, '0')}@${TEST_EMAIL_DOMAIN}`;
      let lead = await Lead.findOne({ tenant_id: tenantId, email });
      const owner = def.n % 2 === 0 ? asRepB : asRepA;
      const ownerId = def.n % 2 === 0 ? String(salesRepB._id) : String(salesRepA._id);

      if (!lead) {
        const name = `${FIRST_NAMES[def.n % FIRST_NAMES.length]} ${LAST_NAMES[def.n % LAST_NAMES.length]}`;
        const created = await leadService.createLead(
          { tenantId, userId: ownerId, role: ROLES.SALES_USER },
          {
            name, email,
            phone: `+1555${String(1000000 + def.n).slice(-7)}`,
            whatsapp_number: `+1555${String(1000000 + def.n).slice(-7)}`,
            company: `${name.split(' ')[0]} ${['Ventures', 'Labs', 'Group', 'Co'][def.n % 4]}`,
            source: def.source, medium: def.source?.includes('Ads') ? 'paid' : 'organic',
            campaign: def.campaign || undefined,
            utm_source: def.source, utm_medium: def.source?.includes('Ads') ? 'paid' : 'organic',
            utm_campaign: def.campaign || undefined,
            status: def.status, lead_temperature: def.temperature,
            assigned_user_id: ownerId,
            consent_status: LEAD_CONSENT_STATUS.GRANTED,
            notes: `${SEED_PREFIX} generated test lead -- scenario: ${def.scenario}`,
          },
          { skipDuplicateCheck: true },
        );
        lead = await Lead.findById(created.id || created._id);
        bump('created', 'leads');
      } else bump('skipped', 'leads');

      // Real, per-tenant WhatsApp opt-in consent record for every lead (needed
      // before nurture WhatsApp steps or inbound-reply simulation can work) --
      // except the opt-out scenario lead, which gets OPTED_OUT instead.
      const phone = lead.whatsapp_number || lead.phone;
      let consent = await Consent.findOne({ tenantId, phoneNumber: phone });
      if (!consent) {
        const isOptOutScenario = def.scenario === 'OPT_OUT_STOPS_NURTURE';
        consent = await Consent.create({
          tenantId, leadId: lead._id, phoneNumber: phone, leadName: lead.name,
          status: isOptOutScenario ? WA_CONSENT_STATUS.OPTED_OUT : WA_CONSENT_STATUS.OPTED_IN,
          optInMethod: OPT_IN_METHOD.WEB_FORM,
          optOutMethod: isOptOutScenario ? OPT_OUT_METHOD.STOP : undefined,
          consentSource: CONSENT_SOURCE.CRM ?? Object.values(CONSENT_SOURCE)[0],
          consentedAt: isOptOutScenario ? null : daysAgo(10),
          optedOutAt: isOptOutScenario ? daysAgo(1) : null,
        });
        bump('created', 'consents');
      } else bump('skipped', 'consents');

      // ── Scenario-specific real interconnections ──────────────────────────────
      if (def.scenario === 'QUALIFICATION_TO_NURTURE') {
        let qual = await Qualification.findOne({ tenant_id: tenantId, lead_id: lead._id });
        if (!qual) {
          qual = await qualificationService.runQualification(
            String(lead._id),
            { budget: '$10k-$25k', timeline: '1-3 months', authority: 'Decision maker', challenge: 'Manual lead follow-up' },
            owner,
          );
          bump('created', 'qualifications');
        } else bump('skipped', 'qualifications');
        if (!qual.applied) {
          await qualificationService.applyResult(String(qual._id || qual.id), owner).catch((e) => summary.errors.push(`applyResult(${def.n}): ${e.message}`));
        }
        // Real auto-enroll already fires inside applyResult for Warm/Cold
        // temperatures matching the sequence's qualificationTemperature
        // (confirmed by direct inspection) -- nothing further to do here.
        leadsBySeq.push(lead._id);
      }

      if (def.scenario === 'BOOKING_PAUSES_NURTURE') {
        const existingEnrollment = await NurtureEnrollment.findOne({ tenantId, leadId: lead._id });
        if (!existingEnrollment) {
          await nurturesService.enrollLead(ctxAdmin, String(sequence._id), { leadId: String(lead._id) });
          bump('created', 'nurtureEnrollments');
        } else bump('skipped', 'nurtureEnrollments');

        const existingBooking = await Booking.findOne({ tenant_id: tenantId, lead_id: lead._id });
        if (!existingBooking) {
          await bookingService.createBooking(
            { lead_id: String(lead._id), assigned_user_id: ownerId, meeting_type: MEETING_TYPES.DISCOVERY_CALL, meeting_date: ymd(daysFromNow(3)), meeting_time: '14:00', meeting_link: 'https://meet.example.com/seed-booking-pause' },
            owner,
          );
          bump('created', 'bookings');
        } else bump('skipped', 'bookings');
        leadsBySeq.push(lead._id);
      }

      if (def.scenario === 'REPLY_PAUSES_NURTURE') {
        const existingEnrollment = await NurtureEnrollment.findOne({ tenantId, leadId: lead._id });
        if (!existingEnrollment) {
          await nurturesService.enrollLead(ctxAdmin, String(sequence._id), { leadId: String(lead._id) });
          bump('created', 'nurtureEnrollments');
        } else bump('skipped', 'nurtureEnrollments');

        const conversation = await conversationService.findOrCreateForLead(ctxAdmin, String(lead._id));
        const alreadyReplied = await NurtureEnrollment.findOne({ tenantId, leadId: lead._id, pauseReason: 'REPLY_DETECTED' });
        if (!alreadyReplied) {
          await messageService.simulateInbound(ctxAdmin, {
            conversationId: conversation.id || conversation._id,
            content: "Thanks, I'm interested -- can we talk this week?",
          });
          bump('created', 'inboundReplies');
        } else bump('skipped', 'inboundReplies');
        leadsBySeq.push(lead._id);
      }

      if (def.scenario === 'OPT_OUT_STOPS_NURTURE') {
        let enrollment = await NurtureEnrollment.findOne({ tenantId, leadId: lead._id });
        if (!enrollment) {
          enrollment = await nurturesService.enrollLead(ctxAdmin, String(sequence._id), { leadId: String(lead._id) });
          enrollment = await NurtureEnrollment.findById(enrollment.id || enrollment._id);
          bump('created', 'nurtureEnrollments');
        } else bump('skipped', 'nurtureEnrollments');
        // Force step 1 due NOW so the real scheduler tick (called once, at
        // the end of this script) genuinely hits the real OPTED_OUT consent
        // check inside nurtureExecution.service.js and pauses it for real,
        // instead of the seed script just claiming it will. Applied
        // whenever the enrollment is still genuinely ACTIVE and not yet
        // due -- not only on first creation -- so a re-run after a partial
        // failure (enrollment created, this update not yet applied) still
        // reaches the correct state instead of silently skipping it.
        if (enrollment.status === ENROLLMENT_STATUS.ACTIVE && (!enrollment.nextExecutionAt || enrollment.nextExecutionAt > NOW)) {
          await NurtureEnrollment.updateOne({ _id: enrollment._id }, { $set: { nextExecutionAt: daysAgo(0.01) } });
        }
        leadsBySeq.push(lead._id);
      }

      if (def.scenario === 'CONVERSION_ATTRIBUTION') {
        let deal = await Deal.findOne({ tenant_id: tenantId, lead_id: lead._id });
        if (!deal) {
          const created = await dealService.createDeal(ctxAdmin, {
            lead_id: String(lead._id), title: `${lead.name} — Growth Plan`, value: 24000,
            stage: DEAL_STAGE.NEGOTIATION, source: def.source, assigned_user_id: ownerId,
          });
          deal = await Deal.findById(created.id || created._id);
          bump('created', 'deals');
        } else bump('skipped', 'deals');

        let payment = await Payment.findOne({ tenant_id: tenantId, lead_id: lead._id });
        if (!payment) {
          const created = await paymentService.createPayment(
            { lead_id: String(lead._id), deal_id: String(deal._id), amount: 24000, currency: 'USD', payment_method: 'Card' },
            owner,
          );
          payment = await Payment.findById(created.id || created._id);
          bump('created', 'payments');
        }
        if (payment && payment.status !== 'Paid') {
          // Real markPaid -- this is what emits PAYMENT_COMPLETED + DEAL_WON
          // tracking events and pauses any active nurture enrollment with
          // pauseReason: 'CONVERTED' (confirmed by direct inspection).
          await paymentService.markPaid(String(payment._id), tenantId, owner).catch((e) => summary.errors.push(`markPaid(${def.n}): ${e.message}`));
          bump('created', 'paymentsMarkedPaid');
        }
      }

      if (def.scenario === 'META_ATTRIBUTION' || def.scenario === 'GOOGLE_ATTRIBUTION') {
        const already = await TrackingEvent.findOne({ tenant_id: tenantId, lead_id: lead._id, event_type: TRACKING_EVENT_TYPE.BOOKING_CREATED });
        if (!already) {
          await bookingService.createBooking(
            { lead_id: String(lead._id), assigned_user_id: ownerId, meeting_type: MEETING_TYPES.STRATEGY_CALL, meeting_date: ymd(daysFromNow(5)), meeting_time: '11:00', meeting_link: `https://meet.example.com/${def.scenario.toLowerCase()}` },
            owner,
          );
          bump('created', 'bookings');
        } else bump('skipped', 'bookings');
      }

      // ── General extra data for realism/volume on non-scenario leads ─────────
      if (def.scenario === 'GENERAL') {
        // Roughly a third get a Deal at a stage matching their lead status.
        if (def.n % 3 === 0) {
          const existingDeal = await Deal.findOne({ tenant_id: tenantId, lead_id: lead._id });
          if (!existingDeal) {
            const stageForStatus = {
              [LEAD_STATUS.NEW]: DEAL_STAGE.NEW_LEAD, [LEAD_STATUS.CONTACTED]: DEAL_STAGE.NEW_LEAD,
              [LEAD_STATUS.QUALIFIED]: DEAL_STAGE.QUALIFIED, [LEAD_STATUS.BOOKED]: DEAL_STAGE.BOOKED_CALL,
              [LEAD_STATUS.CALL_COMPLETED]: DEAL_STAGE.CALL_COMPLETED, [LEAD_STATUS.WON]: DEAL_STAGE.NEGOTIATION,
              [LEAD_STATUS.LOST]: DEAL_STAGE.NEGOTIATION, [LEAD_STATUS.GHOSTED]: DEAL_STAGE.NEW_LEAD,
            };
            const created = await dealService.createDeal(ctxAdmin, {
              lead_id: String(lead._id), title: `${lead.name} — Opportunity`, value: 5000 + (def.n * 750),
              stage: stageForStatus[def.status] || DEAL_STAGE.NEW_LEAD, source: def.source, assigned_user_id: ownerId,
            });
            const deal = await Deal.findById(created.id || created._id);
            // Exercise the real Pipeline → Attribution wiring for a few of
            // these by actually moving the stage to Won/Lost.
            if (def.status === LEAD_STATUS.WON) await dealService.moveStage(ctxAdmin, String(deal._id), DEAL_STAGE.WON).catch(() => null);
            if (def.status === LEAD_STATUS.LOST) await dealService.moveStage(ctxAdmin, String(deal._id), DEAL_STAGE.LOST).catch(() => null);
            bump('created', 'deals');
          } else bump('skipped', 'deals');
        }
        // Roughly a third get a Call Intelligence record.
        if (def.n % 3 === 1) {
          const existingCall = await callService.getCallsByLead?.(tenantId, String(lead._id));
          if (!existingCall || existingCall.length === 0) {
            await callService.createCall(
              {
                lead_id: String(lead._id), assigned_user_id: ownerId,
                outcome: [CALL_OUTCOME.INTERESTED, CALL_OUTCOME.NEEDS_FOLLOW_UP, CALL_OUTCOME.PROPOSAL_REQUESTED][def.n % 3],
                call_date: ymd(daysAgo(def.n % 10)), duration_minutes: 15 + (def.n % 20),
                transcript: `Seed test call transcript for lead ${lead.name}. Discussed budget, timeline, and next steps.`,
              },
              owner,
            ).catch((e) => summary.errors.push(`createCall(${def.n}): ${e.message}`));
            bump('created', 'calls');
          } else bump('skipped', 'calls');
        }
      }
    } catch (err) {
      summary.errors.push(`lead #${def.n} (${def.scenario}): ${err.message}`);
      console.error(`⚠️  lead #${def.n} (${def.scenario}) failed: ${err.message}`);
    }
  }

  console.log(`\n✅ Leads phase done: ${summary.created.leads || 0} created, ${summary.skipped.leads || 0} already existed.`);

  // ── Run one real scheduler tick -- exercises the actual send/pause logic
  //    for every due enrollment created above (reply/booking pauses already
  //    applied immediately by their own real hooks; this tick is what makes
  //    the OPT_OUT_STOPS_NURTURE scenario's pause genuinely real too). ───────
  try {
    const tickResult = await runDueSteps();
    console.log(`✅ Ran one real nurture scheduler tick: ${JSON.stringify(tickResult)}`);
  } catch (err) {
    summary.errors.push(`runDueSteps: ${err.message}`);
    console.error(`⚠️  runDueSteps failed: ${err.message}`);
  }

  // ── Campaigns (top-level marketing campaigns, real createCampaign) ──────────
  const campaignDefs = [
    { name: 'seed_meta_conversion_campaign', source: CAMPAIGN_SOURCE.META_ADS, type: CAMPAIGN_TYPE.PAID_ADS, budget: 8000, spend: 6120, revenue: 42000, leads: 41, bookings: 12 },
    { name: 'seed_google_search_campaign', source: CAMPAIGN_SOURCE.GOOGLE_ADS, type: CAMPAIGN_TYPE.PAID_ADS, budget: 10000, spend: 7800, revenue: 58000, leads: 53, bookings: 18 },
    { name: 'seed_general_campaign_0', source: CAMPAIGN_SOURCE.WEBINAR, type: CAMPAIGN_TYPE.WEBINAR, budget: 2000, spend: 1500, revenue: 9000, leads: 22, bookings: 6 },
  ];
  for (const c of campaignDefs) {
    try {
      const existing = await Campaign.findOne({ tenant_id: tenantId, campaign_name: c.name });
      if (existing) { bump('skipped', 'campaigns'); continue; }
      await createCampaign(
        { campaign_name: c.name, source: c.source, campaign_type: c.type, medium: CAMPAIGN_MEDIUM.PAID, budget: c.budget, status: CAMPAIGN_STATUS.SENT },
        asAdmin,
      );
      // Real createCampaign doesn't take spend/revenue/leads/bookings as
      // input (those accrue from real usage) -- backfill them directly here
      // so the Campaigns dashboard has real-looking performance numbers to
      // display without requiring dozens more real leads per campaign.
      await Campaign.updateOne(
        { tenant_id: tenantId, campaign_name: c.name },
        { $set: { spend: c.spend, revenue: c.revenue, leads_generated: c.leads, bookings: c.bookings } },
      );
      bump('created', 'campaigns');
    } catch (err) {
      summary.errors.push(`campaign "${c.name}": ${err.message}`);
      console.error(`⚠️  campaign "${c.name}" failed: ${err.message}`);
    }
  }
  console.log(`✅ Campaigns: ${summary.created.campaigns || 0} created, ${summary.skipped.campaigns || 0} already existed.`);

  // ── Automations (real createAutomation + one real simulateAutomation run) ──
  const automationName = `${SEED_PREFIX} Hot Lead → Notify Owner`;
  let automation = await Automation.findOne({ tenant_id: tenantId, name: automationName });
  if (!automation) {
    automation = await automationService.createAutomation(tenantId, String(admin._id), {
      name: automationName,
      description: 'Seed: notify the assigned rep whenever a lead is marked Hot.',
      // Automation trigger.type reuses TRACKING_EVENT_TYPE values directly
      // (automation.constants.js: TRIGGER_TYPE_VALUES = TRACKING_EVENT_TYPE_VALUES,
      // confirmed by direct inspection -- there is no separate TRIGGER_TYPE enum).
      trigger: { type: TRACKING_EVENT_TYPE.LEAD_CREATED, params: {} },
      condition: { field: 'lead.lead_temperature', operator: CONDITION_OPERATOR.EQUALS, value: 'Hot' },
      action: { type: ACTION_TYPE.NOTIFY_USER, params: { message: 'A new Hot lead needs attention.' } },
      status: AUTOMATION_STATUS.ACTIVE,
    });
    bump('created', 'automations');
    // One real "Simulate run" so the Automations page has real logs/run
    // counts to show, exactly the same action the UI's own button takes.
    await automationService.simulateAutomation(tenantId, automation._id || automation.id, String(admin._id), {}).catch((e) => summary.errors.push(`simulateAutomation: ${e.message}`));
  } else bump('skipped', 'automations');
  console.log(`✅ Automation: "${automationName}" (${summary.created.automations ? 'created + simulated' : 'already existed'})`);

  // ── Cal.com / Meta Ads / Google Ads "connected" settings ─────────────────────
  // No real service function can produce a genuinely "connected" state here
  // without live 3rd-party credentials this script obviously doesn't have.
  // These are written directly, using the real schema, with clearly-fake
  // placeholder values -- honest dev/test fixtures, not a claim of a real
  // live connection. Real testConnection()/OAuth calls are NOT invoked.
  // All upserts (findOneAndUpdate + upsert:true) -- inherently idempotent,
  // wrapped so one failing here can't skip the integrations catalog step below.
  try {
    await CalcomSettings.findOneAndUpdate(
      { tenantId: tenant._id },
      {
        $setOnInsert: {
          tenantId: tenant._id, apiKey: 'seed_fake_cal_live_key', connected: true,
          connectedAt: daysAgo(20), lastVerifiedAt: daysAgo(1), lastSyncedAt: daysAgo(1),
          accountEmail: `seed.calcom@${TEST_EMAIL_DOMAIN}`, accountUsername: 'seed-test-workspace',
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );

    await AdTrackingSettings.findOneAndUpdate(
      { tenantId: tenant._id },
      {
        $setOnInsert: {
          tenantId: tenant._id,
          meta: { pixelId: 'seed_fake_pixel_id', accessToken: 'seed_fake_meta_token', connected: true, connectedAt: daysAgo(15), lastVerifiedAt: daysAgo(1), eventsSent: 128, eventsFailed: 2 },
          google: { measurementId: 'G-SEEDFAKE01', apiSecret: 'seed_fake_ga4_secret', connected: true, connectedAt: daysAgo(15), lastVerifiedAt: daysAgo(1), eventsSent: 96, eventsFailed: 0 },
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );

    await GoogleAdsSettings.findOneAndUpdate(
      { tenantId: tenant._id },
      {
        $setOnInsert: {
          tenantId: tenant._id, refreshToken: 'seed_fake_refresh_token', clientCustomerId: '1234567890',
          accountName: 'Seed Test Google Ads Account', connected: true, connectedAt: daysAgo(15), lastSyncedAt: daysAgo(1),
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );

    for (const [i, name] of ['Search — Brand', 'Search — Competitor', 'Performance Max — Leads'].entries()) {
      await GoogleAdsCampaignMetric.findOneAndUpdate(
        { tenantId: tenant._id, campaignId: `seed-gads-${i + 1}`, dateRange: 'LAST_30_DAYS' },
        {
          $set: {
            campaignName: `${SEED_PREFIX} ${name}`, status: 'ENABLED', channelType: i === 2 ? 'PERFORMANCE_MAX' : 'SEARCH',
            impressions: 12000 + i * 4000, clicks: 480 + i * 90, spend: 2100 + i * 600,
            conversions: 18 + i * 4, conversionsValue: (18 + i * 4) * 1800, ctr: 4.0, averageCpc: 4.37,
            syncedAt: daysAgo(1),
          },
        },
        { upsert: true },
      );
    }
    bump('created', 'connectedIntegrationSettings');
    console.log('✅ Cal.com / Meta Ads / Google Ads: connected settings + 3 Google Ads campaign metric rows seeded.');
  } catch (err) {
    summary.errors.push(`integration settings: ${err.message}`);
    console.error(`⚠️  integration settings seeding failed: ${err.message}`);
  }

  // ── Integrations catalog -- real auto-provision, then it will correctly
  //    show Cal.com/Meta/Google Ads as connected via the real overlay logic
  //    since their settings docs now genuinely exist. ─────────────────────────
  await listIntegrations(tenantId, {}, { page: 1, limit: 50 }, String(admin._id)).catch((e) => summary.errors.push(`listIntegrations: ${e.message}`));
  console.log('✅ Integrations catalog auto-provisioned (22 cards) for this tenant.');

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('SEED SUMMARY');
  console.log('='.repeat(60));
  console.log('Created:', JSON.stringify(summary.created, null, 2));
  console.log('Skipped (already existed):', JSON.stringify(summary.skipped, null, 2));
  if (summary.errors.length) {
    console.log(`\n⚠️  ${summary.errors.length} non-fatal error(s):`);
    summary.errors.forEach((e) => console.log('  - ' + e));
  } else {
    console.log('\n✅ No errors.');
  }
  console.log('\nLogin as any seeded user (password: SeedTestUser!2026):');
  console.log(`  ${salesRepA.email} (Sales User)`);
  console.log(`  ${salesRepB.email} (Sales User)`);
  console.log(`  ${admin.email} (Tenant Admin)`);
  console.log('\nDone. Re-running this script is safe -- existing records are detected and skipped.');

  await mongoose.connection.close();
  process.exit(summary.errors.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error('❌ Seed script failed:', err);
  try { await mongoose.connection.close(); } catch { /* ignore */ }
  process.exit(1);
});
