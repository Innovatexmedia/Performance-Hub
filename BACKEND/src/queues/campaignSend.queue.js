import { Queue } from 'bullmq';
import { redisConnection } from './redis.js';
import { queueName } from './queueName.js';

export const CAMPAIGN_SEND_QUEUE_NAME = queueName('campaign-send');

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
 * jobId is deterministic (`${kind}-${entityId}-${leadId}`, hyphens --
 * BullMQ's current version rejects a colon in a custom Job ID with
 * "Custom Id cannot contain :") so accidentally
 * calling this twice for the same run (e.g. a retried "start" request) is
 * a safe no-op for any lead whose job already exists in the queue, rather
 * than silently double-sending them.
 */
export async function enqueueCampaignSend(ctx, { kind, entityId, leadIds, runId = null, variablesByLeadId = null }) {
  const jobs = leadIds.map((leadId) => ({
    name: 'send',
    data: {
      tenantId: ctx.tenantId,
      userId: ctx.userId || null,
      kind,
      entityId: String(entityId),
      leadId: String(leadId),
      // Both null for every existing caller (dashboard campaigns and
      // broadcasts), which is what keeps the worker's original path
      // byte-for-byte unchanged for them.
      //
      // runId: set by API-triggered runs so the worker can also increment that
      // run's counters and finalise it independently of the campaign, which
      // stays open for the next trigger.
      runId: runId ? String(runId) : null,
      // variables: this recipient's caller-supplied template values.
      variables: variablesByLeadId ? (variablesByLeadId[String(leadId)] ?? null) : null,
    },
    opts: {
      // runId is part of the id for API runs. Without it, triggering the same
      // campaign for the same contact twice -- a completely legitimate thing
      // to do, e.g. two different orders for one customer -- would collide
      // with the earlier run's job and be silently dropped as a duplicate.
      jobId: runId
        ? `${kind}-${entityId}-${runId}-${leadId}`
        : `${kind}-${entityId}-${leadId}`,
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