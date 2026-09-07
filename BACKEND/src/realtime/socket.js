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
import { createAdapter } from '@socket.io/redis-adapter';
import { Emitter } from '@socket.io/redis-emitter';
import Redis from 'ioredis';
import { verifyAccessToken } from '../config/jwt.js';
import config from '../config/config.js';

let io = null;
// Lazily-created Redis-backed emitter -- used ONLY when explicitly
// enabled via useRedisEmitterFallback() (the BullMQ worker process calls
// this at startup, see queues/campaignSend.worker.js). Deliberately NOT
// automatic whenever `io` happens to be null -- emitToTenant is called
// from many unrelated services across the whole API (deliveryLogs,
// consent, conversations, messages, etc.), and `io` can legitimately be
// null there too (tests, scripts, early boot before initSocketServer
// runs) where the existing safe no-op behavior must be preserved, not
// silently swapped for a Redis connection attempt.
let redisEmitter = null;
let redisEmitterFallbackEnabled = false;

/**
 * useRedisEmitterFallback -- call ONCE from the worker process's entry
 * point (src/worker.js) before anything might call emitToTenant. Makes
 * emitToTenant() publish via Redis instead of silently no-op-ing when
 * there's no local `io` (which is always the case in the worker process
 * -- it never runs an actual Socket.io server, no HTTP clients connect
 * to it directly).
 */
export function useRedisEmitterFallback() {
  redisEmitterFallbackEnabled = true;
}

