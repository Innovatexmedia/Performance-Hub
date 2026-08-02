import {
  LEAD_STATUS_VALUES,
  LEAD_TEMPERATURE_VALUES,
} from '../lead/lead.constants.js';
import { AppError } from '../../../shared/helpers/lead.helpers.js';

/**
 * Normalize and validate raw query params into a clean filter object.
 *
 * Supported:
 * ?search=
 * ?status=
 * ?temperature=
 * ?lead_temperature=
 * ?source=
 * ?segment=
 * ?assigned_user_id=
 * ?includeArchived=true
 */
export function normalizeFilters(query = {}) {
  const filters = {};

  /*
  |--------------------------------------------------------------------------
  | Search
  |--------------------------------------------------------------------------
  */

  if (query.search) {
    filters.search = String(query.search).trim();
  }

  /*
  |--------------------------------------------------------------------------
  | Status
  |--------------------------------------------------------------------------
  */

  if (query.status) {
    if (!LEAD_STATUS_VALUES.includes(query.status)) {
      throw AppError.badRequest(
        `Invalid status filter: ${query.status}`,
      );
    }

    filters.status = query.status;
  }

  /*
  |--------------------------------------------------------------------------
  | Temperature
  |--------------------------------------------------------------------------
  */

  const temperature =
    query.lead_temperature || query.temperature;

  if (temperature) {
    if (!LEAD_TEMPERATURE_VALUES.includes(temperature)) {
      throw AppError.badRequest(
        `Invalid temperature filter: ${temperature}`,
      );
    }

    filters.temperature = temperature;
  }

  /*
  |--------------------------------------------------------------------------
  | Source
  |--------------------------------------------------------------------------
  */

  if (query.source) {
    filters.source = String(query.source).trim();
  }

  /*
  |--------------------------------------------------------------------------
  | Segment
  |--------------------------------------------------------------------------
  */

  if (query.segment) {
    filters.segment = String(query.segment).trim();
  }

  /*
  |--------------------------------------------------------------------------
  | Assigned User
  |--------------------------------------------------------------------------
  */

  if (query.assigned_user_id) {
    filters.assigned_user_id = String(
      query.assigned_user_id,
    ).trim();
  }

  /*
  |--------------------------------------------------------------------------
  | Group
  |--------------------------------------------------------------------------
  */

  if (query.group_id) {
    filters.group_id = String(query.group_id).trim();
  }

  /*
  |--------------------------------------------------------------------------
  | Archived
  |--------------------------------------------------------------------------
  */

  filters.includeArchived =
    query.includeArchived === 'true';

  return filters;
}