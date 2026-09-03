/**
 * WhatsApp Consent & Opt-Out — repository.
 *
 * The only layer that touches the Consent collection.
 * Every query is tenant-scoped. No business logic, no formatting.
 * History is always pushed (never overwritten).
 */
import { Consent } from './consent.model.js';
import { normalizePhoneNumber } from '../../../../shared/helpers/phone.helpers.js';

export const consentRepository = {
  createConsent(data) {
    return Consent.create(data);
  },

  findById(tenantId, id) {
    return Consent.findOne({ _id: id, tenantId });
  },

  findByPhone(tenantId, phoneNumber) {
    return Consent.findOne({ tenantId, phoneNumber: normalizePhoneNumber(phoneNumber) });
  },

  listConsents(tenantId, filter = {}, { sort = { createdAt: -1 }, skip = 0, limit = 20 } = {}) {
    return Consent.find({ tenantId, ...filter }).sort(sort).skip(skip).limit(limit);
  },

  countConsents(tenantId, filter = {}) {
    return Consent.countDocuments({ tenantId, ...filter });
  },

  /**
   * Apply a status transition + push a history entry atomically.
   * `set` carries the new status and any timestamp fields.
   */
  applyTransition(tenantId, id, set, historyEntry) {
    return Consent.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: set, $push: { history: historyEntry } },
      { new: true, runValidators: true },
    );
  },

  /** Update mutable metadata (notes, names) without a status change. */
  updateConsent(tenantId, id, patch) {
    return Consent.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: patch },
      { new: true, runValidators: true },
    );
  },

  /** Record a verification timestamp without altering status. */
  touchVerified(tenantId, id, now) {
    return Consent.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: { lastVerifiedAt: now } },
      { new: true },
    );
  },

  /**
   * Aggregate consent counts by status for a tenant, in ONE query --
   * powers GET /consent/stats. Mirrors the exact pattern
   * deliveryLogsRepository.aggregateStats() already uses. Replaces the
   * old frontend workaround that ran 5 separate list() calls (one per
   * status, limit=1) just to compute counts client-side -- that approach
   * was expensive AND, combined with per-action client-side math, was the
   * root cause of two real bugs (double-counting, a race condition)
   * fixed earlier. A single source of truth here removes that entire
   * class of bug.
   */
  async aggregateStats(tenantId) {
    return Consent.aggregate([
      { $match: { tenantId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
  },
};