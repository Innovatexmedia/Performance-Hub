
import { Lead } from '../leads/lead/lead.model.js';
import { emitToTenant } from '../../realtime/socket.js';

import { buildAudienceQuery as buildCampaignAudienceQuery } from './submodules/campaigns/campaigns.service.js';
import { buildBaseContactQuery } from './submodules/broadcasts/broadcasts.service.js';
import { templatesRepository } from './submodules/templates/templates.repository.js';
import { APPROVAL_STATUS } from './submodules/templates/templates.constants.js';
import { validateTemplateParams } from './templateParams.js';

import { KIND_CONFIG, toDTO } from './messageSender.js';
import { enqueueCampaignSend } from '../../queues/campaignSend.queue.js';

// buildQuery per kind -- kept here (not in messageSender.js) since both
// campaigns.service.js and broadcasts.service.js already import from
// their own repository layer, and pulling buildAudienceQuery into
// messageSender.js would create a circular import between that module
// and the two submodules. This is the only place buildQuery is needed
// now (the worker looks up individual leads by id, not by re-running the
// audience query), so keeping it local here is simplest.
const BUILD_QUERY = {
  campaign: (tenantId, audience) => buildCampaignAudienceQuery(tenantId, audience?.filters || {}, audience?.includedContacts, audience?.excludedContacts),
  broadcast: (tenantId, audience) => buildBaseContactQuery(tenantId, audience?.filters || {}),
};

export const campaignSenderService = {
  /**
   * Entry point -- called fire-and-forget (never awaited) right after a
   * campaign/broadcast transitions to RUNNING. Errors here must NEVER
   * throw back into the caller's request/response cycle -- everything is
   * caught and turned into a failCampaign/failBroadcast transition instead.
   *
   * Resolves the recipient list ONCE, at start time (same as before --
   * the audience is a snapshot at the moment "Start" was clicked, not
   * continuously re-evaluated), then hands off one job per recipient to
   * the queue and returns immediately. All per-recipient sending happens
   * in the worker process from here on.
   */
  async dispatch(ctx, { id, kind }) {
    const cfg = KIND_CONFIG[kind];
    if (!cfg) throw new Error(`campaignSenderService.dispatch: unknown kind "${kind}"`);

    console.log(`[CAMPAIGN_SEND] dispatch start -- kind=${kind} id=${id} tenant=${ctx.tenantId}`);

    try {
      const entity = await cfg.repository.findById(ctx.tenantId, id);
      if (!entity) {
        console.log(`[CAMPAIGN_SEND] ${kind} ${id} not found -- aborting (deleted mid-flight?)`);
        return;
      }

      const template = await templatesRepository.findById(ctx.tenantId, entity.templateId);
      if (!template || template.approvalStatus !== APPROVAL_STATUS.PROVIDER_APPROVED) {
        console.log(`[CAMPAIGN_SEND] ${kind} ${id} template not usable (found=${!!template}, approvalStatus=${template?.approvalStatus}) -- marking FAILED`);
        await this._markFailed(cfg, ctx, entity, 'Template is no longer provider-approved');
        return;
      }

      // Pre-flight: a parameter-count mismatch is fatal and identical for
      // every recipient (Meta error 132000). Catching it here costs one
      // check; catching it per-job costs one failed send per contact.
      const paramCheck = validateTemplateParams(template);
      if (!paramCheck.ok) {
        console.log(`[CAMPAIGN_SEND] ${kind} ${id} template parameter check failed -- ${paramCheck.reason}`);
        await this._markFailed(cfg, ctx, entity, `Template configuration error: ${paramCheck.reason}`);
        return;
      }

      const query = BUILD_QUERY[kind](ctx.tenantId, entity.audience);
      // Only IDs -- the worker re-fetches each full lead document fresh
      // at send time (so opt-out status etc. reflects reality at the
      // moment of sending, not this snapshot), so there's no reason to
      // pull thousands of full Lead documents into memory here just to
      // discard everything but the id.
      const leadIds = await Lead.find(query).distinct('_id');
      console.log(`[CAMPAIGN_SEND] ${kind} ${id} resolved ${leadIds.length} recipient(s) via query=${JSON.stringify(query)}`);

      if (leadIds.length === 0) {
        console.log(`[CAMPAIGN_SEND] ${kind} ${id} has zero recipients at send time -- marking FAILED`);
        await this._markFailed(cfg, ctx, entity, 'Zero recipients resolved at send time');
        return;
      }

      const { enqueued } = await enqueueCampaignSend(ctx, { kind, entityId: id, leadIds });
      console.log(`[CAMPAIGN_SEND] ${kind} ${id} enqueued ${enqueued} job(s) -- worker(s) will process, complete, and emit progress from here`);
    } catch (err) {
      // Whatever unexpected thing happened, the entity must not sit stuck
      // in RUNNING forever with no explanation.
      console.error(`[CAMPAIGN_SEND] ${kind} ${id} threw unexpectedly:`, err);
      try {
        const entity = await cfg.repository.findById(ctx.tenantId, id);
        if (entity && entity.status === cfg.STATUS.RUNNING) {
          await this._markFailed(cfg, ctx, entity, err.message || 'Unexpected error during send');
        }
      } catch { /* best-effort -- do not throw out of a fire-and-forget task */ }
    }
  },

  /** Used only for the pre-flight-failure paths above (template not
   * usable, param mismatch, zero recipients) -- i.e. failures BEFORE any
   * job is ever enqueued, so there's no concurrent worker to race
   * against and the plain (unguarded) transition is fine here. Once jobs
   * are enqueued, all completion/failure transitions go through the
   * worker's status-guarded *IfRunning variants instead (see
   * campaignSend.worker.js's maybeFinalize). */
  async _markFailed(cfg, ctx, entity, reason) {
    const auditEntry = { fromStatus: entity.status, toStatus: cfg.STATUS.FAILED, action: cfg.ACTION.FAIL, performedBy: null, performedAt: new Date(), comment: reason };
    const updated = await (cfg.repository.failCampaign?.(ctx.tenantId, entity._id, { failureReason: reason, performedBy: null, auditEntry })
      ?? cfg.repository.failBroadcast?.(ctx.tenantId, entity._id, { failureReason: reason, performedBy: null, auditEntry }));
    if (updated) emitToTenant(ctx.tenantId, cfg.socketEvent, { [`${cfg.payloadKey}Id`]: String(entity._id), [cfg.payloadKey]: toDTO(updated) });
  },
};