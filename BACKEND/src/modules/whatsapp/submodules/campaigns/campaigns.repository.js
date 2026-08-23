/**
 * WhatsApp Campaigns — repository.
 *
 * The only layer that touches the WhatsAppCampaign collection.
 * Every query is tenant-scoped. Status transitions are atomic ($set + $push auditLog).
 */
import { WhatsAppCampaign } from './campaigns.model.js';
import { CAMPAIGN_STATUS } from './campaigns.constants.js';

function transition(tenantId, id, set, auditEntry) {
  return WhatsAppCampaign.findOneAndUpdate(
    { _id: id, tenantId },
    { $set: set, $push: { auditLog: auditEntry } },
    { new: true, runValidators: true },
  );
}

export const campaignsRepository = {
  createCampaign(data) {
    return WhatsAppCampaign.create(data);
  },

  findById(tenantId, id) {
    return WhatsAppCampaign.findOne({ _id: id, tenantId });
  },

  listCampaigns(tenantId, filter = {}, { sort = { createdAt: -1 }, skip = 0, limit = 20 } = {}) {
    return WhatsAppCampaign.find({ tenantId, ...filter }).sort(sort).skip(skip).limit(limit);
  },

  countCampaigns(tenantId, filter = {}) {
    return WhatsAppCampaign.countDocuments({ tenantId, ...filter });
  },

  updateCampaign(tenantId, id, patch) {
    return WhatsAppCampaign.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: patch },
      { new: true, runValidators: true },
    );
  },

  deleteCampaign(tenantId, id) {
    return WhatsAppCampaign.findOneAndDelete({ _id: id, tenantId });
  },

  approveCampaign(tenantId, id, { approvedBy, now, auditEntry }) {
    return transition(tenantId, id, {
      status:     CAMPAIGN_STATUS.APPROVED,
      approvedBy,
      approvedAt: now,
      updatedBy:  approvedBy,
    }, auditEntry);
  },

  scheduleCampaign(tenantId, id, { scheduledAt, performedBy, now, auditEntry }) {
    return transition(tenantId, id, {
      status:      CAMPAIGN_STATUS.SCHEDULED,
      scheduledAt,
      updatedBy:   performedBy,
    }, auditEntry);
  },

  startCampaign(tenantId, id, { performedBy, now, auditEntry }) {
    return transition(tenantId, id, {
      status:    CAMPAIGN_STATUS.RUNNING,
      startedAt: now,
      updatedBy: performedBy,
    }, auditEntry);
  },

  completeCampaign(tenantId, id, { performedBy, now, auditEntry }) {
    return transition(tenantId, id, {
      status:      CAMPAIGN_STATUS.COMPLETED,
      completedAt: now,
      isActive:    false,
      updatedBy:   performedBy,
    }, auditEntry);
  },

  /**
   * completeCampaignIfRunning / failCampaignIfRunning -- atomic,
   * status-guarded variants of the two transitions above, used ONLY by
   * the BullMQ worker's per-job completion check (see
   * queues/campaignSend.worker.js). Real concurrent workers (concurrency
   * > 1) can have two jobs finish within milliseconds of each other, both
   * observing "all recipients processed" -- without the `status: RUNNING`
   * filter here, both would independently call the plain
   * completeCampaign/failCampaign above and BOTH would succeed (no
   * concurrency guard on that unguarded transition()), double-pushing
   * auditLog entries and racing on which terminal status wins. Filtering
   * on current status makes MongoDB itself the single arbiter: only
   * whichever call happens to apply first actually matches and updates;
   * the loser's filter no longer matches (status already changed) and
   * getting `null` back is the normal, expected "someone else already
   * finished this" outcome, not an error.
   */
  completeCampaignIfRunning(tenantId, id, { performedBy, now, auditEntry }) {
    return WhatsAppCampaign.findOneAndUpdate(
      { _id: id, tenantId, status: CAMPAIGN_STATUS.RUNNING },
      { $set: { status: CAMPAIGN_STATUS.COMPLETED, completedAt: now, isActive: false, updatedBy: performedBy }, $push: { auditLog: auditEntry } },
      { new: true, runValidators: true },
    );
  },

  failCampaignIfRunning(tenantId, id, { failureReason = '', performedBy, auditEntry }) {
    return WhatsAppCampaign.findOneAndUpdate(
      { _id: id, tenantId, status: CAMPAIGN_STATUS.RUNNING },
      { $set: { status: CAMPAIGN_STATUS.FAILED, failureReason, isActive: false, updatedBy: performedBy }, $push: { auditLog: auditEntry } },
      { new: true, runValidators: true },
    );
  },

  failCampaign(tenantId, id, { failureReason = '', performedBy, now, auditEntry }) {
    return transition(tenantId, id, {
      status:        CAMPAIGN_STATUS.FAILED,
      failureReason,
      isActive:      false,
      updatedBy:     performedBy,
    }, auditEntry);
  },

  cancelCampaign(tenantId, id, { performedBy, now, auditEntry }) {
    return transition(tenantId, id, {
      status:    CAMPAIGN_STATUS.CANCELLED,
      isActive:  false,
      updatedBy: performedBy,
    }, auditEntry);
  },

  updateMetrics(tenantId, id, metricsIncrement) {
    const inc = {};
    for (const [key, val] of Object.entries(metricsIncrement)) {
      if (typeof val === 'number') inc[`metrics.${key}`] = val;
    }
    return WhatsAppCampaign.findOneAndUpdate(
      { _id: id, tenantId },
      { $inc: inc },
      { new: true },
    );
  },

  updateRecipientCount(tenantId, id, recipientCount) {
    return WhatsAppCampaign.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: { recipientCount, 'metrics.recipientCount': recipientCount } },
      { new: true },
    );
  },
};