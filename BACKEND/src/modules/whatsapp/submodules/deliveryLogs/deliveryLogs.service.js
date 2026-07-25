/**
 * WhatsApp Delivery Logs — service.
 *
 * Contains ALL business logic:
 *   • Create delivery log (one per outbound message)
 *   • Update message status with transition validation
 *   • Record webhook events (status + timestamps + provider metadata)
 *   • Retry failed messages
 *   • Compute statistics (delivery / read / failure rates)
 *   • Tenant isolation, search & filters
 *
 * ── Integration helper ────────────────────────────────────────────────────────
 * Other modules create a log with a single call:
 *   await deliveryLogsService.createLog(ctx, {
 *     phoneNumber, provider, source: 'CAMPAIGN', campaignId, ...
 *   });
 * No changes needed here when a new source module or provider is added.
 */
import { AppError } from '../../../../shared/helpers/lead.helpers.js';
import { emitToTenant } from '../../../../realtime/socket.js';
import { deliveryLogsRepository } from './deliveryLogs.repository.js';
import {
  DELIVERY_STATUS,
  DELIVERY_STATUS_VALUES,
  ALLOWED_STATUS_TRANSITIONS,
  RETRYABLE_STATUSES,
  STATUS_TIMESTAMP_FIELD,
  SEARCHABLE_FIELDS,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from './deliveryLogs.constants.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function toDTO(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const { _id, ...rest } = o;
  return { id: String(_id ?? o.id), ...rest };
}

function escapeRegex(s = '') {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFilter(query = {}) {
  const filter = {};
  if (query.status)      filter.status = query.status;
  if (query.provider)    filter.provider = query.provider;
  if (query.messageType) filter.messageType = query.messageType;
  if (query.direction)   filter.direction = query.direction;
  if (query.campaignId)  filter.campaignId = query.campaignId;
  if (query.broadcastId) filter.broadcastId = query.broadcastId;
  if (query.automationRuleId) filter.automationRuleId = query.automationRuleId;
  if (query.contactId)   filter.contactId = query.contactId;
  if (query.leadId)      filter.leadId = query.leadId;
  if (query.source)      filter.source = query.source;

  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) filter.createdAt.$gte = new Date(query.dateFrom);
    if (query.dateTo)   filter.createdAt.$lte = new Date(query.dateTo);
  }

  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = SEARCHABLE_FIELDS.map((f) => ({ [f]: rx }));
  }
  return filter;
}

function buildSort(sort) {
  if (!sort) return { createdAt: -1 };
  const desc = sort.startsWith('-');
  const key  = desc ? sort.slice(1) : sort;
  const valid = ['createdAt', 'updatedAt', 'status', 'retryCount', 'sentAt'];
  return valid.includes(key) ? { [key]: desc ? -1 : 1 } : { createdAt: -1 };
}

function paging(query = {}) {
  const page  = Math.max(Number(query.page)  || DEFAULT_PAGE, 1);
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
}

/** Validate a status transition; throws 409 if not allowed. */
function assertValidTransition(from, to) {
  if (from === to) return; // idempotent updates are allowed
  const allowed = ALLOWED_STATUS_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new AppError(409, `Invalid status transition: ${from} → ${to}`);
  }
}

/** Build the $set object for a status change, auto-stamping the right timestamp. */
function buildStatusSet(status, extra = {}) {
  const set = { status, ...extra };
  const tsField = STATUS_TIMESTAMP_FIELD[status];
  if (tsField && !set[tsField]) set[tsField] = new Date();
  return set;
}

// ── Service ────────────────────────────────────────────────────────────────────

