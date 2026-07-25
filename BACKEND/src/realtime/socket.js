/**
 * =============================================================================
 * InnovateX Revenue OS — Realtime (Socket.io)
 * =============================================================================
 *
 * FILE: src/realtime/socket.js
 *
 * PURPOSE
 * ───────
 * Real-time push layer for the WhatsApp Inbox (and anything else later).
 * Built for the "real-time chatting inbox" phase specifically -- before
 * this, the backend was pure REST with zero push infrastructure.
 *
 * DESIGN
 * ──────
 * - Auth reuses the EXACT same JWT verification as HTTP (verifyAccessToken
 *   from config/jwt.js) -- no separate socket-auth secret/logic to drift
 *   out of sync with the REST API.
 * - Every socket joins a room named `tenant:<tenantId>` on connect. All
 *   events are broadcast tenant-scoped via emitToTenant() -- a user never
 *   receives another tenant's events, mirroring the tenant_id scoping
 *   every REST query already enforces.
 * - CORS mirrors app.js's exact config (same origin/credentials setting)
 *   so this doesn't introduce a second, drifting CORS policy.
 * - Kept deliberately small: connect, authenticate, join tenant room,
 *   expose emitToTenant(). Services import emitToTenant() and call it
 *   after a successful mutation -- same pattern as activityService.log()
 *   or createTrackingEvent(), just for the realtime channel instead of
 *   the database.
 *
 * HOW IT FITS
 * ───────────
 * server.js  → initSocketServer(httpServer) once, at boot
 * message.service.js / conversation.service.js → emitToTenant(tenantId, event, payload)
 * frontend   → socket.io-client, connects with the same JWT access token
 * =============================================================================
 */

import { Server } from 'socket.io';
import { verifyAccessToken } from '../config/jwt.js';

let io = null;

/**
 * initSocketServer -- call once from server.js with the http.Server
 * instance returned by app.listen(). Idempotent-ish: logs a warning and
 * no-ops if called twice, rather than silently creating a second server.
 */
export function initSocketServer(httpServer) {
  if (io) {
    console.warn('⚠️  initSocketServer called twice -- ignoring second call.');
    return io;
  }

  io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || '*',
      credentials: true,
    },
  });

  // ── Auth middleware -- runs once per socket connection attempt ──────────────
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.headers?.authorization || '').replace(/^Bearer\s+/i, '');

    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = verifyAccessToken(token);
      socket.user = {
        sub: decoded.sub,
        tenantId: decoded.tenantId,
        role: decoded.role,
        sessionId: decoded.sessionId,
      };
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const { tenantId, sub } = socket.user;

    // Tenant-scoped room -- every broadcast targets this, never io.emit()
    // globally. super_admin has tenantId === null (per JWT payload
    // convention already used everywhere else) -- no tenant room to join,
    // which is correct: nothing tenant-scoped should reach super_admin
    // through this channel.
    if (tenantId) {
      socket.join(`tenant:${tenantId}`);
    }

    console.log(`🔌 Socket connected: user=${sub} tenant=${tenantId ?? 'none'} (${socket.id})`);

    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: user=${sub} (${socket.id})`);
    });
  });

  console.log('🔌 Socket.io initialized');
  return io;
}

/**
 * emitToTenant -- the ONLY way the rest of the app should push realtime
 * events. Safe to call even if sockets aren't initialized (e.g. in tests)
 * or tenantId is missing -- no-ops rather than throwing, since realtime
 * push is an enhancement, not something a request should ever fail over.
 */
export function emitToTenant(tenantId, event, payload) {
  if (!io || !tenantId) return;
  io.to(`tenant:${tenantId}`).emit(event, payload);
}

export function getIO() {
  return io;
}