/**
 * WhatsApp Campaigns — service (business logic + workflow engine).
 *
 * Owns status-transition validation, template-approval guard (delegates to
 * templateApprovalService.assertUsable), audience calculation against the
 * real Lead collection (the same data the Contacts/Leads tab and the real
 * inbound-webhook pipeline actually populate -- NOT the separate, unused
 * WhatsAppContact collection this file previously queried), activity
 * logging, and all lifecycle methods.
 */
import { AppError } from '../../../../shared/helpers/lead.helpers.js';
import { hasRole, ROLES } from '../../../auth/constants/roles.js';
import { PERMISSIONS } from '../../../auth/constants/permissions.js';
import { activityService } from '../../../leads/activities/activity.service.js';
import { ACTIVITY_TYPE }   from '../../../leads/activities/activity.model.js';
import { Lead } from '../../../leads/lead/lead.model.js';
import { Message, MESSAGE_STATUS } from '../../messages/message.model.js';
import { templateApprovalService } from '../templateApproval/templateApproval.service.js';
import { campaignSenderService } from '../../campaignSender.service.js';
import { campaignsRepository } from './campaigns.repository.js';
import {
  CAMPAIGN_STATUS,
  CAMPAIGN_ACTION,
  ALLOWED_TRANSITIONS,
  READ_ONLY_STATUSES,
  LOCKED_STATUSES,
  SEARCHABLE_FIELDS,
  SORTABLE_FIELDS,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from './campaigns.constants.js';

const ENTITY_TYPE = 'whatsapp_campaign';

// ── Internal helpers ──────────────────────────────────────────────────────────

function toCampaignDTO(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const { _id, ...rest } = o;
  return { id: String(_id ?? o.id), ...rest };
}

function buildAuditEntry(fromStatus, toStatus, action, performedBy, comment = '') {
  return { fromStatus, toStatus, action, performedBy: performedBy ?? null, performedAt: new Date(), comment };
}

async function logActivity(ctx, campaign, type, message, meta = {}) {
  await activityService.logEntity(
    ctx,
    { entityType: ENTITY_TYPE, entityId: campaign._id ?? campaign.id },
    type,
    { message, meta: { campaignId: String(campaign._id ?? campaign.id), ...meta } },
  );
}

function buildFilter(query = {}) {
  const filter = {};
  if (query.status)     filter.status = query.status;
  if (query.type)       filter.type = query.type;
  if (query.provider)   filter.provider = query.provider;
  if (query.templateId) filter.templateId = query.templateId;
  if (query.createdBy)  filter.createdBy = query.createdBy;
  if (query.isActive !== undefined) filter.isActive = query.isActive === true || query.isActive === 'true';

  if (query.startDate || query.endDate) {
    filter.createdAt = {};
    if (query.startDate) filter.createdAt.$gte = new Date(query.startDate);
    if (query.endDate)   filter.createdAt.$lte = new Date(query.endDate);
  }

  if (query.search) {
    const rx = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = SEARCHABLE_FIELDS.map((f) => ({ [f]: rx }));
  }
  return filter;
}

function buildSort(sort) {
  if (!sort) return { createdAt: -1 };
  const desc = sort.startsWith('-');
  const key  = desc ? sort.slice(1) : sort;
  if (!SORTABLE_FIELDS.includes(key)) return { createdAt: -1 };
  return { [key]: desc ? -1 : 1 };
}

function paging(query = {}) {
  const page  = Math.max(Number(query.page)  || DEFAULT_PAGE, 1);
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
}

// ── Audience resolution against the real Lead collection ─────────────────────

export function buildAudienceQuery(tenantId, filters = {}, includedContacts = [], excludedContacts = []) {
  // opt_out_status on Lead is a boolean (default false), not the
  // 'ACTIVE'/'OPTED_OUT' string enum WhatsAppContact used -- so "reachable"
  // means opt_out_status is not true.
  const query = { tenant_id: tenantId, opt_out_status: { $ne: true } };

  if (filters.tags?.length)         query.tags = { $all: filters.tags };
  if (filters.source)               query.source = filters.source;
  if (filters.consentStatus)        query.consent_status = filters.consentStatus;
  if (filters.optOutStatus)         query.opt_out_status = filters.optOutStatus === 'OPTED_OUT';
  if (filters.assignedUserId)       query.assigned_user_id = filters.assignedUserId;
  // group_ids is an array on Lead (multi-membership) -- `{ group_ids: X }`
  // resolves as "array contains X" in Mongo, same query shape as an
  // equals-match on a single value would have been.
  if (filters.groupId)              query.group_ids = filters.groupId;
  // NOTE: filters.status (contact status) is intentionally NOT mapped onto
  // Lead.status -- Lead's status is the pipeline stage (New/Qualified/Won/
  // Lost/etc), a different concept than the old WhatsAppContact "contact
  // status" this filter was built for. Repurposing it silently would be
  // misleading, so it's left unimplemented until a real decision is made.
  if (filters.minimumScore !== undefined || filters.maximumScore !== undefined) {
    query.qualification_score = {};
    if (filters.minimumScore !== undefined) query.qualification_score.$gte = Number(filters.minimumScore);
    if (filters.maximumScore !== undefined) query.qualification_score.$lte = Number(filters.maximumScore);
  }
  if (filters.createdAfter || filters.createdBefore) {
    query.created_at = {};
    if (filters.createdAfter)  query.created_at.$gte = new Date(filters.createdAfter);
    if (filters.createdBefore) query.created_at.$lte = new Date(filters.createdBefore);
  }
  if (filters.lastContactedAfter || filters.lastContactedBefore) {
    query.last_contacted_at = {};
    if (filters.lastContactedAfter)  query.last_contacted_at.$gte = new Date(filters.lastContactedAfter);
    if (filters.lastContactedBefore) query.last_contacted_at.$lte = new Date(filters.lastContactedBefore);
  }

  // Explicit include/exclude overrides.
  if (includedContacts?.length) {
    query._id = { $in: includedContacts };
  }
  if (excludedContacts?.length) {
    query._id = { ...(query._id || {}), $nin: excludedContacts };
  }

  return query;
}

// ── Service ───────────────────────────────────────────────────────────────────

export const campaignsService = {
  // ── Validation helpers ──────────────────────────────────────────────────

  validateStatusTransition(fromStatus, toStatus) {
    const allowed = ALLOWED_TRANSITIONS[fromStatus] || [];
    if (!allowed.includes(toStatus)) {
      throw new AppError(409, `Invalid campaign transition: ${fromStatus} → ${toStatus}`);
    }
  },

  async validateTemplate(ctx, templateId) {
    if (!templateId) throw new AppError(400, 'templateId is required');
    // Delegates to templateApprovalService — only PROVIDER_APPROVED templates pass.
    return templateApprovalService.assertUsable(ctx, String(templateId));
  },

  // ── Audience calculation ────────────────────────────────────────────────

  async calculateAudience(tenantId, audience = {}) {
    const { filters = {}, includedContacts = [], excludedContacts = [] } = audience;
    const query = buildAudienceQuery(tenantId, filters, includedContacts, excludedContacts);
    return Lead.countDocuments(query);
  },

  /** Same audience query as calculateAudience, but also returns a capped
   * sample of the actual matching leads (name/phone/source/score) so a
   * campaign creator can sanity-check the filters before sending, not just
   * see a bare number. */
  async previewAudience(ctx, audience = {}) {
    const { filters = {}, includedContacts = [], excludedContacts = [] } = audience;
    const query = buildAudienceQuery(ctx.tenantId, filters, includedContacts, excludedContacts);
    const SAMPLE_SIZE = 25;

    const [count, sampleDocs] = await Promise.all([
      Lead.countDocuments(query),
      Lead.find(query)
        .select('name phone whatsapp_number source qualification_score')
        .sort({ createdAt: -1 })
        .limit(SAMPLE_SIZE)
        .lean(),
    ]);

    return {
      recipientCount: count,
      sample: sampleDocs.map((l) => ({
        id: String(l._id),
        name: l.name || '',
        phone: l.whatsapp_number || l.phone || '',
        source: l.source || '',
        qualificationScore: l.qualification_score ?? null,
      })),
      sampleTruncated: count > SAMPLE_SIZE,
    };
  },

  // ── CRUD ────────────────────────────────────────────────────────────────

  async createCampaign(ctx, data) {
    const { templateId } = data;

    // Template must be provider-approved.
    const template = await this.validateTemplate(ctx, templateId);

    // Calculate initial recipient count.
    const recipientCount = data.audience
      ? await this.calculateAudience(ctx.tenantId, data.audience)
      : 0;

    const auditEntry = buildAuditEntry(null, CAMPAIGN_STATUS.DRAFT, CAMPAIGN_ACTION.CREATE, ctx.userId);

    const campaign = await campaignsRepository.createCampaign({
      ...data,
      tenantId:       ctx.tenantId,
      templateName:   template.name || '',
      provider:       data.provider || template.provider || '',
      status:         CAMPAIGN_STATUS.DRAFT,
      recipientCount,
      metrics: {
        recipientCount,
        sentCount: 0, deliveredCount: 0, readCount: 0,
        repliedCount: 0, failedCount: 0, bookingCount: 0,
        paymentCount: 0, revenueGenerated: 0,
      },
      auditLog:  [auditEntry],
      isActive:  true,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });

    await logActivity(ctx, campaign, ACTIVITY_TYPE.WHATSAPP_CAMPAIGN_CREATED,
      `Campaign "${campaign.name}" created`,
      { type: campaign.type, templateId: String(templateId) });

    // Owner bypass: per product decision, a Tenant Owner creating a
    // campaign should never see a separate "Approve" step -- just
    // Start/Schedule. approveCampaign() has no self-approval guard (unlike
    // templates), so this is safe to call with the same ctx unconditionally
    // for Owner/Super Admin. Non-owners (even with a custom
    // APPROVE_CAMPAIGNS grant elsewhere) still land in DRAFT here --
    // that permission is for approving OTHER people's campaigns from the
    // Campaigns tab, not for silently auto-approving their own creations.
    // Auto-approve on create for anyone who can self-approve anyway --
    // Tenant Admin/Owner/Super Admin by rank, OR a Sales User individually
    // granted APPROVE_CAMPAIGNS. Unlike templates, approving a campaign
    // never itself triggers a real send -- only startCampaign() does that,
    // and that always stays a separate, deliberate click for everyone
    // regardless of role -- so there's no equivalent "stop before the
    // real external action" concern here; auto-approving is safe as-is.
    const canSelfApprove = hasRole(ctx.role, ROLES.TENANT_ADMIN) || (ctx.permissions || []).includes(PERMISSIONS.APPROVE_CAMPAIGNS);
    if (canSelfApprove) {
      try {
        return await this.approveCampaign(ctx, campaign._id, { comment: 'Auto-approved: created by a user with approval rights' });
      } catch (err) {
        const current = await campaignsRepository.findById(ctx.tenantId, campaign._id);
        const dto = toCampaignDTO(current);
        dto.autoApproveError = err.message;
        return dto;
      }
    }

    return toCampaignDTO(campaign);
  },

  /**
   * resendFailed -- AiSensy's "Failed Retries" manual mode: creates a
   * NEW campaign targeting only the leads whose message failed in the
   * original, same template. Deliberately a fresh campaign rather than
   * reopening the original one:
   *   - The original's COMPLETED/FAILED status and metrics are a real
   *     historical record (this run sent to N people, M succeeded) --
   *     reopening it to append more sends would mean un-completing it
   *     and fudging the recipient-count math the BullMQ worker's
   *     completion detection relies on (see campaignSend.worker.js).
   *   - A separate "{name} (Retry)" campaign reuses 100% of the already
   *     real, tested create -> approve -> start pipeline (including the
   *     confirmation step, template-approval guard, and BullMQ send)
   *     with zero new queue/completion-logic risk.
   *   - Matches how real platforms (Interakt explicitly) present
   *     retries as distinct, inspectable records rather than silently
   *     merging retry numbers into the original campaign's stats.
   */
  async resendFailed(ctx, id) {
    const original = await campaignsRepository.findById(ctx.tenantId, id);
    if (!original) throw new AppError(404, 'Campaign not found');
    if (![CAMPAIGN_STATUS.COMPLETED, CAMPAIGN_STATUS.FAILED].includes(original.status)) {
      throw new AppError(400, 'Only a completed or failed campaign can be resent.');
    }

    const failedLeadIds = await Message.find({
      tenant_id: ctx.tenantId,
      source_type: 'CAMPAIGN',
      source_id: original._id,
      status: MESSAGE_STATUS.FAILED,
    }).distinct('lead_id');

    if (failedLeadIds.length === 0) {
      throw new AppError(400, 'No failed sends on this campaign to resend.');
    }

    return this.createCampaign(ctx, {
      name: `${original.name} (Retry)`,
      type: original.type,
      templateId: original.templateId,
      audience: { filters: {}, includedContacts: failedLeadIds.map(String) },
    });
  },

  async getCampaign(ctx, id) {
    const campaign = await campaignsRepository.findById(ctx.tenantId, id);
    if (!campaign) throw new AppError(404, 'Campaign not found');
    return toCampaignDTO(campaign);
  },

  async listCampaigns(ctx, query) {
    const filter = buildFilter(query);
    const sort   = buildSort(query.sort);
    const { page, limit, skip } = paging(query);

    const [items, total] = await Promise.all([
      campaignsRepository.listCampaigns(ctx.tenantId, filter, { sort, skip, limit }),
      campaignsRepository.countCampaigns(ctx.tenantId, filter),
    ]);

    return {
      data: items.map(toCampaignDTO),
      pagination: {
        page, limit, total,
        totalPages: Math.ceil(total / limit) || 0,
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  },

  async updateCampaign(ctx, id, patch) {
    const existing = await campaignsRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Campaign not found');

    if (LOCKED_STATUSES.includes(existing.status)) {
      throw new AppError(409, `Campaign in ${existing.status} status cannot be edited`);
    }

    // If template is changing, re-validate the new one.
    if (patch.templateId && String(patch.templateId) !== String(existing.templateId)) {
      const template = await this.validateTemplate(ctx, patch.templateId);
      patch.templateName = template.name || '';
      patch.provider     = patch.provider || template.provider || existing.provider;
    }

    // If audience is changing, recalculate.
    if (patch.audience) {
      patch.recipientCount = await this.calculateAudience(ctx.tenantId, patch.audience);
      patch['metrics.recipientCount'] = patch.recipientCount;
    }

    patch.updatedBy = ctx.userId;
    const updated = await campaignsRepository.updateCampaign(ctx.tenantId, id, patch);

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_CAMPAIGN_UPDATED,
      'Campaign updated', { fields: Object.keys(patch) });

    return toCampaignDTO(updated);
  },

  async deleteCampaign(ctx, id) {
    const existing = await campaignsRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Campaign not found');

    if (READ_ONLY_STATUSES.includes(existing.status)) {
      throw new AppError(409, `Campaign in ${existing.status} status cannot be deleted`);
    }

    await campaignsRepository.deleteCampaign(ctx.tenantId, id);

    await logActivity(ctx, existing, ACTIVITY_TYPE.WHATSAPP_CAMPAIGN_DELETED,
      `Campaign "${existing.name}" deleted`);

    return { id: String(existing._id), deleted: true };
  },

  // ── Lifecycle transitions ────────────────────────────────────────────────

  async approveCampaign(ctx, id, { comment = '' } = {}) {
    const existing = await campaignsRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Campaign not found');

    this.validateStatusTransition(existing.status, CAMPAIGN_STATUS.APPROVED);

    // Re-validate template still holds PROVIDER_APPROVED before approving.
    await this.validateTemplate(ctx, existing.templateId);

    if (!existing.audience || (!Object.keys(existing.audience.filters || {}).length &&
        !existing.audience.includedContacts?.length)) {
      throw new AppError(400, 'Campaign must have an audience before it can be approved');
    }

    const now = new Date();
    const auditEntry = buildAuditEntry(existing.status, CAMPAIGN_STATUS.APPROVED, CAMPAIGN_ACTION.APPROVE, ctx.userId, comment);

    const updated = await campaignsRepository.approveCampaign(ctx.tenantId, id, {
      approvedBy: ctx.userId, now, auditEntry,
    });

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_CAMPAIGN_APPROVED,
      'Campaign approved', { comment });

    return toCampaignDTO(updated);
  },

  async scheduleCampaign(ctx, id, { scheduledAt, comment = '' } = {}) {
    const existing = await campaignsRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Campaign not found');

    this.validateStatusTransition(existing.status, CAMPAIGN_STATUS.SCHEDULED);

    const schedDate = new Date(scheduledAt);
    if (isNaN(schedDate.getTime())) throw new AppError(400, 'scheduledAt must be a valid date');
    if (schedDate <= new Date())    throw new AppError(400, 'scheduledAt must be a future date');

    const now = new Date();
    const auditEntry = buildAuditEntry(existing.status, CAMPAIGN_STATUS.SCHEDULED, CAMPAIGN_ACTION.SCHEDULE, ctx.userId, comment);

    const updated = await campaignsRepository.scheduleCampaign(ctx.tenantId, id, {
      scheduledAt: schedDate, performedBy: ctx.userId, now, auditEntry,
    });

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_CAMPAIGN_SCHEDULED,
      `Campaign scheduled for ${schedDate.toISOString()}`, { scheduledAt: schedDate });

    return toCampaignDTO(updated);
  },

  async startCampaign(ctx, id, { comment = '' } = {}) {
    const existing = await campaignsRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Campaign not found');

    this.validateStatusTransition(existing.status, CAMPAIGN_STATUS.RUNNING);

    // Must have audience.
    const recipientCount = await this.calculateAudience(ctx.tenantId, existing.audience);
    if (recipientCount === 0) {
      throw new AppError(400, 'Campaign has zero recipients and cannot be started');
    }

    // Template must still be usable.
    await this.validateTemplate(ctx, existing.templateId);

    const now = new Date();
    const auditEntry = buildAuditEntry(existing.status, CAMPAIGN_STATUS.RUNNING, CAMPAIGN_ACTION.START, ctx.userId, comment);

    const updated = await campaignsRepository.startCampaign(ctx.tenantId, id, {
      performedBy: ctx.userId, now, auditEntry,
    });

    // Refresh recipient count at start time.
    await campaignsRepository.updateRecipientCount(ctx.tenantId, id, recipientCount);

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_CAMPAIGN_STARTED,
      'Campaign started', { recipientCount });

    // Fire-and-forget: the actual real send loop. Never awaited -- the HTTP
    // response returns immediately with status RUNNING, and the campaign
    // transitions itself to COMPLETED/FAILED once every recipient has been
    // attempted. Errors inside dispatch() are caught internally and turned
    // into a real failCampaign transition, never an unhandled rejection here.
    campaignSenderService
      .dispatch(ctx, { id, kind: 'campaign' })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('campaignSenderService.dispatch threw unexpectedly for campaign', id, err);
      });

    return toCampaignDTO(updated);
  },

  async completeCampaign(ctx, id, { comment = '' } = {}) {
    const existing = await campaignsRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Campaign not found');

    this.validateStatusTransition(existing.status, CAMPAIGN_STATUS.COMPLETED);

    const now = new Date();
    const auditEntry = buildAuditEntry(existing.status, CAMPAIGN_STATUS.COMPLETED, CAMPAIGN_ACTION.COMPLETE, ctx.userId, comment);

    const updated = await campaignsRepository.completeCampaign(ctx.tenantId, id, {
      performedBy: ctx.userId, now, auditEntry,
    });

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_CAMPAIGN_COMPLETED,
      'Campaign completed');

    return toCampaignDTO(updated);
  },

  async failCampaign(ctx, id, { failureReason = '', comment = '' } = {}) {
    const existing = await campaignsRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Campaign not found');

    this.validateStatusTransition(existing.status, CAMPAIGN_STATUS.FAILED);

    const now = new Date();
    const auditEntry = buildAuditEntry(existing.status, CAMPAIGN_STATUS.FAILED, CAMPAIGN_ACTION.FAIL, ctx.userId, comment || failureReason);

    const updated = await campaignsRepository.failCampaign(ctx.tenantId, id, {
      failureReason, performedBy: ctx.userId, now, auditEntry,
    });

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_CAMPAIGN_FAILED,
      'Campaign failed', { failureReason });

    return toCampaignDTO(updated);
  },

  async cancelCampaign(ctx, id, { comment = '' } = {}) {
    const existing = await campaignsRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Campaign not found');

    this.validateStatusTransition(existing.status, CAMPAIGN_STATUS.CANCELLED);

    // A small/fast campaign can finish processing every recipient within
    // seconds of "Start" -- if the person clicks Cancel after that point,
    // there is nothing left in flight to actually stop, and labeling the
    // result CANCELLED is actively misleading (it reads as "nothing was
    // sent" when messages genuinely went out). Block it here with a clear
    // reason instead of silently allowing a CANCELLED status that
    // disagrees with the campaign's own sent/failed counts.
    const alreadyFullyProcessed = existing.recipientCount > 0
      && (existing.sentCount + existing.failedCount + existing.skippedCount) >= existing.recipientCount;
    if (alreadyFullyProcessed) {
      throw new AppError(
        400,
        `This campaign has already finished sending to all ${existing.recipientCount} recipient(s) -- there is nothing left to cancel. Refresh to see its final status.`,
      );
    }

    const now = new Date();
    const auditEntry = buildAuditEntry(existing.status, CAMPAIGN_STATUS.CANCELLED, CAMPAIGN_ACTION.CANCEL, ctx.userId, comment);

    const updated = await campaignsRepository.cancelCampaign(ctx.tenantId, id, {
      performedBy: ctx.userId, now, auditEntry,
    });

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_CAMPAIGN_CANCELLED,
      'Campaign cancelled', { comment });

    return toCampaignDTO(updated);
  },

  // ── Metrics ─────────────────────────────────────────────────────────────

  async updateMetrics(ctx, id, metricsIncrement) {
    const existing = await campaignsRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Campaign not found');
    const updated = await campaignsRepository.updateMetrics(ctx.tenantId, id, metricsIncrement);
    return toCampaignDTO(updated);
  },
};