export const deliveryLogsService = {
  // ── Create ───────────────────────────────────────────────────────────────────

  async createLog(ctx, data) {
    if (!data.phoneNumber) throw new AppError(400, 'phoneNumber is required');
    if (!data.provider)    throw new AppError(400, 'provider is required');

    const log = await deliveryLogsRepository.createLog({
      ...data,
      tenantId:  ctx.tenantId,
      status:    data.status || DELIVERY_STATUS.QUEUED,
      createdBy: ctx.userId,
    });
    return toDTO(log);
  },

  // ── Read ─────────────────────────────────────────────────────────────────────

  async getLog(ctx, id) {
    const log = await deliveryLogsRepository.findById(ctx.tenantId, id);
    if (!log) throw new AppError(404, 'Delivery log not found');
    return toDTO(log);
  },

  async listLogs(ctx, query) {
    const filter = buildFilter(query);
    const sort   = buildSort(query.sort);
    const { page, limit, skip } = paging(query);
    const [items, total] = await Promise.all([
      deliveryLogsRepository.listLogs(ctx.tenantId, filter, { sort, skip, limit }),
      deliveryLogsRepository.countLogs(ctx.tenantId, filter),
    ]);
    return {
      data: items.map(toDTO),
      pagination: {
        page, limit, total,
        totalPages: Math.ceil(total / limit) || 0,
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  },

  // ── Update status (with transition validation) ──────────────────────────────

  async updateStatus(ctx, id, { status, failureReason, failureCode } = {}) {
    if (!DELIVERY_STATUS_VALUES.includes(status)) {
      throw new AppError(400, `Invalid status: ${status}`);
    }
    const existing = await deliveryLogsRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Delivery log not found');

    assertValidTransition(existing.status, status);

    const extra = {};
    if (status === DELIVERY_STATUS.FAILED) {
      if (failureReason) extra.failureReason = failureReason;
      if (failureCode)   extra.failureCode = failureCode;
    }
    const set = buildStatusSet(status, extra);
    const updated = await deliveryLogsRepository.updateStatus(ctx.tenantId, id, { set });

    emitToTenant(ctx.tenantId, 'whatsapp:deliveryLog', {
      deliveryLogId: String(updated._id ?? updated.id),
      deliveryLog: toDTO(updated),
    });
    return toDTO(updated);
  },

  // ── Retry ────────────────────────────────────────────────────────────────────

  async retry(ctx, id) {
    const existing = await deliveryLogsRepository.findById(ctx.tenantId, id);
    if (!existing) throw new AppError(404, 'Delivery log not found');
    if (!RETRYABLE_STATUSES.includes(existing.status)) {
      throw new AppError(409, `Only ${RETRYABLE_STATUSES.join(', ')} messages can be retried (current: ${existing.status})`);
    }
    // Reset to SENDING and clear failure info; retryCount++.
    const set = {
      status:        DELIVERY_STATUS.SENDING,
      failureReason: null,
      failureCode:   null,
    };
    const updated = await deliveryLogsRepository.incrementRetry(ctx.tenantId, id, set);

    emitToTenant(ctx.tenantId, 'whatsapp:deliveryLog', {
      deliveryLogId: String(updated._id ?? updated.id),
      deliveryLog: toDTO(updated),
    });
    return toDTO(updated);
  },

  // ── Webhook ──────────────────────────────────────────────────────────────────

  /**
   * Process an inbound provider webhook callback.
   * Finds the log by providerMessageId (preferred) or _id, records the event,
   * updates status + timestamps + provider metadata + failure info.
   *
   * No auth context — provider calls this. Tenant is derived from the matched log.
   */
  async processWebhook(payload = {}) {
    const {
      tenantId,
      providerMessageId,
      logId,
      status,
      failureReason,
      failureCode,
      providerMetadata,
      providerPayload,
    } = payload;

    // Locate the log. providerMessageId is the natural key from the provider.
    let log = null;
    if (providerMessageId && tenantId) {
      log = await deliveryLogsRepository.findByProviderMessageId(tenantId, providerMessageId);
    }
    if (!log && logId && tenantId) {
      log = await deliveryLogsRepository.findById(tenantId, logId);
    }
    if (!log) throw new AppError(404, 'Delivery log not found for webhook payload');

    const webhookEvent = {
      status:          status || '',
      timestamp:       new Date(),
      providerPayload: providerPayload || payload,
      receivedAt:      new Date(),
    };

    const set = {};
    if (status && DELIVERY_STATUS_VALUES.includes(status)) {
      // Only apply if the transition is valid; otherwise still record the event.
      const allowed = (ALLOWED_STATUS_TRANSITIONS[log.status] || []).includes(status) || log.status === status;
      if (allowed) {
        Object.assign(set, buildStatusSet(status));
        if (status === DELIVERY_STATUS.FAILED) {
          if (failureReason) set.failureReason = failureReason;
          if (failureCode)   set.failureCode = failureCode;
        }
      }
    }
    if (providerMetadata) set.providerMetadata = { ...(log.providerMetadata || {}), ...providerMetadata };

    const updated = await deliveryLogsRepository.applyWebhook(log.tenantId, String(log._id), { set, webhookEvent });

    // Push to any open Delivery Logs tab for this tenant so it updates
    // without a manual refresh -- same realtime channel message.service.js
    // uses for the Inbox (see realtime/socket.js). log.tenantId (not the
    // request, since there IS no authenticated request here) is the
    // correct scope -- resolved above from the matched log itself.
    emitToTenant(log.tenantId, 'whatsapp:deliveryLog', {
      deliveryLogId: String(updated._id ?? updated.id),
      deliveryLog: toDTO(updated),
    });

    return toDTO(updated);
  },

  // ── Statistics ───────────────────────────────────────────────────────────────

  async getStats(ctx, query = {}) {
    // Allow the same filters as list (without pagination) for scoped stats.
    const matchFilter = buildFilter(query);
    delete matchFilter.$or; // search doesn't apply to stats
    const rows = await deliveryLogsRepository.aggregateStats(ctx.tenantId, matchFilter);

    const counts = {
      QUEUED: 0, SENDING: 0, SENT: 0, DELIVERED: 0,
      READ: 0, FAILED: 0, EXPIRED: 0, DELETED: 0,
    };
    let totalRetries = 0;
    for (const r of rows) {
      if (counts[r._id] !== undefined) counts[r._id] = r.count;
      totalRetries += r.retrySum || 0;
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    // "Sent" for rate purposes = everything that left the queue.
    const sentOrBeyond = counts.SENT + counts.DELIVERED + counts.READ;
    const deliveredOrBeyond = counts.DELIVERED + counts.READ;

    const pct = (num, den) => (den > 0 ? Number(((num / den) * 100).toFixed(2)) : 0);

    return {
      totalMessages: total,
      sent:          sentOrBeyond,
      delivered:     deliveredOrBeyond,
      read:          counts.READ,
      failed:        counts.FAILED,
      queued:        counts.QUEUED,
      sending:       counts.SENDING,
      expired:       counts.EXPIRED,
      deliveryRate:  pct(deliveredOrBeyond, total),
      readRate:      pct(counts.READ, total),
      failureRate:   pct(counts.FAILED, total),
      retryCount:    totalRetries,
    };
  },
};