import { SEARCHABLE_FIELDS } from '../lead/lead.constants.js';
import { ROLES } from '../../auth/constants/roles.js';

/** Escape user input for safe use inside a RegExp. */
export function escapeRegex(str = '') {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a Mongo filter (tenant scoping is applied by the repository).
 * Handles free-text search + equality filters + archived flag.
 *
 * ctx is passed so this can also enforce row-level visibility: a sales_user
 * must only ever see leads assigned to them (plus unassigned ones, so new
 * leads are still pickable) -- never another rep's, regardless of what
 * `assigned_user_id` the client asked to filter by. tenant_owner/
 * tenant_admin/read_only_user/super_admin see (and may filter by) everyone.
 */
export function buildLeadFilter({
  search,
  status,
  temperature,
  source,
  segment,
  assigned_user_id,
  group_id,
  tags,
  includeArchived = false,
  archivedOnly = false,
} = {}, ctx = null) {
  const filter = {};

  if (archivedOnly) {
    filter.archived = true;
  } else if (!includeArchived) {
    filter.archived = false;
  }
  // else: includeArchived && !archivedOnly -> no `archived` filter at all,
  // matches both states.

  if (status) filter.status = status;
  if (temperature) filter.lead_temperature = temperature;
  if (source) filter.source = source;
  if (segment) filter.segment = segment;

  if (ctx?.role === ROLES.SALES_USER) {
    // Force-scoped, ignoring whatever (if anything) the client asked for.
    // Strictly leads assigned to THIS rep -- unassigned leads are
    // intentionally excluded (product decision: a sales_user should not
    // see any lead that isn't explicitly theirs, even an unclaimed one).
    filter.assigned_user_id = ctx.userId;
  } else if (assigned_user_id) {
    filter.assigned_user_id = assigned_user_id;
  }

  // External filter param stays `group_id` (still means "show leads that
  // are a member of this one group") -- only the target field changes,
  // from an equals-match on a single value to a contains-match on the
  // `group_ids` array. Mongo resolves `{ group_ids: X }` as "array
  // contains X" automatically, so this is a pure rename, not a new
  // query shape.
  if (group_id) filter.group_ids = group_id;

  // Same $all semantics as the campaign/broadcast audience builder --
  // matches leads that carry EVERY listed tag, not just any one of them.
  if (tags && tags.length) filter.tags = { $all: tags };

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