import { LeadImport, IMPORT_STATUS } from './leadImport.model.js';

export const leadImportRepository = {
  create(data) {
    return LeadImport.create(data);
  },

  findById(tenantId, id) {
    return LeadImport.findOne({ _id: id, tenant_id: tenantId });
  },

  list(tenantId, { limit = 20 } = {}) {
    return LeadImport.find({ tenant_id: tenantId }).sort({ created_at: -1 }).limit(limit);
  },

  startIfQueued(tenantId, id) {
    return LeadImport.findOneAndUpdate(
      { _id: id, tenant_id: tenantId, status: IMPORT_STATUS.QUEUED },
      { $set: { status: IMPORT_STATUS.RUNNING } },
      { new: true },
    );
  },

  /**
   * Atomic per-row progress increment -- called once per BullMQ job,
   * same pattern as campaigns.repository.js's updateMetrics.
   */
  incrementProgress(tenantId, id, { created = 0, skipped = 0, failed = 0, error = null }) {
    const update = {
      $inc: {
        processedCount: 1,
        createdCount: created,
        skippedCount: skipped,
        failedCount: failed,
      },
    };
    if (error) update.$push = { errors: { $each: [error], $slice: -200 } };
    return LeadImport.findOneAndUpdate({ _id: id, tenant_id: tenantId }, update, { new: true });
  },

  /**
   * Status-guarded finalize -- same reasoning as campaigns.repository.js's
   * completeCampaignIfRunning: concurrent workers can both observe
   * "all rows processed" within milliseconds of each other, so filtering
   * on the current status makes MongoDB the single arbiter for which
   * one actually applies the terminal transition.
   */
  completeIfRunning(tenantId, id) {
    return LeadImport.findOneAndUpdate(
      { _id: id, tenant_id: tenantId, status: IMPORT_STATUS.RUNNING },
      { $set: { status: IMPORT_STATUS.COMPLETED } },
      { new: true },
    );
  },
};