import Redis from 'ioredis';
import config from '../config/config.js';

function attachDiagnostics(connection, label) {
  let loggedFailure = false;
  connection.on('error', (err) => {
    // BullMQ's own Queue/Worker instances install their own error handlers
    // too -- this one is just so a Redis outage shows up clearly in logs
    // instead of silent retries, without spamming on every reconnect
    // attempt.
    if (!loggedFailure) {
      console.error(`[REDIS:${label}] connection error -- sending will not work until this is resolved:`, err.message);
      loggedFailure = true;
    }
  });
  connection.on('connect', () => {
    loggedFailure = false;
  });
  return connection;
}

const REDIS_OPTIONS = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true, // don't attempt to connect until something actually uses this -- the API server can boot fine even if Redis isn't up yet, only sending a campaign needs it
};

// Shared connection for Queue instances (campaignSendQueue, leadImportQueue,
// etc). Safe to share across multiple Queues -- Queues only issue ordinary
// request/response commands (add, addBulk, getJob, ...), never blocking
// reads, so they don't contend for the socket the way Workers do.
export const redisConnection = attachDiagnostics(new Redis(config.REDIS_URL, REDIS_OPTIONS), 'queue');

/**
 * Workers must NOT share a connection -- with each other, or with a Queue.
 *
 * A Worker holds its connection busy on internal blocking commands while
 * polling for jobs. Two Workers (e.g. campaign-send + lead-import) sharing
 * one ioredis socket, or a Worker sharing with a Queue's addBulk traffic,
 * serializes/contends on that blocking traffic on a single connection --
 * this is the root cause of the `read ECONNRESET` seen in production here:
 * Redis Cloud's proxy layer does not expect one connection to carry two
 * independent consumers' blocking reads, and resets it under load.
 *
 * Call this once per Worker instead of importing `redisConnection`, so
 * each Worker gets its own dedicated socket. This does NOT create excess
 * connections beyond what BullMQ requires -- one Worker still means one
 * connection, exactly as before, just no longer shared with anything else.
 */
export function createWorkerConnection(label) {
  return attachDiagnostics(new Redis(config.REDIS_URL, REDIS_OPTIONS), label);
}