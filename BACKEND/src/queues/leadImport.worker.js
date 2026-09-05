import { Worker } from 'bullmq';
import { redisConnection } from './redis.js';
import { LEAD_IMPORT_QUEUE_NAME } from './leadImport.queue.js';
import config from '../config/config.js';

import { processOneRow } from '../modules/leads/imports/import.service.js';
import { leadImportRepository } from '../modules/leads/imports/leadImport.repository.js';
import { emitToTenant } from '../realtime/socket.js';

async function maybeFinalize(tenantId, importId) {
  const doc = await leadImportRepository.findById(tenantId, importId);
  if (!doc) return;
  if (doc.processedCount < doc.totalRows) return;

  // Status-guarded -- same reasoning as campaignSend.worker.js's
  // maybeFinalize: concurrent workers can both observe "fully processed"
  // within milliseconds, MongoDB's status filter is the single arbiter
  // for which one actually applies the terminal transition.
  const finalDoc = await leadImportRepository.completeIfRunning(tenantId, importId);
  if (finalDoc) {
    emitToTenant(tenantId, 'leads:import', { importId: String(importId), import: toImportDTO(finalDoc) });
  }
}

function toImportDTO(doc) {
  return {
    id: String(doc._id),
    status: doc.status,
    fileName: doc.fileName,
    totalRows: doc.totalRows,
    processedCount: doc.processedCount,
    createdCount: doc.createdCount,
    skippedCount: doc.skippedCount,
    failedCount: doc.failedCount,
    errors: doc.errors,
  };
}

async function processImportRowJob(job) {
  const { importId, tenantId, userId, row, line, skipDuplicates } = job.data;
  const ctx = { tenantId, userId };

  // Mark RUNNING on the very first row processed for this import --
  // harmless no-op for every row after the first (status is no longer
  // QUEUED so the guarded update simply matches nothing).
  await leadImportRepository.startIfQueued(tenantId, importId);

  // processOneRow can genuinely throw now (see its own doc comment) --
  // an unexpected/infrastructure error propagates straight out of this
  // function, which is exactly what lets BullMQ's real attempts/backoff
  // (configured on the queue) retry it. Progress is only recorded once
  // a row reaches an actual final outcome -- see the worker's 'failed'
  // handler below for what happens once retries are fully exhausted.
  const result = await processOneRow(ctx, row, { skipDuplicates });

  const updated = await leadImportRepository.incrementProgress(tenantId, importId, {
    created: result.outcome === 'created' ? 1 : 0,
    skipped: result.outcome === 'skipped' ? 1 : 0,
    failed: result.outcome === 'failed' ? 1 : 0,
    error: result.outcome === 'failed' ? { line, error: result.error } : null,
  });

  // Live per-row progress -- same real-time-update pattern the
  // Campaign/Broadcast progress bar already uses.
  if (updated) {
    emitToTenant(tenantId, 'leads:import', { importId: String(importId), import: toImportDTO(updated) });
  }

  await maybeFinalize(tenantId, importId);

  return result;
}

export function startLeadImportWorker() {
  const worker = new Worker(LEAD_IMPORT_QUEUE_NAME, processImportRowJob, {
    connection: redisConnection,
    concurrency: config.LEAD_IMPORT_CONCURRENCY,
  });

  worker.on('failed', async (job, err) => {
    // All configured `attempts` on the queue are now exhausted -- this
    // row is a genuine, permanent failure. Without recording this,
    // processedCount would never reach totalRows for an import with
    // even one persistently-failing row, and it would sit at RUNNING
    // forever with no way to finish. Record it as a real failed outcome
    // now, the same as processImportRowJob does for an ordinary
    // (non-retried) failure.
    console.error(`[LEAD_IMPORT_WORKER] job ${job?.id} failed permanently after all retries:`, err?.message);
    if (!job?.data) return;
    const { importId, tenantId, line } = job.data;
    try {
      const updated = await leadImportRepository.incrementProgress(tenantId, importId, {
        failed: 1,
        error: { line, error: 'This row could not be saved after multiple attempts -- please try re-uploading it separately' },
      });
      if (updated) emitToTenant(tenantId, 'leads:import', { importId: String(importId), import: toImportDTO(updated) });
      await maybeFinalize(tenantId, importId);
    } catch (recordErr) {
      console.error(`[LEAD_IMPORT_WORKER] could not record permanent failure for job ${job?.id}:`, recordErr.message);
    }
  });
  worker.on('error', (err) => {
    console.error('[LEAD_IMPORT_WORKER] worker error:', err?.message);
  });

  console.log(`[LEAD_IMPORT_WORKER] started -- concurrency=${config.LEAD_IMPORT_CONCURRENCY}`);
  return worker;
}