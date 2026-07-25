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

const PORT = config.PORT || 4000;

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

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