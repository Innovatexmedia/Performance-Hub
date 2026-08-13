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
import { ensureSeeded as ensurePlansSeeded, backfillTenantPlans } from './modules/plans/plan.service.js';
import dns from 'dns';
dns.setServers(['1.1.1.1', '8.8.8.8']);

const PORT = config.PORT || 4000;

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Idempotent -- only inserts the 6 default plans if they don't already
    // exist (by key), so this is safe to run on every boot. See
    // plan.service.js's DEFAULT_PLANS for what gets seeded.
    await ensurePlansSeeded();

    // Backfills planId for any tenant that existed before the Plan system
    // did (e.g. this deployment's pre-existing workspaces) -- without
    // this, those tenants' plan_details stays null forever and crashes
    // Settings > Billing. Also idempotent/safe on every boot -- only
    // touches tenants where planId is still null.
    await backfillTenantPlans();

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