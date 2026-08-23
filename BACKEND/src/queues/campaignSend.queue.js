import { Queue } from 'bullmq';
import { redisConnection } from './redis.js';

export const CAMPAIGN_SEND_QUEUE_NAME = 'campaign-send';

export const campaignSendQueue = new Queue(CAMPAIGN_SEND_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    // Completed/failed jobs are cleaned up automatically so Redis doesn't
    // accumulate millions of finished job records for a high-volume
    // tenant over time -- keep a small recent window for debugging, not
    // an unbounded history.
    removeOnComplete: { count: 1000, age: 24 * 3600 },
    removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
  },
});

/**
 * Bulk-enqueues one send job per lead for a campaign/broadcast run.
 *
 * jobId is deterministic (`${kind}:${entityId}:${leadId}`) so accidentally
 * calling this twice for the same run (e.g. a retried "start" request) is
 * a safe no-op for any lead whose job already exists in the queue, rather
 * than silently double-sending them.
 */
export async function enqueueCampaignSend(ctx, { kind, entityId, leadIds }) {
  const jobs = leadIds.map((leadId) => ({
    name: 'send',
    data: {
      tenantId: ctx.tenantId,
      userId: ctx.userId || null,
      kind,
      entityId: String(entityId),
      leadId: String(leadId),
    },
    opts: {
      jobId: `${kind}:${entityId}:${leadId}`,
    },
  }));

  // addBulk in chunks -- a single addBulk call with tens of thousands of
  // jobs is still one Redis pipeline, which is fine, but chunking keeps
  // memory/latency predictable and gives a natural place to log progress
  // for very large audiences without changing behavior.
  const CHUNK_SIZE = 2000;
  for (let i = 0; i < jobs.length; i += CHUNK_SIZE) {
    await campaignSendQueue.addBulk(jobs.slice(i, i + CHUNK_SIZE));
  }

  return { enqueued: jobs.length };
}