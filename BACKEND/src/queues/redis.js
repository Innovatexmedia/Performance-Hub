
import Redis from 'ioredis';
import config from '../config/config.js';

export const redisConnection = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true, // don't attempt to connect until something actually uses this -- the API server can boot fine even if Redis isn't up yet, only sending a campaign needs it
});

let loggedFailure = false;
redisConnection.on('error', (err) => {
  // BullMQ's own Queue/Worker instances install their own error handlers
  // too -- this one is just so a Redis outage shows up clearly in logs
  // instead of silent retries, without spamming on every reconnect
  // attempt.
  if (!loggedFailure) {
    console.error('[REDIS] connection error -- campaign/broadcast sending will not work until this is resolved:', err.message);
    loggedFailure = true;
  }
});
redisConnection.on('connect', () => {
  loggedFailure = false;
});