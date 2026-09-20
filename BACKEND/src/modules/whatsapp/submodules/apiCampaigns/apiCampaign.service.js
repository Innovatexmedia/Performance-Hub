/**
 * API Campaign service — the trigger path for externally-fired campaigns.
 *
 * THE ONE ARCHITECTURAL RULE HERE
 * ───────────────────────────────
 * This file does NOT send anything. It validates a request, resolves contacts,
 * writes a CampaignRun, and hands the work to enqueueCampaignSend — the same
 * queue the dashboard uses. Every message still goes out through the existing
 * worker → messageSender → provider path, which is what keeps consent checks,
 * delivery logs, webhooks, conversation threading and analytics working for
 * API sends without a single one of them being reimplemented here.
 *
 * WHY WE CREATE LEADS
 * ───────────────────
 * The send pipeline is lead-based end to end: Message, Conversation and
 * DeliveryLog all require a lead_id, and the consent gate is keyed on a real
 * contact. So a phone number arriving over the API is upserted into a Lead.
 * That is not a workaround — it is the correct behaviour for a CRM, and what
 * comparable platforms do: a contact you message should exist in your CRM,
 * with its conversation history attached.
 */

import crypto from 'crypto';

import { campaignsRepository } from '../campaigns/campaigns.repository.js';
import { templatesRepository } from '../templates/templates.repository.js';
import { APPROVAL_STATUS } from '../templates/templates.constants.js';
import { CAMPAIGN_STATUS, CAMPAIGN_TYPE, API_ALLOWED_TRANSITIONS } from '../campaigns/campaigns.constants.js';
import { requiredPlaceholders } from '../../templateParams.js';
import { leadRepository } from '../../../leads/lead/lead.repository.js';
import { enqueueCampaignSend } from '../../../../queues/campaignSend.queue.js';
import { AppError } from '../../../../shared/helpers/lead.helpers.js';

import { CampaignRun, RUN_STATUS, RUN_SOURCE } from './campaignRun.model.js';
import { IdempotencyRecord } from './idempotencyRecord.model.js';

/** Hard ceiling per request. Beyond this, callers should page. */
export const MAX_RECIPIENTS_PER_REQUEST = 1000;

/**
 * normalisePhone — digits only, no leading +.
 *
 * Matches what the rest of the system stores and what Meta expects in `to`.
 * Deliberately strict about length rather than clever about country codes:
 * guessing a country for a 10-digit number would silently message the wrong
 * person, so a number without its country code is rejected and the caller is
 * told exactly that.
 */
export function normalisePhone(raw) {
  if (raw === undefined || raw === null) return { ok: false, reason: 'Phone number is missing' };

  const digits = String(raw).replace(/[^\d]/g, '');

  if (!digits) return { ok: false, reason: 'Phone number contains no digits' };
  if (digits.length < 10) return { ok: false, reason: 'Phone number is too short' };
  if (digits.length > 15) return { ok: false, reason: 'Phone number is too long (max 15 digits, E.164)' };
  if (digits.length === 10) {
    return {
      ok: false,
      reason: 'Phone number is missing its country code (e.g. 919XXXXXXXXX, not 9XXXXXXXXX)',
    };
  }

  return { ok: true, phone: digits };
}

const hashRequest = (body) =>
  crypto.createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');

