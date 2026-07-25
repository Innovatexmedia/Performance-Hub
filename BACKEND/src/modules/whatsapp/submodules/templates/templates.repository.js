import { WhatsAppTemplate } from './templates.model.js';
import { TEMPLATE_STATUS } from './templates.constants.js';

/**
 * Template repository — the only layer that touches the WhatsAppTemplate
 * collection. Every query is tenant-scoped.
 *
 * NOTE: there used to be an `updateApprovalStatus` method here, called only
 * by templates.service.js's now-deleted `updateApprovalState`. That was the
 * ungated write path for `approvalStatus` -- removed along with its only
 * caller. All approval-status writes now go exclusively through
 * templateApprovalRepository (templateApproval.repository.js), which is
 * the only layer templateApproval.service.js's guarded transitions use.
 */
export const templatesRepository = {
  createTemplate(data) {
    return WhatsAppTemplate.create(data);
  },

  findById(tenantId, id) {
    return WhatsAppTemplate.findOne({ _id: id, tenantId });
  },

  findBySlug(tenantId, slug) {
    return WhatsAppTemplate.findOne({ tenantId, slug });
  },

  listTemplates(tenantId, filter = {}, { sort = { createdAt: -1 }, skip = 0, limit = 20 } = {}) {
    return WhatsAppTemplate.find({ tenantId, ...filter })
      .sort(sort)
      .skip(skip)
      .limit(limit);
  },

  countTemplates(tenantId, filter = {}) {
    return WhatsAppTemplate.countDocuments({ tenantId, ...filter });
  },

  updateTemplate(tenantId, id, patch) {
    return WhatsAppTemplate.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: patch },
      { new: true, runValidators: true },
    );
  },

  deleteTemplate(tenantId, id) {
    return WhatsAppTemplate.findOneAndDelete({ _id: id, tenantId });
  },

  duplicateTemplate(data) {
    return WhatsAppTemplate.create(data);
  },

  activateTemplate(tenantId, id) {
    return WhatsAppTemplate.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: { status: TEMPLATE_STATUS.ACTIVE, isActive: true } },
      { new: true },
    );
  },

  pauseTemplate(tenantId, id) {
    return WhatsAppTemplate.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: { status: TEMPLATE_STATUS.PAUSED, isActive: false } },
      { new: true },
    );
  },

  archiveTemplate(tenantId, id) {
    return WhatsAppTemplate.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: { status: TEMPLATE_STATUS.ARCHIVED, isActive: false } },
      { new: true },
    );
  },

  updateProviderStatus(tenantId, id, providerStatus, extra = {}) {
    const set = { 'providerMetadata.providerStatus': providerStatus };
    if (extra.providerTemplateId !== undefined) set['providerMetadata.providerTemplateId'] = extra.providerTemplateId;
    if (extra.providerError !== undefined) set['providerMetadata.providerError'] = extra.providerError;
    return WhatsAppTemplate.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: set },
      { new: true },
    );
  },

  updateSyncStatus(tenantId, id, providerMetadata) {
    const now = new Date();
    return WhatsAppTemplate.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: { providerMetadata, lastSyncedAt: now } },
      { new: true },
    );
  },

  incrementUsageCount(tenantId, id) {
    return WhatsAppTemplate.findOneAndUpdate(
      { _id: id, tenantId },
      { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } },
      { new: true },
    );
  },
};