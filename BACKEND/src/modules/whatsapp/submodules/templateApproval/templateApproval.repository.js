/**
 * WhatsApp Template Approval — repository.
 *
 * The only layer that touches the WhatsAppTemplate collection for approval
 * transitions. Every query is tenant-scoped. Each mutation sets the
 * status-specific fields and appends the transitionHistory entry atomically.
 *
 * Webhook-driven methods (providerApproved/Rejected/Paused/Disabled) accept a
 * resolved tenantId derived from the template record, since provider callbacks
 * carry no user/tenant context.
 */
import { WhatsAppTemplate } from '../templates/templates.model.js';
import { TEMPLATE_STATUS, PROVIDER_STATUS } from '../templates/templates.constants.js';
import { APPROVAL_STATUS } from './templateApproval.constants.js';

function transition(tenantId, id, set, historyEntry) {
  return WhatsAppTemplate.findOneAndUpdate(
    { _id: id, tenantId },
    { $set: set, $push: { transitionHistory: historyEntry } },
    { new: true, runValidators: true },
  );
}

export const templateApprovalRepository = {
  async findById(tenantId, id) {
  const byId = await WhatsAppTemplate.findById(id);

  console.log("===== TEMPLATE IN DB =====");
  console.log("Requested tenant:", tenantId);
  console.log("Stored tenant:", byId?.tenantId);
  console.log("==========================");

  return WhatsAppTemplate.findOne({ _id: id, tenantId });
},

  /** Webhook lookup — by id only (globally unique); tenant derived from record. */
  findByIdUnscoped(id) {
    return WhatsAppTemplate.findById(id);
  },

  findByProviderTemplateId(providerTemplateId) {
    return WhatsAppTemplate.findOne({ 'providerMetadata.providerTemplateId': providerTemplateId });
  },

  submitForReview(tenantId, id, { performedBy, comment = '', now, historyEntry }) {
    return transition(
      tenantId,
      id,
      {
        approvalStatus: APPROVAL_STATUS.SUBMITTED_FOR_INTERNAL_REVIEW,
        status: TEMPLATE_STATUS.SUBMITTED,
        submittedBy: performedBy,
        submittedAt: now,
        submittedForApprovalAt: now,
        approvalComments: comment,
        isActive: false,
      },
      historyEntry,
    );
  },

  requestChanges(tenantId, id, { comment = '', historyEntry }) {
    return transition(
      tenantId,
      id,
      {
        approvalStatus: APPROVAL_STATUS.DRAFT,
        status: TEMPLATE_STATUS.DRAFT,
        approvalComments: comment,
        isActive: false,
      },
      historyEntry,
    );
  },

  approveInternally(tenantId, id, { performedBy, comment = '', now, historyEntry }) {
    return transition(
      tenantId,
      id,
      {
        approvalStatus: APPROVAL_STATUS.INTERNALLY_APPROVED,
        status: TEMPLATE_STATUS.SUBMITTED,
        approvedBy: performedBy,
        approvedAt: now,
        lastApprovedAt: now,
        approvalComments: comment,
        isActive: false,
      },
      historyEntry,
    );
  },

  rejectInternally(tenantId, id, { performedBy, comment = '', now, historyEntry }) {
    return transition(
      tenantId,
      id,
      {
        approvalStatus: APPROVAL_STATUS.REJECTED,
        status: TEMPLATE_STATUS.REJECTED,
        rejectedBy: performedBy,
        rejectedAt: now,
        approvalComments: comment,
        isActive: false,
      },
      historyEntry,
    );
  },

  submitToProvider(tenantId, id, { now, historyEntry, providerTemplateId, providerStatus, rawResponse }) {
    const set = {
      approvalStatus: APPROVAL_STATUS.SUBMITTED_TO_PROVIDER,
      status: TEMPLATE_STATUS.SUBMITTED,
      submittedForApprovalAt: now,
      'providerMetadata.providerStatus': providerStatus || PROVIDER_STATUS.UNDER_REVIEW,
      isActive: false,
    };
    if (providerTemplateId) set['providerMetadata.providerTemplateId'] = providerTemplateId;
    if (rawResponse) set['providerMetadata.rawResponse'] = rawResponse;
    return transition(tenantId, id, set, historyEntry);
  },

  providerApproved(tenantId, id, { now, providerTemplateId, historyEntry }) {
    const set = {
      approvalStatus: APPROVAL_STATUS.PROVIDER_APPROVED,
      status: TEMPLATE_STATUS.ACTIVE,
      isActive: true,
      approvedAt: now,
      lastApprovedAt: now,
      'providerMetadata.providerStatus': PROVIDER_STATUS.APPROVED,
      'providerMetadata.syncedAt': now,
    };
    if (providerTemplateId) set['providerMetadata.providerTemplateId'] = providerTemplateId;
    return transition(tenantId, id, set, historyEntry);
  },

  providerRejected(tenantId, id, { now, reason = null, message = null, historyEntry }) {
    return transition(
      tenantId,
      id,
      {
        approvalStatus: APPROVAL_STATUS.PROVIDER_REJECTED,
        status: TEMPLATE_STATUS.REJECTED,
        isActive: false,
        rejectedAt: now,
        providerRejectionReason: reason,
        providerRejectionMessage: message,
        'providerMetadata.providerStatus': PROVIDER_STATUS.REJECTED,
        'providerMetadata.providerError': message,
      },
      historyEntry,
    );
  },

  providerPaused(tenantId, id, { now, historyEntry }) {
    return transition(
      tenantId,
      id,
      {
        approvalStatus: APPROVAL_STATUS.PAUSED,
        status: TEMPLATE_STATUS.PAUSED,
        isActive: false,
        'providerMetadata.syncedAt': now,
      },
      historyEntry,
    );
  },

  providerDisabled(tenantId, id, { now, historyEntry }) {
    return transition(
      tenantId,
      id,
      {
        approvalStatus: APPROVAL_STATUS.DISABLED,
        status: TEMPLATE_STATUS.ARCHIVED,
        isActive: false,
        'providerMetadata.syncedAt': now,
      },
      historyEntry,
    );
  },

  async getTimeline(tenantId, id) {
    const template = await WhatsAppTemplate.findOne(
      { _id: id, tenantId },
      { transitionHistory: 1, approvalStatus: 1 },
    );
    return template ? template.transitionHistory : null;
  },
};