function getRedisEmitter() {
  if (!redisEmitter) {
    const pub = new Redis(config.REDIS_URL, { lazyConnect: true });
    // Real error handler -- CRITICAL FIX (confirmed via production audit
    // + a real localhost crash report). Every ioredis client is a
    // Node.js EventEmitter; an 'error' event fired with ZERO listeners
    // attached is a documented Node.js behavior that THROWS and crashes
    // the process, not just logs. This client had none, and this exact
    // gap (not "Redis is missing", the missing HANDLER) was the real
    // cause of "ECONNREFUSED 127.0.0.1:6379" + "missing 'error' handler
    // on this Redis client" + eventual nodemon crash on localhost (no
    // REDIS_URL set there -- see config.js's own fallback to
    // 'redis://127.0.0.1:6379' when unset), and a latent crash risk in
    // production too from any transient Redis network blip, independent
    // of whether Redis itself is genuinely configured correctly.
    // Same safe, non-spammy "log once until it recovers" pattern already
    // proven in queues/redis.js.
    let loggedFailure = false;
    pub.on('error', (err) => {
      if (!loggedFailure) {
        console.error('[REDIS emitter] connection error -- cross-process realtime events (worker -> connected clients) will not work until this is resolved:', err.message);
        loggedFailure = true;
      }
    });
    pub.on('connect', () => { loggedFailure = false; });
    redisEmitter = new Emitter(pub);
  }
  return redisEmitter;
}

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

  // Same allowed-origin logic as app.js's HTTP CORS -- Socket.IO has its
  // OWN separate CORS config, missed when app.js's was fixed for ngrok
  // testing (confirmed live via a real "CORS error" on socket.io's
  // polling handshake when accessed through an ngrok tunnel).
  const ALLOWED_ORIGIN_PATTERNS = [/\.ngrok-free\.dev$/, /\.ngrok-free\.app$/, /\.ngrok\.io$/];
  function corsOriginCheck(origin, callback) {
    if (!origin) return callback(null, true);
    if (origin === process.env.CLIENT_URL) return callback(null, true);
    if (process.env.NODE_ENV !== 'production' && ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin))) {
      return callback(null, true);
    }
    callback(new Error(`Socket.IO CORS: origin "${origin}" is not allowed`));
  }

  io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL ? corsOriginCheck : '*',
      credentials: true,
    },
  });

  // Redis adapter -- makes this Socket.io server ALSO listen for events
  // published via Redis pub/sub, not just its own local io.emit() calls.
  // Required for the BullMQ campaign-send worker (a SEPARATE Node
  // process, see queues/campaignSend.worker.js) to reach clients
  // connected here: the worker has no HTTP server / no directly-connected
  // sockets of its own, so it publishes through the lightweight Redis
  // emitter (getRedisEmitter() below) instead, and this adapter is what
  // relays those published events out to the real connected clients.
  // Also the standard way to horizontally scale the API itself across
  // multiple instances (a client connected to instance A still receives
  // an event emitted from instance B) -- same fix, second benefit.
  //
  // CRITICAL FIX (confirmed via production audit + a real localhost
  // crash report): pubClient/subClient previously had NO 'error'
  // handler and no lazyConnect -- ioredis clients are Node.js
  // EventEmitters, and Node.js throws (crashing the whole process) if
  // an 'error' event fires with zero listeners attached. The
  // surrounding try/catch below only ever covered the SYNCHRONOUS setup
  // call (io.adapter(...)); the actual TCP connection attempt (and any
  // failure) happens asynchronously afterward, completely outside that
  // try/catch's scope -- exactly why the real crash happened ~10-15s
  // after boot (matching ioredis's default retry/backoff timing before
  // giving up), not immediately. lazyConnect: true added too, matching
  // queues/redis.js's own established pattern -- the API server (and
  // Socket.io itself) should boot and serve requests fine even before
  // Redis is reachable; only the CROSS-PROCESS relay this adapter
  // enables actually needs it. With both fixes, an unavailable/failing
  // Redis now degrades this one specific feature (worker -> connected
  // clients realtime relay, and multi-instance horizontal scaling) with
  // a clear log line, instead of crashing the entire Node process and
  // taking down every in-flight request (including registration --
  // this is the same real mechanism that could make a genuinely
  // successful signup appear to fail: the MongoDB write completes, then
  // an unrelated Redis-triggered crash interrupts the HTTP response
  // before the client receives it).
  try {
    const pubClient = new Redis(config.REDIS_URL, { lazyConnect: true });
    const subClient = pubClient.duplicate();

    let loggedFailure = false;
    const onRedisError = (label) => (err) => {
      if (!loggedFailure) {
        console.error(`⚠️  Socket.io Redis adapter (${label}) connection error -- realtime events from the campaign-send worker process, and cross-instance broadcast, will not work until this is resolved:`, err.message);
        loggedFailure = true;
      }
    };
    pubClient.on('error', onRedisError('pub'));
    subClient.on('error', onRedisError('sub'));
    pubClient.on('connect', () => { loggedFailure = false; });

    io.adapter(createAdapter(pubClient, subClient));
    console.log('🔌 Socket.io Redis adapter attached');
  } catch (err) {
    console.error('⚠️  Socket.io Redis adapter failed to attach -- realtime events emitted from the campaign-send worker process will not reach connected clients until this is fixed:', err.message);
  }

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

    // Per-user room -- for events meant for exactly one person (e.g. "your
    // permissions just changed"), not the whole tenant. Keeps every other
    // team member from having to filter out events that aren't theirs.
    socket.join(`user:${sub}`);

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
 *
 * Works correctly from BOTH the API process (uses the local `io`
 * directly) AND the separate BullMQ worker process, but ONLY if that
 * worker called useRedisEmitterFallback() at startup -- otherwise this
 * stays a safe no-op when `io` is null, exactly as before, for every
 * other existing caller across the app.
 */
export function emitToTenant(tenantId, event, payload) {
  if (!tenantId) return;
  if (io) {
    io.to(`tenant:${tenantId}`).emit(event, payload);
  } else if (redisEmitterFallbackEnabled) {
    getRedisEmitter().to(`tenant:${tenantId}`).emit(event, payload);
  }
}

/**
 * emitToUser -- for events meant for exactly one person, not the whole
 * tenant (e.g. "your role/permissions just changed"). Safe to call even
 * if that user has no active socket connection -- just a no-op then.
 */
export function emitToUser(userId, event, payload) {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit(event, payload);
}

export function getIO() {
  return io;
}