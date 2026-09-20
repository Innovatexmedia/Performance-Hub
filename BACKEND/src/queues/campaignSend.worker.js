import { Worker } from 'bullmq';
import { redisConnection } from './redis.js';
import { CAMPAIGN_SEND_QUEUE_NAME } from './campaignSend.queue.js';
import config from '../config/config.js';

import { Lead } from '../modules/leads/lead/lead.model.js';
import { templatesRepository } from '../modules/whatsapp/submodules/templates/templates.repository.js';
import { APPROVAL_STATUS } from '../modules/whatsapp/submodules/templates/templates.constants.js';
import { emitToTenant } from '../realtime/socket.js';
import { KIND_CONFIG, sendToOneRecipient, toDTO } from '../modules/whatsapp/messageSender.js';
import { automationRulesService } from '../modules/whatsapp/submodules/automationRules/automationRules.service.js';
import { TRIGGER_TYPE } from '../modules/whatsapp/submodules/automationRules/automationRules.constants.js';
import { CampaignRun, RUN_STATUS } from '../modules/whatsapp/submodules/apiCampaigns/campaignRun.model.js';

/**
 * finalizeRunIfDone — the run-level equivalent of maybeFinalize().
 *
 * An API campaign is triggered many times, so the CAMPAIGN must never
 * auto-complete: doing so would close it after the first trigger and reject
 * every later one. The RUN is what completes. That is the whole reason this
 * function exists separately rather than reusing maybeFinalize.
 *
 * The status guard in the update means whichever job finishes last performs
 * the transition and the rest no-op, which is the same race-safe pattern
 * completeCampaignIfRunning already uses.
 */
async function finalizeRunIfDone(tenantId, runId) {
  const run = await CampaignRun.findOne({ _id: runId, tenantId });
  if (!run) return null;

  const processed = (run.sentCount || 0) + (run.failedCount || 0) + (run.skippedCount || 0);
  if (run.queuedCount <= 0 || processed < run.queuedCount) return run;

  const succeeded = (run.sentCount || 0) > 0;

  return CampaignRun.findOneAndUpdate(
    { _id: runId, tenantId, status: { $in: [RUN_STATUS.QUEUED, RUN_STATUS.RUNNING] } },
    {
      $set: {
        status: succeeded ? RUN_STATUS.COMPLETED : RUN_STATUS.FAILED,
        completedAt: new Date(),
        failureReason: succeeded ? '' : `All ${run.failedCount || 0} send attempt(s) failed — see delivery logs`,
      },
    },
    { new: true }
  );
}

/**
 * processApiRunJob — the send path for an API-triggered run.
 *
 * Everything that actually sends is the shared code: the same template check,
 * the same sendToOneRecipient, therefore the same consent gate, conversation,
 * message record, delivery log and webhook correlation. The differences are
 * only bookkeeping: the run gates the job instead of the campaign, per-recipient
 * variables come from the job, and the campaign's counters are incremented
 * without ever finalising it.
 */
async function processApiRunJob(job, cfg) {
  const { tenantId, userId, entityId, leadId, runId, variables } = job.data;
  const ctx = { tenantId, userId };

  const run = await CampaignRun.findOne({ _id: runId, tenantId });

  // Distinct outcomes on purpose. The old (pre-API) path also returns
  // 'skipped_not_running', so sharing that string made a queue trace
  // ambiguous: a job that completed with it could mean either "the worker is
  // still on the old code" or "this run was cancelled". Naming them apart
  // makes the next trace answer the question by itself.
  if (!run) {
    console.warn(`[CAMPAIGN_SEND] api run ${runId} not found for tenant ${tenantId} — job dropped`);
    return { outcome: 'skipped_run_missing' };
  }

  if (![RUN_STATUS.QUEUED, RUN_STATUS.RUNNING].includes(run.status)) {
    return { outcome: 'skipped_run_not_active', runStatus: run.status };
  }

  console.log(`[CAMPAIGN_SEND] api run ${runId} → sending to lead ${leadId}`);

  if (run.status === RUN_STATUS.QUEUED) {
    await CampaignRun.updateOne(
      { _id: runId, tenantId, status: RUN_STATUS.QUEUED },
      { $set: { status: RUN_STATUS.RUNNING, startedAt: new Date() } }
    );
  }

  const campaign = await cfg.repository.findById(tenantId, entityId);
  const lead = await Lead.findOne({ _id: leadId, tenant_id: tenantId });

  let outcome;
  if (!campaign) {
    outcome = { outcome: 'failed', reason: 'Campaign no longer exists' };
  } else if (!lead) {
    outcome = { outcome: 'failed', reason: 'Contact no longer exists' };
  } else {
    // Re-checked at SEND time, not just at trigger time: approval can be
    // withdrawn by Meta while a large run is still draining.
    const template = await templatesRepository.findById(tenantId, campaign.templateId);
    if (!template || template.approvalStatus !== APPROVAL_STATUS.PROVIDER_APPROVED) {
      outcome = { outcome: 'failed', reason: 'Template is no longer provider-approved' };
    } else {
      outcome = await sendToOneRecipient(ctx, { cfg, entity: campaign, template, lead, variables });
    }
  }

  const increment = {
    sentCount: outcome.outcome === 'sent' ? 1 : 0,
    failedCount: outcome.outcome === 'failed' ? 1 : 0,
    skippedCount: outcome.outcome === 'skipped_opt_out' ? 1 : 0,
  };

  await CampaignRun.updateOne({ _id: runId, tenantId }, { $inc: increment });

  // The campaign keeps accumulating lifetime totals across every trigger, so
  // existing campaign analytics keep working unchanged. updateMetrics only
  // increments; it never transitions status, so the campaign stays open.
  const updatedCampaign = await cfg.repository.updateMetrics(tenantId, entityId, increment);
  if (updatedCampaign) {
    emitToTenant(tenantId, cfg.socketEvent, { [`${cfg.payloadKey}Id`]: entityId, [cfg.payloadKey]: toDTO(updatedCampaign) });
  }

  const finalRun = await finalizeRunIfDone(tenantId, runId);
  if (finalRun) {
    emitToTenant(tenantId, 'campaign:run', { runId: String(runId), campaignId: entityId, status: finalRun.status });
  }

  return outcome;
}

