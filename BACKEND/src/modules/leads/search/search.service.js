import { normalizeFilters } from './filter.service.js';
import { buildLeadFilter, buildSort } from './query-builder.js';
import { normalizePaging } from '../../../shared/helpers/lead.helpers.js';

/**
 * Turn a raw HTTP query into everything the repository needs:
 *   { filter, sort, page, limit, skip }
 */
export function buildSearch(query = {}, ctx = null) {
  const filters = normalizeFilters(query);
  const filter = buildLeadFilter(filters, ctx);
  const sort = buildSort(query.sort);
  const { page, limit, skip } = normalizePaging(query);
  return { filter, sort, page, limit, skip };
}

/** Build a filter only (no paging) — used by export. */
export function buildExportFilter(query = {}, ctx = null) {
  const filters = normalizeFilters(query);
  return buildLeadFilter(filters, ctx);
}