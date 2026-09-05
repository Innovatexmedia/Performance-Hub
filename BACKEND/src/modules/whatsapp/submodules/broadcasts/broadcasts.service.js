/**
 * WhatsApp Broadcasts — service.
 *
 * Extends the campaign pattern with strict consent + opt-out enforcement.
 * calculateAudience returns a breakdown of eligible vs excluded contacts.
 * Excluded contacts are logged as individual activity records.
 * templateApprovalService.assertUsable enforces PROVIDER_APPROVED templates.
 *
 * Audience resolution queries the real Lead collection (the data your
 * Contacts/Leads tab and the real inbound-webhook pipeline actually
 * populate) -- NOT the separate, unused WhatsAppContact collection this
 * file previously queried.
 */
import { AppError } from '../../../../shared/helpers/lead.helpers.js';
import { activityService } from '../../../leads/activities/activity.service.js';
import { ACTIVITY_TYPE }   from '../../../leads/activities/activity.model.js';
import { Lead } from '../../../leads/lead/lead.model.js';
import { Message, MESSAGE_STATUS } from '../../messages/message.model.js';
import { CONSENT_STATUS as LEAD_CONSENT_STATUS } from '../../../leads/lead/lead.constants.js';
import { templateApprovalService } from '../templateApproval/templateApproval.service.js';
import { campaignSenderService } from '../../campaignSender.service.js';
import { broadcastsRepository } from './broadcasts.repository.js';
import {
  BROADCAST_STATUS,
  BROADCAST_ACTION,
  ALLOWED_TRANSITIONS,
  READ_ONLY_STATUSES,
  LOCKED_STATUSES,
  SEARCHABLE_FIELDS,
  SORTABLE_FIELDS,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from './broadcasts.constants.js';

const ENTITY_TYPE = 'whatsapp_broadcast';

// ── Helpers ────────────────────────────────────────────────────────────────────

function toBroadcastDTO(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const { _id, ...rest } = o;
  return { id: String(_id ?? o.id), ...rest };
}

function buildAuditEntry(fromStatus, toStatus, action, performedBy, comment = '') {
  return {
    fromStatus,
    toStatus,
    action,
    performedBy: performedBy ?? null,
    performedAt: new Date(),
    comment,
  };
}

async function logActivity(ctx, broadcast, type, message, meta = {}) {
  await activityService.logEntity(
    ctx,
    { entityType: ENTITY_TYPE, entityId: broadcast._id ?? broadcast.id },
    type,
    { message, meta: { broadcastId: String(broadcast._id ?? broadcast.id), ...meta } },
  );
}

function buildFilter(query = {}) {
  const filter = {};
  if (query.status)     filter.status = query.status;
  if (query.type)       filter.type = query.type;
  if (query.provider)   filter.provider = query.provider;
  if (query.templateId) filter.templateId = query.templateId;
  if (query.createdBy)  filter.createdBy = query.createdBy;
  if (query.isActive !== undefined)
    filter.isActive = query.isActive === true || query.isActive === 'true';

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

// ── Audience resolution ────────────────────────────────────────────────────────

/**
 * Build the MongoDB query for eligible recipients.
 * Broadcasts enforce: consent_status='granted' + opt_out_status is not true.
 */
export function buildBaseContactQuery(tenantId, filters = {}) {
  const query = {
    tenant_id: tenantId,
    consent_status: LEAD_CONSENT_STATUS.GRANTED,
    opt_out_status: { $ne: true },
  };

  if (filters.tags?.length)         query.tags = { $all: filters.tags };
  if (filters.source)               query.source = filters.source;
  if (filters.assignedUserId)       query.assigned_user_id = filters.assignedUserId;
  // group_ids is an array on Lead (multi-membership) -- `{ group_ids: X }`
  // resolves as "array contains X" in Mongo, same query shape as an
  // equals-match on a single value would have been.
  if (filters.groupId)              query.group_ids = filters.groupId;
  // NOTE: filters.status intentionally not mapped -- see comment in
  // campaigns.service.js buildAudienceQuery for why.
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
  return query;
}

/**
 * Returns a full audience breakdown:
 *   totalMatched           — contacts matching the raw filters (no consent check)
 *   optedOutCount          — contacts excluded because optOutStatus=OPTED_OUT
 *   suppressedCount        — contacts excluded because consentStatus≠CONSENTED
 *   excludedRecipientCount — total excluded (opted-out + suppressed)
 *   recipientCount         — eligible recipients after all exclusions
 */
async function resolveAudienceSummary(tenantId, audience = {}) {
  const { filters = {}, includedContacts = [], excludedContacts = [] } = audience;

  // Total contacts that match the raw filters (no consent filter).
  const rawQuery = {
    tenant_id: tenantId,
    ...(filters.tags?.length         ? { tags: { $all: filters.tags } }             : {}),
    ...(filters.source               ? { source: filters.source }                    : {}),
    ...(filters.assignedUserId       ? { assigned_user_id: filters.assignedUserId }  : {}),
    ...(filters.groupId              ? { group_ids: filters.groupId }                 : {}),
    // NOTE: filters.status intentionally not mapped -- see comment in
    // campaigns.service.js buildAudienceQuery for why.
  };
  if (filters.minimumScore !== undefined || filters.maximumScore !== undefined) {
    rawQuery.qualification_score = {};
    if (filters.minimumScore !== undefined) rawQuery.qualification_score.$gte = Number(filters.minimumScore);
    if (filters.maximumScore !== undefined) rawQuery.qualification_score.$lte = Number(filters.maximumScore);
  }
  if (includedContacts?.length) rawQuery._id = { $in: includedContacts };
  if (excludedContacts?.length) rawQuery._id = { ...(rawQuery._id || {}), $nin: excludedContacts };

  const [totalMatched, optedOutCount, suppressedCount, recipientCount] = await Promise.all([
    Lead.countDocuments(rawQuery),

    // Opted-out within that raw set.
    Lead.countDocuments({ ...rawQuery, opt_out_status: true }),

    // Non-consented (but not opted-out) within that raw set.
    Lead.countDocuments({
      ...rawQuery,
      opt_out_status:  { $ne: true },
      consent_status: { $ne: LEAD_CONSENT_STATUS.GRANTED },
    }),

    // Eligible (consent + not opted-out) within that raw set.
    Lead.countDocuments({
      ...rawQuery,
      consent_status: LEAD_CONSENT_STATUS.GRANTED,
      opt_out_status:  { $ne: true },
    }),
  ]);

  const excludedRecipientCount = totalMatched - recipientCount;

  return {
    totalMatched,
    recipientCount,
    excludedRecipientCount,
    optedOutCount,
    suppressedCount,
  };
}

// ── Service ────────────────────────────────────────────────────────────────────

export const broadcastsService = {

  validateStatusTransition(fromStatus, toStatus) {
    const allowed = ALLOWED_TRANSITIONS[fromStatus] || [];
    if (!allowed.includes(toStatus)) {
      throw new AppError(409, `Invalid broadcast transition: ${fromStatus} → ${toStatus}`);
    }
  },

  async validateTemplate(ctx, templateId) {
    if (!templateId) throw new AppError(400, 'templateId is required');
    return templateApprovalService.assertUsable(ctx, String(templateId));
  },

  // ── Audience ───────────────────────────────────────────────────────────────

  async calculateAudience(ctx, audience = {}) {
    return resolveAudienceSummary(ctx.tenantId, audience);
  },

  async previewAudience(ctx, audience = {}) {
    const summary = await resolveAudienceSummary(ctx.tenantId, audience);
    const SAMPLE_SIZE = 25;
    const eligibleQuery = buildBaseContactQuery(ctx.tenantId, audience.filters || {});
    if (audience.includedContacts?.length) eligibleQuery._id = { $in: audience.includedContacts };
    if (audience.excludedContacts?.length) eligibleQuery._id = { ...(eligibleQuery._id || {}), $nin: audience.excludedContacts };

    const sampleDocs = await Lead.find(eligibleQuery)
      .select('name phone whatsapp_number source qualification_score')
      .sort({ createdAt: -1 })
      .limit(SAMPLE_SIZE)
      .lean();

    return {
      recipientCount:         summary.recipientCount,
      excludedRecipientCount: summary.excludedRecipientCount,
      optedOutCount:          summary.optedOutCount,
      suppressedCount:        summary.suppressedCount,
      sample: sampleDocs.map((l) => ({
        id: String(l._id),
        name: l.name || '',
        phone: l.whatsapp_number || l.phone || '',
        source: l.source || '',
        qualificationScore: l.qualification_score ?? null,
      })),
      sampleTruncated: summary.recipientCount > SAMPLE_SIZE,
    };
  },

  // ── CRUD ───────────────────────────────────────────────────────────────────

  async createBroadcast(ctx, data) {
    const template = await this.validateTemplate(ctx, data.templateId);

    const audienceSummary = data.audience
      ? await resolveAudienceSummary(ctx.tenantId, data.audience)
      : { totalMatched: 0, recipientCount: 0, excludedRecipientCount: 0, optedOutCount: 0, suppressedCount: 0 };

    const auditEntry = buildAuditEntry(null, BROADCAST_STATUS.DRAFT, BROADCAST_ACTION.CREATE, ctx.userId);

    const broadcast = await broadcastsRepository.createBroadcast({
      ...data,
      tenantId:       ctx.tenantId,
      broadcastFlag:  true,
      templateName:   template.name || '',
      provider:       data.provider || template.provider || '',
      status:         BROADCAST_STATUS.DRAFT,
      audienceSummary,
      recipientCount: audienceSummary.recipientCount,
      metrics: {
        recipientCount:   audienceSummary.recipientCount,
        sentCount: 0, deliveredCount: 0, readCount: 0,
        repliedCount: 0, failedCount: 0, bookingCount: 0,
        paymentCount: 0, revenueGenerated: 0, optOutCount: 0,
      },
      auditLog:  [auditEntry],
      isActive:  true,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });

    await logActivity(ctx, broadcast, ACTIVITY_TYPE.WHATSAPP_BROADCAST_CREATED,
      `Broadcast "${broadcast.name}" created`,
      { type: broadcast.type, templateId: String(data.templateId) });

    return toBroadcastDTO(broadcast);
  },

  /** resendFailed -- see campaigns.service.js's resendFailed doc comment
   * for the full reasoning (same pattern: a new broadcast targeting only
   * the leads whose message failed in the original, not reopening it). */
  async resendFailed(ctx, id) {
    const original = await broadcastsRepository.findById(ctx.tenantId, id);
    if (!original) throw new AppError(404, 'Broadcast not found');
    if (![BROADCAST_STATUS.COMPLETED, BROADCAST_STATUS.FAILED].includes(original.status)) {
      throw new AppError(400, 'Only a completed or failed broadcast can be resent.');
    }

    const failedLeadIds = await Message.find({
      tenant_id: ctx.tenantId,
      source_type: 'BROADCAST',
      source_id: original._id,
      status: MESSAGE_STATUS.FAILED,
    }).distinct('lead_id');

    if (failedLeadIds.length === 0) {
      throw new AppError(400, 'No failed sends on this broadcast to resend.');
    }

    return this.createBroadcast(ctx, {
      name: `${original.name} (Retry)`,
      type: original.type,
      templateId: original.templateId,
      audience: { filters: {}, includedContacts: failedLeadIds.map(String) },
    });
  },

  async getBroadcast(ctx, id) {
    const broadcast = await broadcastsRepository.findById(ctx.tenantId, id);
    if (!broadcast) throw new AppError(404, 'Broadcast not found');
    return toBroadcastDTO(broadcast);
  },

  async listBroadcasts(ctx, query) {
    const filter = buildFilter(query);
    const sort   = buildSort(query.sort);
    const { page, limit, skip } = paging(query);

    const [items, total] = await Promise.all([
      broadcastsRepository.listBroadcasts(ctx.tenantId, filter, { sort, skip, limit }),
      broadcastsRepository.countBroadcasts(ctx.tenantId, filter),
    ]);

    return {
      data: items.map(toBroadcastDTO),
      pagination: {
        page, limit, total,
        totalPages: Math.ceil(total / limit) || 0,
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  },

  async updateBroadcast(ctx, id, patch) {
    const existing = await broadcastsRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Broadcast not found');
    if (LOCKED_STATUSES.includes(existing.status)) {
      throw new AppError(409, `Broadcast in ${existing.status} status cannot be edited`);
    }

    if (patch.templateId && String(patch.templateId) !== String(existing.templateId)) {
      const template = await this.validateTemplate(ctx, patch.templateId);
      patch.templateName = template.name || '';
      patch.provider     = patch.provider || template.provider || existing.provider;
    }

    if (patch.audience) {
      const summary       = await resolveAudienceSummary(ctx.tenantId, patch.audience);
      patch.audienceSummary         = summary;
      patch.recipientCount          = summary.recipientCount;
      patch['metrics.recipientCount'] = summary.recipientCount;
    }

    patch.updatedBy = ctx.userId;
    const updated = await broadcastsRepository.updateBroadcast(ctx.tenantId, id, patch);

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_BROADCAST_UPDATED,
      'Broadcast updated', { fields: Object.keys(patch) });

    return toBroadcastDTO(updated);
  },

  async deleteBroadcast(ctx, id) {
    const existing = await broadcastsRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Broadcast not found');
    if (READ_ONLY_STATUSES.includes(existing.status)) {
      throw new AppError(409, `Broadcast in ${existing.status} status cannot be deleted`);
    }

    await broadcastsRepository.deleteBroadcast(ctx.tenantId, id);
    await logActivity(ctx, existing, ACTIVITY_TYPE.WHATSAPP_BROADCAST_DELETED,
      `Broadcast "${existing.name}" deleted`);

    return { id: String(existing._id), deleted: true };
  },

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async approveBroadcast(ctx, id, { comment = '' } = {}) {
    const existing = await broadcastsRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Broadcast not found');
    this.validateStatusTransition(existing.status, BROADCAST_STATUS.APPROVED);

    await this.validateTemplate(ctx, existing.templateId);

    if (!existing.audience?.filters && !existing.audience?.includedContacts?.length) {
      throw new AppError(400, 'Broadcast must have an audience before it can be approved');
    }

    const now = new Date();
    const auditEntry = buildAuditEntry(existing.status, BROADCAST_STATUS.APPROVED, BROADCAST_ACTION.APPROVE, ctx.userId, comment);
    const updated = await broadcastsRepository.approveBroadcast(ctx.tenantId, id, {
      approvedBy: ctx.userId, now, auditEntry,
    });

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_BROADCAST_APPROVED,
      'Broadcast approved', { comment });
    return toBroadcastDTO(updated);
  },

  async scheduleBroadcast(ctx, id, { scheduledAt, comment = '' } = {}) {
    const existing = await broadcastsRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Broadcast not found');
    this.validateStatusTransition(existing.status, BROADCAST_STATUS.SCHEDULED);

    const schedDate = new Date(scheduledAt);
    if (isNaN(schedDate.getTime())) throw new AppError(400, 'scheduledAt must be a valid date');
    if (schedDate <= new Date())    throw new AppError(400, 'scheduledAt must be a future date');

    const auditEntry = buildAuditEntry(existing.status, BROADCAST_STATUS.SCHEDULED, BROADCAST_ACTION.SCHEDULE, ctx.userId, comment);
    const updated = await broadcastsRepository.scheduleBroadcast(ctx.tenantId, id, {
      scheduledAt: schedDate, performedBy: ctx.userId, auditEntry,
    });

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_BROADCAST_SCHEDULED,
      `Broadcast scheduled for ${schedDate.toISOString()}`, { scheduledAt: schedDate });
    return toBroadcastDTO(updated);
  },

  async startBroadcast(ctx, id, { comment = '' } = {}) {
    const existing = await broadcastsRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Broadcast not found');
    this.validateStatusTransition(existing.status, BROADCAST_STATUS.RUNNING);

    await this.validateTemplate(ctx, existing.templateId);

    // Recalculate eligible audience at start time.
    const audienceSummary = await resolveAudienceSummary(ctx.tenantId, existing.audience);

    if (audienceSummary.recipientCount === 0) {
      throw new AppError(400, 'Broadcast has zero eligible recipients after consent/opt-out filtering');
    }

    // Log each exclusion bucket as a broadcast-level activity.
    if (audienceSummary.optedOutCount > 0) {
      await logActivity(ctx, existing, ACTIVITY_TYPE.WHATSAPP_CONTACT_EXCLUDED_OPT_OUT,
        `${audienceSummary.optedOutCount} opted-out contact(s) excluded from broadcast`,
        { count: audienceSummary.optedOutCount });
    }
    if (audienceSummary.suppressedCount > 0) {
      await logActivity(ctx, existing, ACTIVITY_TYPE.WHATSAPP_CONTACT_EXCLUDED_SUPPRESSED,
        `${audienceSummary.suppressedCount} suppressed/non-consented contact(s) excluded from broadcast`,
        { count: audienceSummary.suppressedCount });
    }

    const now = new Date();
    const auditEntry = buildAuditEntry(existing.status, BROADCAST_STATUS.RUNNING, BROADCAST_ACTION.START, ctx.userId, comment);
    const updated = await broadcastsRepository.startBroadcast(ctx.tenantId, id, {
      performedBy: ctx.userId, now, audienceSummary, auditEntry,
    });

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_BROADCAST_STARTED,
      'Broadcast started', {
        recipientCount:         audienceSummary.recipientCount,
        excludedRecipientCount: audienceSummary.excludedRecipientCount,
      });

    campaignSenderService
      .dispatch(ctx, { id, kind: 'broadcast' })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('campaignSenderService.dispatch threw unexpectedly for broadcast', id, err);
      });

    return toBroadcastDTO(updated);
  },

  async completeBroadcast(ctx, id, { comment = '' } = {}) {
    const existing = await broadcastsRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Broadcast not found');
    this.validateStatusTransition(existing.status, BROADCAST_STATUS.COMPLETED);

    const now = new Date();
    const auditEntry = buildAuditEntry(existing.status, BROADCAST_STATUS.COMPLETED, BROADCAST_ACTION.COMPLETE, ctx.userId, comment);
    const updated = await broadcastsRepository.completeBroadcast(ctx.tenantId, id, {
      performedBy: ctx.userId, now, auditEntry,
    });

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_BROADCAST_COMPLETED, 'Broadcast completed');
    return toBroadcastDTO(updated);
  },

  async failBroadcast(ctx, id, { failureReason = '', comment = '' } = {}) {
    const existing = await broadcastsRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Broadcast not found');
    this.validateStatusTransition(existing.status, BROADCAST_STATUS.FAILED);

    const auditEntry = buildAuditEntry(existing.status, BROADCAST_STATUS.FAILED, BROADCAST_ACTION.FAIL, ctx.userId, comment || failureReason);
    const updated = await broadcastsRepository.failBroadcast(ctx.tenantId, id, {
      failureReason, performedBy: ctx.userId, auditEntry,
    });

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_BROADCAST_FAILED,
      'Broadcast failed', { failureReason });
    return toBroadcastDTO(updated);
  },

  async cancelBroadcast(ctx, id, { comment = '' } = {}) {
    const existing = await broadcastsRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Broadcast not found');
    this.validateStatusTransition(existing.status, BROADCAST_STATUS.CANCELLED);

    // Same fix as campaigns.service.js's cancelCampaign -- a small/fast
    // broadcast can finish processing every recipient within seconds of
    // "Start", and cancelling after that point has nothing left to stop.
    const alreadyFullyProcessed = existing.recipientCount > 0
      && (existing.sentCount + existing.failedCount + existing.skippedCount) >= existing.recipientCount;
    if (alreadyFullyProcessed) {
      throw new AppError(
        400,
        `This broadcast has already finished sending to all ${existing.recipientCount} recipient(s) -- there is nothing left to cancel. Refresh to see its final status.`,
      );
    }

    const auditEntry = buildAuditEntry(existing.status, BROADCAST_STATUS.CANCELLED, BROADCAST_ACTION.CANCEL, ctx.userId, comment);
    const updated = await broadcastsRepository.cancelBroadcast(ctx.tenantId, id, {
      performedBy: ctx.userId, auditEntry,
    });

    await logActivity(ctx, updated, ACTIVITY_TYPE.WHATSAPP_BROADCAST_CANCELLED,
      'Broadcast cancelled', { comment });
    return toBroadcastDTO(updated);
  },

  // ── Metrics ────────────────────────────────────────────────────────────────

  async updateMetrics(ctx, id, metricsIncrement) {
    const existing = await broadcastsRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Broadcast not found');
    const updated = await broadcastsRepository.updateMetrics(ctx.tenantId, id, metricsIncrement);
    return toBroadcastDTO(updated);
  },

  // ── validateRecipients (called before sending individual messages) ─────────
  /**
   * Returns true only if the contact is eligible for this broadcast.
   * Throws 403 with the reason if not, and logs the exclusion.
   */
  async validateRecipients(ctx, broadcastId, contactOptOutStatus, contactConsentStatus) {
    if (contactOptOutStatus === true) {
      await logActivity(ctx, { _id: broadcastId }, ACTIVITY_TYPE.WHATSAPP_CONTACT_EXCLUDED_OPT_OUT,
        'Contact skipped: opted out');
      throw new AppError(403, 'Contact has opted out of WhatsApp messaging');
    }
    if (contactConsentStatus !== LEAD_CONSENT_STATUS.GRANTED) {
      await logActivity(ctx, { _id: broadcastId }, ACTIVITY_TYPE.WHATSAPP_CONTACT_EXCLUDED_SUPPRESSED,
        'Contact skipped: no consent');
      throw new AppError(403, 'Contact has not given consent for WhatsApp messaging');
    }
    return true;
  },
};