async function maybeFinalize(ctx, cfg, updated) {
  if (!updated) return;
  const m = updated.metrics || {};
  const processed = (m.sentCount || 0) + (m.failedCount || 0) + (m.skippedCount || 0);
  const total = updated.recipientCount ?? m.recipientCount ?? 0;
  if (total <= 0 || processed < total) return;

  const now = new Date();
  const wasSuccessful = (m.sentCount || 0) > 0;
  const auditEntry = {
    fromStatus: cfg.STATUS.RUNNING,
    toStatus: wasSuccessful ? cfg.STATUS.COMPLETED : cfg.STATUS.FAILED,
    action: wasSuccessful ? cfg.ACTION.COMPLETE : cfg.ACTION.FAIL,
    performedBy: null,
    performedAt: now,
    comment: wasSuccessful ? 'Auto-completed after real send finished' : `All ${m.failedCount || 0} send attempt(s) failed -- see delivery logs for details`,
  };

  const finalDoc = wasSuccessful
    ? await (cfg.payloadKey === 'campaign'
        ? cfg.repository.completeCampaignIfRunning(ctx.tenantId, updated._id, { performedBy: null, now, auditEntry })
        : cfg.repository.completeBroadcastIfRunning(ctx.tenantId, updated._id, { performedBy: null, now, auditEntry }))
    : await (cfg.payloadKey === 'campaign'
        ? cfg.repository.failCampaignIfRunning(ctx.tenantId, updated._id, { failureReason: auditEntry.comment, performedBy: null, auditEntry })
        : cfg.repository.failBroadcastIfRunning(ctx.tenantId, updated._id, { failureReason: auditEntry.comment, performedBy: null, auditEntry }));

  // finalDoc is null if another concurrent job already won the race and
  // completed/failed this run first -- that's the expected, harmless
  // outcome of the guard, not an error.
  if (finalDoc) {
    emitToTenant(ctx.tenantId, cfg.socketEvent, { [`${cfg.payloadKey}Id`]: String(updated._id), [cfg.payloadKey]: toDTO(finalDoc) });

    // Real Automation Rules dispatch for CAMPAIGN_COMPLETED/CAMPAIGN_FAILED
    // -- same previously-idle dispatch() as the other real trigger sites.
    // No single leadId here since a campaign/broadcast targets a whole
    // audience, not one lead -- lead-specific actions (ADD_TAG, etc.)
    // will correctly report "no lead in context" rather than guessing one.
    automationRulesService
      .dispatch(ctx, wasSuccessful ? TRIGGER_TYPE.CAMPAIGN_COMPLETED : TRIGGER_TYPE.CAMPAIGN_FAILED, {
        campaignId: cfg.payloadKey === 'campaign' ? String(updated._id) : null,
        broadcastId: cfg.payloadKey === 'broadcast' ? String(updated._id) : null,
        metrics: m,
      })
      .catch((err) => {
        console.warn(`[automation] ${wasSuccessful ? 'CAMPAIGN_COMPLETED' : 'CAMPAIGN_FAILED'} dispatch failed for ${cfg.payloadKey} ${updated._id}: ${err.message}`);
      });
  }
}

