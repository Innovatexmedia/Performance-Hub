/**
 * LeadImport -- tracks one CSV import run's status and progress.
 *
 * FILE: src/modules/leads/imports/leadImport.model.js
 *
 * Previously CSV import processed every row synchronously inside the
 * HTTP request itself -- no queue, no progress visibility, and a real
 * risk of hitting an HTTP timeout on a large file with the import left
 * in an unrecoverable partial state. This model is what a real,
 * queue-based import needs to report progress against, the same way
 * Campaign/Broadcast documents already do for bulk sends.
 */
import mongoose from 'mongoose';
const { Schema } = mongoose;

export const IMPORT_STATUS = Object.freeze({
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
});
export const IMPORT_STATUS_VALUES = Object.freeze(Object.values(IMPORT_STATUS));

const leadImportSchema = new Schema(
  {
    tenant_id: { type: String, required: true, index: true },
    created_by: { type: String, default: null },
    fileName: { type: String, default: '' },
    status: { type: String, enum: IMPORT_STATUS_VALUES, default: IMPORT_STATUS.QUEUED, index: true },
    skipDuplicates: { type: Boolean, default: true },

    totalRows: { type: Number, default: 0, min: 0 },
    processedCount: { type: Number, default: 0, min: 0 },
    createdCount: { type: Number, default: 0, min: 0 },
    skippedCount: { type: Number, default: 0, min: 0 },
    failedCount: { type: Number, default: 0, min: 0 },

    // Capped so one badly-formatted file with thousands of failing rows
    // can't grow this document unboundedly -- the count above is still
    // exact, this is just a representative sample for display.
    errors: {
      type: [{ line: Number, error: String }],
      default: [],
      validate: [(arr) => arr.length <= 200, 'errors sample capped at 200 entries'],
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
  },
);

leadImportSchema.index({ tenant_id: 1, created_at: -1 });

export const LeadImport = mongoose.model('LeadImport', leadImportSchema);