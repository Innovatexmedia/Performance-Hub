import { asyncHandler, AppError } from '../../../shared/helpers/lead.helpers.js';
import { importService } from './import.service.js';
import { csvToLeadRows } from './csv-import.service.js';

export const importController = {
  // POST /api/leads/import
  // Supports:
  // 1. CSV File Upload (multipart/form-data)
  // 2. JSON { rows: [...] }
  // 3. JSON { csv: "..." }
  // 4. Raw CSV text body
  //
  // Real and asynchronous (see import.service.js's startImport for why).
  // ALL FOUR input methods now go through the exact same csvToLeadRows
  // parser -- previously file-upload used a separate library (csv-parser)
  // that skipped every bit of header-alias-mapping/case-insensitivity/
  // blank-cell handling csvToLeadRows does, so a real file with headers
  // like "Full Name" or "Phone Number" (both extremely common) silently
  // failed every row with "Missing name or phone", while the UI's own
  // text claimed those columns were already recognized.
  importCsv: asyncHandler(async (req, res) => {
    const skipDuplicates = req.query.skipDuplicates !== 'false';
    const fileName = req.file?.originalname || '';

    /*
    |--------------------------------------------------------------------------
    | Option 1: CSV File Upload
    |--------------------------------------------------------------------------
    */

    if (req.file) {
      const csvText = req.file.buffer.toString('utf8');
      const rows = csvToLeadRows(csvText);
      const result = await importService.startImport(req.context, rows, { skipDuplicates, fileName });
      return res.status(202).json(result);
    }

    /*
    |--------------------------------------------------------------------------
    | Option 2: JSON Rows
    |--------------------------------------------------------------------------
    */

    if (Array.isArray(req.body?.rows)) {
      const result = await importService.startImport(req.context, req.body.rows, { skipDuplicates });
      return res.status(202).json(result);
    }

    /*
    |--------------------------------------------------------------------------
    | Option 3 & 4: CSV String / Raw CSV Text
    |--------------------------------------------------------------------------
    */

    const csv = typeof req.body === 'string' ? req.body : req.body?.csv;

    if (!csv) {
      throw AppError.badRequest('Provide CSV file, CSV text ({ csv }), or rows ({ rows })');
    }

    const result = await importService.startImportFromCsv(req.context, csv, { skipDuplicates });
    return res.status(202).json(result);
  }),

  // GET /api/leads/import/:id -- poll this for live progress, same idea
  // as GET /whatsapp/campaigns/:id for a running campaign's progress bar.
  getImportStatus: asyncHandler(async (req, res) => {
    const record = await importService.getStatus(req.context, req.params.id);
    if (!record) throw AppError.notFound('Import not found');
    return res.status(200).json({
      id: String(record._id),
      status: record.status,
      fileName: record.fileName,
      totalRows: record.totalRows,
      processedCount: record.processedCount,
      createdCount: record.createdCount,
      skippedCount: record.skippedCount,
      failedCount: record.failedCount,
      errors: record.errors,
    });
  }),
};