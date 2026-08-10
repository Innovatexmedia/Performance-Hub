import { SEARCHABLE_FIELDS } from '../lead/lead.constants.js';

/** Escape user input for safe use inside a RegExp. */
export function escapeRegex(str = '') {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a Mongo filter (tenant scoping is applied by the repository).
 * Handles free-text search + equality filters + archived flag.
 */
export function buildLeadFilter({
  search,
  status,
  temperature,
  source,
  segment,
  assigned_user_id,
  group_id,
  includeArchived = false,
} = {}) {
  const filter = {};

  if (!includeArchived) filter.archived = false;

  if (status) filter.status = status;
  if (temperature) filter.lead_temperature = temperature;
  if (source) filter.source = source;
  if (segment) filter.segment = segment;
  if (assigned_user_id) filter.assigned_user_id = assigned_user_id;
  if (group_id) filter.group_id = group_id;

  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = SEARCHABLE_FIELDS.map((f) => ({ [f]: rx }));
  }

  return filter;
}

/** Whitelisted sort builder. */
export function buildSort(sort) {
  const allowed = {
    created_at: 'created_at',
    updated_at: 'updated_at',
    qualification_score: 'qualification_score',
    value: 'value',
    name: 'name',
  };
  if (!sort) return { created_at: -1 };
  const desc = sort.startsWith('-');
  const key = desc ? sort.slice(1) : sort;
  if (!allowed[key]) return { created_at: -1 };
  return { [allowed[key]]: desc ? -1 : 1 };
}