export const apiCampaignService = {
  /**
   * assertTriggerable — every precondition, checked BEFORE a run row exists.
   *
   * Ordered cheapest-first, and each failure names the exact fix. An API
   * consumer cannot see your dashboard; "Campaign not found" with no hint of
   * why is the difference between a five-minute integration and a support
   * ticket.
   */
  async assertTriggerable(ctx, campaignId) {
    const campaign = await campaignsRepository.findById(ctx.tenantId, campaignId);
    if (!campaign) {
      throw new AppError(404, `No campaign with id "${campaignId}" exists in this workspace`);
    }

    if (campaign.type !== CAMPAIGN_TYPE.API) {
      throw new AppError(
        400,
        'This campaign is not an API campaign. Only campaigns created as "API Campaign" can be triggered over the API — a dashboard campaign sends to its own saved audience.'
      );
    }

    // Exactly one status accepts traffic. Checking for ACTIVE rather than
    // listing the statuses that don't means a status added later fails
    // closed -- it refuses traffic until someone decides it should accept it.
    if (campaign.status !== CAMPAIGN_STATUS.ACTIVE) {
      const reason = {
        [CAMPAIGN_STATUS.DRAFT]:     'This campaign is still a draft. Activate it in the dashboard before triggering it.',
        [CAMPAIGN_STATUS.PAUSED]:    'This campaign is paused. Resume it in the dashboard to start accepting requests again.',
        [CAMPAIGN_STATUS.CANCELLED]: 'This campaign has been archived and can no longer be triggered.',
      }[campaign.status] ?? `This campaign is not active (status: ${campaign.status}).`;

      throw new AppError(409, reason);
    }

    const template = await templatesRepository.findById(ctx.tenantId, campaign.templateId);
    if (!template) {
      throw new AppError(409, 'The template attached to this campaign no longer exists.');
    }
    if (template.approvalStatus !== APPROVAL_STATUS.PROVIDER_APPROVED) {
      throw new AppError(
        409,
        `The template "${template.name}" is not approved by Meta (current status: ${template.approvalStatus}). Only approved templates can be sent.`
      );
    }

    return { campaign, template };
  },

  /**
   * validateRecipients — resolves and checks every recipient up front.
   *
   * Partial acceptance is deliberate: one bad phone number in a batch of 500
   * must not reject the other 499. Rejections are returned so the caller can
   * see exactly which ones and why, and are stored on the run so the same
   * answer is available later in the dashboard.
   */
  validateRecipients(recipients, template) {
    const placeholders = requiredPlaceholders(template);
    const accepted = [];
    const rejected = [];
    const seen = new Set();

    for (const recipient of recipients) {
      const phoneCheck = normalisePhone(recipient?.phone);
      if (!phoneCheck.ok) {
        rejected.push({ phone: String(recipient?.phone ?? ''), reason: phoneCheck.reason, code: 'INVALID_PHONE' });
        continue;
      }

      // Same number twice in one request is a caller mistake, and sending
      // twice would cost them money. The first occurrence wins.
      if (seen.has(phoneCheck.phone)) {
        rejected.push({ phone: phoneCheck.phone, reason: 'Duplicate phone number in this request', code: 'DUPLICATE' });
        continue;
      }
      seen.add(phoneCheck.phone);

      const variables = recipient?.variables ?? {};
      const missing = placeholders.filter((ph, index) => {
        const byPosition = variables[String(index + 1)];
        const byName = ph.name ? variables[ph.name] : undefined;
        const value = byPosition ?? byName;
        return value === undefined || value === null || String(value).trim() === '';
      });

      if (missing.length) {
        // Meta rejects the whole message for a missing parameter (error
        // 132000), so this would fail at send time anyway — failing here
        // instead means it costs nothing and the caller gets a usable message.
        rejected.push({
          phone: phoneCheck.phone,
          reason: `Missing template variable(s): ${missing.map((m) => m.name || `{{${m.position}}}`).join(', ')}`,
          code: 'MISSING_VARIABLES',
        });
        continue;
      }

      accepted.push({ phone: phoneCheck.phone, variables, name: recipient?.name ?? null });
    }

    return { accepted, rejected };
  },

  /**
   * resolveLeads — one Lead per accepted phone, created if needed.
   *
   * findOneAndUpsert is the repository's existing atomic upsert (it uses
   * $setOnInsert, so an existing contact's real name, owner and tags are never
   * overwritten by whatever the API call happened to pass).
   */
  async resolveLeads(ctx, accepted) {
    const resolved = [];
    const failed = [];

    for (const recipient of accepted) {
      let lead = null;

      try {
        ({ lead } = await leadRepository.findOneAndUpsert(
          { tenant_id: ctx.tenantId, phone: recipient.phone },
          {
            tenant_id: ctx.tenantId,
            phone: recipient.phone,
            whatsapp_number: recipient.phone,
            name: recipient.name || recipient.phone,
            source: 'API',
          }
        ));
      } catch (err) {
        console.warn(`[apiCampaign] contact upsert failed for ${recipient.phone}: ${err.message}`);
      }

      if (lead) {
        resolved.push({ lead, variables: recipient.variables, phone: recipient.phone });
      } else {
        // A recipient that is neither queued nor reported as rejected is the
        // worst possible outcome: the caller sees requested 1, queued 0,
        // rejected 0 and has nothing to act on. Whatever the cause, it gets
        // counted and named.
        failed.push({
          phone: recipient.phone,
          reason: 'Could not create or load the contact record for this number',
          code: 'CONTACT_RESOLUTION_FAILED',
        });
      }
    }

    return { resolved, failed };
  },

  /**
   * claimIdempotencyKey — see idempotencyRecord.model.js for the full
   * reasoning. Returns { replay } when this exact request already ran.
   */
  async claimIdempotencyKey(ctx, { key, scope, body }) {
    if (!key) return { claimed: true, record: null };

    const requestHash = hashRequest(body);

    try {
      const record = await IdempotencyRecord.create({
        tenantId: String(ctx.tenantId),
        key,
        scope,
        requestHash,
      });
      return { claimed: true, record };
    } catch (err) {
      // 11000 = unique index violation = this key was already used.
      if (err?.code !== 11000) throw err;

      const existing = await IdempotencyRecord.findOne({ tenantId: String(ctx.tenantId), key });

      if (existing && existing.requestHash !== requestHash) {
        throw new AppError(
          422,
          'This Idempotency-Key was already used for a different request body. Use a new key for each distinct request.'
        );
      }

      if (!existing?.response) {
        // First attempt is still running. Saying "retry shortly" is the only
        // honest answer — we don't yet know whether it will succeed.
        throw new AppError(
          409,
          'A request with this Idempotency-Key is still being processed. Retry in a few seconds.'
        );
      }

      return { claimed: false, replay: existing.response };
    }
  },

  /**
   * trigger — the endpoint's whole job, in order.
   */
  async trigger(ctx, { campaignId, recipients, idempotencyKey = null, rawBody = null, apiKey = null }) {
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw new AppError(400, '"recipients" must be a non-empty array');
    }
    if (recipients.length > MAX_RECIPIENTS_PER_REQUEST) {
      throw new AppError(
        413,
        `A single request can carry at most ${MAX_RECIPIENTS_PER_REQUEST} recipients (received ${recipients.length}). Split the batch across multiple calls.`
      );
    }

    // Claimed before any work, so a crash leaves the key taken rather than
    // free for a duplicate send.
    const idem = await this.claimIdempotencyKey(ctx, {
      key: idempotencyKey,
      scope: `campaigns:trigger:${campaignId}`,
      body: rawBody,
    });
    if (idem.claimed === false) return { ...idem.replay, idempotentReplay: true };

    const { campaign, template } = await this.assertTriggerable(ctx, campaignId);
    const { accepted, rejected } = this.validateRecipients(recipients, template);

    const run = await CampaignRun.create({
      tenantId:       String(ctx.tenantId),
      campaignId:     campaign._id,
      source:         RUN_SOURCE.API,
      status:         RUN_STATUS.QUEUED,
      apiKeyId:       apiKey?._id ?? null,
      apiKeyPrefix:   apiKey?.prefix ?? '',
      idempotencyKey: idempotencyKey || null,
      requestedCount: recipients.length,
      rejectedCount:  rejected.length,
      // Capped: a caller sending 1000 malformed numbers should get a usable
      // sample, not a document that has to store all 1000.
      rejectedRecipients: rejected.slice(0, 100),
    });

    // Every recipient was rejected — fail the run immediately rather than
    // enqueueing nothing and leaving it QUEUED forever.
    if (accepted.length === 0) {
      run.status = RUN_STATUS.FAILED;
      run.failureReason = 'No valid recipients in request';
      run.completedAt = new Date();
      await run.save();

      const response = this.toRunResponse(run, campaign, rejected);
      await this.storeIdempotentResponse(idem.record, response);
      return response;
    }

    const { resolved, failed } = await this.resolveLeads(ctx, accepted);

    // Fold resolution failures into the same rejected list the caller already
    // reads, so there is exactly one place to look for "why didn't this
    // number get it".
    if (failed.length) {
      rejected.push(...failed);
      run.rejectedCount = rejected.length;
      run.rejectedRecipients = rejected.slice(0, 100);
    }

    if (resolved.length === 0) {
      run.status = RUN_STATUS.FAILED;
      run.failureReason = 'No recipients could be prepared for sending';
      run.completedAt = new Date();
      await run.save();

      const response = this.toRunResponse(run, campaign, rejected);
      await this.storeIdempotentResponse(idem.record, response);
      return response;
    }

    const variablesByLeadId = {};
    for (const item of resolved) variablesByLeadId[String(item.lead._id)] = item.variables;

    run.queuedCount = resolved.length;
    await run.save();

    await enqueueCampaignSend(ctx, {
      kind: 'campaign',
      entityId: campaign._id,
      leadIds: resolved.map((item) => item.lead._id),
      runId: run._id,
      variablesByLeadId,
    });

    // Returns here — the HTTP request is done. The worker drains the queue and
    // moves the run to COMPLETED/FAILED on its own, which is what keeps a
    // 1000-recipient trigger from holding a connection open.
    const response = this.toRunResponse(run, campaign, rejected);
    await this.storeIdempotentResponse(idem.record, response);
    return response;
  },

  async storeIdempotentResponse(record, response) {
    if (!record) return;
    await IdempotencyRecord.updateOne({ _id: record._id }, { $set: { response } }).catch(() => {
      // A failure here only costs idempotency on a retry within 24h; it must
      // not fail a send that has already been accepted.
    });
  },

  toRunResponse(run, campaign, rejected = []) {
    return {
      runId:           String(run._id),
      campaignId:      String(campaign._id),
      campaignName:    campaign.name,
      status:          run.status === RUN_STATUS.FAILED ? 'failed' : 'queued',
      requestedCount:  run.requestedCount,
      queuedCount:     run.queuedCount,
      rejectedCount:   run.rejectedCount,
      // Trimmed in the response too: enough to debug, not enough to make the
      // payload unwieldy. The full stored list is on the run in the dashboard.
      rejected:        rejected.slice(0, 50),
    };
  },

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * setStatus — the API campaign state machine.
   *
   * Deliberately separate from campaigns.service.js's approveCampaign, which
   * requires an audience before approval. That requirement is right for a
   * dashboard campaign and wrong here by definition: an API campaign has no
   * saved audience, because every trigger brings its own recipients. Reusing
   * approveCampaign would have meant either weakening a check that protects
   * broadcast sends, or inventing a fake audience to satisfy it -- both worse
   * than a small separate path.
   *
   * What it DOES reuse: the same campaign record, the same template
   * validation, the same repository. Only the transition rules differ.
   */
  async setStatus(ctx, campaignId, nextStatus, { comment = '' } = {}) {
    const campaign = await campaignsRepository.findById(ctx.tenantId, campaignId);
    if (!campaign) throw new AppError(404, 'Campaign not found');

    if (campaign.type !== CAMPAIGN_TYPE.API) {
      throw new AppError(400, 'This endpoint only manages API campaigns. Use the campaign approval flow for dashboard campaigns.');
    }

    const allowed = API_ALLOWED_TRANSITIONS[campaign.status] || [];
    if (!allowed.includes(nextStatus)) {
      throw new AppError(409, `An API campaign cannot go from ${campaign.status} to ${nextStatus}.`);
    }

    // Only when switching ON. Re-checked here rather than only at create time
    // because Meta can withdraw template approval in between, and an endpoint
    // that goes live with a dead template fails on every single request.
    if (nextStatus === CAMPAIGN_STATUS.ACTIVE) {
      const template = await templatesRepository.findById(ctx.tenantId, campaign.templateId);
      if (!template) {
        throw new AppError(409, 'The template attached to this campaign no longer exists. Attach an approved template before activating.');
      }
      if (template.approvalStatus !== APPROVAL_STATUS.PROVIDER_APPROVED) {
        throw new AppError(
          409,
          `The template "${template.name}" is not approved by Meta (current status: ${template.approvalStatus}). Only approved templates can be activated.`
        );
      }
    }

    const updated = await campaignsRepository.updateCampaign(ctx.tenantId, campaignId, {
      status: nextStatus,
      ...(comment ? { lastStatusComment: comment } : {}),
    });

    return updated;
  },

  activate(ctx, campaignId, opts) {
    return this.setStatus(ctx, campaignId, CAMPAIGN_STATUS.ACTIVE, opts);
  },

  pause(ctx, campaignId, opts) {
    // Note: pausing stops NEW triggers only. Runs already queued keep draining
    // -- their messages are with the worker, and silently dropping messages a
    // caller was told were accepted would be worse than finishing them.
    return this.setStatus(ctx, campaignId, CAMPAIGN_STATUS.PAUSED, opts);
  },

  archive(ctx, campaignId, opts) {
    return this.setStatus(ctx, campaignId, CAMPAIGN_STATUS.CANCELLED, opts);
  },

  /** Recent runs for the dashboard's "Recent API runs" panel. */
  async listRuns(ctx, campaignId, { limit = 20, page = 1 } = {}) {
    const filter = { tenantId: String(ctx.tenantId) };
    if (campaignId) filter.campaignId = campaignId;

    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * safeLimit;

    const [runs, total] = await Promise.all([
      CampaignRun.find(filter).sort({ created_at: -1 }).skip(skip).limit(safeLimit),
      CampaignRun.countDocuments(filter),
    ]);

    return { runs: runs.map(toRunDTO), total, page: Number(page) || 1, limit: safeLimit };
  },

  async getRun(ctx, runId) {
    const run = await CampaignRun.findOne({ _id: runId, tenantId: String(ctx.tenantId) });
    if (!run) throw new AppError(404, 'Run not found');
    return toRunDTO(run);
  },
};

export const toRunDTO = (run) => ({
  id:             String(run._id),
  campaignId:     String(run.campaignId),
  source:         run.source,
  status:         run.status,
  apiKeyPrefix:   run.apiKeyPrefix,
  idempotencyKey: run.idempotencyKey,
  requestedCount: run.requestedCount,
  queuedCount:    run.queuedCount,
  rejectedCount:  run.rejectedCount,
  sentCount:      run.sentCount,
  failedCount:    run.failedCount,
  skippedCount:   run.skippedCount,
  rejectedRecipients: run.rejectedRecipients,
  failureReason:  run.failureReason,
  startedAt:      run.startedAt,
  completedAt:    run.completedAt,
  createdAt:      run.created_at,
});

export default apiCampaignService;