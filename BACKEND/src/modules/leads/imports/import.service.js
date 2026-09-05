import { csvToLeadRows } from './csv-import.service.js';
import { leadService } from '../lead/lead.service.js';
import { duplicateService } from '../duplicate-detection/duplicate.service.js';
import { AppError } from '../../../shared/helpers/lead.helpers.js';
import { leadImportRepository } from './leadImport.repository.js';
import { enqueueLeadImport } from '../../../queues/leadImport.queue.js';
import { normalizePhoneNumber } from '../../../shared/helpers/phone.helpers.js';

const MAX_IMPORT_ROWS = 50_000; // sanity ceiling -- a bad/malformed file shouldn't be able to enqueue an unbounded number of jobs
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates one row BEFORE attempting to create anything -- lets us give
 * a specific, human-readable reason for the most common real mistakes
 * (missing field, obviously-wrong phone/email) without ever having to
 * surface a raw database error message to the person doing the import.
 */
function validateRow(row) {
  if (!row.name || !String(row.name).trim()) return 'Missing name';
  if (!row.phone || !String(row.phone).trim()) return 'Missing phone number';
  const normalized = normalizePhoneNumber(row.phone);
  if (!/^\d{10,15}$/.test(normalized)) return `"${row.phone}" doesn't look like a valid phone number`;
  if (row.email && !EMAIL_PATTERN.test(String(row.email).trim())) return `"${row.email}" doesn't look like a valid email address`;
  return null;
}

/**
 * processOneRow -- the actual per-row import logic, extracted so both
 * the real BullMQ worker (queues/leadImport.worker.js) and this file
 * share exactly one implementation.
 *
 * IMPORTANT: only genuinely expected, non-retryable outcomes (bad data,
 * a real duplicate) are returned as a normal result. Anything else --
 * a database hiccup, a timeout, anything unexpected -- is RE-THROWN so
 * BullMQ's real attempts/backoff (configured on the queue) actually
 * gets a chance to retry it. Swallowing every error into a "failed"
 * result would make that retry configuration silently do nothing --
 * a transient blip would be recorded as a permanent failure with no
 * second attempt, which is the opposite of what retries are for.
 */
/**
 * A blank CSV cell parses to an empty string, not undefined -- and
 * createLead's `data.field ?? computedDefault` pattern only falls back
 * for null/undefined, so an empty string for an enum field (status,
 * temperature, segment, etc.) was passed straight through and rejected
 * by Mongoose as an invalid enum value, with a generic "row could not
 * be saved" as the only visible symptom. Treats a blank cell as "not
 * provided" so the real defaulting/scoring logic actually applies,
 * same as if that column were absent entirely.
 */
function stripBlankFields(row) {
  const cleaned = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'string' && value.trim() === '') continue;
    cleaned[key] = value;
  }
  return cleaned;
}

export async function processOneRow(ctx, row, { skipDuplicates = true } = {}) {
  const validationError = validateRow(row);
  if (validationError) {
    return { outcome: 'failed', error: validationError };
  }
  const cleanRow = stripBlankFields(row);

  if (skipDuplicates) {
    const dup = await duplicateService.findDuplicate(ctx.tenantId, { email: cleanRow.email, phone: cleanRow.phone });
    if (dup) return { outcome: 'skipped' };
  }

  try {
    await leadService.createLead(ctx, cleanRow, { skipDuplicateCheck: true });
    return { outcome: 'created' };
  } catch (err) {
    // AppError (thrown deliberately, e.g. a real validation rule inside
    // createLead) and Mongoose's own ValidationError/CastError are
    // genuine, non-retryable "this row's data is bad" outcomes -- retrying
    // the exact same bad data three times would just fail three times.
    // Give a clean, human message instead of raw Mongoose/driver text.
    if (err instanceof AppError || err.name === 'ValidationError' || err.name === 'CastError') {
      console.warn(`[LEAD_IMPORT] row rejected for tenant ${ctx.tenantId}: ${err.message}`);
      return { outcome: 'failed', error: 'This row could not be saved -- please check its values and try again' };
    }
    // Anything else (DB connection blip, timeout, etc.) is a real,
    // possibly-transient infrastructure failure -- re-throw so the
    // queue's retry/backoff actually engages instead of permanently
    // giving up on the first attempt.
    console.error(`[LEAD_IMPORT] unexpected error for tenant ${ctx.tenantId}, will retry:`, err.message);
    throw err;
  }
}

export const importService = {
  /**
   * startImport -- validates fast, de-duplicates rows sharing the same
   * phone number WITHIN the file itself, then enqueues one real job per
   * remaining row and returns immediately.
   *
   * The in-file de-dupe matters for a real reason: rows are processed
   * with real concurrency (multiple rows in parallel). If the same
   * phone number appeared twice in the file and both rows were enqueued
   * as separate jobs, two workers could both run the "does this lead
   * already exist?" duplicate check at nearly the same instant, both
   * see "no" (since neither has been created yet), and both create a
   * lead -- producing exactly the kind of duplicate-lead race condition
   * fixed earlier in this same lead-management work. De-duplicating
   * before enqueueing removes the race entirely for the common case
   * (duplicate rows within one file); a real unique index would be the
   * only way to close the much rarer case of two different imports
   * racing on an identical brand-new number at the exact same moment.
   */
  async startImport(ctx, rows = [], { skipDuplicates = true, fileName = '' } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw AppError.badRequest('No rows to import');
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      throw AppError.badRequest(`This file has ${rows.length.toLocaleString()} rows -- the maximum per import is ${MAX_IMPORT_ROWS.toLocaleString()}. Please split it into smaller files.`);
    }

    const seenPhones = new Set();
    const uniqueRows = [];
    let duplicateWithinFile = 0;
    for (const row of rows) {
      const key = row.phone ? normalizePhoneNumber(row.phone) : null;
      if (key && seenPhones.has(key)) {
        duplicateWithinFile += 1;
        continue;
      }
      if (key) seenPhones.add(key);
      uniqueRows.push(row);
    }

    const record = await leadImportRepository.create({
      tenant_id: ctx.tenantId,
      created_by: ctx.userId || null,
      fileName,
      skipDuplicates,
      totalRows: rows.length,
      // Duplicates-within-file are already a known, final outcome --
      // recorded immediately rather than needing a queue job each.
      skippedCount: duplicateWithinFile,
      processedCount: duplicateWithinFile,
    });

    if (uniqueRows.length > 0) {
      await enqueueLeadImport({
        importId: record._id,
        rows: uniqueRows,
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        skipDuplicates,
      });
    } else {
      // Every row was a duplicate of another row in this same file --
      // there's nothing to enqueue, so nothing will ever reach the
      // normal worker-driven finalize path. Walk it through the same
      // QUEUED -> RUNNING -> COMPLETED sequence immediately rather than
      // leaving it stuck at QUEUED forever.
      await leadImportRepository.startIfQueued(ctx.tenantId, record._id);
      await leadImportRepository.completeIfRunning(ctx.tenantId, record._id);
    }

    return { importId: String(record._id), status: record.status, totalRows: rows.length };
  },

  async startImportFromCsv(ctx, csvText, opts = {}) {
    if (!csvText || typeof csvText !== 'string') {
      throw AppError.badRequest('csv text is required');
    }
    const rows = csvToLeadRows(csvText);
    return this.startImport(ctx, rows, opts);
  },

  getStatus(ctx, importId) {
    return leadImportRepository.findById(ctx.tenantId, importId);
  },
};