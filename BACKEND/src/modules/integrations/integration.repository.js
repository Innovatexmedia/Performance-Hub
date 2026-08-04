/**
 * =============================================================================
 * InnovateX Revenue OS — Integration Repository
 * =============================================================================
 *
 * FILE: src/modules/integrations/integration.repository.js
 *
 * Pattern matches template.repository.js / automation.repository.js exactly:
 *   - No business logic, no validation, no formatting
 *   - Returns raw Mongoose documents
 */

import { Integration } from './integration.model.js';
import { INTEGRATION_CATALOG } from './integration.constants.js';

// =============================================================================
// CATALOG SEEDING
// =============================================================================

/**
 * ensureCatalogSeeded - upserts one Integration doc per catalog entry for
 * this tenant. $setOnInsert means an existing (already toggled/configured)
 * record is never touched - this is safe to call on every list request.
 */
export const ensureCatalogSeeded = (tenantId) =>
  Promise.all(
    INTEGRATION_CATALOG.map((entry) =>
      Integration.findOneAndUpdate(
        { tenant_id: tenantId, key: entry.key },
        {
          $setOnInsert: {
            tenant_id: tenantId,
            key: entry.key,
            name: entry.name,
            category: entry.category,
            description: entry.description,
            logo_color: entry.logo_color,
            available: entry.available,
            status: 'disconnected',
            config: {},
            error_logs: [],
          },
        },
        { upsert: true, new: false },
      ),
    ),
  );

// =============================================================================
// READ
// =============================================================================

export const findById = (tenantId, id) =>
  Integration.findOne({ _id: id, tenant_id: tenantId });

/** Looks up one tenant's integration record by its stable catalog key (e.g. 'gemini'). */
export const findByKey = (tenantId, key) =>
  Integration.findOne({ tenant_id: tenantId, key });

export const list = (tenantId, filter, options) => {
  const opts = options || {};
  const query = buildQuery(tenantId, filter);
  return Integration.find(query)
    .sort({ category: 1, name: 1 })
    .skip(opts.skip || 0)
    .limit(opts.limit || 50);
};

export const count = (tenantId, filter) =>
  Integration.countDocuments(buildQuery(tenantId, filter));

/** Per-category counts, honoring status/search filters - powers "category tabs". */
export const countByCategory = (tenantId, filter) => {
  const query = buildQuery(tenantId, filter);
  return Integration.aggregate([
    { $match: query },
    {
      $group: {
        _id: '$category',
        count: { $sum: 1 },
        connected: { $sum: { $cond: [{ $eq: ['$status', 'connected'] }, 1, 0] } },
      },
    },
    { $project: { _id: 0, category: '$_id', count: 1, connected: 1 } },
  ]);
};

// =============================================================================
// UPDATE
// =============================================================================

export const update = (tenantId, id, patch) =>
  Integration.findOneAndUpdate(
    { _id: id, tenant_id: tenantId },
    { $set: patch },
    { new: true, runValidators: true },
  );

// =============================================================================
// PRIVATE: BUILD QUERY
// =============================================================================

const buildQuery = (tenantId, filter) => {
  const f = filter || {};
  const query = { tenant_id: tenantId };
  if (f.category) query.category = f.category;
  if (f.status) query.status = f.status;
  if (f.search) {
    query.$or = [
      { name: { $regex: f.search, $options: 'i' } },
      { description: { $regex: f.search, $options: 'i' } },
    ];
  }
  return query;
};