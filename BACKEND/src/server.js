/**
 * =============================================================================
 * InnovateX Revenue OS — Server Entry Point
 * =============================================================================
 *
 * FILE: src/server.js
 *
 * Validates environment variables, connects to MongoDB, starts HTTP server.
 * Handles graceful shutdown on SIGTERM/SIGINT.
 * =============================================================================
 */

// ── Load & validate env vars FIRST (before any other imports)
import '../src/config/env.js';

import app       from './app.js';
import config    from '../src/config/config.js';
import connectDB from '../src/config/db.js';
import { initSocketServer } from './realtime/socket.js';
import { startNurtureScheduler } from './modules/whatsapp/submodules/nurtures/nurtureScheduler.js';
import { startBookingReminderScheduler } from './modules/bookings/bookingReminderScheduler.js';
import { startSubscriptionReconciliationScheduler } from './modules/plans/subscriptionReconciliationScheduler.js';
import { startConsentReconciliationJob } from './modules/whatsapp/submodules/consent/consentReconciliation.job.js';
import { ensureSeeded as ensurePlansSeeded, backfillTenantPlans, migratePlansToInr, backfillAccounts } from './modules/plans/plan.service.js';
import dns from 'dns';
dns.setServers(['1.1.1.1', '8.8.8.8']);

const PORT = config.PORT || 4000;

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // TEMP DIAGNOSTIC -- prints at boot whether Cashfree keys actually
    // loaded from .env, in plain terminal text that's impossible to miss
    // or misread (unlike a later error deep in a request). Remove once
    // payment configuration issues are fully confirmed resolved.
    console.log('[boot] CASHFREE_APP_ID loaded:', config.CASHFREE_APP_ID ? `yes (${config.CASHFREE_APP_ID.slice(0, 12)}...)` : 'NO -- .env not picked up');
    console.log('[boot] CASHFREE_SECRET_KEY loaded:', config.CASHFREE_SECRET_KEY ? 'yes' : 'NO -- .env not picked up');
    console.log('[boot] CASHFREE_ENV:', config.CASHFREE_ENV);

    // Idempotent -- only inserts the 6 default plans if they don't already
    // exist (by key), so this is safe to run on every boot. See
    // plan.service.js's DEFAULT_PLANS for what gets seeded.
    await ensurePlansSeeded();

    // One-time fix for the 6 default plans if they were seeded into this
    // DB before the USD -> INR pricing switch. Safe on every boot -- only
    // touches plans still on 'USD' (see plan.service.js for why that's a
    // reliable signal), never touches a price a Super Admin has since
    // deliberately edited.
    await migratePlansToInr();

    // Backfills planId for any tenant that existed before the Plan system
    // did (e.g. this deployment's pre-existing workspaces) -- without
    // this, those tenants' plan_details stays null forever and crashes
    // Settings > Billing. Also idempotent/safe on every boot -- only
    // touches tenants where planId is still null.
    await backfillTenantPlans();

    // Groups every tenant that existed before account-level billing did
    // (accountId: null) into one shared Account per owner, seeded from
    // whichever of their tenants was created first. Must run AFTER
    // backfillTenantPlans so every tenant has a real planId to seed its
    // new account from. Idempotent/safe on every boot -- only touches
    // tenants where accountId is still null.
    await backfillAccounts();

    // Real booking reminder scheduler -- same real reasoning, needs a
    // live DB connection first since every tick queries Booking/Lead.
    startBookingReminderScheduler();

    // Nurture scheduler -- drives every multi-day Nurture sequence's
    // step execution (see nurtureExecution.service.js). This was
    // imported here but never actually called, meaning no enrollment's
    // step ever fired on its own in this deployment; every "Active"
    // sequence sat completely idle regardless of due dates. See
    // nurtureScheduler.js for the interval/config.
    startNurtureScheduler();

    // Consent reconciliation safety net -- see consentReconciliation.job.js
    // for why this exists (real-time sync is best-effort, this guarantees
    // eventual consistency between WhatsAppConsent and Lead).
    startConsentReconciliationJob();

    // Subscription reconciliation safety net -- same "real-time sync is
    // best-effort" reasoning as consent reconciliation above, applied to
    // billing: Cashfree's webhook is the primary way a lapsed
    // subscription gets detected, but webhook delivery was previously
    // the ONLY way -- there was no independent check on our own side at
    // all. This closes that gap (once daily, re-verifies every
    // still-"ACTIVE" account directly against Cashfree). See
    // subscriptionReconciliationScheduler.js for the full reasoning.
    startSubscriptionReconciliationScheduler();

    const server = app.listen(PORT, () => {
      console.log(`\n🚀 InnovateX Revenue OS API`);
      console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
      console.log(`   Port        : ${PORT}`);
      console.log(`   Auth routes : http://localhost:${PORT}/api/auth\n`);
    });

    // Socket.io attaches to the SAME http.Server instance -- no separate
    // server/port needed. Must happen after app.listen() so `server` exists.
    initSocketServer(server);

    // ─── Graceful Shutdown ────────────────────────────────────────────────────

    const shutdown = async (signal) => {
      console.log(`\n⏸  Received ${signal}. Shutting down gracefully...`);
      server.close(() => {
        console.log('✅ HTTP server closed.');
        process.exit(0);
      });

      // Force exit after 10 seconds if graceful shutdown hangs
      setTimeout(() => {
        console.error('❌ Graceful shutdown timed out. Forcing exit.');
        process.exit(1);
      }, 10_000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

    // ─── Unhandled Rejections ─────────────────────────────────────────────────
    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Promise Rejection:', reason);
      server.close(() => process.exit(1));
    });

    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
      process.exit(1);
    });

  } catch (error) {
    console.error('❌ Server startup failed:', error);
    process.exit(1);
  }
};

startServer();