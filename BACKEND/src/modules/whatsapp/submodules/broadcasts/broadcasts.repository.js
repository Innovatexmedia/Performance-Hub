/**
 * WhatsApp Broadcasts — repository.
 *
 * Only layer that touches WhatsAppBroadcast. Every query is tenant-scoped.
 * Status transitions are atomic: one findOneAndUpdate does $set + $push auditLog.
 */
import { WhatsAppBroadcast } from './broadcasts.model.js';
import { BROADCAST_STATUS } from './broadcasts.constants.js';

function transition(tenantId, id, set, auditEntry) {
  return WhatsAppBroadcast.findOneAndUpdate(
    { _id: id, tenantId },
    { $set: set, $push: { auditLog: auditEntry } },
    { new: true, runValidators: true },
  );
}

export const broadcastsRepository = {
  createBroadcast(data) {
    return WhatsAppBroadcast.create(data);
  },

  findById(tenantId, id) {
    return WhatsAppBroadcast.findOne({ _id: id, tenantId });
  },

  listBroadcasts(tenantId, filter = {}, { sort = { createdAt: -1 }, skip = 0, limit = 20 } = {}) {
    return WhatsAppBroadcast.find({ tenantId, ...filter }).sort(sort).skip(skip).limit(limit);
  },

  countBroadcasts(tenantId, filter = {}) {
    return WhatsAppBroadcast.countDocuments({ tenantId, ...filter });
  },

  updateBroadcast(tenantId, id, patch) {
    return WhatsAppBroadcast.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: patch },
      { new: true, runValidators: true },
    );
  },

  deleteBroadcast(tenantId, id) {
    return WhatsAppBroadcast.findOneAndDelete({ _id: id, tenantId });
  },

  approveBroadcast(tenantId, id, { approvedBy, now, auditEntry }) {
    return transition(tenantId, id, {
      status: BROADCAST_STATUS.APPROVED,
      approvedBy,
      approvedAt: now,
      updatedBy: approvedBy,
    }, auditEntry);
  },

  scheduleBroadcast(tenantId, id, { scheduledAt, performedBy, auditEntry }) {
    return transition(tenantId, id, {
      status: BROADCAST_STATUS.SCHEDULED,
      scheduledAt,
      updatedBy: performedBy,
    }, auditEntry);
  },

  startBroadcast(tenantId, id, { performedBy, now, audienceSummary, auditEntry }) {
    return transition(tenantId, id, {
      status: BROADCAST_STATUS.RUNNING,
      startedAt: now,
      audienceSummary,
      'metrics.recipientCount': audienceSummary.recipientCount,
      recipientCount: audienceSummary.recipientCount,
      updatedBy: performedBy,
    }, auditEntry);
  },

  completeBroadcast(tenantId, id, { performedBy, now, auditEntry }) {
    return transition(tenantId, id, {
      status: BROADCAST_STATUS.COMPLETED,
      completedAt: now,
      isActive: false,
      updatedBy: performedBy,
    }, auditEntry);
  },

  /** Atomic, status-guarded variants -- see campaigns.repository.js's
   * completeCampaignIfRunning comment for why these exist separately
   * from the plain (unguarded) transitions above. Used only by the
   * BullMQ worker's per-job completion check. */
  completeBroadcastIfRunning(tenantId, id, { performedBy, now, auditEntry }) {
    return WhatsAppBroadcast.findOneAndUpdate(
      { _id: id, tenantId, status: BROADCAST_STATUS.RUNNING },
      { $set: { status: BROADCAST_STATUS.COMPLETED, completedAt: now, isActive: false, updatedBy: performedBy }, $push: { auditLog: auditEntry } },
      { new: true, runValidators: true },
    );
  },

  failBroadcastIfRunning(tenantId, id, { failureReason = '', performedBy, auditEntry }) {
    return WhatsAppBroadcast.findOneAndUpdate(
      { _id: id, tenantId, status: BROADCAST_STATUS.RUNNING },
      { $set: { status: BROADCAST_STATUS.FAILED, failureReason, isActive: false, updatedBy: performedBy }, $push: { auditLog: auditEntry } },
      { new: true, runValidators: true },
    );
  },

  failBroadcast(tenantId, id, { failureReason = '', performedBy, auditEntry }) {
    return transition(tenantId, id, {
      status: BROADCAST_STATUS.FAILED,
      failureReason,
      isActive: false,
      updatedBy: performedBy,
    }, auditEntry);
  },

  cancelBroadcast(tenantId, id, { performedBy, auditEntry }) {
    return transition(tenantId, id, {
      status: BROADCAST_STATUS.CANCELLED,
      isActive: false,
      updatedBy: performedBy,
    }, auditEntry);
  },

  updateMetrics(tenantId, id, metricsIncrement) {
    const inc = {};
    for (const [key, val] of Object.entries(metricsIncrement)) {
      if (typeof val === 'number') inc[`metrics.${key}`] = val;
    }
    return WhatsAppBroadcast.findOneAndUpdate(
      { _id: id, tenantId },
      { $inc: inc },
      { new: true },
    );
  },

  updateAudienceSummary(tenantId, id, audienceSummary) {
    return WhatsAppBroadcast.findOneAndUpdate(
      { _id: id, tenantId },
      {
        $set: {
          audienceSummary,
          recipientCount: audienceSummary.recipientCount,
          'metrics.recipientCount': audienceSummary.recipientCount,
        },
      },
      { new: true },
    );
  },
};