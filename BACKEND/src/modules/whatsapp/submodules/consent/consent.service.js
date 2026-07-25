/**
 * WhatsApp Consent & Opt-Out — service.
 *
 * Contains ALL business logic:
 *   • Create consent
 *   • Verify consent (used by Campaigns/Broadcasts/Nurtures/AI/Automation before send)
 *   • Opt-in / Opt-out / Block / Unblock
 *   • Append-only history tracking
 *   • Tenant isolation
 *   • Compliance validation (expiry, sendable status)
 *   • Realtime push -- every status-changing action emits 'whatsapp:consent'
 *     to the tenant's socket room (see realtime/socket.js), same pattern as
 *     templateApproval.service.js / deliveryLogs.service.js. This lets any
 *     open Consent tab for the tenant reflect another user's action (or
 *     this tenant's own auto-expiry) instantly, with ZERO extra HTTP calls
 *     on either side -- sockets aren't subject to the REST rate limiter
 *     (app.js's `app.use('/api', generalApiRateLimit)` only wraps
 *     '/api/*' routes), so this doesn't compound the per-IP request budget
 *     the way polling for the same effect would.
 *
 * Status changes always:
 *   1. Validate the transition
 *   2. Stamp the relevant timestamp
 *   3. Append (never overwrite) a history entry
 *   4. Emit the realtime event
 */
import { AppError } from '../../../../shared/helpers/lead.helpers.js';
import { emitToTenant } from '../../../../realtime/socket.js';
import { consentRepository } from './consent.repository.js';
import {
  CONSENT_STATUS,
  CONSENT_STATUS_VALUES,
  CONSENT_ACTION,
  ALLOWED_STATUS_TRANSITIONS,
  SENDABLE_STATUSES,
  SEARCHABLE_FIELDS,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from './consent.constants.js';

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

function buildHistory(previousStatus, newStatus, action, { reason = '', performedBy = null, ipAddress = null, userAgent = null } = {}) {
  return {
    previousStatus,
    newStatus,
    action,
    reason,
    performedBy: performedBy ?? null,
    performedAt: new Date(),
    ipAddress,
    userAgent,
  };
}

function assertTransition(from, to) {
  const allowed = ALLOWED_STATUS_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new AppError(409, `Invalid consent transition: ${from} → ${to}`);
  }
}

/** A consent record is expired if it has an expiresAt in the past. */
function isExpired(consent) {
  return !!(consent.expiresAt && new Date(consent.expiresAt).getTime() < Date.now());
}

