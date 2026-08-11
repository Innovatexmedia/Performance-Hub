import { leadRepository } from '../lead/lead.repository.js';
import { buildExportFilter } from '../search/search.service.js';
import { leadsToCsv } from './csv-export.service.js';

const EXPORT_LIMIT = 100000;

/**
 * Export leads (honoring the same search/filter params as the list view)
 * as CSV text.
 */
export const exportService = {
  async exportLeadsCsv(ctx, query) {
    const filter = buildExportFilter(query, ctx);
    const leads = await leadRepository.find(ctx.tenantId, filter, {
      sort: { created_at: -1 },
      skip: 0,
      limit: EXPORT_LIMIT,
    });
    return leadsToCsv(leads);
  },
};