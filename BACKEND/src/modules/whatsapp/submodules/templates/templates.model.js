import mongoose from 'mongoose';
import {
  TEMPLATE_CATEGORY_VALUES,
  TEMPLATE_STATUS,
  TEMPLATE_STATUS_VALUES,
  APPROVAL_STATUS,
  APPROVAL_STATUS_VALUES,
  PROVIDER,
  PROVIDER_VALUES,
  PROVIDER_STATUS,
  PROVIDER_STATUS_VALUES,
  HEADER_TYPE,
  HEADER_TYPE_VALUES,
  BUTTON_TYPE_VALUES,
} from './templates.constants.js';

const { Schema } = mongoose;

const headerSchema = new Schema(
  {
    type: { type: String, enum: HEADER_TYPE_VALUES, default: HEADER_TYPE.NONE },
    text: { type: String, default: '' },
    mediaUrl: { type: String, default: '' },
    // Needed by Meta's Resumable Upload API (file_length + file_type query
    // params) when submitting this template for approval -- captured once
    // at upload time in TemplateBuilder.tsx rather than re-fetched from
    // Cloudinary at submission time.
    mediaMimeType: { type: String, default: '' },
    mediaSizeBytes: { type: Number, default: 0 },
  },
  { _id: false },
);

const buttonSchema = new Schema(
  {
    type: { type: String, enum: BUTTON_TYPE_VALUES, required: true },
    text: { type: String, required: true },
    value: { type: String, default: '' },
  },
  { _id: false },
);

const providerMetadataSchema = new Schema(
  {
    providerTemplateId: { type: String, default: null },
    providerStatus: {
      type: String,
      enum: PROVIDER_STATUS_VALUES,
      default: PROVIDER_STATUS.PENDING,
    },
    providerError: { type: String, default: null },
    syncedAt: { type: Date, default: null },
    rawResponse: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const approvalHistorySchema = new Schema(
  {
    status: { type: String, required: true },
    comment: { type: String, default: '' },
    updatedBy: { type: String, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const templateSchema = new Schema(
  {
    tenantId: { type: String, required: true },

    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true },
    description: { type: String, default: '' },

    category: { type: String, enum: TEMPLATE_CATEGORY_VALUES, required: true },
    languageCode: { type: String, required: true, trim: true },

    status: { type: String, enum: TEMPLATE_STATUS_VALUES, default: TEMPLATE_STATUS.DRAFT },
    approvalStatus: {
      type: String,
      enum: APPROVAL_STATUS_VALUES,
      default: APPROVAL_STATUS.DRAFT,
    },

    provider: { type: String, enum: PROVIDER_VALUES, default: PROVIDER.SIMULATION },
    providerMetadata: { type: providerMetadataSchema, default: () => ({}) },

    header: { type: headerSchema, default: () => ({}) },
    body: { type: String, required: true },
    footer: { type: String, default: '' },
    buttons: { type: [buttonSchema], default: [] },
    variables: { type: [String], default: [] },

    version: { type: Number, default: 1, min: 1 },
    usageCount: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: false },

    lastUsedAt: { type: Date, default: null },
    lastApprovedAt: { type: Date, default: null },
    lastSyncedAt: { type: Date, default: null },
    submittedForApprovalAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },

    approvalComments: { type: String, default: '' },
    approvalHistory: { type: [approvalHistorySchema], default: [] },

    // ── Approval workflow fields (managed by templateApproval module) ──────
    submittedBy: { type: String, default: null },
    submittedAt: { type: Date, default: null },
    approvedBy: { type: String, default: null },
    rejectedBy: { type: String, default: null },
    providerRejectionReason: { type: String, default: null },
    providerRejectionMessage: { type: String, default: null },

    /**
     * transitionHistory — append-only audit trail of every status change.
     * Shape: { fromStatus, toStatus, action, comment, performedBy, performedAt }
     */
    transitionHistory: {
      type: [
        new Schema(
          {
            fromStatus: { type: String, default: null },
            toStatus: { type: String, required: true },
            action: { type: String, required: true },
            comment: { type: String, default: '' },
            performedBy: { type: String, default: null },
            performedAt: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
  },
  {
    timestamps: true, // createdAt + updatedAt
    versionKey: false,
  },
);

templateSchema.index({ tenantId: 1, name: 1 });
templateSchema.index({ tenantId: 1, slug: 1 }, { unique: true });
templateSchema.index({ tenantId: 1, category: 1 });
templateSchema.index({ tenantId: 1, status: 1 });
templateSchema.index({ tenantId: 1, approvalStatus: 1 });
templateSchema.index({ tenantId: 1, 'providerMetadata.providerStatus': 1 });
templateSchema.index({ tenantId: 1, isActive: 1 });
templateSchema.index({ tenantId: 1, usageCount: 1 });

export const WhatsAppTemplate = mongoose.model('WhatsAppTemplate', templateSchema);