function buildFilter(query = {}) {
  const filter = {};
  if (query.status)        filter.status = query.status;
  if (query.source)        filter.consentSource = query.source;
  if (query.optInMethod)   filter.optInMethod = query.optInMethod;
  if (query.optOutMethod)  filter.optOutMethod = query.optOutMethod;
  if (query.phoneNumber)   filter.phoneNumber = query.phoneNumber;
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

function paging(query = {}) {
  const page  = Math.max(Number(query.page)  || DEFAULT_PAGE, 1);
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
}

function meta(req) {
  // Optional client metadata captured for compliance audit.
  return {
    ipAddress: req?.ip || req?.headers?.['x-forwarded-for'] || null,
    userAgent: req?.headers?.['user-agent'] || null,
  };
}

/**
 * Emit the realtime consent event. `previousStatus` is null for a brand
 * new record (create()); every other caller passes the status the record
 * was in immediately before this change, so the frontend can apply the
 * exact same local bump(toStatus, fromStatus) it already uses for its own
 * actions -- no extra fetch needed on the receiving end either.
 */
function emitConsentChanged(tenantId, updated, previousStatus) {
  emitToTenant(tenantId, 'whatsapp:consent', {
    consentId: String(updated._id ?? updated.id),
    consent: toDTO(updated),
    previousStatus,
  });
}

// ── Service ────────────────────────────────────────────────────────────────────

export const consentService = {
  // ── Create ─────────────────────────────────────────────────────────────────

  async createConsent(ctx, data, reqMeta = {}) {
    const existing = await consentRepository.findByPhone(ctx.tenantId, data.phoneNumber);
    if (existing) {
      throw new AppError(409, 'A consent record already exists for this phone number');
    }

    const initialStatus = data.status || CONSENT_STATUS.PENDING;
    const now = new Date();
    const historyEntry = buildHistory(null, initialStatus, CONSENT_ACTION.CREATE, {
      reason:      data.reason || 'Consent record created',
      performedBy: ctx.userId,
      ...reqMeta,
    });

    const consent = await consentRepository.createConsent({
      ...data,
      tenantId:     ctx.tenantId,
      status:       initialStatus,
      consentedAt:  initialStatus === CONSENT_STATUS.OPTED_IN ? now : null,
      history:      [historyEntry],
      createdBy:    ctx.userId,
      updatedBy:    ctx.userId,
    });

    emitConsentChanged(ctx.tenantId, consent, null);
    return toDTO(consent);
  },

  // ── Read ───────────────────────────────────────────────────────────────────

  async getConsent(ctx, id) {
    const consent = await consentRepository.findById(ctx.tenantId, id);
    if (!consent) throw new AppError(404, 'Consent record not found');
    return toDTO(consent);
  },

  async listConsents(ctx, query) {
    const filter = buildFilter(query);
    const { page, limit, skip } = paging(query);
    const [items, total] = await Promise.all([
      consentRepository.listConsents(ctx.tenantId, filter, { skip, limit }),
      consentRepository.countConsents(ctx.tenantId, filter),
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

  async getHistory(ctx, id) {
    const consent = await consentRepository.findById(ctx.tenantId, id);
    if (!consent) throw new AppError(404, 'Consent record not found');
    const c = consent.toObject ? consent.toObject() : consent;
    return {
      id:          String(c._id),
      phoneNumber: c.phoneNumber,
      status:      c.status,
      history:     c.history || [],
    };
  },

  // ── Verify (used by all sending modules) ───────────────────────────────────

  /**
   * Verify whether a phone number may receive WhatsApp messages.
   * Returns { allowed, status, reason }.
   * Auto-expires records whose expiresAt has passed.
   */
  async verifyConsent(ctx, phoneNumber) {
    const consent = await consentRepository.findByPhone(ctx.tenantId, phoneNumber);

    if (!consent) {
      return { allowed: false, status: null, reason: 'No consent record found' };
    }

    // Lazily transition an expired OPTED_IN record to EXPIRED.
    if (consent.status === CONSENT_STATUS.OPTED_IN && isExpired(consent)) {
      const historyEntry = buildHistory(CONSENT_STATUS.OPTED_IN, CONSENT_STATUS.EXPIRED, CONSENT_ACTION.EXPIRE, {
        reason:      'Consent expired (expiresAt passed)',
        performedBy: ctx.userId,
      });
      const updated = await consentRepository.applyTransition(
        ctx.tenantId, String(consent._id),
        { status: CONSENT_STATUS.EXPIRED },
        historyEntry,
      );
      // This is a silent, backend-triggered transition (not a user
      // clicking a button) -- still needs to push, or an open Consent tab
      // would show a stale OPTED_IN badge until manually refreshed.
      emitConsentChanged(ctx.tenantId, updated, CONSENT_STATUS.OPTED_IN);
      return { allowed: false, status: updated.status, reason: 'Consent expired' };
    }

    await consentRepository.touchVerified(ctx.tenantId, String(consent._id), new Date());

    const allowed = SENDABLE_STATUSES.includes(consent.status);
    return {
      allowed,
      status: consent.status,
      reason: allowed ? 'Contact has active consent' : `Contact status is ${consent.status}`,
    };
  },

  // ── Opt-in ─────────────────────────────────────────────────────────────────

  async optIn(ctx, id, { optInMethod, consentSource, consentText, reason, expiresAt } = {}, reqMeta = {}) {
    const consent = await consentRepository.findById(ctx.tenantId, id);
    if (!consent) throw new AppError(404, 'Consent record not found');

    if (consent.status === CONSENT_STATUS.BLOCKED) {
      throw new AppError(403, 'Blocked contacts cannot opt in. Unblock first.');
    }
    assertTransition(consent.status, CONSENT_STATUS.OPTED_IN);

    const now = new Date();
    const set = {
      status:      CONSENT_STATUS.OPTED_IN,
      consentedAt: now,
      updatedBy:   ctx.userId,
    };
    if (optInMethod)   set.optInMethod = optInMethod;
    if (consentSource) set.consentSource = consentSource;
    if (consentText)   set.consentText = consentText;
    if (expiresAt)     set.expiresAt = new Date(expiresAt);

    const previousStatus = consent.status;
    const historyEntry = buildHistory(previousStatus, CONSENT_STATUS.OPTED_IN, CONSENT_ACTION.OPT_IN, {
      reason:      reason || 'Contact opted in',
      performedBy: ctx.userId,
      ...reqMeta,
    });

    const updated = await consentRepository.applyTransition(ctx.tenantId, id, set, historyEntry);
    emitConsentChanged(ctx.tenantId, updated, previousStatus);
    return toDTO(updated);
  },

  // ── Opt-out ────────────────────────────────────────────────────────────────

  async optOut(ctx, id, { optOutMethod, reason } = {}, reqMeta = {}) {
    const consent = await consentRepository.findById(ctx.tenantId, id);
    if (!consent) throw new AppError(404, 'Consent record not found');

    if (consent.status === CONSENT_STATUS.BLOCKED) {
      throw new AppError(403, 'Blocked contacts cannot change opt-out state. Unblock first.');
    }
    assertTransition(consent.status, CONSENT_STATUS.OPTED_OUT);

    const now = new Date();
    const set = {
      status:       CONSENT_STATUS.OPTED_OUT,
      optedOutAt:   now,
      optOutMethod: optOutMethod || consent.optOutMethod || 'MANUAL',
      updatedBy:    ctx.userId,
    };

    const previousStatus = consent.status;
    const historyEntry = buildHistory(previousStatus, CONSENT_STATUS.OPTED_OUT, CONSENT_ACTION.OPT_OUT, {
      reason:      reason || 'Contact opted out',
      performedBy: ctx.userId,
      ...reqMeta,
    });

    const updated = await consentRepository.applyTransition(ctx.tenantId, id, set, historyEntry);
    emitConsentChanged(ctx.tenantId, updated, previousStatus);
    return toDTO(updated);
  },

  // ── Block ──────────────────────────────────────────────────────────────────

  async block(ctx, id, { reason } = {}, reqMeta = {}) {
    const consent = await consentRepository.findById(ctx.tenantId, id);
    if (!consent) throw new AppError(404, 'Consent record not found');
    if (consent.status === CONSENT_STATUS.BLOCKED) {
      throw new AppError(409, 'Contact is already blocked');
    }
    assertTransition(consent.status, CONSENT_STATUS.BLOCKED);

    const previousStatus = consent.status;
    const set = {
      status:         CONSENT_STATUS.BLOCKED,
      blockedReason:  reason || 'Blocked by tenant',
      preBlockStatus: previousStatus,   // remember so unblock can restore
      updatedBy:      ctx.userId,
    };
    const historyEntry = buildHistory(previousStatus, CONSENT_STATUS.BLOCKED, CONSENT_ACTION.BLOCK, {
      reason:      reason || 'Contact blocked',
      performedBy: ctx.userId,
      ...reqMeta,
    });

    const updated = await consentRepository.applyTransition(ctx.tenantId, id, set, historyEntry);
    emitConsentChanged(ctx.tenantId, updated, previousStatus);
    return toDTO(updated);
  },

  // ── Unblock — restore previous valid state ─────────────────────────────────

  async unblock(ctx, id, { reason } = {}, reqMeta = {}) {
    const consent = await consentRepository.findById(ctx.tenantId, id);
    if (!consent) throw new AppError(404, 'Consent record not found');
    if (consent.status !== CONSENT_STATUS.BLOCKED) {
      throw new AppError(409, 'Contact is not blocked');
    }

    // Restore the pre-block status, defaulting to PENDING if unknown/invalid.
    let restored = consent.preBlockStatus || CONSENT_STATUS.PENDING;
    if (restored === CONSENT_STATUS.BLOCKED) restored = CONSENT_STATUS.PENDING;

    const set = {
      status:         restored,
      blockedReason:  null,
      preBlockStatus: null,
      updatedBy:      ctx.userId,
    };
    const historyEntry = buildHistory(CONSENT_STATUS.BLOCKED, restored, CONSENT_ACTION.UNBLOCK, {
      reason:      reason || 'Contact unblocked',
      performedBy: ctx.userId,
      ...reqMeta,
    });

    const updated = await consentRepository.applyTransition(ctx.tenantId, id, set, historyEntry);
    emitConsentChanged(ctx.tenantId, updated, CONSENT_STATUS.BLOCKED);
    return toDTO(updated);
  },

  // ── Stats ──────────────────────────────────────────────────────────────────

  /**
   * Real, single-query aggregate counts by status. Powers the Consent
   * tab's KPI cards -- ONE call, always the true server value, no client
   * math involved anywhere. See consentRepository.aggregateStats() for
   * why this replaced the old 5-call client-side workaround.
   */
  async getStats(ctx) {
    const rows = await consentRepository.aggregateStats(ctx.tenantId);
    const counts = Object.fromEntries(CONSENT_STATUS_VALUES.map((s) => [s, 0]));
    for (const row of rows) {
      if (counts[row._id] !== undefined) counts[row._id] = row.count;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const optOutRate = total > 0 ? Number(((counts.OPTED_OUT / total) * 100).toFixed(1)) : 0;
    return { total, counts, optOutRate };
  },
};