async function processSendJob(job) {
  const { tenantId, userId, kind, entityId, leadId } = job.data;
  const ctx = { tenantId, userId };
  const cfg = KIND_CONFIG[kind];
  if (!cfg) throw new Error(`Unknown campaign-send kind "${kind}"`);

  // API-triggered runs branch here. Jobs enqueued before this shipped have no
  // runId, so they take the original path below unchanged.
  if (job.data.runId) return processApiRunJob(job, cfg);

  const entity = await cfg.repository.findById(tenantId, entityId);
  // Entity gone, or no longer running (e.g. cancelled mid-flight) --
  // nothing to do. Not a job failure; the run simply isn't active
  // anymore, and any already-queued sibling jobs will hit this same
  // early return rather than sending into a cancelled run.
  if (!entity || entity.status !== cfg.STATUS.RUNNING) {
    // Reached by an API-campaign job ONLY when this file is the pre-API
    // version -- an API campaign sits at ACTIVE, never RUNNING. If a job
    // carrying a runId ever lands here, the worker is running stale code.
    return { outcome: 'skipped_not_running', entityStatus: entity?.status ?? null };
  }

  const lead = await Lead.findOne({ _id: leadId, tenant_id: tenantId });
  let outcome;
  if (!lead) {
    outcome = { outcome: 'failed', reason: 'Lead no longer exists' };
  } else {
    // Re-check the template is still usable at SEND time, not just at
    // enqueue time -- a long-running 20k-recipient campaign can easily
    // outlive a template's approval status changing mid-run.
    const template = await templatesRepository.findById(tenantId, entity.templateId);
    if (!template || template.approvalStatus !== APPROVAL_STATUS.PROVIDER_APPROVED) {
      outcome = { outcome: 'failed', reason: 'Template is no longer provider-approved' };
    } else {
      outcome = await sendToOneRecipient(ctx, { cfg, entity, template, lead });
    }
  }

  const increment = {
    sentCount: outcome.outcome === 'sent' ? 1 : 0,
    failedCount: outcome.outcome === 'failed' ? 1 : 0,
    skippedCount: outcome.outcome === 'skipped_opt_out' ? 1 : 0,
  };
  const updated = await cfg.repository.updateMetrics(tenantId, entityId, increment);

  // Live per-recipient progress -- the UI's progress bar reads this
  // exact event (already wired end-to-end via useWhatsAppRealtime /
  // applyRealtimeUpdate, unchanged from before).
  if (updated) {
    emitToTenant(tenantId, cfg.socketEvent, { [`${cfg.payloadKey}Id`]: entityId, [cfg.payloadKey]: toDTO(updated) });
  }

  await maybeFinalize(ctx, cfg, updated);

  return outcome;
}

export function startCampaignSendWorker() {
  const worker = new Worker(CAMPAIGN_SEND_QUEUE_NAME, processSendJob, {
    connection: redisConnection,
    concurrency: config.CAMPAIGN_SEND_CONCURRENCY,
    limiter: {
      max: config.CAMPAIGN_SEND_RATE_MAX,
      duration: config.CAMPAIGN_SEND_RATE_DURATION_MS,
    },
  });

  worker.on('failed', (job, err) => {
    // All `attempts` exhausted (BullMQ already retried with backoff) --
    // this is a genuinely failed send, already counted via
    // updateMetrics's failedCount inside processSendJob for the LAST
    // attempt that actually ran; this handler is purely for visibility.
    console.error(`[CAMPAIGN_SEND_WORKER] job ${job?.id} failed permanently:`, err?.message);
  });
  worker.on('error', (err) => {
    console.error('[CAMPAIGN_SEND_WORKER] worker error:', err?.message);
  });

  // Build marker + the file this module was actually loaded from. Without
  // it there is no way to tell a stale worker process from a current one:
  // both print the same startup line, and a job completing with an outcome
  // the current code cannot produce is the only symptom -- by which point
  // the job is already gone.
  console.log(`[CAMPAIGN_SEND_WORKER] started -- build=api-runs-v2 queue="${CAMPAIGN_SEND_QUEUE_NAME}" concurrency=${config.CAMPAIGN_SEND_CONCURRENCY} rateLimit=${config.CAMPAIGN_SEND_RATE_MAX}/${config.CAMPAIGN_SEND_RATE_DURATION_MS}ms`);
  console.log(`[CAMPAIGN_SEND_WORKER] loaded from: ${new URL(import.meta.url).pathname}`);
  return worker;
}