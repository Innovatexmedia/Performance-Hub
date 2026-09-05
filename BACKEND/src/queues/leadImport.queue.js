import { Queue } from 'bullmq';
import { redisConnection } from './redis.js';

export const LEAD_IMPORT_QUEUE_NAME = 'lead-import';

export const leadImportQueue = new Queue(LEAD_IMPORT_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { count: 1000, age: 24 * 3600 },
    removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
  },
});

/**
 * Bulk-enqueues one job per CSV row for a single import run.
 *
 * jobId is deterministic (`${importId}-${rowIndex}`) so re-enqueuing the
 * same import (e.g. a retried request) is a safe no-op for any row
 * whose job already exists, rather than silently double-processing it --
 * same reasoning as campaignSend.queue.js's per-lead jobId.
 */
export async function enqueueLeadImport({ importId, rows, tenantId, userId, skipDuplicates }) {
  const jobs = rows.map((row, index) => ({
    name: 'import-row',
    data: {
      importId: String(importId),
      tenantId,
      userId: userId || null,
      row,
      line: index + 2, // +1 header row, +1 to 1-index for a human-readable line number
      skipDuplicates,
    },
    opts: {
      jobId: `${importId}-${index}`,
    },
  }));

  // Chunked addBulk -- same reasoning as campaignSend.queue.js: keeps
  // memory/latency predictable for a very large CSV without changing
  // behavior.
  const CHUNK_SIZE = 2000;
  for (let i = 0; i < jobs.length; i += CHUNK_SIZE) {
    await leadImportQueue.addBulk(jobs.slice(i, i + CHUNK_SIZE));
  }

  return { enqueued: jobs.length };
}