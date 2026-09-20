#!/usr/bin/env node
/**
 * Campaign-send queue inspector.
 *
 * RUN: node scripts/inspect-campaign-queue.mjs
 *
 * Answers the one question logs alone don't: where did the job actually go?
 * A run stuck at QUEUED has exactly three possible explanations, and each
 * leaves a different trace in Redis:
 *
 *   waiting  — nobody is consuming. The worker isn't running, or it is
 *              pointed at a different Redis than the API server.
 *   failed   — it was consumed and threw. The reason is printed below,
 *              which is the actual bug.
 *   nowhere  — it was never enqueued, or was silently deduped against an
 *              existing job id.
 */

import dns from 'node:dns/promises';
dns.setServers(['1.1.1.1', '8.8.8.8']);

import { Queue } from 'bullmq';
import Redis from 'ioredis';
import config from '../src/config/config.js';

const QUEUE_NAME = 'campaign-send';

const connection = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const queue = new Queue(QUEUE_NAME, { connection });

function describe(job) {
  const d = job.data || {};
  return [
    `    id:        ${job.id}`,
    `    kind:      ${d.kind}`,
    `    entityId:  ${d.entityId}`,
    `    leadId:    ${d.leadId}`,
    `    runId:     ${d.runId ?? '(none — dashboard campaign)'}`,
    `    attempts:  ${job.attemptsMade}`,
  ].join('\n');
}

async function run() {
  // Which Redis are we even looking at? A worker pointed at a different
  // instance than the API server is the single most common cause of
  // "enqueued but never consumed", and it is invisible from either log.
  const masked = String(config.REDIS_URL || '').replace(/:\/\/([^@]*)@/, '://***@');
  console.log(`\n🔌 Redis: ${masked}`);
  console.log(`📦 Queue: ${QUEUE_NAME}\n`);

  const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
  console.log('Job counts:', counts);

  const isPaused = await queue.isPaused();
  if (isPaused) {
    console.log('\n⚠️  THE QUEUE IS PAUSED — nothing will be consumed until it is resumed.');
  }

  const waiting = await queue.getJobs(['waiting', 'delayed'], 0, 20);
  if (waiting.length) {
    console.log(`\n⏳ ${waiting.length} job(s) waiting — consumed by nobody:`);
    for (const job of waiting) console.log(describe(job), '\n');
    console.log('   → The worker is not running, or is connected to a different Redis.');
  }

  const active = await queue.getJobs(['active'], 0, 20);
  if (active.length) {
    console.log(`\n▶️  ${active.length} job(s) active right now:`);
    for (const job of active) console.log(describe(job), '\n');
  }

  const failed = await queue.getJobs(['failed'], 0, 20);
  if (failed.length) {
    console.log(`\n❌ ${failed.length} failed job(s) — this is where the real error is:`);
    for (const job of failed) {
      console.log(describe(job));
      console.log(`    reason:    ${job.failedReason}`);
      if (job.stacktrace?.[0]) {
        console.log(`    stack:     ${String(job.stacktrace[0]).split('\n').slice(0, 4).join('\n               ')}`);
      }
      console.log('');
    }
  }

  const completed = await queue.getJobs(['completed'], 0, 10);
  const apiCompleted = completed.filter((j) => j.data?.runId);
  if (apiCompleted.length) {
    console.log(`\n✅ ${apiCompleted.length} completed API-run job(s):`);
    for (const job of apiCompleted) {
      console.log(describe(job));
      console.log(`    returned:  ${JSON.stringify(job.returnvalue)}\n`);
    }
    console.log('   → If a job completed with outcome "skipped_not_running", the worker');
    console.log('     took the OLD code path. Restart it after replacing the file.');
  }

  if (!waiting.length && !active.length && !failed.length && !apiCompleted.length) {
    console.log('\n🤔 No API-run jobs found in any state.');
    console.log('   → Either nothing was enqueued, or the job id collided with an');
    console.log('     existing one and addBulk silently skipped it.');
  }

  await queue.close();
  await connection.quit();
}

run().catch(async (err) => {
  console.error('\nInspector failed:', err.message);
  process.exit(1);
});
